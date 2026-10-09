#pragma once
#include "browse.h"
inline constexpr int egg_format=0x101;
void egg_list(const fs::path&,size_t,size_t,int,const BrowseQuery* =nullptr);
void egg_details(const fs::path&,size_t,int);
std::vector<Entry> egg_entries(const fs::path&,int);
void egg_test(const fs::path&,const std::string&,int,bool =true);
size_t egg_extract(const fs::path&,const fs::path&,const std::set<size_t>&,
                   const std::string&,int,bool,const std::vector<std::string>& ={});
