#pragma once
#include <cstdint>
#include <filesystem>
#include <set>
#include <string>
#include <vector>
#include <stdexcept>

namespace fs = std::filesystem;

std::string utf8(const std::wstring &value);
std::wstring wide(const std::string &value);
std::string json(const std::string &value);
void emit(const std::string &line);
bool archive_cancelled();
void extract_publish(const fs::path &stage,const fs::path &parent,const fs::path &recovery,const std::string &conflict,const fs::path &archive={});
class ArchiveError final:public std::runtime_error {
public:
    std::string code;
    ArchiveError(const std::string &message,const std::string &category):std::runtime_error(message),code(category){}
};
[[noreturn]] void fail(const std::string &message,const std::string &code="archive");
bool safe_entry(const std::string &name, bool directory);
fs::path entry_path(const std::string &name);

void seven_list(const fs::path &source, size_t offset, size_t limit, const std::string &password, int format);
void seven_test(const fs::path &source, const std::string &password, int format);
void seven_extract(const fs::path &source, const fs::path &destination,
                   const std::set<size_t> &selected, const std::string &password, int format, bool result = true,
                   const std::vector<std::string> &folders = {});
void seven_create(const fs::path &destination, const std::vector<fs::path> &sources,
                  const std::string &password, int format);
