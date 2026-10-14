#define NOMINMAX
#include <windows.h>
#include <iostream>
#include <string>
#include <sstream>
#include <thread>
#include <vector>
#include <algorithm>
static int offsetY = 0, offsetX = 0;
static int wheelEvents=0,lastWheelNotches=0,delayMs=0,delayedOffset=0;
static HWND fixture;
static void report() {
    RECT r{}; GetClientRect(fixture, &r);
    POINT origin{}; ClientToScreen(fixture, &origin);
    std::cout << "{\"x\":" << origin.x << ",\"y\":" << origin.y << ",\"width\":" << r.right
      << ",\"height\":" << r.bottom << ",\"hwnd\":" << reinterpret_cast<uintptr_t>(fixture)
      << ",\"offsetY\":" << offsetY << ",\"offsetX\":" << offsetX << ",\"wheelEvents\":" << wheelEvents << ",\"lastWheelNotches\":" << lastWheelNotches << "}\n" << std::flush;
}
static LRESULT CALLBACK procedure(HWND w, UINT message, WPARAM p, LPARAM l) {
    if (message == WM_PAINT) {
        PAINTSTRUCT ps{}; const auto dc = BeginPaint(w, &ps);
        RECT r{}; GetClientRect(w, &r);
        const int width = r.right, height = r.bottom;
        std::vector<uint32_t> pixels(size_t(width) * height);
        for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {
            uint32_t value = uint32_t(x + offsetX + 17) * 1103515245u ^ uint32_t(y - 20 + offsetY + 31) * 2654435761u;
            value ^= value >> 13; value *= 2246822519u; value ^= value >> 16;
            pixels[size_t(y) * width + x] = y < 20 || y >= height - 12 ? 0xffa0a0a0 : 0xff000000 | (value & 0xffffff);
        }
        BITMAPINFO info{}; info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        info.bmiHeader.biWidth = width; info.bmiHeader.biHeight = -height;
        info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB;
        SetDIBitsToDevice(dc, 0, 0, width, height, 0, 0, 0, height, pixels.data(), &info, DIB_RGB_COLORS);
        EndPaint(w, &ps); return 0;
    }
    if (message == WM_MOUSEWHEEL) {
        wheelEvents++;lastWheelNotches=std::abs(GET_WHEEL_DELTA_WPARAM(p)/120);
        const auto next=std::clamp(offsetY-GET_WHEEL_DELTA_WPARAM(p)/120*39,0,180);
        if(delayMs){delayedOffset=next;SetTimer(w,1,delayMs,nullptr);delayMs=0;return 0;}
        offsetY=next;InvalidateRect(w,nullptr,FALSE);return 0;
    }
    if(message==WM_TIMER&&p==1){KillTimer(w,1);offsetY=delayedOffset;InvalidateRect(w,nullptr,FALSE);UpdateWindow(w);return 0;}
    if (message == WM_MOUSEHWHEEL) { wheelEvents++;lastWheelNotches=std::abs(GET_WHEEL_DELTA_WPARAM(p)/120);offsetX = std::clamp(offsetX + GET_WHEEL_DELTA_WPARAM(p) / 120 * 39, 0, 180); InvalidateRect(w, nullptr, FALSE); return 0; }
    if (message == WM_APP + 1) { KillTimer(w,1);offsetY = int(p); InvalidateRect(w, nullptr, FALSE); UpdateWindow(w); report(); return 0; }
    if(message==WM_APP+6){delayMs=int(p);report();return 0;}
    if (message == WM_APP + 2) { offsetX = int(p); InvalidateRect(w, nullptr, FALSE); UpdateWindow(w); report(); return 0; }
    if (message == WM_APP + 3) {
        ShowWindow(w, SW_SHOWNORMAL);
        SetWindowPos(w, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        SetForegroundWindow(w); report(); return 0;
    }
    if (message == WM_APP + 4) { SetWindowPos(w, nullptr, 40, 40, 0, 0, SWP_NOSIZE | SWP_NOZORDER); report(); return 0; }
    if (message == WM_APP + 5) { report(); return 0; }
    if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProc(w, message, p, l);
}
int wmain(int argc,wchar_t**argv) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    WNDCLASS cls{}; cls.lpfnWndProc = procedure; cls.hInstance = GetModuleHandle(nullptr);
    cls.lpszClassName = L"OneScrollFixture"; cls.hCursor = LoadCursor(nullptr, IDC_ARROW); RegisterClass(&cls);
    RECT r{0, 0, 480, argc>1&&std::wstring(argv[1])==L"--tall"?640:360}; AdjustWindowRectEx(&r, WS_OVERLAPPEDWINDOW, FALSE, 0);
    fixture = CreateWindow(cls.lpszClassName, L"One scroll pixel fixture", WS_OVERLAPPEDWINDOW | WS_VISIBLE,
      140, 120, r.right - r.left, r.bottom - r.top, nullptr, nullptr, cls.hInstance, nullptr);
    ShowWindow(fixture, SW_SHOWNORMAL);
    SetWindowPos(fixture, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    SetForegroundWindow(fixture); UpdateWindow(fixture); report();
    std::thread([] {
        std::string line;
        while (std::getline(std::cin, line)) {
            if (line == "quit") { PostMessage(fixture, WM_CLOSE, 0, 0); return; }
            if (line == "focus") PostMessage(fixture, WM_APP + 3, 0, 0);
            else if (line == "move") PostMessage(fixture, WM_APP + 4, 0, 0);
            else if (line == "state") PostMessage(fixture, WM_APP + 5, 0, 0);
            else if (line.starts_with("click ")) {
                std::istringstream coordinates(line.substr(6)); int x=0,y=0; coordinates>>x>>y;
                SetCursorPos(x,y); INPUT input[2]{}; input[0].type=input[1].type=INPUT_MOUSE;
                input[0].mi.dwFlags=MOUSEEVENTF_LEFTDOWN; input[1].mi.dwFlags=MOUSEEVENTF_LEFTUP;
                SendInput(2,input,sizeof(INPUT)); Sleep(80); PostMessage(fixture,WM_APP+5,0,0);
            }
            else if (line.starts_with("step ")) PostMessage(fixture, WM_APP + 1, std::stoi(line.substr(5)), 0);
            else if (line.starts_with("delay ")) PostMessage(fixture,WM_APP+6,std::stoi(line.substr(6)),0);
            else if (line.starts_with("right ")) PostMessage(fixture, WM_APP + 2, std::stoi(line.substr(6)), 0);
        }
        PostMessage(fixture, WM_CLOSE, 0, 0);
    }).detach();
    MSG m{}; while (GetMessage(&m, nullptr, 0, 0) > 0) { TranslateMessage(&m); DispatchMessage(&m); }
}
