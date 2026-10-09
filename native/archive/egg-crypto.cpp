// LEA schedule/rounds and EGG parameters follow EggDotNet (MIT, Andrew Kolman).
// See vendor/archive/egg/SOURCE.txt. Crypto providers and stream handling are One's.
#include "egg-crypto.h"
#include "common.h"
#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#include <algorithm>
#include <array>
#include <bit>
#include <limits>

namespace {
void checked(NTSTATUS status){if(status<0)fail("Cannot initialize or use EGG cryptography","resource");}
struct Algorithm {BCRYPT_ALG_HANDLE value=nullptr;~Algorithm(){if(value)BCryptCloseAlgorithmProvider(value,0);}};
struct Key {BCRYPT_KEY_HANDLE value=nullptr;~Key(){if(value)BCryptDestroyKey(value);}};
struct Hash {BCRYPT_HASH_HANDLE value=nullptr;~Hash(){if(value)BCryptDestroyHash(value);}};
struct Derived {std::array<unsigned char,66> bytes{};~Derived(){SecureZeroMemory(bytes.data(),bytes.size());}};
constexpr auto crc_table=[] {std::array<uint32_t,256> table{};for(uint32_t i=0;i<256;++i){uint32_t value=i;for(unsigned j=0;j<8;++j)value=(value>>1)^((value&1)?0xedb88320u:0);table[i]=value;}return table;}();
uint32_t crc_byte(uint32_t crc,unsigned char value){return (crc>>8)^crc_table[(crc^value)&255];}
uint32_t little(const unsigned char *p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
void little(unsigned char *p,uint32_t value){for(unsigned i=0;i<4;++i)p[i]=(unsigned char)(value>>(i*8));}
bool equal(const unsigned char *a,const unsigned char *b,size_t size){unsigned different=0;for(size_t i=0;i<size;++i)different|=a[i]^b[i];return !different;}
}
struct EggCipher::State {
    Algorithm aes,sha;Key key;Hash mac;EggEncryption metadata;
    std::array<uint32_t,3> zip_keys{0x12345678,0x23456789,0x34567890};
    std::array<std::array<uint32_t,6>,32> rounds{};unsigned round_count=0;
    std::array<unsigned char,65536> counters{},stream{};std::array<unsigned char,16> lea_counter{};
    uint64_t aes_counter=1;size_t position=0,available=0;bool finished=false,authenticated=false,lea_exhausted=false;
    explicit State(const EggEncryption &encryption,const std::string &password):metadata(encryption){
        if(metadata.method==0){for(unsigned char ch:password)zip_update(ch);unsigned char last=0;
            for(size_t i=0;i<12;++i){last=zip_byte(metadata.bytes[i]);}if(last!=metadata.bytes[15])fail("Incorrect EGG password","password");return;}
        if(metadata.method!=1&&metadata.method!=2&&metadata.method!=5&&metadata.method!=6)fail("Unsupported EGG cipher");
        if(password.size()>ULONG_MAX)fail("EGG password exceeds its supported length","resource");
        const ULONG length=(metadata.method==2||metadata.method==6)?32:16,salt=length/2;
        checked(BCryptOpenAlgorithmProvider(&sha.value,BCRYPT_SHA1_ALGORITHM,nullptr,BCRYPT_ALG_HANDLE_HMAC_FLAG));Derived derived;
        checked(BCryptDeriveKeyPBKDF2(sha.value,(PUCHAR)password.data(),(ULONG)password.size(),metadata.bytes.data(),salt,1000,derived.bytes.data(),length*2+2,0));
        // Compare the two bytes individually: the reference AES helper combines
        // them using key strength, which permits collisions for AES128.
        if(!equal(derived.bytes.data()+length*2,metadata.bytes.data()+salt,2))fail("Incorrect EGG password","password");
        checked(BCryptCreateHash(sha.value,&mac.value,nullptr,0,derived.bytes.data()+length,length,0));
        if(metadata.method==1||metadata.method==2){checked(BCryptOpenAlgorithmProvider(&aes.value,BCRYPT_AES_ALGORITHM,nullptr,0));
            checked(BCryptSetProperty(aes.value,BCRYPT_CHAINING_MODE,(PUCHAR)BCRYPT_CHAIN_MODE_ECB,sizeof(BCRYPT_CHAIN_MODE_ECB),0));
            checked(BCryptGenerateSymmetricKey(aes.value,&key.value,nullptr,0,derived.bytes.data(),length,0));
        }else lea_keys(derived.bytes.data(),length);
    }
    ~State(){SecureZeroMemory(zip_keys.data(),sizeof(zip_keys));SecureZeroMemory(rounds.data(),sizeof(rounds));SecureZeroMemory(counters.data(),counters.size());SecureZeroMemory(stream.data(),stream.size());}
    void zip_update(unsigned char value){zip_keys[0]=crc_byte(zip_keys[0],value);zip_keys[1]=(zip_keys[1]+(zip_keys[0]&255))*134775813u+1;zip_keys[2]=crc_byte(zip_keys[2],(unsigned char)(zip_keys[1]>>24));}
    unsigned char zip_byte(unsigned char encrypted){const uint32_t value=(zip_keys[2]|2)&0xffff;const auto plain=(unsigned char)(encrypted^((value*(value^1))>>8));zip_update(plain);return plain;}
    void lea_keys(const unsigned char *bytes,ULONG size){
        constexpr uint32_t delta[]={0xc3efe9db,0x44626b02,0x79e27c8a,0x78df30ec,0x715ea49e,0xc785da0a,0xe04ef22a,0xe5c40957};
        constexpr int shifts[]={1,3,6,11,13,17};std::array<uint32_t,8> t{};for(ULONG i=0;i<size/4;++i)t[i]=little(bytes+4*i);
        round_count=size==16?24:32;
        for(unsigned i=0;i<round_count;++i){const uint32_t d=std::rotl(delta[i&(size==16?3:7)],(int)i);auto &r=rounds[i];
            if(size==16){r[0]=t[0]=std::rotl(t[0]+d,1);r[1]=r[3]=r[5]=t[1]=std::rotl(t[1]+std::rotl(d,1),3);
                r[2]=t[2]=std::rotl(t[2]+std::rotl(d,2),6);r[4]=t[3]=std::rotl(t[3]+std::rotl(d,3),11);}
            else for(unsigned j=0;j<6;++j){auto &v=t[(6*i+j)&7];r[j]=v=std::rotl(v+std::rotl(d,(int)j),shifts[j]);}
        }SecureZeroMemory(t.data(),sizeof(t));
    }
    void lea_block(const unsigned char *input,unsigned char *output){
        uint32_t a=little(input),b=little(input+4),c=little(input+8),d=little(input+12);
        for(unsigned i=0;i<round_count;++i){const auto &r=rounds[i];const uint32_t previous=a;
            a=std::rotl((a^r[0])+(b^r[1]),9);b=std::rotr((b^r[2])+(c^r[3]),5);c=std::rotr((c^r[4])+(d^r[5]),3);d=previous;}
        little(output,a);little(output+4,b);little(output+8,c);little(output+12,d);
    }
    void fill(){
        position=0;available=0;
        if(key.value){if(aes_counter>UINT32_MAX)fail("EGG AES counter exceeds its supported range","resource");
            const size_t blocks=(size_t)std::min<uint64_t>(stream.size()/16,UINT32_MAX-aes_counter+1);available=blocks*16;
            std::fill(counters.begin(),counters.begin()+available,(unsigned char)0);for(size_t i=0;i<blocks;++i)little(counters.data()+16*i,(uint32_t)aes_counter++);
            ULONG written=0;checked(BCryptEncrypt(key.value,counters.data(),(ULONG)available,nullptr,nullptr,0,stream.data(),(ULONG)available,&written,0));if(written!=available)fail("EGG AES keystream length mismatch");
        }else{while(available<stream.size()&&!lea_exhausted){lea_block(lea_counter.data(),stream.data()+available);available+=16;
                bool carry=true;for(size_t i=lea_counter.size();i>0&&carry;){--i;carry=++lea_counter[i]==0;}lea_exhausted=carry;}
            if(!available)fail("EGG LEA counter exceeds its supported range","resource");}
    }
    void decrypt(unsigned char *data,size_t count){if(finished)fail("EGG cipher is already finalized");
        if(metadata.method==0){for(size_t i=0;i<count;++i)data[i]=zip_byte(data[i]);return;}
        size_t hashed=0;while(hashed<count){const auto part=(ULONG)std::min<size_t>(count-hashed,65536);checked(BCryptHashData(mac.value,data+hashed,part,0));hashed+=part;}
        while(count){if(position==available)fill();const size_t part=std::min(count,available-position);for(size_t i=0;i<part;++i)data[i]^=stream[position+i];position+=part;data+=part;count-=part;}
    }
    void finish(){if(finished){if(!authenticated)fail("EGG authentication code check failed");return;}finished=true;if(metadata.method==0){authenticated=true;return;}std::array<unsigned char,20> actual{};
        checked(BCryptFinishHash(mac.value,actual.data(),(ULONG)actual.size(),0));const size_t salt=(metadata.method==2||metadata.method==6)?16:8;
        if(!equal(actual.data(),metadata.bytes.data()+salt+2,10))fail("EGG authentication code check failed");
        authenticated=true;
    }
};
EggCipher::EggCipher(const EggEncryption &metadata,const std::string &password){if(metadata.encrypted())state=std::make_unique<State>(metadata,password);}
EggCipher::~EggCipher()=default;
void EggCipher::decrypt(unsigned char *data,size_t count){if(state)state->decrypt(data,count);}
void EggCipher::finish(){if(state)state->finish();}
