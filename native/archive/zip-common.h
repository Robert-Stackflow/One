#pragma once
#include "common.h"
#include <utility>

struct Reader {
    void *value = nullptr;
    int encoding = 0;
    explicit Reader(const std::wstring &path, int encoding);
    ~Reader();
    Reader(const Reader &) = delete;
    Reader &operator=(const Reader &) = delete;
};
struct Entry { size_t index; std::string name; bool directory; uint64_t size; uint64_t compressed; bool encrypted; };
std::vector<Entry> zip_entries(Reader &reader);
std::string zip_name(Reader &reader, const char *name, uint16_t flag,
                    const uint8_t *extra = nullptr, uint16_t extra_size = 0, uint16_t unicode_tag = 0x7075);
std::string zip_comment(Reader &reader, const char *comment);
void zip_preflight(Reader &reader, const std::vector<Entry> &items);
void zip_test(Reader &reader, const std::vector<Entry> &items, const std::string &password, bool result = true);
size_t zip_extract(Reader &reader, const std::vector<Entry> &items, const fs::path &destination,
                 const std::set<size_t> &selected, const std::string &password, bool result = true);
std::vector<Entry> seven_drag_entries(const fs::path &source, const std::string &password, int format);
void archive_drag(const fs::path &source, const fs::path &stage, int encoding,
                  const std::string &revision, const std::string &password, int format, bool testing, uintptr_t owner = 0,
                  const fs::path &lease = {}, bool folders = false);
std::string zip_revision(const fs::path &source);
std::string archive_revision_from_stamps(const std::vector<std::pair<fs::path,std::string>> &members);
void lock_archive_source(const fs::path &source);
void expect_archive_revision(const fs::path &source,const std::string &expected);
void bind_archive_members(const fs::path &source,const std::vector<fs::path> &members);
std::vector<fs::path> archive_source_members(const fs::path &source);
void release_archive_source(const fs::path &source);
void zip_update(const fs::path &source, const fs::path &temporary, const fs::path &backup,
                int encoding, const std::string &revision, const std::string &password,bool prepare=false,bool group=false);
