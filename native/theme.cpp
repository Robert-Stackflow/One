#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <iostream>
#include <string>
#include <vector>

static std::wstring personalization=L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
static std::wstring nightPath=L"Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current\\default$windows.data.bluelightreduction.bluelightreductionstate\\windows.data.bluelightreduction.bluelightreductionstate";
static const char* theme(const wchar_t* name){
 DWORD value=0,size=sizeof(value);
 const auto result=RegGetValueW(HKEY_CURRENT_USER,personalization.c_str(),name,RRF_RT_REG_DWORD,nullptr,&value,&size);
 return result==ERROR_SUCCESS&&value<=1?(value?"\"light\"":"\"dark\""):"null";
}
static LSTATUS writeTheme(const wchar_t* name,DWORD value){
 HKEY key=nullptr;
 auto result=RegCreateKeyExW(HKEY_CURRENT_USER,personalization.c_str(),0,nullptr,0,KEY_SET_VALUE,nullptr,&key,nullptr);
 if(result==ERROR_SUCCESS){result=RegSetValueExW(key,name,0,REG_DWORD,reinterpret_cast<const BYTE*>(&value),sizeof(value));RegCloseKey(key);}
 return result;
}
static void read(){
 DWORD size=0;
 auto error=RegGetValueW(HKEY_CURRENT_USER,nightPath.c_str(),L"Data",RRF_RT_REG_BINARY,nullptr,nullptr,&size);
 std::vector<BYTE> bytes;
 if(error==ERROR_SUCCESS){
  if(size>65536)error=ERROR_MORE_DATA;
  else if(size<4)error=ERROR_INVALID_DATA;
  else{bytes.resize(size);error=RegGetValueW(HKEY_CURRENT_USER,nightPath.c_str(),L"Data",RRF_RT_REG_BINARY,nullptr,bytes.data(),&size);if(error==ERROR_SUCCESS)bytes.resize(size);}
 }
 std::cout<<"{\"apps\":"<<theme(L"AppsUseLightTheme")<<",\"system\":"<<theme(L"SystemUsesLightTheme")<<",\"nightError\":"<<error<<",\"nightData\":\"";
 if(error==ERROR_SUCCESS){const char* hex="0123456789abcdef";for(BYTE byte:bytes)std::cout<<hex[byte>>4]<<hex[byte&15];}
 std::cout<<"\"}\n";
}
int wmain(int argc,wchar_t** argv){
#ifdef ONE_THEME_TEST
 if(argc>=3&&std::wstring(argv[argc-2])==L"--test-id"){
  const std::wstring id=argv[argc-1];
  if(id.empty()||id.size()>80||id.find_first_not_of(L"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")!=std::wstring::npos)return 2;
  const auto root=L"Software\\One.ThemeTests\\"+id;personalization=root+L"\\Personalize";nightPath=root+L"\\NightState";argc-=2;
 }else return 2;
#endif
 if(argc==2&&std::wstring(argv[1])==L"read"){read();return 0;}
 if(argc!=4||std::wstring(argv[1])!=L"apply")return 2;
 const std::wstring mode=argv[2],scope=argv[3];
 if((mode!=L"light"&&mode!=L"dark")||(scope!=L"apps"&&scope!=L"system"&&scope!=L"both"))return 2;
 const DWORD value=mode==L"light"?1:0;
 const bool apps=scope==L"apps"||scope==L"both",system=scope==L"system"||scope==L"both";
 const auto appsError=apps?writeTheme(L"AppsUseLightTheme",value):ERROR_SUCCESS;
 const auto systemError=system?writeTheme(L"SystemUsesLightTheme",value):ERROR_SUCCESS;
 DWORD notifyError=ERROR_SUCCESS;
#ifndef ONE_THEME_TEST
 if((apps&&appsError==ERROR_SUCCESS)||(system&&systemError==ERROR_SUCCESS)){
  DWORD_PTR ignored=0;
  if(!SendMessageTimeoutW(HWND_BROADCAST,WM_SETTINGCHANGE,0,reinterpret_cast<LPARAM>(L"ImmersiveColorSet"),SMTO_ABORTIFHUNG,500,&ignored))notifyError=GetLastError()?GetLastError():ERROR_TIMEOUT;
  if(!SendMessageTimeoutW(HWND_BROADCAST,WM_THEMECHANGED,0,0,SMTO_ABORTIFHUNG,500,&ignored))notifyError=GetLastError()?GetLastError():ERROR_TIMEOUT;
 }
#endif
 std::cout<<"{\"appsError\":"<<appsError<<",\"systemError\":"<<systemError<<",\"notifyError\":"<<notifyError<<"}\n";return 0;
}
