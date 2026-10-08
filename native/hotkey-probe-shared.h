#pragma once
#include <windows.h>

// The broker creates this mapping at medium integrity before the optional
// elevated scanner starts. Local\ keeps independent login sessions separate.
inline constexpr wchar_t OneHotkeyProbeMapping[] = L"Local\\One.HotkeyProbe.v1";
inline constexpr LONG OneHotkeyProbeMagic = 0x4f485031;

struct OneHotkeyProbeState {
  LONG magic;
  LONG key;
  LONG modifiers;
  LONG suppress;
  LONG winner;       // 0: none, 1: writer active, 2: PID/TID available
  LONG pid;
  LONG tid;
  LONG scannerPid;
  LONG brokerPid;
  LONG ready64;
  LONG ready32;
  LONG stop;
  LONG phase;        // 0: waiting, 1: armed, 2: result, 3: no result, 4: error
  LONG error;
  wchar_t image[1024];
};
