#pragma once
// Shared with the existing cursor-based brightness service.
#include <windows.h>
#include <wbemidl.h>
#include <wrl/client.h>
#include <string>
#include <vector>
using Microsoft::WRL::ComPtr;
struct Bstr{BSTR value;Bstr(const wchar_t* s):value(SysAllocString(s)){}~Bstr(){SysFreeString(value);}operator BSTR()const{return value;}};
class Wmi{
 ComPtr<IWbemServices> services;
 public:
 bool connect(){if(services)return true;ComPtr<IWbemLocator> locator;if(FAILED(CoCreateInstance(CLSID_WbemLocator,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&locator))))return false;if(FAILED(locator->ConnectServer(Bstr(L"ROOT\\WMI"),nullptr,nullptr,nullptr,0,nullptr,nullptr,&services)))return false;return SUCCEEDED(CoSetProxyBlanket(services.Get(),RPC_C_AUTHN_WINNT,RPC_C_AUTHZ_NONE,nullptr,RPC_C_AUTHN_LEVEL_CALL,RPC_C_IMP_LEVEL_IMPERSONATE,nullptr,EOAC_NONE));}
 std::vector<ComPtr<IWbemClassObject>> query(const wchar_t* query){std::vector<ComPtr<IWbemClassObject>> rows;if(!connect())return rows;ComPtr<IEnumWbemClassObject> list;if(FAILED(services->ExecQuery(Bstr(L"WQL"),Bstr(query),WBEM_FLAG_FORWARD_ONLY|WBEM_FLAG_RETURN_IMMEDIATELY,nullptr,&list)))return rows;for(int i=0;i<32;i++){ComPtr<IWbemClassObject> row;ULONG count=0;if(list->Next(1200,1,&row,&count)!=S_OK||!count)break;rows.push_back(row);}return rows;}
 static std::wstring text(IWbemClassObject* row,const wchar_t* key){VARIANT v;VariantInit(&v);row->Get(key,0,&v,nullptr,nullptr);std::wstring result=v.vt==VT_BSTR&&v.bstrVal?v.bstrVal:L"";VariantClear(&v);return result;}
 static int number(IWbemClassObject* row,const wchar_t* key){VARIANT v;VariantInit(&v);row->Get(key,0,&v,nullptr,nullptr);int n=v.vt==VT_UI1?v.bVal:v.vt==VT_I4?v.lVal:v.vt==VT_UI4?(int)v.ulVal:-1;VariantClear(&v);return n;}
 bool write(const std::wstring& path,int value){
  ComPtr<IWbemClassObject> type,input,args,reply;
  if(FAILED(services->GetObject(Bstr(L"WmiMonitorBrightnessMethods"),0,nullptr,&type,nullptr))||
     FAILED(type->GetMethod(L"WmiSetBrightness",0,&input,nullptr))||
     FAILED(input->SpawnInstance(0,&args)))return false;
  VARIANT timeout;VariantInit(&timeout);timeout.vt=VT_BSTR;timeout.bstrVal=SysAllocString(L"0");
  HRESULT hr=args->Put(L"Timeout",0,&timeout,CIM_UINT32);VariantClear(&timeout);
  VARIANT brightness;VariantInit(&brightness);brightness.vt=VT_UI1;brightness.bVal=(BYTE)value;
  if(FAILED(hr)||FAILED(args->Put(L"Brightness",0,&brightness,CIM_UINT8)))return false;
  hr=services->ExecMethod(Bstr(path.c_str()),Bstr(L"WmiSetBrightness"),0,nullptr,args.Get(),&reply,nullptr);
  if(FAILED(hr))return false;
  // Some drivers complete the call without an output object, despite the
  // method declaring a Boolean return value.
  if(!reply)return true;
  VARIANT result;VariantInit(&result);hr=reply->Get(L"ReturnValue",0,&result,nullptr,nullptr);
  const bool ok=FAILED(hr)||result.vt==VT_EMPTY||result.vt==VT_NULL||
    (result.vt==VT_BOOL&&result.boolVal==VARIANT_TRUE)||
    (result.vt==VT_UI4&&result.ulVal==0)||(result.vt==VT_I4&&result.lVal==0);
  VariantClear(&result);return ok;
 }
};
