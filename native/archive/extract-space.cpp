#include "extract-space.h"
#include <algorithm>
#include <string_view>

namespace {
bool disk_space(const fs::path &directory,uint64_t &available,void*){
    ULARGE_INTEGER bytes{};
    if(!GetDiskFreeSpaceExW(directory.c_str(),&bytes,nullptr,nullptr))return false;
    available=bytes.QuadPart;return true;
}
ULONGLONG ticks(void*){return GetTickCount64();}
bool test_number(const wchar_t *key,uint64_t &result){
    wchar_t text[32]{};SetLastError(ERROR_SUCCESS);const auto size=GetEnvironmentVariableW(key,text,32);
    if(!size&&GetLastError()==ERROR_ENVVAR_NOT_FOUND)return false;
    if(!size||size>=32)fail("Invalid extraction space test option","write");
    result=0;
    for(const auto c:std::wstring_view(text,size)){
        if(c<L'0'||c>L'9'||result>(UINT64_MAX-uint64_t(c-L'0'))/10)fail("Invalid extraction space test option","write");
        result=result*10+uint64_t(c-L'0');
    }
    return true;
}
}

ExtractionSpace::ExtractionSpace(const fs::path &path,uint64_t expected,Probe probe,Clock clock,void *context):
    directory(path),expected(expected),probe(probe?probe:disk_space),clock(clock?clock:ticks),context(context){
    // Fault injection can only reduce the real available space; it never makes
    // a full disk appear writable and is inert outside the isolated test mode.
    wchar_t mode[4]{};
    if(!probe&&GetEnvironmentVariableW(L"ONE_TEST_MODE",mode,4)==1&&mode[0]==L'1'){
        const bool after=test_number(L"ONE_ARCHIVE_SPACE_TEST_AFTER_BYTES",test_after);
        const bool cap=test_number(L"ONE_ARCHIVE_SPACE_TEST_AVAILABLE_BYTES",test_available);
        if(after!=cap)fail("Incomplete extraction space test options","write");test_cap=after&&cap;
    }
    if(!refresh())fail(message(),code());
}

bool ExtractionSpace::refresh() noexcept {
    try{
        uint64_t free=0;
        if(!probe(directory,free,context)){failure=Failure::query;return false;}
        if(test_cap&&written>=test_after)free=(std::min)(free,test_available);
        // Subtraction avoids overflow even for hostile 64-bit size fields.
        if(free<reserve||expected-written>free-reserve){failure=Failure::space;return false;}
        available=free;since_query=0;last_query=clock(context);return true;
    }catch(...){failure=Failure::query;return false;}
}

bool ExtractionSpace::write(uint64_t bytes) noexcept {
    try{
        std::lock_guard lock(mutex);
        if(failed())return false;
        if(bytes>expected-written){failure=Failure::expanded;return false;}
        const auto now=clock(context);
        if(since_query>=query_bytes||bytes>=query_bytes-since_query||now-last_query>=query_ms)
            if(!refresh())return false;
        if(available<reserve||bytes>available-reserve){failure=Failure::space;return false;}
        available-=bytes;written+=bytes;since_query+=bytes;return true;
    }catch(...){failure=Failure::query;return false;}
}
void ExtractionSpace::require(uint64_t bytes){if(!write(bytes))fail(message(),code());}
void ExtractionSpace::finish(){std::lock_guard lock(mutex);if(failed()||!refresh())fail(message(),code());}
const char *ExtractionSpace::message()const noexcept {
    switch(failure.load()){
    case Failure::space:return "目标磁盘可用空间不足，已停止解压；请释放空间后重试。";
    case Failure::expanded:return "实际解压内容超过声明大小，已停止解压。";
    default:return "无法检查目标磁盘可用空间，已停止解压；请检查磁盘或网络连接。";
    }
}
const char *ExtractionSpace::code()const noexcept{return failure.load()==Failure::expanded?"safety":"write";}
