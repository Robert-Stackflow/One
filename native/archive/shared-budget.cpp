#define NOMINMAX
#include <windows.h>
#include <sddl.h>
#include <bcrypt.h>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include "shared-budget.h"
#ifndef ONE_BUDGET_DLL
#include "common.h"
#include "resources.h"
#endif

namespace {
using U64=uint64_t;
constexpr uint32_t magic=0x31424741,client_count=64,task_count=256;
struct Process {uint32_t pid=0;U64 born=0;};
struct Budget {uint32_t concurrent=0,memory=0,threads=0;};
struct Client {U64 owner=0;Process process;Budget budget;};
struct Task {char id[37]{};U64 owner=0,ticket=0;uint32_t state=0,memory=0,threads=0;Process child;};
struct State {uint32_t version=magic;U64 ticket=0;Client clients[client_count]{};Task tasks[task_count]{};};
struct Bank {U64 sequence=0,checksum=0;State state;};
struct Mapping {Bank banks[2];};
thread_local std::wstring last_error;
[[noreturn]] void error(const wchar_t *message){last_error=message;throw std::runtime_error("archive coordination failed");}
U64 checksum(const State &state){U64 result=14695981039346656037ull;const auto bytes=reinterpret_cast<const unsigned char*>(&state);for(size_t i=0;i<sizeof(state);++i)result=(result^bytes[i])*1099511628211ull;return result;}
U64 born(HANDLE handle){FILETIME created{},exit{},kernel{},user{};if(!GetProcessTimes(handle,&created,&exit,&kernel,&user))error(L"Cannot inspect archive process");return (U64(created.dwHighDateTime)<<32)|created.dwLowDateTime;}
bool alive(Process process){
 if(!process.pid||!process.born)return false;
 const auto handle=OpenProcess(SYNCHRONIZE|PROCESS_QUERY_LIMITED_INFORMATION,FALSE,process.pid);
 if(!handle){if(GetLastError()==ERROR_INVALID_PARAMETER)return false;return true;}// Access denied is not proof of exit.
 bool result=true;try{const auto wait=WaitForSingleObject(handle,0);result=wait!=WAIT_OBJECT_0&&born(handle)==process.born;}catch(...){result=true;}CloseHandle(handle);return result;
}
bool valid(Budget b){return b.concurrent>=1&&b.concurrent<=8&&b.memory>=128&&b.memory<=32768&&b.threads>=1&&b.threads<=64;}
bool valid_id(const char *id){if(!id||std::strlen(id)!=36)return false;for(size_t i=0;i<36;++i){if(i==8||i==13||i==18||i==23){if(id[i]!='-')return false;}else if(!(id[i]>='0'&&id[i]<='9')&&!(id[i]>='a'&&id[i]<='f')&&!(id[i]>='A'&&id[i]<='F'))return false;}return true;}
std::wstring sid(){
 HANDLE token=nullptr;if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token))error(L"Cannot read archive user");
 DWORD size=0;GetTokenInformation(token,TokenUser,nullptr,0,&size);std::unique_ptr<unsigned char[]> bytes(new unsigned char[size]);
 if(!GetTokenInformation(token,TokenUser,bytes.get(),size,&size)){CloseHandle(token);error(L"Cannot read archive user");}CloseHandle(token);
 wchar_t *value=nullptr;if(!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(bytes.get())->User.Sid,&value))error(L"Cannot read archive user");std::wstring result=value;LocalFree(value);return result;
}
class Coordinator {
 HANDLE mutex=nullptr,mapping=nullptr;Mapping *view=nullptr;
public:
 U64 owner=0;std::wstring owner_text;Process process{GetCurrentProcessId(),born(GetCurrentProcess())};
 explicit Coordinator(const wchar_t *scope){try{
  if(!scope||!*scope||std::wcslen(scope)>80)error(L"Invalid archive coordination scope");for(auto c:std::wstring(scope))if(!(c>=L'a'&&c<=L'z')&&!(c>=L'0'&&c<=L'9')&&c!=L'-')error(L"Invalid archive coordination scope");
  const auto user=sid(),name=L"Local\\One.ArchiveBudget.v1."+user+L"."+scope;
  PSECURITY_DESCRIPTOR descriptor=nullptr;const auto sddl=L"D:P(A;;GA;;;"+user+L")S:(ML;;NW;;;ME)";
  if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(),SDDL_REVISION_1,&descriptor,nullptr))error(L"Cannot protect archive coordination");
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES),descriptor,FALSE};
  mutex=CreateMutexW(&security,FALSE,(name+L".mutex").c_str());
  mapping=CreateFileMappingW(INVALID_HANDLE_VALUE,&security,PAGE_READWRITE,0,sizeof(Mapping),(name+L".memory").c_str());LocalFree(descriptor);
  if(!mutex||!mapping)error(L"Cannot open archive coordination");view=static_cast<Mapping*>(MapViewOfFile(mapping,FILE_MAP_READ|FILE_MAP_WRITE,0,0,sizeof(Mapping)));if(!view)error(L"Cannot map archive coordination");
  if(BCryptGenRandom(nullptr,reinterpret_cast<PUCHAR>(&owner),sizeof(owner),BCRYPT_USE_SYSTEM_PREFERRED_RNG)<0||!owner)error(L"Cannot create archive reservation identity");owner_text=std::to_wstring(owner);
 }catch(...){close();throw;}}
 ~Coordinator(){close();}
 void close(){if(view){UnmapViewOfFile(view);view=nullptr;}if(mapping){CloseHandle(mapping);mapping=nullptr;}if(mutex){CloseHandle(mutex);mutex=nullptr;}}
 bool lock(DWORD timeout=0){const auto result=WaitForSingleObject(mutex,timeout);if(result==WAIT_TIMEOUT)return false;if(result!=WAIT_OBJECT_0&&result!=WAIT_ABANDONED)error(L"Cannot lock archive coordination");return true;}
 void unlock(){ReleaseMutex(mutex);}
 struct Guard {Coordinator &value;explicit Guard(Coordinator &v):value(v){}~Guard(){value.unlock();}};
 State read(){
  int best=-1;for(int i=0;i<2;++i){const auto &bank=view->banks[i];if(bank.sequence&&bank.state.version==magic&&bank.checksum==checksum(bank.state)&&(best<0||bank.sequence>view->banks[best].sequence))best=i;}
  if(best<0){if(view->banks[0].sequence||view->banks[1].sequence)error(L"Archive coordination state is damaged");State state{};write(state);return state;}
  return view->banks[best].state;
 }
 void write(const State &state){
  int current=-1;for(int i=0;i<2;++i){const auto &bank=view->banks[i];if(bank.sequence&&bank.state.version==magic&&bank.checksum==checksum(bank.state)&&(current<0||bank.sequence>view->banks[current].sequence))current=i;}
  const U64 sequence=current<0?1:view->banks[current].sequence+1;if(!sequence)error(L"Archive coordination sequence exhausted");auto &bank=view->banks[current<0?0:1-current];
  bank.sequence=0;MemoryBarrier();std::memcpy(&bank.state,&state,sizeof(state));bank.checksum=checksum(state);MemoryBarrier();bank.sequence=sequence;MemoryBarrier();
 }
 static void reap(State &state){
  std::map<std::pair<uint32_t,U64>,bool> cache;const auto live=[&](Process process){const auto key=std::make_pair(process.pid,process.born);auto found=cache.find(key);if(found!=cache.end())return found->second;return cache.emplace(key,alive(process)).first->second;};
  for(auto &client:state.clients)if(client.owner&&!live(client.process))client={};
  for(auto &task:state.tasks)if(task.state){
   if(task.child.pid&&!live(task.child))task.child={};
   const bool owner=std::any_of(std::begin(state.clients),std::end(state.clients),[&](const Client &c){return c.owner&&c.owner==task.owner;});
   if(!owner&&!task.child.pid)task={};
  }
 }
 static Budget limits(const State &state){Budget result{8,32768,64};for(const auto &client:state.clients)if(client.owner){if(!valid(client.budget))error(L"Archive coordination budget is damaged");result.concurrent=std::min(result.concurrent,client.budget.concurrent);result.memory=std::min(result.memory,client.budget.memory);result.threads=std::min(result.threads,client.budget.threads);}return result;}
 static void pump(State &state){
  const auto budget=limits(state);uint32_t count=0,memory=0,threads=0;
  for(auto &task:state.tasks){if(task.state==2){++count;memory+=task.memory;threads+=task.threads;}else if(task.state==1&&(task.memory>budget.memory||task.threads>budget.threads))task.state=3;}
  for(;;){Task *head=nullptr;for(auto &task:state.tasks)if(task.state==1&&(!head||task.ticket<head->ticket))head=&task;
   if(!head||count>=budget.concurrent||memory+head->memory>budget.memory||threads+head->threads>budget.threads)return;head->state=2;++count;memory+=head->memory;threads+=head->threads;}
 }
 Task *find(State &state,const char *id,U64 client){for(auto &task:state.tasks)if(task.state&&task.owner==client&&std::strcmp(task.id,id)==0)return &task;return nullptr;}
 int step(Budget budget,const char *id,uint32_t memory,uint32_t threads,uint32_t *out){
  if(!valid(budget)||!out||id&&*id&&(!valid_id(id)||memory<128||memory>8192||threads<1||threads>64))error(L"Invalid archive shared budget request");
  if(!lock())return 2;Guard guard(*this);auto state=read();reap(state);
  Client *client=nullptr;for(auto &item:state.clients)if(item.owner==owner){client=&item;break;}
  if(!client)for(auto &item:state.clients)if(!item.owner){client=&item;break;}if(!client)return -3;*client={owner,process,budget};
  Task *task=nullptr;if(id&&*id){task=find(state,id,owner);if(!task){for(auto &item:state.tasks)if(!item.state){task=&item;break;}if(!task)return -3;if(state.ticket==UINT64_MAX)error(L"Archive queue ticket exhausted");task->owner=owner;task->ticket=++state.ticket;task->state=1;task->memory=memory;task->threads=threads;std::strcpy(task->id,id);}}
  pump(state);const auto effective=limits(state);out[0]=0;out[1]=effective.concurrent;out[2]=effective.memory;out[3]=effective.threads;
  int result=1;if(task){result=task->state==2?1:task->state==3?-2:0;if(!result)for(const auto &other:state.tasks)if(other.state==1&&other.ticket<=task->ticket)++out[0];}
  write(state);return result;
 }
 int release(const char *id,bool closing=false){
  if(!closing&&!valid_id(id))error(L"Invalid archive shared budget release");if(!lock())return 2;Guard guard(*this);auto state=read();reap(state);
  for(auto &task:state.tasks)if(task.state&&task.owner==owner&&(closing||std::strcmp(task.id,id)==0)){if(task.child.pid)task.owner=0;else task={};}
  if(closing)for(auto &client:state.clients)if(client.owner==owner)client={};pump(state);write(state);return 1;
 }
 void attach(U64 client,const char *id){
  if(!valid_id(id)||!lock(2000))error(L"Cannot attach archive resource reservation");Guard guard(*this);auto state=read();reap(state);auto task=find(state,id,client);
  const auto &resources=archive_options();
  if(!task||task->state!=2||task->child.pid||task->memory!=resources.first||task->threads!=resources.second)error(L"Archive resource reservation expired or mismatched");task->child=process;write(state);
 }
 std::pair<uint32_t,uint32_t> archive_options(){
#ifndef ONE_BUDGET_DLL
  const auto &options=archive_resources();return {options.memory_mib,options.threads};
#else
  return {0,0};
#endif
 }
};
template<class F> int protect(F action){last_error.clear();try{return action();}catch(...){if(last_error.empty())last_error=L"Unexpected native archive coordination failure";return -1;}}
}

#ifdef ONE_BUDGET_DLL
#define API extern "C" __declspec(dllexport)
API void *one_budget_open(const wchar_t *scope){last_error.clear();try{return new Coordinator(scope);}catch(...){if(last_error.empty())last_error=L"Cannot initialize native archive coordination";return nullptr;}}
API const wchar_t *one_budget_error(){return last_error.c_str();}
API const wchar_t *one_budget_owner(void *value){return static_cast<Coordinator*>(value)->owner_text.c_str();}
API int one_budget_step(void *value,uint32_t count,uint32_t memory,uint32_t threads,const char *id,uint32_t task_memory,uint32_t task_threads,uint32_t *out){return protect([&]{return static_cast<Coordinator*>(value)->step({count,memory,threads},id,task_memory,task_threads,out);});}
API int one_budget_release(void *value,const char *id){return protect([&]{return static_cast<Coordinator*>(value)->release(id);});}
API int one_budget_close(void *value){return protect([&]{auto object=static_cast<Coordinator*>(value);const auto result=object->release(nullptr,true);if(result==1)delete object;return result;});}
#else
namespace {
std::wstring environment(const wchar_t *name){wchar_t value[128]{};const auto size=GetEnvironmentVariableW(name,value,128);if(size>=128)fail("Invalid shared archive reservation","resource");return std::wstring(value,size);}
}
ArchiveGlobalLease::ArchiveGlobalLease(){
 const auto scope=environment(L"ONE_ARCHIVE_BUDGET_SCOPE"),client=environment(L"ONE_ARCHIVE_BUDGET_OWNER"),id=environment(L"ONE_ARCHIVE_BUDGET_TASK");if(scope.empty()&&client.empty()&&id.empty())return;
 try{if(client.empty()||client.size()>20||id.size()!=36)error(L"Invalid archive reservation");U64 owner=0;for(auto c:client){if(c<L'0'||c>L'9'||owner>(UINT64_MAX-(c-L'0'))/10)error(L"Invalid archive reservation");owner=owner*10+c-L'0';}
  std::string task;for(auto c:id){if(c>127)error(L"Invalid archive reservation");task+=char(c);}auto object=std::make_unique<Coordinator>(scope.c_str());object->attach(owner,task.c_str());value=object.release();
 }catch(...){fail("Cannot attach shared archive resource reservation: "+utf8(last_error),"resource");}
}
ArchiveGlobalLease::~ArchiveGlobalLease(){delete static_cast<Coordinator*>(value);}
#endif
