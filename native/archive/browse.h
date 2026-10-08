#pragma once
#include "zip-common.h"
#include <map>
#include <algorithm>

// Browser-only folder rows never change the archive's original entry indexes.
struct BrowseQuery {std::string directory,search;bool flat=false;};
std::string read_bounded_text(size_t &budget);
std::vector<std::string> read_selected_folders();
BrowseQuery read_browse_query();
std::string archive_path(std::string value);
bool in_folder(const std::string &path,const std::string &folder);

template<class Entries> void expand_folders(const Entries &entries,std::set<size_t> &selected,const std::vector<std::string> &folders){
    if(folders.empty())return;
    std::set<std::string> wanted(folders.begin(),folders.end()),found;
    for(const auto &entry:entries){auto path=archive_path(entry.name);if(entry.directory&&!path.ends_with('/'))path+='/';
        for(size_t end=path.find('/');end!=std::string::npos;end=path.find('/',end+1)){
            auto ancestor=path.substr(0,end+1);if(wanted.contains(ancestor)){selected.insert(entry.index);found.insert(ancestor);}
        }
    }
    if(found.size()!=wanted.size())fail("Selected folder no longer exists; reopen the archive");
}

class BrowseRows {
    BrowseQuery query;std::wstring foldedSearch;
    std::map<std::string,Entry> rows;
public:
    explicit BrowseRows(const BrowseQuery &value);
    void add(const Entry &entry);
    void emit_page(size_t total,const std::string &comment,const std::string &revision,bool editable,size_t offset,size_t limit);
};
void seven_browse(const fs::path &source,size_t offset,size_t limit,const std::string &password,int format,const BrowseQuery &query);
