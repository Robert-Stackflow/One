// Only compiled with ONE_PREVIEW_TEST; no COM registration or file association changes.
class TestPreview final:public IPreviewHandler,public IInitializeWithStream{
 std::atomic<ULONG> refs{1};HWND parentWindow=nullptr,childWindow=nullptr;RECT rect{};ComPtr<IStream> content;std::string mode;
 public:
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(id==IID_IUnknown||id==IID_IPreviewHandler)*out=static_cast<IPreviewHandler*>(this);else if(id==IID_IInitializeWithStream)*out=static_cast<IInitializeWithStream*>(this);else return E_NOINTERFACE;AddRef();return S_OK;}
 ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
 HRESULT STDMETHODCALLTYPE Initialize(IStream* stream,DWORD flags)override{if(flags!=STGM_READ)return E_ACCESSDENIED;content=stream;char text[32]{};ULONG count=0;stream->Read(text,31,&count);mode.assign(text,count);return S_OK;}
 HRESULT STDMETHODCALLTYPE SetWindow(HWND value,const RECT* area)override{parentWindow=value;rect=*area;return S_OK;}
 HRESULT STDMETHODCALLTYPE SetRect(const RECT* area)override{if(!parentWindow||area->right<=area->left||area->bottom<=area->top)return E_INVALIDARG;rect=*area;if(childWindow)MoveWindow(childWindow,rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top,TRUE);return S_OK;}
 HRESULT STDMETHODCALLTYPE DoPreview()override{if(mode.starts_with("hang"))Sleep(30000);if(mode.starts_with("error"))return E_FAIL;childWindow=CreateWindowExW(0,L"STATIC",L"Native preview test provider",WS_CHILD|WS_VISIBLE,rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top,parentWindow,nullptr,GetModuleHandleW(nullptr),nullptr);if(mode.starts_with("crash"))std::thread([]{Sleep(250);ExitProcess(23);}).detach();return childWindow?S_OK:E_FAIL;}
 HRESULT STDMETHODCALLTYPE Unload()override{if(IsWindow(childWindow))DestroyWindow(childWindow);childWindow=nullptr;content.Reset();return S_OK;}
 HRESULT STDMETHODCALLTYPE SetFocus()override{::SetFocus(childWindow);return S_OK;}
 HRESULT STDMETHODCALLTYPE QueryFocus(HWND* value)override{if(!value)return E_POINTER;*value=GetFocus();return S_OK;}
 HRESULT STDMETHODCALLTYPE TranslateAccelerator(MSG*)override{return S_FALSE;}
};
