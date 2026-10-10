#define NOMINMAX
#include <windows.h>
#include <physicalmonitorenumerationapi.h>
#include <highlevelmonitorconfigurationapi.h>
#include <lowlevelmonitorconfigurationapi.h>
#include <algorithm>
#include <cmath>
#include <cwctype>
#include <iostream>
#include <map>
#include <sstream>
#include "display-wmi.h"
namespace {
std::wstring lower(std::wstring s){for(auto& c:s)c=towlower(c);return s;}
std::string json(const std::wstring& s){int n=WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);std::string text(n,0),out="\"";WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),text.data(),n,nullptr,nullptr);for(unsigned char c:text){if(c=='"'||c=='\\'){out+='\\';out+=(char)c;}else if(c<32)out+=' ';else out+=(char)c;}return out+'"';}
struct Row{std::wstring path,key,name,source,identity=L"connection";bool internal=false,virtualDisplay=false,primary=false,cloned=false;int width=0,height=0,rotation=0,left=0,top=0;double refresh=0;HMONITOR monitor=nullptr;};
std::vector<std::wstring> parts(const std::wstring& value,wchar_t separator){std::vector<std::wstring> out;std::wstringstream stream(value);std::wstring item;while(std::getline(stream,item,separator))out.push_back(item);return out;}
std::wstring instance(const std::wstring& path){auto p=parts(lower(path),L'#');return p.size()>=3?L"display\\"+p[1]+L"\\"+p[2]:L"";}
std::wstring normalizeInstance(std::wstring value){value=lower(value);auto at=value.rfind(L'_');if(at!=std::wstring::npos&&value.find_first_not_of(L"0123456789",at+1)==std::wstring::npos)value.resize(at);return value;}
void applyEdidIdentity(Row& row,const BYTE* edid,DWORD size){
 const BYTE header[]={0,255,255,255,255,255,255,0};if(size<128||!std::equal(header,header+8,edid))return;
 unsigned sum=0;for(int i=0;i<128;i++)sum+=edid[i];if(sum%256)return;
 std::wstring fingerprint;const wchar_t* hex=L"0123456789abcdef";for(int i=0;i<128;i++){fingerprint+=hex[edid[i]>>4];fingerprint+=hex[edid[i]&15];}
 row.key+=L":"+fingerprint;
 uint32_t serial=(uint32_t)edid[12]|((uint32_t)edid[13]<<8)|((uint32_t)edid[14]<<16)|((uint32_t)edid[15]<<24);std::wstring serialText;
 if(serial&&serial!=0xffffffff)serialText=std::to_wstring(serial);
 else for(int at=54;at<=108;at+=18)if(!edid[at]&&!edid[at+1]&&!edid[at+2]&&edid[at+3]==0xff){for(int i=at+5;i<at+18&&edid[i]>=32&&edid[i]<127;i++)serialText+=(wchar_t)edid[i];while(!serialText.empty()&&serialText.back()==L' ')serialText.pop_back();break;}
 if(!serialText.empty()&&serialText.find_first_not_of(L" 0")!=std::wstring::npos&&lower(serialText)!=L"unknown"){row.identity=L"serial";row.key=L"edid:"+fingerprint.substr(16,8)+L":"+serialText;}
}
void identity(Row& row){
 row.key=lower(row.path);auto id=instance(row.path);if(id.empty())return;
 HKEY key=nullptr;if(RegOpenKeyExW(HKEY_LOCAL_MACHINE,(L"SYSTEM\\CurrentControlSet\\Enum\\"+id+L"\\Device Parameters").c_str(),0,KEY_QUERY_VALUE,&key)!=ERROR_SUCCESS)return;
 BYTE edid[512]{};DWORD size=sizeof(edid),type=0;LONG result=RegQueryValueExW(key,L"EDID",nullptr,&type,edid,&size);RegCloseKey(key);
 if(result==ERROR_SUCCESS&&type==REG_BINARY)applyEdidIdentity(row,edid,size);
}
BOOL CALLBACK monitors(HMONITOR monitor,HDC,LPRECT,LPARAM data){MONITORINFOEXW info{};info.cbSize=sizeof(info);if(GetMonitorInfoW(monitor,&info))(*reinterpret_cast<std::map<std::wstring,std::pair<HMONITOR,MONITORINFOEXW>>*>(data))[info.szDevice]={monitor,info};return TRUE;}
std::vector<Row> finishRows(std::vector<Row> rows){
 std::map<std::wstring,int> keys;for(const auto& row:rows)keys[row.key]++;
 for(auto& row:rows){row.cloned=std::count_if(rows.begin(),rows.end(),[&](const Row& other){return row.source==other.source;})>1;if(keys[row.key]>1){row.identity=L"connection";row.key=lower(row.path)+L":"+row.key;}}
 return rows;
}
std::vector<Row> discover(){
#ifdef ONE_DISPLAY_TEST
 Row a;a.path=L"mock-a";a.key=L"serial:a";a.name=L"测试显示器 A";a.source=L"\\\\.\\DISPLAY1";a.identity=L"serial";a.width=2560;a.height=1440;a.primary=true;
 Row b=a;b.path=L"mock-b";b.key=L"serial:b";b.name=L"测试显示器 B";b.source=L"DISPLAY2";b.primary=false;b.left=2560;Row c=a;c.path=L"mock-c";c.key=L"serial:duplicate";c.source=L"DISPLAY3";Row d=c;d.path=L"mock-d";return finishRows({a,b,c,d});
#else
 std::map<std::wstring,std::pair<HMONITOR,MONITORINFOEXW>> logical;EnumDisplayMonitors(nullptr,nullptr,monitors,(LPARAM)&logical);
 std::vector<DISPLAYCONFIG_PATH_INFO> paths;std::vector<DISPLAYCONFIG_MODE_INFO> modes;LONG status=ERROR_INSUFFICIENT_BUFFER;
 for(int attempt=0;attempt<2&&status==ERROR_INSUFFICIENT_BUFFER;attempt++){UINT32 p=0,m=0;status=GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS,&p,&m);if(status!=ERROR_SUCCESS||p>64||m>512)throw std::wstring(L"无法读取此显示会话的显示器列表");paths.resize(p);modes.resize(m);status=QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS,&p,paths.data(),&m,modes.data(),nullptr);if(status==ERROR_SUCCESS)paths.resize(p);}
 if(status!=ERROR_SUCCESS)throw std::wstring(L"无法读取显示器路径；远程会话或驱动可能不支持此接口");
 std::vector<Row> rows;
 for(const auto& path:paths){
  DISPLAYCONFIG_TARGET_DEVICE_NAME target{};target.header={DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,sizeof(target),path.targetInfo.adapterId,path.targetInfo.id};
  DISPLAYCONFIG_SOURCE_DEVICE_NAME source{};source.header={DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,sizeof(source),path.sourceInfo.adapterId,path.sourceInfo.id};
  if(DisplayConfigGetDeviceInfo(&target.header)!=ERROR_SUCCESS||DisplayConfigGetDeviceInfo(&source.header)!=ERROR_SUCCESS)continue;
  Row row;row.path=target.monitorDevicePath;row.name=target.monitorFriendlyDeviceName;row.source=source.viewGdiDeviceName;if(row.name.empty())row.name=row.source;
  auto tech=path.targetInfo.outputTechnology;row.internal=tech==DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL||tech==DISPLAYCONFIG_OUTPUT_TECHNOLOGY_LVDS||tech==DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED||tech==DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED;
  row.virtualDisplay=tech==DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL;row.rotation=((int)path.targetInfo.rotation-1)*90;auto rate=path.targetInfo.refreshRate;row.refresh=rate.Denominator?(double)rate.Numerator/rate.Denominator:0;
  auto it=logical.find(row.source);if(it!=logical.end()){row.monitor=it->second.first;auto info=it->second.second;row.left=info.rcMonitor.left;row.top=info.rcMonitor.top;row.width=info.rcMonitor.right-info.rcMonitor.left;row.height=info.rcMonitor.bottom-info.rcMonitor.top;row.primary=(info.dwFlags&MONITORINFOF_PRIMARY)!=0;}
  identity(row);if(!row.path.empty())rows.push_back(row);
 }
 return finishRows(std::move(rows));
#endif
}
std::string metadata(const Row& r){return "{\"path\":"+json(r.path)+",\"key\":"+json(r.key)+",\"identity\":"+json(r.identity)+",\"name\":"+json(r.name)+",\"source\":"+json(r.source)+",\"internal\":"+(r.internal?"true":"false")+",\"virtual\":"+(r.virtualDisplay?"true":"false")+",\"primary\":"+(r.primary?"true":"false")+",\"cloned\":"+(r.cloned?"true":"false")+",\"width\":"+std::to_string(r.width)+",\"height\":"+std::to_string(r.height)+",\"left\":"+std::to_string(r.left)+",\"top\":"+std::to_string(r.top)+",\"rotation\":"+std::to_string(r.rotation)+",\"refreshRate\":"+std::to_string(r.refresh)+"}";}
struct Physical{std::vector<PHYSICAL_MONITOR> handles;explicit Physical(HMONITOR monitor){DWORD count=0;if(!monitor||!GetNumberOfPhysicalMonitorsFromHMONITOR(monitor,&count)||!count||count>16)return;handles.resize(count);if(!GetPhysicalMonitorsFromHMONITOR(monitor,count,handles.data()))handles.clear();}~Physical(){if(!handles.empty())DestroyPhysicalMonitors((DWORD)handles.size(),handles.data());}HANDLE unique()const{return handles.size()==1?handles[0].hPhysicalMonitor:nullptr;}};
struct Value{bool supported=false;DWORD min=0,current=0,max=0;std::wstring method,error,path;int percent()const{return (int)std::lround(100.0*(current-min)/(max-min));}};
Value read(const Row& row,const std::wstring& parameter,Physical& physical,Wmi& wmi){
 Value v;
#ifdef ONE_DISPLAY_TEST
 v.supported=true;v.min=parameter==L"volume"?0:5;v.max=parameter==L"volume"?100:205;v.current=(v.min+v.max)/2;v.method=L"test";return v;
#else
 if(row.internal){
  if(parameter!=L"brightness"){v.error=L"内置屏未提供此控制接口";return v;}
  auto id=instance(row.path);auto values=wmi.query(L"SELECT InstanceName,CurrentBrightness,Active FROM WmiMonitorBrightness");int matches=0;
  for(auto& value:values){if(normalizeInstance(Wmi::text(value.Get(),L"InstanceName"))!=id)continue;VARIANT active;VariantInit(&active);value->Get(L"Active",0,&active,nullptr,nullptr);bool enabled=active.vt==VT_BOOL&&active.boolVal==VARIANT_TRUE;VariantClear(&active);if(!enabled)continue;int n=Wmi::number(value.Get(),L"CurrentBrightness");if(n<0||n>100)continue;matches++;v.current=n;}
  if(matches==1)for(auto& method:wmi.query(L"SELECT InstanceName,__PATH FROM WmiMonitorBrightnessMethods"))if(normalizeInstance(Wmi::text(method.Get(),L"InstanceName"))==id){if(!v.path.empty()){v.path.clear();break;}v.path=Wmi::text(method.Get(),L"__PATH");}
  if(matches==1&&!v.path.empty()){v.max=100;v.method=L"WMI";v.supported=true;}else v.error=L"内置屏亮度接口不可用";return v;
 }
 auto handle=physical.unique();if(!handle){v.error=L"无法唯一绑定物理显示器；请检查连接或使用扩展模式";return v;}
 BOOL ok=FALSE;BYTE code=parameter==L"brightness"?0x10:parameter==L"contrast"?0x12:0x62;
 if(parameter==L"brightness")ok=GetMonitorBrightness(handle,&v.min,&v.current,&v.max);
 if(parameter==L"contrast")ok=GetMonitorContrast(handle,&v.min,&v.current,&v.max);
 if(ok)v.method=L"DDC/CI";
 else{v.min=0;MC_VCP_CODE_TYPE type{};ok=GetVCPFeatureAndVCPFeatureReply(handle,code,&type,&v.current,&v.max)&&type==MC_SET_PARAMETER;if(ok)v.method=L"VCP";}
 v.supported=ok&&v.max>v.min&&v.current>=v.min&&v.current<=v.max;
 if(!v.supported)v.error=L"设备未返回有效控制值；请检查 DDC/CI 或连接方式";return v;
#endif
}
std::string valueJson(const Value& v){return "{\"supported\":"+std::string(v.supported?"true":"false")+",\"method\":"+json(v.method)+",\"error\":"+json(v.error)+(v.supported?",\"value\":"+std::to_string(v.percent())+",\"minimum\":"+std::to_string(v.min)+",\"maximum\":"+std::to_string(v.max)+",\"raw\":"+std::to_string(v.current):"")+"}";}
void set(const std::wstring& parameter,int percent,Value& v,Physical& physical,Wmi& wmi){
 if(!v.supported)throw v.error;DWORD raw=v.min+(DWORD)std::llround((v.max-v.min)*percent/100.0);
#ifndef ONE_DISPLAY_TEST
 BOOL ok=v.method==L"WMI"?wmi.write(v.path,percent):v.method==L"VCP"?SetVCPFeature(physical.unique(),parameter==L"brightness"?0x10:parameter==L"contrast"?0x12:0x62,raw):parameter==L"brightness"?SetMonitorBrightness(physical.unique(),raw):SetMonitorContrast(physical.unique(),raw);
 if(!ok)throw std::wstring(L"显示器未接受设置，请重新检测控制能力");
#endif
 v.current=raw;
}
}
int wmain(int argc,wchar_t** argv){
 SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);HRESULT com=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
 try{
#ifdef ONE_DISPLAY_TEST
  if(argc==3&&std::wstring(argv[1])==L"--test-identity"){std::wstring hex=argv[2];if(hex.size()!=256||hex.find_first_not_of(L"0123456789abcdef")!=std::wstring::npos)throw std::wstring(L"测试样本无效");BYTE bytes[128]{};for(int i=0;i<128;i++)bytes[i]=(BYTE)std::stoi(hex.substr(i*2,2),nullptr,16);Row row;row.path=L"test-connection";row.key=row.path;applyEdidIdentity(row,bytes,128);std::cout<<metadata(row);if(SUCCEEDED(com))CoUninitialize();return 0;}
#endif
  std::wstring operation=argc>1?argv[1]:L"",parameter=argc==6?argv[4]:L"";int percent=-1;
  if(operation==L"set"&&argc==6){std::wstring text=argv[5];if(text.empty()||text.size()>3||text.find_first_not_of(L"0123456789")!=std::wstring::npos)throw std::wstring(L"参数需为 0 至 100 的整数");percent=std::stoi(text);}
  if(!((operation==L"list"&&argc==2)||(operation==L"probe"&&argc==4)||(operation==L"set"&&argc==6&&percent>=0&&percent<=100&&(parameter==L"brightness"||parameter==L"contrast"||parameter==L"volume"))))throw std::wstring(L"显示器请求参数无效");
  auto rows=discover();
  if(operation==L"list"){std::cout<<"{\"displays\":[";for(size_t i=0;i<rows.size();i++)std::cout<<(i?",":"")<<metadata(rows[i]);std::cout<<"]}";}
  else{
   auto target=std::find_if(rows.begin(),rows.end(),[&](const Row& row){return row.path==argv[2]&&row.key==argv[3];});
   if(target==rows.end())throw std::wstring(L"显示器已断开或身份发生变化，请刷新列表后重试");if(target->cloned)throw std::wstring(L"镜像模式无法唯一控制此屏幕，请使用扩展模式");
   Physical physical(target->internal?nullptr:target->monitor);Wmi wmi;
   if(operation==L"probe"){std::cout<<"{\"controls\":{";bool first=true;for(auto key:{L"brightness",L"contrast",L"volume"}){auto v=read(*target,key,physical,wmi);std::cout<<(first?"":",")<<json(key)<<":"<<valueJson(v);first=false;}std::cout<<"}}";}
   else{auto v=read(*target,parameter,physical,wmi);set(parameter,percent,v,physical,wmi);
#ifndef ONE_DISPLAY_TEST
   v=read(*target,parameter,physical,wmi);if(!v.supported)throw std::wstring(L"设置已发送，但当前值读取失败，请重新检测");
#endif
   std::cout<<"{\"control\":"<<valueJson(v)<<"}";}
  }
 }catch(const std::wstring& error){std::cout<<"{\"error\":"<<json(error)<<"}";}catch(...){std::cout<<"{\"error\":\"显示器接口暂时不可用\"}";}
 if(SUCCEEDED(com))CoUninitialize();return 0;
}
