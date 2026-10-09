#pragma once
#include "egg-azo.h"
#include "egg-crypto.h"
// Exact packed consumption, exact expanded length and CRC on every block.
// A cipher persists across a file's blocks and is finalized by the caller.
void egg_decode_block(const EggBlock&,const EggRead&,const EggWrite&,EggCipher&,
                      uint64_t memory_limit,const std::function<void()>& checkpoint);
