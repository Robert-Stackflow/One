#pragma once
#include <windows.h>
#include <string>
#include <stdexcept>
inline std::wstring dialogArgument(const std::wstring& value){std::wstring out=L"\"";size_t slashes=0;for(wchar_t c:value){if(c==L'\\'){slashes++;continue;}out.append(slashes*(c==L'"'?2:1),L'\\');slashes=0;if(c==L'"')out+=L'\\';out+=c;}out.append(slashes*2,L'\\');return out+L'"';}
inline void navigateDialog(HWND target,const std::wstring& path){
 wchar_t executable[32768]{};GetModuleFileNameW(nullptr,executable,32768);auto* slash=wcsrchr(executable,L'\\');if(!slash)throw std::runtime_error("Dialog integration unavailable");*slash=0;
#ifdef _WIN64
 DWORD targetPid=0;GetWindowThreadProcessId(target,&targetPid);HANDLE targetProcess=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,targetPid);BOOL wow64=FALSE;
 if(!targetProcess)throw std::runtime_error("File dialog unavailable");IsWow64Process(targetProcess,&wow64);FILETIME created,exit,kernel,user;bool times=GetProcessTimes(targetProcess,&created,&exit,&kernel,&user);CloseHandle(targetProcess);
 if(wow64){
  if(!times)throw std::runtime_error("File dialog unavailable");const auto stamp=(static_cast<unsigned long long>(created.dwHighDateTime)<<32)|created.dwLowDateTime;
  const std::wstring helper=std::wstring(executable)+L"\\One.Dialog32.exe";std::wstring command=dialogArgument(helper)+L" jump "+std::to_wstring(reinterpret_cast<uintptr_t>(target))+L" "+std::to_wstring(targetPid)+L" "+std::to_wstring(stamp)+L" "+dialogArgument(path);
  STARTUPINFOW start{sizeof(start)};start.dwFlags=STARTF_USESHOWWINDOW;start.wShowWindow=SW_HIDE;PROCESS_INFORMATION process{};
  if(!CreateProcessW(helper.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW,nullptr,nullptr,&start,&process))throw std::runtime_error("32-bit dialog integration unavailable");
  auto waited=WaitForSingleObject(process.hProcess,3500);DWORD code=1;if(waited==WAIT_OBJECT_0)GetExitCodeProcess(process.hProcess,&code);else TerminateProcess(process.hProcess,1);CloseHandle(process.hThread);CloseHandle(process.hProcess);if(code)throw std::runtime_error("Direct dialog navigation failed");return;
 }
 const std::wstring library=std::wstring(executable)+L"\\One.Dialog.dll";
#else
 const std::wstring library=std::wstring(executable)+L"\\One.Dialog32.dll";
#endif
 HMODULE module=LoadLibraryW(library.c_str());if(!module)throw std::runtime_error("Dialog integration unavailable");
 const auto callback=reinterpret_cast<HOOKPROC>(GetProcAddress(module,"OneDialogHook"));DWORD pid=0,thread=GetWindowThreadProcessId(target,&pid);
 if(!thread||!IsWindow(target)){FreeLibrary(module);throw std::runtime_error("File dialog unavailable");}
 WNDCLASSW klass{};klass.lpfnWndProc=DefWindowProcW;klass.hInstance=GetModuleHandleW(nullptr);klass.lpszClassName=L"One.Dialog.Navigation.Client";RegisterClassW(&klass);
 HWND client=CreateWindowExW(0,klass.lpszClassName,L"",0,0,0,0,0,HWND_MESSAGE,nullptr,klass.hInstance,nullptr);
 HHOOK hook=callback&&client?SetWindowsHookExW(WH_CALLWNDPROC,callback,module,thread):nullptr;HRESULT result=E_ACCESSDENIED;
 if(hook){
  COPYDATASTRUCT data{0x4f4e4447,static_cast<DWORD>((path.size()+1)*sizeof(wchar_t)),const_cast<wchar_t*>(path.c_str())};DWORD_PTR response=0;
  if(SendMessageTimeoutW(target,WM_COPYDATA,reinterpret_cast<WPARAM>(client),reinterpret_cast<LPARAM>(&data),SMTO_ABORTIFHUNG|SMTO_BLOCK,3000,&response)){
   MSG message{};const UINT reply=RegisterWindowMessageW(L"One.Dialog.Navigation.Result.v1");if(PeekMessageW(&message,client,reply,reply,PM_REMOVE))result=static_cast<HRESULT>(message.lParam);else result=E_NOINTERFACE;
  }else result=HRESULT_FROM_WIN32(GetLastError());
  UnhookWindowsHookEx(hook);
 }
 if(client)DestroyWindow(client);FreeLibrary(module);
 if(FAILED(result))throw std::runtime_error(result==E_NOINTERFACE?"This dialog does not expose a folder navigation interface":"Direct dialog navigation failed");
}
