#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <string>
#include <vector>
#include <atomic>
#include <algorithm>
// Read a bounded local configuration next to this DLL. No Electron process or scanning on the menu path.
static const CLSID locks={0x49a8359c,0x85b9,0x4e7a,{0x90,0x5e,0x6a,0x72,0x49,0x11,0x75,0x0a}};
static const CLSID renameCommand={0x57aba3e6,0x8d9a,0x4a16,{0xa7,0x17,0x65,0x41,0xb2,0x24,0x1a,0x36}};
static std::atomic<long> objects=0;
static std::wstring setting(const wchar_t* name){
 HMODULE module=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,(LPCWSTR)&setting,&module))return{};std::vector<wchar_t> path(32768);DWORD length=GetModuleFileNameW(module,path.data(),(DWORD)path.size());if(!length||length>=path.size())return{};std::wstring file(path.data(),length);file=file.substr(0,file.find_last_of(L"\\/"))+L"\\shell-config.bin";
 HANDLE input=CreateFileW(file.c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);if(input==INVALID_HANDLE_VALUE)return{};DWORD size=GetFileSize(input,nullptr);if(size>256*1024||size%2){CloseHandle(input);return{};}std::vector<wchar_t> content(size/2+1,0);DWORD read=0;BOOL ok=ReadFile(input,content.data(),size,&read,nullptr);CloseHandle(input);if(!ok||read!=size)return{};
 const wchar_t* names[]={L"Executable",L"AppPath",L"Profile",L"Icon",L"Locksmith",L"Rename"};size_t offset=0;for(auto field:names){if(offset>=content.size())return{};const wchar_t* value=content.data()+offset;size_t count=wcslen(value);if(offset+count>=content.size())return{};if(wcscmp(name,field)==0)return value;offset+=count+1;}return{};
}
static bool enabled(bool rename){return setting(rename?L"Rename":L"Locksmith")==L"1";}
static std::wstring quote(const std::wstring& s){std::wstring out=L"\"";unsigned slashes=0;for(wchar_t c:s){if(c==L'\\'){slashes++;continue;}if(c==L'\"'){out.append(slashes*2+1,L'\\');out+=c;}else{out.append(slashes,L'\\');out+=c;}slashes=0;}out.append(slashes*2,L'\\');return out+L"\"";}
static std::string utf8(const std::wstring& s){int size=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);if(!size)return{};std::string out(size,'\0');WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,s.data(),(int)s.size(),out.data(),size,nullptr,nullptr);return out;}
static std::string json(const std::wstring& s){std::string out="\"";for(unsigned char c:utf8(s)){if(c=='"'||c=='\\')out+='\\';if(c<32){char hex[7];sprintf_s(hex,"\\u%04x",c);out+=hex;}else out+=(char)c;}return out+'"';}
static HRESULT launch(const std::wstring& request){const auto exe=setting(L"Executable"),prefix=setting(L"AppPath"),profile=setting(L"Profile");if(exe.empty()||profile.empty())return E_FAIL;
 std::wstring command=quote(exe)+(prefix.empty()?L"":L" "+quote(prefix))+(request.empty()?L"":L" "+quote(L"--one-shell-request="+request));
 std::vector<std::wstring> vars;wchar_t* environment=GetEnvironmentStringsW();if(!environment)return HRESULT_FROM_WIN32(GetLastError());for(const wchar_t* p=environment;*p;p+=wcslen(p)+1)if(_wcsnicmp(p,L"ONE_DATA_DIR=",13)&&_wcsnicmp(p,L"ONE_DEVELOPMENT=",16))vars.emplace_back(p);FreeEnvironmentStringsW(environment);vars.push_back(L"ONE_DATA_DIR="+profile);if(!prefix.empty())vars.push_back(L"ONE_DEVELOPMENT=1");std::sort(vars.begin(),vars.end(),[](const auto&a,const auto&b){return _wcsicmp(a.c_str(),b.c_str())<0;});std::vector<wchar_t> block;for(const auto& v:vars){block.insert(block.end(),v.begin(),v.end());block.push_back(0);}block.push_back(0);
 STARTUPINFOW startup{sizeof(startup)};PROCESS_INFORMATION process{};if(!CreateProcessW(exe.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_UNICODE_ENVIRONMENT,block.data(),nullptr,&startup,&process))return HRESULT_FROM_WIN32(GetLastError());CloseHandle(process.hThread);CloseHandle(process.hProcess);return S_OK;
}
class Command final:public IExplorerCommand {
 std::atomic<ULONG> refs{1};bool rename;
public:explicit Command(bool r):rename(r){objects++;}~Command(){objects--;}
 HRESULT __stdcall QueryInterface(REFIID id,void** out) override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IExplorerCommand){*out=static_cast<IExplorerCommand*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
 ULONG __stdcall AddRef() override{return ++refs;}ULONG __stdcall Release() override{ULONG n=--refs;if(!n)delete this;return n;}
 HRESULT __stdcall GetTitle(IShellItemArray*,PWSTR* out) override{return SHStrDupW(rename?L"批量重命名":L"文件占用",out);}
 HRESULT __stdcall GetIcon(IShellItemArray*,PWSTR* out) override{const auto icon=setting(L"Icon");return icon.empty()?E_NOTIMPL:SHStrDupW(icon.c_str(),out);}
 HRESULT __stdcall GetToolTip(IShellItemArray*,PWSTR* out) override{*out=nullptr;return E_NOTIMPL;}
 HRESULT __stdcall GetCanonicalName(GUID* out) override{*out=rename?renameCommand:locks;return S_OK;}
 HRESULT __stdcall GetState(IShellItemArray* items,BOOL,EXPCMDSTATE* out) override{if(!out)return E_POINTER;DWORD count=0;*out=ECS_HIDDEN;if(!enabled(rename))return S_OK;
  // Explorer may query the command before supplying the selection. Validate the actual items in Invoke.
  if(!items||(SUCCEEDED(items->GetCount(&count))&&count&&count<=(rename?4096u:32u)))*out=ECS_ENABLED;return S_OK;}
 HRESULT __stdcall GetFlags(EXPCMDFLAGS* out) override{*out=ECF_DEFAULT;return S_OK;}
 HRESULT __stdcall EnumSubCommands(IEnumExplorerCommand** out) override{*out=nullptr;return E_NOTIMPL;}
 HRESULT __stdcall Invoke(IShellItemArray* items,IBindCtx*) override {
  if(!items)return E_INVALIDARG;EXPCMDSTATE state;GetState(items,FALSE,&state);if(state!=ECS_ENABLED)return E_INVALIDARG;DWORD count=0;items->GetCount(&count);std::string content=rename?"{\"tool\":\"rename\",\"paths\":[":"{\"tool\":\"locksmith\",\"paths\":[";
  for(DWORD i=0;i<count;i++){IShellItem* item=nullptr;HRESULT hr=items->GetItemAt(i,&item);if(FAILED(hr))return hr;PWSTR path=nullptr;hr=item->GetDisplayName(SIGDN_FILESYSPATH,&path);item->Release();if(FAILED(hr))return hr;if(i)content+=',';content+=json(path);CoTaskMemFree(path);if(content.size()>4*1024*1024-2)return E_INVALIDARG;}content+="]}";
  const auto root=setting(L"Profile")+L"\\shell-requests";if(setting(L"Profile").empty())return E_FAIL;if(!CreateDirectoryW(root.c_str(),nullptr)&&GetLastError()!=ERROR_ALREADY_EXISTS)return HRESULT_FROM_WIN32(GetLastError());GUID guid;HRESULT hr=CoCreateGuid(&guid);if(FAILED(hr))return hr;wchar_t id[40];StringFromGUID2(guid,id,40);std::wstring name(id+1,36),path=root+L"\\"+name+L".json";
  HANDLE file=CreateFileW(path.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(file==INVALID_HANDLE_VALUE)return HRESULT_FROM_WIN32(GetLastError());DWORD written=0;BOOL ok=WriteFile(file,content.data(),(DWORD)content.size(),&written,nullptr);CloseHandle(file);if(!ok||written!=content.size()){DeleteFileW(path.c_str());return E_FAIL;}hr=launch(path);if(FAILED(hr))DeleteFileW(path.c_str());return hr;
 }
};
class Factory final:public IClassFactory {std::atomic<ULONG> refs{1};bool rename;
public:explicit Factory(bool r):rename(r){objects++;}~Factory(){objects--;}
 HRESULT __stdcall QueryInterface(REFIID id,void** out) override{*out=nullptr;if(id==IID_IUnknown||id==IID_IClassFactory){*out=static_cast<IClassFactory*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
 ULONG __stdcall AddRef() override{return ++refs;}ULONG __stdcall Release() override{ULONG n=--refs;if(!n)delete this;return n;}
 HRESULT __stdcall CreateInstance(IUnknown* outer,REFIID id,void** out) override{if(outer)return CLASS_E_NOAGGREGATION;auto c=new Command(rename);HRESULT hr=c->QueryInterface(id,out);c->Release();return hr;}
 HRESULT __stdcall LockServer(BOOL lock) override{objects+=lock?1:-1;return S_OK;}
};
#ifndef ONE_SHELL_LAUNCHER
STDAPI DllGetClassObject(REFCLSID clsid,REFIID id,void** out){*out=nullptr;if(clsid!=locks&&clsid!=renameCommand)return CLASS_E_CLASSNOTAVAILABLE;auto factory=new Factory(clsid==renameCommand);auto hr=factory->QueryInterface(id,out);factory->Release();return hr;}
STDAPI DllCanUnloadNow(){return objects?S_FALSE:S_OK;}
#else
int WINAPI wWinMain(HINSTANCE,HINSTANCE,PWSTR,int){return FAILED(launch(L""))?1:0;}
#endif
