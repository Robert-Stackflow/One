#include "../native/explorer-menu.cpp"
#include <fstream>
#include <cassert>
class Items final:public IShellItemArray {
 DWORD count;
public:explicit Items(DWORD n):count(n){}
 HRESULT __stdcall QueryInterface(REFIID,void**) override{return E_NOINTERFACE;}
 ULONG __stdcall AddRef() override{return 1;}ULONG __stdcall Release() override{return 1;}
 HRESULT __stdcall BindToHandler(IBindCtx*,REFGUID,REFIID,void**) override{return E_NOTIMPL;}
 HRESULT __stdcall GetPropertyStore(GETPROPERTYSTOREFLAGS,REFIID,void**) override{return E_NOTIMPL;}
 HRESULT __stdcall GetPropertyDescriptionList(REFPROPERTYKEY,REFIID,void**) override{return E_NOTIMPL;}
 HRESULT __stdcall GetAttributes(SIATTRIBFLAGS,SFGAOF,SFGAOF*) override{return E_NOTIMPL;}
 HRESULT __stdcall GetCount(DWORD* out) override{*out=count;return S_OK;}
 HRESULT __stdcall GetItemAt(DWORD,IShellItem**) override{return E_NOTIMPL;}
 HRESULT __stdcall EnumItems(IEnumShellItems**) override{return E_NOTIMPL;}
};
int wmain(){
 // The executable and configuration live in an isolated verification directory.
 wchar_t module[32768];GetModuleFileNameW(nullptr,module,32768);std::wstring file(module);file=file.substr(0,file.find_last_of(L"\\/"))+L"\\shell-config.bin";
 auto config=[&](bool enabled){const wchar_t* fields[]={L"",L"",L"",L"",enabled?L"1":L"0",enabled?L"1":L"0"};std::ofstream stream(file,std::ios::binary);for(auto value:fields)stream.write((const char*)value,(wcslen(value)+1)*sizeof(wchar_t));};
 config(true);Command locks(false),rename(true);EXPCMDSTATE state;Items empty(0),one(1),many(33),limit(4096),over(4097);
 PWSTR title=nullptr;assert(locks.GetTitle(nullptr,&title)==S_OK&&wcscmp(title,L"文件占用")==0);CoTaskMemFree(title);assert(rename.GetTitle(nullptr,&title)==S_OK&&wcscmp(title,L"批量重命名")==0);CoTaskMemFree(title);
 assert(locks.GetState(nullptr,FALSE,&state)==S_OK&&state==ECS_ENABLED);assert(locks.Invoke(nullptr,nullptr)==E_INVALIDARG);assert(locks.GetState(&one,FALSE,nullptr)==E_POINTER);
 assert(locks.GetState(&empty,FALSE,&state)==S_OK&&state==ECS_HIDDEN);assert(locks.GetState(&one,FALSE,&state)==S_OK&&state==ECS_ENABLED);assert(locks.GetState(&many,FALSE,&state)==S_OK&&state==ECS_HIDDEN);
 assert(rename.GetState(&limit,FALSE,&state)==S_OK&&state==ECS_ENABLED);assert(rename.GetState(&over,FALSE,&state)==S_OK&&state==ECS_HIDDEN);
 config(false);assert(locks.GetState(nullptr,FALSE,&state)==S_OK&&state==ECS_HIDDEN);assert(rename.GetState(&one,FALSE,&state)==S_OK&&state==ECS_HIDDEN);DeleteFileW(file.c_str());return 0;
}
