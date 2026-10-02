#define NOMINMAX
#include <windows.h>
#include <dwmapi.h>
#include <iostream>
#include <sstream>
#include <string>
#include <map>
#include <set>
#include <thread>
#include <mutex>
#include <queue>
#include <atomic>
#include <vector>
#pragma comment(lib,"dwmapi.lib")
// Out-of-context menu events, and separate click-through border windows.
// No injection into the target process and no changes to its original DWM border.
constexpr UINT commandId=0xEED0;
constexpr ULONG_PTR ownerTag=0x4F4E4539;
struct Frame{HWND border=nullptr;DWORD pid=0;RECT rect{};int thickness=0;int alpha=-1;COLORREF color=CLR_INVALID;};
std::map<HWND,Frame> frames;std::set<HWND> menus;
std::queue<std::string> commands;std::mutex mutex;std::atomic<bool> ended=false;
bool enabled=false,menuEnabled=false,borders=true;int opacity=80,thickness=3;COLORREF color=RGB(76,139,245);HWND lastMenu=nullptr;
bool own(HMENU menu){MENUITEMINFOW i{sizeof(i)};i.fMask=MIIM_DATA;return GetMenuItemInfoW(menu,commandId,FALSE,&i)&&i.dwItemData==ownerTag;}
void menuItem(HWND hwnd){if(!IsWindow(hwnd))return;HMENU m=GetSystemMenu(hwnd,FALSE);if(!m)return;bool exists=own(m);if(!enabled||!menuEnabled){if(exists)RemoveMenu(m,commandId,MF_BYCOMMAND);return;}if(!IsWindowVisible(hwnd)||!(GetWindowLongPtrW(hwnd,GWL_STYLE)&WS_SYSMENU))return;
 MENUITEMINFOW i{sizeof(i)};i.fMask=MIIM_ID|MIIM_STATE|MIIM_STRING|MIIM_DATA;i.wID=commandId;i.dwItemData=ownerTag;i.dwTypeData=const_cast<wchar_t*>(L"始终置顶");i.fState=frames.count(hwnd)?MFS_CHECKED:MFS_UNCHECKED;
 if(exists)SetMenuItemInfoW(m,commandId,FALSE,&i);else if(GetMenuState(m,commandId,MF_BYCOMMAND)==UINT(-1))InsertMenuItemW(m,SC_CLOSE,FALSE,&i);if(own(m))menus.insert(hwnd);
}
void CALLBACK events(HWINEVENTHOOK,DWORD event,HWND hwnd,LONG object,LONG child,DWORD,DWORD){
 if(event==EVENT_SYSTEM_FOREGROUND){menuItem(hwnd);return;}
 if(!enabled||!menuEnabled)return;
 if(event==EVENT_SYSTEM_MENUPOPUPSTART&&object==OBJID_SYSMENU){lastMenu=hwnd;menuItem(hwnd);}
 if(event==EVENT_OBJECT_INVOKED&&child==commandId&&(object==OBJID_SYSMENU||object==OBJID_MENU||object==OBJID_CLIENT||lastMenu)){HWND target=nullptr;for(HWND h:{lastMenu,hwnd,GetForegroundWindow()})if(h&&IsWindow(h)&&own(GetSystemMenu(h,FALSE))){target=h;break;}if(target)std::cout<<"{\"toggle\":"<<(uintptr_t)target<<"}"<<std::endl;}
 if(event==EVENT_SYSTEM_MENUPOPUPEND&&object==OBJID_SYSMENU)lastMenu=nullptr;
}
LRESULT CALLBACK proc(HWND w,UINT m,WPARAM a,LPARAM b){if(m==WM_NCHITTEST)return HTTRANSPARENT;if(m==WM_MOUSEACTIVATE)return MA_NOACTIVATE;if(m==WM_PAINT){PAINTSTRUCT p;auto dc=BeginPaint(w,&p);RECT r;GetClientRect(w,&r);auto brush=CreateSolidBrush(color);FillRect(dc,&r,brush);DeleteObject(brush);EndPaint(w,&p);return 0;}return DefWindowProcW(w,m,a,b);}
void render(HWND target,Frame& f){DWORD pid=0;GetWindowThreadProcessId(target,&pid);DWORD cloaked=0;DwmGetWindowAttribute(target,DWMWA_CLOAKED,&cloaked,sizeof(cloaked));
 if(!enabled||!borders||!opacity||!IsWindowVisible(target)||IsIconic(target)||cloaked||pid!=f.pid||!(GetWindowLongPtrW(target,GWL_EXSTYLE)&WS_EX_TOPMOST)){if(f.border)ShowWindow(f.border,SW_HIDE);return;}
 RECT r{};if(FAILED(DwmGetWindowAttribute(target,DWMWA_EXTENDED_FRAME_BOUNDS,&r,sizeof(r))))GetWindowRect(target,&r);int t=MulDiv(thickness,GetDpiForWindow(target),96);InflateRect(&r,t,t);
 if(!f.border){f.border=CreateWindowExW(WS_EX_LAYERED|WS_EX_TOOLWINDOW|WS_EX_TRANSPARENT|WS_EX_NOACTIVATE,L"OneTopmostBorder",L"",WS_POPUP|WS_DISABLED,r.left,r.top,r.right-r.left,r.bottom-r.top,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);}
 const bool changed=!EqualRect(&r,&f.rect)||f.thickness!=t;
 if(changed){const int width=r.right-r.left,height=r.bottom-r.top;int round=IsZoomed(target)?0:MulDiv(16,GetDpiForWindow(target),96);HRGN outer=round?CreateRoundRectRgn(0,0,width+1,height+1,round+2*t,round+2*t):CreateRectRgn(0,0,width,height);HRGN inner=round?CreateRoundRectRgn(t,t,width-t+1,height-t+1,round,round):CreateRectRgn(t,t,width-t,height-t);CombineRgn(outer,outer,inner,RGN_DIFF);DeleteObject(inner);SetWindowRgn(f.border,outer,FALSE);f.rect=r;f.thickness=t;}
 if(f.alpha!=opacity){SetLayeredWindowAttributes(f.border,0,(BYTE)(opacity*255/100),LWA_ALPHA);f.alpha=opacity;}if(changed||!IsWindowVisible(f.border)||GetWindow(target,GW_HWNDNEXT)!=f.border)SetWindowPos(f.border,target,r.left,r.top,r.right-r.left,r.bottom-r.top,SWP_NOACTIVATE|SWP_SHOWWINDOW);if(changed||f.color!=color){InvalidateRect(f.border,nullptr,FALSE);f.color=color;}
}
int main(){SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);WNDCLASSW c{};c.lpfnWndProc=proc;c.hInstance=GetModuleHandleW(nullptr);c.lpszClassName=L"OneTopmostBorder";RegisterClassW(&c);
 std::thread([]{std::string line;while(std::getline(std::cin,line)){std::lock_guard<std::mutex> lock(mutex);commands.push(line);}ended=true;}).detach();
 std::vector<HWINEVENTHOOK> hooks;for(DWORD e:{EVENT_SYSTEM_FOREGROUND,EVENT_SYSTEM_MENUPOPUPSTART,EVENT_SYSTEM_MENUPOPUPEND,EVENT_OBJECT_INVOKED})hooks.push_back(SetWinEventHook(e,e,nullptr,events,0,0,WINEVENT_OUTOFCONTEXT|WINEVENT_SKIPOWNPROCESS));
 std::cout<<"{\"ready\":true}"<<std::endl;MSG msg{};ULONGLONG last=0;
 while(!ended){while(PeekMessageW(&msg,nullptr,0,0,PM_REMOVE)){TranslateMessage(&msg);DispatchMessageW(&msg);}std::queue<std::string> todo;{std::lock_guard<std::mutex> lock(mutex);std::swap(todo,commands);}while(!todo.empty()){std::istringstream in(todo.front());todo.pop();std::string cmd;in>>cmd;if(cmd=="config"){unsigned rgb;in>>enabled>>borders>>rgb>>opacity>>thickness>>menuEnabled;color=RGB((rgb>>16)&255,(rgb>>8)&255,rgb&255);for(auto h:menus)menuItem(h);menuItem(GetForegroundWindow());for(auto&[h,f]:frames)f.thickness=0;}else if(cmd=="pin"){uintptr_t h;DWORD p;in>>h>>p;frames[(HWND)h].pid=p;menuItem((HWND)h);}else if(cmd=="unpin"){uintptr_t h;in>>h;auto it=frames.find((HWND)h);if(it!=frames.end()){if(it->second.border)DestroyWindow(it->second.border);frames.erase(it);}menuItem((HWND)h);}else if(cmd=="stop")ended=true;}
 if(GetTickCount64()-last>=16){last=GetTickCount64();for(auto it=frames.begin();it!=frames.end();){DWORD pid=0;GetWindowThreadProcessId(it->first,&pid);if(!IsWindow(it->first)||pid!=it->second.pid||!(GetWindowLongPtrW(it->first,GWL_EXSTYLE)&WS_EX_TOPMOST)){if(it->second.border)DestroyWindow(it->second.border);std::cout<<"{\"unpin\":"<<(uintptr_t)it->first<<"}"<<std::endl;auto hwnd=it->first;it=frames.erase(it);menuItem(hwnd);}else{render(it->first,it->second);++it;}}}Sleep(4);}
 enabled=false;for(auto h:menus)menuItem(h);for(auto&[h,f]:frames)if(f.border)DestroyWindow(f.border);for(auto h:hooks)if(h)UnhookWinEvent(h);return 0;
}
