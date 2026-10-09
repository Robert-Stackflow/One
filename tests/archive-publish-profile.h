#pragma once
#include <windows.h>
#include <array>
#include <cstdio>
#include <cstdint>
namespace publish_profile {
enum Kind {open_read,open_delete,open_attributes,identity,attributes,move,erase,journal_write,journal_flush,pipe_peek,output,directory_create,count};
inline const char *names[]={"open_read_data","open_delete_attributes","open_attributes","identity","attributes","move","erase","journal_write","journal_flush","pipe_peek","output","directory_create"};
struct Counter {uint64_t calls=0,ticks=0;};
inline std::array<Counter,count> counters{};
inline LARGE_INTEGER frequency{},started{};
struct Reporter {
 Reporter(){QueryPerformanceFrequency(&frequency);QueryPerformanceCounter(&started);}
 ~Reporter(){LARGE_INTEGER ended{};QueryPerformanceCounter(&ended);fprintf(stderr,"{\"publishProfile\":{\"wallSeconds\":%.9f,\"inclusiveWindowsCalls\":{",double(ended.QuadPart-started.QuadPart)/double(frequency.QuadPart));for(unsigned i=0;i<count;i++)fprintf(stderr,"%s\"%s\":{\"calls\":%llu,\"seconds\":%.9f}",i?",":"",names[i],(unsigned long long)counters[i].calls,double(counters[i].ticks)/double(frequency.QuadPart));fputs("}}}\n",stderr);}
};
inline Reporter reporter;
struct Scope {
 Kind kind;LARGE_INTEGER begin{};
 explicit Scope(Kind value):kind(value){QueryPerformanceCounter(&begin);}
 ~Scope(){const auto error=GetLastError();LARGE_INTEGER end{};QueryPerformanceCounter(&end);auto &counter=counters[kind];counter.calls++;counter.ticks+=static_cast<uint64_t>(end.QuadPart-begin.QuadPart);SetLastError(error);}
};
}
inline HANDLE profile_CreateFileW(LPCWSTR name,DWORD access,DWORD sharing,LPSECURITY_ATTRIBUTES security,DWORD creation,DWORD flags,HANDLE template_file){publish_profile::Scope timing(access&GENERIC_READ?publish_profile::open_read:access&DELETE?publish_profile::open_delete:publish_profile::open_attributes);return CreateFileW(name,access,sharing,security,creation,flags,template_file);}
inline BOOL profile_GetFileInformationByHandle(HANDLE handle,LPBY_HANDLE_FILE_INFORMATION info){publish_profile::Scope timing(publish_profile::identity);return GetFileInformationByHandle(handle,info);}
inline DWORD profile_GetFileAttributesW(LPCWSTR name){publish_profile::Scope timing(publish_profile::attributes);return GetFileAttributesW(name);}
inline BOOL profile_SetFileInformationByHandle(HANDLE handle,FILE_INFO_BY_HANDLE_CLASS kind,LPVOID info,DWORD size){publish_profile::Scope timing(kind==FileRenameInfo?publish_profile::move:publish_profile::erase);return SetFileInformationByHandle(handle,kind,info,size);}
inline BOOL profile_WriteFile(HANDLE handle,LPCVOID bytes,DWORD size,LPDWORD written,LPOVERLAPPED overlapped){publish_profile::Scope timing(publish_profile::journal_write);return WriteFile(handle,bytes,size,written,overlapped);}
inline BOOL profile_FlushFileBuffers(HANDLE handle){publish_profile::Scope timing(publish_profile::journal_flush);return FlushFileBuffers(handle);}
inline BOOL profile_PeekNamedPipe(HANDLE handle,LPVOID buffer,DWORD size,LPDWORD read,LPDWORD available,LPDWORD left){publish_profile::Scope timing(publish_profile::pipe_peek);return PeekNamedPipe(handle,buffer,size,read,available,left);}
inline void profile_emit(const std::string &line){publish_profile::Scope timing(publish_profile::output);emit(line);}
inline BOOL profile_CreateDirectoryW(LPCWSTR name,LPSECURITY_ATTRIBUTES security){publish_profile::Scope timing(publish_profile::directory_create);return CreateDirectoryW(name,security);}
