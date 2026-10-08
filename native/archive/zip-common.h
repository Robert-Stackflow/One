#pragma once
#include "common.h"

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
std::string zip_revision(const fs::path &source);
void zip_update(const fs::path &source, const fs::path &temporary, const fs::path &backup,
                int encoding, const std::string &revision, const std::string &password);
