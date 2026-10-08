#include "hotkey-probe-shared.h"

extern "C" __declspec(dllexport) LRESULT CALLBACK OneHotkeyProbeHook(int code, WPARAM removed, LPARAM value) {
  if (code == HC_ACTION && removed == PM_REMOVE) {
    auto* message = reinterpret_cast<MSG*>(value);
    if (message && message->message == WM_HOTKEY) {
      HANDLE mapping = OpenFileMappingW(FILE_MAP_READ | FILE_MAP_WRITE, FALSE, OneHotkeyProbeMapping);
      if (mapping) {
        auto* state = static_cast<OneHotkeyProbeState*>(MapViewOfFile(mapping, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, sizeof(OneHotkeyProbeState)));
        if (state) {
          if (state->magic == OneHotkeyProbeMagic && state->phase == 1 && !state->stop &&
              state->scannerPid != static_cast<LONG>(GetCurrentProcessId()) &&
              HIWORD(message->lParam) == state->key &&
              (LOWORD(message->lParam) & 0xf) == state->modifiers &&
              InterlockedCompareExchange(&state->winner, 1, 0) == 0) {
            state->pid = static_cast<LONG>(GetCurrentProcessId());
            state->tid = static_cast<LONG>(GetCurrentThreadId());
            InterlockedExchange(&state->winner, 2);
            // Only the single confirmed WM_HOTKEY is suppressed. Hook-based
            // shortcuts may still respond before this callback runs.
            if (state->suppress) message->message = WM_NULL;
          }
          UnmapViewOfFile(state);
        }
        CloseHandle(mapping);
      }
    }
  }
  return CallNextHookEx(nullptr, code, removed, value);
}

BOOL WINAPI DllMain(HINSTANCE, DWORD, LPVOID) { return TRUE; }
