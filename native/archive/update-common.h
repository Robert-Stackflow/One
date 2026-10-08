#pragma once
#include <windows.h>
#include <cstdio>
#include "common.h"

namespace archive_update {
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
std::string stamp(HANDLE handle);
std::wstring key(const std::string &name);
std::string canonical(std::string name,bool directory);
struct Plan {
    std::vector<unsigned char> bytes;
    size_t cursor = 0;
    Plan() {
        unsigned char header[4];
        if (std::fread(header, 1, 4, stdin) != 4) fail("Missing archive update plan");
        uint32_t size = uint32_t(header[0]) | (uint32_t(header[1]) << 8) |
                        (uint32_t(header[2]) << 16) | (uint32_t(header[3]) << 24);
        if (size < 4 || size > 4 * 1024 * 1024) fail("Archive update plan exceeds limits");
        bytes.resize(size);
        if (std::fread(bytes.data(), 1, size, stdin) != size) fail("Incomplete archive update plan");
    }
    uint32_t number() {
        if (bytes.size() - cursor < 4) fail("Incomplete archive update plan");
        uint32_t value = uint32_t(bytes[cursor]) | (uint32_t(bytes[cursor+1]) << 8) |
                         (uint32_t(bytes[cursor+2]) << 16) | (uint32_t(bytes[cursor+3]) << 24);
        cursor += 4; return value;
    }
    std::string text(size_t limit = 65535) {
        uint32_t size = number();
        if (size > limit || size > bytes.size() - cursor) fail("Invalid archive update string");
        std::string value(reinterpret_cast<const char *>(bytes.data() + cursor), size);
        cursor += size;
        if (value.find('\0') != std::string::npos) fail("Archive update contains a null character");
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
void check_tree(const std::vector<OutputEntry> &nodes);
void check_source(const fs::path &source);
void apply_plan(Plan &plan,std::vector<OutputEntry> &nodes,const fs::path &source,bool encrypted,std::string *comment);
void check_staging(const fs::path &source,const fs::path &temporary,const fs::path &backup);
void commit(File &original,const fs::path &source,const fs::path &temporary,const fs::path &backup,const std::string &revision,size_t count);
}
