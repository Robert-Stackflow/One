#include "common.h"
#include "heartbeat.h"
#include "zip-common.h"
#include "browse.h"
#include "sevenzip-update.h"
#include "extract-space.h"
#include "extract-risk.h"
#include "entry-details.h"
#include "rar-comment.h"
#include <windows.h>
#include <oleauto.h>
#include <propidl.h>
#include <algorithm>
#include <atomic>
#include <cwctype>
#include <limits>
#include <memory>
#include <map>
#include <vector>

// ABI declarations for the interfaces in 7-Zip 26.04's IArchive.h and IStream.h.
// The DLL is loaded from the helper's own directory, never from the process PATH.
namespace {
using U32 = uint32_t;
using U64 = uint64_t;
using I64 = int64_t;
constexpr U32 path_prop=3, dir_prop=6, size_prop=7, packed_prop=8, attributes_prop=9;
constexpr U32 encrypted_prop=15, comment_prop=28, posix_prop=53, symlink_prop=54;
constexpr U32 reparse_prop=89, hardlink_prop=90;
constexpr U32 name_prop=4, split_before_prop=16, error_prop=55, error_flags_prop=71, volume_index_prop=80;

GUID iid(U32 group, U32 number) { return {0x23170f69,0x40c1,0x278a,{0,0,0,(BYTE)group,0,(BYTE)number,0,0}}; }
GUID clsid(U32 format) { return {0x23170f69,0x40c1,0x278a,{0x10,0,0,1,0x10,(BYTE)format,0,0}}; }
bool matches(REFIID left, const GUID &right) { return IsEqualGUID(left,right)!=0; }

struct InStream7: IUnknown {
    virtual HRESULT STDMETHODCALLTYPE Read(void *data,U32 size,U32 *read)=0;
    virtual HRESULT STDMETHODCALLTYPE Seek(I64 offset,U32 origin,U64 *position)=0;
};
struct OutStream7: IUnknown { virtual HRESULT STDMETHODCALLTYPE Write(const void *data,U32 size,U32 *written)=0; };
struct OpenCallback7: IUnknown {
    virtual HRESULT STDMETHODCALLTYPE SetTotal(const U64 *files,const U64 *bytes)=0;
    virtual HRESULT STDMETHODCALLTYPE SetCompleted(const U64 *files,const U64 *bytes)=0;
};
struct Password7: IUnknown { virtual HRESULT STDMETHODCALLTYPE CryptoGetTextPassword(BSTR *password)=0; };
struct Properties7: IUnknown { virtual HRESULT STDMETHODCALLTYPE SetProperties(const wchar_t *const*,const PROPVARIANT*,U32)=0; };
struct Volume7: IUnknown {
    virtual HRESULT STDMETHODCALLTYPE GetProperty(U32 prop,PROPVARIANT *value)=0;
    virtual HRESULT STDMETHODCALLTYPE GetStream(const wchar_t *name,InStream7 **stream)=0;
};
struct Progress7: IUnknown {
    virtual HRESULT STDMETHODCALLTYPE SetTotal(U64 total)=0;
    virtual HRESULT STDMETHODCALLTYPE SetCompleted(const U64 *completed)=0;
};
struct ExtractCallback7: Progress7 {
    virtual HRESULT STDMETHODCALLTYPE GetStream(U32 index,OutStream7 **stream,int mode)=0;
    virtual HRESULT STDMETHODCALLTYPE PrepareOperation(int mode)=0;
    virtual HRESULT STDMETHODCALLTYPE SetOperationResult(int result)=0;
};
struct Archive7: IUnknown {
    virtual HRESULT STDMETHODCALLTYPE Open(InStream7 *stream,const U64 *scan,OpenCallback7 *callback)=0;
    virtual HRESULT STDMETHODCALLTYPE Close()=0;
    virtual HRESULT STDMETHODCALLTYPE GetNumberOfItems(U32 *count)=0;
    virtual HRESULT STDMETHODCALLTYPE GetProperty(U32 index,U32 prop,PROPVARIANT *value)=0;
    virtual HRESULT STDMETHODCALLTYPE Extract(const U32 *indices,U32 count,int test,ExtractCallback7 *callback)=0;
    virtual HRESULT STDMETHODCALLTYPE GetArchiveProperty(U32 prop,PROPVARIANT *value)=0;
};

class FileInput final: public InStream7 {
    std::atomic<ULONG> refs{1};
    struct Part { HANDLE file; U64 start; U64 size; fs::path path; };
    std::vector<Part> parts;
    U64 position=0,total=0;
public:
    explicit FileInput(const fs::path &path,bool split=false){
        for(unsigned index=1;index<=4096;++index){
            fs::path part=path;
            if(split){auto name=path.wstring();name.replace(name.size()-3,3,index<10?L"00"+std::to_wstring(index):index<100?L"0"+std::to_wstring(index):std::to_wstring(index));part=name;}
            HANDLE file=CreateFileW(part.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_RANDOM_ACCESS,nullptr);
            if(file==INVALID_HANDLE_VALUE)break;
            LARGE_INTEGER size{};
            if(!GetFileSizeEx(file,&size)||size.QuadPart<0){CloseHandle(file);break;}
            parts.push_back({file,total,(U64)size.QuadPart,part});total+=(U64)size.QuadPart;
            if(!split)break;
        }
    }
    ~FileInput(){for(const auto &part:parts)CloseHandle(part.file);}
    bool valid() const {return !parts.empty();}
    std::vector<fs::path> members()const{std::vector<fs::path> result;for(const auto &part:parts)result.push_back(part.path);return result;}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out) override {
        if(!out)return E_POINTER;*out=nullptr;
        if(matches(id,IID_IUnknown)||matches(id,iid(3,1))||matches(id,iid(3,3))){*out=this;AddRef();return S_OK;}
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release() override{ULONG value=--refs;if(!value)delete this;return value;}
    HRESULT STDMETHODCALLTYPE Read(void *data,U32 size,U32 *read) override {
        if(!read)return E_POINTER;*read=0;
        if(position>=total)return S_OK;
        auto part=std::upper_bound(parts.begin(),parts.end(),position,[](U64 value,const Part &item){return value<item.start;});
        if(part==parts.begin())return E_FAIL;
        --part;
        LARGE_INTEGER offset{};offset.QuadPart=position-part->start;
        if(!SetFilePointerEx(part->file,offset,nullptr,FILE_BEGIN))return HRESULT_FROM_WIN32(GetLastError());
        DWORD count=0,requested=(DWORD)std::min<U64>(size,part->size-offset.QuadPart);
        if(!ReadFile(part->file,data,requested,&count,nullptr))return HRESULT_FROM_WIN32(GetLastError());
        *read=count;position+=count;if(count)archive_activity();return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Seek(I64 offset,U32 origin,U64 *position) override {
        if(origin>FILE_END)return E_INVALIDARG;
        const I64 base=origin==FILE_BEGIN?0:origin==FILE_CURRENT?(I64)this->position:(I64)total;
        if((offset<0&&base<-offset)||(offset>0&&base>(std::numeric_limits<I64>::max)()-offset))return E_INVALIDARG;
        const I64 next=base+offset;if(next<0)return E_INVALIDARG;
        this->position=(U64)next;if(position)*position=this->position;return S_OK;
    }
};

class OpenRequest final: public OpenCallback7,public Password7,public Volume7 {
    std::atomic<ULONG> refs{1};
    fs::path directory;
    std::wstring password,filename;
    unsigned volumes=0;
    bool allowVolumes;
public:
    bool passwordRequested=false;
    bool additionalVolumeRequested=false;
    std::vector<fs::path> members;
    OpenRequest(const fs::path &source,const std::string &secret,bool allowVolumes):directory(source.parent_path()),password(wide(secret)),filename(source.filename().wstring()),allowVolumes(allowVolumes){}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out) override {
        if(!out)return E_POINTER;*out=nullptr;
        if(matches(id,IID_IUnknown)||matches(id,iid(6,0x10)))*out=static_cast<OpenCallback7*>(this);
        else if(matches(id,iid(5,0x10)))*out=static_cast<Password7*>(this);
        else if(matches(id,iid(6,0x30)))*out=static_cast<Volume7*>(this);
        if(!*out)return E_NOINTERFACE;AddRef();return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release() override{ULONG value=--refs;if(!value)delete this;return value;}
    HRESULT STDMETHODCALLTYPE SetTotal(const U64*,const U64*) override{return S_OK;}
    HRESULT STDMETHODCALLTYPE SetCompleted(const U64*,const U64*) override{return S_OK;}
    HRESULT STDMETHODCALLTYPE CryptoGetTextPassword(BSTR *out) override {
        passwordRequested=true;if(!out)return E_POINTER;*out=nullptr;if(password.empty())return E_ABORT;
        *out=SysAllocStringLen(password.data(),(UINT)password.size());return *out?S_OK:E_OUTOFMEMORY;
    }
    HRESULT STDMETHODCALLTYPE GetProperty(U32 prop,PROPVARIANT *value) override {
        if(!value)return E_POINTER;PropVariantInit(value);
        // IArchiveOpenVolumeCallback requires kpidName to derive the next RAR
        // volume. VT_EMPTY silently stops discovery even when later parts exist.
        if(prop==name_prop){value->vt=VT_BSTR;value->bstrVal=SysAllocStringLen(filename.data(),(UINT)filename.size());if(!value->bstrVal)return E_OUTOFMEMORY;}
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetStream(const wchar_t *name,InStream7 **stream) override {
        if(!stream)return E_POINTER;*stream=nullptr;
        if(archive_cancelled())return E_ABORT;
        if(!allowVolumes){additionalVolumeRequested=true;return S_FALSE;}
        if(++volumes>4096)return E_OUTOFMEMORY;
        if(!name||!name[0]||wcslen(name)>260||wcschr(name,L'/')||wcschr(name,L'\\')||wcschr(name,L':')||
           wcscmp(name,L".")==0||wcscmp(name,L"..")==0)return E_INVALIDARG;
        auto input=new FileInput(directory/name);
        if(!input->valid()){input->Release();return S_FALSE;}
        members.push_back(directory/name);
        *stream=input;return S_OK;
    }
};

struct Item {U32 index;std::string name;bool directory;U64 size;U64 compressed;bool encrypted;bool size_known;};

class OpenArchive final {
    HMODULE library=nullptr;
    Archive7 *archive=nullptr;
    FileInput *input=nullptr;
    OpenRequest *callback=nullptr;
    fs::path source;
    int format;
    int openedFormat=0;
    static std::vector<int> formats(int format){return format==3?std::vector<int>{0xcc,3}:format==0xe7?std::vector<int>{0xe0,0xe7}:std::vector<int>{format};}
    void checkReadHeaders() const {
        PROPVARIANT value{};PropVariantInit(&value);
        const auto result=archive->GetArchiveProperty(error_prop,&value);
        const bool error=result==S_OK&&value.vt==VT_BSTR&&SysStringLen(value.bstrVal)>0;
        PropVariantClear(&value);
        if(error)fail("Archive headers are damaged, incomplete or unsupported");
        U32 flags=0;
        if(archive->GetArchiveProperty(error_flags_prop,&value)==S_OK&&value.vt==VT_UI4)flags=value.ulVal;
        PropVariantClear(&value);
        if(flags&~(1u<<6))fail("Archive headers are damaged, incomplete or unsupported");
    }
    void close(){if(archive){archive->Close();archive->Release();archive=nullptr;}if(callback){callback->Release();callback=nullptr;}if(input){input->Release();input=nullptr;}if(library){FreeLibrary(library);library=nullptr;}}
    void checkRar() const {
        auto extension=source.extension().wstring();std::transform(extension.begin(),extension.end(),extension.begin(),[](wchar_t c){return std::towlower(c);});
        if(extension==L".r00")fail("Open the first RAR volume, not a later part");
        // Open may succeed with only a prefix of a volume set. Check the SDK's
        // archive diagnostics before exposing rows or starting an extraction.
        PROPVARIANT value{};PropVariantInit(&value);
        std::string error;
        if(archive->GetArchiveProperty(error_prop,&value)==S_OK&&value.vt==VT_BSTR){
            if(SysStringLen(value.bstrVal)>4096){PropVariantClear(&value);fail("RAR archive diagnostic is too long");}
            error=utf8(std::wstring(value.bstrVal,SysStringLen(value.bstrVal)));
        }
        PropVariantClear(&value);
        if(!error.empty())fail(error);
        if(archive->GetArchiveProperty(volume_index_prop,&value)==S_OK&&
           ((value.vt==VT_UI4&&value.ulVal!=0)||(value.vt==VT_UI8&&value.uhVal.QuadPart!=0))){
            PropVariantClear(&value);fail("Open the first RAR volume, not a later part");
        }
        PropVariantClear(&value);
        U32 flags=0;
        if(archive->GetArchiveProperty(error_flags_prop,&value)==S_OK&&value.vt==VT_UI4)flags=value.ulVal;
        PropVariantClear(&value);
        // DataAfterEnd alone can be an otherwise valid archive with a trailer.
        if(flags&~(1u<<6))fail("RAR archive headers are damaged, incomplete or unsupported");
        U32 count=0;if(archive->GetNumberOfItems(&count)!=S_OK)fail("Cannot read RAR archive entries");
        if(count){
            if(archive->GetProperty(0,split_before_prop,&value)==S_OK&&value.vt==VT_BOOL&&value.boolVal==VARIANT_TRUE){
                PropVariantClear(&value);fail("Open the first RAR volume, not a later part");
            }
            PropVariantClear(&value);
        }
    }
public:
    OpenArchive(const fs::path &source,const std::string &password,int format):source(source),format(format){try{
        wchar_t exe[32768]{};
        if(!GetModuleFileNameW(nullptr,exe,32768))fail("Cannot find archive helper path");
        const auto dll=fs::path(exe).parent_path()/L"7z.dll";
        library=LoadLibraryExW(dll.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
        if(!library)fail("7-Zip archive engine is missing");
        using Create=HRESULT (WINAPI*)(const GUID*,const GUID*,void**);
        auto create=reinterpret_cast<Create>(GetProcAddress(library,"CreateObject"));
        if(!create)fail("7-Zip archive engine is incompatible");
        const auto name=source.filename().wstring();
        input=new FileInput(source,format==7&&name.size()>=3&&name.substr(name.size()-3)==L"001");
        if(!input->valid())fail("Cannot open archive file","read");
        callback=new OpenRequest(source,password,format==3||format==7);
        const U64 scan=1ull<<23;
        for(int candidate:formats(format)){
            GUID class_id=clsid(candidate),interface_id=iid(6,0x60);
            if(create(&class_id,&interface_id,reinterpret_cast<void**>(&archive))!=S_OK||!archive)continue;
            if(candidate==1){
                Properties7 *properties=nullptr;
                if(archive->QueryInterface(iid(6,3),reinterpret_cast<void**>(&properties))!=S_OK||!properties)
                    fail("ZIPX engine does not support password encoding");
                const wchar_t *key=L"pwcp";PROPVARIANT value{};value.vt=VT_UI4;value.ulVal=zip_password_encoding();
                const auto configured=properties->SetProperties(&key,&value,1);properties->Release();
                if(configured!=S_OK)fail("ZIPX engine is incompatible with password encoding; rebuild the archive engine");
            }
            const auto opened=archive->Open(input,&scan,callback);if(opened==S_OK){
                openedFormat=candidate;
                if(callback->additionalVolumeRequested)fail("This format currently requires a single-volume archive");
                if(format==3)checkRar();
                else if(format==1||format==2||format==6||format==8||format==0x0e||format==0xe7||format==0xe6)checkReadHeaders();
                auto members=input->members();members.insert(members.end(),callback->members.begin(),callback->members.end());bind_archive_members(source,members);return;
            }
            if(opened==E_OUTOFMEMORY)fail("Opening the archive exceeded the memory budget","resource");
            archive->Close();archive->Release();archive=nullptr;
            input->Seek(0,FILE_BEGIN,nullptr);
            callback->members.clear();
        }
        if(callback->passwordRequested&&password.empty())fail("Password required","password");
        // Header failure with a supplied password can also mean corruption.
        fail("Cannot open archive; check its format, volumes or password");
    }catch(...){close();throw;}}
    ~OpenArchive(){close();}
    Archive7 *get() const{return archive;}
    bool encryptedHeaders() const{return callback->passwordRequested;}
    U32 count() const {U32 value=0;if(archive->GetNumberOfItems(&value)!=S_OK||value>1000000)fail("Archive has too many entries");return value;}
    PROPVARIANT property(U32 index,U32 prop) const {PROPVARIANT value{};PropVariantInit(&value);if(archive->GetProperty(index,prop,&value)!=S_OK)fail("Cannot read archive entry");return value;}
    std::vector<Item> items() const {
        std::vector<Item> result;const U32 total=count();result.reserve(total);
        for(U32 i=0;i<total;++i)result.push_back(item(i));
        return result;
    }
    Item item(U32 index) const {
        archive_activity();
        auto name=property(index,path_prop);
        std::string text=name.vt==VT_BSTR?utf8(std::wstring(name.bstrVal,SysStringLen(name.bstrVal))):"";
        PropVariantClear(&name);
        if(text.empty()&&(format==0x0c||format==0xef||format==2||format==0x0e)){
            auto fallback=source.filename().wstring(),lower=fallback;
            std::transform(lower.begin(),lower.end(),lower.begin(),[](wchar_t ch){return std::towlower(ch);});
            if(lower.ends_with(L".txz")||lower.ends_with(L".tgz"))fallback=fallback.substr(0,fallback.size()-4)+L".tar";
            else if(lower.ends_with(L".tbz2")||lower.ends_with(L".tzst"))fallback=fallback.substr(0,fallback.size()-5)+L".tar";
            else if(lower.ends_with(L".tbz"))fallback=fallback.substr(0,fallback.size()-4)+L".tar";
            else if(lower.ends_with(L".bzip2"))fallback.resize(fallback.size()-6);
            else if(lower.ends_with(L".zstd"))fallback.resize(fallback.size()-5);
            else if(lower.ends_with(L".bz2")||lower.ends_with(L".zst"))fallback.resize(fallback.size()-4);
            else if(lower.ends_with(L".xz"))fallback.resize(fallback.size()-3);
            else if(lower.ends_with(L".gz"))fallback.resize(fallback.size()-3);
            text=utf8(fallback);
        }
        auto dir=property(index,dir_prop);bool directory=dir.vt==VT_BOOL&&dir.boolVal==VARIANT_TRUE;PropVariantClear(&dir);
        auto size=property(index,size_prop);const bool size_known=size.vt==VT_UI8||size.vt==VT_UI4;U64 bytes=size.vt==VT_UI8?size.uhVal.QuadPart:size.vt==VT_UI4?size.ulVal:0;PropVariantClear(&size);
        auto packed=property(index,packed_prop);U64 compressed=packed.vt==VT_UI8?packed.uhVal.QuadPart:packed.vt==VT_UI4?packed.ulVal:0;PropVariantClear(&packed);
        auto encrypted=property(index,encrypted_prop);bool locked=encrypted.vt==VT_BOOL&&encrypted.boolVal==VARIANT_TRUE;PropVariantClear(&encrypted);
        return {index,text,directory,bytes,compressed,locked,size_known};
    }
    std::string comment() const {
        PROPVARIANT value{};PropVariantInit(&value);
        std::string result;
        if(archive->GetArchiveProperty(comment_prop,&value)==S_OK&&value.vt==VT_BSTR)
            result=utf8(std::wstring(value.bstrVal,SysStringLen(value.bstrVal)));
        PropVariantClear(&value);if(result.empty()&&openedFormat==3)result=rar4_comment(source,library);return result;
    }
};

void preflight(OpenArchive &reader,const std::vector<Item> &items){
    std::set<std::wstring> seen;
    for(const auto &item:items){
        if(!safe_entry(item.name,item.directory))fail("Archive contains an unsafe path: "+item.name,"safety");
        for(U32 prop:{symlink_prop,hardlink_prop,reparse_prop}){
            auto value=reader.property(item.index,prop);
            bool link=value.vt==VT_BSTR&&SysStringLen(value.bstrVal)>0 || value.vt==VT_BOOL&&value.boolVal==VARIANT_TRUE;
            PropVariantClear(&value);if(link)fail("Archive contains a link: "+item.name,"safety");
        }
        auto attrs=reader.property(item.index,attributes_prop);
        bool reparse=(attrs.vt==VT_UI4&&(attrs.ulVal&FILE_ATTRIBUTE_REPARSE_POINT)!=0);
        PropVariantClear(&attrs);if(reparse)fail("Archive contains a reparse point: "+item.name,"safety");
        auto posix=reader.property(item.index,posix_prop);
        bool unix_link=posix.vt==VT_UI4&&(posix.ulVal&0170000)==0120000;
        PropVariantClear(&posix);if(unix_link)fail("Archive contains a symbolic link: "+item.name,"safety");
        auto path=entry_path(item.name).wstring();
        while(!path.empty()&&(path.back()==L'/'||path.back()==L'\\'))path.pop_back();
        std::transform(path.begin(),path.end(),path.begin(),[](wchar_t ch){return std::towlower(ch==L'/'?L'\\':ch);});
        if(!seen.insert(path).second)fail("Archive contains duplicate paths","safety");
    }
}

class FileOutput final:public OutStream7 {
    std::atomic<ULONG> refs{1};HANDLE file=INVALID_HANDLE_VALUE;U64 limit=0,written=0;ExtractionSpace &space;bool size_known;
public:
    FileOutput(const fs::path &path,U64 expected,ExtractionSpace &space,bool size_known):file(CreateFileW(path.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,
        FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,nullptr)),limit(expected),space(space),size_known(size_known){}
    ~FileOutput(){if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);}
    bool valid()const{return file!=INVALID_HANDLE_VALUE;}
    bool complete()const{return !size_known||written==limit;}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out) override {
        if(!out)return E_POINTER;*out=nullptr;if(matches(id,IID_IUnknown)||matches(id,iid(3,2))){*out=this;AddRef();return S_OK;}return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release() override{ULONG value=--refs;if(!value)delete this;return value;}
    HRESULT STDMETHODCALLTYPE Write(const void *data,U32 size,U32 *done) override {
        if(archive_cancelled())return E_ABORT;
        if(!done)return E_POINTER;*done=0;if(size_known&&size>limit-written)return E_FAIL;
        if(!space.write(size))return HRESULT_FROM_WIN32(ERROR_DISK_FULL);
        if(!WriteFile(file,data,size,reinterpret_cast<DWORD*>(done),nullptr))return HRESULT_FROM_WIN32(GetLastError());
        written+=*done;if(*done)archive_activity();return *done==size?S_OK:E_FAIL;
    }
};

class ExtractRequest final:public ExtractCallback7,public Password7 {
    std::atomic<ULONG> refs{1};
    const std::vector<Item> &items;fs::path destination;std::wstring password;FileOutput *active=nullptr;
    U32 done=0,total=0;U64 completed=0;bool testing=false;ULONGLONG last_progress=0;ExtractionSpace *space=nullptr;
public:
    std::string errorCode="archive";
    ExtractRequest(const std::vector<Item> &entries,const fs::path &path,const std::string &secret,U32 expected,bool test,ExtractionSpace *space=nullptr):
        items(entries),destination(path),password(wide(secret)),total(expected),testing(test),space(space){}
    ~ExtractRequest(){if(active)active->Release();}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out) override {
        if(!out)return E_POINTER;*out=nullptr;
        if(matches(id,IID_IUnknown)||matches(id,iid(6,0x20))||matches(id,iid(0,5)))
            *out=static_cast<ExtractCallback7*>(this);
        else if(matches(id,iid(5,0x10)))*out=static_cast<Password7*>(this);
        if(!*out)return E_NOINTERFACE;AddRef();return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release() override{ULONG value=--refs;if(!value)delete this;return value;}
    HRESULT STDMETHODCALLTYPE SetTotal(U64) override{return S_OK;}
    HRESULT STDMETHODCALLTYPE SetCompleted(const U64 *value) override{if(value&&*value!=completed){completed=*value;archive_activity();}return archive_cancelled()?E_ABORT:S_OK;}
    HRESULT STDMETHODCALLTYPE CryptoGetTextPassword(BSTR *out) override {
        if(!out)return E_POINTER;*out=nullptr;if(password.empty()){errorCode="password";return E_ABORT;}
        *out=SysAllocStringLen(password.data(),(UINT)password.size());return *out?S_OK:E_OUTOFMEMORY;
    }
    HRESULT STDMETHODCALLTYPE GetStream(U32 index,OutStream7 **stream,int mode) override {
        if(archive_cancelled())return E_ABORT;
        if(!stream||index>=items.size())return E_INVALIDARG;*stream=nullptr;
        if(testing||mode!=0)return S_OK;
        if(!space||!space->write(0)){errorCode="write";return E_FAIL;}
        const auto &item=items[index];const auto target=destination/entry_path(item.name);
        try{if(item.directory){fs::create_directories(target);return S_OK;}fs::create_directories(target.parent_path());}
        catch(...){errorCode="write";return E_FAIL;}
        auto output=new FileOutput(target,item.size,*space,item.size_known);
        if(!output->valid()){errorCode="write";output->Release();return E_FAIL;}
        active=output;active->AddRef();*stream=output;return S_OK;
    }
    HRESULT STDMETHODCALLTYPE PrepareOperation(int) override{return S_OK;}
    HRESULT STDMETHODCALLTYPE SetOperationResult(int result) override {
        bool complete=!active||active->complete();
        if(active){active->Release();active=nullptr;}
        // 7-Zip NExtract::NOperationResult::kWrongPassword = 9.
        // CRC/data errors remain archive errors; guessing would hide corruption.
        if(result==9)errorCode="password";
        if(result!=0||!complete)return E_FAIL;
        ++done;const auto now=GetTickCount64();
        if(done==1||done==total||now-last_progress>=100){emit("{\"type\":\"progress\",\"done\":"+std::to_string(done)+",\"total\":"+std::to_string(total)+"}");last_progress=now;}
        return S_OK;
    }
};

std::vector<U32> selected_indices(const std::vector<Item> &items,const std::set<size_t> &selected){
    std::vector<std::string> folders;
    for(size_t index:selected)if(items[index].directory){auto name=items[index].name;std::replace(name.begin(),name.end(),'\\','/');if(!name.ends_with('/'))name+='/';folders.push_back(name);}
    std::vector<U32> result;
    for(const auto &item:items){
        bool include=selected.empty()||selected.contains(item.index);
        if(!include){auto name=item.name;std::replace(name.begin(),name.end(),'\\','/');for(const auto &folder:folders)if(name.starts_with(folder)){include=true;break;}}
        if(include)result.push_back(item.index);
    }
    return result;
}
}

void seven_list(const fs::path &source,size_t offset,size_t limit,const std::string &password,int format){
    OpenArchive reader(source,password,format);
    const auto revision=zip_revision(source);
    U32 total=reader.count();
    auto extension=source.extension().wstring();std::transform(extension.begin(),extension.end(),extension.begin(),[](wchar_t c){return std::towlower(c);});
    emit("{\"type\":\"meta\",\"total\":"+std::to_string(total)+",\"comment\":"+json(reader.comment())+",\"revision\":"+json(revision)+",\"editable\":"+(format==7&&(extension==L".7z"||extension==L".001")?"true":"false")+"}");
    for(size_t i=offset;i<total&&i-offset<limit;++i){
        const auto item=reader.item((U32)i);
        emit("{\"type\":\"entry\",\"index\":"+std::to_string(item.index)+",\"name\":"+json(item.name)+
            ",\"directory\":"+(item.directory?"true":"false")+",\"size\":"+std::to_string(item.size)+
            ",\"compressed\":"+std::to_string(item.compressed)+",\"encrypted\":"+(item.encrypted?"true":"false")+(item.size_known?"":",\"sizeKnown\":false")+"}");
    }
    if(zip_revision(source)!=revision)fail("Archive changed during listing; reopen it");
}

void seven_details(const fs::path &source,size_t index,const std::string &password,int format){
    OpenArchive reader(source,password,format);if(index>=reader.count())fail("Entry index is out of range");
    const auto item=reader.item((U32)index);
    auto packed=reader.property((U32)index,packed_prop);const bool known=packed.vt==VT_UI8||packed.vt==VT_UI4;PropVariantClear(&packed);
    // Property ids follow 7-Zip's PropID.h: MTime=12, Solid=13, CRC=19, Method=22.
    auto time=reader.property((U32)index,12);std::optional<int64_t> modified;
    if(time.vt==VT_FILETIME){ULARGE_INTEGER ticks{};ticks.LowPart=time.filetime.dwLowDateTime;ticks.HighPart=time.filetime.dwHighDateTime;
        const auto milliseconds=ticks.QuadPart/10000;if(milliseconds<=265046774399999ull)modified=(int64_t)milliseconds-11644473600000ll;}
    PropVariantClear(&time);
    auto checksum=reader.property((U32)index,19);std::string crc;if(!item.directory&&checksum.vt==VT_UI4)crc=entry_crc(checksum.ulVal);PropVariantClear(&checksum);
    auto compression=reader.property((U32)index,22);std::string method;
    if(compression.vt==VT_BSTR&&SysStringLen(compression.bstrVal)<=1024)method=utf8(std::wstring(compression.bstrVal,SysStringLen(compression.bstrVal)));
    PropVariantClear(&compression);
    // Single-stream handlers may expose the method on the archive instead.
    // Gzip's validated header fixes CM=8 (Deflate); its SDK handler omits it.
    if(method.empty()&&(format==0x0c||format==0xef||format==2||format==0x0e)){
        PROPVARIANT stream_method{};PropVariantInit(&stream_method);
        if(reader.get()->GetArchiveProperty(22,&stream_method)==S_OK&&stream_method.vt==VT_BSTR&&SysStringLen(stream_method.bstrVal)<=1024)method=utf8(std::wstring(stream_method.bstrVal,SysStringLen(stream_method.bstrVal)));
        PropVariantClear(&stream_method);if(method.empty()&&format==0xef)method="Deflate";
        if(method.empty()&&format==2)method="BZip2";
        if(method.empty()&&format==0x0e)method="ZSTD";
    }
    PROPVARIANT solid{};PropVariantInit(&solid);const bool shared=reader.get()->GetArchiveProperty(13,&solid)==S_OK&&solid.vt==VT_BOOL&&solid.boolVal==VARIANT_TRUE;PropVariantClear(&solid);
    emit_details({item.index,item.name,item.directory,item.size,item.compressed,item.encrypted,item.size_known},known,modified,crc,method,shared);
}

void seven_browse(const fs::path &source,size_t offset,size_t limit,const std::string &password,int format,const BrowseQuery &query){
    OpenArchive reader(source,password,format);const auto revision=zip_revision(source);BrowseRows rows(query);
    const auto total=reader.count();for(U32 i=0;i<total;i++){const auto item=reader.item(i);rows.add({item.index,item.name,item.directory,item.size,item.compressed,item.encrypted,item.size_known});}
    auto extension=source.extension().wstring();std::transform(extension.begin(),extension.end(),extension.begin(),[](wchar_t c){return std::towlower(c);});
    rows.emit_page(total,reader.comment(),revision,format==7&&(extension==L".7z"||extension==L".001"),offset,limit);
    if(zip_revision(source)!=revision)fail("Archive changed during browsing; reopen it");
}

std::vector<Entry> seven_drag_entries(const fs::path &source,const std::string &password,int format){
    OpenArchive reader(source,password,format);auto items=reader.items();preflight(reader,items);
    std::vector<Entry> result;result.reserve(items.size());
    for(const auto &item:items)result.push_back({item.index,item.name,item.directory,item.size,item.compressed,item.encrypted,item.size_known});
    return result;
}

void seven_test(const fs::path &source,const std::string &password,int format,bool result){
    OpenArchive reader(source,password,format);auto items=reader.items();
    if(format==3)reader.comment(); // Include CMT integrity, which the RAR4 handler omits.
    auto callback=new ExtractRequest(items,{},password,(U32)items.size(),true);
    HRESULT code=reader.get()->Extract(nullptr,U32(-1),1,callback);
    const auto error=callback->errorCode;callback->Release();if(code==E_OUTOFMEMORY)fail("Archive integrity check exceeded the memory budget","resource");if(code!=S_OK)fail("Archive integrity check failed or password is incorrect",error);
    if(result)emit("{\"type\":\"result\",\"count\":"+std::to_string(items.size())+"}");
}

size_t seven_extract(const fs::path &source,const fs::path &destination,
                   const std::set<size_t> &selected,const std::string &password,int format,bool result,const std::vector<std::string> &folders){
    OpenArchive reader(source,password,format);auto items=reader.items();
    auto effective=selected;expand_folders(items,effective,folders);
    if(!effective.empty()&&*effective.rbegin()>=items.size())fail("Selected entry index is out of range");
    preflight(reader,items);
    if(fs::exists(destination))fail("Extraction destination already exists");
    auto indices=selected_indices(items,effective);
    U64 expected=0;for(U32 index:indices)if(!items[index].directory){if(items[index].size>UINT64_MAX-expected)fail("Archive declares too much extracted data","safety");expected+=items[index].size;}
    ExtractionRisk risk;for(U32 index:indices){const auto &item=items[index];risk.add(item.name,item.directory,item.size,item.compressed);}risk.check();
    const bool expected_known=std::all_of(indices.begin(),indices.end(),[&](U32 index){return items[index].directory||items[index].size_known;});
    ExtractionSpace space(destination.parent_path(),expected,nullptr,nullptr,nullptr,expected_known);
    fs::create_directory(destination);
    auto callback=new ExtractRequest(items,destination,password,(U32)indices.size(),false,&space);
    HRESULT code=reader.get()->Extract(indices.data(),(U32)indices.size(),0,callback);
    const auto cancelled=archive_cancelled();const auto error=cancelled?"cancelled":callback->errorCode;callback->Release();if(!cancelled&&space.failed())fail(space.message(),space.code());if(code==E_OUTOFMEMORY)fail("Archive extraction exceeded the memory budget","resource");if(code!=S_OK)fail("Cannot extract archive; check its contents or password",error);
    space.finish();
    if(result)emit("{\"type\":\"result\",\"count\":"+std::to_string(indices.size())+"}");
    return indices.size();
}

void seven_update(const fs::path &source,const fs::path &temporary,const fs::path &backup,
                  const std::string &revision,const std::string &password,bool prepare,bool group){
    using namespace archive_update;
    if(group&&!prepare)fail("Volume staging cannot commit changes directly");
    check_staging(source,temporary,backup,group);File original(source,GENERIC_READ,FILE_SHARE_READ);
    if(prepare)expect_archive_revision(source,revision);
    else if(stamp(original.handle)!=revision)fail("Archive changed; reopen it before saving changes");
    Plan plan;std::vector<OutputEntry> nodes;std::vector<std::string> names;
    bool encrypted=false,headers=false;
    {
        OpenArchive reader(source,password,7);auto items=reader.items();preflight(reader,items);headers=reader.encryptedHeaders();
        for(const auto &item:items){auto name=canonical(item.name,item.directory);nodes.push_back({name,item.directory,false,{},item.encrypted});names.push_back(name);encrypted=encrypted||item.encrypted;}
        seven_test(source,password,7,false);
        apply_plan(plan,nodes,source,encrypted,nullptr);check_tree(nodes);
        U64 needed=0;for(const auto &member:archive_source_members(source)){const auto size=fs::file_size(member);if(size>UINT64_MAX-needed)fail("7Z volume size exceeds limits");needed+=size;}
        for(const auto &node:nodes)if(!node.removed){const auto size=node.source.empty()||node.directory?0:fs::file_size(node.source);if(needed>UINT64_MAX-65536||size>UINT64_MAX-needed-65536)fail("7Z update size exceeds limits");needed+=size+65536;}
        auto capacity=fs::space(source.parent_path());constexpr U64 reserve=256ull*1024*1024;
        if(capacity.available!=UINTMAX_MAX&&(capacity.available<reserve||needed>capacity.available-reserve))fail("Not enough free disk space to update the archive","write");
        seven_rewrite(reader.get(),temporary,nodes,names,password,encrypted,headers,[&](U32 index,U32 prop,PROPVARIANT *value){return reader.get()->GetProperty(index,prop,value);});
    }
    size_t count=0;
    {
        OpenArchive verify(temporary,password,7);auto items=verify.items();preflight(verify,items);
        std::map<std::string,const OutputEntry*> expected;for(const auto &node:nodes)if(!node.removed)expected.emplace(node.name,&node);
        if(items.size()!=expected.size())fail("Updated 7Z directory does not match the requested changes");
        for(const auto &item:items){auto found=expected.find(canonical(item.name,item.directory));if(found==expected.end()||found->second->directory!=item.directory)fail("Updated 7Z directory does not match the requested changes");
            if(item.size&&found->second->encrypt&&!item.encrypted)fail("Updated 7Z did not preserve encryption");expected.erase(found);}
        if(headers&&!items.empty()&&!verify.encryptedHeaders())fail("Updated 7Z did not preserve encrypted headers");
        count=items.size();
    }
    seven_test(temporary,password,7,false);
    if(prepare){OpenArchive recheck(source,password,7);if(group)finish_volume_preparation(source,temporary,revision,count,password,7);else finish_preparation(source,temporary,revision,count);}
    else commit(original,source,temporary,backup,revision,count);
}
