#define wmain oneSearchMain
#include "../native/search-bridge.cpp"
#undef wmain
#include <commctrl.h>

int wmain(){
 SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
 CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
 INITCOMMONCONTROLSEX controls{sizeof(controls),ICC_LISTVIEW_CLASSES};InitCommonControlsEx(&controls);
 WNDCLASSW type{};type.lpfnWndProc=DefWindowProcW;type.hInstance=GetModuleHandleW(nullptr);type.lpszClassName=L"WorkerW";RegisterClassW(&type);
 HWND root=CreateWindowExW(WS_EX_TOOLWINDOW|WS_EX_TOPMOST,L"WorkerW",L"One desktop menu fixture",WS_POPUP,60,60,480,240,nullptr,nullptr,type.hInstance,nullptr);
 HWND list=CreateWindowExW(0,WC_LISTVIEWW,L"",WS_CHILD|WS_VISIBLE|LVS_ICON,0,0,480,240,root,nullptr,type.hInstance,nullptr);
 LVITEMW item{};item.mask=LVIF_TEXT;item.pszText=const_cast<wchar_t*>(L"One fixture icon");ListView_InsertItem(list,&item);
 ShowWindow(root,SW_SHOWNOACTIVATE);UpdateWindow(root);UpdateWindow(list);
 RECT label{};ListView_GetItemRect(list,0,&label,LVIR_LABEL);
 POINT icon{(label.left+label.right)/2,(label.top+label.bottom)/2},blank{400,180};ClientToScreen(list,&icon);ClientToScreen(list,&blank);
 const bool iconRejected=!desktopBlank(root,icon),blankAccepted=desktopBlank(root,blank),foreignRejected=!desktop(root);
 ShowWindow(list,SW_HIDE);const bool hiddenIconsAccepted=desktopBlank(root,blank);
 DestroyWindow(root);CoUninitialize();
 const bool pass=iconRejected&&blankAccepted&&hiddenIconsAccepted&&foreignRejected;
 std::cout<<"{\"result\":\""<<(pass?"PASS":"FAIL")<<"\",\"iconRejected\":"<<iconRejected<<",\"blankAccepted\":"<<blankAccepted<<",\"hiddenIconsAccepted\":"<<hiddenIconsAccepted<<",\"foreignDesktopRejected\":"<<foreignRejected<<"}"<<std::endl;
 return pass?0:1;
}
