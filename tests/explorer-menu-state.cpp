#include "../native/explorer-menu.cpp"
#include <fstream>
#include <cassert>
class Item final:public IShellItem {
 std::atomic<ULONG> refs{1};std::wstring path;bool folder;
public:Item(std::wstring p,bool f):path(std::move(p)),folder(f){}
 HRESULT __stdcall QueryInterface(REFIID id,void** out) override{*out=nullptr;if(id!=IID_IUnknown&&id!=IID_IShellItem)return E_NOINTERFACE;*out=this;AddRef();return S_OK;}
 ULONG __stdcall AddRef() override{return ++refs;}ULONG __stdcall Release() override{const auto n=--refs;if(!n)delete this;return n;}
 HRESULT __stdcall BindToHandler(IBindCtx*,REFGUID,REFIID,void**) override{return E_NOTIMPL;}
 HRESULT __stdcall GetParent(IShellItem**) override{return E_NOTIMPL;}
 HRESULT __stdcall GetDisplayName(SIGDN kind,PWSTR* out) override{return kind==SIGDN_FILESYSPATH?SHStrDupW(path.c_str(),out):E_NOTIMPL;}
 HRESULT __stdcall GetAttributes(SFGAOF mask,SFGAOF* out) override{*out=folder?(mask&SFGAO_FOLDER):0;return S_OK;}
 HRESULT __stdcall Compare(IShellItem*,SICHINTF,int*) override{return E_NOTIMPL;}
};
class Items final:public IShellItemArray {
 DWORD count;std::vector<std::wstring> paths;bool folder=false;
public:explicit Items(DWORD n):count(n){}Items(std::vector<std::wstring> p,bool f=false):count((DWORD)p.size()),paths(std::move(p)),folder(f){}
 HRESULT __stdcall QueryInterface(REFIID,void**) override{return E_NOINTERFACE;}
 ULONG __stdcall AddRef() override{return 1;}ULONG __stdcall Release() override{return 1;}
 HRESULT __stdcall BindToHandler(IBindCtx*,REFGUID,REFIID,void**) override{return E_NOTIMPL;}
 HRESULT __stdcall GetPropertyStore(GETPROPERTYSTOREFLAGS,REFIID,void**) override{return E_NOTIMPL;}
 HRESULT __stdcall GetPropertyDescriptionList(REFPROPERTYKEY,REFIID,void**) override{return E_NOTIMPL;}
 HRESULT __stdcall GetAttributes(SIATTRIBFLAGS,SFGAOF,SFGAOF*) override{return E_NOTIMPL;}
 HRESULT __stdcall GetCount(DWORD* out) override{*out=count;return S_OK;}
 HRESULT __stdcall GetItemAt(DWORD index,IShellItem** out) override{if(index>=count)return E_INVALIDARG;*out=new Item(paths.empty()?L"D:\\中文.zip":paths[index],folder);return S_OK;}
 HRESULT __stdcall EnumItems(IEnumShellItems**) override{return E_NOTIMPL;}
};
int wmain(){
 assert(archive_path(L"D:\\split.a00")&&archive_path(L"D:\\split.B00")&&archive_path(L"D:\\split.k22"));
 assert(!archive_path(L"D:\\split.l00")&&!archive_path(L"D:\\split.a0"));
 wchar_t module[32768];GetModuleFileNameW(nullptr,module,32768);std::wstring file(module);file=file.substr(0,file.find_last_of(L"\\/"))+L"\\shell-config.bin";
 auto config=[&](bool enabled){const wchar_t* fields[]={L"",L"",L"",L"",enabled?L"1":L"0",enabled?L"1":L"0",enabled?L"1":L"0",enabled?L"1":L"0"};std::ofstream stream(file,std::ios::binary);for(auto value:fields)stream.write((const char*)value,(wcslen(value)+1)*sizeof(wchar_t));};
 config(true);
 {
 Command locks(Action::locksmith),rename(Action::rename),archive(Action::archiveExtract),create(Action::archiveCreate);EXPCMDSTATE state;
 Items empty(0),one(1),many(33),limit(4096),over(4097),archives(128),archiveOver(129),mixed({L"D:\\ok.zip",L"D:\\bad.exe"}),folder({L"D:\\folder.zip"},true),formats({L"D:\\中文.ZIP",L"D:\\a.7z.001",L"D:\\a.tar.gz",L"D:\\a.RAR"});
 PWSTR name=nullptr;assert(locks.GetTitle(nullptr,&name)==S_OK&&wcscmp(name,L"文件占用")==0);CoTaskMemFree(name);assert(rename.GetTitle(nullptr,&name)==S_OK&&wcscmp(name,L"批量重命名")==0);CoTaskMemFree(name);
 assert(locks.GetState(nullptr,FALSE,&state)==S_OK&&state==ECS_ENABLED);assert(locks.Invoke(nullptr,nullptr)==E_INVALIDARG);assert(locks.GetState(&one,FALSE,nullptr)==E_POINTER);
 assert(locks.GetState(&empty,FALSE,&state)==S_OK&&state==ECS_HIDDEN);assert(locks.GetState(&one,FALSE,&state)==S_OK&&state==ECS_ENABLED);assert(locks.GetState(&many,FALSE,&state)==S_OK&&state==ECS_HIDDEN);
 assert(rename.GetState(&limit,FALSE,&state)==S_OK&&state==ECS_ENABLED);assert(rename.GetState(&over,FALSE,&state)==S_OK&&state==ECS_HIDDEN);
 assert(archive.GetState(&archives,FALSE,&state)==S_OK&&state==ECS_ENABLED);assert(archive.GetState(&archiveOver,FALSE,&state)==S_OK&&state==ECS_HIDDEN);
 assert(archive.GetState(&mixed,FALSE,&state)==S_OK&&state==ECS_HIDDEN);assert(archive.GetState(&folder,FALSE,&state)==S_OK&&state==ECS_HIDDEN);assert(archive.GetState(&formats,FALSE,&state)==S_OK&&state==ECS_ENABLED);assert(archive.Invoke(&mixed,nullptr)==E_INVALIDARG);
 EXPCMDFLAGS flags;assert(archive.GetFlags(&flags)==S_OK&&flags==ECF_HASSUBCOMMANDS);assert(archive.GetFlags(nullptr)==E_POINTER);
 IEnumExplorerCommand *commands=nullptr,*clone=nullptr;assert(archive.EnumSubCommands(&commands)==S_OK);assert(archive.EnumSubCommands(nullptr)==E_POINTER);IExplorerCommand* children[5]{};ULONG fetched=0;
 assert(commands->Next(2,children,&fetched)==S_OK&&fetched==2);assert(commands->Clone(&clone)==S_OK);assert(clone->Skip(1)==S_OK);assert(clone->Next(1,children+3,nullptr)==S_OK);assert(clone->Next(1,children+4,&fetched)==S_FALSE&&fetched==0);clone->Release();
 assert(commands->Next(1,children+2,&fetched)==S_OK&&fetched==1);assert(commands->Skip(2)==S_FALSE);assert(commands->Reset()==S_OK);
 GUID names[4]{};const wchar_t* titles[]={L"智能解压",L"解压到当前文件夹",L"解压到同名文件夹",L"选择解压路径…"};
 for(unsigned i=0;i<4;i++){assert(children[i]->GetTitle(nullptr,&name)==S_OK&&wcscmp(name,titles[i])==0);CoTaskMemFree(name);assert(children[i]->GetCanonicalName(&names[i])==S_OK);for(unsigned j=0;j<i;j++)assert(names[i]!=names[j]);assert(children[i]->GetFlags(&flags)==S_OK&&flags==ECF_DEFAULT);assert(children[i]->GetState(&formats,FALSE,&state)==S_OK&&state==ECS_ENABLED);children[i]->Release();}
 assert(commands->Next(5,children,&fetched)==S_FALSE&&fetched==4);for(unsigned i=0;i<fetched;i++)children[i]->Release();commands->Release();
 assert(create.GetFlags(&flags)==S_OK&&flags==ECF_HASSUBCOMMANDS);
 IEnumExplorerCommand* createCommands=nullptr;assert(create.EnumSubCommands(&createCommands)==S_OK);
 IExplorerCommand* createChildren[3]{};assert(createCommands->Next(3,createChildren,&fetched)==S_OK&&fetched==3);
 const wchar_t* createTitles[]={L"压缩为 中文.zip",L"压缩为 中文.7z",L"创建压缩包…"};Items singleArchive({L"D:\\中文.ZIP"});
 for(unsigned i=0;i<3;i++){assert(createChildren[i]->GetTitle(&singleArchive,&name)==S_OK&&wcscmp(name,createTitles[i])==0);CoTaskMemFree(name);createChildren[i]->Release();}
 createCommands->Release();
 assert(std::string(tool(Action::archiveZip))=="archive-create-zip");assert(std::string(tool(Action::archiveSeven))=="archive-create-7z");
 assert(std::string(tool(Action::archiveSmart))=="archive-smart");assert(std::string(tool(Action::archiveHere))=="archive-here");assert(std::string(tool(Action::archiveFolder))=="archive-folder");assert(std::string(tool(Action::archiveChoose))=="archive-choose");
 config(false);assert(locks.GetState(nullptr,FALSE,&state)==S_OK&&state==ECS_HIDDEN);assert(rename.GetState(&one,FALSE,&state)==S_OK&&state==ECS_HIDDEN);assert(archive.GetState(&formats,FALSE,&state)==S_OK&&state==ECS_HIDDEN);
 }
 assert(DllCanUnloadNow()==S_OK);DeleteFileW(file.c_str());return 0;
}
