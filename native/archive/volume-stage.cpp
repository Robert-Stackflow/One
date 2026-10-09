#include <windows.h>
#include <algorithm>
#include <map>
#include <memory>
#include "zip-common.h"
#include "update-common.h"
#include "heartbeat.h"

namespace {
using namespace archive_update;
struct Directory {
    HANDLE handle=INVALID_HANDLE_VALUE;
    explicit Directory(const fs::path &path){
        handle=CreateFileW(path.c_str(),FILE_READ_ATTRIBUTES,FILE_SHARE_READ,nullptr,OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
        BY_HANDLE_FILE_INFORMATION info{};
        if(handle==INVALID_HANDLE_VALUE||!GetFileInformationByHandle(handle,&info)||
           !(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)||(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)){
            if(handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);handle=INVALID_HANDLE_VALUE;
            fail("Cannot lock volume staging directory","safety");
        }
    }
    ~Directory(){if(handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);}
};
std::wstring path_key(const fs::path &path){return key(utf8(path.wstring()));}
struct Stage {
    std::vector<std::unique_ptr<Directory>> locks;
    Stage(const fs::path &source,const fs::path &stage){
        if(!source.is_absolute()||source!=source.lexically_normal()||!stage.is_absolute()||stage!=stage.lexically_normal()||
            stage.parent_path()!=source.parent_path())fail("Volume stage must be a new sibling directory","safety");
        const auto name=stage.filename().wstring();
        if(name.size()!=48||!name.starts_with(L".one-update-"))fail("Invalid volume staging name","safety");
        for(size_t i=0;i<36;++i){const auto c=name[i+12];const bool separator=i==8||i==13||i==18||i==23;
            if(separator?c!=L'-':!((c>=L'0'&&c<=L'9')||(c>=L'a'&&c<=L'f')))fail("Invalid volume staging name","safety");}
        auto current=stage.root_path();locks.push_back(std::make_unique<Directory>(current));
        for(const auto &part:stage.parent_path().relative_path()){current/=part;locks.push_back(std::make_unique<Directory>(current));}
        check_source(source);
        if(!CreateDirectoryW(stage.c_str(),nullptr))fail("Volume staging directory already exists or cannot be created","write");
        locks.push_back(std::make_unique<Directory>(stage));
        // Failure/termination leaves only this new directory for the host's
        // bounded cleanup; no destructor recursively removes untrusted files.
    }
};
void exact_members(const fs::path &stage,const std::vector<fs::path> &members,size_t maximum=4096){
    if(members.empty()||members.size()>maximum)fail("Invalid staged volume count","safety");
    std::set<std::wstring> expected;for(const auto &member:members){
        if(member.parent_path()!=stage||!expected.insert(path_key(member)).second)fail("Invalid staged volume path","safety");
    }
    size_t count=0;
    for(const auto &entry:fs::directory_iterator(stage)){
        if(++count>maximum||!expected.erase(path_key(entry.path())))fail("Volume stage contains an unexpected file","safety");
        File checked(entry.path());BY_HANDLE_FILE_INFORMATION info{};
        if(!GetFileInformationByHandle(checked.handle,&info)||info.nNumberOfLinks!=1)fail("Staged volume is linked or unavailable","safety");
    }
    if(!expected.empty())fail("Staged volume is missing","safety");
}
void flush_file(const fs::path &path){File file(path,GENERIC_WRITE,FILE_SHARE_READ);if(!FlushFileBuffers(file.handle))fail("Cannot flush staged volume","write");}
std::vector<fs::path> zip_files(const fs::path &temporary){
    std::map<unsigned,fs::path> parts;
    bool terminal=false;size_t count=0;
    const auto stem=path_key(temporary.stem());
    for(const auto &entry:fs::directory_iterator(temporary.parent_path())){
        if(++count>4096)fail("ZIP volume count exceeds limits","safety");
        if(path_key(entry.path())==path_key(temporary)){terminal=true;continue;}
        if(path_key(entry.path().stem())!=stem)fail("Unexpected ZIP staging file","safety");
        const auto extension=path_key(entry.path().extension());
        if(extension.size()<4||extension[0]!=L'.'||extension[1]!=L'z')fail("Unexpected ZIP staging file","safety");
        unsigned number=0;for(size_t i=2;i<extension.size();++i){const auto c=extension[i];if(c<L'0'||c>L'9'||number>4095/10)fail("Invalid ZIP staged volume","safety");number=number*10+unsigned(c-L'0');}
        const auto canonical=std::wstring(L".z")+(number<10?L"0":L"")+std::to_wstring(number);
        if(!number||number>4095||extension!=canonical||!parts.emplace(number,entry.path()).second)fail("Invalid ZIP staged volume","safety");
    }
    if(!terminal)fail("Staged ZIP terminal volume is missing","safety");
    std::vector<fs::path> members{temporary};unsigned next=1;
    for(const auto &[number,path]:parts){if(number!=next++)fail("Staged ZIP volume gap","safety");members.push_back(path);}
    exact_members(temporary.parent_path(),members);return members;
}
// Splitting a 7Z is a sequential copy, independent of extraction limits.
// Recheck quota-aware free space on bounded byte/time intervals, not each I/O.
class Space {
    fs::path directory;uint64_t remaining,since=0;ULONGLONG checked=0;
public:
    Space(const fs::path &directory,uint64_t bytes):directory(directory),remaining(bytes){refresh();}
    void refresh(){ULARGE_INTEGER available{};constexpr uint64_t reserve=256ull*1024*1024;
        if(!GetDiskFreeSpaceExW(directory.c_str(),&available,nullptr,nullptr)||available.QuadPart<reserve||remaining>available.QuadPart-reserve)
            fail("Not enough free disk space to stage 7Z volumes","write");since=0;checked=GetTickCount64();}
    void wrote(uint64_t bytes){if(bytes>remaining)fail("7Z split exceeded its input size","safety");remaining-=bytes;since+=bytes;if(since>=8*1024*1024||GetTickCount64()-checked>=250)refresh();}
    void finish(){if(remaining)fail("7Z split is incomplete","write");refresh();}
};
fs::path split_seven(const fs::path &temporary,uint64_t limit,const std::string &password){
    flush_file(temporary);
    File input(temporary,GENERIC_READ|DELETE,FILE_SHARE_READ);LARGE_INTEGER size{};
    if(!GetFileSizeEx(input.handle,&size)||size.QuadPart<=0)fail("Cannot inspect prepared 7Z","read");
    const auto bytes=uint64_t(size.QuadPart),count=1+(bytes-1)/limit;
    if(count>4096)fail("7Z staged volume count exceeds limits","safety");
    Space space(temporary.parent_path(),bytes);std::vector<fs::path> members;uint64_t copied=0;char buffer[65536];
    const auto input_stamp=stamp(input.handle);
    for(uint64_t index=1;index<=count;++index){
        auto suffix=std::to_wstring(index);if(suffix.size()<3)suffix.insert(0,3-suffix.size(),L'0');
        const auto target=fs::path(temporary.wstring()+L"."+suffix);members.push_back(target);
        struct Output {HANDLE value;explicit Output(const fs::path &path):value(CreateFileW(path.c_str(),GENERIC_WRITE,FILE_SHARE_READ,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr)){}
            ~Output(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}} output(target);
        if(output.value==INVALID_HANDLE_VALUE)fail("Cannot create a new 7Z staged volume","write");
        uint64_t remaining=(std::min)(limit,bytes-copied);
        while(remaining){if(archive_cancelled())fail("Archive task cancelled","cancelled");
            const auto wanted=DWORD(std::min<uint64_t>(sizeof(buffer),remaining));DWORD read=0,written=0;
            if(!ReadFile(input.handle,buffer,wanted,&read,nullptr)||read!=wanted)fail("Cannot read prepared 7Z","read");
            if(!WriteFile(output.value,buffer,read,&written,nullptr)||written!=read)fail("Cannot write staged 7Z volume","write");
            remaining-=read;copied+=read;space.wrote(read);archive_activity();
        }
        if(!FlushFileBuffers(output.value))fail("Cannot flush staged 7Z volume","write");
        emit("{\"type\":\"progress\",\"done\":"+std::to_string(index)+",\"total\":"+std::to_string(count)+"}");
    }
    space.finish();if(stamp(input.handle)!=input_stamp)fail("Prepared 7Z changed during splitting","safety");
    lock_archive_source(members[0]);seven_test(members[0],password,7,false);
    auto all=members;all.push_back(temporary);exact_members(temporary.parent_path(),all,4097);
    FILE_DISPOSITION_INFO deleted{TRUE};
    if(!SetFileInformationByHandle(input.handle,FileDispositionInfo,&deleted,sizeof(deleted)))fail("Cannot remove verified intermediate 7Z","write");
    input.close();return members[0];
}
}

namespace archive_update {
uint64_t source_volume_bytes(const fs::path &source){
    const auto members=archive_source_members(source);if(members.size()==1&&!path_key(source.filename()).ends_with(L".7z.001"))return 0;
    const bool zip=key(utf8(source.extension().wstring()))==L".zip";
    // ZIP does not store its configured split limit; record boundaries can
    // make physical disks slightly smaller. This is an observed size only.
    uint64_t bytes=zip?0:fs::file_size(members[0]);
    if(zip)for(size_t i=1;i<members.size();++i)bytes=std::max<uint64_t>(bytes,fs::file_size(members[i]));
    if(!bytes||bytes>64ull*1024*1024*1024)fail("Source volume size is outside the supported range","safety");return bytes;
}
void flush_prepared_zip(const fs::path &temporary){for(const auto &member:zip_files(temporary))flush_file(member);}
void finish_volume_preparation(const fs::path &source,const fs::path &temporary,const std::string &revision,
                               size_t count,const std::string &password,int format){
    auto limit=source_volume_bytes(source);if(!limit)fail("Volume staging requires a split source","safety");
    // Small ZIP disks and a one-part .7z.001 do not reveal their configured
    // limit. Keep the public minimum rather than creating tiny output parts.
    if(format==0||archive_source_members(source).size()==1)limit=std::max<uint64_t>(limit,1024*1024);
    const auto primary=format==7?split_seven(temporary,limit,password):temporary;
    const auto members=archive_source_members(primary);exact_members(temporary.parent_path(),members);
    if(zip_revision(source)!=revision)fail("Archive volume set changed during staging","safety");
    emit("{\"type\":\"result\",\"count\":"+std::to_string(count)+",\"staged\":true,\"path\":"+json(utf8(primary.wstring()))+
        ",\"volumeBytes\":"+std::to_string(limit)+",\"inputVolumes\":"+std::to_string(archive_source_members(source).size())+
        ",\"volumes\":"+std::to_string(members.size())+",\"revision\":"+json(zip_revision(primary))+"}");
}
}

void update_volume_stage(const fs::path &source,const fs::path &stage,int encoding,
                         const std::string &revision,const std::string &password,int format){
    if((format!=0&&format!=7)||(format==0&&!revision.starts_with("v2:"))||revision.empty()||revision.size()>256)fail("Volume staging requires a split ZIP or 7Z source","safety");
    Stage guard(source,stage);auto name=source.filename().wstring();
    if(format==7){if(!path_key(source.filename()).ends_with(L".7z.001"))fail("Volume staging requires the first 7Z volume","safety");name.resize(name.size()-4);}
    const auto temporary=stage/name,backup=stage/L".unused-original";
    if(format==0)zip_update(source,temporary,backup,encoding,revision,password,true,true);
    else seven_update(source,temporary,backup,revision,password,true,true);
}
