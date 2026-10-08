#include "resources.h"
#include <string_view>

namespace {
ArchiveResourceOptions options;
unsigned option(const wchar_t *key,unsigned fallback,unsigned minimum,unsigned maximum){
    wchar_t text[32]{};SetLastError(ERROR_SUCCESS);
    const auto size=GetEnvironmentVariableW(key,text,32);
    if(!size&&GetLastError()==ERROR_ENVVAR_NOT_FOUND)return fallback;
    if(!size||size>=32)fail("Invalid archive resource option","resource");
    unsigned value=0;
    for(const auto c:std::wstring_view(text,size)){
        if(c<L'0'||c>L'9'||value>maximum/10)fail("Invalid archive resource option","resource");
        value=value*10+unsigned(c-L'0');if(value>maximum)fail("Invalid archive resource option","resource");
    }
    if(value<minimum)fail("Archive resource option is out of range","resource");return value;
}
}
const ArchiveResourceOptions &archive_resources(){return options;}
ArchiveResourceJob::ArchiveResourceJob(){
    options.level=option(L"ONE_ARCHIVE_LEVEL",6,0,9);
    options.threads=option(L"ONE_ARCHIVE_THREADS",2,1,64);
    options.memory_mib=option(L"ONE_ARCHIVE_MEMORY_MIB",1024,128,8192);
    job=CreateJobObjectW(nullptr,nullptr);
    if(!job)fail("Cannot create archive memory budget","resource");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limit{};
    limit.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_PROCESS_MEMORY;
    limit.ProcessMemoryLimit=SIZE_T(options.memory_mib)*1024*1024;
    if(!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limit,sizeof(limit))||
       !AssignProcessToJobObject(job,GetCurrentProcess())){
        CloseHandle(job);job=nullptr;fail("Cannot apply archive memory budget","resource");
    }
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION applied{};
    if(!QueryInformationJobObject(job,JobObjectExtendedLimitInformation,&applied,sizeof(applied),nullptr)||
       applied.ProcessMemoryLimit!=limit.ProcessMemoryLimit){CloseHandle(job);job=nullptr;fail("Cannot verify archive memory budget","resource");}
    emit("{\"type\":\"resources\",\"level\":"+std::to_string(options.level)+
         ",\"threads\":"+std::to_string(options.threads)+",\"memoryMiB\":"+std::to_string(applied.ProcessMemoryLimit/1024/1024)+"}");
}
