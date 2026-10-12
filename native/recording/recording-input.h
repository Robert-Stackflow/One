#pragma once
#include <future>
#include <fstream>
#include <array>
namespace one_video {
// Hook callbacks only collect virtual keys and physical pointer coordinates.
// They never suppress input, read control text, or perform file / IPC writes.
class InputTracker {
    struct Event { int kind; int64_t tick; int a, b, c; };
    unsigned flags;
    DWORD owner;
    HWND target;
    HMONITOR monitor;
    RECT crop, bounds;
    int width, height;
    bool fixture, active = false, inside = false, overflow = false;
    std::array<bool, 256> held{};
    int64_t lastMove = 0, lastSample = 0;
    unsigned count = 0;
    std::mutex mutex;
    std::deque<Event> queue;
    std::thread thread;
    DWORD threadId = 0;
    std::ofstream journal;
    std::wstring journalPath;
    inline static thread_local InputTracker* current = nullptr;
    bool foreground() const {
        const auto window = GetForegroundWindow(); DWORD pid = 0;
        GetWindowThreadProcessId(window, &pid);
        if (!window || pid == owner) return false;
        if (target) return GetAncestor(window, GA_ROOT) == target;
        return MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST) == monitor;
    }
    void push(Event event) {
        if (queue.size() >= 512) { overflow = true; active = false; return; }
        queue.push_back(event);
    }
    void key(int vk, bool down, bool allowed) {
        std::lock_guard lock(mutex);
        if (vk < 1 || vk > 254) return;
        const bool repeat = held[vk]; held[vk] = down;
        if (!down || repeat || !active || !allowed || !(flags & 3)) return;
        const bool modifier = vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL || vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT ||
            vk == VK_MENU || vk == VK_LMENU || vk == VK_RMENU || vk == VK_LWIN || vk == VK_RWIN;
        if (modifier && (flags & 3) != 2) return;
        const int modifiers = (held[VK_CONTROL] || held[VK_LCONTROL] || held[VK_RCONTROL] ? 1 : 0) |
            (held[VK_SHIFT] || held[VK_LSHIFT] || held[VK_RSHIFT] ? 2 : 0) |
            (held[VK_MENU] || held[VK_LMENU] || held[VK_RMENU] ? 4 : 0) | (held[VK_LWIN] || held[VK_RWIN] ? 8 : 0);
        if ((flags & 3) == 1 && !(modifiers & 13) && !(vk >= VK_F1 && vk <= VK_F24) &&
            !(vk >= VK_PRIOR && vk <= VK_DOWN) && vk != VK_ESCAPE && vk != VK_TAB && vk != VK_RETURN && vk != VK_DELETE) return;
        push({0, clockTime(), vk, modifiers, 0});
    }
    void mouse(int kind, POINT point, int button, bool allowed) {
        std::lock_guard lock(mutex);
        if (!active) return;
        const int x = point.x - bounds.left - crop.left, y = point.y - bounds.top - crop.top;
        const int cw = crop.right - crop.left, ch = crop.bottom - crop.top;
        if (!allowed || x < 0 || y < 0 || x >= cw || y >= ch) {
            if (inside && (flags & 8)) push({4, clockTime(), 0, 0, 0}); inside = false; return;
        }
        inside = true;
        if (kind == 1 ? !(flags & 8) : !(flags & 4)) return;
        const auto tick = clockTime();
        if (kind == 1 && tick - lastMove < 333333) return;
        if (kind == 1) lastMove = tick;
        push({kind, tick, int(int64_t(x) * width / cw), int(int64_t(y) * height / ch), button});
    }
    static LRESULT CALLBACK keyboard(int code, WPARAM message, LPARAM value) {
        if (code == HC_ACTION && current) {
            const auto data = reinterpret_cast<KBDLLHOOKSTRUCT*>(value);
            if (!(data->flags & LLKHF_INJECTED)) current->key(int(data->vkCode), message == WM_KEYDOWN || message == WM_SYSKEYDOWN, current->foreground());
        }
        return CallNextHookEx(nullptr, code, message, value);
    }
    static LRESULT CALLBACK pointer(int code, WPARAM message, LPARAM value) {
        if (code == HC_ACTION && current) {
            const auto data = reinterpret_cast<MSLLHOOKSTRUCT*>(value);
            if (!(data->flags & LLMHF_INJECTED)) {
                const auto window = WindowFromPoint(data->pt);
                DWORD pid = 0; GetWindowThreadProcessId(window, &pid);
                int kind = -1, button = 0;
                if (message == WM_MOUSEMOVE) kind = 1;
                else if (message == WM_LBUTTONDOWN) { kind = 2; button = 1; }
                else if (message == WM_RBUTTONDOWN) { kind = 2; button = 2; }
                else if (message == WM_MBUTTONDOWN) { kind = 2; button = 3; }
                else if (message == WM_XBUTTONDOWN) { kind = 2; button = HIWORD(data->mouseData) == XBUTTON1 ? 4 : 5; }
                else if (message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL) { kind = 3; button = std::clamp(int(SHORT(HIWORD(data->mouseData))) / WHEEL_DELTA, -20, 20); }
                if (kind >= 0 && (kind != 3 || button)) current->mouse(kind, data->pt, button, pid != current->owner && (!current->target || GetAncestor(window, GA_ROOT) == current->target));
            }
        }
        return CallNextHookEx(nullptr, code, message, value);
    }
    void stopHooks() {
        if (thread.joinable()) { PostThreadMessageW(threadId, WM_QUIT, 0, 0); thread.join(); }
        threadId = 0;
    }
    void startHooks() {
        if (fixture || !flags) return; // Tests never install desktop hooks or synthesize OS input.
        std::promise<DWORD> started; auto ready = started.get_future();
        thread = std::thread([this, started = std::move(started)]() mutable {
            current = this; threadId = GetCurrentThreadId(); MSG message{}; PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
            for (int i = 1; i < 255; i++) held[i] = (GetAsyncKeyState(i) & 0x8000) != 0;
            HHOOK kh = nullptr, mh = nullptr; DWORD error = 0;
            if (this->flags & 3) { kh = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard, GetModuleHandleW(nullptr), 0); if (!kh) error = GetLastError(); }
            if ((this->flags & 12) && !error) { mh = SetWindowsHookExW(WH_MOUSE_LL, pointer, GetModuleHandleW(nullptr), 0); if (!mh) error = GetLastError(); }
            started.set_value(error);
            if (!error) while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
            if (kh) UnhookWindowsHookEx(kh); if (mh) UnhookWindowsHookEx(mh); current = nullptr;
        });
        const auto error = ready.get(); if (error) { thread.join(); throw hresult_error(HRESULT_FROM_WIN32(error), L"无法启用键鼠回显"); }
    }
public:
    InputTracker(unsigned initialFlags, DWORD owner, HWND target, HMONITOR monitor, RECT bounds, RECT crop, int width, int height, bool fixture, const std::wstring& path)
        : flags(0), owner(owner), target(target), monitor(monitor), bounds(bounds), crop(crop), width(width), height(height), fixture(fixture), journalPath(path + L".input.jsonl") {
        configure(initialFlags);
    }
    ~InputTracker() { stopHooks(); }
    void configure(unsigned value) {
        if (value > 14 || (value & 3) == 3) throw hresult_invalid_argument();
        if (value == flags) return;
        if (value && !journal.is_open()) {
            journal.open(std::filesystem::path(journalPath), std::ios::binary | std::ios::out | std::ios::app);
            if (!journal) throw hresult_error(E_FAIL, L"无法创建键鼠时间轴");
        }
        // Join without holding the callback mutex. No hooks remain while flags change.
        stopHooks();
        {
            std::lock_guard lock(mutex);
            if (inside && active && (flags & 8)) push({4, clockTime(), 0, 0, 0});
            flags = value; inside = false; lastMove = 0; held.fill(false);
        }
        startHooks();
    }
    void enable(bool value) { std::lock_guard lock(mutex); active = value; if (!value) inside = false; }
    void location(RECT value) { std::lock_guard lock(mutex); bounds = value; }
    void region(RECT value) {
        std::lock_guard lock(mutex);
        crop = value;
        if (inside && active && (flags & 8)) push({4, clockTime(), 0, 0, 0});
        inside = false; lastMove = 0;
    }
    void fixtureEvent(std::istringstream& command) {
        if (!fixture) throw hresult_invalid_argument();
        std::string type; int a = 0, b = 0, c = 0; command >> type >> a >> b;
        if (!command) throw hresult_invalid_argument();
        if (type == "key") { if (a < 1 || a > 254 || (b != 0 && b != 1)) throw hresult_invalid_argument(); key(a, b != 0, true); }
        else {
            command >> c;
            if (!command || (type != "move" && type != "click" && type != "wheel") || (type == "click" && (c < 1 || c > 5)) || (type == "wheel" && (!c || c < -20 || c > 20))) throw hresult_invalid_argument();
            mouse(type == "move" ? 1 : type == "click" ? 2 : 3, POINT{a,b}, c, true);
        }
    }
    void drain(const one_audio::Timeline& timeline, int64_t end) {
        std::deque<Event> batch;
        { std::lock_guard lock(mutex); if (overflow) throw hresult_error(E_FAIL, L"键鼠事件过于密集，录制已停止并保留"); batch.swap(queue); }
        std::string output; unsigned n = 0;
        const auto flush = [&] { if (!n) return; std::cout << "{\"kind\":\"input\",\"events\":[" << output << "]}\n" << std::flush; output.clear(); n = 0; };
        for (const auto& event : batch) {
            if (count >= 200000) throw hresult_error(E_FAIL, L"已达到键鼠事件上限，录制已停止并保留");
            const auto sample = std::max(lastSample, std::min(end, timeline.position(event.tick))); lastSample = sample;
            const char* names[]{"key", "move", "click", "wheel", "leave"};
            std::ostringstream line; line << "{\"id\":" << ++count << ",\"sample\":" << sample << ",\"kind\":\"" << names[event.kind] << "\"";
            if (event.kind == 0) line << ",\"vk\":" << event.a << ",\"modifiers\":" << event.b;
            else if (event.kind != 4) line << ",\"x\":" << event.a << ",\"y\":" << event.b << ",\"button\":" << event.c;
            line << "}"; const auto json = line.str(); journal << json << '\n';
            if (n++) output += ','; output += json; if (n == 16) flush();
        }
        if (!batch.empty()) { journal.flush(); if (!journal) throw hresult_error(E_FAIL, L"键鼠时间轴写入失败，录制已保留"); }
        flush();
    }
};
}
