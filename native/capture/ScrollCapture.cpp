#define ONE_CAPTURE_LIBRARY
#include "SingleCapture.cpp"
#include <sstream>
#include "transport-png.h"

static bool transport(const std::vector<uint8_t>& pixels, UINT width, UINT height, long long elapsed, const char* backend = "wgc") {
    auto png = capture_transport::png(pixels, width, height);
    if (png.empty()) return false;
    std::cout << "{\"backend\":\"" << backend << "\",\"width\":" << width << ",\"height\":" << height
        << ",\"bytes\":" << png.size() << ",\"elapsed\":" << elapsed << "}\n";
    std::cout.write(reinterpret_cast<const char*>(png.data()), png.size()); std::cout.flush();
    SecureZeroMemory(png.data(), png.size());
    return true;
}

// Interactive monitor snapshots do not need a WGC/D3D session. Read the DWM
// desktop after its next composition, with a top-down physical-pixel DIB.
// The process keeps buffers only; it captures nothing until a frame command.
static void snapshot(RECT region, HMONITOR monitor, const MONITORINFO& initial) {
    const int width = region.right - region.left, height = region.bottom - region.top;
    HDC desktop = GetDC(nullptr), memory = desktop ? CreateCompatibleDC(desktop) : nullptr;
    BITMAPINFO info{}; info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = width; info.bmiHeader.biHeight = -height;
    info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB;
    void* bits = nullptr;
    HBITMAP bitmap = memory ? CreateDIBSection(desktop, &info, DIB_RGB_COLORS, &bits, nullptr, 0) : nullptr;
    HGDIOBJ previous = bitmap ? SelectObject(memory, bitmap) : nullptr;
    const auto close = [&] {
        if (bits) SecureZeroMemory(bits, size_t(width) * height * 4);
        if (previous && previous != HGDI_ERROR) SelectObject(memory, previous);
        if (bitmap) DeleteObject(bitmap);
        if (memory) DeleteDC(memory);
        if (desktop) ReleaseDC(nullptr, desktop);
    };
    if (!desktop || !memory || !bitmap || !bits || !previous || previous == HGDI_ERROR) {
        close(); throw hresult_error(E_FAIL, L"无法初始化桌面截图");
    }
    std::vector<uint8_t> pixels(size_t(width) * height * 4);
    try {
        std::cout << "{\"ready\":true}\n" << std::flush;
        std::string command;
        while (std::getline(std::cin, command)) {
            if (command == "stop") break;
            if (command != "frame" && command != "frame fresh") throw hresult_invalid_argument();
            MONITORINFO current{sizeof(MONITORINFO)};
            if (!GetMonitorInfo(monitor, &current) || memcmp(&current.rcMonitor, &initial.rcMonitor, sizeof(RECT)))
                throw hresult_error(E_FAIL, L"显示器已断开或改变尺寸");
            const auto start = std::chrono::steady_clock::now();
            DwmFlush();
            if (!BitBlt(memory, 0, 0, width, height, desktop, region.left, region.top, SRCCOPY | CAPTUREBLT))
                throw hresult_error(E_FAIL, L"桌面截图失败");
            GdiFlush();
            memcpy(pixels.data(), bits, pixels.size());
            for (size_t at = 3; at < pixels.size(); at += 4) pixels[at] = 255;
            const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
            if (!transport(pixels, width, height, elapsed, "gdi")) encode(pixels, width, height, elapsed);
            SecureZeroMemory(pixels.data(), pixels.size());
        }
    } catch (...) { SecureZeroMemory(pixels.data(), pixels.size()); close(); throw; }
    close();
}

// A session owns one WGC monitor pool. Commands are serial; no polling PowerShell,
// temporary images, thumbnail sampling, focus changes or synthetic clicks.
struct LiveFrames {
    std::mutex mutex;
    std::condition_variable ready;
    Direct3D11CaptureFrame latest{nullptr};
    int64_t timestamp = -1;
    HRESULT error = S_OK;
    bool stopped = false;
};
static int integer(const wchar_t* value) {
    wchar_t* end = nullptr;
    const auto result = wcstoll(value, &end, 10);
    if (*end || result < LONG_MIN || result > LONG_MAX) throw hresult_invalid_argument();
    return int(result);
}
static void run(RECT region, DWORD owner, bool snapshotOnly, HWND window = nullptr, DWORD windowPid = 0) {
    int width = region.right - region.left, height = region.bottom - region.top;
    if (!window) validSize(width, height);
    POINT center{region.left + width / 2, region.top + height / 2};
    const auto monitor = MonitorFromPoint(center, MONITOR_DEFAULTTONULL);
    MONITORINFO initial{sizeof(MONITORINFO)};
    if (!window && (!monitor || !GetMonitorInfo(monitor, &initial) || region.left < initial.rcMonitor.left ||
        region.top < initial.rcMonitor.top || region.right > initial.rcMonitor.right || region.bottom > initial.rcMonitor.bottom))
        throw hresult_invalid_argument();
    if (snapshotOnly && !window) { snapshot(region, monitor, initial); return; }
    const auto target = snapshotOnly ? nullptr : GetAncestor(WindowFromPoint(center), GA_ROOT);
    DWORD expected = 0;
    if(!snapshotOnly)GetWindowThreadProcessId(target, &expected);
    if (!snapshotOnly && (!target || !expected || expected == owner)) throw hresult_error(E_INVALIDARG, L"请选择其他应用的滚动内容");
    if(!snapshotOnly)validWindow(target, expected, owner);
    RECT targetBounds{};
    if (!snapshotOnly && !GetWindowRect(target, &targetBounds)) throw hresult_invalid_argument();
    const auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    GraphicsCaptureItem item{nullptr};
    if (window) {
        validWindow(window, windowPid, owner);
        check_hresult(interop->CreateForWindow(window, guid_of<GraphicsCaptureItem>(), put_abi(item)));
    } else check_hresult(interop->CreateForMonitor(monitor, guid_of<GraphicsCaptureItem>(), put_abi(item)));
    const auto size = item.Size();
    validSize(size.Width, size.Height);
    if (window) { width = size.Width; height = size.Height; }
    else if (size.Width != initial.rcMonitor.right - initial.rcMonitor.left || size.Height != initial.rcMonitor.bottom - initial.rcMonitor.top)
        throw hresult_error(E_FAIL, L"显示器像素尺寸已改变");
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
    com_ptr<IInspectable> inspectable;
    check_hresult(CreateDirect3D11DeviceFromDXGIDevice(device.as<IDXGIDevice>().get(), inspectable.put()));
    const auto pool = Direct3D11CaptureFramePool::CreateFreeThreaded(inspectable.as<IDirect3DDevice>(), DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
    const auto state = std::make_shared<LiveFrames>();
    const auto event = pool.FrameArrived([state](const auto& sender, const auto&) {
        std::lock_guard lock(state->mutex);
        if (state->stopped) return;
        try {
            // Drain the queue and keep compositor timestamps monotonic. Callback
            // scheduling must never replace a newer surface with an older one.
            while (auto next = sender.TryGetNextFrame()) {
                const auto timestamp = next.SystemRelativeTime().count();
                if (timestamp > state->timestamp) {
                    if (state->latest) state->latest.Close();
                    state->latest = next;
                    state->timestamp = timestamp;
                } else next.Close();
            }
        } catch (...) { state->error = to_hresult(); }
        state->ready.notify_one();
    });
    auto session = pool.CreateCaptureSession(item);
    com_ptr<ID3D11Texture2D> staging;
    std::vector<uint8_t> pixels(size_t(width) * height * 4);
    int64_t deliveredTimestamp = -1;
    if (winrt::Windows::Foundation::Metadata::ApiInformation::IsPropertyPresent(L"Windows.Graphics.Capture.GraphicsCaptureSession", L"IsCursorCaptureEnabled"))
        session.IsCursorCaptureEnabled(false);
    const auto close = [&] {
        { std::lock_guard lock(state->mutex); state->stopped = true; }
        pool.FrameArrived(event); session.Close();
        { std::lock_guard lock(state->mutex); if (state->latest) state->latest.Close(); state->latest = nullptr; }
        pool.Close();
    };
    try {
        session.StartCapture();
        std::cout << "{\"ready\":true}\n" << std::flush;
        std::string command;
        while (std::getline(std::cin, command)) {
            if (command == "stop") break;
            MONITORINFO current{sizeof(MONITORINFO)};
            if (!window && (!GetMonitorInfo(monitor, &current) || memcmp(&current.rcMonitor, &initial.rcMonitor, sizeof(RECT))))
                throw hresult_error(E_FAIL, L"显示器已断开或位置、分辨率已改变");
            if (window) validWindow(window, windowPid, owner);
            if(!snapshotOnly)validWindow(target, expected, owner);
            RECT nextBounds{};
            if (!snapshotOnly && (!GetWindowRect(target, &nextBounds) || memcmp(&nextBounds, &targetBounds, sizeof(RECT))))
                throw hresult_error(E_FAIL, L"目标窗口已移动或改变尺寸，请确认已有结果");
            const auto canScroll = [&] {
                if(snapshotOnly)return false;
                POINT cursor{}; GetCursorPos(&cursor);
                const bool focused = GetAncestor(GetForegroundWindow(), GA_ROOT) == target &&
                    GetAncestor(WindowFromPoint(cursor), GA_ROOT) == target && PtInRect(&region, cursor);
                const bool keys = (GetAsyncKeyState(VK_CONTROL) | GetAsyncKeyState(VK_SHIFT) | GetAsyncKeyState(VK_MENU) |
                    GetAsyncKeyState(VK_LBUTTON) | GetAsyncKeyState(VK_RBUTTON) | GetAsyncKeyState(VK_LWIN) | GetAsyncKeyState(VK_RWIN)) & 0x8000;
                return focused && !keys;
            };
            const auto available = [&] {
                if (snapshotOnly || GetAncestor(GetForegroundWindow(), GA_ROOT) != target) return false;
                POINT points[]{{region.left + 2, region.top + 2}, {region.right - 3, region.top + 2},
                    {region.left + 2, region.bottom - 3}, {region.right - 3, region.bottom - 3},
                    {(region.left + region.right) / 2, (region.top + region.bottom) / 2}};
                for (const auto point : points) if (GetAncestor(WindowFromPoint(point), GA_ROOT) != target) return false;
                return true;
            };
            if (command == "visible") {
                std::cout << "{\"visible\":" << (available() ? "true" : "false") << "}\n" << std::flush;
                continue;
            }
            if (command == "activate manual" || command == "activate auto") {
                POINT point{(region.left + region.right) / 2, (region.top + region.bottom) / 2};
                const bool keys = (GetAsyncKeyState(VK_CONTROL) | GetAsyncKeyState(VK_SHIFT) | GetAsyncKeyState(VK_MENU) |
                    GetAsyncKeyState(VK_LBUTTON) | GetAsyncKeyState(VK_RBUTTON) | GetAsyncKeyState(VK_LWIN) | GetAsyncKeyState(VK_RWIN)) & 0x8000;
                bool activated = !snapshotOnly && !keys && GetAncestor(WindowFromPoint(point), GA_ROOT) == target;
                DWORD foregroundPid = 0;
                bool foregroundSet = false;
                const char* reason = snapshotOnly ? "snapshot" : keys ? "keys" : !activated ? "point" : "foreground";
                if (activated) {
                    MSG message{};
                    PeekMessageW(&message, nullptr, 0, 0, PM_NOREMOVE);
                    foregroundSet = SetForegroundWindow(target) != FALSE;
                    // Activation in another input queue may complete after SetForegroundWindow returns.
                    const auto deadline = GetTickCount64() + 250;
                    while (GetAncestor(GetForegroundWindow(), GA_ROOT) != target && GetTickCount64() < deadline) {
                        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
                            TranslateMessage(&message); DispatchMessageW(&message);
                        }
                        Sleep(10);
                    }
                    activated = available(); reason = GetAncestor(GetForegroundWindow(), GA_ROOT) != target ? "foreground" : "region";
                }
                if (activated && command == "activate auto") activated = SetCursorPos(point.x, point.y) != FALSE && canScroll();
                GetWindowThreadProcessId(GetForegroundWindow(), &foregroundPid);
                std::cout << "{\"activated\":" << (activated ? "true" : "false") << ",\"reason\":\"" << (activated ? "ok" : reason)
                    << "\",\"foregroundPid\":" << foregroundPid << ",\"targetPid\":" << expected
                    << ",\"foregroundSet\":" << (foregroundSet ? "true" : "false") << "}\n" << std::flush;
                continue;
            }
            if (command == "guard") {
                std::cout << "{\"focused\":" << (canScroll() ? "true" : "false") << "}\n" << std::flush;
                continue;
            }
            if (command.starts_with("wheel ")) {
                std::istringstream input(command);
                std::string verb, axis; int delta = 0;
                input >> verb >> axis >> delta;
                bool sent = false;
                if (canScroll() && (axis == "v" || axis == "h") && delta >= -360 && delta <= 360 && delta != 0) {
                    INPUT wheel{}; wheel.type = INPUT_MOUSE;
                    wheel.mi.dwFlags = axis == "v" ? MOUSEEVENTF_WHEEL : MOUSEEVENTF_HWHEEL;
                    wheel.mi.mouseData = DWORD(delta);
                    sent = SendInput(1, &wheel, sizeof(INPUT)) == 1;
                }
                std::cout << "{\"scroll\":" << (sent ? "true" : "false") << "}\n" << std::flush;
                continue;
            }
            const bool rawPixels = command == "pixels" || command == "pixels fresh";
            if (command != "frame" && command != "frame fresh" && !rawPixels) throw hresult_invalid_argument();
            if (rawPixels && (snapshotOnly || window || pixels.size() > 40000000)) throw hresult_invalid_argument();
            const auto started = std::chrono::steady_clock::now();
            std::unique_lock lock(state->mutex);
            // A frame produced since the previous delivery is already fresh.
            // Static sources may produce no new frame; don't restart WGC for them.
            if((command=="frame fresh" || command=="pixels fresh") && state->latest && state->timestamp <= deliveredTimestamp)
                state->ready.wait_for(lock,std::chrono::milliseconds(100),[&]{return state->timestamp>deliveredTimestamp || FAILED(state->error);});
            if (!state->ready.wait_for(lock, std::chrono::milliseconds(2500), [&] { return state->latest || FAILED(state->error); }))
                throw hresult_error(HRESULT_FROM_WIN32(WAIT_TIMEOUT), L"显示器没有返回可捕获帧");
            check_hresult(state->error);
            const auto content = state->latest.ContentSize();
            if (content.Width != size.Width || content.Height != size.Height) throw hresult_error(E_FAIL, L"采集期间显示器尺寸改变");
            const auto access = state->latest.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
            com_ptr<ID3D11Texture2D> texture;
            check_hresult(access->GetInterface(guid_of<ID3D11Texture2D>(), texture.put_void()));
            D3D11_TEXTURE2D_DESC description{}; texture->GetDesc(&description);
            if (description.Format != DXGI_FORMAT_B8G8R8A8_UNORM || description.Width < UINT(size.Width) || description.Height < UINT(size.Height))
                throw hresult_error(E_FAIL, L"显示器像素格式改变");
            description.Width = width; description.Height = height;
            description.MipLevels = 1; description.ArraySize = 1;
            description.Usage = D3D11_USAGE_STAGING; description.BindFlags = 0;
            description.CPUAccessFlags = D3D11_CPU_ACCESS_READ; description.MiscFlags = 0;
            if (!staging) check_hresult(device->CreateTexture2D(&description, nullptr, staging.put()));
            const UINT x = window ? 0 : region.left - initial.rcMonitor.left, y = window ? 0 : region.top - initial.rcMonitor.top;
            const D3D11_BOX box{x, y, 0, x + UINT(width), y + UINT(height), 1};
            context->CopySubresourceRegion(staging.get(), 0, 0, 0, 0, texture.get(), 0, &box);
            D3D11_MAPPED_SUBRESOURCE mapped{};
            check_hresult(context->Map(staging.get(), 0, D3D11_MAP_READ, 0, &mapped));
            for (int row = 0; row < height; ++row)
                memcpy(pixels.data() + size_t(row) * width * 4, static_cast<const uint8_t*>(mapped.pData) + size_t(row) * mapped.RowPitch, size_t(width) * 4);
            context->Unmap(staging.get(), 0);
            deliveredTimestamp = state->timestamp;
            lock.unlock();
            const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
            if(rawPixels){
                std::cout << "{\"version\":1,\"format\":\"bgra8\",\"backend\":\"wgc\",\"width\":" << width << ",\"height\":" << height
                    << ",\"stride\":" << size_t(width)*4 << ",\"bytes\":" << pixels.size() << ",\"elapsed\":" << elapsed << "}\n";
                std::cout.write(reinterpret_cast<const char*>(pixels.data()),pixels.size());std::cout.flush();
            }else if (!snapshotOnly || !transport(pixels, width, height, elapsed)) encode(pixels, width, height, elapsed);
            SecureZeroMemory(pixels.data(), pixels.size());
        }
    } catch (...) { close(); throw; }
    close();
}
int wmain(int argc, wchar_t** argv) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    _setmode(_fileno(stdout), _O_BINARY);
    try {
        init_apartment(apartment_type::multi_threaded);
        if (argc == 2 && wcscmp(argv[1], L"--self-test-png") == 0) {
            const UINT width = 257, height = 83;
            std::vector<uint8_t> pixels(width * height * 4);
            for (UINT y = 0; y < height; y++) for (UINT x = 0; x < width; x++) {
                const auto at = (y * width + x) * 4;
                pixels[at] = uint8_t(x); pixels[at + 1] = uint8_t(y); pixels[at + 2] = uint8_t(x + y); pixels[at + 3] = 255;
            }
            if (!transport(pixels, width, height, 0)) return 1;
            return 0;
        }
        if (argc == 5 && wcscmp(argv[1], L"window") == 0) {
            const auto expected = number(argv[3]), owner = number(argv[4]);
            if (expected > MAXDWORD || owner > MAXDWORD) throw hresult_invalid_argument();
            run({}, DWORD(owner), true, reinterpret_cast<HWND>(number(argv[2])), DWORD(expected));
            uninit_apartment(); return 0;
        }
        if (argc != 6 && argc != 7) throw hresult_invalid_argument();
        if(argc==7 && wcscmp(argv[6],L"snapshot")!=0)throw hresult_invalid_argument();
        const auto owner = number(argv[5]);
        if (owner > MAXDWORD) throw hresult_invalid_argument();
        RECT region{integer(argv[1]), integer(argv[2]), integer(argv[3]), integer(argv[4])};
        if (int64_t(region.right) - region.left > 16384 || int64_t(region.bottom) - region.top > 16384) throw hresult_invalid_argument();
        run(region, DWORD(owner), argc==7);
        uninit_apartment(); return 0;
    } catch (const hresult_error& error) {
        std::cerr << "Scroll capture failed: " << to_string(error.message()) << std::endl;
    } catch (...) { std::cerr << "Scroll capture failed" << std::endl; }
    return 1;
}
