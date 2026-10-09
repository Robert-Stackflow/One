#include "../native/archive/egg-container.h"
#include "../native/archive/common.h"
#define NOMINMAX
#include <windows.h>
#include <algorithm>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
[[noreturn]] void fail(const std::string &message,const std::string &code){throw std::runtime_error(code+": "+message);}
namespace {
std::string quote(const std::string &text){std::string result="\"";const char digits[]="0123456789abcdef";
    for(unsigned char ch:text){if(ch=='"'||ch=='\\'){result+='\\';result+=ch;}else if(ch<32){result+="\\u00";result+=digits[ch>>4];result+=digits[ch&15];}else result+=ch;}return result+'"';}
std::string name(const EggMember &m){
    const UINT cp=m.encoding;const int count=MultiByteToWideChar(cp,MB_ERR_INVALID_CHARS,m.name.data(),(int)m.name.size(),nullptr,0);if(!count)fail("Invalid test filename encoding");
    std::wstring text((size_t)count,0);MultiByteToWideChar(cp,MB_ERR_INVALID_CHARS,m.name.data(),(int)m.name.size(),text.data(),count);
    const int size=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,text.data(),count,nullptr,0,nullptr,nullptr);if(!size)fail("Cannot encode test filename");
    std::string result((size_t)size,0);WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,text.data(),count,result.data(),size,nullptr,nullptr);return result;
}
struct Volume {
    std::ifstream stream;uint64_t size;EggVolumeHeader header;
    explicit Volume(const fs::path &path):stream(path,std::ios::binary){if(!stream)fail("Cannot open test volume");stream.seekg(0,std::ios::end);const auto end=stream.tellg();if(end<0)fail("Cannot size test volume");size=(uint64_t)end;}
    void read(uint64_t offset,unsigned char *data,size_t count){if(offset>size||count>size-offset)fail("Test volume bounds");stream.clear();stream.seekg((std::streamoff)offset);if(!stream.read((char*)data,(std::streamsize)count))fail("Test volume short read");}
};
}
int wmain(int argc,wchar_t **argv){
    try{
        if(argc<7)return 2;EggIndexLimits limits{std::stoull(argv[1]),std::stoull(argv[4]),(size_t)std::stoull(argv[2]),(size_t)std::stoull(argv[3])};
        const uint64_t cancel=std::stoull(argv[5]);uint64_t checks=0;const std::function<void()> checkpoint=[&]{if(++checks==cancel)fail("Test cancellation","cancelled");};
        std::vector<std::unique_ptr<Volume>> volumes;std::vector<EggVolumeHeader> headers;
        for(int i=6;i<argc;++i){auto v=std::make_unique<Volume>(fs::path(argv[i]));EggReadAt read=[&](uint64_t at,unsigned char *data,size_t count){v->read(at,data,count);};
            v->header=egg_volume_header(read,v->size,checkpoint);headers.push_back(v->header);volumes.push_back(std::move(v));}
        const auto order=egg_order_volumes(headers);uint64_t total=0;std::vector<uint64_t> starts;
        for(size_t i:order){starts.push_back(total);const auto &v=*volumes[i];if(v.size-v.header.payload>UINT64_MAX-total)fail("Test joined stream overflow");total+=v.size-v.header.payload;}
        EggReadAt read=[&](uint64_t at,unsigned char *out,size_t count){if(at>total||count>total-at)fail("Joined test stream bounds");
            while(count){const auto it=std::upper_bound(starts.begin(),starts.end(),at);const size_t pos=(size_t)(it-starts.begin())-1;auto &v=*volumes[order[pos]];
                const uint64_t relative=at-starts[pos],available=v.size-v.header.payload-relative;const auto part=(size_t)std::min(uint64_t(count),available);if(!part)fail("Empty test volume mapping");
                v.read(v.header.payload+relative,out,part);out+=part;count-=part;at+=part;}
        };
        const auto directory=egg_directory(read,total,headers[order[0]].solid,limits,checkpoint);std::ostringstream out;
        out<<"{\"solid\":"<<(directory.solid?"true":"false")<<",\"split\":"<<(order.size()>1?"true":"false")<<",\"checkpoints\":"<<checks<<",\"comment\":"<<quote(directory.comment)<<",\"volumes\":[";
        for(size_t i=0;i<order.size();++i){if(i)out<<',';const auto &h=headers[order[i]];out<<"{\"id\":"<<h.id<<",\"payload\":"<<h.payload<<'}';}out<<"],\"entries\":[";
        const char *methods[]={"Store","Deflate","Bzip2","Azo","Lzma"};
        for(size_t i=0;i<directory.members.size();++i){if(i)out<<',';const auto &m=directory.members[i];const unsigned method=m.block_count?directory.blocks[m.first_block].method:0;
            out<<"{\"name\":"<<quote(name(m))<<",\"size\":"<<m.size<<",\"encrypted\":"<<(m.encryption.encrypted()?"true":"false")<<",\"cipher\":"<<unsigned(m.encryption.method)
               <<",\"method\":"<<quote(methods[method])<<",\"packed\":"<<m.packed<<",\"blockCount\":"<<m.block_count<<",\"encoding\":"<<m.encoding<<",\"nameFlags\":"<<unsigned(m.name_flags)
               <<",\"directory\":"<<(m.directory()?"true":"false")<<",\"link\":"<<(m.link()?"true":"false")<<",\"attributes\":"<<unsigned(m.attributes)<<",\"posixMode\":"<<m.posix_mode<<",\"parent\":"<<m.parent<<'}';}
        out<<"],\"blocks\":[";for(size_t i=0;i<directory.blocks.size();++i){if(i)out<<',';const auto &b=directory.blocks[i];out<<"{\"offset\":"<<b.offset<<",\"expanded\":"<<b.expanded<<",\"packed\":"<<b.packed<<",\"crc\":"<<b.crc<<'}';}out<<"]}\n";
        std::cout<<out.str();return 0;
    }catch(const std::exception &error){std::cerr<<error.what()<<'\n';return 1;}
}
