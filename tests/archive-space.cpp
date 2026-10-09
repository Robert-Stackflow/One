#include "extract-space.h"
#include <cassert>
#include <cstdio>
#include <thread>
#include <vector>

[[noreturn]] void fail(const std::string &message,const std::string &code){throw ArchiveError(message,code);}
struct Fixture {uint64_t free=1024ull*1024*1024;ULONGLONG time=0;unsigned queries=0;bool accessible=true;};
bool probe(const fs::path&,uint64_t &bytes,void *context){auto &state=*static_cast<Fixture*>(context);state.queries++;bytes=state.free;return state.accessible;}
ULONGLONG clock_value(void *context){return static_cast<Fixture*>(context)->time;}
int main(){
    constexpr uint64_t mib=1024*1024;
    {
        Fixture state;ExtractionSpace space(L"unused",16*mib,probe,clock_value,&state);
        for(unsigned i=0;i<256;i++)assert(space.write(65536));space.finish();
        assert(state.queries<=5&&state.queries>=3); // Not one disk syscall per write.
    }
    {
        Fixture state;ExtractionSpace space(L"unused",16*mib,probe,clock_value,&state);
        assert(space.write(4*mib));state.free=ExtractionSpace::reserve+12*mib-1;
        assert(!space.write(4*mib)&&space.failed());assert(std::string(space.code())=="write");
        state.free=1024*mib;assert(!space.write(1)); // Failure remains terminal.
    }
    {
        Fixture state;ExtractionSpace space(L"unused",0,probe,clock_value,&state);
        state.free=ExtractionSpace::reserve-1;state.time=ExtractionSpace::query_ms;
        assert(!space.write(0)); // Directory-only extraction still checks time.
    }
    {
        Fixture state;ExtractionSpace space(L"unused",1,probe,clock_value,&state);
        assert(!space.write(2));assert(std::string(space.code())=="safety");
    }
    {
        Fixture state;state.free=UINT64_MAX;
        bool refused=false;try{ExtractionSpace space(L"unused",UINT64_MAX,probe,clock_value,&state);}catch(const ArchiveError &error){refused=error.code=="safety";}assert(refused);
    }
    {
        Fixture state;ExtractionSpace space(L"unused",65536,probe,clock_value,&state);
        assert(space.write(65536));state.free=ExtractionSpace::reserve-1;
        bool refused=false;try{space.finish();}catch(const ArchiveError &error){refused=error.code=="write";}assert(refused);
    }
    {
        Fixture state;ExtractionSpace space(L"unused",mib,probe,clock_value,&state);
        state.accessible=false;state.time=ExtractionSpace::query_ms;assert(!space.write(1));
        assert(std::string(space.message()).find("无法检查")!=std::string::npos);
    }
    {
        Fixture state;ExtractionSpace space(L"unused",4*mib,probe,clock_value,&state);std::vector<std::thread> writers;
        for(unsigned i=0;i<4;i++)writers.emplace_back([&]{for(unsigned n=0;n<16;n++)assert(space.write(65536));});
        for(auto &writer:writers)writer.join();space.finish();assert(!space.failed());
    }
    {
        SetEnvironmentVariableW(L"ONE_ARCHIVE_EXTRACT_MAX_BYTES",L"16");
        bool refused=false;try{Fixture state;ExtractionSpace space(L"unused",17,probe,clock_value,&state);}catch(const ArchiveError &error){refused=error.code=="safety";}assert(refused);
        SetEnvironmentVariableW(L"ONE_ARCHIVE_EXTRACT_MAX_BYTES",nullptr);
        SetEnvironmentVariableW(L"ONE_ARCHIVE_EXTRACT_MAX_MS",L"100");
        Fixture state;ExtractionSpace space(L"unused",16,probe,clock_value,&state);assert(space.write(8));state.time=100;
        assert(!space.write(1));assert(std::string(space.code())=="timeout");
        Fixture end;ExtractionSpace finished(L"unused",0,probe,clock_value,&end);end.time=100;
        refused=false;try{finished.finish();}catch(const ArchiveError &error){refused=error.code=="timeout";}assert(refused);
        SetEnvironmentVariableW(L"ONE_ARCHIVE_EXTRACT_MAX_MS",nullptr);
    }
    {
        Fixture state;ExtractionSpace stream(L"unused",0,probe,clock_value,&state,false);
        assert(stream.write(mib));state.time=ExtractionSpace::query_ms;stream.finish();assert(!stream.failed());
        state.free=ExtractionSpace::reserve;state.time+=ExtractionSpace::query_ms;
        assert(!stream.write(1));assert(std::string(stream.code())=="write");
        SetEnvironmentVariableW(L"ONE_ARCHIVE_EXTRACT_MAX_BYTES",L"16");
        Fixture budget;ExtractionSpace limited(L"unused",0,probe,clock_value,&budget,false);
        assert(limited.write(8));assert(!limited.write(9));assert(std::string(limited.code())=="safety");
        SetEnvironmentVariableW(L"ONE_ARCHIVE_EXTRACT_MAX_BYTES",nullptr);
        SetEnvironmentVariableW(L"ONE_ARCHIVE_EXTRACT_MAX_MS",L"100");
        Fixture time;ExtractionSpace timed(L"unused",0,probe,clock_value,&time,false);assert(timed.write(1));time.time=100;
        assert(!timed.write(1));assert(std::string(timed.code())=="timeout");
        SetEnvironmentVariableW(L"ONE_ARCHIVE_EXTRACT_MAX_MS",nullptr);
    }
    std::puts("Extraction space policy passed: known/unknown sizes, quota/free-space changes, byte/time budgets, metadata, finish, overflow, terminal errors and shared streams.");
}
