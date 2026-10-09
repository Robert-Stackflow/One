// Exercise the actual native state implementation, including Windows abandoned
// mutex recovery, without adding test exports to the shipped DLL.
#define ONE_BUDGET_DLL
#include "../native/archive/shared-budget.cpp"
#include <cassert>
#include <thread>
#include <cstdio>
#include <vector>

int wmain(int argc,wchar_t **argv){
 assert(argc==2);Coordinator coordinator(argv[1]);uint32_t out[4]{};const char *id="00000000-0000-4000-8000-000000000001";const Budget budget{1,128,1};
 assert(coordinator.step(budget,id,128,1,out)==1);
 const auto name=L"Local\\One.ArchiveBudget.v1."+sid()+L"."+argv[1]+L".memory";
 const auto mapping=OpenFileMappingW(FILE_MAP_READ|FILE_MAP_WRITE,FALSE,name.c_str());assert(mapping);
 auto view=static_cast<Mapping*>(MapViewOfFile(mapping,FILE_MAP_READ|FILE_MAP_WRITE,0,0,sizeof(Mapping)));assert(view);
 std::thread abandoned([&]{
  assert(coordinator.lock(1000));const int current=view->banks[1].sequence>view->banks[0].sequence?1:0;auto &torn=view->banks[1-current];
  torn.state={};torn.checksum=0;torn.sequence=view->banks[current].sequence+1;
  // Deliberately return without releasing the mutex, like a crashed writer.
 });abandoned.join();
 assert(coordinator.lock());{
  Coordinator::Guard guard(coordinator);auto recovered=coordinator.read();const auto task=coordinator.find(recovered,id,coordinator.owner);assert(task&&task->state==2);coordinator.write(recovered);
 }
 assert(!alive({GetCurrentProcessId(),born(GetCurrentProcess())+1}));
 Mapping saved=*view;assert(coordinator.lock());{
  Coordinator::Guard guard(coordinator);view->banks[0].checksum^=1;view->banks[1].checksum^=1;
  bool refused=false;try{coordinator.read();}catch(...){refused=true;}assert(refused);*view=saved;
 }
 // Native capacity remains bounded even when callers bypass service limits.
 for(unsigned index=2;index<=task_count;++index){char value[37];std::snprintf(value,sizeof(value),"00000000-0000-4000-8000-%012x",index);assert(coordinator.step(budget,value,128,1,out)==0);}
 assert(coordinator.step(budget,"00000000-0000-4000-8000-000000001000",128,1,out)==-3);
 std::vector<std::unique_ptr<Coordinator>> clients;
 for(unsigned index=1;index<client_count;++index){auto client=std::make_unique<Coordinator>(argv[1]);assert(client->step(budget,"",0,0,out)==1);clients.push_back(std::move(client));}
 Coordinator overflow(argv[1]);assert(overflow.step(budget,"",0,0,out)==-3);
 for(auto &client:clients)assert(client->release(nullptr,true)==1);assert(coordinator.release(nullptr,true)==1);
 UnmapViewOfFile(view);CloseHandle(mapping);
 std::puts("Native shared budget: abandoned mutex/torn-bank recovery, corrupt-state refusal, PID creation-time mismatch, and bounded clients/tasks passed.");
}
