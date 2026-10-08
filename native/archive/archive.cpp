#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cwctype>
#include <filesystem>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>
#include "mz.h"
#include "mz_os.h"
#include "mz_strm.h"
#include "mz_zip.h"
#include "mz_zip_rw.h"
#include "common.h"

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

void emit(const std::string &line) { std::printf("%s\n", line.c_str()); std::fflush(stdout); }
[[noreturn]] void fail(const std::string &message) { throw std::runtime_error(message); }

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

struct Reader {
    void *value = mz_zip_reader_create();
    explicit Reader(const std::wstring &path, int encoding) {
        if (!value) fail("Cannot initialize ZIP reader");
        if (encoding) mz_zip_reader_set_encoding(value, encoding);
        if (mz_zip_reader_open_file(value, utf8(path).c_str()) != MZ_OK) fail("Cannot open ZIP archive");
    }
    ~Reader() { mz_zip_reader_delete(&value); }
};

struct Entry { size_t index; std::string name; bool directory; uint64_t size; uint64_t compressed; bool encrypted; };

static std::vector<Entry> entries(Reader &reader) {
    std::vector<Entry> result;
    int err = mz_zip_reader_goto_first_entry(reader.value);
    if (err == MZ_END_OF_LIST) return result;
    if (err != MZ_OK) fail("Cannot read ZIP directory");
    while (err == MZ_OK) {
        mz_zip_file *info = nullptr;
        if (mz_zip_reader_entry_get_info(reader.value, &info) != MZ_OK || !info) fail("Cannot read ZIP entry");
        bool directory = mz_zip_reader_entry_is_dir(reader.value) == MZ_OK;
        result.push_back({result.size(), info->filename ? info->filename : "", directory,
            (uint64_t)std::max<int64_t>(0, info->uncompressed_size), (uint64_t)std::max<int64_t>(0, info->compressed_size),
            (info->flag & MZ_ZIP_FLAG_ENCRYPTED) != 0});
        if (result.size() > 1000000) fail("ZIP contains too many entries");
        err = mz_zip_reader_goto_next_entry(reader.value);
    }
    if (err != MZ_END_OF_LIST) fail("Cannot finish reading ZIP directory");
    return result;
}

static void preflight(Reader &reader, const std::vector<Entry> &items) {
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
            ((info->version_madeby >> 8) == 0 && (info->external_fa & FILE_ATTRIBUTE_REPARSE_POINT)))
            fail("Archive contains an unsafe path or link: " + item.name);
        auto path = entry_path(item.name).wstring();
        while (!path.empty() && (path.back() == L'/' || path.back() == L'\\')) path.pop_back();
        std::transform(path.begin(), path.end(), path.begin(), [](wchar_t c) { return std::towlower(c == L'/' ? L'\\' : c); });
        if (!seen.insert(path).second) fail("Archive contains duplicate paths");
        err = mz_zip_reader_goto_next_entry(reader.value);
    }
}

static void list(Reader &reader, size_t offset, size_t limit) {
    void *zip_handle = nullptr;
    if (mz_zip_reader_get_zip_handle(reader.value, &zip_handle) != MZ_OK || !zip_handle) fail("Cannot read ZIP directory");
    uint64_t total = 0;
    if (mz_zip_get_number_entry(zip_handle, &total) != MZ_OK || total > 1000000) fail("ZIP contains too many entries");
    const char *comment = nullptr;
    mz_zip_reader_get_comment(reader.value, &comment);
    emit("{\"type\":\"meta\",\"total\":" + std::to_string(total) + ",\"comment\":" + json(comment ? comment : "") + "}");
    if (offset >= total || !limit) return;
    int err = mz_zip_reader_goto_first_entry(reader.value);
    for (size_t i = 0; i < offset + limit && i < total; ++i) {
        if (err != MZ_OK) fail("Cannot read ZIP directory");
        if (i >= offset) {
            mz_zip_file *info = nullptr;
            if (mz_zip_reader_entry_get_info(reader.value, &info) != MZ_OK || !info) fail("Cannot read ZIP entry");
            bool directory = mz_zip_reader_entry_is_dir(reader.value) == MZ_OK;
            emit("{\"type\":\"entry\",\"index\":" + std::to_string(i) + ",\"name\":" + json(info->filename ? info->filename : "") +
                 ",\"directory\":" + (directory ? "true" : "false") + ",\"size\":" + std::to_string(std::max<int64_t>(0, info->uncompressed_size)) +
                 ",\"compressed\":" + std::to_string(std::max<int64_t>(0, info->compressed_size)) +
                 ",\"encrypted\":" + ((info->flag & MZ_ZIP_FLAG_ENCRYPTED) ? "true" : "false") + "}");
        }
        if (i + 1 < offset + limit && i + 1 < total) err = mz_zip_reader_goto_next_entry(reader.value);
    }
}

static void test(Reader &reader, const std::vector<Entry> &items, const std::string &password) {
    mz_zip_reader_set_password(reader.value, password.empty() ? nullptr : password.c_str());
    int err = mz_zip_reader_goto_first_entry(reader.value);
    char buffer[65536];
    for (const auto &item : items) {
        if (err != MZ_OK) fail("ZIP directory changed during test");
        if (!item.directory) {
            if (item.encrypted && password.empty()) fail("Password required");
            if (mz_zip_reader_entry_open(reader.value) != MZ_OK) fail("Cannot open ZIP entry: " + item.name);
            int count;
            while ((count = mz_zip_reader_entry_read(reader.value, buffer, sizeof(buffer))) > 0) {}
            if (count < 0 || mz_zip_reader_entry_close(reader.value) != MZ_OK) fail("ZIP integrity check failed: " + item.name);
        }
        emit("{\"type\":\"progress\",\"done\":" + std::to_string(item.index + 1) + ",\"total\":" + std::to_string(items.size()) + "}");
        err = mz_zip_reader_goto_next_entry(reader.value);
    }
    emit("{\"type\":\"result\",\"count\":" + std::to_string(items.size()) + "}");
}

static void extract(Reader &reader, const std::vector<Entry> &items, const fs::path &destination,
                    const std::set<size_t> &selected, const std::string &password) {
    preflight(reader, items);
    if (fs::exists(destination)) fail("Extraction destination already exists");
    fs::create_directory(destination);
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
    size_t done = 0, total = 0;
    uint64_t expected_bytes = 0;
    for (const auto &item : items) if (included(item)) {
        ++total;
        if (item.size > UINT64_MAX - expected_bytes) fail("Archive declares too much extracted data");
        expected_bytes += item.size;
    }
    const auto capacity = fs::space(destination.parent_path());
    constexpr uint64_t reserve = 256ull * 1024 * 1024;
    if (capacity.available != UINTMAX_MAX &&
        (capacity.available <= reserve || expected_bytes > capacity.available - reserve))
        fail("Not enough free disk space to extract the archive");
    for (const auto &item : items) {
        if (err != MZ_OK) fail("ZIP directory changed during extraction");
        if (included(item)) {
            if (item.encrypted && password.empty()) fail("Password required");
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
                if (output.handle == INVALID_HANDLE_VALUE) fail("Cannot create extracted file: " + item.name);
                if (mz_zip_reader_entry_open(reader.value) != MZ_OK) fail("Cannot open ZIP entry: " + item.name);
                char buffer[65536];
                uint64_t written = 0;
                int count;
                while ((count = mz_zip_reader_entry_read(reader.value, buffer, sizeof(buffer))) > 0) {
                    if ((uint64_t)count > item.size - written) fail("ZIP entry expanded beyond its declared size: " + item.name);
                    DWORD actual = 0;
                    if (!WriteFile(output.handle, buffer, (DWORD)count, &actual, nullptr) || actual != (DWORD)count)
                        fail("Cannot write extracted file: " + item.name);
                    written += (uint64_t)count;
                }
                if (count < 0 || written != item.size || mz_zip_reader_entry_close(reader.value) != MZ_OK)
                    fail("Cannot extract or verify ZIP entry: " + item.name);
            }
            ++done;
            emit("{\"type\":\"progress\",\"done\":" + std::to_string(done) + ",\"total\":" + std::to_string(total) + "}");
        }
        err = mz_zip_reader_goto_next_entry(reader.value);
    }
    emit("{\"type\":\"result\",\"count\":" + std::to_string(done) + "}");
}

static void create(const fs::path &destination, const std::vector<fs::path> &sources,
                   const std::string &password, int64_t volume_size) {
    if (sources.empty() || fs::exists(destination)) fail("Archive target already exists or has no input");
    void *writer = mz_zip_writer_create();
    if (!writer) fail("Cannot initialize ZIP writer");
    try {
        mz_zip_writer_set_follow_links(writer, 0);
        mz_zip_writer_set_store_links(writer, 0);
        mz_zip_writer_set_compress_level(writer, 6);
        if (!password.empty()) { mz_zip_writer_set_password(writer, password.c_str()); mz_zip_writer_set_aes(writer, 1); }
        if (mz_zip_writer_open_file(writer, utf8(destination.wstring()).c_str(), volume_size, 0) != MZ_OK) fail("Cannot create ZIP file");
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
                if (err != MZ_OK) fail("Cannot add source to ZIP: " + utf8(item.wstring()));
            };
            if (fs::is_directory(path)) {
                add(path, path.parent_path());
                for (const auto &entry : fs::recursive_directory_iterator(path, fs::directory_options::none)) add(entry.path(), path.parent_path());
            } else add(path, path.parent_path());
            emit("{\"type\":\"progress\",\"done\":" + std::to_string(i + 1) + ",\"total\":" + std::to_string(sources.size()) + "}");
        }
        if (mz_zip_writer_close(writer) != MZ_OK) fail("Cannot finish ZIP file");
        mz_zip_writer_delete(&writer);
        emit("{\"type\":\"result\",\"count\":" + std::to_string(sources.size()) + "}");
    } catch (...) { mz_zip_writer_delete(&writer); throw; }
}

static int archive_format(const std::wstring &path) {
    std::wstring name = fs::path(path).filename().wstring();
    std::transform(name.begin(), name.end(), name.begin(), [](wchar_t ch) { return std::towlower(ch); });
    if (name.ends_with(L".zip")) return 0;
    if (name.ends_with(L".7z") || name.ends_with(L".7z.001")) return 7;
    if (name.ends_with(L".rar") || name.ends_with(L".r00")) return 3;
    fail("Unsupported archive format");
}

int wmain(int argc, wchar_t **argv) {
    _setmode(_fileno(stdout), _O_BINARY);
    try {
        if (argc < 3) fail("Usage: One.Archive.exe list|create|extract|test ...");
        const std::wstring mode = argv[1];
        std::string password = password_from_stdin();
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
                seven_create(argv[2], paths, password);
            } else if (format == 0) create(argv[2], paths, password, volume_size);
            else fail("RAR creation is not supported");
        } else if (mode == L"list" || mode == L"extract" || mode == L"test") {
            int encoding = 0;
            if (mode == L"list") {
                if (argc != 6) fail("List requires offset, limit and encoding");
                encoding = _wtoi(argv[5]);
            } else if (mode == L"extract") {
                if (argc != 6) fail("Extract requires destination, selected indexes and encoding");
                encoding = _wtoi(argv[5]);
            } else if (argc == 4) encoding = _wtoi(argv[3]);
            int format = archive_format(argv[2]);
            if (mode == L"list") {
                size_t offset = std::stoull(argv[3]), limit = std::min<size_t>(500, std::stoull(argv[4]));
                if (format == 0) { Reader reader(argv[2], encoding); list(reader, offset, limit); }
                else seven_list(argv[2], offset, limit, password, format);
            } else if (mode == L"test") {
                if (format == 0) { Reader reader(argv[2], encoding); test(reader, entries(reader), password); }
                else seven_test(argv[2], password, format);
            } else {
                std::set<size_t> selected;
                std::wstring text = argv[4], part;
                for (wchar_t c : text + L',') {
                    if (c == L',') { if (!part.empty()) { selected.insert(std::stoull(part)); part.clear(); } }
                    else if (c >= L'0' && c <= L'9') part += c;
                    else fail("Invalid selected entry index");
                }
                if (format == 0) {
                    Reader reader(argv[2], encoding); auto items = entries(reader);
                    if (!selected.empty() && *selected.rbegin() >= items.size()) fail("Selected entry index is out of range");
                    extract(reader, items, argv[3], selected, password);
                } else seven_extract(argv[2], argv[3], selected, password, format);
            }
        } else fail("Unknown archive operation");
        return 0;
    } catch (const std::exception &error) {
        emit("{\"type\":\"error\",\"message\":" + json(error.what()) + "}");
        return 2;
    }
}
