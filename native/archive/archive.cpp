#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cwctype>
#include <filesystem>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>
#include <mutex>
#include "heartbeat.h"
#include "mz.h"
#include "mz_os.h"
#include "mz_strm.h"
#include "mz_zip.h"
#include "mz_zip_rw.h"
#include "common.h"
#include "resources.h"
#include "shared-budget.h"
#include "origin.h"
#include "scan.h"
#include "browse.h"
#include "zip-common.h"
#include "extract-space.h"
#include "extract-risk.h"
#include "entry-details.h"
#include "alz.h"
#include "egg.h"

std::string utf8(const std::wstring &value) {
    if (value.empty()) return {};
    int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), (int)value.size(), nullptr, 0, nullptr, nullptr);
    if (!size) throw std::runtime_error("Invalid Unicode path");
    std::string result(size, 0);
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), (int)value.size(), result.data(), size, nullptr, nullptr);
    return result;
}

std::wstring wide(const std::string &value) {
    if (value.empty()) return {};
    int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), (int)value.size(), nullptr, 0);
    if (!size) throw std::runtime_error("Archive contains an invalid Unicode name");
    std::wstring result(size, 0);
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), (int)value.size(), result.data(), size);
    return result;
}

std::string json(const std::string &value) {
    std::string result = "\"";
    const char hex[] = "0123456789abcdef";
    for (unsigned char ch : value) {
        if (ch == '"' || ch == '\\') { result += '\\'; result += ch; }
        else if (ch < 32) { result += "\\u00"; result += hex[ch >> 4]; result += hex[ch & 15]; }
        else result += ch;
    }
    return result + '"';
}

void emit(const std::string &line) {
    static std::mutex mutex;static bool terminal=false;std::lock_guard guard(mutex);
    // Keep result/error last even if the heartbeat worker already woke up.
    if(line.starts_with("{\"type\":\"heartbeat\"")&&terminal)return;
    if(line.starts_with("{\"type\":\"result\"")||line.starts_with("{\"type\":\"error\""))terminal=true;
    std::printf("%s\n", line.c_str());std::fflush(stdout);
}
[[noreturn]] void fail(const std::string &message,const std::string &code) { throw ArchiveError(message,code); }

static std::string password_from_stdin() {
    _setmode(_fileno(stdin), _O_BINARY);
    unsigned char bytes[4];
    if (std::fread(bytes, 1, 4, stdin) != 4) fail("Missing private request data");
    uint32_t size = uint32_t(bytes[0]) | (uint32_t(bytes[1]) << 8) | (uint32_t(bytes[2]) << 16) | (uint32_t(bytes[3]) << 24);
    if (size > 1024) fail("Password is too long");
    std::string password(size, 0);
    if (size && std::fread(password.data(), 1, size, stdin) != size) fail("Incomplete private request data");
    return password;
}

int archive_acknowledgement(){
    // Read exactly one pipe byte. CRT fgetc can retain a following stop byte
    // in its internal buffer, hiding it from cooperative PeekNamedPipe checks.
    unsigned char byte=0;DWORD got=0;
    return ReadFile(GetStdHandle(STD_INPUT_HANDLE),&byte,1,&got,nullptr)&&got==1?int(byte):-1;
}

bool safe_entry(const std::string &name, bool directory) {
    if (name.empty() || name.size() > 32767 || name[0] == '/' || name[0] == '\\') return false;
    std::string part;
    auto valid = [](const std::string &component) {
        if (component.empty() || component == "." || component == ".." || component.back() == ' ' || component.back() == '.') return false;
        for (unsigned char c : component) if (c < 32 || c == 127 || c == ':' || c == '<' || c == '>' || c == '"' || c == '|' || c == '?' || c == '*') return false;
        std::string stem = component.substr(0, component.find('.'));
        std::transform(stem.begin(), stem.end(), stem.begin(), [](unsigned char c) { return (char)std::toupper(c); });
        if (stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL") return false;
        if (stem.size() == 4 && (stem.substr(0, 3) == "COM" || stem.substr(0, 3) == "LPT") && stem[3] >= '1' && stem[3] <= '9') return false;
        return true;
    };
    for (char c : name) {
        if (c == '/' || c == '\\') { if (!valid(part)) return false; part.clear(); }
        else part += c;
    }
    return directory ? part.empty() || valid(part) : valid(part);
}

fs::path entry_path(const std::string &name) {
    std::string canonical = name;
    std::replace(canonical.begin(), canonical.end(), '\\', '/');
    return fs::u8path(canonical);
}

Reader::Reader(const std::wstring &path, int encoding):value(mz_zip_reader_create()),encoding(encoding) {
    if (!value) fail("Cannot initialize ZIP reader");
    if (encoding) mz_zip_reader_set_encoding(value, encoding);
    if (mz_zip_reader_open_file(value, utf8(path).c_str()) != MZ_OK) {
        mz_zip_reader_delete(&value);
        fail("Cannot open ZIP archive");
    }
    try {
        void *zip=nullptr;mz_zip_reader_get_zip_handle(value,&zip);uint32_t disk=0;
        if(mz_zip_get_disk_number_with_cd(zip,&disk)!=MZ_OK||disk>=4096)fail("Cannot read ZIP volume set");
        std::vector<fs::path> members{fs::path(path)};
        for(uint32_t i=1;i<=disk;++i){auto member=fs::path(path);member.replace_extension(std::wstring(L".z")+(i<10?L"0":L"")+std::to_wstring(i));members.push_back(member);}
        bind_archive_members(fs::path(path),members);
    }catch(...){mz_zip_reader_delete(&value);throw;}
}
Reader::~Reader() { mz_zip_reader_delete(&value); }

std::string zip_name(Reader &reader, const char *name, uint16_t flag,
                    const uint8_t *extra, uint16_t extra_size, uint16_t unicode_tag) {
    if (!name) return {};
    if (flag & MZ_ZIP_FLAG_UTF8) { wide(name); return name; }
    // Standard legacy ZIPs use CP437. Accept valid UTF-8 without the flag in
    // auto mode; a manually selected code page always takes precedence.
    int codepage = reader.encoding;
    if (!codepage && extra) {
        uint32_t crc = 0xffffffff;
        for (const unsigned char *p = reinterpret_cast<const unsigned char *>(name); *p; ++p) {
            crc ^= *p;
            for (int bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        crc ^= 0xffffffff;
        for (size_t offset = 0; offset + 4 <= extra_size;) {
            uint16_t tag = extra[offset] | (extra[offset+1] << 8), size = extra[offset+2] | (extra[offset+3] << 8);
            if (size > extra_size - offset - 4) fail("Malformed ZIP extra field");
            const auto *data = extra + offset + 4;
            if (tag == unicode_tag && size >= 5 && data[0] == 1 &&
                (uint32_t(data[1]) | (uint32_t(data[2]) << 8) | (uint32_t(data[3]) << 16) | (uint32_t(data[4]) << 24)) == crc) {
                std::string value(reinterpret_cast<const char *>(data + 5), size - 5);
                if (value.find('\0') != std::string::npos) fail("ZIP Unicode path contains a null character");
                wide(value); return value;
            }
            offset += 4 + size;
        }
    }
    if (!codepage && MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, name, -1, nullptr, 0) > 0) return name;
    if (!codepage) codepage = 437;
    char *decoded = mz_os_utf8_string_create(name, codepage);
    if (!decoded) fail("Cannot decode ZIP name with the selected code page");
    std::string result(decoded); mz_os_utf8_string_delete(&decoded); wide(result);
    return result;
}

std::string zip_comment(Reader &reader, const char *comment) {
    // Archive comments have no UTF-8 flag. Modern UTF-8 comments still need to
    // display correctly after upgrading an archive with a selected legacy page.
    const bool unicode = comment && MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, comment, -1, nullptr, 0) > 0;
    return zip_name(reader, comment, unicode ? MZ_ZIP_FLAG_UTF8 : 0);
}

std::vector<Entry> zip_entries(Reader &reader) {
    std::vector<Entry> result;
    int err = mz_zip_reader_goto_first_entry(reader.value);
    if (err == MZ_END_OF_LIST) return result;
    if (err != MZ_OK) fail("Cannot read ZIP directory");
    while (err == MZ_OK) {
        mz_zip_file *info = nullptr;
        if (mz_zip_reader_entry_get_info(reader.value, &info) != MZ_OK || !info) fail("Cannot read ZIP entry");
        bool directory = mz_zip_reader_entry_is_dir(reader.value) == MZ_OK;
        if (info->filename && std::strlen(info->filename) != info->filename_size) fail("ZIP path contains a null character");
        result.push_back({result.size(), zip_name(reader, info->filename, info->flag, info->extrafield, info->extrafield_size), directory,
            (uint64_t)std::max<int64_t>(0, info->uncompressed_size), (uint64_t)std::max<int64_t>(0, info->compressed_size),
            (info->flag & MZ_ZIP_FLAG_ENCRYPTED) != 0});
        if (result.size() > 1000000) fail("ZIP contains too many entries");
        archive_activity();err = mz_zip_reader_goto_next_entry(reader.value);
    }
    if (err != MZ_END_OF_LIST) fail("Cannot finish reading ZIP directory");
    return result;
}

void zip_preflight(Reader &reader, const std::vector<Entry> &items) {
    std::set<std::wstring> seen;
    void *zip_handle = nullptr;
    mz_zip_reader_get_zip_handle(reader.value, &zip_handle);
    int err = mz_zip_reader_goto_first_entry(reader.value);
    for (const auto &item : items) {
        if (err != MZ_OK) fail("ZIP directory changed during reading");
        mz_zip_file *info = nullptr;
        mz_zip_reader_entry_get_info(reader.value, &info);
        if (!safe_entry(item.name, item.directory) || !info || (info->linkname && *info->linkname) ||
            mz_zip_entry_is_symlink(zip_handle) == MZ_OK ||
            (((info->version_madeby >> 8) == 0 || (info->version_madeby >> 8) == 10) && (info->external_fa & FILE_ATTRIBUTE_REPARSE_POINT)))
            fail("Archive contains an unsafe path or link: " + item.name,"safety");
        auto path = entry_path(item.name).wstring();
        while (!path.empty() && (path.back() == L'/' || path.back() == L'\\')) path.pop_back();
        std::transform(path.begin(), path.end(), path.begin(), [](wchar_t c) { return std::towlower(c == L'/' ? L'\\' : c); });
        if (!seen.insert(path).second) fail("Archive contains duplicate paths","safety");
        archive_activity();err = mz_zip_reader_goto_next_entry(reader.value);
    }
}

static void list(Reader &reader, const std::string &revision, size_t offset, size_t limit) {
    void *zip_handle = nullptr;
    if (mz_zip_reader_get_zip_handle(reader.value, &zip_handle) != MZ_OK || !zip_handle) fail("Cannot read ZIP directory");
    uint64_t total = 0;
    if (mz_zip_get_number_entry(zip_handle, &total) != MZ_OK || total > 1000000) fail("ZIP contains too many entries");
    const char *comment = nullptr;
    mz_zip_reader_get_comment(reader.value, &comment);
    uint32_t disk = 0;
    if (mz_zip_get_disk_number_with_cd(zip_handle, &disk) != MZ_OK) fail("Cannot read ZIP volume information");
    emit("{\"type\":\"meta\",\"total\":" + std::to_string(total) + ",\"comment\":" + json(zip_comment(reader, comment)) +
         ",\"revision\":" + json(revision) + ",\"editable\":true}");
    if (offset >= total || !limit) return;
    int err = mz_zip_reader_goto_first_entry(reader.value);
    for (size_t i = 0; i < offset + limit && i < total; ++i) {
        if (err != MZ_OK) fail("Cannot read ZIP directory");
        if (i >= offset) {
            mz_zip_file *info = nullptr;
            if (mz_zip_reader_entry_get_info(reader.value, &info) != MZ_OK || !info) fail("Cannot read ZIP entry");
            bool directory = mz_zip_reader_entry_is_dir(reader.value) == MZ_OK;
            emit("{\"type\":\"entry\",\"index\":" + std::to_string(i) + ",\"name\":" + json(zip_name(reader, info->filename, info->flag, info->extrafield, info->extrafield_size)) +
                 ",\"directory\":" + (directory ? "true" : "false") + ",\"size\":" + std::to_string(std::max<int64_t>(0, info->uncompressed_size)) +
                 ",\"compressed\":" + std::to_string(std::max<int64_t>(0, info->compressed_size)) +
                 ",\"encrypted\":" + ((info->flag & MZ_ZIP_FLAG_ENCRYPTED) ? "true" : "false") + "}");
        }
        if (i + 1 < offset + limit && i + 1 < total) {archive_activity();err = mz_zip_reader_goto_next_entry(reader.value);}
    }
}

static void details(Reader &reader,size_t index){
    if(index>=1000000)fail("Entry index is out of range");
    int error=mz_zip_reader_goto_first_entry(reader.value);
    for(size_t i=0;i<index&&error==MZ_OK;i++){archive_activity();error=mz_zip_reader_goto_next_entry(reader.value);}
    if(error!=MZ_OK)fail("Entry index is out of range");
    mz_zip_file *info=nullptr;if(mz_zip_reader_entry_get_info(reader.value,&info)!=MZ_OK||!info)fail("Cannot read ZIP entry");
    const bool directory=mz_zip_reader_entry_is_dir(reader.value)==MZ_OK;
    const Entry entry{index,zip_name(reader,info->filename,info->flag,info->extrafield,info->extrafield_size),directory,(uint64_t)std::max<int64_t>(0,info->uncompressed_size),(uint64_t)std::max<int64_t>(0,info->compressed_size),(info->flag&MZ_ZIP_FLAG_ENCRYPTED)!=0};
    // AE-2 omits the CRC in favor of authentication; zero is not a checksum.
    const auto crc=!directory&&info->aes_version!=2?entry_crc(info->crc):"";
    std::optional<int64_t> modified;if(info->modified_date>0&&info->modified_date<=253402300799ll)modified=(int64_t)info->modified_date*1000;
    const auto method=mz_zip_get_compression_method_string(info->compression_method);
    emit_details(entry,info->compressed_size>=0,modified,crc,method?method:std::to_string(info->compression_method));
}

void zip_test(Reader &reader, const std::vector<Entry> &items, const std::string &password, bool result) {
    mz_zip_reader_set_password(reader.value, password.empty() ? nullptr : password.c_str());
    int err = mz_zip_reader_goto_first_entry(reader.value);
    char buffer[65536];
    ULONGLONG last_progress = 0;
    for (const auto &item : items) {
        if (err != MZ_OK) fail("ZIP directory changed during test");
        if (!item.directory) {
            if (item.encrypted && password.empty()) fail("Password required","password");
            const int opened=mz_zip_reader_entry_open(reader.value);
            if (opened != MZ_OK) fail("Cannot open ZIP entry: " + item.name,opened==MZ_PASSWORD_ERROR?"password":"archive");
            int count;
            while ((count = mz_zip_reader_entry_read(reader.value, buffer, sizeof(buffer))) > 0) {archive_activity();}
            if (count < 0 || mz_zip_reader_entry_close(reader.value) != MZ_OK) fail("ZIP integrity check failed: " + item.name);
        }
        const auto now = GetTickCount64();
        if (item.index == 0 || item.index + 1 == items.size() || now - last_progress >= 60) {
            emit("{\"type\":\"progress\",\"done\":" + std::to_string(item.index + 1) + ",\"total\":" + std::to_string(items.size()) + "}");
            last_progress = now;
        }
        archive_activity();err = mz_zip_reader_goto_next_entry(reader.value);
    }
    if (result) emit("{\"type\":\"result\",\"count\":" + std::to_string(items.size()) + "}");
}

size_t zip_extract(Reader &reader, const std::vector<Entry> &items, const fs::path &destination,
                    const std::set<size_t> &selected, const std::string &password, bool result) {
    zip_preflight(reader, items);
    if (fs::exists(destination)) fail("Extraction destination already exists");
    mz_zip_reader_set_password(reader.value, password.empty() ? nullptr : password.c_str());
    int err = mz_zip_reader_goto_first_entry(reader.value);
    std::vector<std::string> selected_directories;
    for (size_t index : selected) if (items[index].directory) {
        std::string name = items[index].name;
        std::replace(name.begin(), name.end(), '\\', '/');
        if (!name.ends_with('/')) name += '/';
        selected_directories.push_back(name);
    }
    auto included = [&](const Entry &item) {
        if (selected.empty() || selected.contains(item.index)) return true;
        std::string name = item.name;
        std::replace(name.begin(), name.end(), '\\', '/');
        for (const auto &folder : selected_directories)
            if (name.starts_with(folder)) return true;
        return false;
    };
    size_t done = 0, total = 0; ULONGLONG last_progress = 0;
    uint64_t expected_bytes = 0;
    for (const auto &item : items) if (included(item)) {
        ++total;
        if (!item.directory) {
            if (item.size > UINT64_MAX - expected_bytes) fail("Archive declares too much extracted data","safety");
            expected_bytes += item.size;
        }
    }
    ExtractionRisk risk;for(const auto &item:items)if(included(item))risk.add(item.name,item.directory,item.size,item.compressed);risk.check();
    ExtractionSpace space(destination.parent_path(),expected_bytes);
    fs::create_directory(destination);
    for (const auto &item : items) {
        if (err != MZ_OK) fail("ZIP directory changed during extraction");
        if (archive_cancelled()) fail("Archive drag cancelled","cancelled");
        if (included(item)) {
            space.require(0);
            if (item.encrypted && password.empty()) fail("Password required","password");
            fs::path target = destination / entry_path(item.name);
            if (item.directory) fs::create_directories(target);
            else {
                fs::create_directories(target.parent_path());
                struct Output {
                    HANDLE handle;
                    explicit Output(const fs::path &path):handle(CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr,
                        CREATE_NEW, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr)) {}
                    ~Output() { if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle); }
                } output(target);
                if (output.handle == INVALID_HANDLE_VALUE) fail("Cannot create extracted file: " + item.name,"write");
                const int opened=mz_zip_reader_entry_open(reader.value);
                if (opened != MZ_OK) fail("Cannot open ZIP entry: " + item.name,opened==MZ_PASSWORD_ERROR?"password":"archive");
                char buffer[65536];
                uint64_t written = 0;
                int count;
                while ((count = mz_zip_reader_entry_read(reader.value, buffer, sizeof(buffer))) > 0) {
                    if (archive_cancelled()) fail("Archive drag cancelled","cancelled");
                    if ((uint64_t)count > item.size - written) fail("ZIP entry expanded beyond its declared size: " + item.name,"safety");
                    space.require((uint64_t)count);
                    DWORD actual = 0;
                    if (!WriteFile(output.handle, buffer, (DWORD)count, &actual, nullptr) || actual != (DWORD)count)
                        fail("Cannot write extracted file: " + item.name,"write");
                    written += (uint64_t)count;archive_activity();
                }
                if (count < 0 || written != item.size || mz_zip_reader_entry_close(reader.value) != MZ_OK)
                    fail("Cannot extract or verify ZIP entry: " + item.name);
            }
            ++done;
            const auto now = GetTickCount64();
            if (done == 1 || done == total || now - last_progress >= 100) {
                emit("{\"type\":\"progress\",\"done\":" + std::to_string(done) + ",\"total\":" + std::to_string(total) + "}");
                last_progress = now;
            }
        }
        archive_activity();err = mz_zip_reader_goto_next_entry(reader.value);
    }
    space.finish();
    if (result) emit("{\"type\":\"result\",\"count\":" + std::to_string(done) + "}");
    return done;
}

#include "zip-create-parallel.h"
static void create(const fs::path &destination, const std::vector<fs::path> &sources,
                   const std::string &password, int64_t volume_size) {
    if (sources.empty() || fs::exists(destination)) fail("Archive target already exists or has no input");
    if(zip_create_parallel(destination,sources,password,volume_size))return;
    void *writer = mz_zip_writer_create();
    if (!writer) fail("Cannot initialize ZIP writer","resource");
    try {
        mz_zip_writer_set_progress_cb(writer,nullptr,[](void*,void*,mz_zip_file*,int64_t)->int32_t{archive_activity();return MZ_OK;});
        mz_zip_writer_set_follow_links(writer, 0);
        mz_zip_writer_set_store_links(writer, 0);
        mz_zip_writer_set_compress_level(writer, (int16_t)archive_resources().level);
        mz_zip_writer_set_compress_method(writer,archive_resources().level==0?MZ_COMPRESS_METHOD_STORE:archive_resources().zip_method);
        mz_zip_writer_set_aes(writer,archive_resources().zip_aes);
        if (!password.empty()) mz_zip_writer_set_password(writer, password.c_str());
        if (mz_zip_writer_open_file(writer, utf8(destination.wstring()).c_str(), volume_size, 0) != MZ_OK) fail("Cannot create ZIP file","write");
        for (size_t i = 0; i < sources.size(); ++i) {
            const auto &path = sources[i];
            if (!fs::exists(path) || fs::is_symlink(path)) fail("Source is missing or a link");
            auto add = [&](const fs::path &item, const fs::path &base) {
                if (fs::is_symlink(item)) fail("Source contains a link");
                std::string name = utf8(item.lexically_relative(base).generic_wstring());
                int err = MZ_OK;
                if (fs::is_directory(item)) {
                    name += '/';
                    mz_zip_file info{};
                    info.version_madeby = MZ_VERSION_MADEBY;
                    info.filename = name.c_str();
                    info.flag = MZ_ZIP_FLAG_UTF8;
                    info.external_fa = FILE_ATTRIBUTE_DIRECTORY;
                    err = mz_zip_writer_add_info(writer, nullptr, nullptr, &info);
                } else if (fs::is_regular_file(item)) {
                    err = mz_zip_writer_add_file(writer, utf8(item.wstring()).c_str(), name.c_str());
                } else fail("Source contains an unsupported file");
                if (err != MZ_OK) fail("Cannot add source to ZIP (engine " + std::to_string(err) + "): " + utf8(item.wstring()),err==MZ_MEM_ERROR?"resource":err==MZ_OPEN_ERROR||err==MZ_READ_ERROR?"read":err==MZ_WRITE_ERROR?"write":"archive");
            };
            if (fs::is_directory(path)) {
                add(path, path.parent_path());
                for (const auto &entry : fs::recursive_directory_iterator(path, fs::directory_options::none)) add(entry.path(), path.parent_path());
            } else add(path, path.parent_path());
            emit("{\"type\":\"progress\",\"done\":" + std::to_string(i + 1) + ",\"total\":" + std::to_string(sources.size()) + "}");
        }
        if (mz_zip_writer_close(writer) != MZ_OK) fail("Cannot finish ZIP file","write");
        mz_zip_writer_delete(&writer);
        emit("{\"type\":\"result\",\"count\":" + std::to_string(sources.size()) + "}");
    } catch (...) { mz_zip_writer_delete(&writer); throw; }
}

static int archive_format(const std::wstring &path) {
    std::wstring name = fs::path(path).filename().wstring();
    std::transform(name.begin(), name.end(), name.begin(), [](wchar_t ch) { return std::towlower(ch); });
    if (name.ends_with(L".zip")) return 0;
    if (name.ends_with(L".zipx") || name.ends_with(L".jar") || name.ends_with(L".apk")) return 1;
    if (name.ends_with(L".7z") || name.ends_with(L".7z.001")) return 7;
    if (name.ends_with(L".rar") || name.ends_with(L".r00")) return 3;
    if (name.ends_with(L".tar")) return 0xee;
    if (name.ends_with(L".tar.gz") || name.ends_with(L".tgz") || name.ends_with(L".gz")) return 0xef;
    if (name.ends_with(L".tar.xz") || name.ends_with(L".txz") || name.ends_with(L".xz")) return 0x0c;
    if (name.ends_with(L".bz2") || name.ends_with(L".bzip2") || name.ends_with(L".tbz2") || name.ends_with(L".tbz")) return 2;
    if (name.ends_with(L".zst") || name.ends_with(L".zstd") || name.ends_with(L".tzst")) return 0x0e;
    if (name.ends_with(L".cab")) return 8;
    if (name.ends_with(L".lha") || name.ends_with(L".lzh")) return 6;
    if (name.ends_with(L".iso")) return 0xe7;
    if (name.ends_with(L".wim")) return 0xe6;
    if (name.ends_with(L".alz")) return alz_format;
    if (name.ends_with(L".egg")) return egg_format;
    fail("Unsupported archive format");
}

// The private request is always UTF-8. ZIP encryption operates on bytes and
// carries no password-encoding marker; never guess or silently substitute.
unsigned zip_password_encoding() {
    wchar_t option[16]{};SetLastError(ERROR_SUCCESS);
    const auto size=GetEnvironmentVariableW(L"ONE_ARCHIVE_PASSWORD_ENCODING",option,16);
    unsigned encoding=65001;
    if(size||GetLastError()!=ERROR_ENVVAR_NOT_FOUND){
        if(!size||size>=16)fail("Invalid ZIP password encoding","password");
        const std::wstring_view text(option,size);
        if(text==L"0")encoding=0;
        else if(text==L"437")encoding=437;
        else if(text==L"932")encoding=932;
        else if(text==L"936")encoding=936;
        else if(text==L"949")encoding=949;
        else if(text==L"950")encoding=950;
        else if(text!=L"65001")fail("Invalid ZIP password encoding","password");
    }
    return encoding;
}
static std::string zip_password(const std::string &password, int format) {
    unsigned encoding=zip_password_encoding();
    if(format!=0&&format!=1&&encoding!=65001)fail("Password encoding is only supported for ZIP/ZIPX/JAR/APK archives","password");
    if(password.find('\0')!=std::string::npos)fail("Password contains an invalid null character","password");
    const auto unicode=wide(password);
    if((format!=0&&format!=1)||password.empty())return password;
    if(!encoding)encoding=GetACP();
    if(encoding==CP_UTF8)return password;
    BOOL substituted=FALSE;
    const int length=WideCharToMultiByte(encoding,WC_NO_BEST_FIT_CHARS,unicode.data(),(int)unicode.size(),nullptr,0,nullptr,&substituted);
    if(!length||length>1024||substituted)fail("Password cannot be represented in the selected ZIP encoding; choose UTF-8 or change the password","password");
    std::string bytes(length,0);
    if(WideCharToMultiByte(encoding,WC_NO_BEST_FIT_CHARS,unicode.data(),(int)unicode.size(),bytes.data(),length,nullptr,&substituted)!=length||substituted||bytes.find('\0')!=std::string::npos)
        fail("Password cannot be represented in the selected ZIP encoding; choose UTF-8 or change the password","password");
    const int count=MultiByteToWideChar(encoding,0,bytes.data(),length,nullptr,0);
    std::wstring roundtrip(count,0);
    if(!count||MultiByteToWideChar(encoding,0,bytes.data(),length,roundtrip.data(),count)!=count||roundtrip!=unicode)
        fail("Password cannot be represented exactly in the selected ZIP encoding; choose UTF-8 or change the password","password");
    // The ZIPX handler receives Unicode and independently encodes it using pwcp.
    // Validate exact representation here, as for ZIP, before returning Unicode.
    return format==0?bytes:password;
}

int wmain(int argc, wchar_t **argv) {
    std::setvbuf(stdin,nullptr,_IONBF,0);
    _setmode(_fileno(stdout), _O_BINARY);
    try {
        if (argc < 3) fail("Usage: One.Archive.exe list|create|extract|test ...");
        if(!GetEnvironmentVariableW(L"ONE_ARCHIVE_RISK_SOURCE",nullptr,0))SetEnvironmentVariableW(L"ONE_ARCHIVE_RISK_SOURCE",argv[2]);
        ArchiveResourceJob resources;
        ArchiveGlobalLease global_lease;
        ArchiveHeartbeat heartbeat;
        const std::wstring mode = argv[1];
        std::string password = password_from_stdin();
        if(mode==L"create"||mode==L"list"||mode==L"browse"||mode==L"details"||mode==L"extract"||mode==L"test"||mode==L"update"||mode==L"update-prepare"||mode==L"update-stage"||mode==L"update-recorded-stage"||mode==L"volume-publish"||mode==L"drag"||mode==L"drag-test")password=zip_password(password,archive_format(argv[2]));
        if (mode == L"create") {
            if (argc < 4) fail("Create requires input paths");
            int first_source = 3;
            int64_t volume_size = 0;
            if (std::wstring_view(argv[3]).starts_with(L"--volume=")) {
                volume_size = std::stoll(argv[3] + 9);
                if (volume_size < 1048576 || volume_size > (int64_t)64 * 1024 * 1024 * 1024)
                    fail("ZIP volume size must be between 1 MiB and 64 GiB");
                first_source = 4;
            }
            if (first_source >= argc) fail("Create requires input paths");
            std::vector<fs::path> paths;
            for (int i = first_source; i < argc; ++i) paths.emplace_back(argv[i]);
            const int format = archive_format(argv[2]);
            if (format == 7) {
                auto extension = fs::path(argv[2]).extension().wstring();
                std::transform(extension.begin(), extension.end(), extension.begin(), [](wchar_t ch) { return std::towlower(ch); });
                if (extension != L".7z") fail("Create a 7Z archive with a .7z target path");
                if (volume_size) fail("7Z volumes are prepared after archive verification");
                seven_create(argv[2], paths, password, format);
            } else if (format == 0) create(argv[2], paths, password, volume_size);
            else if (format == 0xee || format == 0xef || format == 0x0c) {
                if (volume_size) fail("This archive format does not support volumes");
                seven_create(argv[2], paths, password, format);
            } else fail("This archive format is read-only");
        } else if (mode == L"scan-test") {
            wchar_t test[4]{};
            if(argc!=3||GetEnvironmentVariableW(L"ONE_TEST_MODE",test,4)!=1||test[0]!=L'1')fail("Private scan test requires test mode");
            archive_scan(argv[2]);
        } else if (mode == L"volume-recover" || mode == L"volume-cleanup") {
            if(argc!=4)fail("Volume recovery requires an explicit parent and recovery directory");
            if(mode==L"volume-recover")recover_volume_update(argv[2],argv[3]);else cleanup_volume_update(argv[2],argv[3]);
        } else if (mode == L"cleanup") {
            if(argc!=4)fail("Cleanup requires an explicit parent and recovery directory");
            extract_cleanup(argv[2],argv[3]);
        } else if (mode == L"recover") {
            if(argc!=4)fail("Recover requires an explicit parent and recovery directory");
            extract_recover(argv[2],argv[3]);
        } else if (mode == L"publish") {
            if(argc!=6&&argc!=7)fail("Publish requires extraction staging, parent, recovery and conflict policy");
            extract_publish(argv[2],argv[3],argv[4],utf8(argv[5]),argc==7?fs::path(argv[6]):fs::path{});
        } else if (mode == L"drag" || mode == L"drag-test") {
            bool folders=argc>6&&std::wstring_view(argv[argc-1])==L"--folders";
            int count=argc-(folders?1:0);
            if (count < 6 || count > 8) fail("Drag requires a staging directory, encoding and revision");
            archive_drag(argv[2], argv[3], _wtoi(argv[4]), utf8(argv[5]), password, archive_format(argv[2]), mode == L"drag-test", count >= 7 ? std::stoull(argv[6]) : 0, count == 8 ? fs::path(argv[7]) : fs::path{},folders);
        } else if(mode==L"volume-publish"){
            if(argc!=8)fail("Volume publishing requires source, staged primary, recovery, encoding and both revisions");
            publish_volume_update(argv[2],argv[3],argv[4],_wtoi(argv[5]),utf8(argv[6]),utf8(argv[7]),password,archive_format(argv[2]));
        } else if(mode==L"stage-inspect"){
            if(argc!=5)fail("Staging inspection requires source, stage and recovery");
            inspect_volume_stage(argv[2],argv[3],argv[4]);
        } else if(mode==L"stage-cleanup"){
            if(argc!=6)fail("Staging cleanup requires source, stage, recovery and inspection token");
            cleanup_volume_stage(argv[2],argv[3],argv[4],utf8(argv[5]));
        } else if(mode==L"update-recorded-stage"){
            if(argc!=7)fail("Recorded staging requires source, new stage, recovery, encoding and revision");
            update_volume_stage(argv[2],argv[3],_wtoi(argv[5]),utf8(argv[6]),password,archive_format(argv[2]),argv[4]);
        } else if(mode==L"update-stage"){
            if(argc!=6)fail("Volume staging requires a source, new directory, encoding and revision");
            update_volume_stage(argv[2],argv[3],_wtoi(argv[4]),utf8(argv[5]),password,archive_format(argv[2]));
        } else if (mode == L"update"||mode==L"update-prepare") {
            const bool prepare=mode==L"update-prepare";
            if(argc!=7)fail("Update requires an archive, staging paths, encoding and revision");
            const auto format=archive_format(argv[2]);
            if(prepare){auto extension=fs::path(argv[3]).extension().wstring();std::transform(extension.begin(),extension.end(),extension.begin(),[](wchar_t c){return std::towlower(c);});if(extension!=(format==0?L".zip":L".7z"))fail("Prepared archive must use the original container format");}
            if(format==0)zip_update(argv[2],argv[3],argv[4],_wtoi(argv[5]),utf8(argv[6]),password,prepare);
            else if(format==7){auto extension=fs::path(argv[2]).extension().wstring();std::transform(extension.begin(),extension.end(),extension.begin(),[](wchar_t c){return std::towlower(c);});
                if(!prepare&&extension!=L".7z")fail("Split 7Z editing is not supported yet");
                seven_update(argv[2],argv[3],argv[4],utf8(argv[6]),password,prepare);
            }else fail("Editing requires a single-volume ZIP or 7Z archive");
        } else if(mode==L"details"){
            if(argc!=6)fail("Details require an index, encoding and revision");
            const auto revision=utf8(argv[5]);lock_archive_source(argv[2]);expect_archive_revision(argv[2],revision);
            const auto index=std::stoull(argv[3]);if(index>=1000000)fail("Entry index is out of range");
            const auto format=archive_format(argv[2]);
            if(format==0){Reader reader(argv[2],_wtoi(argv[4]));details(reader,index);}
            else if(format==alz_format)alz_details(argv[2],index,_wtoi(argv[4]));
                else if(format==egg_format)egg_details(argv[2],index,_wtoi(argv[4]));
            else seven_details(argv[2],index,password,format);
            if(zip_revision(argv[2])!=revision)fail("Archive changed during reading; reopen it");
        } else if (mode == L"list" || mode == L"browse" || mode == L"extract" || mode == L"test") {
            int encoding = 0;
            bool selected_folders=false;std::string expected_revision;
            if (mode == L"list" || mode == L"browse") {
                if (argc != 6) fail("List requires offset, limit and encoding");
                encoding = _wtoi(argv[5]);
            } else if (mode == L"extract") {
                if(argc<6||argc>8)fail("Extract requires destination, selected indexes and encoding");
                for(int i=6;i<argc;i++){
                    const std::wstring_view option=argv[i];
                    if(option==L"--folders"&&!selected_folders)selected_folders=true;
                    else if(option.starts_with(L"--revision=")&&expected_revision.empty())expected_revision=utf8(std::wstring(option.substr(11)));
                    else fail("Invalid extraction option");
                }
                if(!expected_revision.empty())expect_archive_revision(argv[2],expected_revision);
                encoding = _wtoi(argv[5]);
            } else if (argc == 4) encoding = _wtoi(argv[3]);
            int format = archive_format(argv[2]);
            lock_archive_source(argv[2]);
            if (mode == L"browse") {
                const auto query=read_browse_query();size_t offset=std::stoull(argv[3]),limit=std::min<size_t>(500,std::stoull(argv[4]));
                if(format==0){Reader reader(argv[2],encoding);const auto revision=zip_revision(argv[2]);BrowseRows rows(query);const auto items=zip_entries(reader);for(const auto &entry:items)rows.add(entry);const char *comment=nullptr;mz_zip_reader_get_comment(reader.value,&comment);void *handle=nullptr;mz_zip_reader_get_zip_handle(reader.value,&handle);uint32_t disk=0;if(mz_zip_get_disk_number_with_cd(handle,&disk)!=MZ_OK)fail("Cannot read ZIP volumes");rows.emit_page(items.size(),zip_comment(reader,comment),revision,true,offset,limit);if(zip_revision(argv[2])!=revision)fail("ZIP changed during browsing; reopen it");}
                else if(format==alz_format)alz_list(argv[2],offset,limit,encoding,&query);
                else if(format==egg_format)egg_list(argv[2],offset,limit,encoding,&query);
                else seven_browse(argv[2],offset,limit,password,format,query);
            } else if (mode == L"list") {
                size_t offset = std::stoull(argv[3]), limit = std::min<size_t>(500, std::stoull(argv[4]));
                if (format == 0) {
                    Reader reader(argv[2], encoding);const auto revision = zip_revision(argv[2]); list(reader, revision, offset, limit);
                    if (zip_revision(argv[2]) != revision) fail("ZIP changed during listing; reopen it");
                }
                else if(format==alz_format)alz_list(argv[2],offset,limit,encoding);
                else if(format==egg_format)egg_list(argv[2],offset,limit,encoding);
                else seven_list(argv[2], offset, limit, password, format);
            } else if (mode == L"test") {
                if (format == 0) { Reader reader(argv[2], encoding); zip_test(reader, zip_entries(reader), password); }
                else if(format==alz_format)alz_test(argv[2],password,encoding);
                else if(format==egg_format)egg_test(argv[2],password,encoding);
                else seven_test(argv[2], password, format);
            } else {
                std::set<size_t> selected;
                std::wstring text = argv[4], part;
                for (wchar_t c : text + L',') {
                    if (c == L',') { if (!part.empty()) { selected.insert(std::stoull(part)); part.clear(); } }
                    else if (c >= L'0' && c <= L'9') part += c;
                    else fail("Invalid selected entry index");
                }
                const auto folders=selected_folders?read_selected_folders():std::vector<std::string>{};
                ArchiveOrigin origin(argv[2]);size_t extracted=0;
                if (format == 0) {
                    Reader reader(argv[2], encoding); auto items = zip_entries(reader);
                    expand_folders(items,selected,folders);
                    if (!selected.empty() && *selected.rbegin() >= items.size()) fail("Selected entry index is out of range");
                    extracted=zip_extract(reader, items, argv[3], selected, password,false);
                } else if(format==alz_format)extracted=alz_extract(argv[2],argv[3],selected,password,encoding,false,folders);
                else if(format==egg_format)extracted=egg_extract(argv[2],argv[3],selected,password,encoding,false,folders);
                else extracted=seven_extract(argv[2], argv[3], selected, password, format,false,folders);
                if(!expected_revision.empty()&&zip_revision(argv[2])!=expected_revision)fail("Archive changed during extraction; reopen it");
                origin.apply(argv[3]);
                archive_scan(argv[3]);
                emit("{\"type\":\"result\",\"count\":"+std::to_string(extracted)+"}");
            }
        } else fail("Unknown archive operation");
        return 0;
    } catch (const ArchiveError &error) {
        emit("{\"type\":\"error\",\"code\":"+json(error.code)+",\"message\":" + json(error.what()) + "}");
        return 2;
    } catch (const std::bad_alloc &) {
        emit("{\"type\":\"error\",\"code\":\"resource\",\"message\":\"Archive memory budget exceeded; increase the limit or use a lower compression level\"}");
        return 2;
    } catch (const std::exception &error) {
        emit("{\"type\":\"error\",\"message\":" + json(error.what()) + "}");
        return 2;
    }
}
