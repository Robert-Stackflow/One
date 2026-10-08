#include "hotkey-probe-shared.h"
#include <sddl.h>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace {
using Hook = LRESULT(CALLBACK*)(int, WPARAM, LPARAM);
constexpr DWORD timeoutMs = 90000;

std::wstring sibling(const wchar_t* name) {
  wchar_t file[MAX_PATH]{};
  if (!GetModuleFileNameW(nullptr, file, MAX_PATH)) return {};
  auto* slash = wcsrchr(file, L'\\');
  if (!slash) return {};
  *(slash + 1) = 0;
  return std::wstring(file) + name;
}

std::string utf8(const wchar_t* value) {
  const int length = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  if (length < 1) return {};
  std::string text(static_cast<size_t>(length), 0);
  WideCharToMultiByte(CP_UTF8, 0, value, -1, text.data(), length, nullptr, nullptr);
  text.pop_back();
  std::string escaped;
  for (unsigned char c : text) {
    if (c == '"' || c == '\\') escaped += '\\';
    if (c >= 32) escaped += static_cast<char>(c);
  }
  return escaped;
}

struct Mapping {
  HANDLE handle = nullptr;
  OneHotkeyProbeState* state = nullptr;
  ~Mapping() {
    if (state) UnmapViewOfFile(state);
    if (handle) CloseHandle(handle);
  }
  bool open() {
    handle = OpenFileMappingW(FILE_MAP_READ | FILE_MAP_WRITE, FALSE, OneHotkeyProbeMapping);
    if (!handle) return false;
    state = static_cast<OneHotkeyProbeState*>(MapViewOfFile(handle, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, sizeof(OneHotkeyProbeState)));
    return state && state->magic == OneHotkeyProbeMagic;
  }
};

struct InstalledHook {
  HMODULE library = nullptr;
  HHOOK handle = nullptr;
  void release() {
    if (handle) UnhookWindowsHookEx(handle);
    handle = nullptr;
    if (library) FreeLibrary(library);
    library = nullptr;
  }
  ~InstalledHook() { release(); }
  bool install() {
#ifdef _WIN64
    const auto file = sibling(L"One.HotkeyHook64.dll");
#else
    const auto file = sibling(L"One.HotkeyHook32.dll");
#endif
    if (file.empty()) return false;
    library = LoadLibraryW(file.c_str());
    if (!library) return false;
    const auto callback = reinterpret_cast<Hook>(GetProcAddress(library, "OneHotkeyProbeHook"));
    if (!callback) return false;
    handle = SetWindowsHookExW(WH_GETMESSAGE, callback, library, 0);
    return handle != nullptr;
  }
};

int broker() {
  // A medium-integrity owner keeps the shared mapping writable from normal
  // applications even when the scanner itself is elevated.
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
        L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;IU)", SDDL_REVISION_1, &descriptor, nullptr)) return 2;
  SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};
  Mapping mapping;
  mapping.handle = CreateFileMappingW(INVALID_HANDLE_VALUE, &attributes, PAGE_READWRITE, 0,
                                     sizeof(OneHotkeyProbeState), OneHotkeyProbeMapping);
  const DWORD created = GetLastError();
  LocalFree(descriptor);
  if (!mapping.handle || created == ERROR_ALREADY_EXISTS) return 3;
  mapping.state = static_cast<OneHotkeyProbeState*>(MapViewOfFile(mapping.handle, FILE_MAP_READ | FILE_MAP_WRITE,
                                                                  0, 0, sizeof(OneHotkeyProbeState)));
  if (!mapping.state) return 4;
  ZeroMemory(mapping.state, sizeof(OneHotkeyProbeState));
  mapping.state->magic = OneHotkeyProbeMagic;
  mapping.state->brokerPid = static_cast<LONG>(GetCurrentProcessId());
  puts("{\"ready\":true}"); fflush(stdout);
  const DWORD started = GetTickCount();
  while (GetTickCount() - started < timeoutMs) {
    const LONG phase = mapping.state->phase;
    if (phase == 2) {
      printf("{\"status\":\"found\",\"pid\":%ld,\"tid\":%ld,\"path\":\"%s\",\"partial\":%s}\n",
             mapping.state->pid, mapping.state->tid, utf8(mapping.state->image).c_str(),
             mapping.state->ready32 == 1 ? "false" : "true");
      fflush(stdout);
      return 0;
    }
    if (phase == 3 || phase == 4) {
      printf("{\"status\":\"%s\",\"code\":%ld,\"partial\":%s}\n",
             phase == 3 ? "not-found" : "error", mapping.state->error,
             mapping.state->ready32 == 1 ? "false" : "true");
      fflush(stdout);
      return phase == 3 ? 0 : 5;
    }
    Sleep(20);
  }
  puts("{\"status\":\"error\",\"code\":1460}"); fflush(stdout);
  return 6;
}

int worker() {
  Mapping mapping;
  if (!mapping.open()) return 2;
  InstalledHook hook;
  if (!hook.install()) {
    InterlockedExchange(&mapping.state->ready32, -1);
    return 3;
  }
  MSG message{};
  PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  InterlockedExchange(&mapping.state->ready32, 1);
  const DWORD started = GetTickCount();
  while (!mapping.state->stop && GetTickCount() - started < timeoutMs) {
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      if (message.message == WM_QUIT) return 0;
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    Sleep(10);
  }
  return 0;
}

HANDLE startWorker() {
  const auto file = sibling(L"One.HotkeyProbe32.exe");
  if (file.empty()) return nullptr;
  std::wstring command = L"\"" + file + L"\" --worker";
  STARTUPINFOW startup{}; startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESHOWWINDOW; startup.wShowWindow = SW_HIDE;
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(file.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                      nullptr, nullptr, &startup, &process)) return nullptr;
  CloseHandle(process.hThread);
  return process.hProcess;
}

bool heldKeys(LONG target) {
  for (const int key : {VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN})
    if (GetAsyncKeyState(key) & 0x8000) return true;
  return (GetAsyncKeyState(target) & 0x8000) != 0;
}

bool sendCombination(LONG key, LONG modifiers) {
  std::vector<INPUT> events;
  std::vector<WORD> pressed;
  for (const auto [bit, code] : {std::pair{1, VK_LMENU}, {2, VK_LCONTROL}, {4, VK_LSHIFT}, {8, VK_LWIN}})
    if (modifiers & bit) pressed.push_back(static_cast<WORD>(code));
  auto extended = [](WORD vk) {
    switch (vk) {
      case VK_INSERT: case VK_DELETE: case VK_HOME: case VK_END:
      case VK_PRIOR: case VK_NEXT: case VK_UP: case VK_DOWN:
      case VK_LEFT: case VK_RIGHT: return true;
      default: return false;
    }
  };
  auto push = [&](WORD vk, bool up) {
    INPUT input{}; input.type = INPUT_KEYBOARD; input.ki.wVk = vk;
    input.ki.dwFlags = (up ? KEYEVENTF_KEYUP : 0) | (extended(vk) ? KEYEVENTF_EXTENDEDKEY : 0);
    events.push_back(input);
  };
  for (WORD vk : pressed) push(vk, false);
  push(static_cast<WORD>(key), false);
  push(static_cast<WORD>(key), true);
  for (auto it = pressed.rbegin(); it != pressed.rend(); ++it) push(*it, true);
  if (SendInput(static_cast<UINT>(events.size()), events.data(), sizeof(INPUT)) == events.size()) return true;
  const DWORD failure = GetLastError();
  std::vector<INPUT> release;
  auto releaseKey = [&](WORD vk) {
    INPUT input{}; input.type = INPUT_KEYBOARD; input.ki.wVk = vk;
    input.ki.dwFlags = KEYEVENTF_KEYUP | (extended(vk) ? KEYEVENTF_EXTENDEDKEY : 0);
    release.push_back(input);
  };
  releaseKey(static_cast<WORD>(key));
  for (auto it = pressed.rbegin(); it != pressed.rend(); ++it) releaseKey(*it);
  SendInput(static_cast<UINT>(release.size()), release.data(), sizeof(INPUT));
  SetLastError(failure);
  return false;
}

int scan(int argc, wchar_t** argv) {
  if (argc != 5) return 2;
  wchar_t* end = nullptr;
  const LONG key = wcstol(argv[2], &end, 10);
  if (!end || *end || key < 1 || key > 254) return 2;
  const LONG modifiers = wcstol(argv[3], &end, 10);
  if (!end || *end || modifiers < 0 || modifiers > 15) return 2;
  const bool automatic = wcscmp(argv[4], L"auto") == 0;
  if (!automatic && wcscmp(argv[4], L"manual") != 0) return 2;
  Mapping mapping;
  if (!mapping.open() || mapping.state->phase != 0) return 3;
  auto* state = mapping.state;
  state->key = key; state->modifiers = modifiers; state->suppress = 1;
  state->scannerPid = static_cast<LONG>(GetCurrentProcessId());
  HANDLE brokerProcess = OpenProcess(SYNCHRONIZE, FALSE, static_cast<DWORD>(state->brokerPid));
  if (!brokerProcess) return 3;
  auto brokerAlive = [&] { return WaitForSingleObject(brokerProcess, 0) == WAIT_TIMEOUT; };
  InstalledHook hook;
  if (!hook.install()) {
    state->error = static_cast<LONG>(GetLastError());
    InterlockedExchange(&state->phase, 4);
    CloseHandle(brokerProcess);
    return 4;
  }
  HANDLE child = startWorker();
  MSG message{};
  PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  InterlockedExchange(&state->ready64, 1);
  const DWORD readyStarted = GetTickCount();
  while (child && !state->ready32 && brokerAlive() && GetTickCount() - readyStarted < 1500) {
    PeekMessageW(&message, nullptr, 0, 0, PM_NOREMOVE);
    Sleep(10);
  }
  if (!child) InterlockedExchange(&state->ready32, -1);
  // The shortcut recording hook must have released all keys before injecting.
  const DWORD releasedStarted = GetTickCount();
  while (heldKeys(key) && brokerAlive() && GetTickCount() - releasedStarted < 2500) Sleep(20);
  LONG finalPhase = 3;
  if (!brokerAlive()) {
    state->error = ERROR_CANCELLED;
    finalPhase = 4;
  } else if (automatic && heldKeys(key)) {
    state->error = ERROR_BUSY;
    finalPhase = 4;
  } else {
    InterlockedExchange(&state->phase, 1);
    Sleep(80);
    if (automatic && !sendCombination(key, modifiers)) {
      state->error = static_cast<LONG>(GetLastError());
      finalPhase = 4;
    } else {
      const DWORD started = GetTickCount();
      while (state->winner != 2 && brokerAlive() && GetTickCount() - started < (automatic ? 1800u : 10000u)) {
        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
          TranslateMessage(&message); DispatchMessageW(&message);
        }
        Sleep(10);
      }
      if (state->winner == 2) {
        HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(state->pid));
        if (process) {
          DWORD length = static_cast<DWORD>(std::size(state->image));
          QueryFullProcessImageNameW(process, 0, state->image, &length);
          CloseHandle(process);
        }
        finalPhase = 2;
      }
    }
  }
  InterlockedExchange(&state->stop, 1);
  if (child) {
    if (WaitForSingleObject(child, 3000) == WAIT_TIMEOUT) {
      TerminateProcess(child, ERROR_TIMEOUT);
      WaitForSingleObject(child, 1000);
    }
    CloseHandle(child);
  }
  hook.release();
  InterlockedExchange(&state->phase, finalPhase);
  CloseHandle(brokerProcess);
  return finalPhase == 4 ? 5 : 0;
}
} // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc != 2 && argc != 5) return 2;
  if (wcscmp(argv[1], L"--broker") == 0 && argc == 2) return broker();
  if (wcscmp(argv[1], L"--worker") == 0 && argc == 2) return worker();
  if (wcscmp(argv[1], L"--scan") == 0) return scan(argc, argv);
  return 2;
}
