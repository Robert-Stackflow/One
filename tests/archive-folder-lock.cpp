#include <windows.h>
#include <cstdio>
int wmain(int argc,wchar_t **argv){
    if(argc!=2)return 2;
    HANDLE handle=CreateFileW(argv[1],GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,
        nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS,nullptr);
    if(handle==INVALID_HANDLE_VALUE){std::printf("{\"error\":%lu}\n",GetLastError());std::fflush(stdout);return 3;}
    std::puts("{\"ready\":true}");std::fflush(stdout);
    (void)std::getchar();CloseHandle(handle);return 0;
}
