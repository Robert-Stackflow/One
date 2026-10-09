#include "../native/archive/egg-codecs.h"
#include "../native/archive/common.h"
#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#include <algorithm>
#include <fstream>
#include <iostream>
#include <sstream>
[[noreturn]] void fail(const std::string &message,const std::string &code){throw std::runtime_error(code+": "+message);}
extern "C" void bz_internal_error(int){std::cerr<<"archive: Test BZip2 decoder invariant failed\n";ExitProcess(1);}
namespace {
void check(NTSTATUS status){if(status<0)fail("Test hash API failure");}
struct Digest {
    BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;
    Digest(){check(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0));check(BCryptCreateHash(algorithm,&hash,nullptr,0,nullptr,0,0));}
    ~Digest(){if(hash)BCryptDestroyHash(hash);if(algorithm)BCryptCloseAlgorithmProvider(algorithm,0);}
    void add(const unsigned char *data,size_t count){check(BCryptHashData(hash,(PUCHAR)data,(ULONG)count,0));}
    std::string finish(){unsigned char bytes[32]{};check(BCryptFinishHash(hash,bytes,32,0));const char hex[]="0123456789abcdef";std::string result;for(auto b:bytes){result+=hex[b>>4];result+=hex[b&15];}return result;}
};
struct Volume {
    std::ifstream stream;uint64_t size;EggVolumeHeader header;
    explicit Volume(const fs::path &path):stream(path,std::ios::binary){if(!stream)fail("Cannot open test volume");stream.seekg(0,std::ios::end);const auto end=stream.tellg();if(end<0)fail("Cannot size test volume");size=(uint64_t)end;}
    void read(uint64_t at,unsigned char *data,size_t count){if(at>size||count>size-at)fail("Test volume bounds");stream.clear();stream.seekg((std::streamoff)at);if(!stream.read((char*)data,(std::streamsize)count))fail("Test volume short read");}
};
std::string utf8(const wchar_t *text){const int length=(int)wcslen(text),size=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,text,length,nullptr,0,nullptr,nullptr);if(length&&!size)fail("Invalid test password");
    std::string result((size_t)size,0);if(size)WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,text,length,result.data(),size,nullptr,nullptr);return result;}
}
int wmain(int argc,wchar_t **argv){
    try{
        if(argc<6)return 2;const uint64_t memory=std::stoull(argv[1]),limit=std::stoull(argv[2]),cancel=std::stoull(argv[3]);const auto password=utf8(argv[4]);
        uint64_t checks=0,total=0;const std::function<void()> checkpoint=[&]{if(++checks==cancel)fail("Test cancellation","cancelled");};
        std::vector<std::unique_ptr<Volume>> volumes;std::vector<EggVolumeHeader> headers;
        for(int i=5;i<argc;++i){auto v=std::make_unique<Volume>(fs::path(argv[i]));EggReadAt read=[&](uint64_t at,unsigned char *data,size_t count){v->read(at,data,count);};v->header=egg_volume_header(read,v->size,checkpoint);headers.push_back(v->header);volumes.push_back(std::move(v));}
        const auto order=egg_order_volumes(headers);uint64_t length=0;std::vector<uint64_t> starts;
        for(size_t index:order){starts.push_back(length);const auto &v=*volumes[index];if(v.size-v.header.payload>UINT64_MAX-length)fail("Test joined overflow");length+=v.size-v.header.payload;}
        EggReadAt read=[&](uint64_t at,unsigned char *out,size_t count){if(at>length||count>length-at)fail("Test joined bounds");while(count){const size_t index=(size_t)(std::upper_bound(starts.begin(),starts.end(),at)-starts.begin())-1;auto &v=*volumes[order[index]];
                const uint64_t relative=at-starts[index];const size_t part=(size_t)std::min<uint64_t>(count,v.size-v.header.payload-relative);if(!part)fail("Empty test volume mapping");v.read(v.header.payload+relative,out,part);out+=part;count-=part;at+=part;}};
        EggIndexLimits index_limits;index_limits.memory=memory/4;index_limits.entries=index_limits.blocks=1000;const auto directory=egg_directory(read,length,headers[order[0]].solid,index_limits,checkpoint);
        std::vector<std::string> hashes(directory.members.size());std::vector<uint64_t> actual(directory.members.size());Digest empty;const auto empty_hash=empty.finish();
        auto budget=[&](size_t count){checkpoint();if(count>limit-total)fail("Test output limit","resource");total+=count;};
        auto decode=[&](const EggBlock &block,EggCipher &cipher,const EggWrite &write){uint64_t consumed=0;EggRead packed=[&](unsigned char *data,size_t count){if(count>uint64_t(block.packed)-consumed)fail("Test packed bounds");read(block.offset+consumed,data,count);consumed+=count;};
            egg_decode_block(block,packed,write,cipher,memory-memory/4,checkpoint);if(consumed!=block.packed)fail("Test packed consumption mismatch");};
        auto authenticate=[&](EggCipher &cipher){try{cipher.finish();}catch(...){bool rejected=false;try{cipher.finish();}catch(...){rejected=true;}
                if(!rejected)fail("Repeated finalization accepted an invalid cipher","test");throw;}cipher.finish();};
        if(directory.solid){size_t current=0;std::unique_ptr<Digest> digest;
            EggWrite write=[&](const unsigned char *data,size_t count){budget(count);while(count){while(current<directory.members.size()&&directory.members[current].size==0){hashes[current]=empty_hash;++current;}
                    if(current==directory.members.size())fail("Solid test size overflow");if(!digest)digest=std::make_unique<Digest>();const auto part=(size_t)std::min<uint64_t>(count,directory.members[current].size-actual[current]);
                    digest->add(data,part);actual[current]+=part;data+=part;count-=part;if(actual[current]==directory.members[current].size){hashes[current]=digest->finish();digest.reset();++current;}}};
            EggCipher cipher(EggEncryption{},password);for(const auto &block:directory.blocks)decode(block,cipher,write);authenticate(cipher);
            for(size_t i=0;i<hashes.size();++i)if(!directory.members[i].size)hashes[i]=empty_hash;
        }else for(size_t index=0;index<directory.members.size();++index){const auto &m=directory.members[index];Digest digest;EggCipher cipher(m.encryption,password);
            EggWrite write=[&](const unsigned char *data,size_t count){budget(count);digest.add(data,count);actual[index]+=count;};
            for(size_t i=m.first_block;i<m.first_block+m.block_count;++i)decode(directory.blocks[i],cipher,write);authenticate(cipher);hashes[index]=digest.finish();}
        std::ostringstream output;output<<"{\"solid\":"<<(directory.solid?"true":"false")<<",\"split\":"<<(order.size()>1?"true":"false")<<",\"blockCrcVerified\":true,\"checkpoints\":"<<checks<<",\"outputBytes\":"<<total<<",\"entries\":[";
        for(size_t i=0;i<hashes.size();++i){if(actual[i]!=directory.members[i].size)fail("Test final file size mismatch");if(i)output<<',';output<<"{\"size\":"<<directory.members[i].size<<",\"actual\":"<<actual[i]<<",\"sha256\":\""<<hashes[i]<<"\"}";}output<<"]}\n";std::cout<<output.str();return 0;
    }catch(const std::exception &error){std::cerr<<error.what()<<'\n';return 1;}
}
