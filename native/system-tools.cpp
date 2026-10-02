#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <psapi.h>
#include <string>
#include <vector>
#include <map>
#include <set>
#include <sstream>
#include <iostream>
#include <algorithm>
#include <cwctype>

// Small, isolated, read-only handle queries. A parent timeout can terminate this
// helper if a filesystem driver blocks an object query, without freezing One.
struct HandleEntry { void* object; ULONG_PTR pid,handle; ULONG access; USHORT trace,type; ULONG attributes,reserved; };
struct HandleTable { ULONG_PTR count,reserved; HandleEntry entries[1]; };
using QuerySystem=LONG(NTAPI*)(ULONG,PVOID,ULONG,PULONG);
std::string utf8(const std::wstring& s){int n=WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);std::string out(n,0);WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),out.data(),n,nullptr,nullptr);return out;}
std::string quoted(const std::wstring& w){const auto s=utf8(w);std::string out="\"";for(unsigned char c:s){if(c=='"'||c=='\\'){out+='\\';out+=c;}else if(c<32){char b[7];sprintf_s(b,"\\u%04x",c);out+=b;}else out+=c;}return out+'"';}
std::wstring pathKey(std::wstring s){if(s.rfind(L"\\\\?\\UNC\\",0)==0)s=L"\\\\"+s.substr(8);else if(s.rfind(L"\\\\?\\",0)==0)s=s.substr(4);std::replace(s.begin(),s.end(),L'/',L'\\');while(s.size()>3&&s.back()==L'\\')s.pop_back();std::transform(s.begin(),s.end(),s.begin(),towlower);return s;}
struct Handle { HANDLE value=nullptr;Handle(HANDLE h):value(h){}~Handle(){if(value&&value!=INVALID_HANDLE_VALUE)CloseHandle(value);}operator HANDLE()const{return value;} };
std::wstring processPath(HANDLE p){std::wstring s(32768,L'\0');DWORD n=(DWORD)s.size();if(!QueryFullProcessImageNameW(p,0,s.data(),&n))return L"";s.resize(n);return s;}
std::string created(HANDLE p){FILETIME c,e,k,u;if(!GetProcessTimes(p,&c,&e,&k,&u))return "";return std::to_string((static_cast<unsigned long long>(c.dwHighDateTime)<<32)|c.dwLowDateTime);}
std::wstring handlePath(HANDLE h){std::wstring s(32768,L'\0');DWORD n=GetFinalPathNameByHandleW(h,s.data(),(DWORD)s.size(),FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);if(!n||n>=s.size())return L"";s.resize(n);if(s.rfind(L"\\\\?\\UNC\\",0)==0)return L"\\\\"+s.substr(8);if(s.rfind(L"\\\\?\\",0)==0)return s.substr(4);return s;}
void snapshot(){
  wchar_t self[32768];GetModuleFileNameW(nullptr,self,32768);Handle probe(CreateFileW(self,0,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,0,nullptr));
  auto query=reinterpret_cast<QuerySystem>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtQuerySystemInformation"));if(!query||probe.value==INVALID_HANDLE_VALUE)throw std::runtime_error("Cannot enumerate file handles");
  std::vector<BYTE> bytes(1<<20);ULONG needed=0;LONG status;
  while((status=query(64,bytes.data(),(ULONG)bytes.size(),&needed))==static_cast<LONG>(0xC0000004)){size_t next=std::max(bytes.size()*2,(size_t)needed+4096);if(next>256*1024*1024)throw std::runtime_error("Handle snapshot exceeds limit");bytes.resize(next);}
  if(status<0)throw std::runtime_error("Handle snapshot unavailable");auto table=reinterpret_cast<HandleTable*>(bytes.data());
  if(table->count>(bytes.size()-2*sizeof(ULONG_PTR))/sizeof(HandleEntry))throw std::runtime_error("Invalid handle snapshot");USHORT type=0;
  for(size_t i=0;i<table->count;i++){auto& e=table->entries[i];if(e.pid==GetCurrentProcessId()&&e.handle==reinterpret_cast<ULONG_PTR>(probe.value)){type=e.type;break;}}
  if(!type)throw std::runtime_error("Cannot identify file handle type");std::map<DWORD,std::vector<ULONG_PTR>> processes;
  for(size_t i=0;i<table->count;i++){auto& e=table->entries[i];if(e.type==type&&e.pid!=GetCurrentProcessId()&&e.pid>4)processes[(DWORD)e.pid].push_back(e.handle);}
  // Include processes with mapped executable/DLL files even when no open file handle remains.
  DWORD ids[65536],size=0;if(EnumProcesses(ids,sizeof(ids),&size))for(DWORD i=0;i<size/sizeof(DWORD);i++)if(ids[i]>4&&ids[i]!=GetCurrentProcessId())processes[ids[i]];
  std::cout<<"{\"processes\":[";bool comma=false;for(const auto& [pid,handles]:processes){if(comma)std::cout<<',';comma=true;std::cout<<"{\"pid\":"<<pid<<",\"handles\":[";bool hcomma=false;for(auto h:handles){if(hcomma)std::cout<<',';hcomma=true;std::cout<<'"'<<h<<'"';}std::cout<<"]}";}std::cout<<"]}\n";
}
void inspect(DWORD pid,const wchar_t* handles,int argc,wchar_t** argv){
  Handle process(OpenProcess(PROCESS_DUP_HANDLE|PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid));if(!process.value){std::cout<<"{\"pid\":"<<pid<<",\"denied\":true}\n";return;}
  std::vector<std::pair<std::wstring,bool>> targets;for(int i=4;i<argc;i++){DWORD a=GetFileAttributesW(argv[i]);targets.emplace_back(pathKey(argv[i]),a!=INVALID_FILE_ATTRIBUTES&&(a&FILE_ATTRIBUTE_DIRECTORY));}
  std::set<std::wstring> matches;auto check=[&](const std::wstring& path){auto key=pathKey(path);for(const auto& [target,directory]:targets)if(key==target||(directory&&key.size()>target.size()&&key.compare(0,target.size(),target)==0&&(target.back()==L'\\'||key[target.size()]==L'\\'))){matches.insert(path);break;}};
  std::wstringstream list(handles);std::wstring item;while(std::getline(list,item,L',')){if(item.empty())continue;HANDLE copy=nullptr;if(!DuplicateHandle(process,reinterpret_cast<HANDLE>(std::stoull(item)),GetCurrentProcess(),&copy,0,FALSE,DUPLICATE_SAME_ACCESS))continue;Handle local(copy);if(GetFileType(local)!=FILE_TYPE_DISK)continue;check(handlePath(local));}
  auto name=processPath(process);check(name);bool modulesDenied=false;
  Handle modulesProcess(OpenProcess(PROCESS_QUERY_INFORMATION|PROCESS_VM_READ,FALSE,pid));
  if(modulesProcess.value){std::vector<HMODULE> mods(512);DWORD needed=0;if(EnumProcessModulesEx(modulesProcess,mods.data(),(DWORD)(mods.size()*sizeof(HMODULE)),&needed,LIST_MODULES_ALL)){if(needed>mods.size()*sizeof(HMODULE)){mods.resize(needed/sizeof(HMODULE));if(!EnumProcessModulesEx(modulesProcess,mods.data(),needed,&needed,LIST_MODULES_ALL))needed=0;}mods.resize(std::min(mods.size(),(size_t)needed/sizeof(HMODULE)));for(auto mod:mods){wchar_t file[32768];DWORD n=GetModuleFileNameExW(modulesProcess,mod,file,32768);if(n)check(std::wstring(file,n));}}else modulesDenied=true;}else modulesDenied=true;
  std::cout<<"{\"pid\":"<<pid<<",\"created\":\""<<created(process)<<"\",\"process\":"<<quoted(name)<<",\"modulesDenied\":"<<(modulesDenied?"true":"false")<<",\"files\":[";bool comma=false;for(const auto& file:matches){if(comma)std::cout<<',';comma=true;std::cout<<quoted(file);}std::cout<<"]}\n";
}
void terminate(DWORD pid,const wchar_t* expected){
  if(pid<=4||pid==GetCurrentProcessId())throw std::runtime_error("Protected process");Handle p(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_TERMINATE,FALSE,pid));if(!p.value)throw std::runtime_error("Process unavailable or access denied");
  if(created(p)!=utf8(expected))throw std::runtime_error("Process changed; scan again");BOOL critical=TRUE;if(!IsProcessCritical(p,&critical)||critical)throw std::runtime_error("Critical process cannot be ended");
  wchar_t windows[32768];GetWindowsDirectoryW(windows,32768);auto name=pathKey(processPath(p)),root=pathKey(windows)+L"\\";if(name.rfind(root,0)==0)throw std::runtime_error("Windows system process cannot be ended here");
  if(!TerminateProcess(p,1))throw std::runtime_error("End process failed");std::cout<<"{\"ended\":true}\n";
}
#include "font-list.h"
int wmain(int argc,wchar_t** argv){try{if(argc==2&&wcscmp(argv[1],L"fonts")==0)fontList();else if(argc==3&&wcscmp(argv[1],L"font-source")==0)fontSource(argv[2]);else if(argc>=2&&wcscmp(argv[1],L"snapshot")==0)snapshot();else if(argc>=5&&wcscmp(argv[1],L"inspect")==0)inspect(std::stoul(argv[2]),argv[3],argc,argv);else if(argc==4&&wcscmp(argv[1],L"end")==0)terminate(std::stoul(argv[2]),argv[3]);else throw std::runtime_error("Invalid arguments");return 0;}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
