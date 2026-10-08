#pragma once
#include <cstdint>
#include <filesystem>
#include <set>
#include <string>
#include <vector>

namespace fs = std::filesystem;

std::string utf8(const std::wstring &value);
std::wstring wide(const std::string &value);
std::string json(const std::string &value);
void emit(const std::string &line);
[[noreturn]] void fail(const std::string &message);
bool safe_entry(const std::string &name, bool directory);
fs::path entry_path(const std::string &name);

void seven_list(const fs::path &source, size_t offset, size_t limit, const std::string &password, int format);
void seven_test(const fs::path &source, const std::string &password, int format);
void seven_extract(const fs::path &source, const fs::path &destination,
                   const std::set<size_t> &selected, const std::string &password, int format);
void seven_create(const fs::path &destination, const std::vector<fs::path> &sources,
                  const std::string &password, int format);
