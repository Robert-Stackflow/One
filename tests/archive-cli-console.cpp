#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string>
#include <vector>
#include <fstream>
static std::wstring quote(const std::wstring &value){std::wstring out=L"\"";size_t slashes=0;for(auto ch:value){if(ch==L'\\'){slashes++;continue;}out.append(ch==L'"'?slashes*2+1:slashes,L'\\');out+=ch;slashes=0;}out.append(slashes*2,L'\\');return out+L'"';}
static BOOL WINAPI ignore(DWORD){return TRUE;}
// Send a real console Ctrl+Break after the CLI reports native task progress.
// Node process.kill(SIGINT) forcibly terminates on Windows and cannot prove this.
int wmain(int argc,wchar_t **argv){
 if(argc<5)return 125;SECURITY_ATTRIBUTES sa{sizeof(sa),nullptr,TRUE};
 HANDLE output=CreateFileW(argv[1],GENERIC_WRITE,FILE_SHARE_READ,&sa,CREATE_ALWAYS,0,nullptr),errors=CreateFileW(argv[2],GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,&sa,CREATE_ALWAYS,0,nullptr),input=CreateFileW(L"NUL",GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,&sa,OPEN_EXISTING,0,nullptr);
 STARTUPINFOW start{};start.cb=sizeof(start);start.dwFlags=STARTF_USESTDHANDLES|STARTF_USESHOWWINDOW;start.wShowWindow=SW_HIDE;start.hStdInput=input;start.hStdOutput=output;start.hStdError=errors;
 std::wstring command;for(int i=3;i<argc;i++){if(i>3)command+=L' ';command+=quote(argv[i]);}
 PROCESS_INFORMATION child{};if(!CreateProcessW(argv[3],command.data(),nullptr,nullptr,TRUE,CREATE_NEW_CONSOLE|CREATE_NEW_PROCESS_GROUP,nullptr,nullptr,&start,&child))return 124;
 bool ready=false;for(int i=0;i<500;i++){
  std::ifstream file(argv[2],std::ios::binary);std::string data((std::istreambuf_iterator<char>(file)),{});if(data.find("\"type\":\"progress\"")!=std::string::npos){ready=true;break;}
  if(WaitForSingleObject(child.hProcess,10)==WAIT_OBJECT_0)break;
 }
 wchar_t mode[8]{};GetEnvironmentVariableW(L"ONE_TEST_CONSOLE_EVENT",mode,8);bool ctrlC=wcscmp(mode,L"c")==0;
 // Stay attached until exit: FreeConsole resets control handlers and a queued
 // Ctrl+C could otherwise terminate the test harness after it reports success.
 bool sent=false;if(ready){FreeConsole();if(AttachConsole(child.dwProcessId)){SetConsoleCtrlHandler(ignore,TRUE);sent=GenerateConsoleCtrlEvent(ctrlC?CTRL_C_EVENT:CTRL_BREAK_EVENT,ctrlC?0:child.dwProcessId);}}
 DWORD wait=WaitForSingleObject(child.hProcess,15000),code=123;if(wait!=WAIT_OBJECT_0){TerminateProcess(child.hProcess,123);WaitForSingleObject(child.hProcess,5000);}else GetExitCodeProcess(child.hProcess,&code);
 CloseHandle(child.hThread);CloseHandle(child.hProcess);CloseHandle(input);CloseHandle(output);CloseHandle(errors);
 return sent?(int)code:122;
}
