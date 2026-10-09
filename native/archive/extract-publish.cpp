#include <windows.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <cwctype>
#include <map>
#include <memory>
#include <zlib.h>
#include "common.h"
#include "publish-access.h"

namespace {
struct Handle {
    HANDLE value=INVALID_HANDLE_VALUE;
    Handle(const fs::path &path,bool directory=false,DWORD access=FILE_READ_ATTRIBUTES):
        value(CreateFileW(path.c_str(),access,FILE_SHARE_READ,nullptr,OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT|(directory?FILE_FLAG_BACKUP_SEMANTICS:0),nullptr)){
        if(value==INVALID_HANDLE_VALUE)fail("Cannot lock extraction path: "+utf8(path.wstring()));
        BY_HANDLE_FILE_INFORMATION info{};
        if(!GetFileInformationByHandle(value,&info)||(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||
            bool(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=directory){
            CloseHandle(value);value=INVALID_HANDLE_VALUE;fail("Extraction path contains a link or incompatible file: "+utf8(path.wstring()));
        }
    }
    ~Handle(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
    Handle(const Handle&)=delete;
};
std::string stamp(HANDLE value,bool identity=false){
    BY_HANDLE_FILE_INFORMATION info{};if(!GetFileInformationByHandle(value,&info))fail("Cannot verify extraction file identity");
    auto id=std::to_string(info.dwVolumeSerialNumber)+":"+std::to_string(info.nFileIndexHigh)+":"+std::to_string(info.nFileIndexLow);
    return identity?id:id+":"+std::to_string(info.nFileSizeHigh)+":"+std::to_string(info.nFileSizeLow)+":"+
        std::to_string(info.ftLastWriteTime.dwHighDateTime)+":"+std::to_string(info.ftLastWriteTime.dwLowDateTime);
}
std::wstring key(const fs::path &path){auto name=path.lexically_normal().wstring();std::transform(name.begin(),name.end(),name.begin(),[](wchar_t c){return std::towlower(c);});return name;}
DWORD attributes(const fs::path &path){
    auto value=GetFileAttributesW(path.c_str());
    if(value==INVALID_FILE_ATTRIBUTES){auto error=GetLastError();if(error!=ERROR_FILE_NOT_FOUND&&error!=ERROR_PATH_NOT_FOUND)fail("Cannot inspect extraction target: "+utf8(path.wstring()));}
    return value;
}
struct Directories {
    std::map<std::wstring,std::unique_ptr<Handle>> held;
    void hold(const fs::path &path){auto name=key(path);if(!held.contains(name))held.emplace(name,std::make_unique<Handle>(path,true));}
    void ancestors(const fs::path &path){
        if(!path.is_absolute()||path!=path.lexically_normal())fail("Extraction path must be absolute and normalized");
        auto current=path.root_path();hold(current);
        for(const auto &part:path.relative_path()){current/=part;hold(current);}
    }
    void release(const fs::path &path){held.erase(key(path));}
};
void move(HANDLE file,const fs::path &destination){
    auto name=destination.wstring();std::vector<unsigned char> bytes(sizeof(FILE_RENAME_INFO)+name.size()*sizeof(wchar_t));
    auto info=reinterpret_cast<FILE_RENAME_INFO*>(bytes.data());info->ReplaceIfExists=FALSE;info->RootDirectory=nullptr;
    info->FileNameLength=(DWORD)(name.size()*sizeof(wchar_t));std::memcpy(info->FileName,name.data(),info->FileNameLength);
    if(!SetFileInformationByHandle(file,FileRenameInfo,info,(DWORD)bytes.size()))fail("Cannot publish extracted file (Windows error "+std::to_string(GetLastError())+"): "+utf8(destination.wstring()));
}
void erase(HANDLE file){FILE_DISPOSITION_INFO info{TRUE};if(!SetFileInformationByHandle(file,FileDispositionInfo,&info,sizeof(info)))fail("Cannot remove completed extraction recovery file");}
bool cancelled(){
    DWORD available=0,read=0;unsigned char value=0;HANDLE input=GetStdHandle(STD_INPUT_HANDLE);
    // Test/CLI hosts may queue their acknowledgement early. Never consume it
    // while checking for cancellation during the read-only planning phase.
    if(!PeekNamedPipe(input,&value,1,&read,&available,nullptr)||!available||read!=1||value!=2)return false;
    return ReadFile(input,&value,1,&read,nullptr)&&read==1&&value==2;
}
void cancelled_result(){emit("{\"type\":\"result\",\"count\":0,\"skipped\":0,\"cancelled\":true}");}
unsigned test_value(const wchar_t *name){
    wchar_t mode[2]{},text[24]{};GetEnvironmentVariableW(L"ONE_TEST_MODE",mode,2);
    if(std::wstring(mode)!=L"1")return 0;GetEnvironmentVariableW(name,text,24);return (unsigned)_wtoi(text);
}
// Abrupt termination deliberately bypasses destructors and rollback. This is
// only available to isolated native regressions, never a production setting.
void crash_at(const std::string &point){
    static const auto selected=[](){wchar_t mode[2]{},value[64]{};GetEnvironmentVariableW(L"ONE_TEST_MODE",mode,2);
        if(std::wstring(mode)!=L"1")return std::string{};
        GetEnvironmentVariableW(L"ONE_ARCHIVE_PUBLISH_CRASH_POINT",value,64);return utf8(value);}();
    if(selected==point){TerminateProcess(GetCurrentProcess(),77);ExitProcess(77);}
}
struct Journal {
    HANDLE value=INVALID_HANDLE_VALUE;uint64_t bytes=0,sequence=0;uLong checksum=0;
    std::string pending;bool broken=false;unsigned injected=test_value(L"ONE_ARCHIVE_PUBLISH_JOURNAL_FAIL_AT_SEQUENCE");
    explicit Journal(const fs::path &path):value(CreateFileW(path.c_str(),GENERIC_WRITE|DELETE,FILE_SHARE_READ,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr)){
        if(value==INVALID_HANDLE_VALUE)fail("Cannot create extraction recovery journal");
    }
    ~Journal(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
    Journal(const Journal&)=delete;
    void drain(){
        if(broken)fail("Cannot write extraction recovery journal");if(pending.empty())return;
        DWORD written=0;if(!WriteFile(value,pending.data(),(DWORD)pending.size(),&written,nullptr)||written!=pending.size()){broken=true;fail("Cannot write extraction recovery journal");}
        pending.clear();
    }
    void append(const std::string &record){
        if(injected&&sequence==injected)fail("Injected extraction recovery journal failure");
        const auto data="{\"sequence\":"+std::to_string(sequence)+",\"record\":"+record;
        const auto next=crc32(checksum,reinterpret_cast<const Bytef*>(data.data()),(uInt)data.size());
        char hex[9]{};std::snprintf(hex,sizeof(hex),"%08lx",(unsigned long)next);
        const auto line=data+",\"crc32\":\""+hex+"\"}\n";
        // Bound both individual records and cumulative recovery metadata. No
        // per-entry flush: the complete plan and decision records are barriers.
        if(line.size()>512*1024||bytes+line.size()>512ull*1024*1024)fail("Extraction recovery journal exceeds size limit");
        if(broken)fail("Cannot write extraction recovery journal");pending+=line;
        checksum=next;bytes+=line.size();++sequence;
        if(pending.size()>=64*1024)drain();
    }
    void flush(){drain();if(!FlushFileBuffers(value))fail("Cannot flush extraction recovery journal");}
    void remove(){erase(value);CloseHandle(value);value=INVALID_HANDLE_VALUE;}
};
std::set<std::string> archive_identities(const fs::path &archive){
    std::set<std::string> ids;if(archive.empty())return ids;
    auto remember=[&](const fs::path &file){Handle input(file);ids.insert(stamp(input.value,true));};remember(archive);
    auto name=key(archive.filename());std::wstring prefix,suffix;unsigned first=1,width=2;
    if(name.ends_with(L".zip"))prefix=name.substr(0,name.size()-4)+L".z";
    else if(name.ends_with(L".7z.001")){prefix=name.substr(0,name.size()-3);width=3;}
    else if(name.ends_with(L".rar")||name.ends_with(L".r00")){
        const auto part=name.rfind(L".part");const auto end=name.size()-4;
        bool modern=name.ends_with(L".rar")&&part!=std::wstring::npos&&part+5<end;
        if(modern)for(size_t i=part+5;i<end;++i)if(name[i]<L'0'||name[i]>L'9')modern=false;
        if(modern){prefix=name.substr(0,part+5);suffix=L".rar";width=(unsigned)(end-part-5);}
        else{prefix=name.substr(0,end)+L".r";first=0;auto primary=archive.parent_path()/(name.substr(0,end)+L".rar");if(attributes(primary)!=INVALID_FILE_ATTRIBUTES)remember(primary);}
    }
    if(!prefix.empty())for(unsigned i=first;i<4096;++i){auto number=std::to_wstring(i);if(number.size()<width)number.insert(0,width-number.size(),L'0');auto volume=archive.parent_path()/(prefix+number+suffix);if(attributes(volume)==INVALID_FILE_ATTRIBUTES)break;remember(volume);}
    return ids;
}
struct Item {
    fs::path source,target,backup;bool directory=false,skip=false,existing=false,created=false,moved=false,saved=false;
    std::string source_stamp,target_stamp,identity;
};
}

void extract_publish(const fs::path &stage,const fs::path &parent,const fs::path &recovery,const std::string &conflict,const fs::path &archive){
    if(conflict!="rename"&&conflict!="skip"&&conflict!="replace")fail("Invalid extraction conflict policy");
    if(stage.parent_path()!=parent||recovery.parent_path()!=parent||stage==recovery||
        !stage.filename().wstring().starts_with(L".one-extract-")||!recovery.filename().wstring().starts_with(L".one-recovery-"))fail("Invalid extraction staging scope");
    Directories dirs;dirs.ancestors(parent);dirs.hold(stage);
    const auto archive_ids=conflict=="replace"?archive_identities(archive):std::set<std::string>{};
    std::vector<Item> items;std::map<std::wstring,size_t> folders;std::map<std::wstring,bool> reserved;
    std::vector<fs::path> nodes;
    for(const auto &entry:fs::recursive_directory_iterator(stage)){
        if(cancelled()){cancelled_result();return;}
        const auto attr=attributes(entry.path());if(attr==INVALID_FILE_ATTRIBUTES||(attr&FILE_ATTRIBUTE_REPARSE_POINT))fail("Staged extraction contains a link");
        if(attr&FILE_ATTRIBUTE_DIRECTORY)dirs.hold(entry.path());
        nodes.push_back(entry.path());if(nodes.size()>1000000)fail("Too many extracted files");
    }
    std::sort(nodes.begin(),nodes.end()); // A directory's path precedes its children.
    for(const auto &source:nodes){
        if(cancelled()){cancelled_result();return;}
        Item item;item.source=source;const auto relative=source.lexically_relative(stage);
        item.directory=(attributes(source)&FILE_ATTRIBUTE_DIRECTORY)!=0;
        if(!safe_entry(utf8(relative.generic_wstring()),item.directory))fail("Unsafe staged extraction path");
        auto folder=folders.find(key(source.parent_path()));
        item.target=(folder==folders.end()?parent:items[folder->second].target)/source.filename();
        if(folder!=folders.end()&&items[folder->second].skip)item.skip=true;
        auto attr=item.skip?INVALID_FILE_ATTRIBUTES:attributes(item.target);
        if(attr!=INVALID_FILE_ATTRIBUTES&&(attr&FILE_ATTRIBUTE_REPARSE_POINT))fail("Target contains a link or junction: "+utf8(item.target.wstring()));
        item.existing=attr!=INVALID_FILE_ATTRIBUTES;
        if(item.existing&&!(item.directory&&(attr&FILE_ATTRIBUTE_DIRECTORY))){
            if(conflict=="skip")item.skip=true;
            else if(conflict=="rename"){
                const auto extension=item.directory?fs::path{}:source.extension();
                const auto stem=item.directory?source.filename():source.stem();unsigned suffix=2;
                do{if(suffix>10000)fail("No free extraction name");item.target=item.target.parent_path()/(stem.wstring()+L" ("+std::to_wstring(suffix++)+L")"+extension.wstring());}
                while(attributes(item.target)!=INVALID_FILE_ATTRIBUTES||reserved.contains(key(item.target)));
                item.existing=false;
            }else if(item.directory||bool(attr&FILE_ATTRIBUTE_DIRECTORY))fail("Cannot replace a file with a folder or a folder with a file; choose rename or skip");
        }
        if(!item.skip){
            if(!reserved.emplace(key(item.target),item.directory).second)fail("Case-insensitive extraction target collision");
            if(item.directory&&item.existing)dirs.hold(item.target);
            if(!item.directory){Handle input(source);item.source_stamp=stamp(input.value);if(item.existing){Handle output(item.target);if(archive_ids.contains(stamp(output.value,true)))fail("Cannot replace the source archive or its volumes during extraction; choose rename or skip");item.target_stamp=stamp(output.value);}}
        }
        item.backup=recovery/(std::to_wstring(items.size())+L".original");
        if(item.directory)folders.emplace(key(source),items.size());items.push_back(std::move(item));
    }
    // Persist the intended backup locations before touching existing contents.
    // A failed rollback retains this directory, never treats it as a cache.
    if(!CreateDirectoryW(recovery.c_str(),nullptr))fail("Recovery directory already exists or cannot be created");
    dirs.hold(recovery);const auto journal=recovery/L"manifest.jsonl";
    std::unique_ptr<Journal> log;
    try{log=std::make_unique<Journal>(journal);}catch(...){dirs.release(recovery);RemoveDirectoryW(recovery.c_str());throw;}
    bool aborted=false;size_t count=0,skipped=0;std::string failure;
    try{
        log->append("{\"type\":\"header\",\"version\":2,\"parent\":"+json(utf8(parent.wstring()))+",\"stage\":"+json(utf8(stage.wstring()))+",\"recovery\":"+json(utf8(recovery.wstring()))+
            ",\"parentIdentity\":"+json(stamp(dirs.held.at(key(parent))->value,true))+",\"stageIdentity\":"+json(stamp(dirs.held.at(key(stage))->value,true))+
            ",\"recoveryIdentity\":"+json(stamp(dirs.held.at(key(recovery))->value,true))+",\"conflict\":"+json(conflict)+"}");
        size_t planned=0;
        for(size_t index=0;index<items.size();++index){const auto &item=items[index];if(item.skip)continue;
            if(cancelled()){aborted=true;fail("Extraction publishing cancelled");}
            log->append("{\"type\":\"item\",\"index\":"+std::to_string(index)+",\"source\":"+json(utf8(item.source.wstring()))+",\"target\":"+json(utf8(item.target.wstring()))+",\"backup\":"+json(utf8(item.backup.wstring()))+",\"directory\":"+(item.directory?"true":"false")+",\"existing\":"+(item.existing?"true":"false")+",\"sourceStamp\":"+json(item.source_stamp)+",\"targetStamp\":"+json(item.target_stamp)+"}");
            ++planned;
        }
        log->append("{\"type\":\"prepared\",\"items\":"+std::to_string(planned)+",\"skipped\":"+std::to_string(items.size()-planned)+"}");log->flush();
        crash_at("prepared");
        emit("{\"type\":\"ready\"}");const auto acknowledgement=archive_acknowledgement();if(acknowledgement!=1){aborted=acknowledgement==2;fail("Extraction cancelled before publishing");}
        ULONGLONG last=0,last_flush=GetTickCount64();
        const auto fail_after=test_value(L"ONE_ARCHIVE_PUBLISH_FAIL_AFTER"),wait_after=test_value(L"ONE_ARCHIVE_PUBLISH_WAIT_AFTER");
        for(size_t index=0;index<items.size();++index){auto &item=items[index];
            if(cancelled()){aborted=true;fail("Extraction publishing cancelled");}
            if(item.skip){++skipped;continue;}
            if(item.directory){
                if(!item.existing){if(!CreateDirectoryW(item.target.c_str(),nullptr))fail("Extraction directory appeared or cannot be created: "+utf8(item.target.wstring()));item.created=true;dirs.hold(item.target);}
                item.identity=stamp(dirs.held.at(key(item.target))->value,true);
                if(item.created)log->append("{\"type\":\"directory-created\",\"index\":"+std::to_string(index)+",\"identity\":"+json(item.identity)+"}");
            }else{
                Handle input(item.source,false,archive_publish_file_access);if(stamp(input.value)!=item.source_stamp)fail("Staged file changed before publishing");
                if(item.existing){
                    Handle old(item.target,false,archive_publish_file_access);if(stamp(old.value)!=item.target_stamp)fail("Existing file changed; extraction stopped: "+utf8(item.target.wstring()));
                    move(old.value,item.backup);item.saved=true;
                    crash_at("backup:"+std::to_string(index));
                }
                move(input.value,item.target);item.moved=true;
            }
            log->append("{\"type\":\"published\",\"index\":"+std::to_string(index)+"}");
            ++count;const auto now=GetTickCount64();
            if(now-last_flush>=250){log->flush();last_flush=now;}
            crash_at("published:"+std::to_string(index));
            if(!last||now-last>=100||count+skipped==items.size()){emit("{\"type\":\"progress\",\"done\":"+std::to_string(count+skipped)+",\"total\":"+std::to_string(items.size())+"}");last=now;}
            if(fail_after==count)fail("Injected extraction publishing failure");
            if(wait_after==count){while(!cancelled())Sleep(10);aborted=true;fail("Extraction publishing cancelled");}
        }
        if(cancelled()){aborted=true;fail("Extraction publishing cancelled");}
        // The completion decision must be durable before deleting any original
        // file. A crash in cleanup must never be interpreted as a failed publish.
        log->append("{\"type\":\"committed\",\"count\":"+std::to_string(count)+",\"skipped\":"+std::to_string(skipped)+"}");log->flush();
        crash_at("committed");
    }catch(const std::exception &error){failure=error.what();}
    if(!failure.empty()){
        bool complete=true;
        try{log->append("{\"type\":\"rollback-started\"}");log->flush();}catch(...){complete=false;}
        for(auto it=items.rbegin();it!=items.rend();++it){
            auto &item=*it;
            try{
                if(item.moved){Handle file(item.target,false,archive_publish_file_access);if(stamp(file.value)!=item.source_stamp)fail("Published file changed; retain it");move(file.value,item.source);}
                if(item.saved){Handle old(item.backup,false,archive_publish_file_access);if(stamp(old.value)!=item.target_stamp)fail("Backup changed; retain it");move(old.value,item.target);}
                if(item.created){
                    if(stamp(dirs.held.at(key(item.target))->value,true)!=item.identity)fail("Created folder changed");
                    dirs.release(item.target);if(!RemoveDirectoryW(item.target.c_str()))fail("Created folder is no longer empty; retain it");
                }
            }catch(...){complete=false;}
        }
        if(complete)try{log->append("{\"type\":\"rolled-back\"}");log->flush();log->remove();dirs.release(recovery);if(!RemoveDirectoryW(recovery.c_str()))complete=false;}catch(...){complete=false;}
        if(!complete)fail(failure+"; recovery retained at "+utf8(recovery.wstring()));
        if(aborted){cancelled_result();return;}
        fail(failure);
    }
    // Commit succeeded. Backups are removed by identity, with every ancestor
    // still locked; a changed recovery copy is kept and reported.
    try{
        for(size_t index=0;index<items.size();++index){auto &item=items[index];if(item.saved){Handle old(item.backup,false,archive_publish_file_access);if(stamp(old.value)!=item.target_stamp)fail("Recovery file changed");erase(old.value);crash_at("cleanup:"+std::to_string(index));}}
        log->remove();dirs.release(recovery);
        if(!RemoveDirectoryW(recovery.c_str()))fail("Cannot remove empty recovery directory");
    }catch(...){fail("Extraction completed but recovery files remain at "+utf8(recovery.wstring()));}
    emit("{\"type\":\"result\",\"count\":"+std::to_string(count)+",\"skipped\":"+std::to_string(skipped)+",\"cancelled\":false}");
}
