#pragma once
#include "common.h"
bool zip_create_parallel(const fs::path &destination,const std::vector<fs::path> &sources,const std::string &password,int64_t volume_size);
