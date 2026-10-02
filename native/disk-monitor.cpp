#include <windows.h>
#include <objbase.h>
#include <tlhelp32.h>
#include <evntrace.h>
#include <evntcons.h>
#include <tdh.h>
#include <dxgi.h>
#include <wlanapi.h>
#include <bluetoothapis.h>
#include <wrl/client.h>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <mutex>
#include <thread>
#include <atomic>
#include <algorithm>
#include <iomanip>

static std::atomic<bool> running{true};
static std::mutex lock;
static std::unordered_map<ULONG,ULONG> threads;
static std::unordered_map<ULONGLONG,std::wstring> filenames;
struct Writes { ULONGLONG bytes=0,operations=0,file=0,network=0,device=0,unknown=0;std::unordered_map<std::wstring,ULONGLONG> files; };
static std::unordered_map<ULONG,Writes> writes;
static TRACEHANDLE session=0,consumer=INVALID_PROCESSTRACE_HANDLE;
static std::vector<BYTE> properties;
static std::wstring sessionName;
static GUID fileGuid={0x90cbdc39,0x4a3e,0x11d1,{0x84,0xf4,0x00,0x00,0xf8,0x04,0x64,0xe3}};
static GUID tcpGuid={0x9a280ac0,0xc8e0,0x11d1,{0x84,0xe2,0x00,0xc0,0x4f,0xb9,0x98,0xa2}};
static GUID udpGuid={0xbf3a50c5,0xa9c9,0x4988,{0xa0,0x05,0x2d,0xf0,0xb7,0xc8,0x0f,0x80}};
static std::vector<std::pair<std::wstring,std::wstring>> mounts;
static std::string utf8(const std::wstring& s){if(s.empty())return {};int n=WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);std::string out(n,0);WideCharToMultiByte(CP_UTF8,0,s.data(),(int)s.size(),out.data(),n,nullptr,nullptr);return out;}
static std::string json(const std::wstring& s){std::string out="\"";for(unsigned char c:utf8(s)){if(c=='"'||c=='\\'){out+='\\';out+=c;}else if(c<32){char b[7];sprintf_s(b,"\\u%04x",c);out+=b;}else out+=(char)c;}return out+'"';}
static ULONGLONG ticks(FILETIME t){return (ULONGLONG(t.dwHighDateTime)<<32)|t.dwLowDateTime;}
static std::wstring localPath(std::wstring s){for(const auto& m:mounts)if(s.rfind(m.first,0)==0)return m.second+s.substr(m.first.size());return s;}
static std::vector<BYTE> property(EVENT_RECORD* e,const wchar_t* name){PROPERTY_DATA_DESCRIPTOR p{};p.PropertyName=(ULONGLONG)name;p.ArrayIndex=ULONG_MAX;ULONG size=0;if(TdhGetPropertySize(e,0,nullptr,1,&p,&size)!=ERROR_SUCCESS||size>65536)return {};std::vector<BYTE> b(size);if(TdhGetProperty(e,0,nullptr,1,&p,size,b.data())!=ERROR_SUCCESS)return {};return b;}
static ULONGLONG number(EVENT_RECORD* e,const wchar_t* name){auto b=property(e,name);ULONGLONG n=0;if(b.size()==4||b.size()==8)memcpy(&n,b.data(),b.size());return n;}
static void WINAPI event(EVENT_RECORD* e){
 auto opcode=e->EventHeader.EventDescriptor.Opcode;
 if(IsEqualGUID(e->EventHeader.ProviderId,tcpGuid)||IsEqualGUID(e->EventHeader.ProviderId,udpGuid)){
  if(opcode!=10&&opcode!=26)return;auto pid=(ULONG)number(e,L"PID");auto bytes=number(e,L"size");if(!pid||!bytes)return;std::lock_guard<std::mutex> guard(lock);if(writes.size()>=4096)return;auto& w=writes[pid];w.bytes+=bytes;w.network+=bytes;w.operations++;return;
 }
 if(!IsEqualGUID(e->EventHeader.ProviderId,fileGuid))return;
 if(opcode==0||opcode==32||opcode==35||opcode==36||opcode==64){auto b=property(e,L"FileName");if(b.empty())b=property(e,L"OpenPath");if(b.size()<2)return;auto key=number(e,L"FileObject");if(!key)return;std::wstring path((wchar_t*)b.data(),b.size()/2);while(!path.empty()&&path.back()==0)path.pop_back();if(path.empty())return;
  std::lock_guard<std::mutex> guard(lock);if(filenames.size()>=50000)filenames.clear();filenames[key]=localPath(path);return;}
 if(opcode!=68)return;auto bytes=number(e,L"IoSize");if(!bytes)return;ULONG tid=(ULONG)number(e,L"TTID"),pid=e->EventHeader.ProcessId;ULONGLONG key=number(e,L"FileKey"),object=number(e,L"FileObject");
 std::lock_guard<std::mutex> guard(lock);if(tid){auto t=threads.find(tid);if(t!=threads.end())pid=t->second;else {HANDLE h=OpenThread(THREAD_QUERY_LIMITED_INFORMATION,FALSE,tid);if(h){pid=GetProcessIdOfThread(h);CloseHandle(h);if(pid)threads[tid]=pid;}}}if(!pid||pid==ULONG_MAX||writes.size()>=4096)return;
 auto& w=writes[pid];w.bytes+=bytes;w.operations++;auto f=filenames.find(key);if(f==filenames.end())f=filenames.find(object);if(f==filenames.end()){w.unknown+=bytes;return;}const auto& path=f->second;
 if(path.rfind(L"\\Device\\NamedPipe",0)==0||path.rfind(L"\\Device\\Mailslot",0)==0||path.rfind(L"\\Device\\ConDrv",0)==0)w.device+=bytes;
 else if(path.rfind(L"\\Device\\",0)==0&&path.rfind(L"\\Device\\Mup",0)!=0&&path.rfind(L"\\Device\\LanmanRedirector",0)!=0)w.unknown+=bytes;
 else {w.file+=bytes;if(w.files.size()<64)w.files[path]+=bytes;}
}
static void threadMap(){HANDLE h=CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD,0);if(h==INVALID_HANDLE_VALUE)return;std::unordered_map<ULONG,ULONG> next;THREADENTRY32 e{sizeof(e)};if(Thread32First(h,&e))do{next[e.th32ThreadID]=e.th32OwnerProcessID;}while(Thread32Next(h,&e));CloseHandle(h);std::lock_guard<std::mutex> guard(lock);threads=std::move(next);}
static ULONG startTrace(){
 HANDLE token=nullptr;if(OpenProcessToken(GetCurrentProcess(),TOKEN_ADJUST_PRIVILEGES|TOKEN_QUERY,&token)){TOKEN_PRIVILEGES privileges{};privileges.PrivilegeCount=1;LookupPrivilegeValueW(nullptr,SE_SYSTEM_PROFILE_NAME,&privileges.Privileges[0].Luid);privileges.Privileges[0].Attributes=SE_PRIVILEGE_ENABLED;AdjustTokenPrivileges(token,FALSE,&privileges,0,nullptr,nullptr);CloseHandle(token);}
 sessionName=L"One.FileWrites."+std::to_wstring(GetCurrentProcessId());properties.resize(sizeof(EVENT_TRACE_PROPERTIES)+(sessionName.size()+1)*sizeof(wchar_t));auto p=(EVENT_TRACE_PROPERTIES*)properties.data();p->Wnode.BufferSize=(ULONG)properties.size();p->Wnode.Flags=WNODE_FLAG_TRACED_GUID;p->Wnode.ClientContext=1;CoCreateGuid(&p->Wnode.Guid);p->BufferSize=64;p->MinimumBuffers=16;p->MaximumBuffers=64;p->LogFileMode=EVENT_TRACE_REAL_TIME_MODE|EVENT_TRACE_SYSTEM_LOGGER_MODE;p->EnableFlags=EVENT_TRACE_FLAG_DISK_FILE_IO|EVENT_TRACE_FLAG_FILE_IO|EVENT_TRACE_FLAG_FILE_IO_INIT|EVENT_TRACE_FLAG_NETWORK_TCPIP;p->FlushTimer=1;p->LoggerNameOffset=sizeof(EVENT_TRACE_PROPERTIES);memcpy(properties.data()+p->LoggerNameOffset,sessionName.c_str(),(sessionName.size()+1)*sizeof(wchar_t));
 auto status=StartTraceW(&session,sessionName.c_str(),p);if(status)return status;
 EVENT_TRACE_LOGFILEW log{};log.LoggerName=sessionName.data();log.ProcessTraceMode=PROCESS_TRACE_MODE_REAL_TIME|PROCESS_TRACE_MODE_EVENT_RECORD;log.EventRecordCallback=event;consumer=OpenTraceW(&log);if(consumer==INVALID_PROCESSTRACE_HANDLE){status=GetLastError();ControlTraceW(session,sessionName.c_str(),p,EVENT_TRACE_CONTROL_STOP);session=0;return status;}return ERROR_SUCCESS;
}
static void stopTrace(){if(session){ControlTraceW(session,sessionName.c_str(),(EVENT_TRACE_PROPERTIES*)properties.data(),EVENT_TRACE_CONTROL_STOP);session=0;}if(consumer!=INVALID_PROCESSTRACE_HANDLE){CloseTrace(consumer);consumer=INVALID_PROCESSTRACE_HANDLE;}}
static std::string volumes(){wchar_t roots[512]{};GetLogicalDriveStringsW(512,roots);std::ostringstream out;out<<'[';bool comma=false;for(auto p=roots;*p;p+=wcslen(p)+1){auto type=GetDriveTypeW(p);if(type!=DRIVE_FIXED&&type!=DRIVE_REMOVABLE)continue;ULARGE_INTEGER free{},total{},available{};bool ok=GetDiskFreeSpaceExW(p,&available,&total,&free);auto error=ok?0:GetLastError();wchar_t label[256]{},fs[64]{};GetVolumeInformationW(p,label,256,nullptr,nullptr,nullptr,fs,64);if(comma)out<<',';comma=true;out<<"{\"drive\":"<<json(p)<<",\"label\":"<<json(label)<<",\"filesystem\":"<<json(fs)<<",\"total\":"<<total.QuadPart<<",\"free\":"<<available.QuadPart<<",\"type\":"<<type;if(error)out<<",\"error\":"<<error;out<<'}';}out<<']';return out.str();}
struct ProcessMetadata { ULONGLONG started=0;std::wstring path; };
static std::unordered_map<DWORD,ProcessMetadata> processMetadata;
static std::string processes(){std::ostringstream out;out<<'[';bool comma=false;std::unordered_set<DWORD> live;HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);PROCESSENTRY32W e{sizeof(e)};if(snapshot!=INVALID_HANDLE_VALUE&&Process32FirstW(snapshot,&e))do{HANDLE h=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,e.th32ProcessID);if(!h)continue;IO_COUNTERS io{};FILETIME created{},exit{},kernel{},user{};if(GetProcessIoCounters(h,&io)&&GetProcessTimes(h,&created,&exit,&kernel,&user)){const auto started=ticks(created);live.insert(e.th32ProcessID);auto& metadata=processMetadata[e.th32ProcessID];if(metadata.started!=started){metadata.started=started;wchar_t path[32768]{};DWORD len=32768;metadata.path=QueryFullProcessImageNameW(h,0,path,&len)?std::wstring(path,len):L"";}if(comma)out<<',';comma=true;out<<"{\"pid\":"<<e.th32ProcessID<<",\"started\":\""<<started<<"\",\"name\":"<<json(e.szExeFile)<<",\"path\":"<<json(metadata.path)<<",\"bytes\":"<<io.WriteTransferCount<<",\"operations\":"<<io.WriteOperationCount<<'}';}CloseHandle(h);}while(Process32NextW(snapshot,&e));if(snapshot!=INVALID_HANDLE_VALUE)CloseHandle(snapshot);for(auto it=processMetadata.begin();it!=processMetadata.end();)if(!live.contains(it->first))it=processMetadata.erase(it);else ++it;out<<']';return out.str();}
static std::string fileWrites(){std::unordered_map<ULONG,Writes> current;{std::lock_guard<std::mutex> guard(lock);current.swap(writes);}std::ostringstream out;out<<'[';bool comma=false;for(auto& [pid,w]:current){if(comma)out<<',';comma=true;out<<"{\"pid\":"<<pid<<",\"bytes\":"<<w.bytes<<",\"operations\":"<<w.operations<<",\"kinds\":{\"file\":"<<w.file<<",\"network\":"<<w.network<<",\"device\":"<<w.device<<",\"unknown\":"<<w.unknown<<"},\"files\":[";std::vector<std::pair<std::wstring,ULONGLONG>> files(w.files.begin(),w.files.end());std::sort(files.begin(),files.end(),[](auto& a,auto& b){return a.second>b.second;});bool fc=false;for(size_t i=0;i<std::min<size_t>(16,files.size());i++){if(fc)out<<',';fc=true;out<<"{\"path\":"<<json(files[i].first)<<",\"bytes\":"<<files[i].second<<'}';}out<<"]}";}out<<']';return out.str();}
static std::string field(const wchar_t* key,const wchar_t* label,const std::wstring& value){return "{\"key\":"+json(key)+",\"label\":"+json(label)+",\"value\":"+json(value)+"}";}
static std::wstring capacity(ULONGLONG n){std::wostringstream s;s<<std::fixed<<std::setprecision(2)<<double(n)/1073741824<<L" GB";return s.str();}
static std::wstring registryText(const wchar_t* key,const wchar_t* name){wchar_t text[512]{};DWORD bytes=sizeof(text);return RegGetValueW(HKEY_LOCAL_MACHINE,key,name,RRF_RT_REG_SZ,nullptr,text,&bytes)==ERROR_SUCCESS?text:L"未报告";}
static void hardware(const std::wstring& category){
 std::cout<<'[';bool groupComma=false;auto group=[&](const wchar_t* id,const wchar_t* title,const std::string& records){if(groupComma)std::cout<<',';groupComma=true;std::cout<<"{\"id\":"<<json(id)<<",\"title\":"<<json(title)<<",\"records\":["<<records<<"]}";};
 if(category==L"display"||category==L"overview"){
  Microsoft::WRL::ComPtr<IDXGIFactory1> factory;std::string records;bool comma=false;if(SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(&factory))))for(UINT i=0;;i++){Microsoft::WRL::ComPtr<IDXGIAdapter1> adapter;if(factory->EnumAdapters1(i,&adapter)==DXGI_ERROR_NOT_FOUND)break;DXGI_ADAPTER_DESC1 d{};if(FAILED(adapter->GetDesc1(&d)))continue;if(d.Flags&DXGI_ADAPTER_FLAG_SOFTWARE)continue;if(comma)records+=',';comma=true;records+="{\"title\":"+json(d.Description)+",\"fields\":["+field(L"DedicatedVideoMemory",L"独立显存",capacity(d.DedicatedVideoMemory))+","+field(L"SharedSystemMemory",L"可用共享显存",capacity(d.SharedSystemMemory))+","+field(L"DedicatedSystemMemory",L"专用系统内存",capacity(d.DedicatedSystemMemory))+","+field(L"VendorId",L"PCI 厂商 ID",std::to_wstring(d.VendorId))+","+field(L"DeviceId",L"PCI 设备 ID",std::to_wstring(d.DeviceId))+","+field(L"SubSysId",L"子系统 ID",std::to_wstring(d.SubSysId))+","+field(L"Revision",L"修订",std::to_wstring(d.Revision))+","+field(L"Source",L"数据接口",L"DXGI · 64 位显存计数")+"]}";}
  group(L"dxgi",L"图形适配器与显存",records);records.clear();comma=false;DISPLAY_DEVICEW device{sizeof(device)};for(DWORD i=0;EnumDisplayDevicesW(nullptr,i,&device,0);i++){if(!(device.StateFlags&DISPLAY_DEVICE_ACTIVE))continue;DEVMODEW mode{};mode.dmSize=sizeof(mode);if(!EnumDisplaySettingsExW(device.DeviceName,ENUM_CURRENT_SETTINGS,&mode,0))continue;if(comma)records+=',';comma=true;records+="{\"title\":"+json(device.DeviceString)+",\"fields\":["+field(L"DeviceName",L"显示接口",device.DeviceName)+","+field(L"Resolution",L"分辨率",std::to_wstring(mode.dmPelsWidth)+L" × "+std::to_wstring(mode.dmPelsHeight))+","+field(L"Refresh",L"刷新率",std::to_wstring(mode.dmDisplayFrequency)+L" Hz")+","+field(L"Depth",L"色深",std::to_wstring(mode.dmBitsPerPel)+L" 位")+","+field(L"Position",L"桌面坐标",std::to_wstring(mode.dmPosition.x)+L", "+std::to_wstring(mode.dmPosition.y))+","+field(L"Primary",L"主显示器",device.StateFlags&DISPLAY_DEVICE_PRIMARY_DEVICE?L"是":L"否")+"]}";device.cb=sizeof(device);}group(L"display-modes",L"当前显示模式",records);
 }
 if(category==L"board"||category==L"os"){
  FIRMWARE_TYPE type=FirmwareTypeUnknown;GetFirmwareType(&type);DWORD secure=0,bytes=sizeof(secure);auto status=RegGetValueW(HKEY_LOCAL_MACHINE,L"SYSTEM\\CurrentControlSet\\Control\\SecureBoot\\State",L"UEFISecureBootEnabled",RRF_RT_REG_DWORD,nullptr,&secure,&bytes);std::string records="{\"title\":"+json(L"启动固件")+",\"fields\":["+field(L"FirmwareType",L"启动模式",type==FirmwareTypeUefi?L"UEFI":type==FirmwareTypeBios?L"传统 BIOS":L"未报告")+","+field(L"SecureBoot",L"安全启动",status==ERROR_SUCCESS?(secure?L"已启用":L"未启用"):L"未报告")+"]}";group(L"firmware",L"启动与安全",records);
 }
 if(category==L"os"){
  const wchar_t* key=L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";DWORD revision=0,size=sizeof(revision);RegGetValueW(HKEY_LOCAL_MACHINE,key,L"UBR",RRF_RT_REG_DWORD,nullptr,&revision,&size);auto build=registryText(key,L"CurrentBuildNumber");std::string record="{\"title\":"+json(L"Windows 发行信息")+",\"fields\":["+field(L"DisplayVersion",L"功能版本",registryText(key,L"DisplayVersion"))+","+field(L"Build",L"完整内部版本",build+L"."+std::to_wstring(revision))+","+field(L"Edition",L"版本标识",registryText(key,L"EditionID"))+","+field(L"InstallationType",L"安装类型",registryText(key,L"InstallationType"))+","+field(L"BuildLabEx",L"构建标识",registryText(key,L"BuildLabEx"))+"]}";group(L"windows-release",L"Windows 发行版本",record);
 }
 if(category==L"network"){
  HANDLE client=nullptr;DWORD version=0;std::string records;bool comma=false;DWORD status=WlanOpenHandle(2,nullptr,&version,&client);if(!status){WLAN_INTERFACE_INFO_LIST* interfaces=nullptr;if(!WlanEnumInterfaces(client,nullptr,&interfaces))for(DWORD i=0;i<interfaces->dwNumberOfItems;i++){auto& iface=interfaces->InterfaceInfo[i];WLAN_CONNECTION_ATTRIBUTES* connection=nullptr;DWORD size=0;WLAN_OPCODE_VALUE_TYPE opcode;status=WlanQueryInterface(client,&iface.InterfaceGuid,wlan_intf_opcode_current_connection,nullptr,&size,(PVOID*)&connection,&opcode);if(status)continue;auto& a=connection->wlanAssociationAttributes;auto& security=connection->wlanSecurityAttributes;auto& ssid=a.dot11Ssid;int count=MultiByteToWideChar(CP_UTF8,0,(char*)ssid.ucSSID,ssid.uSSIDLength,nullptr,0);std::wstring name(count,0);MultiByteToWideChar(CP_UTF8,0,(char*)ssid.ucSSID,ssid.uSSIDLength,name.data(),count);DWORD* channel=nullptr,channelSize=0;WlanQueryInterface(client,&iface.InterfaceGuid,wlan_intf_opcode_channel_number,nullptr,&channelSize,(PVOID*)&channel,&opcode);if(comma)records+=',';comma=true;records+="{\"title\":"+json(iface.strInterfaceDescription)+",\"fields\":["+field(L"SSID",L"Wi-Fi 名称",name)+","+field(L"Signal",L"信号质量",std::to_wstring(a.wlanSignalQuality)+L" %")+","+field(L"RxRate",L"接收链路速率",std::to_wstring(a.ulRxRate/1000)+L" Mbps")+","+field(L"TxRate",L"发送链路速率",std::to_wstring(a.ulTxRate/1000)+L" Mbps")+","+field(L"Channel",L"信道",channel?std::to_wstring(*channel):L"未报告")+","+field(L"Phy",L"PHY 类型编码",std::to_wstring(a.dot11PhyType))+","+field(L"Security",L"安全连接",security.bSecurityEnabled?L"是":L"否")+","+field(L"Auth",L"认证算法编码",std::to_wstring(security.dot11AuthAlgorithm))+","+field(L"Cipher",L"加密算法编码",std::to_wstring(security.dot11CipherAlgorithm))+"]}";if(channel)WlanFreeMemory(channel);WlanFreeMemory(connection);}if(interfaces)WlanFreeMemory(interfaces);WlanCloseHandle(client,nullptr);}group(L"wifi",L"当前 Wi-Fi 连接",records);
 }
 if(category==L"bluetooth"){
  std::string records;bool comma=false;BLUETOOTH_FIND_RADIO_PARAMS parameters{sizeof(parameters)};HANDLE radio=nullptr;HBLUETOOTH_RADIO_FIND find=BluetoothFindFirstRadio(&parameters,&radio);if(find)do{BLUETOOTH_RADIO_INFO info{sizeof(info)};if(BluetoothGetRadioInfo(radio,&info)==ERROR_SUCCESS){wchar_t address[32]{};swprintf_s(address,L"%02X:%02X:%02X:%02X:%02X:%02X",info.address.rgBytes[5],info.address.rgBytes[4],info.address.rgBytes[3],info.address.rgBytes[2],info.address.rgBytes[1],info.address.rgBytes[0]);if(comma)records+=',';comma=true;records+="{\"title\":"+json(info.szName)+",\"fields\":["+field(L"Address",L"无线电地址",address)+","+field(L"Manufacturer",L"制造商编号",std::to_wstring(info.manufacturer))+","+field(L"Subversion",L"LMP 子版本",std::to_wstring(info.lmpSubversion))+"]}";}CloseHandle(radio);}while(BluetoothFindNextRadio(find,&radio));if(find)BluetoothFindRadioClose(find);group(L"bluetooth-radios",L"蓝牙无线电",records);records.clear();comma=false;
  BLUETOOTH_DEVICE_SEARCH_PARAMS search{sizeof(search)};search.fReturnAuthenticated=search.fReturnRemembered=search.fReturnConnected=TRUE;search.fIssueInquiry=FALSE;BLUETOOTH_DEVICE_INFO device{sizeof(device)};HBLUETOOTH_DEVICE_FIND devices=BluetoothFindFirstDevice(&search,&device);if(devices)do{if(comma)records+=',';comma=true;wchar_t address[32]{};swprintf_s(address,L"%02X:%02X:%02X:%02X:%02X:%02X",device.Address.rgBytes[5],device.Address.rgBytes[4],device.Address.rgBytes[3],device.Address.rgBytes[2],device.Address.rgBytes[1],device.Address.rgBytes[0]);records+="{\"title\":"+json(device.szName)+",\"fields\":["+field(L"Address",L"设备地址",address)+","+field(L"Connected",L"已连接",device.fConnected?L"是":L"否")+","+field(L"Authenticated",L"已配对",device.fAuthenticated?L"是":L"否")+","+field(L"Remembered",L"已记住",device.fRemembered?L"是":L"否")+","+field(L"Class",L"设备类别编码",std::to_wstring(device.ulClassofDevice))+"]}";device.dwSize=sizeof(device);}while(BluetoothFindNextDevice(devices,&device));if(devices)BluetoothFindDeviceClose(devices);group(L"bluetooth-known",L"已配对与连接设备",records);
 }
 if(category==L"battery"){
  SYSTEM_POWER_STATUS power{};std::string records;if(GetSystemPowerStatus(&power))records="{\"title\":"+json(L"当前电源")+",\"fields\":["+field(L"AC",L"交流供电",power.ACLineStatus==1?L"是":power.ACLineStatus==0?L"否":L"未报告")+","+field(L"Percent",L"剩余电量",power.BatteryLifePercent<=100?std::to_wstring(power.BatteryLifePercent)+L" %":L"未报告")+","+field(L"Battery",L"电池存在",power.BatteryFlag==255?L"未报告":power.BatteryFlag&128?L"否":L"是")+","+field(L"Saving",L"节能模式",power.SystemStatusFlag?L"已启用":L"未启用")+"]}";group(L"power-live",L"供电与节能",records);
 }
 std::cout<<']';
}
int wmain(int argc,wchar_t** argv){
 if(argc>2&&std::wstring(argv[1])==L"hardware"){hardware(argv[2]);return 0;}
 unsigned interval=2000;bool trace=argc>1&&std::wstring(argv[1])==L"trace";std::atomic<ULONGLONG> writerMode{trace||argc<=1||std::wstring(argv[1])!=L"capacity"?1ULL:0ULL};if(argc>2)try{interval=std::clamp<unsigned>(std::stoul(argv[2]),1000,60000);}catch(...){}
 wchar_t drives[512]{};GetLogicalDriveStringsW(512,drives);for(auto p=drives;*p;p+=wcslen(p)+1){std::wstring name(p,2);wchar_t device[1024]{};if(QueryDosDeviceW(name.c_str(),device,1024))mounts.push_back({device,name});}std::sort(mounts.begin(),mounts.end(),[](auto& a,auto& b){return a.first.size()>b.first.size();});
 if(trace)threadMap();ULONG traceStatus=trace?startTrace():ERROR_SUCCESS;std::thread consumerThread;if(trace&&!traceStatus)consumerThread=std::thread([]{TRACEHANDLE handle=consumer;ProcessTrace(&handle,1,nullptr,nullptr);});
 HANDLE wake=CreateEventW(nullptr,FALSE,FALSE,nullptr);if(!wake){stopTrace();if(consumerThread.joinable())consumerThread.join();return 1;}
 std::thread inputThread([&]{std::string line;while(std::getline(std::cin,line)){if(line=="stop")break;std::istringstream command(line);std::string name;unsigned active=0;ULONGLONG epoch=(writerMode.load()>>1)+1;if(command>>name>>active&&name=="writers"&&active<=1){ULONGLONG supplied;if(command>>supplied)epoch=supplied;if(epoch<=9007199254740991ULL){writerMode=(epoch<<1)|active;SetEvent(wake);}}}running=false;SetEvent(wake);});
 ULONGLONG lastIdle=0,lastKernel=0,lastUser=0;
 while(running){FILETIME idle{},kernel{},user{};GetSystemTimes(&idle,&kernel,&user);auto i=ticks(idle),k=ticks(kernel),u=ticks(user),delta=(k-lastKernel)+(u-lastUser);double cpu=lastKernel&&delta?100.0*(delta-(i-lastIdle))/delta:0;lastIdle=i;lastKernel=k;lastUser=u;MEMORYSTATUSEX memory{sizeof(memory)};GlobalMemoryStatusEx(&memory);auto now=GetTickCount64();
  if(trace&&!traceStatus)threadMap();
  FILETIME wall{};GetSystemTimeAsFileTime(&wall);auto wallMs=ticks(wall)/10000-11644473600000ULL;
  const auto mode=writerMode.load();const bool samplingWriters=trace||(mode&1);if(!samplingWriters&&!processMetadata.empty())std::unordered_map<DWORD,ProcessMetadata>().swap(processMetadata);
  std::cout<<"{\"created\":"<<wallMs<<",\"volumes\":"<<volumes()<<",\"samplingWriters\":"<<(samplingWriters?"true":"false")<<",\"samplingEpoch\":"<<(mode>>1)<<",\"processes\":"<<(samplingWriters?processes():"[]")<<",\"fileWrites\":"<<(trace?fileWrites():"[]")<<",\"trace\":\""<<(trace?(traceStatus?((traceStatus==ERROR_ACCESS_DENIED||traceStatus==ERROR_PRIVILEGE_NOT_HELD)?"permission":"error"):"active"):"off")<<"\",\"traceCode\":"<<traceStatus<<",\"cpuPercent\":"<<std::fixed<<std::setprecision(1)<<cpu<<",\"memoryTotal\":"<<memory.ullTotalPhys<<",\"memoryFree\":"<<memory.ullAvailPhys<<",\"uptimeSeconds\":"<<now/1000<<"}"<<std::endl;
  if(running)WaitForSingleObject(wake,interval);
 }stopTrace();if(consumerThread.joinable())consumerThread.join();inputThread.join();CloseHandle(wake);return 0;
}
