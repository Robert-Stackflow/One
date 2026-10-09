#pragma once
#include "zip-common.h"
#include "extract-limits.h"
// Accumulate the effective selection without copying the directory or names.
class ExtractionRisk final {
    uint64_t count=0,bytes=0,compressed=0,nested_count=0;
    bool only_tar=true;
public:
    void add(const std::string &name,bool directory,uint64_t size,uint64_t packed);
    void check()const;
};
