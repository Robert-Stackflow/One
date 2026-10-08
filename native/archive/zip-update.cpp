#include <windows.h>
#include <algorithm>
#include <cstdio>
#include <cwctype>
#include <map>
#include <memory>
#include "mz.h"
#include "mz_os.h"
#include "mz_strm.h"
#include "mz_zip.h"
#include "mz_zip_rw.h"
#include "zip-common.h"

namespace {
struct File {
    HANDLE handle = INVALID_HANDLE_VALUE;
    explicit File(const fs::path &path, DWORD access = FILE_READ_ATTRIBUTES,
                  DWORD share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE) {
        handle = CreateFileW(path.c_str(), access, share, nullptr, OPEN_EXISTING,
                             FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
        if (handle == INVALID_HANDLE_VALUE) fail("Cannot lock archive or input file");
        BY_HANDLE_FILE_INFORMATION info{};
        if (!GetFileInformationByHandle(handle, &info) ||
            (info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY))) {
            CloseHandle(handle); handle = INVALID_HANDLE_VALUE;
            fail("Archive or input is not a regular file");
        }
    }
    ~File() { close(); }
    void close() { if (handle != INVALID_HANDLE_VALUE) { CloseHandle(handle); handle = INVALID_HANDLE_VALUE; } }
    File(const File &) = delete;
    File &operator=(const File &) = delete;
};
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
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t ch) { return std::towlower(ch); });
    return value;
}
std::string canonical(std::string name, bool directory) {
    std::replace(name.begin(), name.end(), '\\', '/');
    while (directory && !name.empty() && name.back() == '/') name.pop_back();
    if (directory) name += '/';
    if (!safe_entry(name, directory)) fail("Invalid archive path: " + name);
    wide(name); // Reject malformed UTF-8 before writing it into a ZIP header.
    return name;
}
struct Plan {
    std::vector<unsigned char> bytes;
    size_t cursor = 0;
    Plan() {
        unsigned char header[4];
        if (std::fread(header, 1, 4, stdin) != 4) fail("Missing ZIP update plan");
        uint32_t size = uint32_t(header[0]) | (uint32_t(header[1]) << 8) |
                        (uint32_t(header[2]) << 16) | (uint32_t(header[3]) << 24);
        if (size < 4 || size > 4 * 1024 * 1024) fail("ZIP update plan exceeds limits");
        bytes.resize(size);
        if (std::fread(bytes.data(), 1, size, stdin) != size) fail("Incomplete ZIP update plan");
    }
    uint32_t number() {
        if (bytes.size() - cursor < 4) fail("Incomplete ZIP update plan");
        uint32_t value = uint32_t(bytes[cursor]) | (uint32_t(bytes[cursor+1]) << 8) |
                         (uint32_t(bytes[cursor+2]) << 16) | (uint32_t(bytes[cursor+3]) << 24);
        cursor += 4; return value;
    }
    std::string text(size_t limit = 65535) {
        uint32_t size = number();
        if (size > limit || size > bytes.size() - cursor) fail("Invalid ZIP update string");
        std::string value(reinterpret_cast<const char *>(bytes.data() + cursor), size);
        cursor += size;
        if (value.find('\0') != std::string::npos) fail("ZIP update contains a null character");
        wide(value); return value;
    }
};
struct OutputEntry {
    std::string name;
    bool directory = false;
    bool removed = false;
    fs::path source;
    bool encrypt = false;
};
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
struct RenameInfo { std::string name; std::vector<uint8_t> extra; std::string comment; Reader *reader = nullptr; };
int32_t rename_metadata(void *, void *opaque, mz_zip_file *info) {
    auto &context = *static_cast<RenameInfo *>(opaque);
    info->filename = context.name.c_str();
    info->filename_size = static_cast<uint16_t>(context.name.size());
    context.comment = zip_name(*context.reader, info->comment, info->flag, info->extrafield, info->extrafield_size, 0x6375);
    info->comment = context.comment.c_str();
    info->comment_size = static_cast<uint16_t>(context.comment.size());
    info->flag |= MZ_ZIP_FLAG_UTF8;
    context.extra.clear();
    // Unicode path/comment fields contain a CRC of the old header bytes. The UTF-8
    // header is now authoritative; retain timestamp, AES and other extra fields.
    for (size_t offset = 0; offset + 4 <= info->extrafield_size;) {
        uint16_t tag = info->extrafield[offset] | (info->extrafield[offset+1] << 8);
        uint16_t size = info->extrafield[offset+2] | (info->extrafield[offset+3] << 8);
        if (size > info->extrafield_size - offset - 4) break;
        if (tag != 0x7075 && tag != 0x6375)
            context.extra.insert(context.extra.end(), info->extrafield + offset, info->extrafield + offset + 4 + size);
        offset += 4 + size;
    }
    info->extrafield = context.extra.empty() ? nullptr : context.extra.data();
    info->extrafield_size = static_cast<uint16_t>(context.extra.size());
    return MZ_OK;
}
struct Writer {
    void *value = mz_zip_writer_create();
    Writer() { if (!value) fail("Cannot initialize ZIP writer"); }
    ~Writer() { mz_zip_writer_delete(&value); }
};
}

std::string zip_revision(const fs::path &source) { File file(source); return stamp(file.handle); }

void zip_update(const fs::path &source, const fs::path &temporary, const fs::path &backup,
                int encoding, const std::string &revision, const std::string &password) {
    if (fs::absolute(source).parent_path() != fs::absolute(temporary).parent_path() ||
        fs::absolute(source).parent_path() != fs::absolute(backup).parent_path() ||
        fs::exists(temporary) || fs::exists(backup)) fail("ZIP staging paths must be new files beside the original");
    check_source(source);
    // Deny writes/deletion throughout preflight, rewrite and verification.
    File original(source, GENERIC_READ, FILE_SHARE_READ);
    if (stamp(original.handle) != revision) fail("Archive changed; reopen it before saving changes");
    Plan plan;
    std::vector<OutputEntry> nodes;
    std::string comment;
    size_t old_count = 0;
    {
        Reader reader(source.wstring(), encoding);
        auto items = zip_entries(reader);
        old_count = items.size();
        zip_preflight(reader, items);
        void *zip = nullptr; mz_zip_reader_get_zip_handle(reader.value, &zip);
        uint32_t disk = 0;
        if (mz_zip_get_disk_number_with_cd(zip, &disk) != MZ_OK || disk != 0)
            fail("Split ZIP editing is not supported yet");
        const char *existing_comment = nullptr;
        mz_zip_reader_get_comment(reader.value, &existing_comment);
        comment = zip_comment(reader, existing_comment);
        bool encrypted = false;
        for (const auto &item : items) {
            encrypted = encrypted || item.encrypted;
            nodes.push_back({canonical(item.name, item.directory), item.directory, false, {}, item.encrypted});
        }
        // Verify the original too, including entries the user will remove. Never
        // silently discard corrupt/encrypted data without a successful full test.
        zip_test(reader, items, password, false);
        uint32_t count = plan.number();
        if (!count || count > 10000) fail("ZIP update has too many or no changes");
        for (uint32_t action = 0; action < count; ++action) {
            uint32_t kind = plan.number(), index = plan.number(), replace = plan.number();
            std::string name = plan.text(), input = plan.text(131072);
            if (replace > 1) fail("Invalid replacement mode");
            if (kind == 1 || kind == 2) {
                if (index >= old_count) fail("Selected ZIP entry no longer exists");
                if (nodes[index].removed) { if (kind == 1) continue; fail("Selected ZIP entry no longer exists"); }
                auto previous = nodes[index].name;
                auto prefix = key(previous);
                bool directory = nodes[index].directory;
                std::string next = kind == 2 ? canonical(name, directory) : "";
                for (auto &node : nodes) if (!node.removed &&
                    (key(node.name) == prefix || (directory && key(node.name).starts_with(prefix + L'/')))) {
                    if (kind == 1) node.removed = true;
                    else node.name = next + node.name.substr(previous.size());
                }
            } else if (kind == 3) {
                nodes.push_back({canonical(name, true), true});
            } else if (kind == 4) {
                fs::path input_path = fs::u8path(input);
                if (!input_path.is_absolute()) fail("ZIP input must be an absolute path");
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
                    if (nodes.size() > 1000000) fail("ZIP contains too many entries");
                };
                add(input_path, destination);
                if (directory) for (const auto &entry : fs::recursive_directory_iterator(input_path, fs::directory_options::none))
                    add(entry.path(), destination + utf8(entry.path().lexically_relative(input_path).generic_wstring()));
            } else if (kind == 5) comment = name;
            else fail("Unknown ZIP update action");
        }
        if (plan.cursor != plan.bytes.size()) fail("Unexpected trailing ZIP update data");
        check_tree(nodes);
        uint64_t needed = 0;
        for (size_t i = 0; i < nodes.size(); ++i) if (!nodes[i].removed) {
            uint64_t bytes = i < old_count ? items[i].compressed : nodes[i].directory ? 0 : fs::file_size(nodes[i].source);
            if (bytes > UINT64_MAX - needed - 65536) fail("ZIP update size exceeds limits");
            needed += bytes + 65536;
        }
        auto capacity = fs::space(source.parent_path());
        if (capacity.available != UINTMAX_MAX &&
            (capacity.available < 256ull * 1024 * 1024 || needed > capacity.available - 256ull * 1024 * 1024))
            fail("Not enough free disk space to update the archive");
        Writer writer;
        mz_zip_writer_set_comment(writer.value, comment.c_str());
        mz_zip_writer_set_follow_links(writer.value, 0);
        mz_zip_writer_set_store_links(writer.value, 0);
        mz_zip_writer_set_compress_level(writer.value, 6);
        if (mz_zip_writer_open_file(writer.value, utf8(temporary.wstring()).c_str(), 0, 0) != MZ_OK)
            fail("Cannot create staging ZIP");
        RenameInfo context; context.reader = &reader;
        mz_zip_writer_set_entry_cb(writer.value, &context, rename_metadata);
        int err = mz_zip_reader_goto_first_entry(reader.value);
        size_t completed = 0, total = std::count_if(nodes.begin(), nodes.end(), [](const auto &node) { return !node.removed; });
        ULONGLONG last_progress = 0;
        auto progress = [&] {
            ++completed; auto now = GetTickCount64();
            if (completed == 1 || completed == total || now - last_progress >= 60) {
                emit("{\"type\":\"progress\",\"done\":" + std::to_string(completed) + ",\"total\":" + std::to_string(total) + "}");
                last_progress = now;
            }
        };
        for (size_t i = 0; i < old_count; ++i) {
            if (err != MZ_OK) fail("ZIP directory changed during update");
            if (!nodes[i].removed) {
                context.name = nodes[i].name;
                if (mz_zip_writer_copy_from_reader(writer.value, reader.value) != MZ_OK) fail("Cannot copy retained ZIP entry");
                progress();
            }
            err = mz_zip_reader_goto_next_entry(reader.value);
        }
        mz_zip_writer_set_entry_cb(writer.value, nullptr, nullptr);
        for (size_t i = old_count; i < nodes.size(); ++i) if (!nodes[i].removed) {
            const auto &node = nodes[i];
            mz_zip_writer_set_password(writer.value, node.encrypt ? password.c_str() : nullptr);
            mz_zip_writer_set_aes(writer.value, node.encrypt ? 1 : 0);
            int added;
            if (node.directory) {
                mz_zip_file info{}; info.filename = node.name.c_str(); info.flag = MZ_ZIP_FLAG_UTF8;
                info.version_madeby = MZ_VERSION_MADEBY; info.external_fa = FILE_ATTRIBUTE_DIRECTORY;
                added = mz_zip_writer_add_info(writer.value, nullptr, nullptr, &info);
            } else {
                check_source(node.source);
                File input(node.source, GENERIC_READ, FILE_SHARE_READ);
                added = mz_zip_writer_add_file(writer.value, utf8(node.source.wstring()).c_str(), node.name.c_str());
            }
            if (added != MZ_OK) fail("Cannot add ZIP entry: " + node.name);
            progress();
        }
        if (mz_zip_writer_close(writer.value) != MZ_OK) fail("Cannot finish staging ZIP");
    }
    size_t final_count = 0;
    {
        Reader verify(temporary.wstring(), 0);
        auto items = zip_entries(verify);
        final_count = items.size();
        zip_preflight(verify, items);
        zip_test(verify, items, password, false);
    }
    // Persist the staging bytes before the atomic same-volume replacement.
    {
        File flush(temporary, GENERIC_WRITE, FILE_SHARE_READ);
        if (!FlushFileBuffers(flush.handle)) fail("Cannot flush staging ZIP");
    }
    if (stamp(original.handle) != revision) fail("Archive changed while saving");
    emit("{\"type\":\"ready\"}");
    // The host first disables cancellation, then acknowledges commit. Killing a
    // task before this handshake can never replace the original archive.
    if (std::fgetc(stdin) != 1) fail("ZIP update was cancelled before commit");
    original.close();
    if (zip_revision(source) != revision) fail("Archive changed before commit");
    if (!ReplaceFileW(source.c_str(), temporary.c_str(), backup.c_str(), 0, nullptr, nullptr)) {
        DWORD error = GetLastError();
        if (!fs::exists(source) && fs::exists(backup) && !MoveFileExW(backup.c_str(), source.c_str(), MOVEFILE_WRITE_THROUGH))
            fail("Cannot restore original; recovery copy: " + utf8(backup.wstring()));
        if (fs::exists(backup)) fail("Cannot replace ZIP; recovery copy: " + utf8(backup.wstring()) +
                                   " (Windows error " + std::to_string(error) + ")");
        fail("Cannot replace ZIP; original retained (Windows error " + std::to_string(error) + ")");
    }
    // A concurrent rename in the final, tiny path handover must not overwrite
    // an unseen revision. Preserve and restore the actual replaced file.
    if (zip_revision(backup) != revision) {
        if (!ReplaceFileW(source.c_str(), backup.c_str(), nullptr, 0, nullptr, nullptr))
            fail("Archive changed during commit; recovery copy: " + utf8(backup.wstring()));
        fail("Archive changed during commit; no changes saved");
    }
    DeleteFileW(backup.c_str()); // A failed deletion leaves a recoverable original.
    emit("{\"type\":\"result\",\"count\":" + std::to_string(final_count) + "}");
}
