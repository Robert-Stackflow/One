#include "egg-container.h"
#include "common.h"
#include <algorithm>
#include <limits>
#include <unordered_map>
#include <unordered_set>

namespace {
constexpr uint32_t end_magic=0x08e28222,file_magic=0x0a8590e3,block_magic=0x02b50c13;
constexpr uint32_t name_magic=0x0a8591ac,comment_magic=0x04c63672,encrypt_magic=0x08d1470f;
constexpr uint32_t win_magic=0x2c86950b,posix_magic=0x1ee922e5,dummy_magic=0x07463307;
constexpr uint32_t split_magic=0x24f5a262,solid_magic=0x24e5a060;
constexpr uint64_t max_size=9007199254740991ull;
[[noreturn]] void invalid(){fail("Invalid or unsupported EGG directory");}
struct Reader {
    const EggReadAt &read_at;uint64_t length,position=0;const std::function<void()> &checkpoint;
    void bound(uint64_t count)const{if(count>length-position)fail("Truncated EGG header or block");}
    void read(unsigned char *out,size_t count){bound(count);read_at(position,out,count);position+=count;}
    uint64_t number(unsigned count){if(count>8)invalid();unsigned char bytes[8]{};read(bytes,count);uint64_t result=0;for(unsigned i=0;i<count;++i)result|=uint64_t(bytes[i])<<(8*i);return result;}
    void skip(uint64_t count){bound(count);position+=count;checkpoint();}
    std::string text(uint64_t count){bound(count);std::string result((size_t)count,'\0');read((unsigned char*)result.data(),result.size());return result;}
};
struct Extra {
    uint8_t flags;uint64_t size;
    explicit Extra(Reader &r):flags((uint8_t)r.number(1)),size(r.number((flags&1)?4:2)){r.bound(size);}
    void flags_only(uint8_t allowed)const{if(flags&~(allowed|1))invalid();}
    void require(uint64_t wanted)const{if(size!=wanted)invalid();}
};
struct Usage {
    const EggIndexLimits &limits;uint64_t memory=0,names=0,headers=0;
    void charge(uint64_t count){if(count>limits.memory-memory)fail("EGG directory exceeds its memory budget","resource");memory+=count;}
    void name(uint64_t count){if(count>limits.names-names)fail("EGG directory exceeds its name budget","resource");names+=count;charge(count*4);}
    void header(){if(++headers>4000000)fail("EGG directory exceeds its header budget","resource");}
};
uint64_t add_size(uint64_t left,uint64_t right){if(right>max_size-left)fail("EGG size exceeds its supported range","resource");return left+right;}
EggEncryption encryption(Reader &r,const Extra &extra){
    extra.flags_only(0);if(extra.size!=17&&extra.size!=21&&extra.size!=29)invalid();
    EggEncryption result;result.method=(uint8_t)r.number(1);
    const uint64_t wanted=result.method==0?17:(result.method==1||result.method==5)?21:(result.method==2||result.method==6)?29:0;
    if(!wanted||extra.size!=wanted)invalid();r.read(result.bytes.data(),(size_t)extra.size-1);return result;
}
std::string comment(Reader &r,const Extra &extra,Usage &usage){
    extra.flags_only(4);if(extra.size>1024*1024)fail("EGG comment exceeds its memory budget","resource");
    usage.charge(extra.size*2);if(extra.flags&4){r.skip(extra.size);return {};}
    return r.text(extra.size);
}
}

EggVolumeHeader egg_volume_header(const EggReadAt &read,uint64_t size,const std::function<void()> &checkpoint){
    Reader r{read,size,0,checkpoint};checkpoint();
    if(r.number(4)!=0x41474745||r.number(2)!=256)fail("Unsupported EGG header or version");
    EggVolumeHeader result;result.id=(uint32_t)r.number(4);if(r.number(4))invalid();
    size_t headers=0;while(true){checkpoint();if(++headers>1024)fail("EGG volume header exceeds its budget","resource");
        const auto signature=r.number(4);if(signature==end_magic)break;Extra extra(r);extra.flags_only(0);
        if(signature==split_magic){if(result.split)invalid();extra.require(8);result.split=true;result.previous=(uint32_t)r.number(4);result.next=(uint32_t)r.number(4);}
        else if(signature==solid_magic){if(result.solid)invalid();extra.require(0);result.solid=true;}
        else if(signature==dummy_magic)r.skip(extra.size);
        else invalid();
    }
    if(result.split&&(!result.id||result.previous==result.id||result.next==result.id||(result.previous&&result.previous==result.next)))invalid();
    result.payload=r.position;return result;
}

std::vector<size_t> egg_order_volumes(const std::vector<EggVolumeHeader> &headers){
    if(headers.empty()||headers.size()>1024)fail("EGG volume count exceeds its supported range","resource");
    if(headers.size()==1&&!headers[0].split)return {0};
    std::unordered_map<uint32_t,size_t> ids;size_t first=headers.size();
    for(size_t i=0;i<headers.size();++i){const auto &h=headers[i];if(!h.split||!h.id||!ids.emplace(h.id,i).second||h.solid!=headers[0].solid)invalid();
        if(!h.previous){if(first!=headers.size())invalid();first=i;}}
    if(first==headers.size())fail("EGG first volume is missing or volume links form a cycle");
    std::vector<size_t> result;std::unordered_set<size_t> visited;uint32_t previous=0;size_t index=first;
    while(true){if(!visited.insert(index).second)fail("EGG volume links form a cycle");const auto &h=headers[index];if(h.previous!=previous)invalid();result.push_back(index);
        if(!h.next)break;const auto next=ids.find(h.next);if(next==ids.end())fail("A required EGG volume is missing","volumes");previous=h.id;index=next->second;}
    if(result.size()!=headers.size())fail("Unrelated EGG volumes were supplied");return result;
}

EggDirectory egg_directory(const EggReadAt &read,uint64_t payload_size,bool solid,const EggIndexLimits &limits,const std::function<void()> &checkpoint){
    Reader r{read,payload_size,0,checkpoint};Usage usage{limits};EggDirectory result;result.solid=solid;
    std::unordered_set<uint32_t> ids;EggEncryption pending_encryption;bool ended=false,solid_data=false;size_t current=SIZE_MAX;
    auto finish=[&]{if(current==SIZE_MAX)return;auto &m=result.members[current];m.block_count=result.blocks.size()-m.first_block;
        if(!solid){uint64_t expanded=0;for(size_t i=m.first_block;i<result.blocks.size();++i){expanded=add_size(expanded,result.blocks[i].expanded);m.packed=add_size(m.packed,result.blocks[i].packed);}
            if(expanded!=m.size)invalid();}
        if(m.directory()&&(m.size||(!solid&&m.block_count)||m.encryption.encrypted()))invalid();
    };
    while(r.position<r.length){checkpoint();usage.header();const auto signature=r.number(4);
        if(signature==end_magic){finish();if(r.position!=r.length||pending_encryption.encrypted())invalid();ended=true;break;}
        if(signature==file_magic){finish();if(solid_data)invalid();if(result.members.size()>=limits.entries)fail("EGG directory exceeds its entry budget","resource");
            usage.charge(sizeof(EggMember)*3+128);EggMember m;m.id=(uint32_t)r.number(4);m.size=r.number(8);m.encryption=pending_encryption;pending_encryption=EggEncryption{};
            if(m.size>max_size)fail("EGG size exceeds its supported range","resource");if(!ids.insert(m.id).second)invalid();m.first_block=result.blocks.size();
            bool named=false,encrypted=m.encryption.encrypted(),win=false,posix=false,commented=false;
            while(true){checkpoint();usage.header();const auto extra_signature=r.number(4);if(extra_signature==end_magic)break;Extra extra(r);
                if(extra_signature==name_magic){if(named)invalid();named=true;extra.flags_only(4|8|16);if(extra.flags&4)fail("Encrypted EGG filenames are not supported");
                    if(!extra.size||extra.size>32767)invalid();usage.name(extra.size);m.name_flags=extra.flags;
                    // The length covers filename bytes only; locale/parent fields
                    // precede them. Verified with the Korean/Japanese corpus.
                    if(extra.flags&8)m.encoding=(uint32_t)r.number(2);if(extra.flags&16)m.parent=(uint32_t)r.number(4);
                    m.name=r.text(extra.size);if(m.name.find('\0')!=std::string::npos)fail("EGG filename contains NUL","safety");
                }else if(extra_signature==encrypt_magic){if(encrypted)invalid();encrypted=true;m.encryption=encryption(r,extra);}
                else if(extra_signature==win_magic){if(win)invalid();win=true;extra.flags_only(0);extra.require(9);m.windows_info=true;m.windows_time=r.number(8);m.attributes=(uint8_t)r.number(1);}
                else if(extra_signature==posix_magic){if(posix)invalid();posix=true;extra.flags_only(0);extra.require(20);m.posix_info=true;m.posix_mode=(uint32_t)r.number(4);r.skip(8);m.unix_time=r.number(8);}
                else if(extra_signature==comment_magic){if(commented)invalid();commented=true;m.comment=comment(r,extra,usage);}
                else invalid();
            }
            if(!named)invalid();result.expanded=add_size(result.expanded,m.size);result.members.push_back(std::move(m));current=result.members.size()-1;
        }else if(signature==block_magic){if(current==SIZE_MAX||(!solid&&result.members[current].directory()))invalid();if(result.blocks.size()>=limits.blocks)fail("EGG directory exceeds its block budget","resource");
            usage.charge(sizeof(EggBlock)*3);EggBlock block;block.method=(uint8_t)r.number(1);block.hint=(uint8_t)r.number(1);block.expanded=(uint32_t)r.number(4);block.packed=(uint32_t)r.number(4);block.crc=(uint32_t)r.number(4);
            if(block.method>4||r.number(4)!=end_magic)invalid();if(block.method==0&&block.expanded!=block.packed)invalid();block.offset=r.position;r.skip(block.packed);
            result.packed=add_size(result.packed,block.packed);result.blocks.push_back(block);if(solid)solid_data=true;
        }else if(signature==dummy_magic){Extra extra(r);extra.flags_only(0);r.skip(extra.size);}
        else if(signature==comment_magic){Extra extra(r);result.comment=comment(r,extra,usage);}
        else if(signature==encrypt_magic){if(pending_encryption.encrypted())invalid();finish();current=SIZE_MAX;Extra extra(r);pending_encryption=encryption(r,extra);}
        else invalid();
    }
    if(!ended)fail("EGG archive end marker is missing");
    if(solid){uint64_t expanded=0;for(const auto &block:result.blocks)expanded=add_size(expanded,block.expanded);if(expanded!=result.expanded)invalid();
        // Solid blocks span the concatenated contents; never pretend they belong
        // to the last file simply because its header was read most recently.
        bool assigned=false;for(auto &m:result.members){if(m.encryption.encrypted())fail("Encrypted solid EGG streams are not supported");m.first_block=0;m.block_count=m.directory()?0:result.blocks.size();m.packed=0;
            if(!m.directory()&&!assigned){m.packed=result.packed;assigned=true;}}
    }
    return result;
}
