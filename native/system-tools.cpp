#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <psapi.h>
#include <shellapi.h>
#include <winternl.h>
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
bool titleHasFileName(const std::wstring& title,const std::wstring& file){
  auto lower=[](std::wstring value){std::transform(value.begin(),value.end(),value.begin(),towlower);return value;};
  const auto text=lower(title),name=lower(file);if(name.empty())return false;
  auto contains=[&](const std::wstring& needle){size_t at=0;while((at=text.find(needle,at))!=std::wstring::npos){const size_t end=at+needle.size();const bool before=at==0||wcschr(L" *([{",text[at-1]);const bool after=end==text.size()||wcschr(L" )]}",text[end]);if(before&&after)return true;at++;}return false;};
  if(contains(name))return true;
  const auto dot=name.find_last_of(L'.');return dot!=std::wstring::npos&&dot>=4&&contains(name.substr(0,dot));
}
std::set<std::wstring> matchingWindowTitles(DWORD pid,const std::vector<std::pair<std::wstring,bool>>& targets){
  struct Context {DWORD pid;const std::vector<std::pair<std::wstring,bool>>* targets;std::set<std::wstring> titles;} context{pid,&targets,{}};
  EnumWindows([](HWND window,LPARAM value)->BOOL{auto& ctx=*reinterpret_cast<Context*>(value);DWORD owner=0;GetWindowThreadProcessId(window,&owner);if(owner!=ctx.pid||!IsWindowVisible(window))return TRUE;
    int length=GetWindowTextLengthW(window);if(length<=0||length>32767)return TRUE;std::wstring title(length+1,L'\0');int copied=GetWindowTextW(window,title.data(),length+1);if(copied<=0)return TRUE;title.resize(copied);
    for(const auto& [target,directory]:*ctx.targets){if(directory)continue;auto slash=target.find_last_of(L"\\/");auto name=target.substr(slash==std::wstring::npos?0:slash+1);if(titleHasFileName(title,name)){ctx.titles.insert(title);break;}}return TRUE;
  },reinterpret_cast<LPARAM>(&context));return context.titles;
}
std::wstring processPath(HANDLE p){std::wstring s(32768,L'\0');DWORD n=(DWORD)s.size();if(!QueryFullProcessImageNameW(p,0,s.data(),&n))return L"";s.resize(n);return s;}
std::string created(HANDLE p){FILETIME c,e,k,u;if(!GetProcessTimes(p,&c,&e,&k,&u))return "";return std::to_string((static_cast<unsigned long long>(c.dwHighDateTime)<<32)|c.dwLowDateTime);}
std::wstring handlePath(HANDLE h){std::wstring s(32768,L'\0');DWORD n=GetFinalPathNameByHandleW(h,s.data(),(DWORD)s.size(),FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);if(!n||n>=s.size())return L"";s.resize(n);if(s.rfind(L"\\\\?\\UNC\\",0)==0)return L"\\\\"+s.substr(8);if(s.rfind(L"\\\\?\\",0)==0)return s.substr(4);return s;}
std::wstring processCommandLine(HANDLE process){
  if(!process)return L"";
  using QueryProcess=LONG(NTAPI*)(HANDLE,PROCESSINFOCLASS,PVOID,ULONG,PULONG);
  auto query=reinterpret_cast<QueryProcess>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtQueryInformationProcess"));
  PROCESS_BASIC_INFORMATION basic{};PEB peb{};RTL_USER_PROCESS_PARAMETERS parameters{};SIZE_T read=0;
  if(!query||query(process,ProcessBasicInformation,&basic,sizeof(basic),nullptr)<0||!basic.PebBaseAddress)return L"";
  if(!ReadProcessMemory(process,basic.PebBaseAddress,&peb,sizeof(peb),&read)||read!=sizeof(peb)||!peb.ProcessParameters)return L"";
  if(!ReadProcessMemory(process,peb.ProcessParameters,&parameters,sizeof(parameters),&read)||read!=sizeof(parameters))return L"";
  auto line=parameters.CommandLine;if(!line.Buffer||!line.Length||line.Length>65534||line.Length%sizeof(wchar_t))return L"";
  std::wstring value(line.Length/sizeof(wchar_t),L'\0');
  if(!ReadProcessMemory(process,line.Buffer,value.data(),line.Length,&read)||read!=line.Length)return L"";
  return value;
}
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
void inspect(DWORD pid,const wchar_t* handles,int argc,wchar_t** argv,int firstTarget){
  Handle process(OpenProcess(PROCESS_DUP_HANDLE|PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid));
  Handle modulesProcess(OpenProcess(PROCESS_QUERY_INFORMATION|PROCESS_VM_READ,FALSE,pid));
  std::vector<std::pair<std::wstring,bool>> targets;for(int i=firstTarget;i<argc;i++){DWORD a=GetFileAttributesW(argv[i]);targets.emplace_back(pathKey(argv[i]),a!=INVALID_FILE_ATTRIBUTES&&(a&FILE_ATTRIBUTE_DIRECTORY));}
  const auto windowTitles=matchingWindowTitles(pid,targets);
  if(!process.value&&!modulesProcess.value){std::cout<<"{\"pid\":"<<pid<<",\"denied\":true,\"windows\":[";bool comma=false;for(const auto& title:windowTitles){if(comma)std::cout<<',';comma=true;std::cout<<quoted(title);}std::cout<<"]}\n";return;}
  auto matchesTarget=[&](const std::wstring& path){auto key=pathKey(path);for(const auto& [target,directory]:targets)if(key==target||(directory&&key.size()>target.size()&&key.compare(0,target.size(),target)==0&&(target.back()==L'\\'||key[target.size()]==L'\\')))return true;return false;};
  std::set<std::wstring> matches,references;auto check=[&](const std::wstring& path){if(matchesTarget(path))matches.insert(path);};
  if(process.value){std::wstringstream list(handles);std::wstring item;while(std::getline(list,item,L',')){if(item.empty())continue;HANDLE copy=nullptr;if(!DuplicateHandle(process,reinterpret_cast<HANDLE>(std::stoull(item)),GetCurrentProcess(),&copy,0,FALSE,DUPLICATE_SAME_ACCESS))continue;Handle local(copy);if(GetFileType(local)!=FILE_TYPE_DISK)continue;check(handlePath(local));}}
  HANDLE metadataProcess=process.value?process.value:modulesProcess.value;
  auto name=processPath(metadataProcess);check(name);bool modulesDenied=false;
  if(modulesProcess.value){std::vector<HMODULE> mods(512);DWORD needed=0;if(EnumProcessModulesEx(modulesProcess,mods.data(),(DWORD)(mods.size()*sizeof(HMODULE)),&needed,LIST_MODULES_ALL)){if(needed>mods.size()*sizeof(HMODULE)){mods.resize(needed/sizeof(HMODULE));if(!EnumProcessModulesEx(modulesProcess,mods.data(),needed,&needed,LIST_MODULES_ALL))needed=0;}mods.resize(std::min(mods.size(),(size_t)needed/sizeof(HMODULE)));for(auto mod:mods){wchar_t file[32768];DWORD n=GetModuleFileNameExW(modulesProcess,mod,file,32768);if(n)check(std::wstring(file,n));}}else modulesDenied=true;}else modulesDenied=true;
  auto command=processCommandLine(modulesProcess);if(!command.empty()){int count=0;LPWSTR* args=CommandLineToArgvW(command.c_str(),&count);if(args){for(int i=1;i<count;i++){std::wstring path(args[i]);if(matchesTarget(path))references.insert(path);}LocalFree(args);}}
  std::cout<<"{\"pid\":"<<pid<<",\"created\":\""<<created(metadataProcess)<<"\",\"process\":"<<quoted(name)<<",\"denied\":"<<(!process.value?"true":"false")<<",\"modulesDenied\":"<<(modulesDenied?"true":"false")<<",\"files\":[";bool comma=false;for(const auto& file:matches){if(comma)std::cout<<',';comma=true;std::cout<<quoted(file);}std::cout<<"],\"references\":[";comma=false;for(const auto& file:references){if(comma)std::cout<<',';comma=true;std::cout<<quoted(file);}std::cout<<"],\"windows\":[";comma=false;for(const auto& title:windowTitles){if(comma)std::cout<<',';comma=true;std::cout<<quoted(title);}std::cout<<"]}\n";
}
void terminate(DWORD pid,const wchar_t* expected){
  if(pid<=4||pid==GetCurrentProcessId())throw std::runtime_error("Protected process");Handle p(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_TERMINATE,FALSE,pid));if(!p.value)throw std::runtime_error("Process unavailable or access denied");
  if(created(p)!=utf8(expected))throw std::runtime_error("Process changed; scan again");BOOL critical=TRUE;if(!IsProcessCritical(p,&critical)||critical)throw std::runtime_error("Critical process cannot be ended");
  wchar_t windows[32768];GetWindowsDirectoryW(windows,32768);auto name=pathKey(processPath(p)),root=pathKey(windows)+L"\\";if(name.rfind(root,0)==0)throw std::runtime_error("Windows system process cannot be ended here");
  if(!TerminateProcess(p,1))throw std::runtime_error("End process failed");std::cout<<"{\"ended\":true}\n";
}
#include "font-list.h"
int wmain(int argc,wchar_t** argv){try{if(argc==2&&wcscmp(argv[1],L"fonts")==0)fontList();else if(argc==3&&wcscmp(argv[1],L"font-source")==0)fontSource(argv[2]);else if(argc>=2&&wcscmp(argv[1],L"snapshot")==0)snapshot();else if(argc>=3&&wcscmp(argv[1],L"inspect-batch")==0){std::string line;while(std::getline(std::cin,line)){auto divider=line.find('\t');if(divider==std::string::npos)throw std::runtime_error("Invalid batch input");std::wstring handles(line.begin()+divider+1,line.end());inspect(std::stoul(line.substr(0,divider)),handles.c_str(),argc,argv,2);std::cout.flush();}}else if(argc>=5&&wcscmp(argv[1],L"inspect")==0)inspect(std::stoul(argv[2]),argv[3],argc,argv,4);else if(argc==4&&wcscmp(argv[1],L"end")==0)terminate(std::stoul(argv[2]),argv[3]);else throw std::runtime_error("Invalid arguments");return 0;}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
