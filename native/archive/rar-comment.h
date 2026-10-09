#pragma once
#include "common.h"
#include <windows.h>

// 7-Zip's RAR4 container omits comments; reuse its codecs for bounded CMT data.
std::string rar4_comment(const fs::path &source, HMODULE engine);
