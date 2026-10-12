#pragma once
#include <cstdint>
#include <vector>
#include <array>
#include <algorithm>

// Lossless, unfiltered PNG with stored DEFLATE blocks (RFC 1950 / 1951 / 2083).
// An interactive frame is decoded immediately, so spending hundreds of ms on
// archival compression buys little. Large frames still use the WIC fallback.
namespace capture_transport {
inline void big(std::vector<uint8_t>& out, uint32_t value) {
    for (int shift = 24; shift >= 0; shift -= 8) out.push_back(uint8_t(value >> shift));
}
inline uint32_t crc(const uint8_t* bytes, size_t size) {
    static const auto table = [] {
        std::array<uint32_t, 256> result{};
        for (uint32_t i = 0; i < 256; i++) {
            uint32_t v = i;
            for (int bit = 0; bit < 8; bit++) v = (v >> 1) ^ ((v & 1) ? 0xedb88320u : 0);
            result[i] = v;
        }
        return result;
    }();
    uint32_t value = 0xffffffffu;
    for (size_t i = 0; i < size; i++) value = table[(value ^ bytes[i]) & 255] ^ (value >> 8);
    return value ^ 0xffffffffu;
}
inline void chunk(std::vector<uint8_t>& out, const char* type, const std::vector<uint8_t>& data) {
    big(out, uint32_t(data.size()));
    const auto start = out.size();
    out.insert(out.end(), type, type + 4);
    out.insert(out.end(), data.begin(), data.end());
    big(out, crc(out.data() + start, data.size() + 4));
}
inline std::vector<uint8_t> png(const std::vector<uint8_t>& bgra, uint32_t width, uint32_t height) {
    if (!width || !height || width > 16384 || height > 16384 || uint64_t(width) * height > 40000000) return {};
    const uint64_t rawSize = (uint64_t(width) * 4 + 1) * height;
    const uint64_t encodedSize = rawSize + ((rawSize + 65534) / 65535) * 5 + 63;
    if (!width || !height || bgra.size() != uint64_t(width) * height * 4 || encodedSize > 64 * 1024 * 1024)
        return {};
    std::vector<uint8_t> raw(size_t(rawSize), 0);
    for (uint32_t y = 0; y < height; y++) for (uint32_t x = 0; x < width; x++) {
        const auto from = (size_t(y) * width + x) * 4, to = size_t(y) * (size_t(width) * 4 + 1) + 1 + size_t(x) * 4;
        raw[to] = bgra[from + 2]; raw[to + 1] = bgra[from + 1]; raw[to + 2] = bgra[from]; raw[to + 3] = bgra[from + 3];
    }
    uint32_t a = 1, b = 0;
    for (size_t from = 0; from < raw.size();) {
        const auto end = (std::min)(raw.size(), from + 5552);
        while (from < end) { a += raw[from++]; b += a; }
        a %= 65521; b %= 65521;
    }
    std::vector<uint8_t> deflate{0x78, 0x01};
    deflate.reserve(size_t(encodedSize));
    for (size_t from = 0; from < raw.size();) {
        const auto size = uint16_t((std::min)(size_t(65535), raw.size() - from)), inverse = uint16_t(~size);
        deflate.push_back(from + size == raw.size() ? 1 : 0);
        deflate.push_back(uint8_t(size)); deflate.push_back(uint8_t(size >> 8));
        deflate.push_back(uint8_t(inverse)); deflate.push_back(uint8_t(inverse >> 8));
        deflate.insert(deflate.end(), raw.begin() + from, raw.begin() + from + size); from += size;
    }
    big(deflate, (b << 16) | a);
    std::vector<uint8_t> header;
    big(header, width); big(header, height);
    header.insert(header.end(), {8, 6, 0, 0, 0});
    std::vector<uint8_t> out{137, 80, 78, 71, 13, 10, 26, 10}; out.reserve(size_t(encodedSize));
    chunk(out, "IHDR", header); chunk(out, "IDAT", deflate); chunk(out, "IEND", {});
    // The frame is private, transient data; don't retain extra raw copies.
    SecureZeroMemory(raw.data(), raw.size()); SecureZeroMemory(deflate.data(), deflate.size());
    return out;
}
}
