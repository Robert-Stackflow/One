#pragma once
#include "egg-container.h"
#include <memory>
class EggCipher {
    struct State;std::unique_ptr<State> state;
public:
    EggCipher(const EggEncryption&,const std::string &password_bytes);
    ~EggCipher();
    EggCipher(const EggCipher&)=delete;
    void decrypt(unsigned char*,size_t);
    // Called after all compressed blocks of one file, never after each block.
    void finish();
};
