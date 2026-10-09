#include <windows.h>
#include <cstdio>
#include "browse.h"
#include "heartbeat.h"

static uint32_t input(){unsigned char bytes[4];if(std::fread(bytes,1,4,stdin)!=4)fail("Incomplete archive browser request");return uint32_t(bytes[0])|(uint32_t(bytes[1])<<8)|(uint32_t(bytes[2])<<16)|(uint32_t(bytes[3])<<24);}
std::string read_bounded_text(size_t &budget){const auto size=input();if(size>131072||size>budget)fail("Archive browser request exceeds its limit");budget-=size;std::string text(size,'\0');if(size&&std::fread(text.data(),1,size,stdin)!=size)fail("Incomplete archive browser text");if(text.find('\0')!=std::string::npos)fail("Archive browser text contains a null character");wide(text);return text;}
std::string archive_path(std::string value){std::replace(value.begin(),value.end(),'\\','/');return value;}
bool in_folder(const std::string &path,const std::string &folder){return path.size()>folder.size()&&path.starts_with(folder);}
static std::string folder(std::string value){value=archive_path(value);if(value.empty()||!safe_entry(value,true))fail("Invalid archive folder","safety");if(!value.ends_with('/'))value+='/';return value;}
std::vector<std::string> read_selected_folders(){const auto count=input();if(count>10000)fail("Too many selected folders");size_t budget=4*1024*1024;std::vector<std::string> result;result.reserve(count);for(uint32_t i=0;i<count;i++)result.push_back(folder(read_bounded_text(budget)));return result;}
BrowseQuery read_browse_query(){size_t budget=132096;BrowseQuery query;query.directory=read_bounded_text(budget);query.search=read_bounded_text(budget);if(!query.directory.empty())query.directory=folder(query.directory);if(query.search.size()>1024)fail("Archive search exceeds its limit");auto mode=input();if(mode>1)fail("Invalid archive browser mode");query.flat=mode==1;return query;}
static std::wstring fold(const std::string &value){auto text=wide(value);if(text.empty())return {};int size=LCMapStringEx(LOCALE_NAME_INVARIANT,LCMAP_LOWERCASE,text.data(),(int)text.size(),nullptr,0,nullptr,nullptr,0);if(size<=0)fail("Cannot normalize archive search");std::wstring result(size,L'\0');if(LCMapStringEx(LOCALE_NAME_INVARIANT,LCMAP_LOWERCASE,text.data(),(int)text.size(),result.data(),size,nullptr,nullptr,0)!=size)fail("Cannot normalize archive search");return result;}
BrowseRows::BrowseRows(const BrowseQuery &value):query(value),foldedSearch(fold(value.search)){}
void BrowseRows::add(Entry entry){
    auto path=archive_path(entry.name);
    // Raw list mode can display malformed names, but path navigation may not
    // interpret traversal or device paths as legitimate folders.
    if(!safe_entry(path,entry.directory))fail("Archive contains an unsafe browser path: "+entry.name,"safety");
    if(entry.directory&&!path.ends_with('/'))path+='/';
    if(!query.directory.empty()&&!in_folder(path,query.directory))return;
    if(!foldedSearch.empty()&&fold(path).find(foldedSearch)==std::wstring::npos)return;
    if(query.flat||!foldedSearch.empty()){
        // Keep duplicate original indexes; common names need no second copy.
        auto key=path==entry.name?std::string{}:std::move(path);
        recursiveRows.push_back({std::move(entry),std::move(key)});return;
    }
    const auto rest=path.substr(query.directory.size());const auto slash=rest.find('/');
    if(slash==std::string::npos){rows.try_emplace(std::move(path),std::move(entry));return;}
    const auto name=query.directory+rest.substr(0,slash+1);
    const bool actual=entry.directory&&(slash==rest.size()-1);
    if(actual)rows[name]=std::move(entry);
    else if(!rows.contains(name))rows[name]={size_t(-1),name,true,0,0,false};
}
static void emit_browse_entry(const Entry &entry){
    emit("{\"type\":\"entry\",\"index\":"+(entry.index==size_t(-1)?"-1":std::to_string(entry.index))+",\"name\":"+json(entry.name)+",\"directory\":"+(entry.directory?"true":"false")+",\"size\":"+std::to_string(entry.size)+",\"compressed\":"+std::to_string(entry.compressed)+",\"encrypted\":"+(entry.encrypted?"true":"false")+(entry.size_known?"":",\"sizeKnown\":false")+",\"implicit\":"+(entry.index==size_t(-1)?"true":"false")+"}");
}
void BrowseRows::emit_page(size_t total,const std::string &comment,const std::string &revision,bool editable,size_t offset,size_t limit){
    const bool recursive=query.flat||!foldedSearch.empty();
    const auto matched=recursive?recursiveRows.size():rows.size();
    if(recursive){
        size_t comparisons=0;
        auto order=[&](const Row &left,const Row &right){
            if((++comparisons&4095)==0)archive_activity();
            if(left.entry.directory!=right.entry.directory)return left.entry.directory;
            const auto &a=path_of(left),&b=path_of(right);
            if(a!=b)return a<b;
            // Preserve the legacy lexical original-index tie-break.
            return std::to_string(left.entry.index)<std::to_string(right.entry.index);
        };
        const auto begin=std::min<size_t>(offset,matched),end=begin+std::min<size_t>(limit,matched-begin);
        if(begin<matched)std::nth_element(recursiveRows.begin(),recursiveRows.begin()+begin,recursiveRows.end(),order);
        if(end<matched)std::nth_element(recursiveRows.begin()+begin,recursiveRows.begin()+end,recursiveRows.end(),order);
        std::sort(recursiveRows.begin()+begin,recursiveRows.begin()+end,order);
    }
    emit("{\"type\":\"meta\",\"total\":"+std::to_string(total)+",\"matched\":"+std::to_string(matched)+",\"comment\":"+json(comment)+",\"revision\":"+json(revision)+",\"editable\":"+(editable?"true":"false")+"}");
    if(recursive){
        const auto begin=std::min<size_t>(offset,matched),end=begin+std::min<size_t>(limit,matched-begin);
        for(size_t i=begin;i<end;i++)emit_browse_entry(recursiveRows[i].entry);
    }else{
        // Deduplicate folder-view paths without accumulating descendants.
        size_t position=0,sent=0;for(bool directories:{true,false})for(const auto &[key,entry]:rows){
            if(entry.directory!=directories)continue;if(position++<offset)continue;if(sent++>=limit)return;
            emit_browse_entry(entry);
        }
    }
}
