#include "recovery-common.h"
#include "stage-ownership.h"
#include <bcrypt.h>
#include <limits>

// Private version 4 staging inspection/cleanup. No original archive is opened
// for writing, and no authority is inferred from directory names alone.
namespace {
using namespace archive_recovery;
class Digest {
    BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;
    std::vector<unsigned char> object;
public:
    Digest(){try{ULONG size=0,read=0;
        if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0||
           BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&size),sizeof(size),&read,0)<0||size>65536)fail("Cannot initialize staging inspection digest","resource");
        object.resize(size);if(BCryptCreateHash(algorithm,&hash,object.data(),size,nullptr,0,0)<0)fail("Cannot initialize staging inspection digest","resource");
    }catch(...){close();throw;}}
    ~Digest(){close();}
    Digest(const Digest&)=delete;
    void close(){if(hash){BCryptDestroyHash(hash);hash=nullptr;}if(algorithm){BCryptCloseAlgorithmProvider(algorithm,0);algorithm=nullptr;}}
    void bytes(const char *value,size_t count){if(count>0xffffffffu||BCryptHashData(hash,reinterpret_cast<PUCHAR>(const_cast<char*>(value)),(ULONG)count,0)<0)fail("Cannot hash staging inspection","resource");}
    void field(const std::string &value){const auto length=std::to_string(value.size())+":";bytes(length.data(),length.size());bytes(value.data(),value.size());}
    std::string finish(){unsigned char value[32]{};if(BCryptFinishHash(hash,value,sizeof(value),0)<0)fail("Cannot finish staging inspection digest","resource");
        std::string result;const char hex[]="0123456789abcdef";for(auto byte:value){result+=hex[byte>>4];result+=hex[byte&15];}return result;}
};
bool private_path(const fs::path &path,const fs::path &parent,const std::wstring &prefix){
    return path.is_absolute()&&path==path.lexically_normal()&&key(path.parent_path())==key(parent)&&
        path.filename().wstring().starts_with(prefix)&&uuid(path.filename().wstring().substr(prefix.size()));
}
void scope(const fs::path &source,const fs::path &stage,const fs::path &recovery){
    if(!source.is_absolute()||source!=source.lexically_normal()||source.wstring().find(L':',2)!=std::wstring::npos||
       !safe_entry(utf8(source.filename().wstring()),false)||
       (!key(source).ends_with(L".zip")&&!key(source).ends_with(L".7z.001"))||
       !private_path(stage,source.parent_path(),L".one-update-")||!private_path(recovery,source.parent_path(),L".one-volume-recovery-"))
        fail("Invalid explicit staging recovery scope","safety");
}
bool numbered(const std::wstring &value,unsigned maximum,unsigned width){
    if(value.empty()||value.size()>4)return false;unsigned number=0;
    for(auto c:value){if(c<L'0'||c>L'9')return false;number=number*10+unsigned(c-L'0');}
    auto canonical=std::to_wstring(number);if(canonical.size()<width)canonical.insert(0,width-canonical.size(),L'0');
    return number&&number<=maximum&&value==canonical;
}
bool canonical_name(const fs::path &source,const std::string &value){
    const fs::path name=wide(value);if(!safe_entry(value,false)||name!=name.filename())return false;
    const auto primary=key(source.filename()),actual=key(name);
    if(primary.ends_with(L".zip"))return actual==primary||(key(name.stem())==key(source.stem())&&key(name.extension()).starts_with(L".z")&&numbered(key(name.extension()).substr(2),4095,2));
    const auto base=primary.substr(0,primary.size()-4);
    return actual==base||(actual.starts_with(base+L".")&&numbered(actual.substr(base.size()+1),4096,3));
}
std::string identity(const std::string &fingerprint){size_t end=0;for(int i=0;i<3;++i){end=fingerprint.find(':',end);if(end==std::string::npos)return fingerprint;++end;}return fingerprint.substr(0,end-1);}
bool revision_valid(const std::string &value){return value.starts_with("v2:")?value.size()==67&&value.find_first_not_of("0123456789abcdef",3)==std::string::npos:valid_stamp(value,7);}
struct Item {std::string name,id,snapshot;bool snapshotted=false,pending=false;};
struct Plan {
    std::string parent_id,stage_id,recovery_id,digest,revision;
    std::vector<Item> items;bool sealed=false;size_t snapshots=0;
    uint64_t bytes=0;size_t sequence=0;uLong crc=0;bool handoff=false;
};
Plan read_plan(Locked &manifest,const fs::path &source,const fs::path &stage,const fs::path &recovery){
    LARGE_INTEGER size{};if(!GetFileSizeEx(manifest.value,&size)||size.QuadPart<=0||size.QuadPart>64ll*1024*1024)fail("Staging journal is empty or exceeds limits","safety");
    Plan plan;Digest digest;uLong crc=0;size_t sequence=0;uint64_t read=0;bool header=false,snapshot_phase=false;
    std::set<std::wstring> names;std::set<std::string> ids;std::string pending;
    auto line=[&](const std::string &text){
        if(text.size()>512*1024)fail("Staging journal line exceeds limits","safety");
        Cursor cur{text};cur.take("{\"sequence\":");if(cur.number()!=sequence++||sequence>8200)fail("Staging journal sequence is invalid","safety");
        cur.take(",\"record\":{\"type\":");const auto type=cur.string();
        if(type=="header"){
            if(header||sequence!=1||cur.count_field("version")!=4||cur.text_field("kind")!="volume-stage")fail("Staging journal version is invalid","safety");
            const fs::path parent=wide(cur.text_field("parent")),recorded_stage=wide(cur.text_field("stage")),recorded_recovery=wide(cur.text_field("recovery"));
            if(parent!=parent.lexically_normal()||recorded_stage!=recorded_stage.lexically_normal()||recorded_recovery!=recorded_recovery.lexically_normal()||
               key(parent)!=key(source.parent_path())||key(recorded_stage)!=key(stage)||key(recorded_recovery)!=key(recovery))fail("Staging journal differs from explicit scope","safety");
            plan.parent_id=cur.text_field("parentIdentity");plan.stage_id=cur.text_field("stageIdentity");plan.recovery_id=cur.text_field("recoveryIdentity");
            const auto primary=cur.text_field("primary"),revision=cur.text_field("revision");
            plan.revision=revision;
            if(!valid_stamp(plan.parent_id,3)||!valid_stamp(plan.stage_id,3)||!valid_stamp(plan.recovery_id,3)||
               plan.parent_id==plan.stage_id||plan.parent_id==plan.recovery_id||plan.stage_id==plan.recovery_id||
               key(fs::path(wide(primary)))!=key(source.filename())||!safe_entry(primary,false)||fs::path(wide(primary))!=fs::path(wide(primary)).filename()||!revision_valid(revision))fail("Staging journal header is invalid","safety");
            header=true;
        }else{
            if(!header||plan.handoff)fail("Staging journal state order is invalid","safety");
            if(type=="handoff-created"){
                Item item;item.name=cur.text_field("name");item.id=cur.text_field("identity");item.pending=true;
                if(!plan.sealed||item.name!=".manifest.pending"||!valid_stamp(item.id,3)||!ids.insert(item.id).second||item.id==plan.parent_id||item.id==plan.stage_id||item.id==plan.recovery_id)
                    fail("Staging handoff identity is invalid","safety");
                plan.items.push_back(std::move(item));plan.handoff=true;
            }else if(plan.sealed)fail("Staging journal state order is invalid","safety");
            else if(type=="created"){
                if(snapshot_phase||plan.items.size()>=4097||cur.count_field("index")!=plan.items.size())fail("Staging creation order is invalid","safety");
                Item item;item.name=cur.text_field("name");item.id=cur.text_field("identity");
                if(!canonical_name(source,item.name)||!valid_stamp(item.id,3)||!names.insert(key(fs::path(wide(item.name)))).second||!ids.insert(item.id).second||
                   item.id==plan.parent_id||item.id==plan.stage_id||item.id==plan.recovery_id)fail("Staging creation identity or name is invalid","safety");
                plan.items.push_back(std::move(item));
            }else if(type=="snapshot"){
                snapshot_phase=true;const auto index=cur.count_field("index");if(index!=plan.snapshots||index>=plan.items.size())fail("Staging snapshot order is invalid","safety");
                auto &item=plan.items[(size_t)index];item.snapshot=cur.text_field("stamp");item.snapshotted=true;++plan.snapshots;
                if(!item.snapshot.empty()&&(!valid_stamp(item.snapshot,7)||identity(item.snapshot)!=item.id))fail("Staging snapshot differs from its creation identity","safety");
                // Only the intermediate .7z is intentionally retired by staging.
                if(item.snapshot.empty()&&(!key(source).ends_with(L".7z.001")||key(fs::path(wide(item.name)))!=key(source.filename()).substr(0,key(source.filename()).size()-4)))
                    fail("Staging snapshot retired a result volume","safety");
            }else if(type=="sealed"){
                const auto count=cur.count_field("items"),files=cur.count_field("files");size_t present=0;for(const auto &item:plan.items)if(!item.snapshot.empty())++present;
                if(count!=plan.items.size()||plan.snapshots!=plan.items.size()||files!=present||!files)fail("Staging completion marker is invalid","safety");plan.sealed=true;
            }else fail("Staging journal contains an unknown record","safety");
        }
        cur.take("}");const auto prefix=cur.at;const auto checksum=cur.text_field("crc32");cur.take("}");cur.end();
        crc=crc32(crc,reinterpret_cast<const Bytef*>(text.data()),(uInt)prefix);char expected[9]{};std::snprintf(expected,sizeof(expected),"%08lx",(unsigned long)crc);
        if(checksum!=expected)fail("Staging journal checksum is invalid","safety");
    };
    char buffer[64*1024];DWORD got=0;
    while(true){check_cancel();if(!ReadFile(manifest.value,buffer,sizeof(buffer),&got,nullptr))fail("Cannot read staging journal","read");if(!got)break;
        archive_activity();read+=got;if(read>uint64_t(size.QuadPart))fail("Staging journal changed while reading","safety");digest.bytes(buffer,got);pending.append(buffer,got);
        size_t start=0,end;while((end=pending.find('\n',start))!=std::string::npos){line(pending.substr(start,end-start));start=end+1;}pending.erase(0,start);
        if(pending.size()>512*1024)fail("Staging journal line exceeds limits","safety");
    }
    if(read!=uint64_t(size.QuadPart)||!pending.empty()||!header)fail("Staging journal is truncated or incomplete","safety");
    plan.digest=digest.finish();plan.bytes=read;plan.sequence=sequence;plan.crc=crc;return plan;
}
struct File {
    fs::path path;std::unique_ptr<Locked> handle;std::string fingerprint;
    File(const fs::path &path,const Item &item,bool cleanup):path(path){
        if(attributes(path)!=INVALID_FILE_ATTRIBUTES){handle=std::make_unique<Locked>(path,false,GENERIC_READ|(cleanup?DELETE:0));fingerprint=stamp(handle->value);
            if(identity(fingerprint)!=item.id||(item.snapshotted&&(item.snapshot.empty()||fingerprint!=item.snapshot)))fail("Staged file was replaced or changed after its recorded snapshot","safety");}
    }
    void verify()const{
        check_cancel();if(!handle){if(attributes(path)!=INVALID_FILE_ATTRIBUTES)fail("An unowned staging file appeared","safety");return;}
        BY_HANDLE_FILE_INFORMATION info{};if(!GetFileInformationByHandle(handle->value,&info)||info.nNumberOfLinks!=1||stamp(handle->value)!=fingerprint)
            fail("Staged file identity, contents metadata or links changed","safety");
    }
};
struct Inspection {
    fs::path source,stage,recovery,parent;Directories dirs;std::unique_ptr<Locked> manifest;Plan plan;
    std::vector<File> files;bool stage_exists=false,recovery_exists=false;size_t present=0;uint64_t bytes=0;
    std::string parent_id,stage_id,recovery_id,manifest_stamp;
    Inspection(const fs::path &source,const fs::path &stage,const fs::path &recovery,bool cleanup,bool writing=false):source(source),stage(stage),recovery(recovery),parent(source.parent_path()){
        scope(source,stage,recovery);dirs.ancestors(parent);parent_id=stamp(dirs.held.at(key(parent))->value,true);
        stage_exists=attributes(stage)!=INVALID_FILE_ATTRIBUTES;recovery_exists=attributes(recovery)!=INVALID_FILE_ATTRIBUTES;
        if(stage_exists){dirs.hold(stage);stage_id=stamp(dirs.held.at(key(stage))->value,true);}
        if(recovery_exists){dirs.hold(recovery);recovery_id=stamp(dirs.held.at(key(recovery))->value,true);}
        if(!recovery_exists){if(stage_exists)fail("Staging ownership journal is missing; staged files retained","safety");return;}
        if(attributes(recovery/L"stage.jsonl")==INVALID_FILE_ATTRIBUTES){
            if(stage_exists)fail("Staging ownership journal is missing; staged files retained","safety");check_contents(recovery,{});return;
        }
        manifest=std::make_unique<Locked>(recovery/L"stage.jsonl",false,GENERIC_READ|((cleanup||writing)?DELETE:0)|(writing?GENERIC_WRITE:0));manifest_stamp=stamp(manifest->value);plan=read_plan(*manifest,source,stage,recovery);
        if(manifest_stamp!=stamp(manifest->value)||parent_id!=plan.parent_id||recovery_id!=plan.recovery_id||(stage_exists&&stage_id!=plan.stage_id))fail("Staging directory or journal identity changed","safety");
        files.reserve(plan.items.size());for(const auto &item:plan.items){check_cancel();if(!stage_exists&&!item.pending)continue;files.emplace_back((item.pending?recovery:stage)/fs::path(wide(item.name)),item,cleanup);if(files.back().handle){++present;LARGE_INTEGER size{};
            if(!GetFileSizeEx(files.back().handle->value,&size)||size.QuadPart<0||uint64_t(size.QuadPart)>9007199254740991ull-bytes)fail("Staging inspection size exceeds limits","safety");bytes+=uint64_t(size.QuadPart);}}
        verify();
    }
    void verify()const{
        std::set<std::wstring> recovery_names;if(manifest)recovery_names.insert(L"stage.jsonl");for(const auto &file:files)if(file.handle&&key(file.path.parent_path())==key(recovery))recovery_names.insert(key(file.path.filename()));
        check_cancel();if(recovery_exists)check_contents(recovery,recovery_names);
        else if(attributes(recovery)!=INVALID_FILE_ATTRIBUTES)fail("An unowned staging recovery directory appeared","safety");
        if(manifest&&stamp(manifest->value)!=manifest_stamp)fail("Staging journal changed","safety");
        if(stage_exists){std::set<std::wstring> allowed;for(const auto &file:files)if(file.handle&&key(file.path.parent_path())==key(stage))allowed.insert(key(file.path.filename()));check_contents(stage,allowed);}
        else if(attributes(stage)!=INVALID_FILE_ATTRIBUTES)fail("An unowned staging directory appeared","safety");
        for(const auto &file:files)file.verify();
    }
    std::string token()const{
        Digest hash;hash.field("One explicit staged-file cleanup snapshot v1");for(const auto &path:{source,stage,recovery})hash.field(utf8(key(path)));
        for(const auto &value:{parent_id,stage_id,recovery_id,manifest_stamp,plan.digest})hash.field(value);
        for(const auto &file:files){hash.field(utf8(key(file.path.filename())));hash.field(file.fingerprint);}return hash.finish();
    }
    void remove_directory(const fs::path &path,const std::string &expected){
        check_cancel();check_contents(path,{});dirs.held.erase(key(path));dirs.hold(path,FILE_READ_ATTRIBUTES|DELETE);
        if(stamp(dirs.held.at(key(path))->value,true)!=expected)fail("Staging directory changed before removal","safety");check_contents(path,{});
        erase(dirs.held.at(key(path))->value);dirs.held.erase(key(path));
    }
};
}

namespace archive_stage {
struct Handoff::Impl {
    Inspection job;
    HANDLE pending=INVALID_HANDLE_VALUE;
    std::string pending_identity;
    std::map<std::wstring,std::string> members;
    bool released=false,published=false;
    Impl(const fs::path &source,const fs::path &stage,const fs::path &recovery,const std::string &revision):job(source,stage,recovery,false,true){
        if(!job.manifest||!job.stage_exists||!job.plan.sealed||job.plan.handoff||job.plan.revision!=revision)
            fail("Staging is not sealed for this publication revision","safety");
        size_t expected=0;for(const auto &item:job.plan.items){if(!item.snapshotted)fail("A staged output lacks its sealed snapshot","safety");if(!item.snapshot.empty())++expected;}
        if(job.present!=expected)fail("A sealed staged output is missing before publication","safety");
        for(const auto &file:job.files)if(file.handle)members.emplace(key(file.path),file.fingerprint);
        job.verify();crash("handoff-verified");
        pending=CreateFileW((recovery/L".manifest.pending").c_str(),GENERIC_READ|GENERIC_WRITE|DELETE,FILE_SHARE_READ,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
        if(pending==INVALID_HANDLE_VALUE)fail("Cannot create staging publication plan","write");
        try{
            pending_identity=stamp(pending,true);crash("handoff-created");
            const auto record="{\"type\":\"handoff-created\",\"name\":\".manifest.pending\",\"identity\":"+json(pending_identity)+"}";
            const auto prefix="{\"sequence\":"+std::to_string(job.plan.sequence)+",\"record\":"+record;
            const auto crc=crc32(job.plan.crc,reinterpret_cast<const Bytef*>(prefix.data()),(uInt)prefix.size());char hex[9]{};
            std::snprintf(hex,sizeof(hex),"%08lx",(unsigned long)crc);const auto line=prefix+",\"crc32\":\""+hex+"\"}\n";
            LARGE_INTEGER end{};DWORD written=0;
            if(line.size()>64ull*1024*1024-job.plan.bytes||!SetFilePointerEx(job.manifest->value,end,nullptr,FILE_END)||
                !WriteFile(job.manifest->value,line.data(),(DWORD)line.size(),&written,nullptr)||written!=line.size()||!FlushFileBuffers(job.manifest->value))
                fail("Cannot persist staging publication identity","write");
            job.manifest_stamp=stamp(job.manifest->value);archive_activity();crash("handoff-recorded");
        }catch(...){CloseHandle(pending);pending=INVALID_HANDLE_VALUE;throw;}
    }
    ~Impl(){if(pending!=INVALID_HANDLE_VALUE)CloseHandle(pending);}
};
Handoff::Handoff(const fs::path &source,const fs::path &stage,const fs::path &recovery,const std::string &revision):impl(std::make_unique<Impl>(source,stage,recovery,revision)){}
Handoff::~Handoff()=default;
void Handoff::member(const fs::path &path,const std::string &fingerprint)const{
    const auto found=impl->members.find(key(path));
    if(impl->released||found==impl->members.end()||found->second!=fingerprint)
        fail("Publication member differs from the sealed staging snapshot","safety");
}
void Handoff::release_outputs(){impl->job.files.clear();impl->members.clear();impl->released=true;}
HANDLE Handoff::take_pending(){auto handle=impl->pending;if(handle==INVALID_HANDLE_VALUE)fail("Publication plan handle is unavailable","safety");impl->pending=INVALID_HANDLE_VALUE;return handle;}
void Handoff::publish(HANDLE manifest){
    auto &job=impl->job;if(!impl->released||impl->published||stamp(manifest,true)!=impl->pending_identity||stamp(job.manifest->value)!=job.manifest_stamp)
        fail("Staging publication handoff changed","safety");
    BY_HANDLE_FILE_INFORMATION info{};if(!GetFileInformationByHandle(manifest,&info)||info.nNumberOfLinks!=1)fail("Publication manifest has an unexpected link","safety");
    check_contents(job.recovery,{L"stage.jsonl",L".manifest.pending"});
    move(manifest,job.recovery/L"manifest.jsonl");impl->published=true;crash("handoff-published");
}
void Handoff::retire(){
    auto &job=impl->job;if(!impl->published||!job.manifest||stamp(job.manifest->value)!=job.manifest_stamp)fail("Staging publication is not ready to retire","safety");
    check_contents(job.recovery,{L"stage.jsonl",L"manifest.jsonl"});erase(job.manifest->value);job.manifest.reset();crash("handoff-retired");
}
HANDLE lock_published_journal(const fs::path &source,const fs::path &stage,const fs::path &recovery,HANDLE manifest){
    scope(source,stage,recovery);
    auto journal=std::make_unique<Locked>(recovery/L"stage.jsonl",false,GENERIC_READ|DELETE);
    const auto before=stamp(journal->value);const auto plan=read_plan(*journal,source,stage,recovery);
    Directories dirs;dirs.ancestors(source.parent_path());dirs.hold(recovery);
    if(before!=stamp(journal->value)||!plan.sealed||!plan.handoff||plan.items.empty()||!plan.items.back().pending||
        plan.items.back().id!=stamp(manifest,true)||plan.parent_id!=stamp(dirs.held.at(key(source.parent_path()))->value,true)||
        plan.recovery_id!=stamp(dirs.held.at(key(recovery))->value,true))fail("Publication manifest differs from its staging handoff","safety");
    if(attributes(stage)!=INVALID_FILE_ATTRIBUTES){dirs.hold(stage);if(plan.stage_id!=stamp(dirs.held.at(key(stage))->value,true))fail("Publication staging identity changed","safety");}
    auto handle=journal->value;journal->value=INVALID_HANDLE_VALUE;return handle;
}
}

void inspect_volume_stage(const fs::path &source,const fs::path &stage,const fs::path &recovery){
    Inspection job(source,stage,recovery,false);job.verify();
    size_t retired=0;for(const auto &item:job.plan.items)if(item.snapshotted&&item.snapshot.empty())++retired;
    // The pending publication plan is private recovery metadata, not an archive
    // payload. It remains in the confirmation token and cleanup ownership set.
    size_t files=0;uint64_t bytes=0;std::string samples="[";size_t shown=0;
    for(const auto &file:job.files)if(file.handle&&key(file.path.parent_path())==key(stage)){
        ++files;LARGE_INTEGER size{};if(!GetFileSizeEx(file.handle->value,&size)||size.QuadPart<0)fail("Cannot inspect staged file size","safety");bytes+=uint64_t(size.QuadPart);
        if(shown<30){if(shown++)samples+=",";samples+=json(utf8(file.path.filename().wstring()));}
    }samples+="]";
    const auto created=job.plan.items.size()-size_t(job.plan.handoff);
    emit("{\"type\":\"stage-inspection\",\"token\":"+json(job.token())+",\"sealed\":"+(job.plan.sealed?"true":"false")+
        ",\"created\":"+std::to_string(created)+",\"files\":"+std::to_string(files)+",\"bytes\":"+std::to_string(bytes)+
        ",\"retired\":"+std::to_string(retired)+",\"missing\":"+std::to_string(created-files-retired)+",\"stageMissing\":"+(job.stage_exists?"false":"true")+
        ",\"recoveryMissing\":"+(job.recovery_exists?"false":"true")+",\"samples\":"+samples+"}");
}
void cleanup_volume_stage(const fs::path &source,const fs::path &stage,const fs::path &recovery,const std::string &token){
    if(token.size()!=64||token.find_first_not_of("0123456789abcdef")!=std::string::npos)fail("Staging cleanup requires an inspection token","safety");
    Inspection job(source,stage,recovery,true);job.verify();if(job.token()!=token)fail("Staging changed since inspection; inspect again before cleanup","safety");
    emit("{\"type\":\"ready\"}");if(archive_acknowledgement()!=1)fail("Staging cleanup cancelled before removal","cancelled");job.verify();
    size_t removed=0;for(size_t i=0;i<job.files.size();++i){auto &file=job.files[i];file.verify();if(file.handle){erase(file.handle->value);file.handle.reset();file.fingerprint.clear();if(key(file.path.parent_path())==key(stage))++removed;crash("stage-cleanup:"+std::to_string(i));}
        emit("{\"type\":\"progress\",\"done\":"+std::to_string(i+1)+",\"total\":"+std::to_string(job.files.size())+"}");}
    job.verify();if(job.stage_exists){job.remove_directory(stage,job.stage_id);job.stage_exists=false;crash("stage-cleanup-directory");}
    check_cancel();if(job.manifest){check_contents(recovery,{L"stage.jsonl"});erase(job.manifest->value);job.manifest.reset();crash("stage-cleanup-journal");}
    if(job.recovery_exists){job.remove_directory(recovery,job.recovery_id);crash("stage-cleanup-recovery");}
    emit("{\"type\":\"result\",\"count\":"+std::to_string(removed)+",\"cancelled\":false}");
}
