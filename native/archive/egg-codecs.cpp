#include "egg-codecs.h"
#include "common.h"
#include <zlib.h>
#include <bzlib.h>
#define LZMA_API_STATIC
#include <lzma.h>
#include <algorithm>
#include <array>
#include <cstdlib>
#include <limits>
#include <cstddef>

namespace {
struct Memory {
    struct alignas(std::max_align_t) Header {size_t bytes;};uint64_t limit,used=0;
    void *allocate(size_t count,size_t width){if(width&&count>SIZE_MAX/width)return nullptr;const size_t bytes=count*width;
        if(bytes>SIZE_MAX-sizeof(Header)||bytes+sizeof(Header)>limit-used)return nullptr;
        const auto total=bytes+sizeof(Header);auto *block=(Header*)std::calloc(1,total);if(!block)return nullptr;block->bytes=total;used+=total;return block+1;}
    void release(void *data){if(!data)return;auto *block=(Header*)data-1;used-=block->bytes;std::free(block);}
    static void *zalloc(void *self,unsigned count,unsigned width){return ((Memory*)self)->allocate(count,width);}
    static void *bzalloc(void *self,int count,int width){return count<0||width<0?nullptr:((Memory*)self)->allocate((size_t)count,(size_t)width);}
    static void *lzalloc(void *self,size_t count,size_t width){return ((Memory*)self)->allocate(count,width);}
    static void free(void *self,void *data){((Memory*)self)->release(data);}
};
struct Deflate {z_stream stream{};~Deflate(){if(stream.state)inflateEnd(&stream);}};
struct Bzip {bz_stream stream{};~Bzip(){if(stream.state)BZ2_bzDecompressEnd(&stream);}};
struct Lzma {lzma_stream stream=LZMA_STREAM_INIT;lzma_filter filters[2]{{LZMA_FILTER_LZMA1,nullptr},{LZMA_VLI_UNKNOWN,nullptr}};
    ~Lzma(){lzma_end(&stream);lzma_filters_free(filters,nullptr);}};
[[noreturn]] void invalid(){fail("Invalid, truncated or trailing EGG compressed data");}
}
void egg_decode_block(const EggBlock &block,const EggRead &raw,const EggWrite &output,EggCipher &cipher,uint64_t memory_limit,const std::function<void()> &checkpoint){
    checkpoint();if(memory_limit<1024*1024)fail("EGG decoder exceeds its memory budget","resource");Memory memory{memory_limit-512*1024};
    uint64_t remaining=block.packed,written=0;uLong crc=crc32(0,nullptr,0);std::array<unsigned char,65536> input{},out{};
    EggRead read=[&](unsigned char *data,size_t count){if(count>remaining)invalid();while(count){checkpoint();const size_t part=std::min<size_t>(count,65536);raw(data,part);cipher.decrypt(data,part);remaining-=part;data+=part;count-=part;}};
    EggWrite write=[&](const unsigned char *data,size_t count){if(count>uint64_t(block.expanded)-written)fail("EGG block exceeds its declared output size","safety");
        while(count){checkpoint();const size_t part=std::min<size_t>(count,65536);crc=crc32(crc,data,(uInt)part);output(data,part);written+=part;data+=part;count-=part;}};
    auto fill=[&]{const auto count=(unsigned)std::min<uint64_t>(remaining,input.size());read(input.data(),count);return count;};
    if(block.method==0){if(block.packed!=block.expanded)invalid();while(remaining){const auto count=fill();write(input.data(),count);}}
    else if(block.method==3){egg_azo_decode(read,write,block.expanded,memory_limit,checkpoint);if(remaining)invalid();}
    else if(block.method==1){Deflate decoder;auto &s=decoder.stream;s.zalloc=Memory::zalloc;s.zfree=Memory::free;s.opaque=&memory;
        if(inflateInit2(&s,-MAX_WBITS)!=Z_OK)fail("Cannot initialize EGG Deflate decoder","resource");
        while(true){checkpoint();if(!s.avail_in&&remaining){s.avail_in=fill();s.next_in=input.data();}const auto before=s.avail_in;s.next_out=out.data();s.avail_out=(uInt)out.size();
            const auto status=inflate(&s,Z_NO_FLUSH);const auto count=out.size()-s.avail_out;write(out.data(),count);
            if(status==Z_STREAM_END){if(remaining||s.avail_in)invalid();break;}if(status==Z_MEM_ERROR)fail("EGG Deflate decoder exceeds its memory budget","resource");
            if(status!=Z_OK||(!count&&before==s.avail_in))invalid();}
    }else if(block.method==2){Bzip decoder;auto &s=decoder.stream;s.bzalloc=Memory::bzalloc;s.bzfree=Memory::free;s.opaque=&memory;
        if(BZ2_bzDecompressInit(&s,0,1)!=BZ_OK)fail("Cannot initialize EGG BZip2 decoder","resource");
        while(true){checkpoint();if(!s.avail_in&&remaining){s.avail_in=fill();s.next_in=(char*)input.data();}const auto before=s.avail_in;s.next_out=(char*)out.data();s.avail_out=(unsigned)out.size();
            const auto status=BZ2_bzDecompress(&s);const auto count=out.size()-s.avail_out;write(out.data(),count);
            if(status==BZ_STREAM_END){if(remaining||s.avail_in)invalid();break;}if(status==BZ_MEM_ERROR)fail("EGG BZip2 decoder exceeds its memory budget","resource");
            if(status!=BZ_OK||(!count&&before==s.avail_in))invalid();}
    }else if(block.method==4){unsigned char header[9]{};read(header,sizeof(header));lzma_allocator allocator{Memory::lzalloc,Memory::free,&memory};Lzma decoder;decoder.stream.allocator=&allocator;
        const auto properties=lzma_properties_decode(&decoder.filters[0],nullptr,header+4,5);if(properties!=LZMA_OK)invalid();decoder.filters[0].id=LZMA_FILTER_LZMA1EXT;
        auto *options=(lzma_options_lzma*)decoder.filters[0].options;options->ext_flags=LZMA_LZMA1EXT_ALLOW_EOPM;options->ext_size_low=block.expanded;options->ext_size_high=0;
        const auto needed=lzma_raw_decoder_memusage(decoder.filters);if(needed==UINT64_MAX)invalid();if(needed>memory.limit)fail("EGG LZMA decoder exceeds its memory budget","resource");
        auto &s=decoder.stream;
        const auto initialized=lzma_raw_decoder(&s,decoder.filters);if(initialized==LZMA_MEM_ERROR)fail("EGG LZMA decoder exceeds its memory budget","resource");if(initialized!=LZMA_OK)invalid();
        while(true){checkpoint();if(!s.avail_in&&remaining){s.avail_in=fill();s.next_in=input.data();}const auto before=s.avail_in;s.next_out=out.data();s.avail_out=out.size();
            const auto status=lzma_code(&s,remaining?LZMA_RUN:LZMA_FINISH);const auto count=out.size()-s.avail_out;write(out.data(),count);
            if(status==LZMA_STREAM_END){if(remaining||s.avail_in)invalid();break;}if(status==LZMA_MEM_ERROR)fail("EGG LZMA decoder exceeds its memory budget","resource");
            if(status!=LZMA_OK||(!count&&before==s.avail_in))invalid();}
    }else invalid();
    if(remaining||written!=block.expanded||(uint32_t)crc!=block.crc)fail("EGG block size or CRC32 check failed");
}
