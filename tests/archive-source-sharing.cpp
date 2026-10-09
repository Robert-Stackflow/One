#include <windows.h>
#include <cstdio>
#include <string>
#include "mz.h"
#include "mz_os.h"

// Regression for minizip's metadata query opening an input exclusively while
// another reader already has it open. A failed query used to report zero bytes.
int wmain(int argc, wchar_t **argv) {
    if (argc != 2) return 2;
    HANDLE input = CreateFileW(argv[1], GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                              nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (input == INVALID_HANDLE_VALUE) return 3;
    LARGE_INTEGER expected{};
    if (!GetFileSizeEx(input, &expected) || expected.QuadPart == 0) {
        CloseHandle(input);
        return 4;
    }
    const int length = WideCharToMultiByte(CP_UTF8, 0, argv[1], -1, nullptr, 0, nullptr, nullptr);
    std::string path(length, '\0');
    WideCharToMultiByte(CP_UTF8, 0, argv[1], -1, path.data(), length, nullptr, nullptr);
    const auto actual = mz_os_get_file_size(path.c_str());
    CloseHandle(input);
    if (actual != expected.QuadPart) {
        std::fprintf(stderr, "Shared input size mismatch: %lld != %lld\n",
                     (long long)actual, (long long)expected.QuadPart);
        return 5;
    }
    return 0;
}
