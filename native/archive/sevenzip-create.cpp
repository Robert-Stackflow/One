#include "common.h"
#include "resources.h"
#include "sevenzip-update.h"
#include <windows.h>
#include <oleauto.h>
#include <propidl.h>
#include <algorithm>
#include <atomic>
#include <limits>
#include <memory>

// 7-Zip 26.04 COM ABI. Only the interfaces needed to create a new 7Z archive
// are declared here; the original DLL is loaded in this disposable process.
namespace {
using U32=uint32_t;using U64=uint64_t;using I64=int64_t;
constexpr U32 path_prop=3,dir_prop=6,size_prop=7,attributes_prop=9;
constexpr U32 created_prop=10,accessed_prop=11,modified_prop=12;
GUID iid(U32 group,U32 number){return {0x23170f69,0x40c1,0x278a,{0,0,0,(BYTE)group,0,(BYTE)number,0,0}};}
GUID archive_clsid(int format){return {0x23170f69,0x40c1,0x278a,{0x10,0,0,1,0x10,(BYTE)format,0,0}};}
bool matches(REFIID a,const GUID &b){return IsEqualGUID(a,b)!=0;}

struct SeqIn:IUnknown{virtual HRESULT STDMETHODCALLTYPE Read(void*,U32,U32*)=0;};
struct SeqOut:IUnknown{virtual HRESULT STDMETHODCALLTYPE Write(const void*,U32,U32*)=0;};
struct SeekOut:SeqOut{virtual HRESULT STDMETHODCALLTYPE Seek(I64,U32,U64*)=0;virtual HRESULT STDMETHODCALLTYPE SetSize(U64)=0;};
struct Progress:IUnknown{virtual HRESULT STDMETHODCALLTYPE SetTotal(U64)=0;virtual HRESULT STDMETHODCALLTYPE SetCompleted(const U64*)=0;};
struct UpdateCallback:Progress{
    virtual HRESULT STDMETHODCALLTYPE GetUpdateItemInfo(U32,int*,int*,U32*)=0;
    virtual HRESULT STDMETHODCALLTYPE GetProperty(U32,U32,PROPVARIANT*)=0;
    virtual HRESULT STDMETHODCALLTYPE GetStream(U32,SeqIn**)=0;
    virtual HRESULT STDMETHODCALLTYPE SetOperationResult(int)=0;
};
struct Password2:IUnknown{virtual HRESULT STDMETHODCALLTYPE CryptoGetTextPassword2(int*,BSTR*)=0;};
struct ReadPassword:IUnknown{virtual HRESULT STDMETHODCALLTYPE CryptoGetTextPassword(BSTR*)=0;};
struct OutArchive:IUnknown{virtual HRESULT STDMETHODCALLTYPE UpdateItems(SeqOut*,U32,UpdateCallback*)=0;virtual HRESULT STDMETHODCALLTYPE GetFileTimeType(U32*)=0;};
struct Properties7:IUnknown{virtual HRESULT STDMETHODCALLTYPE SetProperties(const wchar_t*const*,const PROPVARIANT*,U32)=0;};

struct SourceItem{fs::path source;std::wstring name;bool directory;U64 size;WIN32_FILE_ATTRIBUTE_DATA data;};
std::vector<SourceItem> collect(const std::vector<fs::path> &sources){
    std::vector<SourceItem> items;
    auto add=[&](const fs::path &source,const fs::path &base){
        auto status=fs::symlink_status(source);
        if(fs::is_symlink(status)||(!fs::is_directory(status)&&!fs::is_regular_file(status)))fail("Source contains a link or special file");
        WIN32_FILE_ATTRIBUTE_DATA data{};
        if(!GetFileAttributesExW(source.c_str(),GetFileExInfoStandard,&data)||
           (data.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT))fail("Source contains a reparse point");
        auto name=source.lexically_relative(base).generic_wstring();
        bool directory=fs::is_directory(status);
        if(!safe_entry(utf8(name),directory))fail("Source has an unsafe archive path");
        items.push_back({source,name,directory,((U64)data.nFileSizeHigh<<32)|data.nFileSizeLow,data});
        if(items.size()>1000000)fail("Too many archive entries");
    };
    for(const auto &source:sources){
        add(source,source.parent_path());
        if(fs::is_directory(source))for(const auto &entry:fs::recursive_directory_iterator(source,fs::directory_options::none))
            add(entry.path(),source.parent_path());
    }
    return items;
}

class Input final:public SeqIn{
    std::atomic<ULONG> refs{1};HANDLE file=INVALID_HANDLE_VALUE;
public:
    Input(const fs::path &path,U64 expected,const std::string &revision=""):file(CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_SEQUENTIAL_SCAN|FILE_FLAG_OPEN_REPARSE_POINT,nullptr)){
        if(file==INVALID_HANDLE_VALUE)return;
        FILE_ATTRIBUTE_TAG_INFO tag{};LARGE_INTEGER length{};
        if(!GetFileInformationByHandleEx(file,FileAttributeTagInfo,&tag,sizeof(tag))||
           (tag.FileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||!GetFileSizeEx(file,&length)||
           length.QuadPart<0||(U64)length.QuadPart!=expected){CloseHandle(file);file=INVALID_HANDLE_VALUE;return;}
        if(!revision.empty())try{if(archive_update::stamp(file)!=revision){CloseHandle(file);file=INVALID_HANDLE_VALUE;}}
            catch(...){CloseHandle(file);file=INVALID_HANDLE_VALUE;}
    }
    ~Input(){if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);}
    bool valid()const{return file!=INVALID_HANDLE_VALUE;}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out)override{if(!out)return E_POINTER;*out=nullptr;if(matches(id,IID_IUnknown)||matches(id,iid(3,1))){*out=this;AddRef();return S_OK;}return E_NOINTERFACE;}
    ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
    HRESULT STDMETHODCALLTYPE Read(void *data,U32 size,U32 *done)override{if(!done)return E_POINTER;*done=0;return ReadFile(file,data,size,reinterpret_cast<DWORD*>(done),nullptr)?S_OK:HRESULT_FROM_WIN32(GetLastError());}
};

class Output final:public SeekOut{
    std::atomic<ULONG> refs{1};HANDLE file=INVALID_HANDLE_VALUE;
public:
    explicit Output(const fs::path &path):file(CreateFileW(path.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr)){}
    ~Output(){if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);}
    bool valid()const{return file!=INVALID_HANDLE_VALUE;}
    bool flush()const{return FlushFileBuffers(file)!=0;}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out)override{if(!out)return E_POINTER;*out=nullptr;if(matches(id,IID_IUnknown)||matches(id,iid(3,2))||matches(id,iid(3,4))){*out=static_cast<SeekOut*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
    ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
    HRESULT STDMETHODCALLTYPE Write(const void *data,U32 size,U32 *done)override{if(!done)return E_POINTER;*done=0;return WriteFile(file,data,size,reinterpret_cast<DWORD*>(done),nullptr)?S_OK:HRESULT_FROM_WIN32(GetLastError());}
    HRESULT STDMETHODCALLTYPE Seek(I64 offset,U32 origin,U64 *position)override{
        if(origin>FILE_END)return E_INVALIDARG;LARGE_INTEGER value{},result{};value.QuadPart=offset;
        if(!SetFilePointerEx(file,value,&result,origin))return HRESULT_FROM_WIN32(GetLastError());
        if(position)*position=result.QuadPart;return S_OK;
    }
    HRESULT STDMETHODCALLTYPE SetSize(U64 size)override{
        if(size>(U64)(std::numeric_limits<I64>::max)())return E_INVALIDARG;
        LARGE_INTEGER current{},end{};if(!SetFilePointerEx(file,{},&current,FILE_CURRENT))return HRESULT_FROM_WIN32(GetLastError());
        end.QuadPart=(I64)size;if(!SetFilePointerEx(file,end,nullptr,FILE_BEGIN)||!SetEndOfFile(file))return HRESULT_FROM_WIN32(GetLastError());
        return SetFilePointerEx(file,current,nullptr,FILE_BEGIN)?S_OK:HRESULT_FROM_WIN32(GetLastError());
    }
};

class Request final:public UpdateCallback,public Password2{
    std::atomic<ULONG> refs{1};const std::vector<SourceItem> &items;std::wstring secret;U32 completed=0;
public:
    Request(const std::vector<SourceItem> &value,const std::string &password):items(value),secret(wide(password)){}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out)override{
        if(!out)return E_POINTER;*out=nullptr;
        if(matches(id,IID_IUnknown)||matches(id,iid(6,0x80))||matches(id,iid(0,5)))*out=static_cast<UpdateCallback*>(this);
        else if(matches(id,iid(5,0x11)))*out=static_cast<Password2*>(this);
        if(!*out)return E_NOINTERFACE;AddRef();return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
    HRESULT STDMETHODCALLTYPE SetTotal(U64)override{return S_OK;}
    HRESULT STDMETHODCALLTYPE SetCompleted(const U64*)override{return S_OK;}
    HRESULT STDMETHODCALLTYPE GetUpdateItemInfo(U32 index,int *data,int *props,U32 *old)override{
        if(index>=items.size())return E_INVALIDARG;if(data)*data=1;if(props)*props=1;if(old)*old=U32(-1);return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetProperty(U32 index,U32 prop,PROPVARIANT *value)override{
        if(!value||index>=items.size())return E_INVALIDARG;PropVariantInit(value);const auto &item=items[index];
        switch(prop){
            case path_prop:value->vt=VT_BSTR;value->bstrVal=SysAllocStringLen(item.name.data(),(UINT)item.name.size());return value->bstrVal?S_OK:E_OUTOFMEMORY;
            case dir_prop:value->vt=VT_BOOL;value->boolVal=item.directory?VARIANT_TRUE:VARIANT_FALSE;break;
            case size_prop:value->vt=VT_UI8;value->uhVal.QuadPart=item.directory?0:item.size;break;
            case attributes_prop:value->vt=VT_UI4;value->ulVal=item.data.dwFileAttributes;break;
            case created_prop:value->vt=VT_FILETIME;value->filetime=item.data.ftCreationTime;break;
            case accessed_prop:value->vt=VT_FILETIME;value->filetime=item.data.ftLastAccessTime;break;
            case modified_prop:value->vt=VT_FILETIME;value->filetime=item.data.ftLastWriteTime;break;
        }
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetStream(U32 index,SeqIn **stream)override{
        if(!stream||index>=items.size())return E_INVALIDARG;*stream=nullptr;
        if(items[index].directory)return S_OK;
        auto input=new Input(items[index].source,items[index].size);if(!input->valid()){input->Release();return E_FAIL;}
        *stream=input;return S_OK;
    }
    HRESULT STDMETHODCALLTYPE SetOperationResult(int result)override{
        if(result!=0)return E_FAIL;++completed;
        emit("{\"type\":\"progress\",\"done\":"+std::to_string(completed)+",\"total\":"+std::to_string(items.size())+"}");
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE CryptoGetTextPassword2(int *defined,BSTR *value)override{
        if(!defined||!value)return E_POINTER;*defined=secret.empty()?0:1;*value=nullptr;
        if(secret.empty())return S_OK;*value=SysAllocStringLen(secret.data(),(UINT)secret.size());return *value?S_OK:E_OUTOFMEMORY;
    }
};

class RewriteRequest final:public UpdateCallback,public Password2,public ReadPassword {
    std::atomic<ULONG> refs{1};
    const std::vector<archive_update::OutputEntry> &nodes;const std::vector<std::string> &names;
    std::vector<size_t> indexes;std::vector<SourceItem> sources;std::vector<std::string> revisions;
    std::wstring password;bool encrypted;
    std::function<HRESULT(U32,U32,PROPVARIANT*)> property;
    std::atomic<U64> total{0},last{0};
public:
    std::atomic<bool> failed{false};
    RewriteRequest(const std::vector<archive_update::OutputEntry> &nodes,const std::vector<std::string> &names,
                   const std::string &password,bool encrypted,const std::function<HRESULT(U32,U32,PROPVARIANT*)> &property):
                   nodes(nodes),names(names),password(wide(password)),encrypted(encrypted),property(property){
        for(size_t i=0;i<nodes.size();i++)if(!nodes[i].removed){
            indexes.push_back(i);WIN32_FILE_ATTRIBUTE_DATA data{};std::string revision;
            if(i>=names.size()){
                if(nodes[i].source.empty()){
                    data.dwFileAttributes=FILE_ATTRIBUTE_DIRECTORY;GetSystemTimeAsFileTime(&data.ftLastWriteTime);
                    data.ftCreationTime=data.ftLastAccessTime=data.ftLastWriteTime;
                }else{
                    archive_update::check_source(nodes[i].source);
                    if(nodes[i].directory){if(!GetFileAttributesExW(nodes[i].source.c_str(),GetFileExInfoStandard,&data))fail("Cannot read added directory");}
                    else{archive_update::File file(nodes[i].source);BY_HANDLE_FILE_INFORMATION info{};
                        if(!GetFileInformationByHandle(file.handle,&info))fail("Cannot read added file");
                        data={info.dwFileAttributes,info.ftCreationTime,info.ftLastAccessTime,info.ftLastWriteTime,info.nFileSizeHigh,info.nFileSizeLow};revision=archive_update::stamp(file.handle);
                    }
                }
            }
            sources.push_back({nodes[i].source,{},nodes[i].directory,((U64)data.nFileSizeHigh<<32)|data.nFileSizeLow,data});
            revisions.push_back(revision);
        }
    }
    U32 count()const{return (U32)indexes.size();}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out)override{
        if(!out)return E_POINTER;*out=nullptr;
        if(matches(id,IID_IUnknown)||matches(id,iid(6,0x80))||matches(id,iid(0,5)))*out=static_cast<UpdateCallback*>(this);
        else if(matches(id,iid(5,0x11)))*out=static_cast<Password2*>(this);
        else if(matches(id,iid(5,0x10)))*out=static_cast<ReadPassword*>(this);
        if(!*out)return E_NOINTERFACE;AddRef();return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
    HRESULT STDMETHODCALLTYPE SetTotal(U64 value)override{total=value;return S_OK;}
    HRESULT STDMETHODCALLTYPE SetCompleted(const U64 *value)override{
        if(!value)return S_OK;const auto now=GetTickCount64();auto previous=last.load();
        if((now-previous>=100||*value==total)&&last.compare_exchange_strong(previous,now))
            emit("{\"type\":\"progress\",\"done\":"+std::to_string(*value)+",\"total\":"+std::to_string(total.load())+"}");
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetUpdateItemInfo(U32 index,int *data,int *props,U32 *old)override{
        if(index>=indexes.size())return E_INVALIDARG;const auto node=indexes[index];const bool added=node>=names.size();
        if(data)*data=added?1:0;if(props)*props=added||nodes[node].name!=names[node]?1:0;if(old)*old=added?U32(-1):(U32)node;return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetProperty(U32 index,U32 prop,PROPVARIANT *value)override{
        if(!value||index>=indexes.size())return E_INVALIDARG;PropVariantInit(value);const auto node=indexes[index];
        try{
            if(prop==path_prop){auto name=nodes[node].name;if(nodes[node].directory&&name.ends_with('/'))name.pop_back();const auto text=wide(name);
                value->vt=VT_BSTR;value->bstrVal=SysAllocStringLen(text.data(),(UINT)text.size());return value->bstrVal?S_OK:E_OUTOFMEMORY;}
            if(node<names.size())return property((U32)node,prop,value);
            const auto &item=sources[index];
            switch(prop){
                case dir_prop:value->vt=VT_BOOL;value->boolVal=item.directory?VARIANT_TRUE:VARIANT_FALSE;break;
                case size_prop:value->vt=VT_UI8;value->uhVal.QuadPart=item.directory?0:item.size;break;
                case attributes_prop:value->vt=VT_UI4;value->ulVal=item.data.dwFileAttributes;break;
                case created_prop:value->vt=VT_FILETIME;value->filetime=item.data.ftCreationTime;break;
                case accessed_prop:value->vt=VT_FILETIME;value->filetime=item.data.ftLastAccessTime;break;
                case modified_prop:value->vt=VT_FILETIME;value->filetime=item.data.ftLastWriteTime;break;
            }
            return S_OK;
        }catch(...){failed=true;return E_FAIL;}
    }
    HRESULT STDMETHODCALLTYPE GetStream(U32 index,SeqIn **stream)override{
        if(!stream||index>=indexes.size())return E_INVALIDARG;*stream=nullptr;const auto node=indexes[index];
        if(node<names.size())return E_INVALIDARG;if(nodes[node].directory)return S_OK;
        try{archive_update::check_source(nodes[node].source);auto input=new Input(nodes[node].source,sources[index].size,revisions[index]);
            if(!input->valid()){input->Release();failed=true;return E_FAIL;}*stream=input;return S_OK;
        }catch(...){failed=true;return E_FAIL;}
    }
    HRESULT STDMETHODCALLTYPE SetOperationResult(int result)override{if(result){failed=true;return E_FAIL;}return S_OK;}
    HRESULT STDMETHODCALLTYPE CryptoGetTextPassword2(int *defined,BSTR *value)override{
        if(!defined||!value)return E_POINTER;*defined=encrypted?1:0;*value=nullptr;
        if(!encrypted)return S_OK;if(password.empty())return E_ABORT;
        *value=SysAllocStringLen(password.data(),(UINT)password.size());return *value?S_OK:E_OUTOFMEMORY;
    }
    HRESULT STDMETHODCALLTYPE CryptoGetTextPassword(BSTR *value)override{
        if(!value)return E_POINTER;*value=nullptr;if(password.empty())return E_ABORT;
        *value=SysAllocStringLen(password.data(),(UINT)password.size());return *value?S_OK:E_OUTOFMEMORY;
    }
};
}

void seven_rewrite(IUnknown *original,const fs::path &destination,
                   const std::vector<archive_update::OutputEntry> &nodes,const std::vector<std::string> &names,
                   const std::string &password,bool encrypted,bool headers,
                   const std::function<HRESULT(U32,U32,PROPVARIANT*)> &property){
    OutArchive *archive=nullptr;Properties7 *properties=nullptr;Output *output=nullptr;RewriteRequest *callback=nullptr;
    try{
        if(original->QueryInterface(iid(6,0xa0),reinterpret_cast<void**>(&archive))!=S_OK||!archive)fail("7Z archive cannot be updated");
        if(archive->QueryInterface(iid(6,3),reinterpret_cast<void**>(&properties))!=S_OK||!properties)fail("7Z writer does not support properties");
        const wchar_t *keys[]={L"he",L"mt"};PROPVARIANT values[2]{};values[0].vt=VT_BOOL;values[0].boolVal=headers?VARIANT_TRUE:VARIANT_FALSE;
        values[1].vt=VT_UI4;values[1].ulVal=archive_resources().threads;
        if(properties->SetProperties(keys,values,2)!=S_OK)fail("Cannot preserve 7Z encryption and thread options");
        callback=new RewriteRequest(nodes,names,password,encrypted||headers,property);
        output=new Output(destination);if(!output->valid())fail("Cannot create staging 7Z","write");
        const auto code=archive->UpdateItems(output,callback->count(),callback);
        if(code==E_OUTOFMEMORY)fail("7Z update exceeded the memory budget; increase the memory limit","resource");
        if(code!=S_OK||callback->failed||!output->flush())fail("Cannot update 7Z; source data changed, is unavailable or could not be written");
        callback->Release();callback=nullptr;output->Release();output=nullptr;properties->Release();properties=nullptr;archive->Release();archive=nullptr;
    }catch(...){if(callback)callback->Release();if(output)output->Release();if(properties)properties->Release();if(archive)archive->Release();throw;}
}

void seven_create(const fs::path &destination,const std::vector<fs::path> &sources,const std::string &password,int format){
    if(sources.empty()||fs::exists(destination))fail("Archive target already exists or has no input");
    if(format!=7&&format!=0xee&&format!=0xef&&format!=0x0c)fail("Unsupported archive creation format");
    if(format!=7&&!password.empty())fail("This archive format does not support encryption");
    if((format==0xef||format==0x0c)&&(sources.size()!=1||!fs::is_regular_file(sources[0])))
        fail("GZ and XZ require one regular file");
    auto items=collect(sources);
    wchar_t exe[32768]{};if(!GetModuleFileNameW(nullptr,exe,32768))fail("Cannot find archive helper path");
    HMODULE library=LoadLibraryExW((fs::path(exe).parent_path()/L"7z.dll").c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    if(!library)fail("7-Zip archive engine is missing");
    OutArchive *archive=nullptr;Properties7 *properties=nullptr;Output *output=nullptr;Request *callback=nullptr;bool created=false;
    try{
        using Create=HRESULT (WINAPI*)(const GUID*,const GUID*,void**);
        auto create=reinterpret_cast<Create>(GetProcAddress(library,"CreateObject"));
        if(!create)fail("7-Zip archive engine is incompatible");
        auto class_id=archive_clsid(format),interface_id=iid(6,0xa0);
        if(create(&class_id,&interface_id,reinterpret_cast<void**>(&archive))!=S_OK||!archive)fail("Cannot initialize archive writer");
        auto property_id=iid(6,3);
        if(format!=0xee){
            if(archive->QueryInterface(property_id,reinterpret_cast<void**>(&properties))!=S_OK||!properties)fail("Archive writer does not support compression options");
            const auto &resources=archive_resources();
            const wchar_t *names[]={L"x",L"mt",L"he"};PROPVARIANT values[3]{};
            values[0].vt=VT_UI4;values[0].ulVal=resources.level;values[1].vt=VT_UI4;values[1].ulVal=resources.threads;
            values[2].vt=VT_BOOL;values[2].boolVal=password.empty()?VARIANT_FALSE:VARIANT_TRUE;
            if(properties->SetProperties(names,values,format==7?3:format==0x0c?2:1)!=S_OK)fail("Cannot apply archive compression options");
        }
        output=new Output(destination);if(!output->valid())fail("Cannot create archive target");created=true;
        callback=new Request(items,password);
        const auto code=archive->UpdateItems(output,(U32)items.size(),callback);
        if(code==E_OUTOFMEMORY)fail("Compression exceeded the memory budget; increase the limit or use a lower level","resource");
        if(code!=S_OK||!output->flush())fail("Cannot finish archive");
        callback->Release();callback=nullptr;output->Release();output=nullptr;
        if(properties){properties->Release();properties=nullptr;}
        archive->Release();archive=nullptr;
        FreeLibrary(library);
        emit("{\"type\":\"result\",\"count\":"+std::to_string(sources.size())+"}");
    }catch(...){
        if(callback)callback->Release();if(output)output->Release();if(properties)properties->Release();if(archive)archive->Release();
        FreeLibrary(library);if(created){std::error_code ignored;fs::remove(destination,ignored);}throw;
    }
}
