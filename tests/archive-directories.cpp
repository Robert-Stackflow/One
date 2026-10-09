#include "extract-directories.h"
#include <cassert>
#include <cstdio>
#include <thread>

[[noreturn]] void fail(const std::string &message,const std::string &code){throw ArchiveError(message,code);}
std::string utf8(const std::wstring &text){if(text.empty())return {};const auto length=WideCharToMultiByte(CP_UTF8,0,text.data(),(int)text.size(),nullptr,0,nullptr,nullptr);std::string result(length,0);WideCharToMultiByte(CP_UTF8,0,text.data(),(int)text.size(),result.data(),length,nullptr,nullptr);return result;}
template<class Action>void refused(Action action){bool rejected=false;try{action();}catch(const ArchiveError&){rejected=true;}assert(rejected);}
void blocked_rename(const fs::path &source,const fs::path &target){std::error_code error;fs::rename(source,target,error);if(!error)fprintf(stderr,"Unexpected directory rename: %s\n",utf8(source.wstring()).c_str());assert(error);assert(fs::is_directory(source));assert(!fs::exists(target));}
int wmain(int argc,wchar_t **argv){
 assert(argc==2);const fs::path base=argv[1];assert(base.is_absolute());fs::create_directory(base/L"parent");const auto stage=base/L"parent/stage";unsigned checks=0;
 refused([&]{ExtractionDirectories through_junction(base/L"linked-parent/stage");});assert(!fs::exists(base/L"outside/stage"));assert(fs::file_size(base/L"outside/keep.txt")==4);checks++;
 {
  ExtractionDirectories directories(stage,2);assert(fs::is_directory(stage));checks++;
  // The Node host supplies real junctions without administrator privileges.
  puts("junction-ready");fflush(stdout);assert(getchar()=='1');
  refused([&]{directories.ensure(stage/L"linked-child/escaped");});assert(!fs::exists(base/L"outside/escaped"));checks++;
  refused([&]{ExtractionDirectories again(stage);});checks++;
  fs::create_directory(base/L"sibling");fs::rename(base/L"sibling",base/L"renamed-sibling");assert(fs::is_directory(base/L"renamed-sibling"));checks++;
  auto lease=directories.ensure(stage/L"first/deep");assert(fs::is_directory(stage/L"first/deep"));checks++;
  auto repeated=directories.ensure(stage/L"first/deep");assert(lease==repeated);repeated.reset();checks++;
  auto alternate=directories.ensure(stage/L"first\\deep");assert(lease==alternate);alternate.reset();checks++;
  blocked_rename(stage,base/L"moved-stage");blocked_rename(base/L"parent",base/L"moved-parent");checks+=2;
  // Eviction cannot release a live output's directory or any of its parents.
  for(unsigned i=0;i<32;i++){auto other=directories.ensure(stage/(L"other-"+std::to_wstring(i)));assert(fs::is_directory(stage/(L"other-"+std::to_wstring(i))));checks++;}
  blocked_rename(stage/L"first",stage/L"renamed-first");blocked_rename(stage/L"first/deep",stage/L"renamed-deep");checks+=2;
  assert(lease.use_count()==1);lease.reset();checks++;
  auto recreated=directories.ensure(stage/L"first/deep");assert(fs::is_directory(stage/L"first/deep"));checks++;
  refused([&]{directories.ensure(base/L"outside-escape");});refused([&]{directories.ensure(stage/L"../outside-escape");});assert(!fs::exists(base/L"outside-escape")&&!fs::exists(base/L"parent/outside-escape"));checks+=2;
  HANDLE file=CreateFileW((stage/L"regular-file").c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);assert(file!=INVALID_HANDLE_VALUE);CloseHandle(file);
  refused([&]{directories.ensure(stage/L"regular-file/child");});assert(fs::is_regular_file(stage/L"regular-file"));checks++;
  // Directory leases stay valid under concurrent cache turnover.
  std::vector<std::thread> threads;for(unsigned worker=0;worker<4;worker++)threads.emplace_back([&,worker]{for(unsigned i=0;i<40;i++){auto directory=stage/(L"thread-"+std::to_wstring(worker))/(L"child-"+std::to_wstring(i));auto held=directories.ensure(directory);HANDLE output=CreateFileW((directory/L"payload.bin").c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);assert(output!=INVALID_HANDLE_VALUE);DWORD written=0;assert(WriteFile(output,"ok",2,&written,nullptr)&&written==2);CloseHandle(output);}});for(auto &thread:threads)thread.join();
  for(unsigned worker=0;worker<4;worker++)for(unsigned i=0;i<40;i++){assert(fs::file_size(stage/(L"thread-"+std::to_wstring(worker))/(L"child-"+std::to_wstring(i))/L"payload.bin")==2);checks++;}
 }
 {ExtractionDirectories parallel(base/L"parallel-stage");fs::rename(stage,base/L"released-stage");assert(fs::is_directory(base/L"released-stage"));checks++;}
 refused([&]{ExtractionDirectories bad(base/L"capacity-zero",0);});refused([&]{ExtractionDirectories bad(base/L"capacity-huge",ExtractionDirectories::maximum_cached+1);});assert(!fs::exists(base/L"capacity-zero")&&!fs::exists(base/L"capacity-huge"));checks+=2;
 printf("Extraction directories passed: %u checks, active leases across eviction, parent/root locks, exclusive staging, path bounds, incompatible files, concurrency and released handles.\n",checks);return 0;
}
