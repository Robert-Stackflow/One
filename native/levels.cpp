#define NOMINMAX
#include <windows.h>
#include <mmdeviceapi.h>
#include <endpointvolume.h>
#include <wbemidl.h>
#include <physicalmonitorenumerationapi.h>
#include <highlevelmonitorconfigurationapi.h>
#include <lowlevelmonitorconfigurationapi.h>
#include <wrl/client.h>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <map>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>
#include <cmath>
#include <algorithm>
#include <memory>
#include <cwctype>
#include "corner-state.h"
using Microsoft::WRL::ComPtr;
struct Request{int id=0,x=0,y=0,delta=0;bool read=true,toggle=false;};
struct Queue{std::mutex mutex;std::condition_variable wake;std::queue<Request> items;};
Queue audioQueue,brightnessQueue;std::atomic<bool> stopped=false;std::mutex outputMutex,cornerMutex;
struct Corners{int mask=0,dwell=0,pixels=0,cooldown=0;unsigned revision=0,suppressed=0;} cornerConfig;
void output(const std::string& line){std::lock_guard lock(outputMutex);std::cout<<line<<std::endl;}
std::string json(const std::wstring& s){int count=WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);std::string value(count,0);WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),value.data(),count,nullptr,nullptr);std::string out="\"";for(unsigned char c:value){if(c=='"'||c=='\\'){out+='\\';out+=(char)c;}else if(c<32)out+=' ';else out+=(char)c;}return out+'"';}
void error(int id,const std::wstring& text){output(id==0?"{\"levelError\":"+json(text)+"}":"{\"id\":"+std::to_string(id)+",\"error\":"+json(text)+"}");}
void result(int id,int value,const std::wstring& name,const std::wstring& method,int muted=-1){if(id==0){output("{\"level\":{\"action\":\""+std::string(muted<0?"brightness":"volume")+"\",\"value\":"+std::to_string(value)+(muted<0?"":",\"muted\":"+std::string(muted?"true":"false"))+"}}");return;}output("{\"id\":"+std::to_string(id)+",\"result\":{\"brightness\":"+std::to_string(value)+",\"name\":"+json(name)+",\"method\":"+json(method)+(muted<0?"":",\"muted\":"+std::string(muted?"true":"false"))+",\"supported\":true}}");}
bool next(Queue& q,Request& r){std::unique_lock lock(q.mutex);q.wake.wait(lock,[&]{return stopped||!q.items.empty();});if(stopped)return false;r=q.items.front();q.items.pop();return true;}
void push(Queue& q,Request r){{std::lock_guard lock(q.mutex);if(!q.items.empty()&&r.id==0&&!r.read&&!r.toggle&&q.items.back().id==0&&!q.items.back().toggle&&MonitorFromPoint({r.x,r.y},MONITOR_DEFAULTTONEAREST)==MonitorFromPoint({q.items.back().x,q.items.back().y},MONITOR_DEFAULTTONEAREST))q.items.back().delta=std::max(-100,std::min(100,q.items.back().delta+r.delta));else q.items.push(r);}q.wake.notify_one();}
int clamp(int value){return std::max(0,std::min(100,value));}
struct ComRuntime{HRESULT hr;ComRuntime():hr(CoInitializeEx(nullptr,COINIT_MULTITHREADED)){}~ComRuntime(){if(SUCCEEDED(hr))CoUninitialize();}};
void audio(){ComRuntime com;ComPtr<IMMDeviceEnumerator> devices;CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&devices));ComPtr<IAudioEndpointVolume> volume;std::wstring endpoint;Request r;
 while(next(audioQueue,r)){ComPtr<IMMDevice> device;LPWSTR id=nullptr;HRESULT hr=devices?devices->GetDefaultAudioEndpoint(eRender,eMultimedia,&device):E_FAIL;
  if(SUCCEEDED(hr))hr=device->GetId(&id);if(SUCCEEDED(hr)&&(endpoint!=id||!volume)){volume.Reset();endpoint=id;hr=device->Activate(__uuidof(IAudioEndpointVolume),CLSCTX_ALL,nullptr,(void**)volume.GetAddressOf());}if(id)CoTaskMemFree(id);
  BOOL muted=FALSE;if(SUCCEEDED(hr)&&volume)hr=volume->GetMute(&muted);float value=0;if(SUCCEEDED(hr)&&volume)hr=volume->GetMasterVolumeLevelScalar(&value);if(SUCCEEDED(hr)){int percent=clamp((int)std::lround(value*100)+r.delta);if(!r.read){if(r.toggle){muted=!muted;hr=volume->SetMute(muted,nullptr);}else if(r.delta){hr=volume->SetMasterVolumeLevelScalar(percent/100.f,nullptr);if(SUCCEEDED(hr)&&muted){hr=volume->SetMute(FALSE,nullptr);muted=FALSE;}}}if(SUCCEEDED(hr)){result(r.id,percent,L"",L"Core Audio",muted?1:0);continue;}}
  volume.Reset();endpoint.clear();error(r.id,L"音频设备不可用，请检查当前输出设备");
 }
}
struct Bstr{BSTR value;Bstr(const wchar_t* s):value(SysAllocString(s)){}~Bstr(){SysFreeString(value);}operator BSTR()const{return value;}};
class Wmi{
 ComPtr<IWbemServices> services;
 public:
 bool connect(){if(services)return true;ComPtr<IWbemLocator> locator;if(FAILED(CoCreateInstance(CLSID_WbemLocator,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&locator))))return false;if(FAILED(locator->ConnectServer(Bstr(L"ROOT\\WMI"),nullptr,nullptr,nullptr,0,nullptr,nullptr,&services)))return false;return SUCCEEDED(CoSetProxyBlanket(services.Get(),RPC_C_AUTHN_WINNT,RPC_C_AUTHZ_NONE,nullptr,RPC_C_AUTHN_LEVEL_CALL,RPC_C_IMP_LEVEL_IMPERSONATE,nullptr,EOAC_NONE));}
 std::vector<ComPtr<IWbemClassObject>> query(const wchar_t* query){std::vector<ComPtr<IWbemClassObject>> rows;if(!connect())return rows;ComPtr<IEnumWbemClassObject> list;if(FAILED(services->ExecQuery(Bstr(L"WQL"),Bstr(query),WBEM_FLAG_FORWARD_ONLY|WBEM_FLAG_RETURN_IMMEDIATELY,nullptr,&list)))return rows;for(int i=0;i<32;i++){ComPtr<IWbemClassObject> row;ULONG count=0;if(list->Next(1200,1,&row,&count)!=S_OK||!count)break;rows.push_back(row);}return rows;}
 static std::wstring text(IWbemClassObject* row,const wchar_t* key){VARIANT v;VariantInit(&v);row->Get(key,0,&v,nullptr,nullptr);std::wstring result=v.vt==VT_BSTR&&v.bstrVal?v.bstrVal:L"";VariantClear(&v);return result;}
 static int number(IWbemClassObject* row,const wchar_t* key){VARIANT v;VariantInit(&v);row->Get(key,0,&v,nullptr,nullptr);int n=v.vt==VT_UI1?v.bVal:v.vt==VT_I4?v.lVal:v.vt==VT_UI4?(int)v.ulVal:-1;VariantClear(&v);return n;}
 bool write(const std::wstring& path,int value){ComPtr<IWbemClassObject> type,input,args,reply;if(FAILED(services->GetObject(Bstr(L"WmiMonitorBrightnessMethods"),0,nullptr,&type,nullptr))||FAILED(type->GetMethod(L"WmiSetBrightness",0,&input,nullptr))||FAILED(input->SpawnInstance(0,&args)))return false;VARIANT timeout;VariantInit(&timeout);timeout.vt=VT_BSTR;timeout.bstrVal=SysAllocString(L"0");HRESULT hr=args->Put(L"Timeout",0,&timeout,CIM_UINT32);VariantClear(&timeout);VARIANT brightness;VariantInit(&brightness);brightness.vt=VT_UI1;brightness.bVal=(BYTE)value;if(FAILED(hr)||FAILED(args->Put(L"Brightness",0,&brightness,CIM_UINT8)))return false;hr=services->ExecMethod(Bstr(path.c_str()),Bstr(L"WmiSetBrightness"),0,nullptr,args.Get(),&reply,nullptr);return SUCCEEDED(hr)&&number(reply.Get(),L"ReturnValue")==0;}
};
struct Panel{HANDLE handle=nullptr;DWORD min=0,max=100;int value=0;bool vcp=false;std::wstring name,method,instance,path;ULONGLONG readAt=0,usedAt=0;~Panel(){if(handle)DestroyPhysicalMonitor(handle);}};
std::wstring normalized(std::wstring s){for(auto& c:s)c=towupper(c);auto at=s.rfind(L'_');if(at!=std::wstring::npos&&s.size()-at<=4&&s.find_first_not_of(L"0123456789",at+1)==std::wstring::npos)s.resize(at);return s;}
void discover(HMONITOR monitor,Panel& panel,Wmi& wmi){MONITORINFOEXW info{};info.cbSize=sizeof(info);if(!GetMonitorInfoW(monitor,&info))throw std::wstring(L"显示器已断开");panel.name=info.szDevice;
 DWORD count=0;if(GetNumberOfPhysicalMonitorsFromHMONITOR(monitor,&count)&&count&&count<=16){std::vector<PHYSICAL_MONITOR> physical(count);if(GetPhysicalMonitorsFromHMONITOR(monitor,count,physical.data())){
   if(count==1){DWORD min=0,current=0,max=0;bool vcp=false;bool ok=GetMonitorBrightness(physical[0].hPhysicalMonitor,&min,&current,&max);if(!ok){MC_VCP_CODE_TYPE type;ok=GetVCPFeatureAndVCPFeatureReply(physical[0].hPhysicalMonitor,0x10,&type,&current,&max);vcp=true;}if(ok&&max>min){panel.handle=physical[0].hPhysicalMonitor;panel.min=min;panel.max=max;panel.value=clamp((int)std::lround((current-min)*100.0/(max-min)));panel.vcp=vcp;panel.name=physical[0].szPhysicalMonitorDescription;panel.method=L"DDC/CI";panel.readAt=GetTickCount64();return;}}
   DestroyPhysicalMonitors(count,physical.data());if(count!=1)throw std::wstring(L"镜像显示器无法唯一定位，请使用扩展显示模式");
  }}
 DISPLAY_DEVICEW device{};device.cb=sizeof(device);if(!EnumDisplayDevicesW(info.szDevice,0,&device,EDD_GET_DEVICE_INTERFACE_NAME))throw std::wstring(L"此屏幕未提供亮度接口");std::wstring instance=device.DeviceID;if(instance.starts_with(L"\\\\?\\"))instance.erase(0,4);auto at=instance.find(L"#{");if(at!=std::wstring::npos)instance.resize(at);std::replace(instance.begin(),instance.end(),L'#',L'\\');instance=normalized(instance);
 auto panels=wmi.query(L"SELECT InstanceName,CurrentBrightness,Active FROM WmiMonitorBrightness");for(const auto& row:panels){if(normalized(Wmi::text(row.Get(),L"InstanceName"))!=instance)continue;VARIANT active;VariantInit(&active);row->Get(L"Active",0,&active,nullptr,nullptr);bool enabled=active.vt==VT_BOOL&&active.boolVal;VariantClear(&active);if(!enabled)continue;int current=Wmi::number(row.Get(),L"CurrentBrightness");if(current<0)continue;panel.instance=Wmi::text(row.Get(),L"InstanceName");panel.value=current;panel.method=L"WMI";break;}
 if(panel.method.empty())throw std::wstring(L"此屏幕不支持亮度调节，请检查 DDC/CI 或显示驱动");for(const auto& row:wmi.query(L"SELECT InstanceName,__PATH FROM WmiMonitorBrightnessMethods"))if(Wmi::text(row.Get(),L"InstanceName")==panel.instance){panel.path=Wmi::text(row.Get(),L"__PATH");break;}if(panel.path.empty())throw std::wstring(L"未找到此屏幕的亮度控制接口");panel.readAt=GetTickCount64();
}
void refresh(Panel& panel,Wmi& wmi){if(panel.handle){DWORD min=panel.min,current=0,max=0;bool ok=panel.vcp?GetVCPFeatureAndVCPFeatureReply(panel.handle,0x10,nullptr,&current,&max):GetMonitorBrightness(panel.handle,&min,&current,&max);if(!ok||max<=min)throw std::wstring(L"显示器亮度读取失败");panel.value=clamp((int)std::lround((current-min)*100.0/(max-min)));panel.min=min;panel.max=max;}else{bool found=false;for(const auto& row:wmi.query(L"SELECT InstanceName,CurrentBrightness FROM WmiMonitorBrightness"))if(Wmi::text(row.Get(),L"InstanceName")==panel.instance){int current=Wmi::number(row.Get(),L"CurrentBrightness");if(current>=0){panel.value=current;found=true;}break;}if(!found)throw std::wstring(L"屏幕亮度接口已断开");}panel.readAt=GetTickCount64();}
void brightness(){ComRuntime com;Wmi wmi;std::map<HMONITOR,std::unique_ptr<Panel>> panels;Request r;while(next(brightnessQueue,r)){HMONITOR monitor=MonitorFromPoint(POINT{r.x,r.y},MONITOR_DEFAULTTONULL);try{if(!monitor)throw std::wstring(L"显示器已断开");auto now=GetTickCount64();for(auto it=panels.begin();it!=panels.end();)if(now-it->second->usedAt>30000)it=panels.erase(it);else ++it;auto& p=panels[monitor];if(!p){p=std::make_unique<Panel>();discover(monitor,*p,wmi);}else if(r.read||now-p->readAt>1200)refresh(*p,wmi);p->usedAt=now;int value=clamp(p->value+r.delta);
   if(!r.read&&value!=p->value){bool ok=false;for(int attempt=0;attempt<2&&!ok;attempt++){if(attempt)Sleep(35);ok=p->handle?(p->vcp?SetVCPFeature(p->handle,0x10,(DWORD)std::lround(p->min+value*(p->max-p->min)/100.0)):SetMonitorBrightness(p->handle,(DWORD)std::lround(p->min+value*(p->max-p->min)/100.0))):wmi.write(p->path,value);}if(!ok)throw std::wstring(L"屏幕未接受亮度设置，请检查 DDC/CI 或驱动");p->value=value;}
   p->readAt=GetTickCount64();result(r.id,value,p->name,p->method);
  }catch(const std::wstring& e){panels.erase(monitor);error(r.id,e);}catch(...){panels.erase(monitor);error(r.id,L"亮度接口不可用");}
 }}
BOOL CALLBACK monitorRect(HMONITOR,HDC,LPRECT rect,LPARAM value){((std::vector<RECT>*)value)->push_back(*rect);return TRUE;}
BOOL CALLBACK displayInfo(HMONITOR monitor,HDC,LPRECT rect,LPARAM count){
 auto& n=*(int*)count;if(n++)std::cout<<',';
 POINT center{(rect->left+rect->right)/2,(rect->top+rect->bottom)/2},edge{rect->right-1,rect->bottom-1};
 std::cout<<"{\"left\":"<<rect->left<<",\"top\":"<<rect->top<<",\"right\":"<<rect->right<<",\"bottom\":"<<rect->bottom<<",\"centerMapped\":"<<(MonitorFromPoint(center,MONITOR_DEFAULTTONULL)==monitor?"true":"false")<<",\"edgeMapped\":"<<(MonitorFromPoint(edge,MONITOR_DEFAULTTONULL)==monitor?"true":"false")<<'}';return TRUE;
}
bool inside(POINT p,RECT r){return p.x>=r.left&&p.x<r.right&&p.y>=r.top&&p.y<r.bottom;}
void corners(){std::vector<RECT> displays;ULONGLONG topology=0;CornerState state;unsigned revision=0,suppressed=0;const char* names[]={"TL","TR","BL","BR"};
 while(!stopped){Corners config;{std::lock_guard lock(cornerMutex);config=cornerConfig;}auto now=GetTickCount64();if(revision!=config.revision){state.reset();revision=config.revision;}if(suppressed!=config.suppressed){state.suppress();suppressed=config.suppressed;}if(!config.mask){Sleep(30);continue;}if(now-topology>3000||displays.empty()){displays.clear();EnumDisplayMonitors(nullptr,nullptr,monitorRect,(LPARAM)&displays);topology=now;}
  POINT p{};GetCursorPos(&p);auto monitor=MonitorFromPoint(p,MONITOR_DEFAULTTONULL);MONITORINFO info{sizeof(info)};int candidate=-1;if(monitor&&GetMonitorInfoW(monitor,&info)){auto b=info.rcMonitor;bool left=p.x<b.left+config.pixels,right=p.x>=b.right-config.pixels,top=p.y<b.top+config.pixels,bottom=p.y>=b.bottom-config.pixels;if((left||right)&&(top||bottom)){candidate=(bottom?2:0)+(right?1:0);POINT outsideX{left?b.left-1:b.right,p.y},outsideY{p.x,top?b.top-1:b.bottom};for(auto d:displays)if(!EqualRect(&d,&b)&&(inside(outsideX,d)||inside(outsideY,d))){candidate=-1;break;}if(candidate>=0&&!(config.mask&(1<<candidate)))candidate=-1;}}
  if(state.update((uintptr_t)monitor,candidate,now,config.dwell,config.cooldown))output("{\"corner\":\""+std::string(names[candidate])+"\"}");Sleep(16);
 }
}
#include "quick-actions.h"
int main(int argc,char** argv){SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);if(argc==2&&std::string(argv[1])=="--display-info"){int count=0;std::cout<<'[';EnumDisplayMonitors(nullptr,nullptr,displayInfo,(LPARAM)&count);std::cout<<']';return 0;}if(argc==2&&std::string(argv[1])=="--test-corners"){CornerState state;std::string op;while(std::cin>>op){if(op=="reset"){state.reset();continue;}if(op=="suppress"){state.suppress();continue;}int corner=0,dwell=0,cooldown=0;uintptr_t monitor=0;uint64_t now=0;if(std::cin>>monitor>>corner>>now>>dwell>>cooldown)std::cout<<state.update(monitor,corner,now,dwell,cooldown)<<std::endl;}return 0;}CoInitializeEx(nullptr,COINIT_MULTITHREADED);CoInitializeSecurity(nullptr,-1,nullptr,nullptr,RPC_C_AUTHN_LEVEL_DEFAULT,RPC_C_IMP_LEVEL_IMPERSONATE,nullptr,EOAC_NONE,nullptr);std::thread a(audio),b(brightness),c(corners);quick::start([](bool volume,POINT p,int delta,bool toggle){{std::lock_guard lock(cornerMutex);cornerConfig.suppressed++;}push(volume?audioQueue:brightnessQueue,{0,p.x,p.y,delta,false,toggle});},[](const std::wstring& message){error(0,message);});std::string line;while(std::getline(std::cin,line)){std::istringstream in(line);std::string op;in>>op;if(op=="stop")break;if(op=="quick"){quick::configure(in);continue;}if(op=="corners"){std::lock_guard lock(cornerMutex);in>>cornerConfig.mask>>cornerConfig.dwell>>cornerConfig.pixels>>cornerConfig.cooldown;cornerConfig.revision++;continue;}if(op=="suppress"){std::lock_guard lock(cornerMutex);cornerConfig.suppressed++;continue;}Request r;int read=1;if(in>>r.id>>r.x>>r.y>>r.delta>>read){r.read=read!=0;if(op=="volume"||op=="mute"){r.toggle=op=="mute";push(audioQueue,r);}else if(op=="brightness")push(brightnessQueue,r);}}
 quick::stop();stopped=true;audioQueue.wake.notify_all();brightnessQueue.wake.notify_all();a.join();b.join();c.join();CoUninitialize();
}
