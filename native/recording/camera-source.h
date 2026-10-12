#pragma once
#include <wincodec.h>
#include <mferror.h>
namespace one_video {
// Enumeration does not activate a camera. Only an exact enumerated symbolic
// link may be activated after the user enables it for this recording.
struct CameraDevices {
    IMFActivate** values = nullptr; UINT count = 0;
    CameraDevices() {
        com_ptr<IMFAttributes> attributes; check_hresult(MFCreateAttributes(attributes.put(), 1));
        check_hresult(attributes->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID));
        check_hresult(MFEnumDeviceSources(attributes.get(), &values, &count));
    }
    ~CameraDevices() { for (UINT i=0;i<count;i++) values[i]->Release(); CoTaskMemFree(values); }
    CameraDevices(const CameraDevices&)=delete;
};
static std::wstring cameraAttribute(IMFAttributes* source, const GUID& key) {
    UINT length=0; check_hresult(source->GetStringLength(key,&length));
    if (length>2048) throw hresult_invalid_argument();
    std::wstring value(length+1,L'\0'); check_hresult(source->GetString(key,value.data(),length+1,nullptr)); value.resize(length); return value;
}
static void listCameras() {
    CameraDevices devices; if(devices.count>64) throw hresult_error(E_FAIL,L"摄像头设备数量过多");
    std::cout << "[";
    for(UINT i=0;i<devices.count;i++) {
        if(i) std::cout << ',';
        std::cout << "{\"id\":" << jsonString(cameraAttribute(devices.values[i],MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK))
            << ",\"name\":" << jsonString(cameraAttribute(devices.values[i],MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME)) << "}";
    }
    std::cout << "]\n";
}
struct CameraState {
    std::mutex mutex; std::condition_variable ready;
    IMFSourceReader* reader = nullptr; // Borrowed under mutex; no reader/callback ownership cycle.
    std::vector<uint8_t> pixels;
    UINT width=0,height=0; LONG stride=0;
    HRESULT error=S_OK; bool closed=false;
    int64_t arrived=0; uint64_t serial=0;
};
class CameraCallback : public winrt::implements<CameraCallback, IMFSourceReaderCallback> {
    std::shared_ptr<CameraState> state;
public:
    explicit CameraCallback(std::shared_ptr<CameraState> value): state(std::move(value)) {}
    HRESULT __stdcall OnReadSample(HRESULT status, DWORD, DWORD flags, LONGLONG, IMFSample* sample) noexcept override {
        com_ptr<IMFSourceReader> next;
        try {
            std::lock_guard lock(state->mutex); if(state->closed) return S_OK;
            check_hresult(status);
            if(flags & (MF_SOURCE_READERF_ERROR | MF_SOURCE_READERF_ENDOFSTREAM | MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED))
                throw hresult_error(E_FAIL,L"摄像头已断开或画面格式发生变化");
            if(sample) {
                com_ptr<IMFMediaBuffer> buffer; check_hresult(sample->ConvertToContiguousBuffer(buffer.put()));
                const auto row=state->width*4;
                if(auto plane=buffer.try_as<IMF2DBuffer>()) {
                    BYTE* data=nullptr; LONG pitch=0; check_hresult(plane->Lock2D(&data,&pitch));
                    if(std::abs(int64_t(pitch))<row || std::abs(int64_t(pitch))>65536) {plane->Unlock2D();throw hresult_invalid_argument();}
                    for(UINT y=0;y<state->height;y++) memcpy(state->pixels.data()+size_t(y)*row,data+int64_t(y)*pitch,row);
                    check_hresult(plane->Unlock2D());
                } else {
                    BYTE* data=nullptr;DWORD length=0;check_hresult(buffer->Lock(&data,nullptr,&length));
                    const auto stride=state->stride;
                    if(std::abs(int64_t(stride))<row || std::abs(int64_t(stride))*state->height>length) {buffer->Unlock();throw hresult_invalid_argument();}
                    const auto top=stride<0 ? data+size_t(state->height-1)*size_t(-stride) : data;
                    for(UINT y=0;y<state->height;y++) memcpy(state->pixels.data()+size_t(y)*row,top+int64_t(y)*stride,row);
                    check_hresult(buffer->Unlock());
                }
                // RGB32's fourth byte is undefined; preview pixels are opaque.
                for(size_t i=3;i<state->pixels.size();i+=4) state->pixels[i]=255;
                state->serial++;state->arrived=clockTime();state->ready.notify_all();
            }
            if(state->reader) next.copy_from(state->reader);
        } catch (...) {
            std::lock_guard lock(state->mutex);state->error=to_hresult();state->ready.notify_all();return S_OK;
        }
        if(next) {
            const auto result=next->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM,0,nullptr,nullptr,nullptr,nullptr);
            if(FAILED(result)) {std::lock_guard lock(state->mutex);if(!state->closed) state->error=result;state->ready.notify_all();}
        }
        return S_OK;
    }
    HRESULT __stdcall OnEvent(DWORD, IMFMediaEvent* event) noexcept override {
        HRESULT result=S_OK; if(event && SUCCEEDED(event->GetStatus(&result)) && FAILED(result)) {std::lock_guard lock(state->mutex);state->error=result;state->ready.notify_all();}return S_OK;
    }
    HRESULT __stdcall OnFlush(DWORD) noexcept override {return S_OK;}
};
class CameraSource {
    GPU& gpu;
    std::shared_ptr<CameraState> state=std::make_shared<CameraState>();
    com_ptr<IMFMediaSource> source;com_ptr<IMFSourceReader> reader;
    com_ptr<ID3D11Texture2D> texture;
    bool fixture; int64_t previewAt=0; uint64_t uploaded=0,previewSerial=0;
    com_ptr<IWICImagingFactory> imaging;
    void shutdown() noexcept {
        {std::lock_guard lock(state->mutex);state->closed=true;state->reader=nullptr;}
        if(reader) reader->Flush(MF_SOURCE_READER_ALL_STREAMS);
        if(source) source->Shutdown();reader=nullptr;source=nullptr;
    }
public:
    CameraSource(GPU& gpu,const std::wstring& id,bool fixture):gpu(gpu),fixture(fixture) {
        try {
            if(fixture) {state->width=320;state->height=240;state->pixels.resize(320*240*4);}
            else {
                CameraDevices devices;if(devices.count>64) throw hresult_invalid_argument();
                for(UINT i=0;i<devices.count;i++) if(cameraAttribute(devices.values[i],MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK)==id) {
                    check_hresult(devices.values[i]->ActivateObject(__uuidof(IMFMediaSource),source.put_void()));break;
                }
                if(!source) throw hresult_error(HRESULT_FROM_WIN32(ERROR_DEVICE_NOT_CONNECTED),L"所选摄像头已断开，请刷新并重新选择");
                com_ptr<IMFAttributes> attributes;check_hresult(MFCreateAttributes(attributes.put(),4));
                auto callback=make_self<CameraCallback>(state);
                check_hresult(attributes->SetUnknown(MF_SOURCE_READER_ASYNC_CALLBACK,callback.get()));
                check_hresult(attributes->SetUINT32(MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING,TRUE));
                check_hresult(attributes->SetUINT32(MF_LOW_LATENCY,TRUE));
                check_hresult(MFCreateSourceReaderFromMediaSource(source.get(),attributes.get(),reader.put()));
                check_hresult(reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS,FALSE));
                check_hresult(reader->SetStreamSelection(MF_SOURCE_READER_FIRST_VIDEO_STREAM,TRUE));
                com_ptr<IMFMediaType> chosen;int64_t score=-1;
                for(DWORD i=0;i<256;i++) {
                    com_ptr<IMFMediaType> type;auto result=reader->GetNativeMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,i,type.put());
                    if(result==MF_E_NO_MORE_TYPES) break;check_hresult(result);
                    UINT w=0,h=0,n=0,d=0; if(FAILED(MFGetAttributeSize(type.get(),MF_MT_FRAME_SIZE,&w,&h)) || FAILED(MFGetAttributeRatio(type.get(),MF_MT_FRAME_RATE,&n,&d)) || !d || n<15*d || w<160 || h<120 || w>1920 || h>1080) continue;
                    const int64_t rank=(w<=1280 && h<=720 ? 100000000 : 0)+int64_t(w)*h+std::min(30u,n/d)*100;
                    if(rank>score) {score=rank;chosen=type;}
                }
                if(!chosen) throw hresult_error(E_NOTIMPL,L"摄像头没有可用的 15 fps 以上画面格式");
                check_hresult(reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,nullptr,chosen.get()));
                com_ptr<IMFMediaType> rgb;check_hresult(MFCreateMediaType(rgb.put()));
                check_hresult(rgb->SetGUID(MF_MT_MAJOR_TYPE,MFMediaType_Video));check_hresult(rgb->SetGUID(MF_MT_SUBTYPE,MFVideoFormat_RGB32));
                check_hresult(reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,nullptr,rgb.get()));
                rgb=nullptr;check_hresult(reader->GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,rgb.put()));
                check_hresult(MFGetAttributeSize(rgb.get(),MF_MT_FRAME_SIZE,&state->width,&state->height));
                if(state->width>1920 || state->height>1080) throw hresult_invalid_argument();
                UINT stride=0;if(FAILED(rgb->GetUINT32(MF_MT_DEFAULT_STRIDE,&stride))) {LONG value=0;check_hresult(MFGetStrideForBitmapInfoHeader(MFVideoFormat_RGB32.Data1,state->width,&value));stride=UINT(value);}
                state->stride=LONG(stride);state->pixels.resize(size_t(state->width)*state->height*4);state->reader=reader.get();
                check_hresult(reader->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM,0,nullptr,nullptr,nullptr,nullptr));
                std::unique_lock lock(state->mutex);
                if(!state->ready.wait_for(lock,std::chrono::seconds(5),[&]{return state->serial || FAILED(state->error);})) throw hresult_error(HRESULT_FROM_WIN32(ERROR_TIMEOUT),L"摄像头未返回画面，请检查设备占用或隐私设置");
                check_hresult(state->error);
            }
            D3D11_TEXTURE2D_DESC d{};d.Width=state->width;d.Height=state->height;d.MipLevels=d.ArraySize=1;
            d.Format=DXGI_FORMAT_B8G8R8A8_UNORM;d.SampleDesc.Count=1;d.Usage=D3D11_USAGE_DEFAULT;d.BindFlags=D3D11_BIND_RENDER_TARGET;
            check_hresult(gpu.device->CreateTexture2D(&d,nullptr,texture.put()));
            imaging=create_instance<IWICImagingFactory>(CLSID_WICImagingFactory);
        } catch (const hresult_error& error) {
            shutdown();
            if(error.code()==E_ACCESSDENIED) throw hresult_error(E_ACCESSDENIED,L"无法访问摄像头，请在 Windows 隐私设置中允许桌面应用访问摄像头");
            throw;
        } catch (...) {shutdown();throw;}
    }
    ~CameraSource() {shutdown();}
    UINT width() const {return state->width;} UINT height() const {return state->height;}
    void validate() {
        std::lock_guard lock(state->mutex);check_hresult(state->error);
        if(!fixture && clockTime()-state->arrived>30000000) throw hresult_error(HRESULT_FROM_WIN32(ERROR_DEVICE_NOT_CONNECTED),L"摄像头画面中断，录制已停止并保留");
    }
    void fixtureFrame(int64_t timestamp) {
        if(!fixture) return;
        const auto step=unsigned(timestamp/1000000);
        std::lock_guard lock(state->mutex);
        for(UINT y=0;y<state->height;y++) for(UINT x=0;x<state->width;x++) {
            const auto i=(size_t(y)*state->width+x)*4;
            state->pixels[i]=uint8_t(x+step*8);state->pixels[i+1]=uint8_t(y);state->pixels[i+2]=x<state->width/2 ? 230 : 25;state->pixels[i+3]=255;
        }
        state->serial++;state->arrived=clockTime();
    }
    template<typename F> auto read(int64_t timestamp,F consume) {
        fixtureFrame(timestamp);validate();
        {std::lock_guard lock(state->mutex);if(uploaded!=state->serial) {gpu.context->UpdateSubresource(texture.get(),0,nullptr,state->pixels.data(),state->width*4,0);uploaded=state->serial;}}
        return consume(texture.get());
    }
    void preview(const std::wstring& path) {
        const auto now=clockTime();if(now-previewAt<666667) return;previewAt=now;
        std::vector<uint8_t> pixels;
        {std::lock_guard lock(state->mutex);if(previewSerial==state->serial) return;previewSerial=state->serial;pixels=state->pixels;}
        com_ptr<IStream> stream;check_hresult(CreateStreamOnHGlobal(nullptr,TRUE,stream.put()));
        com_ptr<IWICBitmapEncoder> encoder;check_hresult(imaging->CreateEncoder(GUID_ContainerFormatJpeg,nullptr,encoder.put()));check_hresult(encoder->Initialize(stream.get(),WICBitmapEncoderNoCache));
        com_ptr<IWICBitmapFrameEncode> frame;com_ptr<IPropertyBag2> properties;check_hresult(encoder->CreateNewFrame(frame.put(),properties.put()));
        PROPBAG2 property{};property.pstrName=const_cast<wchar_t*>(L"ImageQuality");VARIANT quality{};quality.vt=VT_R4;quality.fltVal=0.75f;check_hresult(properties->Write(1,&property,&quality));
        check_hresult(frame->Initialize(properties.get()));check_hresult(frame->SetSize(state->width,state->height));
        WICPixelFormatGUID format=GUID_WICPixelFormat24bppBGR;check_hresult(frame->SetPixelFormat(&format));
        com_ptr<IWICBitmap> bitmap;check_hresult(imaging->CreateBitmapFromMemory(state->width,state->height,GUID_WICPixelFormat32bppBGRA,state->width*4,UINT(pixels.size()),pixels.data(),bitmap.put()));
        com_ptr<IWICFormatConverter> converter;check_hresult(imaging->CreateFormatConverter(converter.put()));check_hresult(converter->Initialize(bitmap.get(),format,WICBitmapDitherTypeNone,nullptr,0,WICBitmapPaletteTypeCustom));
        check_hresult(frame->WriteSource(converter.get(),nullptr));check_hresult(frame->Commit());check_hresult(encoder->Commit());
        SecureZeroMemory(pixels.data(),pixels.size());STATSTG info{};check_hresult(stream->Stat(&info,STATFLAG_NONAME));
        if(info.cbSize.QuadPart>2*1024*1024) throw hresult_invalid_argument();
        HGLOBAL memory=nullptr;check_hresult(GetHGlobalFromStream(stream.get(),&memory));const auto data=GlobalLock(memory);if(!data) throw_last_error();
        if(path.empty()) {
            const auto length=uint32_t(info.cbSize.QuadPart);
            std::cout.write(reinterpret_cast<const char*>(&length),4);
            std::cout.write(static_cast<const char*>(data),length);std::cout.flush();
            GlobalUnlock(memory);return;
        }
        const auto temporary=path+L".writing";
        {Handle file(CreateFileW(temporary.c_str(),GENERIC_WRITE,0,nullptr,CREATE_ALWAYS,FILE_ATTRIBUTE_TEMPORARY,nullptr));
         if(file.value==INVALID_HANDLE_VALUE) {GlobalUnlock(memory);throw_last_error();}DWORD written=0;const auto ok=WriteFile(file.value,data,DWORD(info.cbSize.QuadPart),&written,nullptr);GlobalUnlock(memory);check_bool(ok);if(written!=info.cbSize.QuadPart) throw hresult_error(E_FAIL);}
        check_bool(MoveFileExW(temporary.c_str(),path.c_str(),MOVEFILE_REPLACE_EXISTING));
        std::cout << "{\"kind\":\"camera-frame\",\"serial\":" << previewSerial << ",\"bytes\":" << info.cbSize.QuadPart << "}\n" << std::flush;
    }
};
}
