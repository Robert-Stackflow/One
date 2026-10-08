#include <windows.h>
#include <ole2.h>
#include <shlobj.h>
#include <shldisp.h>
#include <shlwapi.h>
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <cwctype>
#include <future>
#include <map>
#include <memory>
#include <stdexcept>
#include "zip-common.h"

// The helper owns one OLE drag and stays alive until the target has finished
// its asynchronous extraction AND released every contents stream. Electron
// never enters an OLE nested loop or receives uncompressed file buffers.
namespace {
std::atomic<bool> cancelled{false};
std::atomic<bool> poll_escape{false};
std::wstring key(std::wstring value) {
    while(!value.empty()&&(value.back()==L'/'||value.back()==L'\\'))value.pop_back();
    std::transform(value.begin(),value.end(),value.begin(),[](wchar_t c){return std::towlower(c==L'/'?L'\\':c);});
    return value;
}
void pump() {
    MsgWaitForMultipleObjects(0,nullptr,FALSE,15,QS_ALLINPUT);
    MSG message;while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)){TranslateMessage(&message);DispatchMessageW(&message);}
}
uint32_t input_u32(){uint32_t value=0;if(std::fread(&value,4,1,stdin)!=1)fail("Incomplete drag selection");return value;}
struct SourceLock {
    HANDLE value=INVALID_HANDLE_VALUE;
    explicit SourceLock(const fs::path &path):value(CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,
        OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,nullptr)) {
        if(value==INVALID_HANDLE_VALUE)fail("Cannot lock archive for drag; close other writers");
        BY_HANDLE_FILE_INFORMATION info{};
        if(!GetFileInformationByHandle(value,&info)||(info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))){
            CloseHandle(value);value=INVALID_HANDLE_VALUE;fail("Archive source must be a regular file");
        }
    }
    ~SourceLock(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
};
struct InputLink {
    DWORD current=GetCurrentThreadId(),source=0;bool attached=false;
    explicit InputLink(HWND owner){
        if(!owner||owner!=GetForegroundWindow())fail("Drag source is no longer the foreground window; try again");
        source=GetWindowThreadProcessId(owner,nullptr);
        if(source&&source!=current){attached=AttachThreadInput(current,source,TRUE)!=FALSE;if(!attached)fail("Cannot attach Windows drag input");}
    }
    ~InputLink(){if(attached)AttachThreadInput(current,source,FALSE);}
};
struct DragItem {fs::path original;std::wstring name;bool directory;uint64_t size;};
struct Selection {std::vector<DragItem> items;std::set<size_t> indexes;size_t roots=0;};
Selection select(const std::vector<Entry> &entries,const std::set<size_t> &selected) {
    if(selected.empty()||*selected.rbegin()>=entries.size())fail("Invalid drag selection");
    std::vector<const Entry*> roots;std::set<std::wstring> selected_folders;
    for(size_t index:selected)if(entries[index].directory)selected_folders.insert(key(entry_path(entries[index].name).wstring()));
    auto inside_selected=[&](const fs::path &path){for(auto parent=path.parent_path();!parent.empty();parent=parent.parent_path())if(selected_folders.contains(key(parent.wstring())))return true;return false;};
    for(size_t index:selected){
        const auto &entry=entries[index];auto path=entry_path(entry.name);if(path.filename().empty())path=path.parent_path();
        if(!inside_selected(path))roots.push_back(&entry);
    }
    fs::path common=entry_path(roots.front()->name).lexically_normal();
    // entry_path preserves a trailing slash on directory entries.
    if(common.filename().empty())common=common.parent_path();
    common=common.parent_path();
    for(const auto *root:roots){
        auto parent=entry_path(root->name);if(parent.filename().empty())parent=parent.parent_path();parent=parent.parent_path();
        while(!common.empty()&&key(parent.wstring())!=key(common.wstring())&&!key(parent.wstring()).starts_with(key(common.wstring())+L'\\'))common=common.parent_path();
    }
    std::map<std::wstring,DragItem> mapped;
    Selection result;result.roots=roots.size();
    for(const auto &entry:entries){
        auto original=entry_path(entry.name);original.make_preferred();auto clean=original;if(clean.filename().empty())clean=clean.parent_path();
        const bool included=selected.contains(entry.index)||inside_selected(clean);
        if(!included)continue;
        result.indexes.insert(entry.index);
        fs::path name=common.empty()?clean:fs::path(clean.wstring().substr(common.wstring().size()+1));
        if(!safe_entry(utf8(name.wstring()),entry.directory))fail("Invalid drag output path");
        if(name.wstring().size()>=MAX_PATH)fail("Drag path is too long; extract these entries instead");
        const auto mapped_key=key(name.wstring());
        auto existing=mapped.find(mapped_key);
        if(existing!=mapped.end()&&(!existing->second.directory||!entry.directory))fail("Archive contains conflicting drag paths");
        mapped[mapped_key]={clean,name.wstring(),entry.directory,entry.size};
        for(auto parent=name.parent_path(),source_parent=clean.parent_path();!parent.empty();parent=parent.parent_path(),source_parent=source_parent.parent_path()){
            const auto parent_key=key(parent.wstring());auto found=mapped.find(parent_key);
            if(found!=mapped.end()&&!found->second.directory)fail("Archive path descends from a file");
            if(found==mapped.end())mapped[parent_key]={source_parent,parent.wstring(),true,0};
        }
        if(mapped.size()>65536)fail("Too many drag entries; extract or drag smaller groups");
    }
    for(auto &[unused,item]:mapped)result.items.push_back(std::move(item));
    return result;
}
struct Lifetime {std::atomic<size_t> streams{0};};
class Contents final:public IStream {
    std::atomic<ULONG> refs{1};IStream *inner;std::shared_ptr<Lifetime> lifetime;fs::path file;
public:
    Contents(IStream *stream,std::shared_ptr<Lifetime> state,fs::path file={}):inner(stream),lifetime(std::move(state)),file(std::move(file)){++lifetime->streams;}
    ~Contents(){inner->Release();--lifetime->streams;}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out) override {
        if(!out)return E_POINTER;*out=nullptr;
        if(id==IID_IUnknown||id==IID_ISequentialStream||id==IID_IStream){*out=static_cast<IStream*>(this);AddRef();return S_OK;}return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release() override{auto value=--refs;if(!value)delete this;return value;}
    HRESULT STDMETHODCALLTYPE Read(void *data,ULONG bytes,ULONG *done) override{return inner->Read(data,bytes,done);}
    HRESULT STDMETHODCALLTYPE Write(const void*,ULONG,ULONG*) override{return STG_E_ACCESSDENIED;}
    HRESULT STDMETHODCALLTYPE Seek(LARGE_INTEGER delta,DWORD origin,ULARGE_INTEGER *at) override{return inner->Seek(delta,origin,at);}
    HRESULT STDMETHODCALLTYPE SetSize(ULARGE_INTEGER) override{return STG_E_ACCESSDENIED;}
    HRESULT STDMETHODCALLTYPE CopyTo(IStream *target,ULARGE_INTEGER bytes,ULARGE_INTEGER *read,ULARGE_INTEGER *written) override{return inner->CopyTo(target,bytes,read,written);}
    HRESULT STDMETHODCALLTYPE Commit(DWORD) override{return S_OK;}
    HRESULT STDMETHODCALLTYPE Revert() override{return STG_E_ACCESSDENIED;}
    HRESULT STDMETHODCALLTYPE LockRegion(ULARGE_INTEGER,ULARGE_INTEGER,DWORD) override{return STG_E_INVALIDFUNCTION;}
    HRESULT STDMETHODCALLTYPE UnlockRegion(ULARGE_INTEGER,ULARGE_INTEGER,DWORD) override{return STG_E_INVALIDFUNCTION;}
    HRESULT STDMETHODCALLTYPE Stat(STATSTG *stat,DWORD flags) override{return inner->Stat(stat,flags);}
    HRESULT STDMETHODCALLTYPE Clone(IStream **out) override {
        if(!out)return E_POINTER;*out=nullptr;IStream *copy=nullptr;HRESULT code;
        if(file.empty())code=inner->Clone(&copy);
        else{
            ULARGE_INTEGER position{};LARGE_INTEGER zero{};
            code=inner->Seek(zero,STREAM_SEEK_CUR,&position);if(FAILED(code))return code;
            code=SHCreateStreamOnFileEx(file.c_str(),STGM_READ|STGM_SHARE_DENY_WRITE,0,FALSE,nullptr,&copy);
            if(SUCCEEDED(code)){LARGE_INTEGER at{};at.QuadPart=(LONGLONG)position.QuadPart;code=copy->Seek(at,STREAM_SEEK_SET,nullptr);if(FAILED(code)){copy->Release();return code;}}
        }
        if(SUCCEEDED(code))*out=new Contents(copy,lifetime,file);return code;
    }
};
class DragData final:public IDataObject,public IDataObjectAsyncCapability {
    std::atomic<ULONG> refs{1};std::atomic<bool> async{true},running{false};
    std::shared_future<void> prepared;
    fs::path source,stage;int encoding,format;std::string password;
    std::atomic<HRESULT> outcome{S_OK};std::atomic<DWORD> effect{DROPEFFECT_NONE};
    std::string failure;
public:
    Selection selection;std::shared_ptr<Lifetime> lifetime=std::make_shared<Lifetime>();
    CLIPFORMAT descriptors=(CLIPFORMAT)RegisterClipboardFormatW(CFSTR_FILEDESCRIPTORW);
    CLIPFORMAT contents=(CLIPFORMAT)RegisterClipboardFormatW(CFSTR_FILECONTENTS);
    CLIPFORMAT preferred=(CLIPFORMAT)RegisterClipboardFormatW(CFSTR_PREFERREDDROPEFFECT);
    CLIPFORMAT performed=(CLIPFORMAT)RegisterClipboardFormatW(CFSTR_PERFORMEDDROPEFFECT);
    CLIPFORMAT logical=(CLIPFORMAT)RegisterClipboardFormatW(CFSTR_LOGICALPERFORMEDDROPEFFECT);
    DragData(fs::path source,fs::path stage,int encoding,int format,std::string password,Selection selection):
        source(std::move(source)),stage(std::move(stage)),encoding(encoding),format(format),password(std::move(password)),selection(std::move(selection)){}
    void prepare() {
        if(!prepared.valid())prepared=std::async(std::launch::async,[source=source,stage=stage,encoding=encoding,format=format,password=password,selected=selection.indexes]{
            if(archive_cancelled())fail("Archive drag cancelled");
            if(format==0){Reader reader(source,encoding);zip_extract(reader,zip_entries(reader),stage,selected,password,false);}
            else seven_extract(source,stage,selected,password,format,false);
        }).share();
        while(prepared.wait_for(std::chrono::milliseconds(0))!=std::future_status::ready)pump();
        prepared.get();
    }
    void drain(){if(prepared.valid()){while(prepared.wait_for(std::chrono::milliseconds(0))!=std::future_status::ready)pump();try{prepared.get();}catch(const std::exception &e){failure=e.what();}}}
    bool pending() const{return running||lifetime->streams>0;}
    std::string error()const{return failure;}
    HRESULT result() const{return outcome;}
    DWORD result_effect() const{return effect;}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out) override {
        if(!out)return E_POINTER;*out=nullptr;
        if(id==IID_IUnknown||id==IID_IDataObject)*out=static_cast<IDataObject*>(this);
        else if(id==__uuidof(IDataObjectAsyncCapability))*out=static_cast<IDataObjectAsyncCapability*>(this);
        if(!*out)return E_NOINTERFACE;AddRef();return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release() override{auto value=--refs;if(!value)delete this;return value;}
    HRESULT STDMETHODCALLTYPE QueryGetData(FORMATETC *request) override {
        if(!request)return E_POINTER;if(request->dwAspect!=DVASPECT_CONTENT)return DV_E_DVASPECT;
        if(request->ptd)return DV_E_DVTARGETDEVICE;
        if(request->cfFormat==contents){if(!(request->tymed&TYMED_ISTREAM))return DV_E_TYMED;if(request->lindex<0||size_t(request->lindex)>=selection.items.size())return DV_E_LINDEX;return S_OK;}
        if(request->cfFormat==descriptors||request->cfFormat==preferred){if(!(request->tymed&TYMED_HGLOBAL))return DV_E_TYMED;return request->lindex==-1?S_OK:DV_E_LINDEX;}
        return DV_E_FORMATETC;
    }
    HRESULT STDMETHODCALLTYPE GetData(FORMATETC *request,STGMEDIUM *out) override {
        if(!out)return E_POINTER;*out={};auto checked=QueryGetData(request);if(FAILED(checked))return checked;
        try {
            if(request->cfFormat==contents){
                const auto &item=selection.items[request->lindex];IStream *stream=nullptr;HRESULT code;
                if(item.directory)code=CreateStreamOnHGlobal(nullptr,TRUE,&stream);
                else{prepare();code=SHCreateStreamOnFileEx((stage/item.original).c_str(),STGM_READ|STGM_SHARE_DENY_WRITE,0,FALSE,nullptr,&stream);}
                if(FAILED(code))return code;out->tymed=TYMED_ISTREAM;out->pstm=new Contents(stream,lifetime,item.directory?fs::path{}:stage/item.original);return S_OK;
            }
            size_t bytes=request->cfFormat==preferred?sizeof(DWORD):offsetof(FILEGROUPDESCRIPTORW,fgd)+selection.items.size()*sizeof(FILEDESCRIPTORW);
            auto memory=GlobalAlloc(GMEM_MOVEABLE|GMEM_ZEROINIT,bytes);if(!memory)return E_OUTOFMEMORY;
            auto data=GlobalLock(memory);if(!data){GlobalFree(memory);return E_OUTOFMEMORY;}
            if(request->cfFormat==preferred)*static_cast<DWORD*>(data)=DROPEFFECT_COPY;
            else{
                auto group=static_cast<FILEGROUPDESCRIPTORW*>(data);group->cItems=(UINT)selection.items.size();
                for(size_t i=0;i<selection.items.size();++i){const auto &item=selection.items[i];auto &desc=group->fgd[i];
                    desc.dwFlags=FD_ATTRIBUTES|FD_UNICODE|FD_PROGRESSUI;
                    desc.dwFileAttributes=item.directory?FILE_ATTRIBUTE_DIRECTORY:FILE_ATTRIBUTE_NORMAL;
                    if(!item.directory){desc.dwFlags|=FD_FILESIZE;desc.nFileSizeHigh=(DWORD)(item.size>>32);desc.nFileSizeLow=(DWORD)item.size;}
                    wcscpy_s(desc.cFileName,item.name.c_str());
                }
            }
            GlobalUnlock(memory);out->tymed=TYMED_HGLOBAL;out->hGlobal=memory;return S_OK;
        }catch(const std::exception &error){failure=error.what();return STG_E_READFAULT;}
        catch(...){failure="Cannot prepare archive drag contents";return E_FAIL;}
    }
    HRESULT STDMETHODCALLTYPE GetDataHere(FORMATETC*,STGMEDIUM*) override{return DATA_E_FORMATETC;}
    HRESULT STDMETHODCALLTYPE GetCanonicalFormatEtc(FORMATETC*,FORMATETC *out) override{if(out)out->ptd=nullptr;return E_NOTIMPL;}
    HRESULT STDMETHODCALLTYPE SetData(FORMATETC *request,STGMEDIUM *value,BOOL release) override {
        if(!request||!value)return E_POINTER;
        if((request->cfFormat!=performed&&request->cfFormat!=logical)||value->tymed!=TYMED_HGLOBAL||GlobalSize(value->hGlobal)<sizeof(DWORD))return DV_E_FORMATETC;
        const auto data=static_cast<DWORD*>(GlobalLock(value->hGlobal));if(!data)return E_OUTOFMEMORY;
        effect=*data;GlobalUnlock(value->hGlobal);if(release)ReleaseStgMedium(value);return S_OK;
    }
    HRESULT STDMETHODCALLTYPE EnumFormatEtc(DWORD direction,IEnumFORMATETC **out) override {
        if(direction!=DATADIR_GET)return E_NOTIMPL;
        FORMATETC formats[]={{descriptors,nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL},{contents,nullptr,DVASPECT_CONTENT,-1,TYMED_ISTREAM},{preferred,nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL}};
        return SHCreateStdEnumFmtEtc(3,formats,out);
    }
    HRESULT STDMETHODCALLTYPE DAdvise(FORMATETC*,DWORD,IAdviseSink*,DWORD*) override{return OLE_E_ADVISENOTSUPPORTED;}
    HRESULT STDMETHODCALLTYPE DUnadvise(DWORD) override{return OLE_E_ADVISENOTSUPPORTED;}
    HRESULT STDMETHODCALLTYPE EnumDAdvise(IEnumSTATDATA**) override{return OLE_E_ADVISENOTSUPPORTED;}
    HRESULT STDMETHODCALLTYPE SetAsyncMode(BOOL value) override{async=value!=FALSE;return S_OK;}
    HRESULT STDMETHODCALLTYPE GetAsyncMode(BOOL *value) override{if(!value)return E_POINTER;*value=async;return S_OK;}
    HRESULT STDMETHODCALLTYPE StartOperation(IBindCtx*) override{running=true;poll_escape=false;return S_OK;}
    HRESULT STDMETHODCALLTYPE InOperation(BOOL *value) override{if(!value)return E_POINTER;*value=running;return S_OK;}
    HRESULT STDMETHODCALLTYPE EndOperation(HRESULT code,IBindCtx*,DWORD effects) override{outcome=code;effect=effects;running=false;return S_OK;}
};
class DragSource final:public IDropSource {
    std::atomic<ULONG> refs{1};
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out) override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IDropSource){*out=this;AddRef();return S_OK;}return E_NOINTERFACE;}
    ULONG STDMETHODCALLTYPE AddRef() override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release() override{auto value=--refs;if(!value)delete this;return value;}
    HRESULT STDMETHODCALLTYPE QueryContinueDrag(BOOL escape,DWORD keys) override {
        if(escape||archive_cancelled()||(GetAsyncKeyState(VK_ESCAPE)&0x8000)){cancelled=true;return DRAGDROP_S_CANCEL;}
        // Attaching the helper's input queue resets GetKeyState. The physical
        // button remains authoritative while the native OLE loop takes over.
        return GetAsyncKeyState(VK_LBUTTON)&0x8000?S_OK:DRAGDROP_S_DROP;
    }
    HRESULT STDMETHODCALLTYPE GiveFeedback(DWORD) override{return DRAGDROP_S_USEDEFAULTCURSORS;}
};
void marshal_test(DragData *data) {
    IStream *packet=nullptr;
    if(FAILED(CoMarshalInterThreadInterfaceInStream(IID_IDataObject,static_cast<IDataObject*>(data),&packet)))fail("Cannot marshal drag data object");
    const auto descriptors=data->descriptors,contents=data->contents;
    auto target=std::async(std::launch::async,[packet,descriptors,contents]{
        if(FAILED(CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED)))fail("Cannot initialize test drop target");
        IDataObject *object=nullptr;IDataObjectAsyncCapability *async=nullptr;STGMEDIUM medium{};bool running=false;
        try{
            if(FAILED(CoGetInterfaceAndReleaseStream(packet,IID_IDataObject,reinterpret_cast<void**>(&object))))fail("Cannot unmarshal drag data object");
            if(FAILED(object->QueryInterface(__uuidof(IDataObjectAsyncCapability),reinterpret_cast<void**>(&async))))fail("Cannot marshal async drag capability");
            if(FAILED(async->StartOperation(nullptr)))fail("Cannot begin async drop");running=true;
            FORMATETC format{descriptors,nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL};
            if(FAILED(object->GetData(&format,&medium)))fail("Cannot marshal drag descriptors");
            auto group=static_cast<FILEGROUPDESCRIPTORW*>(GlobalLock(medium.hGlobal));LONG file=-1;uint64_t size=0;
            for(UINT i=0;i<group->cItems;++i)if(!(group->fgd[i].dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)){file=(LONG)i;size=(uint64_t(group->fgd[i].nFileSizeHigh)<<32)|group->fgd[i].nFileSizeLow;break;}
            GlobalUnlock(medium.hGlobal);ReleaseStgMedium(&medium);medium={};
            if(file>=0){
                format={contents,nullptr,DVASPECT_CONTENT,file,TYMED_ISTREAM};
                if(FAILED(object->GetData(&format,&medium)))fail("Cannot marshal drag contents stream");
                // Some targets finish the async operation before releasing
                // their last stream. Both are independent cleanup conditions.
                if(FAILED(async->EndOperation(S_OK,nullptr,DROPEFFECT_COPY)))fail("Cannot end async drop");running=false;
                uint64_t bytes=0;char buffer[65536];ULONG got=0;HRESULT code;
                while((code=medium.pstm->Read(buffer,sizeof(buffer),&got))==S_OK||code==S_FALSE){bytes+=got;if(code==S_FALSE||!got)break;}
                if(FAILED(code)||bytes!=size)fail("Marshalled stream returned invalid contents");
                ReleaseStgMedium(&medium);medium={};
            }
            if(running){async->EndOperation(S_OK,nullptr,DROPEFFECT_COPY);running=false;}
            async->Release();object->Release();CoUninitialize();
        }catch(...){if(medium.tymed)ReleaseStgMedium(&medium);if(running&&async)async->EndOperation(E_ABORT,nullptr,DROPEFFECT_NONE);if(async)async->Release();if(object)object->Release();CoUninitialize();throw;}
    });
    while(target.wait_for(std::chrono::milliseconds(0))!=std::future_status::ready)pump();
    target.get();
    while(data->pending())pump();
}
void selftest(DragData *data,bool report_entries) {
    BOOL active=FALSE;data->StartOperation(nullptr);data->InOperation(&active);if(!active)fail("Async drag state is invalid");
    FORMATETC format{data->descriptors,nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL};STGMEDIUM medium{};
    if(FAILED(data->GetData(&format,&medium)))fail("Cannot read drag descriptors");
    auto group=static_cast<FILEGROUPDESCRIPTORW*>(GlobalLock(medium.hGlobal));
    if(group->cItems!=data->selection.items.size())fail("Invalid descriptor count");
    for(size_t i=0;i<group->cItems;++i)if(std::wstring(group->fgd[i].cFileName)!=data->selection.items[i].name)fail("Invalid descriptor name");
    GlobalUnlock(medium.hGlobal);ReleaseStgMedium(&medium);
    IStream *retained=nullptr;
    for(size_t i=0;i<data->selection.items.size();++i){
        const auto &item=data->selection.items[i];
        if(item.directory){if(report_entries)emit("{\"type\":\"drag-entry\",\"name\":"+json(utf8(item.name))+",\"directory\":true}");continue;}
        format={data->contents,nullptr,DVASPECT_CONTENT,(LONG)i,TYMED_ISTREAM};
        if(FAILED(data->GetData(&format,&medium)))fail(data->error().empty()?"Cannot read drag contents":data->error());
        uint64_t bytes=0,hash=14695981039346656037ull;unsigned char buffer[65536];ULONG got=0;HRESULT code;
        STATSTG info{};if(FAILED(medium.pstm->Stat(&info,STATFLAG_NONAME))||info.cbSize.QuadPart!=item.size)fail("Invalid stream size");
        while((code=medium.pstm->Read(buffer,sizeof(buffer),&got))==S_OK||code==S_FALSE){for(ULONG j=0;j<got;++j){hash^=buffer[j];hash*=1099511628211ull;}bytes+=got;if(code==S_FALSE||!got)break;}
        if(FAILED(code)||bytes!=item.size)fail("Invalid drag stream contents");
        if(!retained){if(FAILED(medium.pstm->Clone(&retained)))fail("Cannot clone drag stream");LARGE_INTEGER at{};if(FAILED(retained->Seek(at,STREAM_SEEK_SET,nullptr)))fail("Cannot seek drag stream");}
        ReleaseStgMedium(&medium);
        if(report_entries)emit("{\"type\":\"drag-entry\",\"name\":"+json(utf8(item.name))+",\"directory\":false,\"bytes\":"+std::to_string(bytes)+",\"hash\":"+json(std::to_string(hash))+"}");
    }
    data->EndOperation(S_OK,nullptr,DROPEFFECT_COPY);
    if(retained){if(!data->pending())fail("Drag cache released while a stream was retained");retained->Release();}
    if(data->pending())fail("Drag cache did not release its streams");
    marshal_test(data);
}
}
bool archive_cancelled(){if(poll_escape&&(GetAsyncKeyState(VK_ESCAPE)&0x8000))cancelled=true;return cancelled.load();}

void archive_drag(const fs::path &source,const fs::path &stage,int encoding,const std::string &revision,
                  const std::string &password,int format,bool testing,uintptr_t owner){
    wchar_t test_mode[2]{};GetEnvironmentVariableW(L"ONE_TEST_MODE",test_mode,2);
    if(testing&&std::wstring(test_mode)!=L"1")fail("Drag protocol test is disabled");
    if(fs::exists(stage))fail("Drag staging directory already exists");
    auto count=input_u32();if(!count||count>10000)fail("Select 1–10000 entries to drag");
    std::set<size_t> selected;for(uint32_t i=0;i<count;++i){auto value=input_u32();if(value>=1000000)fail("Invalid drag entry index");selected.insert(value);}
    SourceLock lock(source);if(zip_revision(source)!=revision)fail("Archive changed; reopen it before dragging");
    auto entries= [&]{if(format!=0)return seven_drag_entries(source,password,format);Reader reader(source,encoding);auto items=zip_entries(reader);zip_preflight(reader,items);return items;}();
    auto selection=select(entries,selected);
    if(FAILED(OleInitialize(nullptr)))fail("Cannot initialize Windows file drag");
    auto data=new DragData(source,stage,encoding,format,password,std::move(selection));
    auto drag_source=new DragSource;
    try {
        emit("{\"type\":\"ready\"}");
        unsigned char acknowledge=0;if(std::fread(&acknowledge,1,1,stdin)!=1||acknowledge!=1)fail("Archive drag was not acknowledged");
        DWORD effect=DROPEFFECT_NONE;HRESULT code=S_OK;
        if(testing||(std::wstring(test_mode)==L"1"&&GetEnvironmentVariableW(L"ONE_ARCHIVE_DRAG_TEST_TARGET",nullptr,0))){selftest(data,testing);effect=DROPEFFECT_COPY;}
        else if((std::wstring(test_mode)==L"1"&&GetEnvironmentVariableW(L"ONE_ARCHIVE_DRAG_TEST_CANCEL",nullptr,0))||!(GetAsyncKeyState(VK_LBUTTON)&0x8000))code=DRAGDROP_S_CANCEL;
        else{InputLink input(owner?reinterpret_cast<HWND>(owner):GetForegroundWindow());poll_escape=true;code=DoDragDrop(data,drag_source,DROPEFFECT_COPY,&effect);poll_escape=false;}
        const bool was_cancelled=code==DRAGDROP_S_CANCEL||(SUCCEEDED(code)&&SUCCEEDED(data->result())&&!effect&&!data->pending()&&data->error().empty());
        if(was_cancelled)cancelled=true;
        while(data->pending())pump();
        data->drain();
        if(!was_cancelled){if(!data->error().empty())fail(data->error());if(FAILED(code)||FAILED(data->result()))fail("Target failed to copy archive contents");}
        emit("{\"type\":\"result\",\"count\":"+std::to_string(was_cancelled?0:data->selection.roots)+",\"cancelled\":"+(was_cancelled?"true":"false")+"}");
        data->Release();drag_source->Release();OleUninitialize();
    }catch(...){poll_escape=false;cancelled=true;data->drain();data->Release();drag_source->Release();OleUninitialize();throw;}
}
