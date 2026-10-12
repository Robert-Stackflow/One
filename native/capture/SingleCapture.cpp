#define NOMINMAX
#include <windows.h>
#include <d3d11_4.h>
#include <dwmapi.h>
#include <wincodec.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Metadata.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <condition_variable>
#include <mutex>
#include <memory>
#include <vector>
#include <iostream>
#include <chrono>
#include <fcntl.h>
#include <io.h>

using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;

static void validSize(int width, int height) {
    if (width < 2 || height < 2 || width > 16384 || height > 16384 || uint64_t(width) * height > 40000000)
        throw hresult_error(E_INVALIDARG, L"窗口图像尺寸过大");
}
static void validWindow(HWND window, DWORD expected, DWORD owner) {
    DWORD pid = 0, cloaked = 0, affinity = 0;
    GetWindowThreadProcessId(window, &pid);
    DwmGetWindowAttribute(window, DWMWA_CLOAKED, &cloaked, sizeof(cloaked));
    if (!IsWindow(window) || pid != expected || pid == owner || !IsWindowVisible(window) || IsIconic(window) || cloaked)
        throw hresult_error(E_INVALIDARG, L"窗口已关闭、隐藏或最小化");
    if (GetWindowDisplayAffinity(window, &affinity) && affinity)
        throw hresult_error(E_ACCESSDENIED, L"窗口不允许捕获");
}
static uint64_t number(const wchar_t* value) {
    wchar_t* end = nullptr;
    const auto result = wcstoull(value, &end, 10);
    if (!result || *end || value[0] == L'-') throw hresult_invalid_argument();
    return result;
}
struct FrameState {
    std::mutex mutex;
    std::condition_variable ready;
    Direct3D11CaptureFrame frame{nullptr};
    HRESULT error = S_OK;
    bool stopped = false;
};

static void encode(const std::vector<uint8_t>& pixels, UINT width, UINT height, long long elapsed) {
    const auto factory = create_instance<IWICImagingFactory>(CLSID_WICImagingFactory);
    com_ptr<IStream> stream;
    check_hresult(CreateStreamOnHGlobal(nullptr, TRUE, stream.put()));
    com_ptr<IWICBitmapEncoder> encoder;
    check_hresult(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, encoder.put()));
    check_hresult(encoder->Initialize(stream.get(), WICBitmapEncoderNoCache));
    com_ptr<IWICBitmapFrameEncode> frame;
    com_ptr<IPropertyBag2> properties;
    check_hresult(encoder->CreateNewFrame(frame.put(), properties.put()));
    check_hresult(frame->Initialize(properties.get()));
    check_hresult(frame->SetSize(width, height));
    auto format = GUID_WICPixelFormat32bppBGRA;
    check_hresult(frame->SetPixelFormat(&format));
    if (format != GUID_WICPixelFormat32bppBGRA) throw hresult_error(E_FAIL, L"无法保留窗口像素格式");
    check_hresult(frame->WritePixels(height, width * 4, static_cast<UINT>(pixels.size()), const_cast<BYTE*>(pixels.data())));
    check_hresult(frame->Commit());
    check_hresult(encoder->Commit());
    STATSTG info{};
    check_hresult(stream->Stat(&info, STATFLAG_NONAME));
    if (info.cbSize.QuadPart < 24 || info.cbSize.QuadPart > 64 * 1024 * 1024)
        throw hresult_error(E_OUTOFMEMORY, L"窗口 PNG 超出容量限制");
    HGLOBAL memory = nullptr;
    check_hresult(GetHGlobalFromStream(stream.get(), &memory));
    const auto bytes = static_cast<const char*>(GlobalLock(memory));
    if (!bytes) throw hresult_error(E_OUTOFMEMORY);
    std::cout << "{\"backend\":\"wgc\",\"width\":" << width << ",\"height\":" << height
              << ",\"bytes\":" << info.cbSize.QuadPart << ",\"elapsed\":" << elapsed << "}\n";
    std::cout.write(bytes, static_cast<std::streamsize>(info.cbSize.QuadPart));
    std::cout.flush();
    GlobalUnlock(memory);
}

static void capture(HWND window, DWORD expected, DWORD owner) {
    const auto started = std::chrono::steady_clock::now();
    validWindow(window, expected, owner);
    if (!GraphicsCaptureSession::IsSupported()) throw hresult_error(E_NOTIMPL, L"系统不支持原生窗口捕获");
    const auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    GraphicsCaptureItem item{nullptr};
    check_hresult(interop->CreateForWindow(window, guid_of<GraphicsCaptureItem>(), put_abi(item)));
    auto size = item.Size();
    validSize(size.Width, size.Height);
    com_ptr<ID3D11Device> device;
    com_ptr<ID3D11DeviceContext> context;
    auto result = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        nullptr, 0, D3D11_SDK_VERSION, device.put(), nullptr, context.put());
    if (FAILED(result)) {
        device = nullptr; context = nullptr;
        check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            nullptr, 0, D3D11_SDK_VERSION, device.put(), nullptr, context.put()));
    }
    context.as<ID3D11Multithread>()->SetMultithreadProtected(TRUE);
    const auto dxgi = device.as<IDXGIDevice>();
    com_ptr<IInspectable> inspectable;
    check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), inspectable.put()));
    const auto pool = Direct3D11CaptureFramePool::CreateFreeThreaded(inspectable.as<IDirect3DDevice>(), DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
    const auto state = std::make_shared<FrameState>();
    const auto event = pool.FrameArrived([state](const Direct3D11CaptureFramePool& sender, const auto&) {
        std::lock_guard lock(state->mutex);
        if (state->stopped || state->frame || FAILED(state->error)) return;
        try { state->frame = sender.TryGetNextFrame(); }
        catch (...) { state->error = to_hresult(); }
        state->ready.notify_one();
    });
    auto session = pool.CreateCaptureSession(item);
    if (winrt::Windows::Foundation::Metadata::ApiInformation::IsPropertyPresent(L"Windows.Graphics.Capture.GraphicsCaptureSession", L"IsCursorCaptureEnabled"))
        session.IsCursorCaptureEnabled(false);
    Direct3D11CaptureFrame frame{nullptr};
    try {
        session.StartCapture();
        std::unique_lock lock(state->mutex);
        if (!state->ready.wait_for(lock, std::chrono::milliseconds(2500), [&] { return state->frame || FAILED(state->error); }))
            throw hresult_error(HRESULT_FROM_WIN32(WAIT_TIMEOUT), L"窗口没有返回可捕获帧");
        check_hresult(state->error);
        state->stopped = true;
        frame = state->frame;
    } catch (...) {
        { std::lock_guard lock(state->mutex); state->stopped = true; }
        pool.FrameArrived(event); session.Close(); pool.Close(); throw;
    }
    pool.FrameArrived(event);
    session.Close();
    validWindow(window, expected, owner);
    size = frame.ContentSize();
    validSize(size.Width, size.Height);
    const auto access = frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
    com_ptr<ID3D11Texture2D> texture;
    check_hresult(access->GetInterface(guid_of<ID3D11Texture2D>(), texture.put_void()));
    D3D11_TEXTURE2D_DESC description{};
    texture->GetDesc(&description);
    if (UINT(size.Width) > description.Width || UINT(size.Height) > description.Height || description.Format != DXGI_FORMAT_B8G8R8A8_UNORM)
        throw hresult_error(E_FAIL, L"窗口在采集期间改变了尺寸或像素格式");
    description.Width = size.Width; description.Height = size.Height;
    description.MipLevels = 1; description.ArraySize = 1;
    description.Usage = D3D11_USAGE_STAGING; description.BindFlags = 0;
    description.CPUAccessFlags = D3D11_CPU_ACCESS_READ; description.MiscFlags = 0;
    com_ptr<ID3D11Texture2D> staging;
    check_hresult(device->CreateTexture2D(&description, nullptr, staging.put()));
    const D3D11_BOX box{0, 0, 0, UINT(size.Width), UINT(size.Height), 1};
    context->CopySubresourceRegion(staging.get(), 0, 0, 0, 0, texture.get(), 0, &box);
    std::vector<uint8_t> pixels(size_t(size.Width) * size.Height * 4);
    D3D11_MAPPED_SUBRESOURCE mapped{};
    check_hresult(context->Map(staging.get(), 0, D3D11_MAP_READ, 0, &mapped));
    for (int y = 0; y < size.Height; ++y)
        memcpy(pixels.data() + size_t(y) * size.Width * 4, static_cast<const uint8_t*>(mapped.pData) + size_t(y) * mapped.RowPitch, size_t(size.Width) * 4);
    context->Unmap(staging.get(), 0);
    frame.Close(); pool.Close();
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
    encode(pixels, size.Width, size.Height, elapsed);
    SecureZeroMemory(pixels.data(), pixels.size());
}

#ifndef ONE_CAPTURE_LIBRARY
int wmain(int argc, wchar_t** argv) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    _setmode(_fileno(stdout), _O_BINARY);
    try {
        init_apartment(apartment_type::multi_threaded);
        if (argc != 5 || wcscmp(argv[1], L"window") != 0) throw hresult_invalid_argument();
        const auto expected = number(argv[3]), owner = number(argv[4]);
        if (expected > MAXDWORD || owner > MAXDWORD) throw hresult_invalid_argument();
        capture(reinterpret_cast<HWND>(number(argv[2])), DWORD(expected), DWORD(owner));
        uninit_apartment();
        return 0;
    } catch (const hresult_error& error) {
        std::cerr << "Capture failed (0x" << std::hex << unsigned(error.code()) << "): " << to_string(error.message()) << std::endl;
    } catch (...) {
        std::cerr << "Capture failed" << std::endl;
    }
    return 1;
}
#endif
