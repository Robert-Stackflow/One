#include <windows.h>
#include <amsi.h>
#include <algorithm>
#include <atomic>
#include <cstring>
#include <memory>
#include <mutex>
#include "scan.h"

namespace {
std::string bounded(std::string value,size_t limit){
    for(auto &ch:value)if((unsigned char)ch<32||ch==127)ch=' ';
    if(value.size()>limit){while(limit&&((unsigned char)value[limit]&0xc0)==0x80)--limit;value.resize(limit);}return value;
}
std::wstring env(const wchar_t *key,DWORD limit=32){
    auto size=GetEnvironmentVariableW(key,nullptr,0);if(!size)return {};
    if(size>limit)fail("Invalid scan option","scan");std::wstring result(size,L'\0');SetLastError(ERROR_SUCCESS);
    auto actual=GetEnvironmentVariableW(key,result.data(),size);if(actual>=size||(!actual&&GetLastError()!=ERROR_SUCCESS))fail("Scan option changed","scan");result.resize(actual);return result;
}
struct Locked {
    HANDLE value=INVALID_HANDLE_VALUE;
    Locked(const fs::path &file,bool directory):value(CreateFileW(file.c_str(),directory?FILE_READ_ATTRIBUTES:GENERIC_READ,
        directory?FILE_SHARE_READ|FILE_SHARE_WRITE:FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT|(directory?FILE_FLAG_BACKUP_SEMANTICS:0),nullptr)){
        if(value==INVALID_HANDLE_VALUE)fail("Cannot lock a file for scanning","scan");
        BY_HANDLE_FILE_INFORMATION info{};if(!GetFileInformationByHandle(value,&info)||(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||bool(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=directory||(!directory&&info.nNumberOfLinks!=1)){
            CloseHandle(value);value=INVALID_HANDLE_VALUE;fail("Scan path contains a link or incompatible file","safety");
        }
    }
    ~Locked(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
    Locked(const Locked&)=delete;
};
class FileStream final:public IAmsiStream {
    std::atomic<ULONG> refs{1};Locked file;ULONGLONG size=0;std::wstring name;std::mutex mutex;
    HRESULT attribute(const void *data,ULONG bytes,ULONG capacity,PBYTE out,ULONG *actual){
        *actual=bytes;if(capacity<bytes)return HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER);std::memcpy(out,data,bytes);return S_OK;
    }
public:
    FileStream(const fs::path &path,std::wstring name):file(path,false),name(std::move(name)){
        LARGE_INTEGER length{};if(!GetFileSizeEx(file.value,&length)||length.QuadPart<0)fail("Cannot inspect scan content size","scan");size=(ULONGLONG)length.QuadPart;
    }
    ULONGLONG length()const{return size;}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out)override{if(!out)return E_POINTER;*out=nullptr;if(id!=IID_IUnknown&&id!=__uuidof(IAmsiStream))return E_NOINTERFACE;*out=static_cast<IAmsiStream*>(this);AddRef();return S_OK;}
    ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release()override{auto count=--refs;if(!count)delete this;return count;}
    HRESULT STDMETHODCALLTYPE GetAttribute(AMSI_ATTRIBUTE which,ULONG capacity,PBYTE out,ULONG *actual)override{
        if(!actual||(!out&&capacity))return E_INVALIDARG;*actual=0;
        static constexpr wchar_t app[]=L"One.Archive";const PVOID session=nullptr;
        switch(which){
        case AMSI_ATTRIBUTE_APP_NAME:return attribute(app,sizeof(app),capacity,out,actual);
        case AMSI_ATTRIBUTE_CONTENT_NAME:return attribute(name.c_str(),(ULONG)((name.size()+1)*sizeof(wchar_t)),capacity,out,actual);
        case AMSI_ATTRIBUTE_CONTENT_SIZE:return attribute(&size,sizeof(size),capacity,out,actual);
        case AMSI_ATTRIBUTE_SESSION:return attribute(&session,sizeof(session),capacity,out,actual);
        default:return E_NOTIMPL; // Never expose CONTENT_ADDRESS or a full mapping.
        }
    }
    HRESULT STDMETHODCALLTYPE Read(ULONGLONG position,ULONG bytes,PBYTE out,ULONG *actual)override{
        if(!actual||(!out&&bytes))return E_INVALIDARG;*actual=0;
        if(archive_cancelled())return HRESULT_FROM_WIN32(ERROR_CANCELLED);
        if(!bytes)return S_OK;if(position>=size)return HRESULT_FROM_WIN32(ERROR_HANDLE_EOF);
        bytes=(ULONG)std::min<ULONGLONG>(bytes,size-position);std::lock_guard lock(mutex);
        LARGE_INTEGER at{};at.QuadPart=(LONGLONG)position;if(!SetFilePointerEx(file.value,at,nullptr,FILE_BEGIN))return HRESULT_FROM_WIN32(GetLastError());
        // Write into the provider's buffer in bounded I/O calls. Provider
        // allocations themselves remain subject to the helper's Job budget.
        while(*actual<bytes){DWORD got=0;auto amount=std::min<ULONG>(65536,bytes-*actual);
            if(archive_cancelled())return HRESULT_FROM_WIN32(ERROR_CANCELLED);
            if(!ReadFile(file.value,out+*actual,amount,&got,nullptr))return HRESULT_FROM_WIN32(GetLastError());
            if(!got)return HRESULT_FROM_WIN32(ERROR_HANDLE_EOF);*actual+=got;
        }
        return S_OK;
    }
};
struct StreamDeleter{void operator()(FileStream *stream)const{stream->Release();}};
struct Scanner {
    bool com=false;IAntimalware *service=nullptr;std::wstring test;
    Scanner(){
        if(env(L"ONE_TEST_MODE")==L"1")test=env(L"ONE_ARCHIVE_SCAN_TEST");
        if(!test.empty()){if(test!=L"passed"&&test!=L"stream"&&test!=L"unavailable"&&test!=L"failure"&&test!=L"blocked"&&test!=L"malware"&&test!=L"stall")fail("Invalid scan test mode","scan");return;}
        const auto code=CoInitializeEx(nullptr,COINIT_MULTITHREADED);if(FAILED(code))fail("AMSI initialization failed (HRESULT "+std::to_string((uint32_t)code)+")","scan");com=true;
        const auto created=CoCreateInstance(__uuidof(CAntimalware),nullptr,CLSCTX_INPROC_SERVER,__uuidof(IAntimalware),reinterpret_cast<void**>(&service));
        if(FAILED(created)||!service){if(service){service->Release();service=nullptr;}CoUninitialize();com=false;fail("AMSI service unavailable (HRESULT "+std::to_string((uint32_t)created)+")","scan");}
    }
    ~Scanner(){if(service)service->Release();if(com)CoUninitialize();}
    void scan(FileStream *stream,std::string &reported_provider){
        AMSI_RESULT result=AMSI_RESULT_NOT_DETECTED;HRESULT code=S_OK;IAntimalwareProvider *provider=nullptr;std::string name;
        if(!test.empty()){
            // Private protocol tests exercise the real stream implementation
            // without installing a provider or sending threat signatures.
            ULONG actual=0;ULONGLONG length=0;wchar_t content[32768]{};PVOID address=nullptr;
            if(stream->GetAttribute(AMSI_ATTRIBUTE_CONTENT_SIZE,sizeof(length),reinterpret_cast<PBYTE>(&length),&actual)!=S_OK||actual!=sizeof(length)||stream->GetAttribute(AMSI_ATTRIBUTE_CONTENT_NAME,sizeof(content),reinterpret_cast<PBYTE>(content),&actual)!=S_OK||stream->GetAttribute(AMSI_ATTRIBUTE_CONTENT_ADDRESS,sizeof(address),reinterpret_cast<PBYTE>(&address),&actual)!=E_NOTIMPL)fail("Invalid streaming scan attributes","scan");
            unsigned char bytes[65536];ULONG got=0;
            if(length&&stream->Read(length-1,1,bytes,&got)!=S_OK)fail("Cannot read 64-bit scan tail","scan");
            const auto tail=bytes[0];
            if(stream->Read(length,1,bytes,&got)!=HRESULT_FROM_WIN32(ERROR_HANDLE_EOF))fail("Invalid scan EOF","scan");
            if(test==L"stream"){
                if(stream->GetAttribute(AMSI_ATTRIBUTE_CONTENT_SIZE,1,bytes,&actual)!=HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER)||actual!=sizeof(length)||stream->Read(UINT64_MAX,1,bytes,&got)!=HRESULT_FROM_WIN32(ERROR_HANDLE_EOF)||stream->Read(0,0,nullptr,&got)!=S_OK||stream->Read(0,1,nullptr,&got)!=E_INVALIDARG)fail("Invalid scan stream contract","scan");
                emit("{\"type\":\"scan-stream-test\",\"length\":"+json(std::to_string(length))+",\"tail\":"+std::to_string(tail)+"}");
            }
            if(test!=L"stream")for(ULONGLONG offset=0;offset<length;offset+=got){got=0;if(FAILED(stream->Read(offset,sizeof(bytes),bytes,&got))||!got)fail("Cannot read simulated scan stream","scan");}
            if(test==L"stall")while(true)Sleep(10);
            if(test==L"unavailable")fail("AMSI provider unavailable","scan");if(test==L"failure")fail("AMSI scan failed","scan");
            if(test==L"blocked")result=AMSI_RESULT_BLOCKED_BY_ADMIN_START;else if(test==L"malware")result=AMSI_RESULT_DETECTED;
            name="Isolated test provider";
        }else{
            code=service->Scan(stream,&result,&provider);
            const bool has_provider=provider!=nullptr;
            if(provider){LPWSTR display=nullptr;if(SUCCEEDED(provider->DisplayName(&display))&&display){size_t length=0;while(length<256&&display[length])++length;try{name=utf8(std::wstring(display,length));}catch(...){name.clear();}}if(display)CoTaskMemFree(display);provider->Release();}
            reported_provider=bounded(name,256);
            if(FAILED(code))fail("AMSI scan did not finish (HRESULT "+std::to_string((uint32_t)code)+")","scan");
            if(!has_provider)fail("AMSI returned no scanning provider","scan");
            if(name.empty())name="AMSI provider";
        }
        reported_provider=bounded(name,256);
        if((int)result<0)fail("AMSI returned an invalid scan result","scan");
        if(result>=AMSI_RESULT_DETECTED)fail("AMSI detected a threat; extracted contents were not published","threat");
        if(result>=AMSI_RESULT_BLOCKED_BY_ADMIN_START&&result<=AMSI_RESULT_BLOCKED_BY_ADMIN_END)fail("AMSI blocked content by security policy; extracted contents were not published","threat");
    }
};
void summary(const std::string &state,size_t files,size_t empty,const std::string &provider={},const std::string &reason={}){
    emit("{\"type\":\"scan\",\"state\":"+json(state)+",\"files\":"+std::to_string(files)+",\"emptyFiles\":"+std::to_string(empty)+(provider.empty()?"":",\"provider\":"+json(provider))+(reason.empty()?"":",\"reason\":"+json(bounded(reason,512)))+"}");
}
}
void archive_scan(const fs::path &stage){
    const auto policy=env(L"ONE_ARCHIVE_SCAN");if(policy.empty()||policy==L"0"){summary("disabled",0,0);return;}
    if(policy!=L"1")fail("Invalid scan policy","scan");
    size_t nodes=0,files=0,empty=0;std::string provider;
    try{
        if(!stage.is_absolute()||stage!=stage.lexically_normal())fail("Invalid scan staging path","safety");
        std::vector<std::unique_ptr<Locked>> parents;auto current=stage.root_path();parents.push_back(std::make_unique<Locked>(current,true));
        for(const auto &part:stage.relative_path()){if(part.wstring().find(L':')!=std::wstring::npos)fail("Invalid scan staging path","safety");current/=part;parents.push_back(std::make_unique<Locked>(current,true));if(parents.size()>512)fail("Scan path is too deep","safety");}
        struct Frame{fs::directory_iterator next,end;std::unique_ptr<Locked> lock;};std::vector<Frame> stack;stack.push_back({fs::directory_iterator(stage),{},nullptr});
        std::unique_ptr<Scanner> scanner;
        while(!stack.empty()){
            if(archive_cancelled())fail("Scan cancelled","cancelled");auto &frame=stack.back();if(frame.next==frame.end){stack.pop_back();continue;}auto path=frame.next->path();++frame.next;
            if(++nodes>1000000)fail("Too many files to scan","scan");auto attr=GetFileAttributesW(path.c_str());if(attr==INVALID_FILE_ATTRIBUTES||attr&FILE_ATTRIBUTE_REPARSE_POINT)fail("Scan staging contains a link or missing file","safety");
            if(attr&FILE_ATTRIBUTE_DIRECTORY){if(stack.size()+parents.size()>512)fail("Scan path is too deep","safety");auto locked=std::make_unique<Locked>(path,true);stack.push_back({fs::directory_iterator(path),{},std::move(locked)});continue;}
            std::unique_ptr<FileStream,StreamDeleter> stream(new FileStream(path,path.lexically_relative(stage).wstring()));
            if(!stream->length()){++empty;continue;}
            emit("{\"type\":\"progress\",\"phase\":\"scan\",\"done\":"+std::to_string(files)+",\"total\":0}");
            if(!scanner)scanner=std::make_unique<Scanner>();scanner->scan(stream.get(),provider);++files;
        }
        summary(files?"passed":"empty",files,empty,provider);
    }catch(const ArchiveError &error){summary(error.code=="threat"?"blocked":"incomplete",files,empty,provider,error.what());throw;}
    catch(const std::exception &error){summary("incomplete",files,empty,provider,error.what());fail("AMSI scan did not finish","scan");}
}
