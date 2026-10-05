// Launch through the desktop shell view so an elevated parent does not pass
// its integrity level to the interactive One window. Based on Microsoft's
// Execute In Explorer sample (Win32 Shell documentation).
#include <windows.h>
#include <shlwapi.h>
#include <shlobj.h>
#include <shldisp.h>

static HRESULT desktopView(IShellView** out) {
 *out=nullptr;
 IShellWindows* windows=nullptr;
 HRESULT hr=CoCreateInstance(CLSID_ShellWindows,nullptr,CLSCTX_LOCAL_SERVER,IID_PPV_ARGS(&windows));
 if(FAILED(hr))return hr;
 VARIANT empty{};HWND hwnd=nullptr;IDispatch* dispatch=nullptr;
 hr=windows->FindWindowSW(&empty,&empty,SWC_DESKTOP,reinterpret_cast<long*>(&hwnd),SWFO_NEEDDISPATCH,&dispatch);
 if(hr==S_OK){
  IShellBrowser* browser=nullptr;
  hr=IUnknown_QueryService(dispatch,SID_STopLevelBrowser,IID_PPV_ARGS(&browser));
  if(SUCCEEDED(hr)){hr=browser->QueryActiveShellView(out);browser->Release();}
  dispatch->Release();
 }else if(SUCCEEDED(hr))hr=E_FAIL;
 windows->Release();
 return hr;
}

static HRESULT launch(const wchar_t* executable){
 IShellView* view=nullptr;HRESULT hr=desktopView(&view);
 if(FAILED(hr))return hr;
 IDispatch* background=nullptr;
 hr=view->GetItemObject(SVGIO_BACKGROUND,IID_PPV_ARGS(&background));
 if(SUCCEEDED(hr)){
  IShellFolderViewDual* folder=nullptr;
  hr=background->QueryInterface(IID_PPV_ARGS(&folder));
  if(SUCCEEDED(hr)){
   IDispatch* application=nullptr;
   hr=folder->get_Application(&application);
   if(SUCCEEDED(hr)){
    IShellDispatch2* shell=nullptr;
    hr=application->QueryInterface(IID_PPV_ARGS(&shell));
    if(SUCCEEDED(hr)){
     BSTR file=SysAllocString(executable);
     if(file){VARIANT empty{};hr=shell->ShellExecuteW(file,empty,empty,empty,empty);SysFreeString(file);}
     else hr=E_OUTOFMEMORY;
     shell->Release();
    }
    application->Release();
   }
   folder->Release();
  }
  background->Release();
 }
 view->Release();
 return hr;
}

int wmain(int argc,wchar_t** argv){
 if(argc!=2||!argv[1][0])return 2;
 HRESULT hr=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED|COINIT_DISABLE_OLE1DDE);
 if(FAILED(hr))return 3;
 hr=launch(argv[1]);
 CoUninitialize();
 return FAILED(hr)?static_cast<int>(hr&0xffff):0;
}
