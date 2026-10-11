#define NOMINMAX
#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <string>
#include <vector>
#include <atomic>
#include <algorithm>
#include <cwctype>
// Read a bounded local configuration next to this DLL. No Electron process or scanning on the menu path.
static const CLSID locks={0x49a8359c,0x85b9,0x4e7a,{0x90,0x5e,0x6a,0x72,0x49,0x11,0x75,0x0a}};
static const CLSID renameCommand={0x57aba3e6,0x8d9a,0x4a16,{0xa7,0x17,0x65,0x41,0xb2,0x24,0x1a,0x36}};
static const CLSID archiveCreate={0x9e88b01d,0xc56c,0x4730,{0xb3,0xc4,0x18,0x59,0x1f,0x6a,0xe4,0x0b}};
static const CLSID archiveExtract={0x0a2b662f,0x8197,0x4bd9,{0x91,0x31,0x02,0x9b,0x52,0x9c,0x11,0x9e}};
static const CLSID archiveSmart={0xf17a6b8d,0x92b7,0x4ca0,{0xa8,0xc6,0x7c,0x4e,0x2d,0x0e,0x6c,0x11}};
static const CLSID archiveHere={0x24167ac2,0xd3c1,0x4307,{0xb8,0x35,0xba,0xc6,0xa0,0x45,0xab,0x7b}};
static const CLSID archiveFolder={0x7b9110e7,0x3a40,0x4cff,{0xa1,0x37,0x55,0x6a,0x1b,0x31,0xdf,0xc9}};
static const CLSID archiveChoose={0x36754430,0x70d1,0x4f19,{0x86,0xca,0x4c,0x28,0xc7,0xe5,0x91,0x83}};
static const CLSID archiveZip={0xb8f1470d,0x6f45,0x42a7,{0x93,0x09,0x82,0xd6,0xed,0x24,0x79,0xa1}};
static const CLSID archiveSeven={0xc5d4196f,0x632a,0x46d1,{0xaf,0x23,0x9b,0x16,0xd2,0x8a,0x01,0x95}};
static const CLSID archiveConfigure={0x5bb2c95e,0xe30a,0x471b,{0x8a,0x87,0x74,0xed,0x9c,0x41,0x72,0xe3}};
enum class Action {locksmith,rename,archiveCreate,archiveZip,archiveSeven,archiveConfigure,archiveExtract,archiveSmart,archiveHere,archiveFolder,archiveChoose};
static bool extraction(Action action){return action>=Action::archiveExtract;}
static const wchar_t* flag(Action action){switch(action){case Action::locksmith:return L"Locksmith";case Action::rename:return L"Rename";case Action::archiveCreate:return L"ArchiveCreate";default:return L"ArchiveExtract";}}
static const wchar_t* title(Action action){switch(action){case Action::locksmith:return L"文件占用";case Action::rename:return L"批量重命名";case Action::archiveCreate:return L"创建压缩包";case Action::archiveZip:return L"压缩为 ZIP";case Action::archiveSeven:return L"压缩为 7Z";case Action::archiveConfigure:return L"创建压缩包…";case Action::archiveSmart:return L"智能解压";case Action::archiveHere:return L"解压到当前文件夹";case Action::archiveFolder:return L"解压到同名文件夹";case Action::archiveChoose:return L"选择解压路径…";default:return L"解压压缩包";}}
static const char* tool(Action action){switch(action){case Action::locksmith:return "locksmith";case Action::rename:return "rename";case Action::archiveCreate:case Action::archiveConfigure:return "archive-create";case Action::archiveZip:return "archive-create-zip";case Action::archiveSeven:return "archive-create-7z";case Action::archiveSmart:return "archive-smart";case Action::archiveHere:return "archive-here";case Action::archiveFolder:return "archive-folder";case Action::archiveChoose:return "archive-choose";default:return "archive-extract";}}
static const CLSID& canonical(Action action){switch(action){case Action::locksmith:return locks;case Action::rename:return renameCommand;case Action::archiveCreate:return archiveCreate;case Action::archiveZip:return archiveZip;case Action::archiveSeven:return archiveSeven;case Action::archiveConfigure:return archiveConfigure;case Action::archiveSmart:return archiveSmart;case Action::archiveHere:return archiveHere;case Action::archiveFolder:return archiveFolder;case Action::archiveChoose:return archiveChoose;default:return archiveExtract;}}
static DWORD limit(Action action){switch(action){case Action::locksmith:return 32;case Action::rename:return 4096;default:return 128;}}
static bool archive_path(std::wstring path){std::transform(path.begin(),path.end(),path.begin(),[](wchar_t c){return std::towlower(c);});if(path.size()>=4){const auto end=path.substr(path.size()-4);if(end[0]==L'.'&&((end[1]>=L'a'&&end[1]<=L'k')||end[1]==L'z')&&end[2]>=L'0'&&end[2]<=L'9'&&end[3]>=L'0'&&end[3]<=L'9')return true;}for(const auto extension:{L".zip",L".7z",L".7z.001",L".rar",L".r00",L".tar",L".tar.gz",L".tgz",L".gz",L".tar.xz",L".txz",L".xz",L".zipx",L".jar",L".apk",L".bz2",L".bzip2",L".tbz",L".tbz2",L".zst",L".zstd",L".tzst",L".cab",L".lha",L".lzh",L".iso",L".wim",L".alz",L".egg"})if(path.ends_with(extension))return true;return false;}
static std::atomic<long> objects=0;
static std::wstring setting(const wchar_t* name){
 HMODULE module=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,(LPCWSTR)&setting,&module))return{};std::vector<wchar_t> path(32768);DWORD length=GetModuleFileNameW(module,path.data(),(DWORD)path.size());if(!length||length>=path.size())return{};std::wstring file(path.data(),length);file=file.substr(0,file.find_last_of(L"\\/"))+L"\\shell-config.bin";
 HANDLE input=CreateFileW(file.c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);if(input==INVALID_HANDLE_VALUE)return{};DWORD size=GetFileSize(input,nullptr);if(size>256*1024||size%2){CloseHandle(input);return{};}std::vector<wchar_t> content(size/2+1,0);DWORD read=0;BOOL ok=ReadFile(input,content.data(),size,&read,nullptr);CloseHandle(input);if(!ok||read!=size)return{};
 const wchar_t* names[]={L"Executable",L"AppPath",L"Profile",L"Icon",L"Locksmith",L"Rename",L"ArchiveCreate",L"ArchiveExtract"};size_t offset=0;for(auto field:names){if(offset>=content.size())return{};const wchar_t* value=content.data()+offset;size_t count=wcslen(value);if(offset+count>=content.size())return{};if(wcscmp(name,field)==0)return value;offset+=count+1;}return{};
}
static bool enabled(Action action){return setting(flag(action))==L"1";}
static std::wstring quote(const std::wstring& s){std::wstring out=L"\"";unsigned slashes=0;for(wchar_t c:s){if(c==L'\\'){slashes++;continue;}if(c==L'\"'){out.append(slashes*2+1,L'\\');out+=c;}else{out.append(slashes,L'\\');out+=c;}slashes=0;}out.append(slashes*2,L'\\');return out+L"\"";}
static std::string utf8(const std::wstring& s){int size=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);if(!size)return{};std::string out(size,'\0');WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,s.data(),(int)s.size(),out.data(),size,nullptr,nullptr);return out;}
static std::string json(const std::wstring& s){std::string out="\"";for(unsigned char c:utf8(s)){if(c=='"'||c=='\\')out+='\\';if(c<32){char hex[7];sprintf_s(hex,"\\u%04x",c);out+=hex;}else out+=(char)c;}return out+'"';}
static HRESULT launch(const std::wstring& request){const auto exe=setting(L"Executable"),prefix=setting(L"AppPath"),profile=setting(L"Profile");if(exe.empty()||profile.empty())return E_FAIL;
 std::wstring command=quote(exe)+(prefix.empty()?L"":L" "+quote(prefix))+(request.empty()?L"":L" "+quote(L"--one-shell-request="+request));
 std::vector<std::wstring> vars;wchar_t* environment=GetEnvironmentStringsW();if(!environment)return HRESULT_FROM_WIN32(GetLastError());for(const wchar_t* p=environment;*p;p+=wcslen(p)+1)if(_wcsnicmp(p,L"ONE_DATA_DIR=",13)&&_wcsnicmp(p,L"ONE_DEVELOPMENT=",16))vars.emplace_back(p);FreeEnvironmentStringsW(environment);vars.push_back(L"ONE_DATA_DIR="+profile);if(!prefix.empty())vars.push_back(L"ONE_DEVELOPMENT=1");std::sort(vars.begin(),vars.end(),[](const auto&a,const auto&b){return _wcsicmp(a.c_str(),b.c_str())<0;});std::vector<wchar_t> block;for(const auto& v:vars){block.insert(block.end(),v.begin(),v.end());block.push_back(0);}block.push_back(0);
 STARTUPINFOW startup{sizeof(startup)};PROCESS_INFORMATION process{};if(!CreateProcessW(exe.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_UNICODE_ENVIRONMENT,block.data(),nullptr,&startup,&process))return HRESULT_FROM_WIN32(GetLastError());CloseHandle(process.hThread);CloseHandle(process.hProcess);return S_OK;
}
class Command final:public IExplorerCommand {
 std::atomic<ULONG> refs{1};Action action;
public:explicit Command(Action a):action(a){objects++;}~Command(){objects--;}
 HRESULT __stdcall QueryInterface(REFIID id,void** out) override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IExplorerCommand){*out=static_cast<IExplorerCommand*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
 ULONG __stdcall AddRef() override{return ++refs;}ULONG __stdcall Release() override{ULONG n=--refs;if(!n)delete this;return n;}
 HRESULT __stdcall GetTitle(IShellItemArray* items,PWSTR* out) override{
  if(action!=Action::archiveZip&&action!=Action::archiveSeven)return SHStrDupW(title(action),out);
  std::wstring stem=L"选中项";DWORD count=0;
  if(items&&SUCCEEDED(items->GetCount(&count))&&count==1){IShellItem* item=nullptr;if(SUCCEEDED(items->GetItemAt(0,&item))&&item){PWSTR path=nullptr;if(SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH,&path))&&path){std::wstring name=path;const auto slash=name.find_last_of(L"\\/");if(slash!=std::wstring::npos)name.erase(0,slash+1);const auto dot=name.find_last_of(L'.');if(dot!=std::wstring::npos&&dot>0)name.erase(dot);if(!name.empty())stem=name.substr(0,32);CoTaskMemFree(path);}item->Release();}}
  return SHStrDupW((L"压缩为 "+stem+(action==Action::archiveZip?L".zip":L".7z")).c_str(),out);
 }
 HRESULT __stdcall GetIcon(IShellItemArray*,PWSTR* out) override{const auto icon=setting(L"Icon");return icon.empty()?E_NOTIMPL:SHStrDupW(icon.c_str(),out);}
 HRESULT __stdcall GetToolTip(IShellItemArray*,PWSTR* out) override{if(!out)return E_POINTER;*out=nullptr;return E_NOTIMPL;}
 HRESULT __stdcall GetCanonicalName(GUID* out) override{if(!out)return E_POINTER;*out=canonical(action);return S_OK;}
 HRESULT __stdcall GetState(IShellItemArray* items,BOOL,EXPCMDSTATE* out) override{if(!out)return E_POINTER;DWORD count=0;*out=ECS_HIDDEN;if(!enabled(action))return S_OK;
  // Explorer may query the command before supplying the selection. Validate the actual items in Invoke.
  if(!items){*out=ECS_ENABLED;return S_OK;}
  if(FAILED(items->GetCount(&count))||!count||count>limit(action))return S_OK;
  if(extraction(action))for(DWORD i=0;i<count;i++){IShellItem* item=nullptr;if(FAILED(items->GetItemAt(i,&item))||!item)return S_OK;SFGAOF attributes=0;HRESULT kind=item->GetAttributes(SFGAO_FOLDER,&attributes);PWSTR path=nullptr;HRESULT hr=item->GetDisplayName(SIGDN_FILESYSPATH,&path);item->Release();if(FAILED(kind)||(attributes&SFGAO_FOLDER)||FAILED(hr)||!path){CoTaskMemFree(path);return S_OK;}bool supported=archive_path(path);CoTaskMemFree(path);if(!supported)return S_OK;}
  *out=ECS_ENABLED;return S_OK;}
 HRESULT __stdcall GetFlags(EXPCMDFLAGS* out) override{if(!out)return E_POINTER;*out=action==Action::archiveExtract||action==Action::archiveCreate?ECF_HASSUBCOMMANDS:ECF_DEFAULT;return S_OK;}
 HRESULT __stdcall EnumSubCommands(IEnumExplorerCommand** out) override;
 HRESULT __stdcall Invoke(IShellItemArray* items,IBindCtx*) override {
  if(!items)return E_INVALIDARG;EXPCMDSTATE state;GetState(items,FALSE,&state);if(state!=ECS_ENABLED)return E_INVALIDARG;DWORD count=0;items->GetCount(&count);std::string content="{\"tool\":\""+std::string(tool(action))+"\",\"paths\":[";
  for(DWORD i=0;i<count;i++){IShellItem* item=nullptr;HRESULT hr=items->GetItemAt(i,&item);if(FAILED(hr))return hr;PWSTR path=nullptr;hr=item->GetDisplayName(SIGDN_FILESYSPATH,&path);item->Release();if(FAILED(hr))return hr;if(i)content+=',';content+=json(path);CoTaskMemFree(path);if(content.size()>4*1024*1024-2)return E_INVALIDARG;}content+="]}";
  const auto root=setting(L"Profile")+L"\\shell-requests";if(setting(L"Profile").empty())return E_FAIL;if(!CreateDirectoryW(root.c_str(),nullptr)&&GetLastError()!=ERROR_ALREADY_EXISTS)return HRESULT_FROM_WIN32(GetLastError());GUID guid;HRESULT hr=CoCreateGuid(&guid);if(FAILED(hr))return hr;wchar_t id[40];StringFromGUID2(guid,id,40);std::wstring name(id+1,36),path=root+L"\\"+name+L".json";
  HANDLE file=CreateFileW(path.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);if(file==INVALID_HANDLE_VALUE)return HRESULT_FROM_WIN32(GetLastError());DWORD written=0;BOOL ok=WriteFile(file,content.data(),(DWORD)content.size(),&written,nullptr);CloseHandle(file);if(!ok||written!=content.size()){DeleteFileW(path.c_str());return E_FAIL;}hr=launch(path);if(FAILED(hr))DeleteFileW(path.c_str());return hr;
 }
};
class Commands final:public IEnumExplorerCommand {
 std::atomic<ULONG> refs{1};ULONG position=0;const bool create;
 static constexpr Action extractActions[]={Action::archiveSmart,Action::archiveHere,Action::archiveFolder,Action::archiveChoose};
 static constexpr Action createActions[]={Action::archiveZip,Action::archiveSeven,Action::archiveConfigure};
 ULONG length() const{return create?3:4;}
public:explicit Commands(bool create,ULONG start=0):position(start),create(create){objects++;}~Commands(){objects--;}
 HRESULT __stdcall QueryInterface(REFIID id,void** out) override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IEnumExplorerCommand){*out=static_cast<IEnumExplorerCommand*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
 ULONG __stdcall AddRef() override{return ++refs;}ULONG __stdcall Release() override{ULONG n=--refs;if(!n)delete this;return n;}
 HRESULT __stdcall Next(ULONG count,IExplorerCommand** out,ULONG* fetched) override{if(fetched)*fetched=0;if(!out)return E_POINTER;ULONG n=0;for(;n<count&&position<length();n++,position++)out[n]=new Command(create?createActions[position]:extractActions[position]);if(fetched)*fetched=n;return n==count?S_OK:S_FALSE;}
 HRESULT __stdcall Skip(ULONG count) override{const ULONG n=std::min(count,length()-position);position+=n;return n==count?S_OK:S_FALSE;}
 HRESULT __stdcall Reset() override{position=0;return S_OK;}
 HRESULT __stdcall Clone(IEnumExplorerCommand** out) override{if(!out)return E_POINTER;*out=new Commands(create,position);return S_OK;}
};
HRESULT Command::EnumSubCommands(IEnumExplorerCommand** out){if(!out)return E_POINTER;*out=nullptr;if(action!=Action::archiveExtract&&action!=Action::archiveCreate)return E_NOTIMPL;*out=new Commands(action==Action::archiveCreate);return S_OK;}
class Factory final:public IClassFactory {std::atomic<ULONG> refs{1};Action action;
public:explicit Factory(Action a):action(a){objects++;}~Factory(){objects--;}
 HRESULT __stdcall QueryInterface(REFIID id,void** out) override{*out=nullptr;if(id==IID_IUnknown||id==IID_IClassFactory){*out=static_cast<IClassFactory*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
 ULONG __stdcall AddRef() override{return ++refs;}ULONG __stdcall Release() override{ULONG n=--refs;if(!n)delete this;return n;}
 HRESULT __stdcall CreateInstance(IUnknown* outer,REFIID id,void** out) override{if(outer)return CLASS_E_NOAGGREGATION;auto c=new Command(action);HRESULT hr=c->QueryInterface(id,out);c->Release();return hr;}
 HRESULT __stdcall LockServer(BOOL lock) override{objects+=lock?1:-1;return S_OK;}
};
#ifndef ONE_SHELL_LAUNCHER
STDAPI DllGetClassObject(REFCLSID clsid,REFIID id,void** out){*out=nullptr;Action action;if(clsid==locks)action=Action::locksmith;else if(clsid==renameCommand)action=Action::rename;else if(clsid==archiveCreate)action=Action::archiveCreate;else if(clsid==archiveExtract)action=Action::archiveExtract;else return CLASS_E_CLASSNOTAVAILABLE;auto factory=new Factory(action);auto hr=factory->QueryInterface(id,out);factory->Release();return hr;}
STDAPI DllCanUnloadNow(){return objects?S_FALSE:S_OK;}
#else
int WINAPI wWinMain(HINSTANCE,HINSTANCE,PWSTR,int){return FAILED(launch(L""))?1:0;}
#endif
