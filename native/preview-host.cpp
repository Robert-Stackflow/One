#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <shobjidl.h>
#include <wrl/client.h>
#include <atomic>
#include <iostream>
#include <sstream>
#include <thread>
#include <string>
#include <algorithm>
using Microsoft::WRL::ComPtr;
static constexpr UINT updateRect=WM_APP+1;
static HWND host=nullptr,parent=nullptr;
static DWORD parentPid=0;
static ComPtr<IPreviewHandler> preview;
struct Bounds{double x,y,width,height;};
static Bounds bounds{};static UINT currentDpi=96;static bool windowSet=false;
static void result(const char* status,HRESULT hr=S_OK){std::cout<<"{\"status\":\""<<status<<"\",\"code\":\"0x"<<std::hex<<static_cast<unsigned long>(hr)<<"\"}"<<std::endl;}
static bool parentAlive(){DWORD pid=0;return IsWindow(parent)&&GetWindowThreadProcessId(parent,&pid)&&pid==parentPid;}
static void resize(){
 if(!host||!parentAlive())return;
 currentDpi=GetDpiForWindow(parent);const double scale=currentDpi/96.0;RECT area{};GetClientRect(parent,&area);
 const int x=std::clamp(static_cast<int>(bounds.x*scale),0,static_cast<int>(area.right)),y=std::clamp(static_cast<int>(bounds.y*scale),0,static_cast<int>(area.bottom));
 const int w=std::clamp(static_cast<int>(bounds.width*scale),0,static_cast<int>(area.right)-x),h=std::clamp(static_cast<int>(bounds.height*scale),0,static_cast<int>(area.bottom)-y);
 MoveWindow(host,x,y,w,h,TRUE);if(preview&&windowSet&&w>0&&h>0){RECT local{0,0,w,h};const auto hr=preview->SetRect(&local);if(FAILED(hr)){result("resize-failed",hr);PostMessageW(host,WM_CLOSE,0,0);}}
}
class Frame final:public IPreviewHandlerFrame,public IOleWindow{
 std::atomic<ULONG> refs{1};
 public:
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IPreviewHandlerFrame)*out=static_cast<IPreviewHandlerFrame*>(this);else if(id==IID_IOleWindow)*out=static_cast<IOleWindow*>(this);else return E_NOINTERFACE;AddRef();return S_OK;}
 ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}
 ULONG STDMETHODCALLTYPE Release()override{const auto n=--refs;if(!n)delete this;return n;}
 HRESULT STDMETHODCALLTYPE GetWindow(HWND* value)override{if(!value)return E_POINTER;*value=host;return S_OK;}
 HRESULT STDMETHODCALLTYPE ContextSensitiveHelp(BOOL)override{return E_NOTIMPL;}
 HRESULT STDMETHODCALLTYPE GetWindowContext(PREVIEWHANDLERFRAMEINFO* info)override{if(!info)return E_POINTER;info->haccel=nullptr;info->cAccelEntries=0;return S_OK;}
 HRESULT STDMETHODCALLTYPE TranslateAccelerator(MSG* message)override{if(message&&message->message==WM_KEYDOWN&&message->wParam==VK_ESCAPE){std::cout<<"{\"event\":\"escape\"}"<<std::endl;return S_OK;}return S_FALSE;}
};
static LRESULT CALLBACK procedure(HWND window,UINT message,WPARAM w,LPARAM l){
 if(message==updateRect){auto value=reinterpret_cast<Bounds*>(l);bounds=*value;delete value;resize();return 0;}
 if(message==WM_TIMER){if(!parentAlive())PostMessageW(window,WM_CLOSE,0,0);else if(currentDpi!=GetDpiForWindow(parent))resize();return 0;}
 if(message==WM_SETFOCUS&&preview){preview->SetFocus();return 0;}
 if(message==WM_CLOSE){ShowWindow(window,SW_HIDE);PostQuitMessage(0);return 0;}
 if(message==WM_DESTROY){PostQuitMessage(0);return 0;}
 return DefWindowProcW(window,message,w,l);
}
static HRESULT handlerClass(const wchar_t* file,CLSID& id){
 wchar_t value[128]{};DWORD size=128;auto hr=AssocQueryStringW(ASSOCF_NONE,ASSOCSTR_SHELLEXTENSION,PathFindExtensionW(file),L"{8895b1c6-b41f-4c1c-a562-0d564250836f}",value,&size);
 if(FAILED(hr))return hr;hr=CLSIDFromString(value,&id);if(FAILED(hr))return hr;
 const std::wstring key=std::wstring(L"CLSID\\")+value;HKEY registration=nullptr;
 if(RegOpenKeyExW(HKEY_CLASSES_ROOT,key.c_str(),0,KEY_READ,&registration)!=ERROR_SUCCESS)return REGDB_E_CLASSNOTREG;
 RegCloseKey(registration);return S_OK;
}
static HRESULT initialize(IUnknown* object,const wchar_t* file,ComPtr<IStream>& stream){
 ComPtr<IInitializeWithStream> withStream;
 if(SUCCEEDED(object->QueryInterface(IID_PPV_ARGS(&withStream)))){auto hr=SHCreateStreamOnFileEx(file,STGM_READ|STGM_SHARE_DENY_NONE,FILE_ATTRIBUTE_NORMAL,FALSE,nullptr,&stream);if(FAILED(hr))return hr;return withStream->Initialize(stream.Get(),STGM_READ);}
 ComPtr<IInitializeWithItem> withItem;
 if(SUCCEEDED(object->QueryInterface(IID_PPV_ARGS(&withItem)))){ComPtr<IShellItem> item;const auto hr=SHCreateItemFromParsingName(file,nullptr,IID_PPV_ARGS(&item));return FAILED(hr)?hr:withItem->Initialize(item.Get(),STGM_READ);}
 ComPtr<IInitializeWithFile> withFile;
 if(SUCCEEDED(object->QueryInterface(IID_PPV_ARGS(&withFile))))return withFile->Initialize(file,STGM_READ);
 return E_NOINTERFACE;
}
#ifdef ONE_PREVIEW_TEST
#include "../tests/native-preview-test-provider.h"
#endif
int wmain(int argc,wchar_t** argv){
 if(argc!=8)return 2;
 parent=reinterpret_cast<HWND>(_wcstoui64(argv[1],nullptr,10));parentPid=wcstoul(argv[2],nullptr,10);
 bounds={wcstod(argv[4],nullptr),wcstod(argv[5],nullptr),wcstod(argv[6],nullptr),wcstod(argv[7],nullptr)};
 if(!parentAlive()){result("parent-closed",E_INVALIDARG);return 3;}
 SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
 const auto apartment=OleInitialize(nullptr);if(FAILED(apartment)){result("failed",apartment);return 4;}
 HRESULT hr;
#ifdef ONE_PREVIEW_TEST
 preview.Attach(new TestPreview());hr=S_OK;
#else
 CLSID id{};hr=handlerClass(argv[3],id);if(FAILED(hr)){result("missing",hr);OleUninitialize();return 5;}
 // Let COM use the registered surrogate. Never load an Office DLL into One.
 hr=CoCreateInstance(id,nullptr,CLSCTX_LOCAL_SERVER,IID_PPV_ARGS(&preview));
#endif
 if(FAILED(hr)){result(hr==REGDB_E_CLASSNOTREG?"missing":"failed",hr);OleUninitialize();return 6;}
 WNDCLASSW klass{};klass.lpfnWndProc=procedure;klass.hInstance=GetModuleHandleW(nullptr);klass.lpszClassName=L"One.NativePreviewHost";klass.hbrBackground=reinterpret_cast<HBRUSH>(COLOR_WINDOW+1);RegisterClassW(&klass);
 host=CreateWindowExW(0,klass.lpszClassName,L"",WS_CHILD|WS_CLIPCHILDREN|WS_CLIPSIBLINGS,0,0,1,1,parent,nullptr,klass.hInstance,nullptr);
 if(!host){result("failed",HRESULT_FROM_WIN32(GetLastError()));preview.Reset();OleUninitialize();return 7;}
 ComPtr<Frame> frame;frame.Attach(new Frame());ComPtr<IObjectWithSite> site;preview.As(&site);if(site)site->SetSite(static_cast<IPreviewHandlerFrame*>(frame.Get()));
 ComPtr<IStream> stream;hr=initialize(preview.Get(),argv[3],stream);
 if(SUCCEEDED(hr)){resize();RECT local{};GetClientRect(host,&local);hr=preview->SetWindow(host,&local);windowSet=SUCCEEDED(hr);}
 if(SUCCEEDED(hr))hr=preview->DoPreview();
 if(SUCCEEDED(hr)){
  ShowWindow(host,SW_SHOWNOACTIVATE);SetTimer(host,1,1000,nullptr);result("ready");
  std::thread([]{std::string line;while(std::getline(std::cin,line)){if(line.size()>256)break;if(line=="close")break;std::istringstream input(line);std::string verb;auto value=new Bounds{};input>>verb>>value->x>>value->y>>value->width>>value->height;if(verb!="rect"||!input||!PostMessageW(host,updateRect,0,reinterpret_cast<LPARAM>(value)))delete value;}PostMessageW(host,WM_CLOSE,0,0);}).detach();
  MSG message{};while(GetMessageW(&message,nullptr,0,0)>0){if(message.message==WM_KEYDOWN&&message.wParam==VK_ESCAPE){std::cout<<"{\"event\":\"escape\"}"<<std::endl;continue;}if(message.message>=WM_KEYFIRST&&message.message<=WM_KEYLAST&&preview->TranslateAccelerator(&message)==S_OK)continue;TranslateMessage(&message);DispatchMessageW(&message);}
 }else result("failed",hr);
 preview->Unload();if(site)site->SetSite(nullptr);site.Reset();frame.Reset();preview.Reset();stream.Reset();if(IsWindow(host))DestroyWindow(host);OleUninitialize();return FAILED(hr)?8:0;
}
