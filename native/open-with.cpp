#include <windows.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <wrl/client.h>
#include <string>
#include <iostream>
#include <set>
#include <gdiplus.h>
#include <wincrypt.h>
#include <vector>
#include <memory>
#include <knownfolders.h>
using Microsoft::WRL::ComPtr;
std::string utf8(const std::wstring& s){if(s.empty())return {};int n=WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);std::string r(n,0);WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),r.data(),n,nullptr,nullptr);return r;}
std::string json(const std::wstring& s){std::string r="\"";for(unsigned char c:utf8(s)){if(c=='"'||c=='\\'){r+='\\';r+=(char)c;}else if(c<32){char b[7];sprintf_s(b,"\\u%04x",c);r+=b;}else r+=(char)c;}return r+'"';}
std::string bitmapData(Gdiplus::Bitmap* bitmap){
 if(!bitmap||bitmap->GetLastStatus()!=Gdiplus::Ok)return {};ComPtr<IStream> stream;CLSID png={0x557cf406,0x1a04,0x11d3,{0x9a,0x73,0x00,0x00,0xf8,0x1e,0xf3,0x2e}};
 if(FAILED(CreateStreamOnHGlobal(nullptr,TRUE,&stream))||bitmap->Save(stream.Get(),&png)!=Gdiplus::Ok)return {};STATSTG stat{};stream->Stat(&stat,STATFLAG_NONAME);if(!stat.cbSize.QuadPart||stat.cbSize.QuadPart>131072)return {};LARGE_INTEGER zero{};stream->Seek(zero,STREAM_SEEK_SET,nullptr);std::vector<BYTE> bytes((size_t)stat.cbSize.QuadPart);ULONG read=0;stream->Read(bytes.data(),(ULONG)bytes.size(),&read);DWORD count=0;CryptBinaryToStringA(bytes.data(),read,CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF,nullptr,&count);std::string encoded(count,0);if(!CryptBinaryToStringA(bytes.data(),read,CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF,encoded.data(),&count))return {};encoded.resize(count);while(!encoded.empty()&&encoded.back()==0)encoded.pop_back();return "data:image/png;base64,"+encoded;
}
std::wstring itemName(IShellItem* item,SIGDN format){PWSTR raw=nullptr;std::wstring value;if(SUCCEEDED(item->GetDisplayName(format,&raw))&&raw){value=raw;CoTaskMemFree(raw);}return value;}
HRESULT installedApps(){ComPtr<IShellItem> folder;HRESULT hr=SHGetKnownFolderItem(FOLDERID_AppsFolder,KF_FLAG_DEFAULT,nullptr,IID_PPV_ARGS(&folder));ComPtr<IEnumShellItems> enumerator;if(SUCCEEDED(hr))hr=folder->BindToHandler(nullptr,BHID_EnumItems,IID_PPV_ARGS(&enumerator));if(FAILED(hr))return hr;std::cout<<'[';bool comma=false;int count=0;for(ComPtr<IShellItem> item;count<3000&&enumerator->Next(1,item.ReleaseAndGetAddressOf(),nullptr)==S_OK;count++){auto id=itemName(item.Get(),SIGDN_DESKTOPABSOLUTEPARSING),name=itemName(item.Get(),SIGDN_NORMALDISPLAY),file=itemName(item.Get(),SIGDN_FILESYSPATH);if(id.empty()||name.empty())continue;if(comma)std::cout<<',';comma=true;std::cout<<"{\"id\":"<<json(id)<<",\"name\":"<<json(name)<<",\"file\":"<<json(file)<<'}';}std::cout<<']';return S_OK;}
HRESULT appImage(const std::wstring& path){ComPtr<IShellItemImageFactory> factory;HRESULT hr=SHCreateItemFromParsingName(path.c_str(),nullptr,IID_PPV_ARGS(&factory));HBITMAP image=nullptr;if(SUCCEEDED(hr))hr=factory->GetImage({32,32},SIIGBF_ICONONLY,&image);if(SUCCEEDED(hr)){std::unique_ptr<Gdiplus::Bitmap> bitmap(Gdiplus::Bitmap::FromHBITMAP(image,nullptr));std::cout<<bitmapData(bitmap.get());bitmap.reset();DeleteObject(image);}return hr;}
std::string iconData(HICON icon){
 // Draw into a transparent 32-bit DIB. FromHICON drops alpha on some Shell
 // icons, leaving a black square in both light and dark interfaces.
 const int edge=32;BITMAPINFO dib{};dib.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);dib.bmiHeader.biWidth=edge;dib.bmiHeader.biHeight=-edge;dib.bmiHeader.biPlanes=1;dib.bmiHeader.biBitCount=32;dib.bmiHeader.biCompression=BI_RGB;
 void* pixels=nullptr;HDC dc=CreateCompatibleDC(nullptr);HBITMAP image=CreateDIBSection(dc,&dib,DIB_RGB_COLORS,&pixels,nullptr,0);
 std::string result;if(dc&&image&&pixels){memset(pixels,0,edge*edge*4);auto previous=SelectObject(dc,image);if(DrawIconEx(dc,0,0,icon,edge,edge,0,nullptr,DI_NORMAL)){GdiFlush();Gdiplus::Bitmap bitmap(edge,edge,edge*4,PixelFormat32bppPARGB,(BYTE*)pixels);result=bitmapData(&bitmap);}SelectObject(dc,previous);}
 if(image)DeleteObject(image);if(dc)DeleteDC(dc);return result;
}
HRESULT folderImage(){
 SHSTOCKICONINFO info{};info.cbSize=sizeof(info);HRESULT hr=SHGetStockIconInfo(SIID_FOLDER,SHGSI_ICON|SHGSI_LARGEICON,&info);if(FAILED(hr))return hr;std::cout<<iconData(info.hIcon);DestroyIcon(info.hIcon);return S_OK;
}
HRESULT programImage(const std::wstring& file){
 std::vector<std::wstring> sources;wchar_t system[MAX_PATH]{},windows[MAX_PATH]{};GetSystemDirectoryW(system,MAX_PATH);GetWindowsDirectoryW(windows,MAX_PATH);
 // Modern Windows moves executable resources to .mun files. The Shell cache
 // can return a generic app icon even when the actual resources are present.
 auto prefix=std::wstring(system)+L"\\";if(file.size()>prefix.size()&&!_wcsnicmp(file.c_str(),prefix.c_str(),prefix.size())){auto mun=std::wstring(windows)+L"\\SystemResources\\"+PathFindFileNameW(file.c_str())+L".mun";if(GetFileAttributesW(mun.c_str())!=INVALID_FILE_ATTRIBUTES)sources.push_back(mun);}
 sources.push_back(file);for(const auto& source:sources){HICON iconLarge=nullptr,iconSmall=nullptr;SHDefExtractIconW(source.c_str(),0,0,&iconLarge,&iconSmall,MAKELONG(32,16));auto data=iconLarge?iconData(iconLarge):iconSmall?iconData(iconSmall):"";if(iconLarge)DestroyIcon(iconLarge);if(iconSmall)DestroyIcon(iconSmall);if(!data.empty()){std::cout<<data;return S_OK;}}
 return S_OK;
}
HRESULT copyItem(const std::wstring& path,bool cut,bool apply){ComPtr<IShellItem> item;ComPtr<IDataObject> data;HRESULT hr=SHCreateItemFromParsingName(path.c_str(),nullptr,IID_PPV_ARGS(&item));if(SUCCEEDED(hr))hr=item->BindToHandler(nullptr,BHID_DataObject,IID_PPV_ARGS(&data));if(FAILED(hr))return hr;FORMATETC format{(CLIPFORMAT)RegisterClipboardFormatW(CFSTR_PREFERREDDROPEFFECT),nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL};STGMEDIUM medium{};medium.tymed=TYMED_HGLOBAL;medium.hGlobal=GlobalAlloc(GMEM_MOVEABLE,sizeof(DWORD));if(!medium.hGlobal)return E_OUTOFMEMORY;auto value=(DWORD*)GlobalLock(medium.hGlobal);*value=cut?DROPEFFECT_MOVE:DROPEFFECT_COPY;GlobalUnlock(medium.hGlobal);hr=data->SetData(&format,&medium,TRUE);if(FAILED(hr)){ReleaseStgMedium(&medium);return hr;}if(apply){hr=OleSetClipboard(data.Get());if(SUCCEEDED(hr))hr=OleFlushClipboard();}else{FORMATETC drop{CF_HDROP,nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL};std::cout<<"{\"fileDrop\":"<<(data->QueryGetData(&drop)==S_OK?"true":"false")<<",\"effect\":"<<(cut?DROPEFFECT_MOVE:DROPEFFECT_COPY)<<'}';}return hr;}
std::string applicationIcon(IAssocHandler* handler){
 PWSTR raw=nullptr;int index=0;if(FAILED(handler->GetIconLocation(&raw,&index))||!raw)return {};std::wstring path=raw;CoTaskMemFree(raw);
 wchar_t expanded[32768];if(ExpandEnvironmentStringsW(path.c_str(),expanded,32768))path=expanded;
 HICON iconLarge=nullptr,iconSmall=nullptr;SHDefExtractIconW(path.c_str(),index,0,&iconLarge,&iconSmall,MAKELONG(32,16));
 std::unique_ptr<Gdiplus::Bitmap> bitmap(iconLarge?Gdiplus::Bitmap::FromHICON(iconLarge):Gdiplus::Bitmap::FromFile(path.c_str()));
 std::string result;if(bitmap&&bitmap->GetLastStatus()==Gdiplus::Ok){
  ComPtr<IStream> stream;CLSID png={0x557cf406,0x1a04,0x11d3,{0x9a,0x73,0x00,0x00,0xf8,0x1e,0xf3,0x2e}};
  if(SUCCEEDED(CreateStreamOnHGlobal(nullptr,TRUE,&stream))&&bitmap->Save(stream.Get(),&png)==Gdiplus::Ok){STATSTG stat{};stream->Stat(&stat,STATFLAG_NONAME);if(stat.cbSize.QuadPart&&stat.cbSize.QuadPart<131072){LARGE_INTEGER zero{};stream->Seek(zero,STREAM_SEEK_SET,nullptr);std::vector<BYTE> bytes((size_t)stat.cbSize.QuadPart);ULONG read=0;stream->Read(bytes.data(),(ULONG)bytes.size(),&read);DWORD count=0;CryptBinaryToStringA(bytes.data(),read,CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF,nullptr,&count);std::string encoded(count,0);if(CryptBinaryToStringA(bytes.data(),read,CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF,encoded.data(),&count)){encoded.resize(count);while(!encoded.empty()&&encoded.back()==0)encoded.pop_back();result="data:image/png;base64,"+encoded;}}}
 }
 bitmap.reset();if(iconLarge)DestroyIcon(iconLarge);if(iconSmall)DestroyIcon(iconSmall);return result;
}

ComPtr<IContextMenu2> shellMenu2;ComPtr<IContextMenu3> shellMenu3;
LRESULT CALLBACK menuHostProc(HWND h,UINT m,WPARAM w,LPARAM l){LRESULT result=0;if(m==WM_INITMENUPOPUP||m==WM_DRAWITEM||m==WM_MEASUREITEM||m==WM_MENUCHAR){if(shellMenu3&&SUCCEEDED(shellMenu3->HandleMenuMsg2(m,w,l,&result)))return result;if(shellMenu2&&SUCCEEDED(shellMenu2->HandleMenuMsg(m,w,l)))return 0;}return DefWindowProcW(h,m,w,l);}
HRESULT fileContextMenu(const std::wstring& path,HWND owner,DWORD expectedPid,int x,int y,bool list){
 DWORD pid=0;GetWindowThreadProcessId(owner,&pid);if(!IsWindow(owner)||pid!=expectedPid)return E_INVALIDARG;
 auto stage=[](const char* label){if(GetEnvironmentVariableW(L"ONE_CONTEXT_DIAGNOSTICS",nullptr,0))std::cerr<<label<<std::endl;};
 stage("parse");
 PIDLIST_ABSOLUTE pidl=nullptr;HRESULT hr=SHParseDisplayName(path.c_str(),nullptr,&pidl,0,nullptr);if(FAILED(hr))return hr;
 stage("bind");
 ComPtr<IShellFolder> folder;PCUITEMID_CHILD child=nullptr;hr=SHBindToParent(pidl,IID_PPV_ARGS(&folder),&child);ComPtr<IContextMenu> context;
 WNDCLASSW wc{};wc.lpfnWndProc=menuHostProc;wc.hInstance=GetModuleHandleW(nullptr);wc.lpszClassName=L"One.ShellContextMenu";RegisterClassW(&wc);
 HWND host=CreateWindowExW(WS_EX_TOOLWINDOW,wc.lpszClassName,L"",WS_POPUP,x,y,1,1,owner,nullptr,wc.hInstance,nullptr);
 stage("context");if(SUCCEEDED(hr))hr=folder->GetUIObjectOf(host,1,&child,IID_IContextMenu,nullptr,(void**)context.GetAddressOf());
 stage("query");HMENU menu=CreatePopupMenu();if(SUCCEEDED(hr))hr=context->QueryContextMenu(menu,0,1,0x7fff,CMF_NORMAL|CMF_EXPLORE|CMF_ASYNCVERBSTATE);
 stage("ready");
 if(SUCCEEDED(hr)){
  context.As(&shellMenu2);context.As(&shellMenu3);
  if(list){std::cout<<'[';for(int i=0;i<GetMenuItemCount(menu);i++){if(i)std::cout<<',';wchar_t label[512]{};GetMenuStringW(menu,i,label,512,MF_BYPOSITION);char verb[256]{};auto id=GetMenuItemID(menu,i);if(id>=1&&id<0x8000)context->GetCommandString(id-1,GCS_VERBA,nullptr,verb,256);std::cout<<"{\"label\":"<<json(label)<<",\"verb\":"<<json(std::wstring(verb,verb+strlen(verb)))<<'}';}std::cout<<']';}
  else {DWORD own=GetCurrentThreadId(),foreground=GetWindowThreadProcessId(GetForegroundWindow(),nullptr);bool attached=foreground&&foreground!=own&&AttachThreadInput(own,foreground,TRUE);SetForegroundWindow(host);if(attached)AttachThreadInput(own,foreground,FALSE);
   UINT selected=TrackPopupMenuEx(menu,TPM_RETURNCMD|TPM_RIGHTBUTTON,x,y,host,nullptr);PostMessageW(host,WM_NULL,0,0);
   if(selected){CMINVOKECOMMANDINFOEX info{};info.cbSize=sizeof(info);info.fMask=CMIC_MASK_UNICODE|CMIC_MASK_PTINVOKE;info.hwnd=owner;info.lpVerb=MAKEINTRESOURCEA(selected-1);info.lpVerbW=MAKEINTRESOURCEW(selected-1);info.nShow=SW_SHOWNORMAL;info.ptInvoke={x,y};hr=context->InvokeCommand((CMINVOKECOMMANDINFO*)&info);}
  }
 }
 std::cout.flush();stage("cleanup");shellMenu2.Reset();shellMenu3.Reset();DestroyMenu(menu);if(host)DestroyWindow(host);CoTaskMemFree(pidl);return hr;
}
// Preserve Windows argument boundaries, including quotes and trailing backslashes.
std::wstring quoteArgument(const std::wstring& value){
 std::wstring out=L"\"";size_t slashes=0;
 for(auto c:value){if(c==L'\\'){slashes++;continue;}out.append(slashes*(c==L'\"'?2:1),L'\\');if(c==L'\"')out+=L'\\';out+=c;slashes=0;}
 out.append(slashes*2,L'\\');return out+L'\"';
}
HRESULT launchProgram(int argc,wchar_t** argv,bool console,bool elevated=false){
 if(argc<5)return E_INVALIDARG;
 std::wstring file=argv[2],cwd=argv[3],arguments;
 if(!cwd.empty()){auto attributes=GetFileAttributesW(cwd.c_str());if(attributes==INVALID_FILE_ATTRIBUTES||!(attributes&FILE_ATTRIBUTE_DIRECTORY))return HRESULT_FROM_WIN32(ERROR_DIRECTORY);}
 bool verbatim=std::wstring(argv[4])==L"verbatim";
 for(int i=5;i<argc;i++){if(i>5)arguments+=L' ';arguments+=verbatim?argv[i]:quoteArgument(argv[i]);}
 if(console){
  std::wstring command=quoteArgument(file)+(arguments.empty()?L"":L" "+arguments);
  STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.dwFlags=STARTF_USESHOWWINDOW;startup.wShowWindow=SW_SHOWNORMAL;
  PROCESS_INFORMATION process{};
  // Interactive shells need their own visible console and valid console I/O.
  if(!CreateProcessW(file.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_NEW_CONSOLE,nullptr,cwd.empty()?nullptr:cwd.c_str(),&startup,&process))return HRESULT_FROM_WIN32(GetLastError());
  std::cout<<"{\"pid\":"<<process.dwProcessId<<'}';CloseHandle(process.hThread);CloseHandle(process.hProcess);return S_OK;
 }
 SHELLEXECUTEINFOW info{};info.cbSize=sizeof(info);info.fMask=SEE_MASK_NOCLOSEPROCESS|SEE_MASK_NOASYNC|SEE_MASK_FLAG_NO_UI;
 info.lpVerb=elevated?L"runas":L"open";info.lpFile=file.c_str();info.lpParameters=arguments.empty()?nullptr:arguments.c_str();info.lpDirectory=cwd.empty()?nullptr:cwd.c_str();info.nShow=SW_SHOWNORMAL;
 // Shell activation honors executable manifests, including normal UAC prompts.
 if(!ShellExecuteExW(&info))return HRESULT_FROM_WIN32(GetLastError());
 std::cout<<"{\"pid\":"<<(info.hProcess?GetProcessId(info.hProcess):0)<<'}';if(info.hProcess)CloseHandle(info.hProcess);return S_OK;
}
std::wstring registryText(HKEY key,const wchar_t* name){DWORD bytes=0,type=0;if(RegQueryValueExW(key,name,nullptr,&type,nullptr,&bytes)!=ERROR_SUCCESS||(type!=REG_SZ&&type!=REG_EXPAND_SZ)||bytes>65536)return {};std::wstring value(bytes/sizeof(wchar_t)+1,0);if(RegQueryValueExW(key,name,nullptr,&type,(BYTE*)value.data(),&bytes)!=ERROR_SUCCESS)return {};value.resize(wcsnlen(value.c_str(),value.size()));return value;}
std::wstring expandEnvironment(const std::wstring& value){wchar_t buffer[32768]{};DWORD count=ExpandEnvironmentStringsW(value.c_str(),buffer,32768);return count&&count<=32768?buffer:value;}
HRESULT hereApplications(){
 const wchar_t* paths[]={L"Directory\\Background\\shell",L"Directory\\shell"};bool comma=false;std::cout<<'[';
 for(auto path:paths){HKEY root=nullptr;if(RegOpenKeyExW(HKEY_CLASSES_ROOT,path,0,KEY_READ,&root)!=ERROR_SUCCESS)continue;
  for(DWORD index=0;index<128;index++){wchar_t name[256]{};DWORD length=256;if(RegEnumKeyExW(root,index,name,&length,nullptr,nullptr,nullptr,nullptr)!=ERROR_SUCCESS)break;
   HKEY verb=nullptr,command=nullptr;if(RegOpenKeyExW(root,name,0,KEY_READ,&verb)!=ERROR_SUCCESS)continue;
   bool hidden=RegQueryValueExW(verb,L"LegacyDisable",nullptr,nullptr,nullptr,nullptr)==ERROR_SUCCESS||RegQueryValueExW(verb,L"ProgrammaticAccessOnly",nullptr,nullptr,nullptr,nullptr)==ERROR_SUCCESS;
   auto label=registryText(verb,L"MUIVerb");if(label.empty())label=registryText(verb,nullptr);if(label.empty())label=name;
   if(label.starts_with(L"@")){wchar_t localized[1024]{};if(SUCCEEDED(SHLoadIndirectString(label.c_str(),localized,1024,nullptr)))label=localized;}
   std::wstring text;if(!hidden&&RegOpenKeyExW(verb,L"command",0,KEY_READ,&command)==ERROR_SUCCESS){if(RegQueryValueExW(command,L"DelegateExecute",nullptr,nullptr,nullptr,nullptr)!=ERROR_SUCCESS)text=registryText(command,nullptr);RegCloseKey(command);}RegCloseKey(verb);
   bool folder=false;for(size_t i=0;i+1<text.size();i++)if(text[i]==L'%'&&wcschr(L"1VvLlWw",text[i+1]))folder=true;
   if(!folder||text.empty())continue;
   int argc=0;auto argv=CommandLineToArgvW(text.c_str(),&argc);if(!argv)continue;
   auto file=argc?expandEnvironment(argv[0]):L"";if(argc<2||argc>65||_wcsicmp(PathFindExtensionW(file.c_str()),L".exe")){LocalFree(argv);continue;}
   if(comma)std::cout<<',';comma=true;std::cout<<"{\"id\":"<<json(std::wstring(path)+L"\\"+name)<<",\"label\":"<<json(label)<<",\"file\":"<<json(file)<<",\"args\":[";
   for(int i=1;i<argc;i++){if(i>1)std::cout<<',';std::cout<<json(expandEnvironment(argv[i]));}std::cout<<"]}";LocalFree(argv);
  }RegCloseKey(root);
 }std::cout<<']';return S_OK;
}
int wmain(int argc,wchar_t** argv){
 if(argc==4&&std::wstring(argv[1])==L"focus"){
  HWND target=nullptr;DWORD owner=0;try{target=(HWND)(uintptr_t)std::stoull(argv[2]);owner=(DWORD)std::stoul(argv[3]);}catch(...){return 2;}
  DWORD pid=0;DWORD targetThread=GetWindowThreadProcessId(target,&pid);if(!IsWindow(target)||!owner||pid!=owner)return 1;
  // Only activate the requesting One process. Run out of process so an unresponsive foreground cannot block Electron.
  MSG message{};PeekMessageW(&message,nullptr,0,0,PM_NOREMOVE);
  DWORD current=GetCurrentThreadId(),foreground=GetWindowThreadProcessId(GetForegroundWindow(),nullptr);
  bool a=foreground&&foreground!=current&&AttachThreadInput(current,foreground,TRUE);
  bool b=targetThread&&targetThread!=current&&targetThread!=foreground&&AttachThreadInput(current,targetThread,TRUE);
  if(IsIconic(target))ShowWindow(target,SW_RESTORE);BringWindowToTop(target);SetForegroundWindow(target);
  bool focused=GetForegroundWindow()==target;if(b)AttachThreadInput(current,targetThread,FALSE);if(a)AttachThreadInput(current,foreground,FALSE);
  return focused?0:1;
 }
 if(argc<2||argc<3&&(std::wstring(argv[1])!=L"apps"&&std::wstring(argv[1])!=L"folder-icon"&&std::wstring(argv[1])!=L"here-apps"&&std::wstring(argv[1])!=L"lock"))return 2;SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);if(FAILED(OleInitialize(nullptr)))return 1;Gdiplus::GdiplusStartupInput gdiplusInput;ULONG_PTR gdiplusToken=0;Gdiplus::GdiplusStartup(&gdiplusToken,&gdiplusInput,nullptr);std::wstring mode=argv[1],path=argc>2?argv[2]:L"";HRESULT hr=S_OK;
 if(mode==L"apps")hr=installedApps();
 else if(mode==L"here-apps")hr=hereApplications();
 else if(mode==L"launch"||mode==L"launch-console"||mode==L"launch-elevated")hr=launchProgram(argc,argv,mode==L"launch-console",mode==L"launch-elevated");
 else if(mode==L"program-icon"&&argc==3)hr=programImage(argv[2]);
 else if(mode==L"lock")hr=LockWorkStation()?S_OK:HRESULT_FROM_WIN32(GetLastError());
 else if(mode==L"folder-icon")hr=folderImage();
 else if(mode==L"app-icon")hr=appImage(path);
 else if(mode==L"launch-app"){PIDLIST_ABSOLUTE pidl=nullptr;hr=SHParseDisplayName(path.c_str(),nullptr,&pidl,0,nullptr);if(SUCCEEDED(hr)){SHELLEXECUTEINFOW info{};info.cbSize=sizeof(info);info.fMask=SEE_MASK_IDLIST;info.lpIDList=pidl;info.nShow=SW_SHOWNORMAL;if(!ShellExecuteExW(&info))hr=HRESULT_FROM_WIN32(GetLastError());CoTaskMemFree(pidl);}}
 else if(mode==L"copy"||mode==L"cut"||mode==L"clipboard-probe")hr=copyItem(path,mode==L"cut"||argc==4&&std::wstring(argv[3])==L"cut",mode!=L"clipboard-probe");
 else if(mode==L"rename"&&argc==4){if(!MoveFileW(path.c_str(),argv[3]))hr=HRESULT_FROM_WIN32(GetLastError());}
 else if((mode==L"context"||mode==L"context-list")&&argc==7){try{hr=fileContextMenu(path,(HWND)(uintptr_t)std::stoull(argv[3]),(DWORD)std::stoul(argv[4]),std::stoi(argv[5]),std::stoi(argv[6]),mode==L"context-list");}catch(...){hr=E_INVALIDARG;}}
 else if(mode==L"choose") {OPENASINFO info={};info.pcszFile=path.c_str();info.oaifInFlags=OAIF_EXEC;hr=SHOpenWithDialog(nullptr,&info);}
 else {
  ComPtr<IEnumAssocHandlers> enumerator;hr=SHAssocEnumHandlers(PathFindExtensionW(path.c_str()),mode==L"list"?ASSOC_FILTER_RECOMMENDED:ASSOC_FILTER_NONE,&enumerator);
  if(FAILED(hr)){if(mode==L"list"){std::cout<<"[]";hr=S_OK;}}
  else {bool comma=false,found=false;std::set<std::wstring> seen; if(mode==L"list")std::cout<<'[';
   for(ComPtr<IAssocHandler> h;enumerator->Next(1,h.ReleaseAndGetAddressOf(),nullptr)==S_OK;){
    PWSTR name=nullptr,ui=nullptr;h->GetName(&name);h->GetUIName(&ui);std::wstring id=name?name:L"",label=ui?ui:id;CoTaskMemFree(name);CoTaskMemFree(ui);if(id.empty()||!seen.insert(id).second)continue;
    if(mode==L"list"){if(comma)std::cout<<',';comma=true;auto image=applicationIcon(h.Get());std::cout<<"{\"id\":"<<json(id)<<",\"name\":"<<json(label);if(!image.empty())std::cout<<",\"icon\":\""<<image<<'"';std::cout<<'}';}
    else if(mode==L"invoke"&&argc==4&&id==argv[3]){
     // Re-enumerate registered handlers; never accept an arbitrary executable or command.
     ComPtr<IShellItem> item;ComPtr<IDataObject> data;hr=SHCreateItemFromParsingName(path.c_str(),nullptr,IID_PPV_ARGS(&item));
     if(SUCCEEDED(hr))hr=item->BindToHandler(nullptr,BHID_DataObject,IID_PPV_ARGS(&data));if(SUCCEEDED(hr))hr=h->Invoke(data.Get());found=true;break;
    }
   }if(mode==L"list")std::cout<<']';else if(!found)hr=E_INVALIDARG;
  }
 }
 if(FAILED(hr))std::cerr<<"Windows operation failed: 0x"<<std::hex<<(unsigned long)hr<<std::endl;if(gdiplusToken)Gdiplus::GdiplusShutdown(gdiplusToken);OleUninitialize();return FAILED(hr)?1:0;
}
