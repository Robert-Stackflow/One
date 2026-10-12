#pragma once
#include <fstream>
#include <filesystem>

// A bounded, transient RGBA preview of the encoder's exact NV12 source frame.
// It is requested on demand; no second desktop/camera capture is started.
inline void annotationFrame(IMFMediaBuffer* buffer, UINT width, UINT height, const std::wstring& path) {
    if (!buffer) throw winrt::hresult_error(E_PENDING, L"录制画面尚未就绪");
    const double scale = (std::min)(1.0, 1280.0 / (std::max)(width, height));
    const UINT w = (std::max)(1u, UINT(width * scale)), h = (std::max)(1u, UINT(height * scale));
    BYTE* bytes = nullptr; DWORD length = 0;
    winrt::check_hresult(buffer->Lock(&bytes, nullptr, &length));
    try {
        if (length != width * height * 3 / 2) throw winrt::hresult_invalid_argument();
        std::vector<uint8_t> pixels(size_t(w) * h * 4);
        const auto channel = [](int value) { return uint8_t((std::clamp)(value, 0, 255)); };
        for (UINT y = 0; y < h; y++) for (UINT x = 0; x < w; x++) {
            const UINT sx = x * width / w, sy = y * height / h;
            const size_t uv = size_t(width) * height + (sy / 2) * width + (sx & ~1u);
            const int c = (std::max)(0, int(bytes[size_t(sy) * width + sx]) - 16), d = int(bytes[uv]) - 128, e = int(bytes[uv + 1]) - 128;
            const size_t p = (size_t(y) * w + x) * 4;
            pixels[p] = channel((298 * c + 459 * e + 128) >> 8);
            pixels[p + 1] = channel((298 * c - 55 * d - 136 * e + 128) >> 8);
            pixels[p + 2] = channel((298 * c + 541 * d + 128) >> 8);
            pixels[p + 3] = 255;
        }
        std::ofstream file(std::filesystem::path(path), std::ios::binary | std::ios::trunc);
        file.write(reinterpret_cast<const char*>(&w), 4); file.write(reinterpret_cast<const char*>(&h), 4);
        file.write(reinterpret_cast<const char*>(pixels.data()), pixels.size()); file.flush();
        SecureZeroMemory(pixels.data(), pixels.size());
        if (!file) throw winrt::hresult_error(E_FAIL, L"标注预览帧写入失败");
    } catch (...) { buffer->Unlock(); throw; }
    winrt::check_hresult(buffer->Unlock());
}
