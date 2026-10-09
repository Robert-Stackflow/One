#pragma once
#include "browse.h"
// Private dispatcher value, outside the 7-Zip handler id range.
inline constexpr int alz_format=0x100;
void alz_list(const fs::path&,size_t,size_t,int,const BrowseQuery* =nullptr);
void alz_details(const fs::path&,size_t,int);
std::vector<Entry> alz_entries(const fs::path&,int);
void alz_test(const fs::path&,const std::string&,int,bool=true);
size_t alz_extract(const fs::path&,const fs::path&,const std::set<size_t>&,
                   const std::string&,int,bool,const std::vector<std::string>& ={});
