#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <string>
#include <cstring>

static HMODULE instance;
static constexpr ULONG_PTR navigationMagic=0x4f4e4447;
static UINT resultMessage(){return RegisterWindowMessageW(L"One.Dialog.Navigation.Result.v1");}
static bool senderAllowed(HWND sender){
 wchar_t name[128]{};GetClassNameW(sender,name,128);if(wcscmp(name,L"One.Dialog.Navigation.Client"))return false;
 DWORD pid=0;GetWindowThreadProcessId(sender,&pid);HANDLE process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);if(!process)return false;
 wchar_t image[32768]{},library[32768]{};DWORD size=32768;bool okay=QueryFullProcessImageNameW(process,0,image,&size);CloseHandle(process);if(!okay)return false;
 GetModuleFileNameW(instance,library,32768);auto* slash=wcsrchr(library,L'\\');if(!slash)return false;*slash=0;
 auto* imageSlash=wcsrchr(image,L'\\');if(!imageSlash)return false;bool helper=!_wcsicmp(imageSlash+1,L"One.Search.exe")||!_wcsicmp(imageSlash+1,L"One.Dialog32.exe");*imageSlash=0;return helper&&!_wcsicmp(image,library);
}
static HRESULT browserFrom(HWND hwnd,IShellBrowser** browser){
 // CWM_GETISHELLBROWSER returns a process-local COM pointer. It is queried only
 // on this same UI thread, never dereferenced by the external helper.
 __try{auto* unknown=reinterpret_cast<IUnknown*>(SendMessageW(hwnd,WM_USER+7,0,0));return unknown?unknown->QueryInterface(IID_PPV_ARGS(browser)):E_NOINTERFACE;}
 __except(EXCEPTION_EXECUTE_HANDLER){return E_NOINTERFACE;}
}
static HRESULT navigate(HWND hwnd,const wchar_t* path){
 IShellBrowser* browser=nullptr;HRESULT result=browserFrom(hwnd,&browser);if(FAILED(result))return result;
 IShellItem* folder=nullptr;result=SHCreateItemFromParsingName(path,nullptr,IID_PPV_ARGS(&folder));
 if(SUCCEEDED(result)){
  IFileDialog* dialog=nullptr;if(SUCCEEDED(browser->QueryInterface(IID_PPV_ARGS(&dialog)))){result=dialog->SetFolder(folder);dialog->Release();}
  else {PIDLIST_ABSOLUTE pidl=nullptr;result=SHParseDisplayName(path,nullptr,&pidl,0,nullptr);if(SUCCEEDED(result)){result=browser->BrowseObject(pidl,SBSP_ABSOLUTE|SBSP_SAMEBROWSER);CoTaskMemFree(pidl);}}
  folder->Release();
 }
 browser->Release();return result;
}
static HRESULT navigateSafe(HWND hwnd,const wchar_t* path){__try{return navigate(hwnd,path);}__except(EXCEPTION_EXECUTE_HANDLER){return E_FAIL;}}
extern "C" __declspec(dllexport) LRESULT CALLBACK OneDialogHook(int code,WPARAM wparam,LPARAM lparam){
 if(code>=0){
  const auto* message=reinterpret_cast<CWPSTRUCT*>(lparam);
  if(message->message==WM_COPYDATA){
   const auto* data=reinterpret_cast<COPYDATASTRUCT*>(message->lParam);HWND sender=reinterpret_cast<HWND>(message->wParam);wchar_t name[128]{};GetClassNameW(message->hwnd,name,128);
   if(data&&data->dwData==navigationMagic&&data->cbData>=sizeof(wchar_t)*4&&data->cbData<=32768*sizeof(wchar_t)&&data->cbData%sizeof(wchar_t)==0&&!wcscmp(name,L"#32770")&&FindWindowExW(message->hwnd,nullptr,L"DUIViewWndClassName",nullptr)&&senderAllowed(sender)){
    const auto* path=static_cast<const wchar_t*>(data->lpData);HRESULT result=E_INVALIDARG;
    if(path&&path[data->cbData/sizeof(wchar_t)-1]==0){DWORD attributes=GetFileAttributesW(path);if(attributes!=INVALID_FILE_ATTRIBUTES&&(attributes&FILE_ATTRIBUTE_DIRECTORY))result=navigateSafe(message->hwnd,path);}
    PostMessageW(sender,resultMessage(),0,static_cast<LPARAM>(result));
   }
  }
 }
 return CallNextHookEx(nullptr,code,wparam,lparam);
}
BOOL WINAPI DllMain(HINSTANCE module,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH){instance=module;DisableThreadLibraryCalls(module);}return TRUE;}
