#include <windows.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <cwctype>
#include <map>
#include <memory>
#include <string_view>
#include <zlib.h>
#include "common.h"
#include "heartbeat.h"

// Recovery is a separate, explicit operation. It only moves verified files;
// neither originals nor displaced new contents are deleted by this operation.
namespace {
struct Locked {
    HANDLE value=INVALID_HANDLE_VALUE;
    Locked(const fs::path &path,bool directory,DWORD access=FILE_READ_ATTRIBUTES){
        value=CreateFileW(path.c_str(),access,FILE_SHARE_READ,nullptr,OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT|(directory?FILE_FLAG_BACKUP_SEMANTICS:0),nullptr);
        if(value==INVALID_HANDLE_VALUE)fail("Cannot lock recovery path: "+utf8(path.wstring()),"safety");
        BY_HANDLE_FILE_INFORMATION info{};
        if(!GetFileInformationByHandle(value,&info)||(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||
            bool(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=directory||(!directory&&info.nNumberOfLinks!=1)){
            CloseHandle(value);value=INVALID_HANDLE_VALUE;fail("Recovery path contains a link or incompatible file","safety");
        }
    }
    ~Locked(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
    Locked(const Locked&)=delete;
};
std::string stamp(HANDLE handle,bool identity=false){
    BY_HANDLE_FILE_INFORMATION info{};if(!GetFileInformationByHandle(handle,&info))fail("Cannot verify recovery file identity","safety");
    const auto id=std::to_string(info.dwVolumeSerialNumber)+":"+std::to_string(info.nFileIndexHigh)+":"+std::to_string(info.nFileIndexLow);
    return identity?id:id+":"+std::to_string(info.nFileSizeHigh)+":"+std::to_string(info.nFileSizeLow)+":"+
        std::to_string(info.ftLastWriteTime.dwHighDateTime)+":"+std::to_string(info.ftLastWriteTime.dwLowDateTime);
}
std::wstring key(const fs::path &path){auto text=path.wstring();std::transform(text.begin(),text.end(),text.begin(),[](wchar_t c){return c==L'/'?L'\\':std::towlower(c);});return text;}
DWORD attributes(const fs::path &path){auto value=GetFileAttributesW(path.c_str());if(value==INVALID_FILE_ATTRIBUTES&&GetLastError()!=ERROR_FILE_NOT_FOUND&&GetLastError()!=ERROR_PATH_NOT_FOUND)fail("Cannot inspect recovery path","safety");return value;}
struct Directories {
    std::map<std::wstring,std::unique_ptr<Locked>> held;
    void hold(const fs::path &path){auto name=key(path);if(!held.contains(name))held.emplace(name,std::make_unique<Locked>(path,true));}
    // Lock each ancestor before opening a descendant; never traverse a junction.
    bool ancestors(const fs::path &path,bool missing=false){
        if(!path.is_absolute()||path!=path.lexically_normal())fail("Recovery path must be absolute and normalized","safety");
        auto current=path.root_path();hold(current);
        for(const auto &part:path.relative_path()){current/=part;if(attributes(current)==INVALID_FILE_ATTRIBUTES){if(missing)return false;fail("Recovery ancestor is missing","safety");}hold(current);}return true;
    }
};
bool cancelled(){DWORD available=0,read=0;unsigned char byte=0;const auto input=GetStdHandle(STD_INPUT_HANDLE);return PeekNamedPipe(input,&byte,1,&read,&available,nullptr)&&available&&read==1&&byte==2;}
void check_cancel(){if(cancelled())fail("Recovery stopped; verified files already moved remain recoverable","cancelled");}
void move(HANDLE handle,const fs::path &destination){
    const auto name=destination.wstring();std::vector<unsigned char> bytes(sizeof(FILE_RENAME_INFO)+name.size()*sizeof(wchar_t));
    auto info=reinterpret_cast<FILE_RENAME_INFO*>(bytes.data());info->ReplaceIfExists=FALSE;info->RootDirectory=nullptr;
    info->FileNameLength=(DWORD)(name.size()*sizeof(wchar_t));std::memcpy(info->FileName,name.data(),info->FileNameLength);
    if(!SetFileInformationByHandle(handle,FileRenameInfo,info,(DWORD)bytes.size()))fail("Recovery destination appeared or file cannot be moved (Windows error "+std::to_string(GetLastError())+")","safety");
    archive_activity();
}
void crash(const std::string &point){
    wchar_t mode[2]{},value[80]{};GetEnvironmentVariableW(L"ONE_TEST_MODE",mode,2);if(std::wstring(mode)!=L"1")return;
    GetEnvironmentVariableW(L"ONE_ARCHIVE_RECOVER_CRASH_POINT",value,80);
    if(utf8(value)==point){TerminateProcess(GetCurrentProcess(),77);ExitProcess(77);}
}
bool uuid(const std::wstring &value){if(value.size()!=36)return false;for(size_t i=0;i<value.size();++i){if(i==8||i==13||i==18||i==23){if(value[i]!=L'-')return false;}else if(!((value[i]>=L'0'&&value[i]<=L'9')||(value[i]>=L'a'&&value[i]<=L'f')))return false;}return true;}
bool valid_stamp(const std::string &text,unsigned parts){
    unsigned count=0;uint64_t value=0;bool digit=false;
    for(char c:text+':'){if(c==':'){if(!digit||value>0xffffffffull)return false;++count;value=0;digit=false;}else if(c>='0'&&c<='9'){digit=true;value=value*10+unsigned(c-'0');if(value>0xffffffffull)return false;}else return false;}
    return count==parts;
}
bool inside(const fs::path &root,const fs::path &path,bool directory=false){
    if(!path.is_absolute()||path!=path.lexically_normal())return false;
    auto prefix=key(root);if(!prefix.ends_with(L'\\'))prefix+=L'\\';const auto name=key(path);
    return name.starts_with(prefix)&&safe_entry(utf8(path.wstring().substr(prefix.size())),directory);
}
// Strict parser for the canonical JSON written by the native publisher. It
// accepts no arrays, arbitrary nesting, duplicate fields or noncanonical escapes.
struct Cursor {
    std::string_view text;size_t at=0;
    void take(std::string_view value){if(text.substr(at,value.size())!=value)fail("Recovery journal format is invalid","safety");at+=value.size();}
    std::string string(){
        const auto start=at;take("\"");std::string value;bool closed=false;
        while(at<text.size()){
            char c=text[at++];if(c=='\"'){closed=true;break;}
            if(c=='\\'){if(at==text.size())break;c=text[at++];if(c=='\"'||c=='\\')value+=c;else if(c=='u'){
                take("00");unsigned byte=0;for(int i=0;i<2;++i){if(at==text.size())fail("Recovery journal escape is incomplete","safety");const auto digit=text[at++];if(digit>='0'&&digit<='9')byte=byte*16+digit-'0';else if(digit>='a'&&digit<='f')byte=byte*16+digit-'a'+10;else fail("Recovery journal escape is invalid","safety");}value+=char(byte);
            }else fail("Recovery journal escape is invalid","safety");}else{if((unsigned char)c<32)fail("Recovery journal contains control characters","safety");value+=c;}
        }
        if(!closed||json(value)!=text.substr(start,at-start))fail("Recovery journal string is not canonical","safety");wide(value);return value;
    }
    uint64_t number(){const auto start=at;uint64_t value=0;while(at<text.size()&&text[at]>='0'&&text[at]<='9'){value=value*10+text[at++]-'0';if(value>3000010)fail("Recovery journal number exceeds limit","safety");}if(at==start||std::to_string(value)!=text.substr(start,at-start))fail("Recovery journal number is invalid","safety");return value;}
    void field(const char *name){take(",");take(json(name));take(":");}
    std::string text_field(const char *name){field(name);return string();}
    uint64_t count_field(const char *name){field(name);return number();}
    bool boolean(){if(text.substr(at,4)=="true"){at+=4;return true;}take("false");return false;}
    bool bool_field(const char *name){field(name);return boolean();}
    void end(){if(at!=text.size())fail("Recovery journal has unexpected fields","safety");}
};
struct Item {size_t index;fs::path target,backup,displaced;bool directory,existing,created=false,published=false;std::string source_stamp,target_stamp,directory_identity;};
struct Plan {std::vector<Item> items;uint64_t skipped=0;bool prepared=false,committed=false,rollback=false,rolled_back=false;std::string parent_identity,recovery_identity;};
Plan read_plan(Locked &manifest,const fs::path &parent,const fs::path &recovery,const fs::path &stage){
    LARGE_INTEGER size{};if(!GetFileSizeEx(manifest.value,&size)||size.QuadPart<=0||size.QuadPart>512ll*1024*1024)fail("Recovery journal exceeds size limit","safety");
    Plan plan;uLong crc=0;uint64_t sequence=0,published=0,read=0;std::string pending;bool header=false;std::set<std::wstring> targets;
    auto line=[&](const std::string &text){
        if(text.size()>512*1024)fail("Recovery journal line exceeds size limit","safety");Cursor cur{text};cur.take("{\"sequence\":");if(cur.number()!=sequence++||sequence>3000010)fail("Recovery journal sequence is invalid","safety");cur.take(",\"record\":{\"type\":");const auto type=cur.string();
        if(type=="header"){
            if(header||sequence!=1||cur.count_field("version")!=2)fail("Recovery journal version is invalid","safety");
            const auto p=fs::path(wide(cur.text_field("parent"))),s=fs::path(wide(cur.text_field("stage"))),r=fs::path(wide(cur.text_field("recovery")));
            if(key(p)!=key(parent)||key(s)!=key(stage)||key(r)!=key(recovery))fail("Recovery journal scope differs from the explicit request","safety");
            plan.parent_identity=cur.text_field("parentIdentity");const auto stage_id=cur.text_field("stageIdentity");plan.recovery_identity=cur.text_field("recoveryIdentity");const auto conflict=cur.text_field("conflict");
            if(!valid_stamp(plan.parent_identity,3)||!valid_stamp(stage_id,3)||!valid_stamp(plan.recovery_identity,3)||(conflict!="rename"&&conflict!="skip"&&conflict!="replace"))fail("Recovery journal identities are invalid","safety");header=true;
        }else{
            if(!header)fail("Recovery journal header is missing","safety");
            if(type=="item"){
                if(plan.prepared||plan.rollback||plan.items.size()>=1000000)fail("Recovery journal plan order is invalid","safety");
                Item item{};item.index=(size_t)cur.count_field("index");const auto source=fs::path(wide(cur.text_field("source")));item.target=wide(cur.text_field("target"));item.backup=wide(cur.text_field("backup"));item.directory=cur.bool_field("directory");item.existing=cur.bool_field("existing");item.source_stamp=cur.text_field("sourceStamp");item.target_stamp=cur.text_field("targetStamp");item.displaced=recovery/(std::to_wstring(item.index)+L".displaced");
                if(item.index>=1000000||(!plan.items.empty()&&item.index<=plan.items.back().index)||!inside(stage,source,item.directory)||!inside(parent,item.target,item.directory)||inside(recovery,item.target,item.directory)||key(item.target)==key(recovery)||inside(stage,item.target,item.directory)||key(item.target)==key(stage)||key(item.backup)!=key(recovery/(std::to_wstring(item.index)+L".original"))||
                    (item.directory?(!item.source_stamp.empty()||!item.target_stamp.empty()):(!valid_stamp(item.source_stamp,7)||(item.existing?(!valid_stamp(item.target_stamp,7)||item.source_stamp==item.target_stamp):!item.target_stamp.empty())))||!targets.emplace(key(item.target)).second)fail("Recovery journal contains an invalid or duplicate target","safety");
                plan.items.push_back(std::move(item));
            }else if(type=="prepared"){
                if(plan.prepared||plan.rollback||cur.count_field("items")!=plan.items.size())fail("Recovery journal prepared plan is invalid","safety");plan.skipped=cur.count_field("skipped");if(plan.items.size()+plan.skipped>1000000)fail("Recovery journal plan exceeds entry limit","safety");plan.prepared=true;
            }else if(type=="directory-created"||type=="published"){
                if(!plan.prepared||plan.rollback||plan.committed)fail("Recovery journal progress order is invalid","safety");const auto index=cur.count_field("index");auto it=std::lower_bound(plan.items.begin(),plan.items.end(),index,[](const Item &item,uint64_t wanted){return item.index<wanted;});
                if(it==plan.items.end()||it->index!=index)fail("Recovery journal refers to an unknown item","safety");
                if(type=="directory-created"){it->directory_identity=cur.text_field("identity");if(!it->directory||it->existing||it->created||!valid_stamp(it->directory_identity,3))fail("Recovery journal directory progress is invalid","safety");it->created=true;}
                else{if(it->published||(it->directory&&!it->existing&&!it->created))fail("Recovery journal publication is invalid","safety");it->published=true;++published;}
            }else if(type=="committed"){
                if(!plan.prepared||plan.rollback||plan.committed||cur.count_field("count")!=plan.items.size()||published!=plan.items.size()||cur.count_field("skipped")!=plan.skipped)fail("Recovery journal completion is invalid","safety");plan.committed=true;
            }else if(type=="rollback-started"){
                if(plan.rollback)fail("Recovery journal rollback order is invalid","safety");plan.rollback=true;
            }else if(type=="rolled-back"){
                if(!plan.rollback||plan.rolled_back)fail("Recovery journal rollback completion is invalid","safety");plan.rolled_back=true;
            }else fail("Recovery journal contains an unknown record","safety");
        }
        cur.take("}");const auto prefix=cur.at;const auto checksum=cur.text_field("crc32");cur.take("}");cur.end();
        crc=crc32(crc,reinterpret_cast<const Bytef*>(text.data()),(uInt)prefix);char expected[9]{};std::snprintf(expected,sizeof(expected),"%08lx",(unsigned long)crc);if(checksum!=expected)fail("Recovery journal checksum is invalid","safety");
    };
    char buffer[64*1024];DWORD got=0;
    while(ReadFile(manifest.value,buffer,sizeof(buffer),&got,nullptr)&&got){
        check_cancel();read+=got;if(read>uint64_t(size.QuadPart))fail("Recovery journal changed during reading","safety");archive_activity();pending.append(buffer,got);size_t start=0,end;
        while((end=pending.find('\n',start))!=std::string::npos){line(pending.substr(start,end-start));start=end+1;}pending.erase(0,start);if(pending.size()>512*1024)fail("Recovery journal line exceeds size limit","safety");
    }
    if(read!=uint64_t(size.QuadPart)||!pending.empty()||!header||!plan.prepared)fail("Recovery journal is truncated or has no complete plan","safety");return plan;
}
std::string file_stamp(const fs::path &path){const auto present=attributes(path);archive_activity();if(present==INVALID_FILE_ATTRIBUTES)return {};Locked file(path,false);return stamp(file.value);}
struct State {std::string target,backup,displaced;};
State inspect(const Item &item,Directories &dirs){
    State state;if(item.directory){if(dirs.ancestors(item.target,true)&&item.created&&stamp(dirs.held.at(key(item.target))->value,true)!=item.directory_identity)fail("Created recovery target directory changed; files were retained","safety");return state;}
    const auto exists=dirs.ancestors(item.target.parent_path(),true);if(exists)state.target=file_stamp(item.target);
    state.backup=file_stamp(item.backup);state.displaced=file_stamp(item.displaced);
    if(!state.backup.empty()&&(!item.existing||state.backup!=item.target_stamp))fail("Recovery original copy changed; files were retained","safety");
    if(!state.displaced.empty()&&state.displaced!=item.source_stamp)fail("Recovery displaced file changed; files were retained","safety");
    if(!state.target.empty()&&state.target!=item.source_stamp&&(!item.existing||state.target!=item.target_stamp))fail("Target was modified after extraction; files were retained: "+utf8(item.target.wstring()),"safety");
    if(state.target==item.source_stamp&&!state.displaced.empty())fail("Both target and displaced file exist; files were retained","safety");
    if(item.existing){
        if(state.target==item.target_stamp&&!state.backup.empty())fail("Both original target and backup exist; files were retained","safety");
        if(state.target!=item.target_stamp&&state.backup.empty())fail("Original recovery copy is missing; target was retained","safety");
    }
    if(!exists&&!state.backup.empty())fail("Original target directory is missing; recovery copy was retained","safety");return state;
}
}

void extract_recover(const fs::path &parent,const fs::path &recovery){
    const auto name=recovery.filename().wstring();if(!name.starts_with(L".one-recovery-")||!uuid(name.substr(14))||recovery.parent_path()!=parent)fail("Invalid explicit recovery scope","safety");
    Directories dirs;dirs.ancestors(parent);dirs.hold(recovery);
    // A publisher/second restorer cannot acquire the same manifest while this
    // handle is held, and no writer can change the plan after validation.
    Locked manifest(recovery/L"manifest.jsonl",false,GENERIC_READ|DELETE);
    const auto original_stamp=stamp(manifest.value);const auto stage=parent/(L".one-extract-"+name.substr(14));auto plan=read_plan(manifest,parent,recovery,stage);
    if(plan.committed&&!plan.rollback)fail("Extraction was committed; use explicit backup cleanup instead of rollback","safety");
    if(plan.parent_identity!=stamp(dirs.held.at(key(parent))->value,true)||plan.recovery_identity!=stamp(dirs.held.at(key(recovery))->value,true))fail("Recovery directory identity changed","safety");
    // Whole-plan validation catches ordinary conflicts before the first move.
    // Each mutation then rechecks under its own exclusive file handle.
    for(const auto &item:plan.items){check_cancel();inspect(item,dirs);}
    if(stamp(manifest.value)!=original_stamp)fail("Recovery journal changed","safety");
    emit("{\"type\":\"ready\"}");if(std::fgetc(stdin)!=1)fail("Recovery cancelled before moving files","cancelled");
    size_t restored=0,displaced=0,done=0;ULONGLONG last=0;
    for(const auto &item:plan.items){
        check_cancel();if(item.directory){++done;continue;}const auto state=inspect(item,dirs);
        if(state.target==item.source_stamp){
            Locked current(item.target,false,GENERIC_READ|DELETE);if(stamp(current.value)!=item.source_stamp)fail("Target changed before recovery; retained","safety");
            move(current.value,item.displaced);++displaced;crash("displaced:"+std::to_string(item.index));
        }
        if(!state.backup.empty()){
            Locked original(item.backup,false,GENERIC_READ|DELETE);if(stamp(original.value)!=item.target_stamp)fail("Original copy changed before recovery; retained","safety");
            move(original.value,item.target);++restored;crash("restored:"+std::to_string(item.index));
        }
        ++done;const auto now=GetTickCount64();if(!last||now-last>=100||done==plan.items.size()){emit("{\"type\":\"progress\",\"done\":"+std::to_string(done)+",\"total\":"+std::to_string(plan.items.size())+"}");last=now;}
    }
    // The immutable original journal and displaced contents deliberately remain.
    // Re-running is safe from the current identities, without a second write log
    // whose torn tail could prevent completing a previously interrupted restore.
    emit("{\"type\":\"result\",\"count\":"+std::to_string(restored)+",\"displaced\":"+std::to_string(displaced)+",\"retained\":true,\"cancelled\":false}");
}
