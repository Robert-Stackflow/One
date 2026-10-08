#include <windows.h>
#include <cstdio>

int wmain() {
  if (!RegisterHotKey(nullptr, 1, MOD_CONTROL | MOD_ALT | MOD_SHIFT, VK_F23)) {
    printf("{\"error\":%lu}\n", GetLastError()); fflush(stdout);
    return 1;
  }
  puts("{\"ready\":true}"); fflush(stdout);
  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    if (message.message == WM_HOTKEY) {
      puts("{\"triggered\":true}"); fflush(stdout);
    }
  }
  UnregisterHotKey(nullptr, 1);
  return 0;
}
