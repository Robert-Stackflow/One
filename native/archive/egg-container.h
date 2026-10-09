#pragma once
#include <array>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

using EggReadAt=std::function<void(uint64_t,unsigned char*,size_t)>;
struct EggIndexLimits {
    uint64_t memory=256ull*1024*1024,names=64ull*1024*1024;
    size_t entries=1000000,blocks=1000000;
};
struct EggVolumeHeader {
    uint32_t id=0,previous=0,next=0;uint64_t payload=0;
    bool split=false,solid=false;
};
struct EggEncryption {
    uint8_t method=255;std::array<unsigned char,29> bytes{};
    bool encrypted()const{return method!=255;}
};
struct EggBlock {
    uint64_t offset=0;uint32_t expanded=0,packed=0,crc=0;uint8_t method=0,hint=0;
};
struct EggMember {
    uint32_t id=0,encoding=65001,parent=0,posix_mode=0;uint8_t name_flags=0,attributes=0;
    uint64_t size=0,packed=0,windows_time=0,unix_time=0;
    bool windows_info=false,posix_info=false;
    std::string name,comment;EggEncryption encryption;
    size_t first_block=0,block_count=0;
    bool directory()const{return (attributes&0x80)||(posix_info&&(posix_mode&0170000)==0040000);}
    bool link()const{return (attributes&8)||(posix_info&&(posix_mode&0170000)==0120000);}
};
struct EggDirectory {
    std::vector<EggMember> members;std::vector<EggBlock> blocks;
    std::string comment;bool solid=false;
    uint64_t expanded=0,packed=0;
};

// Root headers are parsed separately for every volume. The directory reader
// receives only concatenated volume payloads, so blocks may cross boundaries.
EggVolumeHeader egg_volume_header(const EggReadAt&,uint64_t size,const std::function<void()>& checkpoint);
EggDirectory egg_directory(const EggReadAt&,uint64_t payload_size,bool solid,
                           const EggIndexLimits&,const std::function<void()>& checkpoint);
// Validates links and returns indices in first-to-last order. No directory scan
// or filename guessing: the caller supplies only approved candidate volumes.
std::vector<size_t> egg_order_volumes(const std::vector<EggVolumeHeader>&);
