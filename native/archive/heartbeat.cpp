#include "heartbeat.h"
#include "common.h"
#include <atomic>

namespace {std::atomic<uint64_t> activity{0};}
void archive_activity(){activity.fetch_add(1,std::memory_order_relaxed);}
ArchiveHeartbeat::ArchiveHeartbeat(){
    stop=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    if(!stop)fail("Cannot initialize archive heartbeat","resource");
    DWORD interval=2000;wchar_t test[4]{},text[16]{};
    if(GetEnvironmentVariableW(L"ONE_TEST_MODE",test,4)==1&&test[0]==L'1'){
        const auto size=GetEnvironmentVariableW(L"ONE_ARCHIVE_HEARTBEAT_TEST_MS",text,16);
        const auto value=_wtoi(text);if(size&&size<16&&value>=50&&value<=1000)interval=value;
    }
    try{worker=std::thread([this,interval]{
        try{while(WaitForSingleObject(stop,interval)==WAIT_TIMEOUT)
            emit("{\"type\":\"heartbeat\",\"activity\":"+std::to_string(activity.load(std::memory_order_relaxed))+"}");}
        catch(...){/* Parent detects missing heartbeat; never terminate in a worker. */}
    });}catch(...){CloseHandle(stop);stop=nullptr;throw;}
}
ArchiveHeartbeat::~ArchiveHeartbeat(){if(stop){SetEvent(stop);if(worker.joinable())worker.join();CloseHandle(stop);}}
