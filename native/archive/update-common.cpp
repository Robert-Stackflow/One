#include <algorithm>
#include <map>
#include "update-common.h"
#include "zip-common.h"

namespace archive_update {
std::string stamp(HANDLE handle) {
    BY_HANDLE_FILE_INFORMATION info{};
    if (!GetFileInformationByHandle(handle, &info)) fail("Cannot check archive revision");
    return std::to_string(info.dwVolumeSerialNumber) + ":" + std::to_string(info.nFileIndexHigh) + ":" +
        std::to_string(info.nFileIndexLow) + ":" + std::to_string(info.nFileSizeHigh) + ":" +
        std::to_string(info.nFileSizeLow) + ":" + std::to_string(info.ftLastWriteTime.dwHighDateTime) + ":" +
        std::to_string(info.ftLastWriteTime.dwLowDateTime);
}
std::wstring key(const std::string &name) {
    auto value = wide(name);
    std::replace(value.begin(), value.end(), L'\\', L'/');
    while (!value.empty() && value.back() == L'/') value.pop_back();
    if(value.empty())return value;
    const int size=LCMapStringEx(LOCALE_NAME_INVARIANT,LCMAP_LOWERCASE,value.data(),(int)value.size(),nullptr,0,nullptr,nullptr,0);
    if(size<=0)fail("Cannot compare archive paths");std::wstring folded(size,L'\0');
    if(LCMapStringEx(LOCALE_NAME_INVARIANT,LCMAP_LOWERCASE,value.data(),(int)value.size(),folded.data(),size,nullptr,nullptr,0)!=size)fail("Cannot compare archive paths");
    return folded;
}
std::string canonical(std::string name, bool directory) {
    std::replace(name.begin(), name.end(), '\\', '/');
    while (directory && !name.empty() && name.back() == '/') name.pop_back();
    if (directory) name += '/';
    if (!safe_entry(name, directory)) fail("Invalid archive path: " + name);
    wide(name); // Reject malformed UTF-8 before writing an archive header.
    return name;
}
void check_tree(const std::vector<OutputEntry> &nodes) {
    std::map<std::wstring, bool> paths;
    for (const auto &node : nodes) if (!node.removed) {
        if (!safe_entry(node.name, node.directory)) fail("Invalid archive path: " + node.name);
        if (!paths.emplace(key(node.name), node.directory).second) fail("Duplicate archive path: " + node.name);
    }
    for (const auto &[name, directory] : paths) {
        size_t end = name.find('/');
        while (end != std::wstring::npos) {
            auto found = paths.find(name.substr(0, end));
            if (found != paths.end() && !found->second) fail("A file blocks a parent directory");
            end = name.find('/', end + 1);
        }
    }
}
void check_source(const fs::path &source) {
    DWORD attributes = GetFileAttributesW(source.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
        (!fs::is_regular_file(source) && !fs::is_directory(source))) fail("Source is missing, a link or a special file");
    // Checking every component also rejects a source reached through a junction.
    fs::path current;
    for (const auto &component : fs::absolute(source)) {
        current /= component;
        auto part = GetFileAttributesW(current.c_str());
        if (part != INVALID_FILE_ATTRIBUTES && (part & FILE_ATTRIBUTE_REPARSE_POINT)) fail("Source uses a link or junction");
    }
}

void apply_plan(Plan &plan,std::vector<OutputEntry> &nodes,const fs::path &source,bool encrypted,std::string *comment){
    const size_t old_count=nodes.size();
    uint32_t count = plan.number();
    if (!count || count > 10000) fail("Archive update has too many or no changes");
    // Resolve path selectors against the opened revision before any rename.
    // Internal directory anchors follow parent/child edits like real entries,
    // but are removed from the output: implicit folders stay implicit.
    const auto start=plan.cursor;
    std::map<std::wstring,size_t> folders;
    std::vector<size_t> anchors;
    for(uint32_t action=0;action<count;++action){
        const auto kind=plan.number();plan.number();plan.number();plan.text();const auto input=plan.text(131072);
        if(kind!=6&&kind!=7)continue;
        const auto folder=canonical(input,true);const auto prefix=key(folder);
        if(folders.contains(prefix))continue;
        bool found=false;size_t index=old_count;
        for(size_t i=0;i<old_count;++i){
            const auto candidate=key(nodes[i].name);
            if(candidate==prefix){if(!nodes[i].directory)fail("A file is not an archive folder");index=i;found=true;break;}
            if(candidate.starts_with(prefix+L'/'))found=true;
        }
        if(!found)fail("Selected archive folder no longer exists");
        if(index==old_count){index=nodes.size();nodes.push_back({folder,true});anchors.push_back(index);}
        folders.emplace(prefix,index);
    }
    if(plan.cursor!=plan.bytes.size())fail("Unexpected trailing archive update data");
    plan.cursor=start;
    for (uint32_t action = 0; action < count; ++action) {
        uint32_t kind = plan.number(), index = plan.number(), replace = plan.number();
        std::string name = plan.text(), input = plan.text(131072);
        if (replace > 1) fail("Invalid replacement mode");
        if (kind == 1 || kind == 2 || kind == 6 || kind == 7) {
            if(kind==6||kind==7){index=static_cast<uint32_t>(folders.at(key(canonical(input,true))));kind=kind==6?1:2;}
            else if (index >= old_count) fail("Selected archive entry no longer exists");
            if (nodes[index].removed) { if (kind == 1) continue; fail("Selected archive entry no longer exists"); }
            auto previous = nodes[index].name;
            auto prefix = key(previous);
            bool directory = nodes[index].directory;
            std::string next = kind == 2 ? canonical(name, directory) : "";
            if(kind==2&&directory&&key(next)!=prefix){
                const auto target=key(next);
                for(const auto &node:nodes)if(!node.removed){
                    const auto candidate=key(node.name);
                    const bool moving=candidate==prefix||candidate.starts_with(prefix+L'/');
                    if(!moving&&(candidate==target||candidate.starts_with(target+L'/')))
                        fail("Renaming this folder would merge or overwrite an existing archive path: "+next);
                }
            }
            for (auto &node : nodes) if (!node.removed &&
                (key(node.name) == prefix || (directory && key(node.name).starts_with(prefix + L'/')))) {
                if (kind == 1) node.removed = true;
                else {
                    // Case folding can match spellings with different UTF-8
                    // lengths. Slice directory suffixes by path components.
                    size_t offset=node.name.size();
                    if(directory){offset=0;for(const auto c:previous)if(c=='/'){const auto slash=node.name.find('/',offset);offset=slash==std::string::npos?node.name.size():slash+1;}}
                    node.name = next + node.name.substr(offset);
                }
            }
        } else if (kind == 3) {
            nodes.push_back({canonical(name, true), true});
        } else if (kind == 4) {
            fs::path input_path = fs::u8path(input);
            if (!input_path.is_absolute()) fail("Archive input must be an absolute path");
            check_source(input_path);
            bool directory = fs::is_directory(input_path);
            auto destination = canonical(name, directory);
            auto add = [&](const fs::path &file, std::string target) {
                check_source(file);
                bool folder = fs::is_directory(file);
                target = canonical(target, folder);
                auto match = key(target);
                bool encrypt = encrypted;
                for (auto &node : nodes) if (!node.removed && key(node.name) == match) {
                    if (folder && node.directory) return; // Merge an existing directory.
                    if (!replace || folder || node.directory) fail("Adding this item would overwrite an existing entry: " + target);
                    encrypt = node.encrypt; node.removed = true;
                }
                if (fs::equivalent(file, source)) fail("Cannot add the archive to itself");
                nodes.push_back({target, folder, false, file, encrypt});
                if (nodes.size() > 1000000) fail("Archive contains too many entries");
            };
            add(input_path, destination);
            if (directory) for (const auto &entry : fs::recursive_directory_iterator(input_path, fs::directory_options::none))
                add(entry.path(), destination + utf8(entry.path().lexically_relative(input_path).generic_wstring()));
        } else if (kind == 5) { if(!comment)fail("7Z does not support archive comments"); *comment = name; }
        else fail("Unknown archive update action");
    }
    if (plan.cursor != plan.bytes.size()) fail("Unexpected trailing archive update data");
    for(const auto index:anchors)nodes[index].removed=true;
}
void check_staging(const fs::path &source,const fs::path &temporary,const fs::path &backup){
    const auto parent=fs::absolute(source).parent_path();
    if(parent!=fs::absolute(temporary).parent_path()||parent!=fs::absolute(backup).parent_path()||
       key(utf8(fs::absolute(source).wstring()))==key(utf8(fs::absolute(temporary).wstring()))||
       key(utf8(fs::absolute(source).wstring()))==key(utf8(fs::absolute(backup).wstring()))||
       key(utf8(fs::absolute(temporary).wstring()))==key(utf8(fs::absolute(backup).wstring()))||
       fs::exists(temporary)||fs::exists(backup))fail("Archive staging paths must be distinct new files beside the original");
    check_source(source);
}
void commit(File &original,const fs::path &source,const fs::path &temporary,const fs::path &backup,const std::string &revision,size_t count){
    // Persist the staging bytes before the atomic same-volume replacement.
    {
        File flush(temporary, GENERIC_WRITE, FILE_SHARE_READ);
        if (!FlushFileBuffers(flush.handle)) fail("Cannot flush staging archive");
    }
    if (stamp(original.handle) != revision) fail("Archive changed while saving");
    emit("{\"type\":\"ready\"}");
    // The host first disables cancellation, then acknowledges commit. Killing a
    // task before this handshake can never replace the original archive.
    if (std::fgetc(stdin) != 1) fail("Archive update was cancelled before commit");
    original.close();
    if (zip_revision(source) != revision) fail("Archive changed before commit");
    if (!ReplaceFileW(source.c_str(), temporary.c_str(), backup.c_str(), 0, nullptr, nullptr)) {
        DWORD error = GetLastError();
        if (!fs::exists(source) && fs::exists(backup) && !MoveFileExW(backup.c_str(), source.c_str(), MOVEFILE_WRITE_THROUGH))
            fail("Cannot restore original; recovery copy: " + utf8(backup.wstring()));
        if (fs::exists(backup)) fail("Cannot replace archive; recovery copy: " + utf8(backup.wstring()) +
                                   " (Windows error " + std::to_string(error) + ")");
        fail("Cannot replace archive; original retained (Windows error " + std::to_string(error) + ")");
    }
    // A concurrent rename in the final, tiny path handover must not overwrite
    // an unseen revision. Preserve and restore the actual replaced file.
    if (zip_revision(backup) != revision) {
        if (!ReplaceFileW(source.c_str(), backup.c_str(), nullptr, 0, nullptr, nullptr))
            fail("Archive changed during commit; recovery copy: " + utf8(backup.wstring()));
        fail("Archive changed during commit; no changes saved");
    }
    DeleteFileW(backup.c_str()); // A failed deletion leaves a recoverable original.
    emit("{\"type\":\"result\",\"count\":" + std::to_string(count) + "}");
}
}
std::string zip_revision(const fs::path &source){archive_update::File file(source);return archive_update::stamp(file.handle);}
