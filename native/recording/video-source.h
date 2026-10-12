#pragma once
#include "audio-source.h"
#include <d3d11_4.h>
#include <dwmapi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Metadata.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <condition_variable>
namespace one_video {
using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
using namespace one_audio_native;
struct GPU {
    com_ptr<ID3D11Device> device;
    com_ptr<ID3D11DeviceContext> context;
    GPU() {
        check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT, nullptr, 0,
            D3D11_SDK_VERSION, device.put(), nullptr, context.put()));
        context.as<ID3D11Multithread>()->SetMultithreadProtected(TRUE);
    }
};
static void validVideoSize(int w, int h) {
    if (w < 2 || h < 2 || w > 16384 || h > 16384 || uint64_t(w) * h > 40000000)
        throw hresult_error(E_INVALIDARG, L"录制来源尺寸无效或过大");
}
struct SourceState {
    std::mutex mutex;
    std::condition_variable ready;
    com_ptr<ID3D11Texture2D> latest;
    int width = 0, height = 0;
    int64_t timestamp = -1;
    uint64_t serial = 0;
    HRESULT error = S_OK;
    bool closed = false, stopped = false, resized = false;
};
// Only one owned BGRA texture is retained. WGC pool textures never escape a
// callback, and the encoder never runs on a capture callback or Electron thread.
class VideoSource {
    GPU& gpu;
    std::shared_ptr<SourceState> state = std::make_shared<SourceState>();
    GraphicsCaptureItem item{nullptr};
    Direct3D11CaptureFramePool pool{nullptr};
    GraphicsCaptureSession session{nullptr};
    event_token arrived{}, closed{};
    bool fixture, spatial = false;
    DWORD expected = 0;
    HWND window = nullptr;
    HMONITOR monitor = nullptr;
    RECT original{};
public:
    VideoSource(GPU& gpu, const std::wstring& kind, uint64_t target, DWORD pid, bool cursor, bool synthetic = false)
        : gpu(gpu), fixture(synthetic), expected(pid) {
        if (kind != L"window" && kind != L"screen") throw hresult_invalid_argument();
        if (fixture) {
            state->width = 640; state->height = 360;
            D3D11_TEXTURE2D_DESC d{}; d.Width = 640; d.Height = 360; d.MipLevels = d.ArraySize = 1;
            d.Format = DXGI_FORMAT_B8G8R8A8_UNORM; d.SampleDesc.Count = 1; d.Usage = D3D11_USAGE_DEFAULT;
            d.BindFlags = D3D11_BIND_RENDER_TARGET;
            check_hresult(gpu.device->CreateTexture2D(&d, nullptr, state->latest.put()));
            return;
        }
        if (!GraphicsCaptureSession::IsSupported()) throw hresult_error(E_NOTIMPL, L"系统不支持原生画面采集");
        const auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
        if (kind == L"window") {
            window = reinterpret_cast<HWND>(target); validate();
            check_hresult(interop->CreateForWindow(window, guid_of<GraphicsCaptureItem>(), put_abi(item)));
        } else if (kind == L"screen") {
            monitor = reinterpret_cast<HMONITOR>(target); MONITORINFO info{sizeof(info)};
            check_bool(GetMonitorInfo(monitor, &info)); original = info.rcMonitor;
            check_hresult(interop->CreateForMonitor(monitor, guid_of<GraphicsCaptureItem>(), put_abi(item)));
        } else throw hresult_invalid_argument();
        const auto size = item.Size(); validVideoSize(size.Width, size.Height);
        state->width = size.Width; state->height = size.Height;
        com_ptr<IInspectable> inspectable;
        check_hresult(CreateDirect3D11DeviceFromDXGIDevice(gpu.device.as<IDXGIDevice>().get(), inspectable.put()));
        pool = Direct3D11CaptureFramePool::CreateFreeThreaded(inspectable.as<IDirect3DDevice>(),
            DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
        const auto shared = state;
        const auto device = gpu.device;
        const auto context = gpu.context;
        arrived = pool.FrameArrived([shared, device, context](const auto& sender, const auto&) {
            std::lock_guard lock(shared->mutex);
            if (shared->stopped || FAILED(shared->error)) return;
            try {
                Direct3D11CaptureFrame newest{nullptr};
                while (auto frame = sender.TryGetNextFrame()) {
                    if (!newest || frame.SystemRelativeTime().count() > newest.SystemRelativeTime().count()) {
                        if (newest) newest.Close(); newest = frame;
                    } else frame.Close();
                }
                if (!newest) return;
                const auto size = newest.ContentSize();
                if (size.Width != shared->width || size.Height != shared->height) shared->resized = true;
                else if (newest.SystemRelativeTime().count() > shared->timestamp) {
                    com_ptr<ID3D11Texture2D> texture;
                    check_hresult(newest.Surface().template as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>()->GetInterface(
                        guid_of<ID3D11Texture2D>(), texture.put_void()));
                    D3D11_TEXTURE2D_DESC d{}; texture->GetDesc(&d);
                    if (d.Width < UINT(size.Width) || d.Height < UINT(size.Height)) throw hresult_invalid_argument();
                    if (!shared->latest) {
                        d.Width = size.Width; d.Height = size.Height; d.MipLevels = d.ArraySize = 1;
                        d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_RENDER_TARGET; d.CPUAccessFlags = d.MiscFlags = 0;
                        check_hresult(device->CreateTexture2D(&d, nullptr, shared->latest.put()));
                    }
                    const D3D11_BOX box{0, 0, 0, UINT(size.Width), UINT(size.Height), 1};
                    context->CopySubresourceRegion(shared->latest.get(), 0, 0, 0, 0, texture.get(), 0, &box);
                    shared->timestamp = newest.SystemRelativeTime().count(); shared->serial++;
                }
                newest.Close();
            } catch (...) { shared->error = to_hresult(); }
            shared->ready.notify_all();
        });
        closed = item.Closed([shared](const auto&, const auto&) {
            std::lock_guard lock(shared->mutex); shared->closed = true; shared->ready.notify_all();
        });
        session = pool.CreateCaptureSession(item);
        if (winrt::Windows::Foundation::Metadata::ApiInformation::IsPropertyPresent(
            L"Windows.Graphics.Capture.GraphicsCaptureSession", L"IsCursorCaptureEnabled")) session.IsCursorCaptureEnabled(cursor);
        else if(!cursor) throw hresult_error(E_FAIL,L"当前系统不支持分离光标，请更新 Windows");
        session.StartCapture();
        std::unique_lock lock(state->mutex);
        if (!state->ready.wait_for(lock, std::chrono::seconds(4), [&] { return state->latest || state->closed || FAILED(state->error); }))
            throw hresult_error(HRESULT_FROM_WIN32(WAIT_TIMEOUT), L"来源没有返回可录制画面");
        check_hresult(state->error);
        if (!state->latest) throw hresult_error(E_FAIL, L"录制来源已关闭");
    }
    ~VideoSource() {
        { std::lock_guard lock(state->mutex); state->stopped = true; }
        try { if (pool) pool.FrameArrived(arrived); if (item) item.Closed(closed); if (session) session.Close(); if (pool) pool.Close(); } catch (...) {}
    }
    int width() const { return state->width; }
    int height() const { return state->height; }
    void fixturePattern() { if (!fixture) throw hresult_invalid_argument(); spatial = true; }
    RECT bounds() const {
        if (fixture) return {0, 0, state->width, state->height};
        if (monitor) return original;
        RECT result{};
        if (FAILED(DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &result, sizeof(result)))) check_bool(GetWindowRect(window, &result));
        return result;
    }
    void validate() const {
        if (fixture) return;
        if (window) {
            DWORD pid = 0; GetWindowThreadProcessId(window, &pid);
            if (!IsWindow(window) || pid != expected) throw hresult_error(E_FAIL, L"录制窗口已关闭，已保留录制");
            if (!IsWindowVisible(window) || IsIconic(window)) throw hresult_error(E_FAIL, L"录制窗口已隐藏或最小化，已保留录制");
        } else if (monitor) {
            MONITORINFO info{sizeof(info)};
            if (!GetMonitorInfo(monitor, &info) || !EqualRect(&original, &info.rcMonitor))
                throw hresult_error(E_FAIL, L"显示器已断开或配置改变，已保留录制");
        }
    }
    template<class F> auto read(int64_t tick, F&& consume) {
        std::lock_guard lock(state->mutex); check_hresult(state->error);
        if (state->closed || state->resized) throw hresult_error(E_FAIL,
            state->resized ? L"来源尺寸已改变，已结束并保留录制，请重新选择" : L"录制来源已关闭，已保留录制");
        if (fixture) {
            com_ptr<ID3D11RenderTargetView> view;
            check_hresult(gpu.device->CreateRenderTargetView(state->latest.get(), nullptr, view.put()));
            const float color[]{tick < 10000000 ? 1.0f : 0.0f, 0.0f, tick < 10000000 ? 0.0f : 1.0f, 1.0f};
            gpu.context->ClearRenderTargetView(view.get(), color);
            if (spatial) {
                const float red[]{1, 0, 0, 1}, blue[]{0, 0, 1, 1};
                gpu.context->ClearRenderTargetView(view.get(), red);
                const D3D11_RECT right{state->width / 2, 0, state->width, state->height};
                gpu.context.as<ID3D11DeviceContext1>()->ClearView(view.get(), blue, &right, 1);
            }
        }
        return consume(state->latest.get());
    }
};
class Converter {
    GPU& gpu;
    com_ptr<ID3D11VideoDevice> device;
    com_ptr<ID3D11VideoContext> context;
    com_ptr<ID3D11VideoProcessorEnumerator> enumerator;
    com_ptr<ID3D11VideoProcessor> processor;
    com_ptr<ID3D11Texture2D> output, staging;
    com_ptr<ID3D11VideoProcessorOutputView> view;
    int sourceWidth, sourceHeight;
    RECT crop;
public:
    UINT width, height;
    Converter(GPU& gpu, int sourceWidth, int sourceHeight, RECT crop, UINT maximum, UINT fps)
        : gpu(gpu), sourceWidth(sourceWidth), sourceHeight(sourceHeight), crop(crop) {
        const auto cw = crop.right - crop.left, ch = crop.bottom - crop.top;
        if (crop.left < 0 || crop.top < 0 || cw < 2 || ch < 2 || crop.right > sourceWidth || crop.bottom > sourceHeight)
            throw hresult_error(E_INVALIDARG, L"录制选区超出来源");
        const double scale = std::min(1.0, double(maximum) / std::max(cw, ch));
        width = UINT(cw * scale) / 2 * 2; height = UINT(ch * scale) / 2 * 2;
        validVideoSize(width, height);
        device = gpu.device.as<ID3D11VideoDevice>(); context = gpu.context.as<ID3D11VideoContext>();
        D3D11_VIDEO_PROCESSOR_CONTENT_DESC d{}; d.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
        d.InputWidth = sourceWidth; d.InputHeight = sourceHeight; d.OutputWidth = width; d.OutputHeight = height;
        d.InputFrameRate = d.OutputFrameRate = {fps, 1}; d.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
        check_hresult(device->CreateVideoProcessorEnumerator(&d, enumerator.put()));
        check_hresult(device->CreateVideoProcessor(enumerator.get(), 0, processor.put()));
        UINT support = 0; check_hresult(enumerator->CheckVideoProcessorFormat(DXGI_FORMAT_NV12, &support));
        if (!(support & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_OUTPUT)) throw hresult_error(E_NOTIMPL, L"显卡不支持 NV12 画面处理");
        D3D11_TEXTURE2D_DESC texture{}; texture.Width = width; texture.Height = height; texture.MipLevels = texture.ArraySize = 1;
        texture.Format = DXGI_FORMAT_NV12; texture.SampleDesc.Count = 1; texture.BindFlags = D3D11_BIND_RENDER_TARGET;
        check_hresult(gpu.device->CreateTexture2D(&texture, nullptr, output.put()));
        texture.BindFlags = 0; texture.Usage = D3D11_USAGE_STAGING; texture.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
        check_hresult(gpu.device->CreateTexture2D(&texture, nullptr, staging.put()));
        D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC vd{}; vd.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
        check_hresult(device->CreateVideoProcessorOutputView(output.get(), enumerator.get(), &vd, view.put()));
        const RECT destination{0, 0, LONG(width), LONG(height)};
        context->VideoProcessorSetStreamSourceRect(processor.get(), 0, TRUE, &crop);
        context->VideoProcessorSetStreamDestRect(processor.get(), 0, TRUE, &destination);
        context->VideoProcessorSetOutputTargetRect(processor.get(), TRUE, &destination);
        context->VideoProcessorSetStreamAutoProcessingMode(processor.get(), 0, FALSE);
        D3D11_VIDEO_PROCESSOR_COLOR_SPACE input{}, target{}; input.RGB_Range = 0; input.YCbCr_Matrix = 1;
        target.YCbCr_Matrix = 1; target.Nominal_Range = 1;
        context->VideoProcessorSetStreamColorSpace(processor.get(), 0, &input);
        context->VideoProcessorSetOutputColorSpace(processor.get(), &target);
    }
    void move(int x, int y) {
        const int cw = crop.right - crop.left, ch = crop.bottom - crop.top;
        if (x < 0 || y < 0 || x > sourceWidth - cw || y > sourceHeight - ch)
            throw hresult_error(E_INVALIDARG, L"移动录制区域超出当前显示器");
        crop = {x, y, x + cw, y + ch};
        context->VideoProcessorSetStreamSourceRect(processor.get(), 0, TRUE, &crop);
    }
    com_ptr<IMFMediaBuffer> convert(ID3D11Texture2D* source) {
        D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC d{}; d.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
        com_ptr<ID3D11VideoProcessorInputView> input;
        check_hresult(device->CreateVideoProcessorInputView(source, enumerator.get(), &d, input.put()));
        D3D11_VIDEO_PROCESSOR_STREAM stream{}; stream.Enable = TRUE; stream.pInputSurface = input.get();
        check_hresult(context->VideoProcessorBlt(processor.get(), view.get(), 0, 1, &stream));
        gpu.context->CopyResource(staging.get(), output.get());
        D3D11_MAPPED_SUBRESOURCE map{}; check_hresult(gpu.context->Map(staging.get(), 0, D3D11_MAP_READ, 0, &map));
        com_ptr<IMFMediaBuffer> buffer;
        try {
            const auto length = width * height * 3 / 2;
            check_hresult(MFCreateMemoryBuffer(length, buffer.put())); BYTE* bytes = nullptr;
            check_hresult(buffer->Lock(&bytes, nullptr, nullptr));
            for (UINT row = 0; row < height * 3 / 2; row++) memcpy(bytes + row * width, static_cast<BYTE*>(map.pData) + row * map.RowPitch, width);
            check_hresult(buffer->Unlock()); check_hresult(buffer->SetCurrentLength(length));
        } catch (...) { gpu.context->Unmap(staging.get(), 0); throw; }
        gpu.context->Unmap(staging.get(), 0); return buffer;
    }
};
}
