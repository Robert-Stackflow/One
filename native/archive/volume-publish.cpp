#include <windows.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <map>
#include <memory>
#include <zlib.h>
#include "zip-common.h"
#include "update-common.h"
#include "heartbeat.h"

// Private second half of update-stage. The public editing routes stay closed
// until restart recovery and the owning host's lifecycle are connected.
namespace {
using archive_update::File;
using archive_update::stamp;
std::wstring key(const fs::path &path){return archive_update::key(utf8(path.wstring()));}
DWORD attributes(const fs::path &path){
    const auto value=GetFileAttributesW(path.c_str());
    if(value==INVALID_FILE_ATTRIBUTES&&GetLastError()!=ERROR_FILE_NOT_FOUND&&GetLastError()!=ERROR_PATH_NOT_FOUND)
        fail("Cannot inspect volume transaction path","safety");
    return value;
}
void normalized(const fs::path &path){
    if(!path.is_absolute()||path!=path.lexically_normal()||path.filename().empty())fail("Volume paths must be absolute and normalized","safety");
    for(const auto &part:path.relative_path())if(part.wstring().find(L':')!=std::wstring::npos)fail("Invalid volume path","safety");
}
bool private_name(const fs::path &path,const std::wstring &prefix){
    const auto name=path.filename().wstring();if(name.size()!=prefix.size()+36||!name.starts_with(prefix))return false;
    for(size_t i=0;i<36;++i){const auto c=name[i+prefix.size()];const bool separator=i==8||i==13||i==18||i==23;
        if(separator?c!=L'-':!((c>=L'0'&&c<=L'9')||(c>=L'a'&&c<=L'f')))return false;}
    return true;
}
struct Directory {
    HANDLE handle=INVALID_HANDLE_VALUE;
    explicit Directory(const fs::path &path){
        handle=CreateFileW(path.c_str(),FILE_READ_ATTRIBUTES,FILE_SHARE_READ,nullptr,OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
        BY_HANDLE_FILE_INFORMATION info{};
        if(handle==INVALID_HANDLE_VALUE||!GetFileInformationByHandle(handle,&info)||
           !(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)||(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)){
            if(handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);handle=INVALID_HANDLE_VALUE;
            fail("Cannot lock volume transaction directory","safety");
        }
    }
    ~Directory(){if(handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);}
    std::string identity()const{
        BY_HANDLE_FILE_INFORMATION info{};if(!GetFileInformationByHandle(handle,&info))fail("Cannot identify volume directory","safety");
        return std::to_string(info.dwVolumeSerialNumber)+":"+std::to_string(info.nFileIndexHigh)+":"+std::to_string(info.nFileIndexLow);
    }
};
struct Directories {
    std::map<std::wstring,std::unique_ptr<Directory>> held;
    void hold(const fs::path &path){if(!held.contains(key(path)))held.emplace(key(path),std::make_unique<Directory>(path));}
    void ancestors(const fs::path &path){auto current=path.root_path();hold(current);size_t depth=0;
        for(const auto &part:path.relative_path()){if(++depth>512)fail("Volume directory is too deep","safety");current/=part;hold(current);}}
    void release(const fs::path &path){held.erase(key(path));}
    std::string identity(const fs::path &path)const{return held.at(key(path))->identity();}
};
void unique_file(HANDLE handle){BY_HANDLE_FILE_INFORMATION info{};
    if(!GetFileInformationByHandle(handle,&info)||info.nNumberOfLinks!=1)fail("Volume is linked or unavailable","safety");}
void same(File &file,const std::string &expected){unique_file(file.handle);if(stamp(file.handle)!=expected)fail("Volume changed during transaction","safety");}
void move(File &file,const fs::path &destination){
    const auto name=destination.wstring();std::vector<unsigned char> bytes(sizeof(FILE_RENAME_INFO)+name.size()*sizeof(wchar_t));
    auto info=reinterpret_cast<FILE_RENAME_INFO*>(bytes.data());info->ReplaceIfExists=FALSE;info->RootDirectory=nullptr;
    info->FileNameLength=(DWORD)(name.size()*sizeof(wchar_t));std::memcpy(info->FileName,name.data(),info->FileNameLength);
    if(!SetFileInformationByHandle(file.handle,FileRenameInfo,info,(DWORD)bytes.size()))
        fail("Cannot move volume without overwriting (Windows error "+std::to_string(GetLastError())+"): "+utf8(destination.wstring()),"write");
}
void erase(HANDLE handle){FILE_DISPOSITION_INFO info{TRUE};if(!SetFileInformationByHandle(handle,FileDispositionInfo,&info,sizeof(info)))fail("Cannot remove volume recovery copy","write");}
bool cancelled(){
    DWORD available=0,read=0;unsigned char value=0;const auto input=GetStdHandle(STD_INPUT_HANDLE);
    // A queued early ACK is not cancellation. stdin is unbuffered in wmain.
    if(!PeekNamedPipe(input,&value,1,&read,&available,nullptr)||!available||read!=1||value!=2)return false;
    return ReadFile(input,&value,1,&read,nullptr)&&read==1&&value==2;
}
std::string test_point(const wchar_t *name){wchar_t mode[2]{},value[64]{};
    GetEnvironmentVariableW(L"ONE_TEST_MODE",mode,2);if(std::wstring(mode)!=L"1")return {};
    const auto size=GetEnvironmentVariableW(name,value,64);return size&&size<64?utf8(value):std::string{};
}
void crash_at(const std::string &point){static const auto selected=test_point(L"ONE_ARCHIVE_VOLUME_CRASH_POINT");
    if(selected==point){TerminateProcess(GetCurrentProcess(),77);ExitProcess(77);}}
void fault_at(const std::string &point){static const auto selected=test_point(L"ONE_ARCHIVE_VOLUME_FAIL_POINT");if(selected==point)fail("Injected volume transaction failure","write");}
struct Journal {
    HANDLE handle=INVALID_HANDLE_VALUE;uint64_t bytes=0,sequence=0;uLong checksum=0;std::string pending;bool broken=false;
    const std::string injected=test_point(L"ONE_ARCHIVE_VOLUME_JOURNAL_FAIL_AT_SEQUENCE");
    explicit Journal(const fs::path &path):handle(CreateFileW(path.c_str(),GENERIC_WRITE|DELETE,FILE_SHARE_READ,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr)){
        if(handle==INVALID_HANDLE_VALUE)fail("Cannot create volume recovery journal","write");}
    ~Journal(){if(handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);}
    void drain(){if(broken)fail("Volume journal write failed","write");if(pending.empty())return;DWORD written=0;
        if(!WriteFile(handle,pending.data(),(DWORD)pending.size(),&written,nullptr)||written!=pending.size()){broken=true;fail("Volume journal write failed","write");}pending.clear();}
    void append(const std::string &record){
        if(!injected.empty()&&std::to_string(sequence)==injected){broken=true;fail("Injected volume journal failure","write");}
        const auto data="{\"sequence\":"+std::to_string(sequence)+",\"record\":"+record;
        const auto next=crc32(checksum,reinterpret_cast<const Bytef*>(data.data()),(uInt)data.size());char hex[9]{};
        std::snprintf(hex,sizeof(hex),"%08lx",(unsigned long)next);const auto line=data+",\"crc32\":\""+hex+"\"}\n";
        if(line.size()>512*1024||bytes+line.size()>64ull*1024*1024)fail("Volume journal exceeds its limit","safety");
        if(broken)fail("Volume journal write failed","write");pending+=line;checksum=next;bytes+=line.size();++sequence;if(pending.size()>=64*1024)drain();
    }
    void flush(bool decision=false){drain();if(decision)fault_at("commit-flush");if(!FlushFileBuffers(handle)){broken=true;fail("Cannot flush volume journal","write");}}
    void remove(){erase(handle);CloseHandle(handle);handle=INVALID_HANDLE_VALUE;}
};
struct Snapshot {fs::path path;std::string stamp;};
std::vector<Snapshot> verify(const fs::path &primary,const std::string &revision,int encoding,const std::string &password,int format){
    expect_archive_revision(primary,revision);lock_archive_source(primary);
    if(format==0){Reader reader(primary.wstring(),encoding);const auto entries=zip_entries(reader);zip_preflight(reader,entries);zip_test(reader,entries,password,false);}
    else seven_test(primary,password,7,false);
    if(zip_revision(primary)!=revision)fail("Volume revision changed before publishing","safety");
    std::vector<Snapshot> result;for(const auto &member:archive_source_members(primary)){
        File file(member);unique_file(file.handle);result.push_back({member,stamp(file.handle)});}
    return result;
}
// Validate canonical contiguous member names independently of the engine.
// Unexpected numeric siblings, including obsolete tails, must not be silently
// treated as ours. Only old members proven by the original container are owned.
void family(const fs::path &primary,const std::vector<Snapshot> &members,int format,bool exact){
    if(members.empty()||members.size()>4096||key(members[0].path)!=key(primary))fail("Invalid volume family","safety");
    const auto filename=primary.filename().wstring(),folded=key(primary.filename());
    const auto prefix=format==0?folded.substr(0,folded.size()-4)+L".z":folded.substr(0,folded.size()-3);
    std::set<std::wstring> expected;
    for(size_t index=0;index<members.size();++index){
        fs::path canonical=primary;
        if(format==0&&index)canonical.replace_extension(std::wstring(L".z")+(index<10?L"0":L"")+std::to_wstring(index));
        if(format==7){auto number=std::to_wstring(index+1);if(number.size()<3)number.insert(0,3-number.size(),L'0');canonical=primary.parent_path()/(filename.substr(0,filename.size()-3)+number);}
        if(key(canonical)!=key(members[index].path)||members[index].path.parent_path()!=primary.parent_path()||!expected.insert(key(canonical)).second)
            fail("Noncanonical volume family","safety");
    }
    size_t visited=0;
    for(const auto &entry:fs::directory_iterator(primary.parent_path())){
        if(++visited>(exact?4096:1000000))fail("Volume directory exceeds inspection limit","safety");archive_activity();
        if(cancelled())fail("Volume publishing cancelled","cancelled");
        if(expected.erase(key(entry.path())))continue;
        const auto name=key(entry.path().filename());
        const bool numeric=name.starts_with(prefix)&&name.size()>prefix.size()&&
            std::all_of(name.begin()+prefix.size(),name.end(),[](wchar_t c){return c>=L'0'&&c<=L'9';});
        if(exact||numeric)fail("Volume family contains an unowned or unexpected member: "+utf8(entry.path().wstring()),"safety");
    }
    if(!expected.empty())fail("Volume family is incomplete","safety");
}
struct Item {
    fs::path source,target,backup;std::string source_stamp,target_stamp;
    std::unique_ptr<File> old_file,new_file;bool saved=false,moved=false;
};
// Preserve the primary archive's download mark on every resulting volume.
// Keep bytes local; do not log the URLs or reinterpret the user's ADS text.
std::string origin(const fs::path &primary){
    const auto path=fs::path(primary.wstring()+L":Zone.Identifier");
    HANDLE handle=CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
    if(handle==INVALID_HANDLE_VALUE){if(GetLastError()==ERROR_FILE_NOT_FOUND)return {};fail("Cannot preserve volume download mark","read");}
    struct Close {HANDLE value;~Close(){CloseHandle(value);}} close{handle};
    LARGE_INTEGER size{};if(!GetFileSizeEx(handle,&size)||size.QuadPart<0||size.QuadPart>4096)fail("Volume download mark exceeds limit","safety");
    std::string data((size_t)size.QuadPart,0);DWORD read=0;
    if(!ReadFile(handle,data.data(),(DWORD)data.size(),&read,nullptr)||read!=data.size())fail("Cannot read volume download mark","read");return data;
}
void preserve_origin(const fs::path &path,const std::string &data){
    if(data.empty())return;
    HANDLE handle=CreateFileW((path.wstring()+L":Zone.Identifier").c_str(),GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,
        nullptr,CREATE_NEW,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
    if(handle==INVALID_HANDLE_VALUE){if(GetLastError()==ERROR_FILE_EXISTS&&origin(path)==data)return;fail("Cannot preserve staged volume download mark","write");}
    struct Close {HANDLE value;~Close(){CloseHandle(value);}} close{handle};DWORD written=0;
    if(!WriteFile(handle,data.data(),(DWORD)data.size(),&written,nullptr)||written!=data.size()||!FlushFileBuffers(handle))fail("Cannot flush volume download mark","write");
}
void recovery_contents(const fs::path &directory,const std::vector<Item> &items){
    std::set<std::wstring> expected{key(directory/L"manifest.jsonl")};
    for(const auto &item:items)if(item.saved)expected.insert(key(item.backup));
    size_t count=0;for(const auto &entry:fs::directory_iterator(directory)){
        if(++count>4097||!expected.erase(key(entry.path())))fail("Volume recovery contains unknown content","safety");}
    if(!expected.empty())fail("Volume recovery copy is missing","safety");
}
}

void publish_volume_update(const fs::path &source,const fs::path &prepared,const fs::path &recovery,int encoding,
                           const std::string &revision,const std::string &prepared_revision,const std::string &password,int format){
    normalized(source);normalized(prepared);normalized(recovery);const auto parent=source.parent_path(),stage=prepared.parent_path();
    if((format!=0&&format!=7)||(format==0&&!key(source.filename()).ends_with(L".zip"))||
        (format==7&&!key(source.filename()).ends_with(L".7z.001"))||stage.parent_path()!=parent||recovery.parent_path()!=parent||
        !private_name(stage,L".one-update-")||!private_name(recovery,L".one-volume-recovery-")||
        key(source.filename())!=key(prepared.filename()))fail("Invalid volume publishing scope","safety");
    Directories dirs;dirs.ancestors(parent);dirs.hold(stage);
    if(attributes(recovery)!=INVALID_FILE_ATTRIBUTES)fail("Volume recovery directory already exists","safety");
    const auto old=verify(source,revision,encoding,password,format),next=verify(prepared,prepared_revision,encoding,password,format);
    if(format==0&&old.size()<2)fail("Volume publishing requires a split ZIP source","safety");
    family(source,old,format,false);family(prepared,next,format,true);
    const auto mark=origin(source);
    std::map<std::wstring,Item> planned;std::set<std::string> identities;
    auto remember=[&](const std::string &value){const auto first=value.find(':'),second=value.find(':',first+1),end=value.find(':',second+1);
        if(end==std::string::npos||!identities.insert(value.substr(0,end)).second)fail("Volume family aliases another transaction file","safety");};
    for(const auto &member:old){remember(member.stamp);auto &item=planned[key(member.path.filename())];item.target=member.path;item.target_stamp=member.stamp;}
    for(const auto &member:next){remember(member.stamp);auto &item=planned[key(member.path.filename())];item.source=member.path;item.source_stamp=member.stamp;
        if(item.target.empty())item.target=parent/member.path.filename();}
    std::vector<Item> items;items.reserve(planned.size());
    for(auto &[name,item]:planned){item.backup=recovery/(std::to_wstring(items.size())+L".original");items.push_back(std::move(item));}
    // Upgrade the complete verified families to delete-capable locks. Exact
    // stamps are checked across this unavoidable Windows lock handover.
    release_archive_source(source);release_archive_source(prepared);
    for(auto &item:items){
        if(!item.target_stamp.empty()){item.old_file=std::make_unique<File>(item.target,GENERIC_READ|DELETE,FILE_SHARE_READ);same(*item.old_file,item.target_stamp);}
        else if(attributes(item.target)!=INVALID_FILE_ATTRIBUTES)fail("New volume target already exists","safety");
        if(!item.source.empty()){item.new_file=std::make_unique<File>(item.source,GENERIC_READ|GENERIC_WRITE|DELETE,FILE_SHARE_READ);same(*item.new_file,item.source_stamp);}
    }
    family(source,old,format,false);family(prepared,next,format,true);
    for(auto &item:items)if(item.new_file){
        same(*item.new_file,item.source_stamp);
        preserve_origin(item.source,mark);
        unique_file(item.new_file->handle);
        // The publisher is an independent process: do not assume an earlier
        // helper's success alone proves every staged byte is on disk.
        if(!FlushFileBuffers(item.new_file->handle))fail("Cannot flush prepared volume before publishing","write");
        item.source_stamp=stamp(item.new_file->handle);
    }
    if(!CreateDirectoryW(recovery.c_str(),nullptr))fail("Cannot create new volume recovery directory","write");dirs.hold(recovery);
    std::unique_ptr<Journal> log;
    try{log=std::make_unique<Journal>(recovery/L"manifest.jsonl");}catch(...){dirs.release(recovery);RemoveDirectoryW(recovery.c_str());throw;}
    std::string failure;bool aborted=false,commit_attempted=false;size_t removed=0;for(const auto &item:items)if(!item.new_file)++removed;
    ULONGLONG last_flush=GetTickCount64();
    auto record=[&](const std::string &type,size_t index){log->append("{\"type\":"+json(type)+",\"index\":"+std::to_string(index)+"}");
        const auto now=GetTickCount64();if(now-last_flush>=250){log->flush();last_flush=now;}};
    auto check_cancel=[&]{if(cancelled()){aborted=true;fail("Volume publishing cancelled","cancelled");}};
    try{
        log->append("{\"type\":\"header\",\"version\":3,\"kind\":\"volume-update\",\"parent\":"+json(utf8(parent.wstring()))+
            ",\"stage\":"+json(utf8(stage.wstring()))+",\"recovery\":"+json(utf8(recovery.wstring()))+
            ",\"parentIdentity\":"+json(dirs.identity(parent))+",\"stageIdentity\":"+json(dirs.identity(stage))+
            ",\"recoveryIdentity\":"+json(dirs.identity(recovery))+",\"primary\":"+json(utf8(source.filename().wstring()))+
            ",\"format\":"+std::to_string(format)+",\"oldVolumes\":"+std::to_string(old.size())+",\"newVolumes\":"+std::to_string(next.size())+"}");
        for(size_t i=0;i<items.size();++i){check_cancel();const auto &item=items[i];
            log->append("{\"type\":\"item\",\"index\":"+std::to_string(i)+",\"source\":"+json(utf8(item.source.wstring()))+
                ",\"target\":"+json(utf8(item.target.wstring()))+",\"backup\":"+json(utf8(item.backup.wstring()))+
                ",\"sourceStamp\":"+json(item.source_stamp)+",\"targetStamp\":"+json(item.target_stamp)+"}");}
        log->append("{\"type\":\"prepared\",\"items\":"+std::to_string(items.size())+"}");log->flush();crash_at("prepared");fault_at("prepared");
        emit("{\"type\":\"ready\"}");const auto acknowledgement=std::fgetc(stdin);if(acknowledgement!=1){aborted=acknowledgement==2;fail("Volume update cancelled before publishing","cancelled");}
        // Sharing modes block content writes and renames, but Windows can still
        // add hard links. Recheck the ENTIRE locked plan after the handshake,
        // before moving any original, and again before the commit decision.
        for(auto &item:items){if(item.old_file)same(*item.old_file,item.target_stamp);if(item.new_file)same(*item.new_file,item.source_stamp);}
        // First preserve ALL old volumes, including obsolete tails. Only then
        // start publishing the new family. Never merge two archive generations.
        for(size_t i=0;i<items.size();++i){check_cancel();auto &item=items[i];if(!item.old_file)continue;
            same(*item.old_file,item.target_stamp);move(*item.old_file,item.backup);item.saved=true;
            record("backed-up",i);crash_at("backup:"+std::to_string(i));fault_at("backup:"+std::to_string(i));archive_activity();}
        size_t done=0;
        for(size_t i=0;i<items.size();++i){check_cancel();auto &item=items[i];if(!item.new_file)continue;
            same(*item.new_file,item.source_stamp);move(*item.new_file,item.target);item.moved=true;
            record("published",i);crash_at("published:"+std::to_string(i));fault_at("published:"+std::to_string(i));archive_activity();
            emit("{\"type\":\"progress\",\"done\":"+std::to_string(++done)+",\"total\":"+std::to_string(next.size())+"}");}
        check_cancel();fault_at("commit");
        for(auto &item:items){if(item.old_file)same(*item.old_file,item.target_stamp);if(item.new_file)same(*item.new_file,item.source_stamp);}
        std::vector<Snapshot> published;for(const auto &member:next)published.push_back({parent/member.path.filename(),member.stamp});
        family(source,published,format,false);
        // A failed commit write/flush can leave a complete decision on disk.
        // Its outcome is uncertain, so preserve BOTH generations for explicit
        // inspection instead of rolling back against a possibly durable commit.
        commit_attempted=true;
        log->append("{\"type\":\"committed\",\"count\":"+std::to_string(next.size())+",\"removed\":"+std::to_string(removed)+"}");log->flush(true);
    }catch(const std::exception &error){failure=error.what();const auto *archive=dynamic_cast<const ArchiveError*>(&error);if(archive&&archive->code=="cancelled")aborted=true;}
    if(!failure.empty()){
        if(commit_attempted)fail(failure+"; volume commit decision is uncertain; recovery retained at "+utf8(recovery.wstring()),"recovery");
        bool complete=true;try{log->append("{\"type\":\"rollback-started\"}");log->flush();}catch(...){complete=false;}
        // Restore in two phases, reversing the order above. If an unknown file
        // blocks a path, keep every remaining copy and the durable plan.
        for(auto it=items.rbegin();it!=items.rend();++it)try{if(it->moved){same(*it->new_file,it->source_stamp);move(*it->new_file,it->source);it->moved=false;}}catch(...){complete=false;}
        for(auto it=items.rbegin();it!=items.rend();++it)try{if(it->saved){same(*it->old_file,it->target_stamp);move(*it->old_file,it->target);it->saved=false;}}catch(...){complete=false;}
        if(complete)try{recovery_contents(recovery,items);log->append("{\"type\":\"rolled-back\"}");log->flush();log->remove();dirs.release(recovery);if(!RemoveDirectoryW(recovery.c_str()))complete=false;}catch(...){complete=false;}
        if(!complete)fail(failure+"; volume recovery retained at "+utf8(recovery.wstring()),"recovery");
        if(aborted){emit("{\"type\":\"result\",\"count\":0,\"committed\":false,\"cancelled\":true}");return;}fail(failure,"write");
    }
    // A flushed commit is final. Cleanup failure must report a successful save
    // with pending cleanup, not roll it back or suggest it is safe to retry.
    crash_at("committed");bool cleanup_pending=false;
    try{
        recovery_contents(recovery,items);
        for(const auto &item:items)if(item.new_file)same(*item.new_file,item.source_stamp);
        else if(attributes(item.target)!=INVALID_FILE_ATTRIBUTES)fail("Obsolete volume target reappeared","safety");
        for(size_t i=0;i<items.size();++i){auto &item=items[i];if(!item.saved)continue;
            fault_at("cleanup:"+std::to_string(i));same(*item.old_file,item.target_stamp);erase(item.old_file->handle);item.old_file->close();item.saved=false;
            crash_at("cleanup:"+std::to_string(i));archive_activity();}
        recovery_contents(recovery,items);log->remove();dirs.release(recovery);if(!RemoveDirectoryW(recovery.c_str()))fail("Cannot remove empty volume recovery directory","write");
    }catch(...){cleanup_pending=true;}
    emit("{\"type\":\"result\",\"count\":"+std::to_string(next.size())+",\"volumes\":"+std::to_string(next.size())+
        ",\"removedVolumes\":"+std::to_string(removed)+",\"committed\":true,\"cleanupPending\":"+(cleanup_pending?"true":"false")+
        ",\"recovery\":"+json(cleanup_pending?utf8(recovery.wstring()):"")+"}");
}
