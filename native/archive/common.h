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
int archive_acknowledgement();
void extract_publish(const fs::path &stage,const fs::path &parent,const fs::path &recovery,const std::string &conflict,const fs::path &archive={});
void extract_recover(const fs::path &parent,const fs::path &recovery);
void extract_cleanup(const fs::path &parent,const fs::path &recovery);
void recover_volume_update(const fs::path &parent,const fs::path &recovery);
void cleanup_volume_update(const fs::path &parent,const fs::path &recovery);
class ArchiveError final:public std::runtime_error {
public:
    std::string code;
    ArchiveError(const std::string &message,const std::string &category):std::runtime_error(message),code(category){}
};
[[noreturn]] void fail(const std::string &message,const std::string &code="archive");
bool safe_entry(const std::string &name, bool directory);
fs::path entry_path(const std::string &name);

void seven_list(const fs::path &source, size_t offset, size_t limit, const std::string &password, int format);
void seven_details(const fs::path &source,size_t index,const std::string &password,int format);
void seven_test(const fs::path &source, const std::string &password, int format,bool result=true);
size_t seven_extract(const fs::path &source, const fs::path &destination,
                   const std::set<size_t> &selected, const std::string &password, int format, bool result = true,
                   const std::vector<std::string> &folders = {});
void seven_create(const fs::path &destination, const std::vector<fs::path> &sources,
                  const std::string &password, int format);
void seven_update(const fs::path &source,const fs::path &temporary,const fs::path &backup,
                  const std::string &revision,const std::string &password,bool prepare=false,bool group=false);
void update_volume_stage(const fs::path &source,const fs::path &stage,int encoding,
                         const std::string &revision,const std::string &password,int format,const fs::path &recovery={});
void publish_volume_update(const fs::path &source,const fs::path &prepared,const fs::path &recovery,int encoding,
                           const std::string &revision,const std::string &prepared_revision,const std::string &password,int format);
