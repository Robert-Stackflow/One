#pragma once
#include <UIAutomation.h>
#include <functional>
#include <chrono>
#include <deque>
#include <optional>

// The hook only classifies input. COM, clipboard access and window operations
// run on workers so a slow application cannot stall system mouse input.
namespace quick {
constexpr ULONG_PTR injected=0x4f4e4551,fixtureInput=0x4f4e4554;
enum Flag {Volume=1,Copy=2,Paste=4,Move=8,Natural=16};
struct Config {int flags=0,step=2,pixels=8,edges[4]{},steps[4]{2,2,2,2};bool paused=false,pauseFullscreen=true;DWORD owner=0;unsigned revision=0;std::vector<std::wstring> excluded;};
std::atomic<std::shared_ptr<const Config>> config{std::make_shared<Config>()};
std::atomic<bool> ending=false,contextBlocked=true;std::atomic<HWND> contextWindow=nullptr;
std::atomic<unsigned> gesture=0,contextRevision=0;std::atomic<DWORD> hookThread=0;
std::thread hooks,actions,copies,context;
std::mutex jobsMutex,copyMutex,displaysMutex;std::condition_variable jobsWake,copyWake;
enum Kind {AdjustVolume,AdjustBrightness,ReverseWheel,DoPaste,MoveWindow,CopyText};
struct Job {Kind kind;HWND window=nullptr;POINT point{};int delta=0;bool horizontal=false,toggle=false;unsigned revision=0,gesture=0;DWORD clipboard=0;POINT start{};bool textHint=false;};
std::deque<Job> jobs;std::optional<Job> selection;std::vector<RECT> displays;
std::function<void(bool,POINT,int,bool)> adjust;
std::function<void(const std::wstring&)> report;
bool testing=false;
bool pressed(int key){return (GetAsyncKeyState(key)&0x8000)!=0;}
bool modifiers(){return pressed(VK_CONTROL)||pressed(VK_MENU)||pressed(VK_SHIFT)||pressed(VK_LWIN)||pressed(VK_RWIN);}
bool allowed(const Config& c,HWND window){return !c.paused&&window&&window==contextWindow.load()&&!contextBlocked.load()&&contextRevision.load()==c.revision;}
void enqueue(Job job){std::lock_guard lock(jobsMutex);
 if(!jobs.empty()&&job.kind==MoveWindow&&jobs.back().kind==MoveWindow&&jobs.back().window==job.window)jobs.back()=job;
 else if(jobs.size()<256)jobs.push_back(job);
 jobsWake.notify_one();
}
void mouseInput(DWORD flags,int delta=0){INPUT i{};i.type=INPUT_MOUSE;i.mi.dwFlags=flags;i.mi.mouseData=(DWORD)delta;i.mi.dwExtraInfo=injected;SendInput(1,&i,sizeof(i));}
void chord(WORD key){INPUT input[4]{};for(auto& i:input){i.type=INPUT_KEYBOARD;i.ki.dwExtraInfo=injected;}input[0].ki.wVk=input[3].ki.wVk=VK_CONTROL;input[1].ki.wVk=input[2].ki.wVk=key;input[2].ki.dwFlags=input[3].ki.dwFlags=KEYEVENTF_KEYUP;SendInput(4,input,sizeof(INPUT));}
bool password(HWND window){GUITHREADINFO gui{sizeof(gui)};DWORD thread=GetWindowThreadProcessId(window,nullptr);if(!GetGUIThreadInfo(thread,&gui)||!gui.hwndFocus)return false;wchar_t cls[128]{};GetClassNameW(gui.hwndFocus,cls,128);return (_wcsicmp(cls,L"Edit")==0||wcsstr(cls,L"RichEdit"))&&(GetWindowLongPtrW(gui.hwndFocus,GWL_STYLE)&ES_PASSWORD);}
void sampleContext(){ULONGLONG topology=0;while(!ending){auto c=config.load();if(!c->flags&&std::none_of(std::begin(c->edges),std::end(c->edges),[](int n){return n!=0;})){contextWindow=nullptr;contextBlocked=true;std::this_thread::sleep_for(std::chrono::milliseconds(100));continue;}
  HWND window=GetForegroundWindow();bool blocked=!window||c->paused||password(window);DWORD pid=0;GetWindowThreadProcessId(window,&pid);if(testing&&pid!=c->owner)blocked=true;
  if(!blocked&&!c->excluded.empty()){HANDLE p=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);if(p){wchar_t path[32768]{};DWORD length=32768;if(QueryFullProcessImageNameW(p,0,path,&length)){std::wstring name=path;auto slash=name.find_last_of(L"\\/");if(slash!=std::wstring::npos)name.erase(0,slash+1);std::transform(name.begin(),name.end(),name.begin(),towlower);blocked=std::find(c->excluded.begin(),c->excluded.end(),name)!=c->excluded.end();}CloseHandle(p);}}
  if(!blocked&&c->pauseFullscreen&&pid!=c->owner){RECT rect{};MONITORINFO info{sizeof(info)};wchar_t cls[128]{};GetClassNameW(window,cls,128);auto m=MonitorFromWindow(window,MONITOR_DEFAULTTONEAREST);if(wcscmp(cls,L"Progman")&&wcscmp(cls,L"WorkerW")&&wcscmp(cls,L"Shell_TrayWnd")&&GetWindowRect(window,&rect)&&GetMonitorInfoW(m,&info)){auto r=info.rcMonitor;blocked=std::abs(rect.left-r.left)<=2&&std::abs(rect.top-r.top)<=2&&std::abs(rect.right-r.right)<=2&&std::abs(rect.bottom-r.bottom)<=2;}}
  contextBlocked=blocked;contextWindow=window;contextRevision=c->revision;
  auto now=GetTickCount64();if(now-topology>3000){std::vector<RECT> value;EnumDisplayMonitors(nullptr,nullptr,[](HMONITOR,HDC,LPRECT r,LPARAM v)->BOOL{((std::vector<RECT>*)v)->push_back(*r);return TRUE;},(LPARAM)&value);{std::lock_guard lock(displaysMutex);displays=std::move(value);}topology=now;}
  std::this_thread::sleep_for(std::chrono::milliseconds(40));
 }}
int edgeAt(POINT p,const Config& c){auto monitor=MonitorFromPoint(p,MONITOR_DEFAULTTONULL);MONITORINFO info{sizeof(info)};if(!monitor||!GetMonitorInfoW(monitor,&info))return -1;auto b=info.rcMonitor;
 bool nearEdge[4]={p.y<b.top+c.pixels,p.x>=b.right-c.pixels,p.y>=b.bottom-c.pixels,p.x<b.left+c.pixels};POINT outside[4]={{p.x,b.top-1},{b.right,p.y},{p.x,b.bottom},{b.left-1,p.y}};
 int best=-1,distance=INT_MAX,distances[4]={p.y-b.top,b.right-1-p.x,b.bottom-1-p.y,p.x-b.left};std::lock_guard lock(displaysMutex);for(int e=0;e<4;e++)if(nearEdge[e]&&c.edges[e]){bool shared=false;for(auto r:displays)if(!EqualRect(&r,&b)&&PtInRect(&r,outside[e])){shared=true;break;}if(!shared&&distances[e]<distance){best=e;distance=distances[e];}}return best;
}
bool textCursor(){CURSORINFO c{sizeof(c)};return GetCursorInfo(&c)&&c.hCursor==LoadCursorW(nullptr,IDC_IBEAM);}
HWND movable(POINT point){HWND w=GetAncestor(WindowFromPoint(point),GA_ROOT);if(!w||IsZoomed(w)||IsIconic(w)||!(GetWindowLongPtrW(w,GWL_STYLE)&(WS_CAPTION|WS_THICKFRAME)))return nullptr;return w;}
bool left=false,leftReleased=false,rightSuppressed=false,middleSuppressed=false,dragged=false,selectable=false,controlSelection=false,textGesture=false;
POINT down{},middleDown{},lastDown{};RECT moveRect{};HWND moveTarget=nullptr,selectionTarget=nullptr,lastClickWindow=nullptr;unsigned selectionRevision=0;unsigned middleRevision=0;ULONGLONG lastClick=0;bool doubleClick=false;
LRESULT CALLBACK hook(int code,WPARAM message,LPARAM data){if(code<0)return CallNextHookEx(nullptr,code,message,data);auto& event=*(MSLLHOOKSTRUCT*)data;
 if(event.dwExtraInfo==injected||((event.flags&LLMHF_INJECTED)&&!(testing&&event.dwExtraInfo==fixtureInput)))return CallNextHookEx(nullptr,code,message,data);
 auto c=config.load();HWND front=GetForegroundWindow();bool active=allowed(*c,front);
 if(message==WM_RBUTTONUP&&rightSuppressed){rightSuppressed=false;return 1;}
 if(message==WM_LBUTTONUP&&leftReleased){left=false;leftReleased=false;return 1;}
 if(message==WM_MBUTTONUP&&middleSuppressed){middleSuppressed=false;if(c->revision==middleRevision&&active){if(dragged&&moveTarget)enqueue({MoveWindow,moveTarget,{moveRect.left+event.pt.x-middleDown.x,moveRect.top+event.pt.y-middleDown.y},0,false,false,c->revision});else if(c->flags&Volume)enqueue({AdjustVolume,front,event.pt,0,false,true,c->revision});}moveTarget=nullptr;return 1;}
 // Let Windows advance the cursor. Swallowing movement freezes its reference
 // point, causing later deltas (and button-up) to pull the window back.
 if(message==WM_MOUSEMOVE&&middleSuppressed){if(c->revision==middleRevision&&moveTarget){if(std::abs(event.pt.x-middleDown.x)>=GetSystemMetrics(SM_CXDRAG)||std::abs(event.pt.y-middleDown.y)>=GetSystemMetrics(SM_CYDRAG))dragged=true;if(dragged)enqueue({MoveWindow,moveTarget,{moveRect.left+event.pt.x-middleDown.x,moveRect.top+event.pt.y-middleDown.y},0,false,false,c->revision});}return CallNextHookEx(nullptr,code,message,data);}
 if(message==WM_LBUTTONDOWN){left=true;leftReleased=false;++gesture;down=event.pt;selectable=!c->paused&&(c->flags&Copy);selectionTarget=GetAncestor(WindowFromPoint(event.pt),GA_ROOT);selectionRevision=c->revision;controlSelection=pressed(VK_CONTROL);textGesture=textCursor();auto now=GetTickCount64();doubleClick=lastClickWindow==selectionTarget&&now-lastClick<=GetDoubleClickTime()&&std::abs(event.pt.x-lastDown.x)<=GetSystemMetrics(SM_CXDOUBLECLK)&&std::abs(event.pt.y-lastDown.y)<=GetSystemMetrics(SM_CYDOUBLECLK);lastClick=now;lastDown=event.pt;lastClickWindow=selectionTarget;}
 if(message==WM_MOUSEMOVE&&left){if(pressed(VK_CONTROL))controlSelection=true;if(textCursor())textGesture=true;}
 if(message==WM_LBUTTONUP){left=false;bool selected=doubleClick||std::abs(event.pt.x-down.x)>=GetSystemMetrics(SM_CXDRAG)||std::abs(event.pt.y-down.y)>=GetSystemMetrics(SM_CYDRAG);if(!c->paused&&front==selectionTarget&&selectionRevision==c->revision&&selectable&&!controlSelection&&!pressed(VK_CONTROL)&&selected){std::lock_guard lock(copyMutex);selection=Job{CopyText,front,event.pt,0,false,false,c->revision,gesture.load(),GetClipboardSequenceNumber()};selection->start=down;selection->textHint=textGesture||textCursor();copyWake.notify_one();}selectable=false;}
 if(!active)return CallNextHookEx(nullptr,code,message,data);
 if(message==WM_RBUTTONDOWN&&left&&!leftReleased&&(c->flags&Paste)&&!modifiers()){rightSuppressed=true;leftReleased=true;selectable=false;++gesture;enqueue({DoPaste,front,event.pt,0,false,false,c->revision});return 1;}
 if(message==WM_MBUTTONDOWN&&pressed(VK_MENU)&&(c->flags&(Volume|Move))&&!pressed(VK_CONTROL)&&!pressed(VK_SHIFT)){middleSuppressed=true;middleRevision=c->revision;middleDown=event.pt;dragged=false;moveTarget=(c->flags&Move)?movable(event.pt):nullptr;if(moveTarget&&!GetWindowRect(moveTarget,&moveRect))moveTarget=nullptr;return 1;}
 if(message==WM_MOUSEWHEEL||message==WM_MOUSEHWHEEL){static unsigned wheelRevision=0;static int remainder[5]{};if(wheelRevision!=c->revision){std::fill(std::begin(remainder),std::end(remainder),0);wheelRevision=c->revision;}int delta=(SHORT)HIWORD(event.mouseData);if(!delta)return CallNextHookEx(nullptr,code,message,data);
  if(message==WM_MOUSEWHEEL){int edge=edgeAt(event.pt,*c);if((c->flags&Volume)&&pressed(VK_MENU)){remainder[0]+=delta*c->step;int value=remainder[0]/WHEEL_DELTA;remainder[0]%=WHEEL_DELTA;if(value)enqueue({AdjustVolume,front,event.pt,value,false,false,c->revision});return 1;}if(edge>=0){remainder[edge+1]+=delta*c->steps[edge];int value=remainder[edge+1]/WHEEL_DELTA;remainder[edge+1]%=WHEEL_DELTA;if(value)enqueue({c->edges[edge]==1?AdjustVolume:AdjustBrightness,front,event.pt,value,false,false,c->revision});return 1;}}
  if(c->flags&Natural){enqueue({ReverseWheel,front,event.pt,-delta,message==WM_MOUSEHWHEEL,false,c->revision});return 1;}
 }
 return CallNextHookEx(nullptr,code,message,data);
}
void work(){while(!ending){Job job;{std::unique_lock lock(jobsMutex);jobsWake.wait(lock,[]{return ending||!jobs.empty();});if(ending)break;job=jobs.front();jobs.pop_front();}
 auto c=config.load();
 // Always balance the consumed left-button gesture, including during reconfiguration.
 if(job.kind==DoPaste)mouseInput(MOUSEEVENTF_LEFTUP);
 if(job.revision!=c->revision)continue;
 if(job.kind==MoveWindow){if(!c->paused&&IsWindow(job.window)&&!IsZoomed(job.window))SetWindowPos(job.window,nullptr,job.point.x,job.point.y,0,0,SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE|SWP_ASYNCWINDOWPOS);continue;}
 if(!allowed(*c,job.window)||GetForegroundWindow()!=job.window)continue;
 if(job.kind==AdjustVolume||job.kind==AdjustBrightness)adjust(job.kind==AdjustVolume,job.point,job.delta,job.toggle);
 else if(job.kind==ReverseWheel)mouseInput(job.horizontal?MOUSEEVENTF_HWHEEL:MOUSEEVENTF_WHEEL,job.delta);
 else if(job.kind==DoPaste&&!modifiers())chord('V');
 }}
bool validSelection(const Job& job){auto c=config.load();return !ending&&job.revision==c->revision&&job.gesture==gesture&&allowed(*c,job.window)&&GetForegroundWindow()==job.window&&!pressed(VK_CONTROL)&&GetClipboardSequenceNumber()==job.clipboard;}
std::wstring selectedText(IUIAutomationElement* element){BOOL secret=FALSE;if(FAILED(element->get_CurrentIsPassword(&secret))||secret)return L"";ComPtr<IUIAutomationTextPattern> pattern;if(FAILED(element->GetCurrentPatternAs(UIA_TextPatternId,IID_PPV_ARGS(&pattern)))||!pattern)return L"";ComPtr<IUIAutomationTextRangeArray> ranges;if(FAILED(pattern->GetSelection(&ranges))||!ranges)return L"";int count=0;ranges->get_Length(&count);std::wstring text;for(int i=0;i<std::min(count,32);i++){ComPtr<IUIAutomationTextRange> range;BSTR value=nullptr;if(SUCCEEDED(ranges->GetElement(i,&range))&&range&&SUCCEEDED(range->GetText(1024*1024,&value))&&value){if(!text.empty())text+=L"\r\n";text.append(value,SysStringLen(value));SysFreeString(value);if(text.size()>1024*1024)return L"";}}return text;}
void copyWorker(){HRESULT hr=CoInitializeEx(nullptr,COINIT_MULTITHREADED);HWND clipboardOwner=CreateWindowW(L"STATIC",L"One clipboard",0,0,0,0,0,HWND_MESSAGE,nullptr,GetModuleHandleW(nullptr),nullptr);ComPtr<IUIAutomation> automation;/* Initialized lazily on the first text-selection gesture. */
 auto initialize=[&]{CoCreateInstance(CLSID_CUIAutomation8,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&automation));if(automation){ComPtr<IUIAutomation2> limits;if(SUCCEEDED(automation.As(&limits))){limits->put_ConnectionTimeout(200);limits->put_TransactionTimeout(300);}}};
 while(!ending){Job job;{std::unique_lock lock(copyMutex);copyWake.wait(lock,[]{return ending||selection.has_value();});if(ending)break;job=*selection;selection.reset();}
  std::this_thread::sleep_for(std::chrono::milliseconds(85));if(!validSelection(job)||password(job.window))continue;if(!automation)initialize();if(!automation)continue;
  ComPtr<IUIAutomationTreeWalker> walker;automation->get_ControlViewWalker(&walker);std::wstring text;bool secretSelection=false,nonText=false;
  // A drag can end outside the text or can itself focus the window. Prefer
  // its starting element, then the end point and the final focused control.
  for(int candidate=0;candidate<3&&text.empty()&&!secretSelection;candidate++){
   ComPtr<IUIAutomationElement> element;if(candidate==0)automation->ElementFromPoint(job.start,&element);else if(candidate==1)automation->ElementFromPoint(job.point,&element);else automation->GetFocusedElement(&element);
   for(int depth=0;element&&depth<8;depth++){BOOL secret=FALSE;if(FAILED(element->get_CurrentIsPassword(&secret))){secretSelection=true;break;}if(secret){secretSelection=true;break;}DWORD pid=0;GetWindowThreadProcessId(job.window,&pid);int actual=0;auto processResult=element->get_CurrentProcessId(&actual);CONTROLTYPEID type=0;element->get_CurrentControlType(&type);if(candidate==0&&depth==0)nonText=type==UIA_ButtonControlTypeId||type==UIA_ListItemControlTypeId||type==UIA_ListControlTypeId||type==UIA_TreeItemControlTypeId||type==UIA_TreeControlTypeId||type==UIA_ScrollBarControlTypeId||type==UIA_SliderControlTypeId||type==UIA_ImageControlTypeId||type==UIA_MenuItemControlTypeId||type==UIA_TabItemControlTypeId||type==UIA_HeaderControlTypeId;if(FAILED(processResult)||actual!=(int)pid)break;text=selectedText(element.Get());if(!text.empty())break;ComPtr<IUIAutomationElement> parent;if(!walker||FAILED(walker->GetParentElement(element.Get(),&parent)))break;element=parent;}
  }
  if(secretSelection||!validSelection(job)||modifiers())continue;
  // Copy through the application so its final selection, line endings and rich
  // clipboard formats are preserved. Custom-rendered text
  // often has no TextPattern; a selection gesture in its pane still supports
  // the standard copy command. Concrete non-text controls never use this path.
  if(!text.empty()||job.textHint||!nonText){chord('C');for(int i=0;i<12&&validSelection(job);i++)std::this_thread::sleep_for(std::chrono::milliseconds(16));}
  // A changed clipboard belongs to the application (or the user). Only fall
  // back to the confirmed UIA text when its copy command produced no result.
  if(text.empty()||!validSelection(job)||modifiers())continue;
  HGLOBAL memory=GlobalAlloc(GMEM_MOVEABLE,(text.size()+1)*sizeof(wchar_t));if(!memory)continue;auto p=GlobalLock(memory);if(!p){GlobalFree(memory);continue;}memcpy(p,text.c_str(),(text.size()+1)*sizeof(wchar_t));GlobalUnlock(memory);
  if(clipboardOwner&&OpenClipboard(clipboardOwner)){if(validSelection(job)&&EmptyClipboard()&&SetClipboardData(CF_UNICODETEXT,memory))memory=nullptr;CloseClipboard();}if(memory)GlobalFree(memory);
 }automation.Reset();if(clipboardOwner)DestroyWindow(clipboardOwner);if(SUCCEEDED(hr))CoUninitialize();
}
void configure(std::istringstream& in){auto value=std::make_shared<Config>();int paused=0,pause=1;std::string excluded;if(!(in>>value->flags>>value->step>>paused>>pause>>value->owner>>value->pixels))return;for(int i=0;i<4;i++)if(!(in>>value->edges[i]>>value->steps[i]))return;in>>excluded;value->paused=paused!=0;value->pauseFullscreen=pause!=0;value->revision=config.load()->revision+1;
 std::string bytes;if(excluded!="-")for(size_t i=0;i+1<excluded.size();i+=2){try{bytes+=(char)std::stoi(excluded.substr(i,2),nullptr,16);}catch(...){return;}}int length=MultiByteToWideChar(CP_UTF8,0,bytes.data(),(int)bytes.size(),nullptr,0);std::wstring names(length,0);MultiByteToWideChar(CP_UTF8,0,bytes.data(),(int)bytes.size(),names.data(),length);std::transform(names.begin(),names.end(),names.begin(),towlower);std::wistringstream list(names);std::wstring name;while(std::getline(list,name,L',')){auto first=name.find_first_not_of(L" \t\r\n"),last=name.find_last_not_of(L" \t\r\n");if(first!=std::wstring::npos)value->excluded.push_back(name.substr(first,last-first+1));}
 config.store(value);++gesture;
 if(hookThread)PostThreadMessageW(hookThread,WM_APP,0,0);
}
void start(std::function<void(bool,POINT,int,bool)> callback,std::function<void(const std::wstring&)> error){adjust=callback;report=error;wchar_t env[8]{};testing=GetEnvironmentVariableW(L"ONE_TEST_MODE",env,8)&&wcscmp(env,L"1")==0;context=std::thread(sampleContext);actions=std::thread(work);copies=std::thread(copyWorker);hooks=std::thread([]{MSG msg{};PeekMessageW(&msg,nullptr,WM_USER,WM_USER,PM_NOREMOVE);hookThread=GetCurrentThreadId();HHOOK h=nullptr;auto refresh=[&]{auto c=config.load();bool needed=!c->paused&&(c->flags||std::any_of(std::begin(c->edges),std::end(c->edges),[](int n){return n!=0;}));if(needed&&!h){h=SetWindowsHookExW(WH_MOUSE_LL,hook,GetModuleHandleW(nullptr),0);if(!h)report(L"鼠标增强监听无法启动");}else if(!needed&&h&&!middleSuppressed&&!rightSuppressed&&!leftReleased){UnhookWindowsHookEx(h);h=nullptr;}};SetTimer(nullptr,1,100,nullptr);refresh();while(!ending&&GetMessageW(&msg,nullptr,0,0)>0){if(msg.message==WM_APP||msg.message==WM_TIMER)refresh();TranslateMessage(&msg);DispatchMessageW(&msg);}if(h)UnhookWindowsHookEx(h);hookThread=0;});}
void stop(){ending=true;jobsWake.notify_all();copyWake.notify_all();if(hookThread)PostThreadMessageW(hookThread,WM_QUIT,0,0);if(hooks.joinable())hooks.join();if(actions.joinable())actions.join();if(copies.joinable())copies.join();if(context.joinable())context.join();}
}
