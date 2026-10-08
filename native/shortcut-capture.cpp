#include <windows.h>
#include <cstdio>
#include <cstdlib>
#include <initializer_list>
#include <thread>

namespace {
constexpr UINT captured = WM_APP + 1;
constexpr UINT released = WM_APP + 2;
DWORD messageThread = 0;
HWND owner = nullptr;
HHOOK hook = nullptr;
bool ctrl = false, alt = false, shift = false, win = false;
bool down[256] = {};

bool modifier(DWORD key) {
  return key == VK_CONTROL || key == VK_LCONTROL || key == VK_RCONTROL ||
    key == VK_MENU || key == VK_LMENU || key == VK_RMENU ||
    key == VK_SHIFT || key == VK_LSHIFT || key == VK_RSHIFT ||
    key == VK_LWIN || key == VK_RWIN;
}
void updateModifier(DWORD key, bool pressed) {
  down[key] = pressed;
  ctrl = down[VK_CONTROL] || down[VK_LCONTROL] || down[VK_RCONTROL];
  alt = down[VK_MENU] || down[VK_LMENU] || down[VK_RMENU];
  shift = down[VK_SHIFT] || down[VK_LSHIFT] || down[VK_RSHIFT];
  win = down[VK_LWIN] || down[VK_RWIN];
}
LRESULT CALLBACK keyboard(int code, WPARAM action, LPARAM data) {
  if (code < 0) return CallNextHookEx(hook, code, action, data);
  const auto* key = reinterpret_cast<const KBDLLHOOKSTRUCT*>(data);
  if (key->vkCode >= 256 || GetForegroundWindow() != owner)
    return CallNextHookEx(hook, code, action, data);
  const bool pressed = action == WM_KEYDOWN || action == WM_SYSKEYDOWN;
  const bool lifted = action == WM_KEYUP || action == WM_SYSKEYUP;
  if (!pressed && !lifted) return CallNextHookEx(hook, code, action, data);
  const DWORD vk = key->vkCode;
  // Keep bare Tab available for keyboard navigation out of the field.
  if (vk == VK_TAB && !ctrl && !alt && !shift && !win) return CallNextHookEx(hook, code, action, data);
  if (modifier(vk)) updateModifier(vk, pressed);
  if (pressed) {
    if (!modifier(vk) && !down[vk]) {
      const WPARAM packed = vk | (ctrl ? 1u << 8 : 0) | (alt ? 1u << 9 : 0) |
        (shift ? 1u << 10 : 0) | (win ? 1u << 11 : 0);
      PostThreadMessageW(messageThread, captured, packed, 0);
    }
    down[vk] = true;
  } else {
    down[vk] = false;
    if (!ctrl && !alt && !shift && !win) PostThreadMessageW(messageThread, released, 0, 0);
  }
  return 1;
}
} // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc != 2) return 2;
  owner = reinterpret_cast<HWND>(_wcstoui64(argv[1], nullptr, 10));
  if (!IsWindow(owner)) return 3;
  messageThread = GetCurrentThreadId();
  MSG message;
  PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  for (const int vk : {VK_CONTROL, VK_LCONTROL, VK_RCONTROL, VK_MENU, VK_LMENU, VK_RMENU,
                       VK_SHIFT, VK_LSHIFT, VK_RSHIFT, VK_LWIN, VK_RWIN})
    down[vk] = (GetAsyncKeyState(vk) & 0x8000) != 0;
  ctrl = down[VK_CONTROL] || down[VK_LCONTROL] || down[VK_RCONTROL];
  alt = down[VK_MENU] || down[VK_LMENU] || down[VK_RMENU];
  shift = down[VK_SHIFT] || down[VK_LSHIFT] || down[VK_RSHIFT];
  win = down[VK_LWIN] || down[VK_RWIN];
  hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard, GetModuleHandleW(nullptr), 0);
  if (!hook) return 4;
  std::thread input([] {
    char line[16];
    while (fgets(line, sizeof(line), stdin) && line[0] != 'q') {}
    PostThreadMessageW(messageThread, WM_QUIT, 0, 0);
  });
  input.detach();
  puts("{\"ready\":true}"); fflush(stdout);
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    if (message.message == captured) {
      const auto value = static_cast<unsigned>(message.wParam);
      printf("{\"vk\":%u,\"ctrlKey\":%s,\"altKey\":%s,\"shiftKey\":%s,\"metaKey\":%s}\n",
        value & 255, value & (1u << 8) ? "true" : "false", value & (1u << 9) ? "true" : "false",
        value & (1u << 10) ? "true" : "false", value & (1u << 11) ? "true" : "false");
      fflush(stdout);
    } else if (message.message == released) { puts("{\"released\":true}"); fflush(stdout); }
  }
  UnhookWindowsHookEx(hook);
  return 0;
}
