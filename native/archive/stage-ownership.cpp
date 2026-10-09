#include "stage-ownership.h"
#include "recovery-common.h"
#include "mz.h"
#include "mz_strm_os.h"
#include <exception>

namespace archive_stage {
namespace {
using namespace archive_recovery;
struct Entry {fs::path path;std::string identity;};
bool revision_valid(const std::string &value){
    if(value.starts_with("v2:"))return value.size()==67&&value.find_first_not_of("0123456789abcdef",3)==std::string::npos;
    return valid_stamp(value,7);
}
bool numbered(const std::wstring &value,unsigned maximum,unsigned width){
    if(value.empty()||value.size()>4)return false;
    unsigned number=0;for(const auto c:value){if(c<L'0'||c>L'9')return false;number=number*10+unsigned(c-L'0');}
    auto canonical=std::to_wstring(number);if(canonical.size()<width)canonical.insert(0,width-canonical.size(),L'0');
    return number>0&&number<=maximum&&value==canonical;
}
struct Journal {
    Directories directories;
    fs::path source,stage,recovery;
    HANDLE file=INVALID_HANDLE_VALUE;
    uLong crc=0;
    size_t sequence=0,bytes=0;
    std::vector<Entry> entries;
    std::set<std::wstring> names;
    std::set<std::string> identities;
    bool sealed=false,broken=false;
    std::exception_ptr failure;
    Journal(const fs::path &s,const fs::path &t,const fs::path &r,const std::string &revision):source(s),stage(t),recovery(r){
        const auto parent=source.parent_path();
        if(!source.is_absolute()||source!=source.lexically_normal()||stage!=stage.lexically_normal()||recovery!=recovery.lexically_normal()||
           key(stage.parent_path())!=key(parent)||key(recovery.parent_path())!=key(parent)||
           !stage.filename().wstring().starts_with(L".one-update-")||!uuid(stage.filename().wstring().substr(12))||
           !recovery.filename().wstring().starts_with(L".one-volume-recovery-")||!uuid(recovery.filename().wstring().substr(21))||
           !revision_valid(revision))fail("Invalid staging ownership scope","safety");
        directories.ancestors(parent);directories.hold(stage);
        if(!CreateDirectoryW(recovery.c_str(),nullptr))fail("Staging ownership recovery already exists or cannot be created","write");
        directories.hold(recovery);
        file=CreateFileW((recovery/L"stage.jsonl").c_str(),GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
        if(file==INVALID_HANDLE_VALUE)fail("Cannot create staging ownership journal","write");
        try{append("{\"type\":\"header\",\"version\":4,\"kind\":\"volume-stage\",\"parent\":"+json(utf8(parent.wstring()))+
          ",\"stage\":"+json(utf8(stage.wstring()))+",\"recovery\":"+json(utf8(recovery.wstring()))+
          ",\"parentIdentity\":"+json(stamp(directories.held.at(key(parent))->value,true))+
          ",\"stageIdentity\":"+json(stamp(directories.held.at(key(stage))->value,true))+
          ",\"recoveryIdentity\":"+json(stamp(directories.held.at(key(recovery))->value,true))+
          ",\"primary\":"+json(utf8(source.filename().wstring()))+",\"revision\":"+json(revision)+"}");
          crash("stage-header");
        }catch(...){CloseHandle(file);file=INVALID_HANDLE_VALUE;throw;}
    }
    ~Journal(){if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);}
    void append(const std::string &record){
        if(broken||record.size()>512*1024||sequence>=8200)fail("Staging ownership journal is unavailable or exceeds limits","safety");
        auto prefix="{\"sequence\":"+std::to_string(sequence)+",\"record\":"+record;
        const auto next=crc32(crc,reinterpret_cast<const Bytef*>(prefix.data()),(uInt)prefix.size());char checksum[9]{};std::snprintf(checksum,sizeof(checksum),"%08lx",(unsigned long)next);
        const auto text=prefix+",\"crc32\":\""+checksum+"\"}\n";DWORD written=0;
        if(text.size()>64*1024*1024-bytes)fail("Staging ownership journal exceeds limits","safety");
        char mode[8]{},fault[24]{};
        const auto fault_length=GetEnvironmentVariableA("ONE_ARCHIVE_STAGE_JOURNAL_FAIL_AT_SEQUENCE",fault,sizeof(fault));
        if(GetEnvironmentVariableA("ONE_TEST_MODE",mode,sizeof(mode))==1&&mode[0]=='1'&&
           fault_length>0&&fault_length<sizeof(fault)&&std::string(fault)==std::to_string(sequence)){
            broken=true;fail("Injected staging ownership journal failure","write");}
        // Fail closed before the callback permits the first payload byte.
        if(!WriteFile(file,text.data(),(DWORD)text.size(),&written,nullptr)||written!=text.size()||!FlushFileBuffers(file)){
            broken=true;fail("Cannot persist staging ownership journal","write");}
        crc=next;++sequence;bytes+=text.size();archive_activity();
    }
    void created(const fs::path &path,HANDLE handle){
        if(sealed||broken||entries.size()>=4097||path!=path.lexically_normal()||key(path.parent_path())!=key(stage))fail("Staged output is outside the ownership scope","safety");
        const auto name=path.filename().wstring(),primary=source.filename().wstring();
        bool canonical=false;
        const auto lower=key(name),base=key(primary);
        if(base.ends_with(L".zip")){
            canonical=lower==base;
            if(!canonical&&key(path.stem())==key(source.stem())){const auto ext=key(path.extension());
                canonical=ext.starts_with(L".z")&&numbered(ext.substr(2),4095,2);}
        }else if(base.ends_with(L".7z.001")){
            const auto stem=base.substr(0,base.size()-4);canonical=lower==stem;
            if(!canonical&&lower.starts_with(stem+L"."))canonical=numbered(lower.substr(stem.size()+1),4096,3);
        }
        BY_HANDLE_FILE_INFORMATION info{};
        if(!canonical||!GetFileInformationByHandle(handle,&info)||(info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))||info.nNumberOfLinks!=1||info.nFileSizeHigh||info.nFileSizeLow)
            fail("New staged output is not a unique empty canonical file","safety");
        const auto identity=stamp(handle,true);
        if(!names.insert(lower).second||!identities.insert(identity).second)fail("Staged output was registered more than once","safety");
        append("{\"type\":\"created\",\"index\":"+std::to_string(entries.size())+",\"name\":"+json(utf8(name))+",\"identity\":"+json(identity)+"}");
        entries.push_back({path,identity});crash("stage-created:"+std::to_string(entries.size()-1));
    }
    void seal(){
        if(sealed||broken)fail("Staging ownership journal cannot be sealed","safety");
        // Keep all extant outputs locked until the complete snapshot is synced.
        std::vector<std::unique_ptr<Locked>> files;files.reserve(entries.size());
        std::set<std::wstring> present;
        for(const auto &entry:entries)if(attributes(entry.path)!=INVALID_FILE_ATTRIBUTES){
            auto item=std::make_unique<Locked>(entry.path,false);if(stamp(item->value,true)!=entry.identity)fail("Staged output identity changed before sealing","safety");
            present.insert(key(entry.path.filename()));files.push_back(std::move(item));}
        size_t seen=0;for(const auto &entry:fs::directory_iterator(stage)){if(++seen>4097||!present.contains(key(entry.path().filename())))fail("Staging contains an unregistered output","safety");}
        size_t file_index=0;
        for(size_t i=0;i<entries.size();++i){const auto &entry=entries[i];
            const bool exists=present.contains(key(entry.path.filename()));
            append("{\"type\":\"snapshot\",\"index\":"+std::to_string(i)+",\"stamp\":"+json(exists?stamp(files[file_index++]->value):"")+"}");}
        append("{\"type\":\"sealed\",\"items\":"+std::to_string(entries.size())+",\"files\":"+std::to_string(files.size())+"}");sealed=true;crash("stage-sealed");
    }
};
Journal *active=nullptr;
int32_t callback(void *,const char *path,void *handle){
    try{if(active)active->created(fs::path(wide(path)),handle);return MZ_OK;}
    catch(...){if(active){if(!active->failure)active->failure=std::current_exception();active->broken=true;}return MZ_WRITE_ERROR;}
}
}
struct Recorder::Impl {
    Journal journal;
    Impl(const fs::path &source,const fs::path &stage,const fs::path &recovery,const std::string &revision):journal(source,stage,recovery,revision){
        active=&journal;mz_stream_os_set_created_cb(nullptr,callback);
    }
    ~Impl(){mz_stream_os_set_created_cb(nullptr,nullptr);active=nullptr;}
};
Recorder::Recorder(const fs::path &source,const fs::path &stage,const fs::path &recovery,const std::string &revision){
    if(active)fail("Staging ownership recorder is already active","safety");
    impl=std::make_unique<Impl>(source,stage,recovery,revision);
}
Recorder::~Recorder()=default;
void Recorder::rethrow_failure()const{if(impl->journal.failure)std::rethrow_exception(impl->journal.failure);}
void created(const fs::path &path,HANDLE handle){if(active)active->created(path,handle);}
void seal(){if(active)active->seal();}
}
