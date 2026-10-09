#pragma once
#include <cstdint>
#include <functional>
#include <cstddef>

// Exact reads from a bounded/decrypted EGG block and streamed decoded output.
// The caller must verify the enclosing EGG block's CRC and packed-byte count:
// the AZO stream has framing checks but no independent content checksum.
using EggRead = std::function<void(unsigned char*,size_t)>;
using EggWrite = std::function<void(const unsigned char*,size_t)>;
void egg_azo_decode(const EggRead&,const EggWrite&,uint64_t expected,
                    uint64_t allocation_limit,const std::function<void()>& checkpoint);
