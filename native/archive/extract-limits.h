#pragma once
#include "common.h"
#include <windows.h>
#include <string_view>
struct ExtractionLimits {uint64_t bytes=64ull*1024*1024*1024;uint64_t milliseconds=30ull*60*1000;std::wstring revision;};
namespace extraction_policy {
inline std::wstring env(const wchar_t *key){
    const auto size=GetEnvironmentVariableW(key,nullptr,0);if(!size)return {};
    if(size>32769)fail("Invalid extraction limit","safety");
    std::wstring result(size,L'\0');SetLastError(ERROR_SUCCESS);const auto read=GetEnvironmentVariableW(key,result.data(),size);
    if(read>=size||(!read&&GetLastError()!=ERROR_SUCCESS))fail("Invalid extraction limit","safety");result.resize(read);return result;
}
inline uint64_t number(const wchar_t *key,uint64_t fallback,uint64_t maximum){
    const auto text=env(key);if(text.empty())return fallback;
    uint64_t result=0;for(auto c:text){if(c<L'0'||c>L'9'||result>(maximum-uint64_t(c-L'0'))/10)fail("Invalid extraction limit","safety");result=result*10+uint64_t(c-L'0');}
    if(!result||result>maximum)fail("Invalid extraction limit","safety");return result;
}

}
inline ExtractionLimits extraction_limits(){
    ExtractionLimits result;
    result.revision=extraction_policy::env(L"ONE_ARCHIVE_RISK_REVISION");
    result.bytes=extraction_policy::number(L"ONE_ARCHIVE_EXTRACT_MAX_BYTES",result.bytes,9007199254740991ull);
    result.milliseconds=extraction_policy::number(L"ONE_ARCHIVE_EXTRACT_MAX_MS",result.milliseconds,24ull*60*60*1000);
    return result;
}
