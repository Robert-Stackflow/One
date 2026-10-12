#include <windows.h>
#include <dwmapi.h>
#include <UIAutomation.h>
#include <oleacc.h>
#include <wrl/client.h>
#include <algorithm>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <thread>
#include <chrono>
#include <fcntl.h>
#include <io.h>
using Microsoft::WRL::ComPtr;
struct Candidate { RECT rect; bool window; };
static bool contains(const RECT& r, POINT p) { return r.right-r.left >= 2 && r.bottom-r.top >= 2 && p.x>=r.left && p.x<r.right && p.y>=r.top && p.y<r.bottom; }
static RECT visibleRect(HWND hwnd) { RECT r{}; if (FAILED(DwmGetWindowAttribute(hwnd,DWMWA_EXTENDED_FRAME_BOUNDS,&r,sizeof(r)))) GetWindowRect(hwnd,&r); return r; }
struct WindowSearch { POINT point; DWORD owner; HWND excluded; HWND found=nullptr; };
static BOOL CALLBACK findWindow(HWND hwnd, LPARAM parameter) {
  auto& search=*reinterpret_cast<WindowSearch*>(parameter); DWORD pid=0; GetWindowThreadProcessId(hwnd,&pid);
  if (!pid || hwnd==search.excluded || (!search.excluded && pid==search.owner) || !IsWindowVisible(hwnd) || IsIconic(hwnd)) return TRUE;
  DWORD cloaked=0; DwmGetWindowAttribute(hwnd,DWMWA_CLOAKED,&cloaked,sizeof(cloaked));
  if (cloaked || (GetWindowLongPtrW(hwnd,GWL_EXSTYLE)&WS_EX_TRANSPARENT)) return TRUE;
  if (contains(visibleRect(hwnd),search.point)) { search.found=hwnd; return FALSE; } return TRUE;
}
static void add(std::vector<Candidate>& rows, RECT r, bool window, POINT p) {
  if (!window && !rows.empty()) {
    RECT clipped{};
    if (!IntersectRect(&clipped, &r, &rows.front().rect)) return;
    r = clipped;
  }
  if (!contains(r,p)) return;
  auto existing=std::find_if(rows.begin(),rows.end(),[&](const Candidate& c){return EqualRect(&c.rect,&r);});
  if(existing==rows.end()) {
    if(rows.size()<24)rows.push_back({r,window});
    else {
      auto largest=std::max_element(rows.begin()+1,rows.end(),[](const Candidate& a,const Candidate& b){return int64_t(a.rect.right-a.rect.left)*(a.rect.bottom-a.rect.top)<int64_t(b.rect.right-b.rect.left)*(b.rect.bottom-b.rect.top);});
      if(int64_t(r.right-r.left)*(r.bottom-r.top)<int64_t(largest->rect.right-largest->rect.left)*(largest->rect.bottom-largest->rect.top))*largest={r,window};
    }
  }
}
static void output(unsigned serial, const std::vector<Candidate>& rows, const char* status) {
  std::cout << "{\"serial\":" << serial << ",\"status\":\"" << status << "\",\"candidates\":[";
  bool first=true; for(const auto& row:rows) { if(!first)std::cout<<','; first=false; auto r=row.rect;
    std::cout<<"{\"kind\":\""<<(row.window?"window":"element")<<"\",\"rect\":{\"x\":"<<r.left<<",\"y\":"<<r.top<<",\"width\":"<<r.right-r.left<<",\"height\":"<<r.bottom-r.top<<"}}";
  } std::cout<<"]}"<<std::endl;
}
static void probe(IUIAutomation* automation, unsigned serial, POINT point, DWORD owner, HWND excluded) {
  std::vector<Candidate> rows; WindowSearch search{point,owner,excluded}; EnumWindows(findWindow,reinterpret_cast<LPARAM>(&search));
  if (!search.found) { output(serial,rows,"empty"); return; }
  add(rows,visibleRect(search.found),true,point);
  // HWND children remain useful when an application exposes no UI Automation provider.
  HWND current=search.found;
  for(int depth=0;depth<12;depth++) {
    POINT client=point; if(!ScreenToClient(current,&client))break;
    HWND child=ChildWindowFromPointEx(current,client,CWP_SKIPINVISIBLE|CWP_SKIPTRANSPARENT);
    if(!child || child==current)break;
    RECT r{}; if(!GetWindowRect(child,&r))break; add(rows,r,false,point); current=child;
  }
  // Emit a fast window/Win32 fallback before contacting a potentially slow provider.
  output(serial,rows,"window");
  if(!automation) { output(serial,rows,"partial"); return; }
  const auto deadline=std::chrono::steady_clock::now()+std::chrono::milliseconds(400);
  const auto hitDeadline=std::chrono::steady_clock::now()+std::chrono::milliseconds(120);
  auto lastProgress=std::chrono::steady_clock::now();
  size_t published=rows.size();
  const auto progress=[&](bool force=false) {
    const auto now=std::chrono::steady_clock::now();
    if(rows.size()!=published && (force || now-lastProgress>=std::chrono::milliseconds(40))) {
      output(serial,rows,"progress"); published=rows.size(); lastProgress=now;
    }
  };
  ComPtr<IUIAutomationElement> parent;
  ComPtr<IUIAutomationTreeWalker> walker;
  ComPtr<IUIAutomationCacheRequest> cache;
  if(FAILED(automation->CreateCacheRequest(&cache)) || FAILED(automation->get_RawViewWalker(&walker))) { output(serial,rows,"partial"); return; }
  cache->AddProperty(UIA_BoundingRectanglePropertyId); cache->AddProperty(UIA_IsOffscreenPropertyId);
  cache->put_TreeScope(TreeScope_Element);
  // Hit-test the UNDERLYING window's accessibility provider, not the screenshot
  // overlay. Chromium exposes its virtual elements through MSAA even though it
  // has only one HWND. Walk the returned leaf and its parents for wheel cycling.
  ComPtr<IAccessible> accessible;
  if(SUCCEEDED(AccessibleObjectFromWindow(current,OBJID_CLIENT,IID_PPV_ARGS(&accessible)))) {
    for(int depth=0;depth<24 && accessible && std::chrono::steady_clock::now()<hitDeadline;depth++) {
      VARIANT self; VariantInit(&self); self.vt=VT_I4; self.lVal=CHILDID_SELF;
      long ax=0,ay=0,aw=0,ah=0;
      if(SUCCEEDED(accessible->accLocation(&ax,&ay,&aw,&ah,self)))add(rows,{ax,ay,ax+aw,ay+ah},false,point);
      progress();
      VARIANT hit; VariantInit(&hit);
      const HRESULT result=accessible->accHitTest(point.x,point.y,&hit);
      if(FAILED(result)) { VariantClear(&hit); break; }
      if(hit.vt==VT_DISPATCH && hit.pdispVal) {
        ComPtr<IAccessible> next; hit.pdispVal->QueryInterface(IID_PPV_ARGS(&next));
        VariantClear(&hit);
        if(!next || next.Get()==accessible.Get())break;
        accessible=next; continue;
      }
      if(hit.vt==VT_I4) {
        long x=0,y=0,w=0,h=0;
        if(SUCCEEDED(accessible->accLocation(&x,&y,&w,&h,hit))) add(rows,{x,y,x+w,y+h},false,point);
        ComPtr<IUIAutomationElement> leaf;
        if(SUCCEEDED(automation->ElementFromIAccessible(accessible.Get(),hit.lVal,&leaf))) {
          for(int up=0;up<24 && leaf && std::chrono::steady_clock::now()<hitDeadline;up++) {
            RECT r{}; if(SUCCEEDED(leaf->get_CurrentBoundingRectangle(&r))) {
              add(rows,r,false,point);
              progress();
            }
            ComPtr<IUIAutomationElement> next;
            if(FAILED(walker->GetParentElementBuildCache(leaf.Get(),cache.Get(),&next)))break;
            leaf=next;
          }
        }
      }
      VariantClear(&hit); break;
    }
  }
  // Preserve MSAA discoveries even if a later UIA provider blocks until the
  // owning process's hard deadline. Don't regress to the HWND-only fallback.
  progress(true);
  if(FAILED(automation->ElementFromHandleBuildCache(search.found,cache.Get(),&parent))) { output(serial,rows,"partial"); return; }
  struct Branch { ComPtr<IUIAutomationElement> element; int depth; };
  std::vector<Branch> pending;
  int visited=0; bool partial=false;
  ComPtr<IUIAutomationCondition> all;
  automation->CreateTrueCondition(&all);
  // Request a level in one provider call. TreeWalker made two cross-process
  // calls for EVERY sibling and regularly exhausted the budget in Chromium.
  const auto children = [&](IUIAutomationElement* node, int depth) {
    ComPtr<IUIAutomationElementArray> list;
    if(!all || FAILED(node->FindAllBuildCache(TreeScope_Children,all.Get(),cache.Get(),&list)) || !list)return;
    int count=0; list->get_Length(&count);
    if(count>4096)partial=true;
    for(int i=0;i<count && i<4096 && pending.size()<512;i++) {
      if(std::chrono::steady_clock::now()>=deadline){partial=true;break;}
      ComPtr<IUIAutomationElement> child; RECT r{}; BOOL offscreen=FALSE;
      if(FAILED(list->GetElement(i,&child)) || !child || FAILED(child->get_CachedBoundingRectangle(&r)) ||
         FAILED(child->get_CachedIsOffscreen(&offscreen)) || offscreen)continue;
      if(contains(r,point) || r.right<=r.left || r.bottom<=r.top)pending.push_back({child,depth});
    }
  };
  children(parent.Get(),1);
  while(!pending.empty()) {
    if(std::chrono::steady_clock::now()>=deadline || visited>=2048) { partial=true; break; }
    const auto branch=pending.back(); pending.pop_back();
    ++visited;
    RECT r{}; BOOL offscreen=FALSE;
    if(FAILED(branch.element->get_CachedBoundingRectangle(&r)) ||
       FAILED(branch.element->get_CachedIsOffscreen(&offscreen)) || offscreen)continue;
    const bool hit=contains(r,point), empty=r.right<=r.left || r.bottom<=r.top;
    if(hit) { add(rows,r,false,point); progress(); }
    if(branch.depth<32 && (hit || empty))children(branch.element.Get(),branch.depth+1);
  }
  output(serial,rows,partial?"partial":"ok");
}
static int fixturePhase=1;
static HWND fixtureCover=nullptr;
static LRESULT CALLBACK fixtureProc(HWND window,UINT message,WPARAM wparam,LPARAM lparam) {
  if(message==WM_PAINT) {
    PAINTSTRUCT paint{}; HDC dc=BeginPaint(window,&paint); RECT client{};GetClientRect(window,&client);
    FillRect(dc,&client,reinterpret_cast<HBRUSH>(COLOR_WINDOW+1));
    HBRUSH first=CreateSolidBrush(fixturePhase==1?RGB(225,35,65):RGB(35,180,75)),second=CreateSolidBrush(RGB(32,112,208));
    for(int y=200;y<240;y++)for(int x=400;x<480;x++){RECT pixel{x,y,x+1,y+1};FillRect(dc,&pixel,(x+y)%2?first:second);}
    DeleteObject(first);DeleteObject(second);EndPaint(window,&paint);return 0;
  }
  if(message==WM_APP+1){fixturePhase=int(wparam);InvalidateRect(window,nullptr,FALSE);UpdateWindow(window);return 0;}
  if(message==WM_APP+2){
    RECT rect{};GetWindowRect(window,&rect);
    fixtureCover=CreateWindowExW(WS_EX_TOPMOST|WS_EX_TOOLWINDOW,L"STATIC",L"One native occlusion fixture",WS_POPUP|SS_GRAYRECT,rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
    ShowWindow(fixtureCover,SW_SHOWNOACTIVATE);UpdateWindow(fixtureCover);return 0;
  }
  if(message==WM_CLOSE && fixtureCover){DestroyWindow(fixtureCover);fixtureCover=nullptr;}
  return DefWindowProcW(window,message,wparam,lparam);
}
static int fixture() {
  const wchar_t* name=L"OneCaptureFixture"; WNDCLASSW cls{}; cls.lpfnWndProc=fixtureProc; cls.hInstance=GetModuleHandleW(nullptr); cls.lpszClassName=name; cls.hbrBackground=reinterpret_cast<HBRUSH>(COLOR_WINDOW+1); RegisterClassW(&cls);
  HWND window=CreateWindowExW(WS_EX_TOPMOST,name,L"One capture native verification",WS_OVERLAPPEDWINDOW,120,120,700,480,nullptr,nullptr,cls.hInstance,nullptr);
  if(!window)return 2;
  HWND edit=CreateWindowExW(WS_EX_CLIENTEDGE,L"EDIT",L"Native editable field",WS_CHILD|WS_VISIBLE|WS_TABSTOP,40,60,300,36,window,nullptr,cls.hInstance,nullptr);
  CreateWindowExW(0,L"BUTTON",L"Native test button",WS_CHILD|WS_VISIBLE|WS_TABSTOP,40,120,200,36,window,nullptr,cls.hInstance,nullptr);
  ShowWindow(window,SW_SHOWNOACTIVATE); UpdateWindow(window); RECT outer=visibleRect(window),inner{}; GetWindowRect(edit,&inner);
  std::cout<<"{\"hwnd\":"<<reinterpret_cast<uintptr_t>(window)<<",\"pid\":"<<GetCurrentProcessId()<<",\"window\":{\"x\":"<<outer.left<<",\"y\":"<<outer.top<<",\"width\":"<<outer.right-outer.left<<",\"height\":"<<outer.bottom-outer.top<<"},\"edit\":{\"x\":"<<inner.left<<",\"y\":"<<inner.top<<",\"width\":"<<inner.right-inner.left<<",\"height\":"<<inner.bottom-inner.top<<"}}"<<std::endl;
  std::thread([window]{std::string line;while(std::getline(std::cin,line)){if(line=="paint 2")PostMessageW(window,WM_APP+1,2,0);else if(line=="cover")PostMessageW(window,WM_APP+2,0,0);else break;}PostMessageW(window,WM_CLOSE,0,0);}).detach();
  MSG message{}; while(IsWindow(window) && GetMessageW(&message,nullptr,0,0)>0){TranslateMessage(&message);DispatchMessageW(&message);}return 0;
}
int wmain(int argc,wchar_t** argv) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); _setmode(_fileno(stdout),_O_BINARY);
  if(argc==2 && wcscmp(argv[1],L"--fixture")==0)return fixture();
  if(argc!=2 && argc!=3)return 2; wchar_t* end=nullptr; const DWORD owner=wcstoul(argv[1],&end,10); if(!owner || *end)return 2;
  HWND excluded=nullptr;
  if(argc==3) { const auto value=_wcstoui64(argv[2],&end,10); if(!value || *end)return 2; excluded=reinterpret_cast<HWND>(value); }
  if(FAILED(CoInitializeEx(nullptr,COINIT_MULTITHREADED)))return 3;
  ComPtr<IUIAutomation> automation;
  if(FAILED(CoCreateInstance(CLSID_CUIAutomation8,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&automation))))
    CoCreateInstance(CLSID_CUIAutomation,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&automation));
  ComPtr<IUIAutomation2> bounded;
  if(automation && SUCCEEDED(automation.As(&bounded))) {
    bounded->put_ConnectionTimeout(300); bounded->put_TransactionTimeout(200);
    bounded->put_AutoSetFocus(FALSE);
  }
  std::cout<<"{\"ready\":true}"<<std::endl;
  std::string line; while(std::getline(std::cin,line)) {
    if(line.size()>160)break;
    std::istringstream input(line); std::string command,extra; unsigned serial=0; long x=0,y=0;
    if(!(input>>command>>serial>>x>>y) || input>>extra || command!="probe" || !serial || abs(x)>100000 || abs(y)>100000)break;
    probe(automation.Get(),serial,{x,y},owner,excluded);
  }
  automation.Reset(); CoUninitialize(); return 0;
}
