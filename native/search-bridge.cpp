#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shlobj.h>
#include <shellapi.h>
#include <exdisp.h>
#include <servprov.h>
#include <uiautomation.h>
#include <wrl/client.h>
#include <imm.h>
#include <string>
#include <vector>
#include <iostream>
#include <sstream>
#include <thread>
#include <atomic>
#include <mutex>
#include <chrono>
#include <condition_variable>
#include <deque>
#include "dialog-jump.h"
using Microsoft::WRL::ComPtr;
const ULONG_PTR replayMarker=0x4F4E4531;
bool testMode(){wchar_t value[4]{};return GetEnvironmentVariableW(L"ONE_TEST_MODE",value,4)&&value[0]==L'1';}
std::string utf8(const std::wstring& s){int n=WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);std::string v(n,0);WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),v.data(),n,nullptr,nullptr);return v;}
std::string quote(const std::wstring& s){std::string out="\"";for(unsigned char c:utf8(s)){if(c=='"'||c=='\\'){out+='\\';out+=c;}else if(c<32){char b[7];sprintf_s(b,"\\u%04x",c);out+=b;}else out+=c;}return out+'"';}
std::wstring cls(HWND h){wchar_t s[256]={};GetClassNameW(h,s,256);return s;}
bool desktop(HWND h){auto c=cls(h);if(c!=L"Progman"&&c!=L"WorkerW")return false;return FindWindowExW(h,nullptr,L"SHELLDLL_DefView",nullptr)!=nullptr;}
bool explorer(HWND h){auto c=cls(h);return c==L"CabinetWClass"||c==L"ExploreWClass"||desktop(h);}
bool dialog(HWND h){return cls(h)==L"#32770"&&FindWindowExW(h,nullptr,L"DUIViewWndClassName",nullptr);}
std::string creation(DWORD pid){HANDLE p=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);if(!p)return "";FILETIME c,e,k,u;bool ok=GetProcessTimes(p,&c,&e,&k,&u);CloseHandle(p);return ok?std::to_string((static_cast<unsigned long long>(c.dwHighDateTime)<<32)|c.dwLowDateTime):"";}
bool fileFocus(HWND focus){auto c=cls(focus);if(c!=L"DirectUIHWND"&&c!=L"SysListView32")return false;for(HWND p=focus;p;p=GetParent(p))if(cls(p)==L"SHELLDLL_DefView")return true;return false;}
HWND focusedControl(HWND h){GUITHREADINFO info{sizeof(info)};return GetGUIThreadInfo(GetWindowThreadProcessId(h,nullptr),&info)?info.hwndFocus:nullptr;}
bool belongs(HWND child,HWND root){return child&&(child==root||GetAncestor(child,GA_ROOT)==root);}
struct ExplorerFolder {HWND hwnd;HWND viewWindow;std::wstring path;bool active;ComPtr<IShellBrowser> browser;};
std::vector<ExplorerFolder> folders(){std::vector<ExplorerFolder> out;ComPtr<IShellWindows> windows;if(FAILED(CoCreateInstance(CLSID_ShellWindows,nullptr,CLSCTX_ALL,IID_PPV_ARGS(&windows))))return out;long count=0;windows->get_Count(&count);for(long i=0;i<count;i++){VARIANT v;VariantInit(&v);v.vt=VT_I4;v.lVal=i;ComPtr<IDispatch> dispatch;if(FAILED(windows->Item(v,&dispatch)))continue;ComPtr<IWebBrowser2> web;if(FAILED(dispatch.As(&web)))continue;SHANDLE_PTR id=0;web->get_HWND(&id);HWND hwnd=reinterpret_cast<HWND>(id);if(!explorer(hwnd))continue;ComPtr<IServiceProvider> services;if(FAILED(web.As(&services)))continue;ComPtr<IShellBrowser> browser;if(FAILED(services->QueryService(SID_STopLevelBrowser,IID_PPV_ARGS(&browser))))continue;ComPtr<IShellView> view;if(FAILED(browser->QueryActiveShellView(&view)))continue;HWND viewWindow=nullptr;view->GetWindow(&viewWindow);ComPtr<IFolderView> fv;if(FAILED(view.As(&fv)))continue;ComPtr<IPersistFolder2> folder;if(FAILED(fv->GetFolder(IID_PPV_ARGS(&folder))))continue;PIDLIST_ABSOLUTE pidl=nullptr;if(FAILED(folder->GetCurFolder(&pidl)))continue;wchar_t path[32768];bool valid=SHGetPathFromIDListEx(pidl,path,32768,GPFIDL_DEFAULT);CoTaskMemFree(pidl);if(valid)out.push_back({hwnd,viewWindow,path,!!IsWindowVisible(viewWindow),browser});}return out;}
// Windows 11 tabs share the outer Explorer HWND. A focused control identifies
// the shell view that owns the active tab for search, menus and Space preview.
bool currentExplorerTab(const ExplorerFolder& folder,HWND focus){return focus?folder.viewWindow&&(folder.viewWindow==focus||IsChild(folder.viewWindow,focus)):folder.active;}
std::string context(HWND h,HWND focus=nullptr){
 std::ostringstream output;DWORD pid=0;GetWindowThreadProcessId(h,&pid);
 auto all=folders();std::wstring current;std::vector<std::wstring> selected;HWND tab=nullptr;
 if(!focus&&explorer(h)&&!desktop(h)){auto candidate=focusedControl(h);if(belongs(candidate,h))focus=candidate;}
 if(desktop(h)){PWSTR path=nullptr;if(SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Desktop,0,nullptr,&path))){current=path;CoTaskMemFree(path);}}
 // Shell.Windows can report several visible tabs for one HWND. Without a
 // matching control, an ambiguous window must not silently choose tab zero.
 const ExplorerFolder* chosen=nullptr;
 for(const auto& f:all)if(f.hwnd==h&&currentExplorerTab(f,focus)){if(chosen){chosen=nullptr;break;}chosen=&f;}
 if(chosen){const auto& f=*chosen;
  current=f.path;tab=f.viewWindow;
  ComPtr<IShellView> view;ComPtr<IFolderView2> fv;ComPtr<IShellItemArray> items;
  if(SUCCEEDED(f.browser->QueryActiveShellView(&view))&&SUCCEEDED(view.As(&fv))&&SUCCEEDED(fv->GetSelection(FALSE,&items))){
   DWORD count=0;items->GetCount(&count);
   for(DWORD i=0;i<count&&i<32;i++){ComPtr<IShellItem> item;PWSTR path=nullptr;if(SUCCEEDED(items->GetItemAt(i,&item))&&SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH,&path))){selected.push_back(path);CoTaskMemFree(path);}}
  }
 }
 output<<"{\"kind\":\""<<(dialog(h)?"dialog":explorer(h)?"explorer":"search")<<"\",\"hwnd\":"<<(uintptr_t)h<<",\"pid\":"<<pid<<",\"created\":\""<<creation(pid)<<"\",\"tab\":"<<(uintptr_t)tab<<",\"currentFolder\":"<<quote(current)<<",\"selected\":[";
 bool comma=false;for(const auto& p:selected){if(comma)output<<',';comma=true;output<<quote(p);}
 output<<"],\"folders\":[";comma=false;
 for(const auto& f:all){if(comma)output<<',';comma=true;bool active=f.hwnd==h&&focus?currentExplorerTab(f,focus):f.active;output<<"{\"path\":"<<quote(f.path)<<",\"hwnd\":"<<(uintptr_t)f.hwnd<<",\"active\":"<<(active?"true":"false")<<'}';}
 output<<"]}";return output.str();
}
void key(WORD vk,bool up=false){INPUT i{};i.type=INPUT_KEYBOARD;i.ki.wVk=vk;i.ki.dwFlags=up?KEYEVENTF_KEYUP:0;SendInput(1,&i,sizeof(i));}
void focusWindow(HWND target){DWORD current=GetCurrentThreadId(),foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),nullptr),targetThread=GetWindowThreadProcessId(target,nullptr);bool a=AttachThreadInput(current,foregroundThread,TRUE),b=AttachThreadInput(current,targetThread,TRUE);BringWindowToTop(target);SetForegroundWindow(target);SetFocus(target);if(b)AttachThreadInput(current,targetThread,FALSE);if(a)AttachThreadInput(current,foregroundThread,FALSE);}
void jump(HWND h,DWORD expectedPid,const std::string& expected,const std::wstring& path,HWND tab=nullptr){DWORD pid=0;GetWindowThreadProcessId(h,&pid);if(!IsWindow(h)||pid!=expectedPid||creation(pid)!=expected)throw std::runtime_error("Target window changed; open search again");DWORD attributes=GetFileAttributesW(path.c_str());if(attributes==INVALID_FILE_ATTRIBUTES||!(attributes&FILE_ATTRIBUTE_DIRECTORY))throw std::runtime_error("Folder unavailable");if(desktop(h)){auto result=(INT_PTR)ShellExecuteW(nullptr,L"open",path.c_str(),nullptr,nullptr,SW_SHOWNORMAL);if(result<=32)throw std::runtime_error("Cannot open folder");std::cout<<"{\"ok\":true}"<<std::endl;return;}if(explorer(h)){if(!tab)throw std::runtime_error("Explorer tab could not be identified");for(auto& f:folders())if(f.hwnd==h&&f.viewWindow==tab){PIDLIST_ABSOLUTE pidl=nullptr;HRESULT hr=SHParseDisplayName(path.c_str(),nullptr,&pidl,0,nullptr);if(FAILED(hr))throw std::runtime_error("Folder unavailable");hr=f.browser->BrowseObject(pidl,SBSP_SAMEBROWSER);CoTaskMemFree(pidl);if(FAILED(hr))throw std::runtime_error("Explorer navigation failed");focusWindow(h);std::cout<<"{\"ok\":true}"<<std::endl;return;}throw std::runtime_error("Explorer tab is no longer available");}
 if(!dialog(h))throw std::runtime_error("Unsupported file dialog");navigateDialog(h,path);std::cout<<"{\"ok\":true}"<<std::endl;
}
// UI Automation runs outside the low-level hook thread. Hook callbacks use a
// short-lived positive cache and current focus checks, never blocking COM calls.
std::atomic<bool> running{true};std::atomic<HWND> eligible{nullptr};std::atomic<ULONGLONG> checked{0};std::atomic<int> blankX{0},blankY{0};std::atomic<bool> blank{false};std::mutex outputMutex;
void emit(const std::string& s){std::lock_guard<std::mutex> lock(outputMutex);std::cout<<s<<std::endl;}
bool inFileList(IUIAutomation* ui,IUIAutomationElement* element,bool allowItem){ComPtr<IUIAutomationTreeWalker> walker;ui->get_ControlViewWalker(&walker);ComPtr<IUIAutomationElement> current=element;bool item=false;for(int n=0;n<10&&current;n++){CONTROLTYPEID type=0;current->get_CurrentControlType(&type);if(type==UIA_EditControlTypeId||type==UIA_ButtonControlTypeId||type==UIA_HeaderControlTypeId||type==UIA_HeaderItemControlTypeId||type==UIA_ScrollBarControlTypeId)return false;if(type==UIA_ListItemControlTypeId||type==UIA_DataItemControlTypeId||type==UIA_TreeItemControlTypeId)item=true;BSTR id=nullptr;current->get_CurrentAutomationId(&id);bool list=id&&(wcscmp(id,L"ItemsView")==0||wcscmp(id,L"listview")==0);SysFreeString(id);BSTR className=nullptr;current->get_CurrentClassName(&className);list=list||(className&&wcscmp(className,L"SysListView32")==0);SysFreeString(className);if(list)return allowItem||!item;ComPtr<IUIAutomationElement> parent;if(FAILED(walker->GetParentElement(current.Get(),&parent)))break;current=parent;}return false;}
int options=0;DWORD ownerPid=0;std::atomic<HWND> notifiedDialog{nullptr};
void notifyDialog(HWND h){if((options&8)&&h==GetForegroundWindow()&&dialog(h)&&notifiedDialog.exchange(h)!=h)emit("{\"event\":\"dialog\",\"hwnd\":"+std::to_string((uintptr_t)h)+"}");}
void CALLBACK dialogEvents(HWINEVENTHOOK,DWORD event,HWND hwnd,LONG object,LONG child,DWORD,DWORD){if(!(options&8)||!hwnd)return;if(event==EVENT_SYSTEM_FOREGROUND){if(hwnd!=GetForegroundWindow())return;notifiedDialog=nullptr;notifyDialog(hwnd);}else if(object==OBJID_WINDOW&&child==CHILDID_SELF)notifyDialog(GetAncestor(hwnd,GA_ROOT));}
void poll(){CoInitializeEx(nullptr,COINIT_MULTITHREADED);ComPtr<IUIAutomation> ui;if(options&6)CoCreateInstance(CLSID_CUIAutomation,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&ui));HWND last=nullptr;while(running){HWND h=GetForegroundWindow();notifyDialog(h);if(explorer(h)&&h!=last){last=h;emit("{\"event\":\"explorer-active\",\"hwnd\":"+std::to_string((uintptr_t)h)+"}");}bool okay=false,isBlank=false;POINT p{};GetCursorPos(&p);if(ui&&explorer(h)){GUITHREADINFO info{sizeof(info)};GetGUIThreadInfo(0,&info);auto focus=cls(info.hwndFocus);if(focus==L"DirectUIHWND"||focus==L"SysListView32"){okay=fileFocus(info.hwndFocus);}if(GetAncestor(WindowFromPoint(p),GA_ROOT)==h||(desktop(h)&&desktop(GetAncestor(WindowFromPoint(p),GA_ROOT)))){ComPtr<IUIAutomationElement> e;if(SUCCEEDED(ui->ElementFromPoint(p,&e)))isBlank=inFileList(ui.Get(),e.Get(),false);}}eligible=okay?h:nullptr;blankX=p.x;blankY=p.y;blank=isBlank;checked=GetTickCount64();std::this_thread::sleep_for(std::chrono::milliseconds(75));}CoUninitialize();}
ULONGLONG lastCtrl=0,lastClick=0,pendingSince=0;POINT lastPoint{};HWND pendingOrigin=nullptr;std::vector<INPUT> queued;DWORD hookThread=0;HKL originLayout=nullptr;bool originIme=false;
bool down(int vk){return (GetAsyncKeyState(vk)&0x8000)!=0;}
void replay(HWND target){if(!pendingSince){DWORD pid=0;GetWindowThreadProcessId(target,&pid);if(pid==ownerPid)focusWindow(target);return;}DWORD targetPid=0;GetWindowThreadProcessId(target,&targetPid);if(targetPid==ownerPid&&GetForegroundWindow()==pendingOrigin&&target!=pendingOrigin){DWORD current=GetCurrentThreadId(),foregroundThread=GetWindowThreadProcessId(pendingOrigin,nullptr);DWORD targetThread=GetWindowThreadProcessId(target,nullptr);bool attached=AttachThreadInput(current,foregroundThread,TRUE),targetAttached=AttachThreadInput(current,targetThread,TRUE);BringWindowToTop(target);SetForegroundWindow(target);SetFocus(target);if(targetAttached)AttachThreadInput(current,targetThread,FALSE);if(attached)AttachThreadInput(current,foregroundThread,FALSE);}bool focused=GetForegroundWindow()==target;if(focused&&target!=pendingOrigin){PostMessageW(target,WM_INPUTLANGCHANGEREQUEST,0,(LPARAM)originLayout);GUITHREADINFO gi{sizeof(gi)};GetGUIThreadInfo(GetWindowThreadProcessId(target,nullptr),&gi);HIMC imc=ImmGetContext(gi.hwndFocus);if(imc){ImmSetOpenStatus(imc,originIme);ImmReleaseContext(gi.hwndFocus,imc);}}auto events=queued;queued.clear();pendingSince=0;if(!focused&&GetForegroundWindow()==pendingOrigin)focused=true;if(focused&&!events.empty())SendInput((UINT)events.size(),events.data(),sizeof(INPUT));}
// Keyboard eligibility uses current native focus, independently of potentially slow mouse UI Automation.
// Remote desktop uses injected input too; ignore only our own replay events.
LRESULT CALLBACK keyboard(int code,WPARAM message,LPARAM value){if(code<0)return CallNextHookEx(nullptr,code,message,value);auto k=reinterpret_cast<KBDLLHOOKSTRUCT*>(value);if(k->dwExtraInfo==replayMarker)return CallNextHookEx(nullptr,code,message,value);bool up=message==WM_KEYUP||message==WM_SYSKEYUP;auto now=GetTickCount64();bool ctrl=k->vkCode==VK_LCONTROL||k->vkCode==VK_RCONTROL;
 if(options&1){if(ctrl&&up&&!down(VK_MENU)&&!down(VK_SHIFT)){if(lastCtrl&&now-lastCtrl<400){HWND h=GetForegroundWindow();AllowSetForegroundWindow(ownerPid);emit("{\"event\":\"search\",\"hwnd\":"+std::to_string((uintptr_t)h)+",\"focus\":"+std::to_string((uintptr_t)focusedControl(h))+"}");lastCtrl=0;}else lastCtrl=now;}else if(!ctrl&&!up)lastCtrl=0;}
 if(pendingSince&&now-pendingSince>1500)replay(pendingOrigin);
 if(!pendingSince&&(options&2)&&!up&&!down(VK_CONTROL)&&!down(VK_MENU)&&!down(VK_LWIN)&&!down(VK_RWIN)&&((k->vkCode>='0'&&k->vkCode<='Z')||k->vkCode>=VK_OEM_1&&k->vkCode<=VK_OEM_102)){HWND h=GetForegroundWindow();GUITHREADINFO info{sizeof(info)};GetGUIThreadInfo(0,&info);auto focus=cls(info.hwndFocus);if(explorer(h)&&fileFocus(info.hwndFocus)){pendingSince=now;pendingOrigin=h;originLayout=GetKeyboardLayout(GetWindowThreadProcessId(h,nullptr));HIMC imc=ImmGetContext(info.hwndFocus);originIme=imc&&ImmGetOpenStatus(imc);if(imc)ImmReleaseContext(info.hwndFocus,imc);AllowSetForegroundWindow(ownerPid);emit("{\"event\":\"typing\",\"hwnd\":"+std::to_string((uintptr_t)h)+",\"focus\":"+std::to_string((uintptr_t)info.hwndFocus)+"}");}}
 if(pendingSince){INPUT input{};input.type=INPUT_KEYBOARD;input.ki.dwExtraInfo=replayMarker;input.ki.wVk=(WORD)k->vkCode;input.ki.wScan=(WORD)k->scanCode;input.ki.dwFlags=(up?KEYEVENTF_KEYUP:0)|((k->flags&LLKHF_EXTENDED)?KEYEVENTF_EXTENDEDKEY:0);queued.push_back(input);if(queued.size()>128)replay(pendingOrigin);return 1;}return CallNextHookEx(nullptr,code,message,value);}
bool suppressMouseUp=false;
LRESULT CALLBACK mouse(int code,WPARAM message,LPARAM value){if(code>=0&&message==WM_LBUTTONUP&&suppressMouseUp){suppressMouseUp=false;return 1;}if(code>=0&&message==WM_LBUTTONDOWN&&(options&4)){auto m=reinterpret_cast<MSLLHOOKSTRUCT*>(value);if(m->dwExtraInfo!=replayMarker){auto now=GetTickCount64();HWND h=GetForegroundWindow();if(explorer(h)&&blank&&now-checked<250&&abs(m->pt.x-blankX)<=3&&abs(m->pt.y-blankY)<=3&&lastClick&&now-lastClick<=GetDoubleClickTime()&&abs(m->pt.x-lastPoint.x)<=GetSystemMetrics(SM_CXDOUBLECLK)&&abs(m->pt.y-lastPoint.y)<=GetSystemMetrics(SM_CYDOUBLECLK)){AllowSetForegroundWindow(ownerPid);emit("{\"event\":\"menu\",\"hwnd\":"+std::to_string((uintptr_t)h)+",\"focus\":"+std::to_string((uintptr_t)focusedControl(h))+"}");lastClick=0;suppressMouseUp=true;return 1;}else {lastClick=now;lastPoint=m->pt;}}}return CallNextHookEx(nullptr,code,message,value);}
struct ContextRequest{unsigned id;HWND hwnd;HWND focus;};std::mutex contextLock;std::condition_variable contextWake;std::deque<ContextRequest> contextRequests;
void contextWorker(){CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);while(running){ContextRequest r{};{std::unique_lock<std::mutex> guard(contextLock);contextWake.wait(guard,[]{return !running||!contextRequests.empty();});if(!running)break;r=contextRequests.front();contextRequests.pop_front();}try{emit("{\"event\":\"context\",\"request\":"+std::to_string(r.id)+",\"value\":"+context(r.hwnd,r.focus)+"}");}catch(...){emit("{\"event\":\"context\",\"request\":"+std::to_string(r.id)+",\"error\":\"Explorer context unavailable\"}");}}CoUninitialize();}
void watch(int flags,DWORD pid){options=flags;ownerPid=pid;hookThread=GetCurrentThreadId();MSG msg;PeekMessage(&msg,nullptr,WM_USER,WM_USER,PM_NOREMOVE);std::thread polling(poll);std::thread contexts(contextWorker);std::thread input([]{std::string line;while(std::getline(std::cin,line)){std::istringstream in(line);std::string command;uintptr_t hwnd=0;in>>command>>hwnd;if(command=="replay")PostThreadMessage(hookThread,WM_APP+1,(WPARAM)hwnd,0);else if(command=="focus")PostThreadMessage(hookThread,WM_APP+2,(WPARAM)hwnd,0);else if(command=="context"){uintptr_t target=0,focus=0;in>>target>>focus;std::lock_guard<std::mutex> guard(contextLock);if(contextRequests.size()<16){contextRequests.push_back({(unsigned)hwnd,(HWND)target,(HWND)focus});contextWake.notify_one();}}else if(command=="stop")break;}PostThreadMessage(hookThread,WM_QUIT,0,0);});HHOOK keys=(options&3)?SetWindowsHookExW(WH_KEYBOARD_LL,keyboard,GetModuleHandle(nullptr),0):nullptr,clicks=(options&4)?SetWindowsHookExW(WH_MOUSE_LL,mouse,GetModuleHandle(nullptr),0):nullptr;if(((options&3)&&!keys)||((options&4)&&!clicks))emit("{\"event\":\"error\",\"message\":\"Cannot install Explorer hooks\"}");HWINEVENTHOOK foregroundEvent=(options&8)?SetWinEventHook(EVENT_SYSTEM_FOREGROUND,EVENT_SYSTEM_FOREGROUND,nullptr,dialogEvents,0,0,WINEVENT_OUTOFCONTEXT):nullptr,showEvent=(options&8)?SetWinEventHook(EVENT_OBJECT_SHOW,EVENT_OBJECT_SHOW,nullptr,dialogEvents,0,0,WINEVENT_OUTOFCONTEXT):nullptr;SetTimer(nullptr,1,100,nullptr);emit("{\"event\":\"ready\"}");while(GetMessageW(&msg,nullptr,0,0)>0){if(msg.message==WM_APP+1)replay((HWND)msg.wParam);else if(msg.message==WM_APP+2){DWORD pid=0;GetWindowThreadProcessId((HWND)msg.wParam,&pid);if(pid==ownerPid)focusWindow((HWND)msg.wParam);}else if(msg.message==WM_TIMER){notifyDialog(GetForegroundWindow());if(pendingSince&&GetTickCount64()-pendingSince>1500)replay(pendingOrigin);}else {TranslateMessage(&msg);DispatchMessageW(&msg);}}replay(pendingOrigin);if(foregroundEvent)UnhookWinEvent(foregroundEvent);if(showEvent)UnhookWinEvent(showEvent);UnhookWindowsHookEx(keys);UnhookWindowsHookEx(clicks);running=false;contextWake.notify_all();polling.detach();contexts.detach();input.detach();}
class FixtureDialogEvents:public IFileDialogEvents{
 std::atomic<ULONG> references{1};
 public:
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** value)override{if(id==IID_IUnknown||id==IID_IFileDialogEvents){*value=static_cast<IFileDialogEvents*>(this);AddRef();return S_OK;}*value=nullptr;return E_NOINTERFACE;}
 ULONG STDMETHODCALLTYPE AddRef()override{return ++references;}ULONG STDMETHODCALLTYPE Release()override{auto count=--references;if(!count)delete this;return count;}
 HRESULT STDMETHODCALLTYPE OnFileOk(IFileDialog*)override{std::cout<<"{\"event\":\"fixture-file-ok\"}"<<std::endl;return S_OK;}
 HRESULT STDMETHODCALLTYPE OnFolderChanging(IFileDialog*,IShellItem*)override{return S_OK;}
 HRESULT STDMETHODCALLTYPE OnFolderChange(IFileDialog* value)override{
  ComPtr<IShellItem> folder;PWSTR path=nullptr,name=nullptr;ComPtr<IOleWindow> window;HWND hwnd=nullptr;value->QueryInterface(IID_PPV_ARGS(&window));if(window)window->GetWindow(&hwnd);
  if(SUCCEEDED(value->GetFolder(&folder))&&SUCCEEDED(folder->GetDisplayName(SIGDN_FILESYSPATH,&path))){value->GetFileName(&name);std::cout<<"{\"event\":\"fixture-folder\",\"hwnd\":"<<(uintptr_t)hwnd<<",\"path\":"<<quote(path)<<",\"filename\":"<<quote(name?name:L"")<<"}"<<std::endl;}
  CoTaskMemFree(path);CoTaskMemFree(name);return S_OK;
 }
 HRESULT STDMETHODCALLTYPE OnSelectionChange(IFileDialog*)override{return S_OK;}
 HRESULT STDMETHODCALLTYPE OnShareViolation(IFileDialog*,IShellItem*,FDE_SHAREVIOLATION_RESPONSE* response)override{*response=FDESVR_DEFAULT;return S_OK;}
 HRESULT STDMETHODCALLTYPE OnTypeChange(IFileDialog*)override{return S_OK;}
 HRESULT STDMETHODCALLTYPE OnOverwrite(IFileDialog*,IShellItem*,FDE_OVERWRITE_RESPONSE* response)override{*response=FDEOR_DEFAULT;return S_OK;}
};
void fixtureDialog(const wchar_t* path,bool save=false){
 ComPtr<IFileDialog> dialog;HRESULT created=save?CoCreateInstance(CLSID_FileSaveDialog,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&dialog)):CoCreateInstance(CLSID_FileOpenDialog,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&dialog));if(FAILED(created)||!dialog)throw std::runtime_error("No file dialog");
 ComPtr<IShellItem> folder;if(SUCCEEDED(SHCreateItemFromParsingName(path,nullptr,IID_PPV_ARGS(&folder))))dialog->SetFolder(folder.Get());dialog->SetTitle(L"One integration file dialog");dialog->SetFileName(L"keep filename.txt");
 auto* events=new FixtureDialogEvents();DWORD cookie=0;dialog->Advise(events,&cookie);events->Release();
 // Start in a foreground host, as a user opening a modal dialog would. Never
 // refocus the file dialog after Show: that would mask first-attachment bugs.
 HWND host=CreateWindowExW(0,L"STATIC",L"One file dialog test host",WS_OVERLAPPEDWINDOW,CW_USEDEFAULT,CW_USEDEFAULT,460,280,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
 if(!host)throw std::runtime_error("No file dialog test host");SetWindowPos(host,HWND_TOP,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW);focusWindow(host);
 HRESULT result=dialog->Show(host);DestroyWindow(host);dialog->Unadvise(cookie);std::cout<<"{\"event\":\"fixture-closed\",\"accepted\":"<<(SUCCEEDED(result)?"true":"false")<<"}"<<std::endl;
}
int wmain(int argc,wchar_t** argv){SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);try{if(argc==3&&testMode()&&wcscmp(argv[1],L"fixture-dialog")==0)fixtureDialog(argv[2]);else if(argc==4&&testMode()&&wcscmp(argv[1],L"fixture-dialog")==0)fixtureDialog(argv[3],wcscmp(argv[2],L"save")==0);else if(argc>=2&&wcscmp(argv[1],L"context")==0)std::cout<<context(argc>2?(HWND)(uintptr_t)std::stoull(argv[2]):GetForegroundWindow(),argc>3?(HWND)(uintptr_t)std::stoull(argv[3]):nullptr)<<std::endl;else if(argc==5&&wcscmp(argv[1],L"focus")==0){HWND h=(HWND)(uintptr_t)std::stoull(argv[2]);DWORD p=0;GetWindowThreadProcessId(h,&p);if(IsWindow(h)&&p==std::stoul(argv[3])&&creation(p)==utf8(argv[4]))focusWindow(h);}else if((argc==6||argc==7)&&wcscmp(argv[1],L"jump")==0)jump((HWND)(uintptr_t)std::stoull(argv[2]),std::stoul(argv[3]),utf8(argv[4]),argv[5],argc==7?(HWND)(uintptr_t)std::stoull(argv[6]):nullptr);else if(argc==4&&wcscmp(argv[1],L"watch")==0)watch(std::stoi(argv[2]),std::stoul(argv[3]));else throw std::runtime_error("Invalid arguments");CoUninitialize();return 0;}catch(const std::exception& e){std::cerr<<e.what()<<std::endl;CoUninitialize();return 1;}}
