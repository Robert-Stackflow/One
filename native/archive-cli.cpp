// A console entry point with inherited streams and the child's exact exit code.
// The normal One process remains at its existing privilege level and lifecycle.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <filesystem>
#include <string>
#include <vector>
#include <map>
#include <atomic>
#include <cstring>

namespace fs=std::filesystem;
static std::wstring quote(const std::wstring &value){
    std::wstring out=L"\"";size_t slashes=0;
    for(wchar_t ch:value){if(ch==L'\\'){++slashes;continue;}if(ch==L'"'){out.append(slashes*2+1,L'\\');out+=ch;}else{out.append(slashes,L'\\');out+=ch;}slashes=0;}
    out.append(slashes*2,L'\\');return out+L'"';
}
static int failure(const char *message){DWORD written=0;WriteFile(GetStdHandle(STD_ERROR_HANDLE),message,(DWORD)strlen(message),&written,nullptr);return 126;}
static std::atomic<HANDLE> cancelEvent{nullptr};
static BOOL WINAPI control(DWORD event){if(event!=CTRL_C_EVENT&&event!=CTRL_BREAK_EVENT)return FALSE;if(const auto handle=cancelEvent.load())SetEvent(handle);return TRUE;}
static std::wstring environmentValue(const wchar_t *key){DWORD size=GetEnvironmentVariableW(key,nullptr,0);if(!size)return {};std::wstring value(size,L'\0');GetEnvironmentVariableW(key,value.data(),size);value.resize(size-1);return value;}
struct Less {bool operator()(const std::wstring &a,const std::wstring &b)const{return _wcsicmp(a.c_str(),b.c_str())<0;}};
struct Handle {HANDLE value=nullptr;~Handle(){if(value&&value!=INVALID_HANDLE_VALUE)CloseHandle(value);}};
int wmain(int argc,wchar_t **argv){try{
    SetConsoleOutputCP(CP_UTF8);
    std::vector<wchar_t> name(32768);DWORD size=GetModuleFileNameW(nullptr,name.data(),(DWORD)name.size());if(!size||size>=name.size())return failure("CLI location unavailable\n");
    const fs::path folder=fs::path(std::wstring(name.data(),size)).parent_path();
    fs::path runtime,entry,profile;
    if(fs::is_regular_file(folder/L"One.exe")&&fs::is_regular_file(folder/L"resources/app.asar")){
        runtime=folder/L"One.exe";entry=folder/L"resources/app.asar/dist/main/archive-cli-entry.cjs";
        const auto appData=environmentValue(L"APPDATA");if(appData.empty())return failure("APPDATA unavailable\n");profile=fs::path(appData)/L"One";
    }else{
        const auto root=folder.parent_path().parent_path();runtime=root/L"node_modules/electron/dist/electron.exe";entry=root/L"dist/main/archive-cli-entry.cjs";profile=root/L"work/cli-profile";
        if(!fs::is_regular_file(runtime)||!fs::is_regular_file(entry))return failure("CLI runtime is missing; build One first\n");
    }
    if(environmentValue(L"ONE_TEST_MODE")==L"1"){
        const auto testProfile=environmentValue(L"ONE_DATA_DIR");if(testProfile.empty()||!fs::path(testProfile).is_absolute())return failure("CLI test profile must be absolute\n");profile=testProfile;
    }
    auto temp=profile/L"archive-cli/temp";fs::create_directories(temp);
    Handle cancel{CreateEventW(nullptr,TRUE,FALSE,nullptr)},connectedEvent{CreateEventW(nullptr,TRUE,FALSE,nullptr)};
    const auto pipeName=L"\\\\.\\pipe\\one-archive-cli-"+std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(GetTickCount64());
    Handle pipe{CreateNamedPipeW(pipeName.c_str(),PIPE_ACCESS_OUTBOUND|FILE_FLAG_OVERLAPPED|FILE_FLAG_FIRST_PIPE_INSTANCE,PIPE_TYPE_BYTE|PIPE_WAIT|PIPE_REJECT_REMOTE_CLIENTS,1,16,16,0,nullptr)};
    if(!cancel.value||!connectedEvent.value||pipe.value==INVALID_HANDLE_VALUE)return failure("CLI cancellation channel unavailable\n");
    OVERLAPPED connection{};connection.hEvent=connectedEvent.value;
    bool connectionPending=false;
    if(!ConnectNamedPipe(pipe.value,&connection)){DWORD code=GetLastError();if(code==ERROR_PIPE_CONNECTED)SetEvent(connectedEvent.value);else if(code==ERROR_IO_PENDING)connectionPending=true;else return failure("Cannot prepare CLI cancellation channel\n");}
    struct ConnectionCleanup{HANDLE pipe;OVERLAPPED *io;bool pending;~ConnectionCleanup(){if(pending){CancelIoEx(pipe,io);DWORD bytes=0;GetOverlappedResult(pipe,io,&bytes,TRUE);}}} connectionCleanup{pipe.value,&connection,connectionPending};
    std::map<std::wstring,std::wstring,Less> env;auto block=GetEnvironmentStringsW();if(!block)return failure("CLI environment unavailable\n");
    for(auto item=block;*item;item+=wcslen(item)+1){std::wstring value(item);auto equal=value.find(L'=',value[0]==L'='?1:0);if(equal!=std::wstring::npos)env[value.substr(0,equal)]=value.substr(equal+1);}
    FreeEnvironmentStringsW(block);
    env.erase(L"ELECTRON_NO_ASAR");env.erase(L"ELECTRON_NO_ATTACH_CONSOLE");env.erase(L"NODE_OPTIONS");env.erase(L"NODE_PATH");env.erase(L"ELECTRON_ENABLE_LOGGING");
    env[L"ELECTRON_RUN_AS_NODE"]=L"1";env[L"ONE_ARCHIVE_CLI_PROFILE"]=profile.wstring();env[L"TEMP"]=temp.wstring();env[L"TMP"]=temp.wstring();
    env[L"ONE_ARCHIVE_CLI_CANCEL_PIPE"]=pipeName;
    std::vector<wchar_t> environment;for(auto &[key,value]:env){auto line=key+L"="+value;environment.insert(environment.end(),line.begin(),line.end());environment.push_back(0);}environment.push_back(0);
    std::wstring command=quote(runtime.wstring())+L" "+quote(entry.wstring());for(int index=1;index<argc;index++)command+=L" "+quote(argv[index]);if(command.size()>=32767)return failure("CLI command exceeds Windows limit\n");
    Handle streams[3];DWORD ids[]={STD_INPUT_HANDLE,STD_OUTPUT_HANDLE,STD_ERROR_HANDLE};
    for(int index=0;index<3;index++){
        HANDLE source=GetStdHandle(ids[index]);
        if(!source||source==INVALID_HANDLE_VALUE){SECURITY_ATTRIBUTES security{sizeof(security),nullptr,TRUE};streams[index].value=CreateFileW(L"NUL",index==0?GENERIC_READ:GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,&security,OPEN_EXISTING,0,nullptr);}
        else if(!DuplicateHandle(GetCurrentProcess(),source,GetCurrentProcess(),&streams[index].value,0,TRUE,DUPLICATE_SAME_ACCESS))return failure("Cannot inherit CLI streams\n");
        if(!streams[index].value||streams[index].value==INVALID_HANDLE_VALUE)return failure("CLI streams unavailable\n");
    }
    SIZE_T bytes=0;InitializeProcThreadAttributeList(nullptr,1,0,&bytes);std::vector<unsigned char> storage(bytes);auto attributes=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
    if(!InitializeProcThreadAttributeList(attributes,1,0,&bytes))return failure("CLI startup attributes unavailable\n");
    struct Attributes{LPPROC_THREAD_ATTRIBUTE_LIST list;~Attributes(){DeleteProcThreadAttributeList(list);}} cleanup{attributes};
    HANDLE allowed[]={streams[0].value,streams[1].value,streams[2].value};
    if(!UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,allowed,sizeof(allowed),nullptr,nullptr))return failure("CLI stream inheritance failed\n");
    STARTUPINFOEXW start{};start.StartupInfo.cb=sizeof(start);start.StartupInfo.dwFlags=STARTF_USESTDHANDLES;start.StartupInfo.hStdInput=allowed[0];start.StartupInfo.hStdOutput=allowed[1];start.StartupInfo.hStdError=allowed[2];start.lpAttributeList=attributes;
    // Electron's Node runtime is a GUI-subsystem executable and may not join
    // the console. An owned pipe forwards cancellation independent of that.
    cancelEvent=cancel.value;SetConsoleCtrlHandler(nullptr,FALSE);SetConsoleCtrlHandler(control,TRUE);
    struct ConsoleCleanup{~ConsoleCleanup(){cancelEvent=nullptr;}} consoleCleanup;
    PROCESS_INFORMATION child{};
    if(!CreateProcessW(runtime.c_str(),command.data(),nullptr,nullptr,TRUE,EXTENDED_STARTUPINFO_PRESENT|CREATE_UNICODE_ENVIRONMENT|CREATE_NEW_PROCESS_GROUP,environment.data(),nullptr,&start.StartupInfo,&child))return failure("Cannot start One CLI runtime\n");
    Handle process{child.hProcess},thread{child.hThread};bool connected=false,pending=false,sent=false;
    for(;;){HANDLE waits[]={process.value,cancel.value,connectedEvent.value};DWORD ready=WaitForMultipleObjects(connected?2:3,waits,FALSE,INFINITE);if(ready==WAIT_OBJECT_0)break;
        if(ready==WAIT_OBJECT_0+1){ResetEvent(cancel.value);pending=true;}
        else if(ready==WAIT_OBJECT_0+2){connected=true;ULONG client=0;if(!GetNamedPipeClientProcessId(pipe.value,&client)||client!=child.dwProcessId)return failure("CLI cancellation client mismatch\n");}
        else return failure("CLI wait failed\n");
        if(connected&&pending&&!sent){sent=true;unsigned char byte=1;Handle written{CreateEventW(nullptr,TRUE,FALSE,nullptr)};OVERLAPPED writing{};writing.hEvent=written.value;DWORD size=0;
            if(!WriteFile(pipe.value,&byte,1,&size,&writing)&&GetLastError()==ERROR_IO_PENDING){HANDLE waits[]={process.value,written.value};WaitForMultipleObjects(2,waits,FALSE,INFINITE);CancelIoEx(pipe.value,&writing);WaitForSingleObject(written.value,INFINITE);}
        }
    }
    if(!connected){CancelIoEx(pipe.value,&connection);WaitForSingleObject(connectedEvent.value,INFINITE);}
    cancelEvent=nullptr;DWORD code=1;if(!GetExitCodeProcess(process.value,&code))return failure("Cannot read CLI exit code\n");return (int)code;
}catch(...){return failure("CLI startup failed\n");}}
