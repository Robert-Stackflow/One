// AZO probability/entropy models ported from EggDotNet, MIT, Andrew Kolman.
// Source pin and original license: vendor/archive/egg/. One adds bounded I/O,
// checked matches/indices, allocation limits and cancellation checkpoints.
#include "egg-azo.h"
#include "common.h"
#include "egg-azo-tables.h"
#include <array>
#include <algorithm>
#include <vector>
#include <limits>

namespace {
using U=uint32_t;
[[noreturn]] void bad(){fail("Invalid or truncated EGG AZO stream");}
class Entropy {
    const std::vector<unsigned char> &input;size_t bit=0;unsigned padding=0;U low=0,high=UINT32_MAX,tag=0;
    // AZO terminates the arithmetic code with implicit zero bits. Keep this
    // bounded to the register width; malformed streams cannot synthesize input.
    U next(){if(bit>=input.size()*8){if(++padding>32)fail("EGG AZO arithmetic stream exhausted");return 0;}U value=(input[bit/8]>>(7-bit%8))&1;++bit;return value;}
    void rescale(){
        while((low&0x80000000u)==(high&0x80000000u)){tag=(tag<<1)|next();low<<=1;high=(high<<1)|1;}
        while((low&0x40000000u)&&!(high&0x40000000u)){tag=((tag<<1)|next())^0x80000000u;low=(low<<1)&0x7fffffffu;high=(high<<1)|0x80000001u;}
    }
    U step(unsigned bits){if(bits==0||bits>31||tag<low||tag>high)bad();U t=(U)(((uint64_t)high-low+1)>>bits);if(!t)bad();return t;}
public:
    explicit Entropy(const std::vector<unsigned char> &bytes):input(bytes){for(unsigned i=0;i<32;++i)tag=(tag<<1)|next();}
    U code(unsigned bits){if(!bits)return 0;U t=step(bits),value=(tag-low)/t;if(value>=(1u<<bits))bad();high=low+t*(value+1)-1;low+=t*value;rescale();return value;}
    bool binary(U cumulative,unsigned bits){U t=step(bits),value=(tag-low)/t;if(value>=(1u<<bits)||!cumulative||cumulative>=(1u<<bits))bad();
        bool result=value>=cumulative;if(result)low+=t*cumulative;else high=low+t*cumulative-1;rescale();return result;}
    void finish(){if((bit+7)/8!=input.size())fail("EGG AZO arithmetic stream has unused bytes");}
};
struct Probability {
    std::vector<U> probability;unsigned bits=0;
    explicit Probability(unsigned symbols){while((1u<<bits)<symbols)++bits;probability.assign(size_t(1)<<bits,512);}
    void update(U value){U pre=1;for(int i=(int)bits-1;i>=0;--i){auto &p=probability.at(pre);bool v=(value>>i)&1;p=v?p-(p>>4):p+((1024-p)>>4);pre=(pre<<1)|U(v);}}
    U code(Entropy &entropy){U value=0,pre=1;for(int i=(int)bits-1;i>=0;--i){bool v=entropy.binary(probability.at(pre),10);value|=U(v)<<i;pre=(pre<<1)|U(v);}update(value);return value;}
    int compare(const Probability &other,U value)const{U p1=1,p2=1,pre=1;for(int i=(int)bits-1;i>=0;--i){bool v=(value>>i)&1;
        if((p1|p2)&0xffc00000u){p1>>=10;p2>>=10;}U a=probability.at(pre),b=other.probability.at(pre);p1*=v?1024-a:a;p2*=v?1024-b:b;pre=(pre<<1)|U(v);}return p1>p2?1:p1<p2?-1:0;}
};
struct Prediction {
    unsigned shift;std::vector<Probability> first,second;std::vector<int64_t> lucky;
    Prediction(unsigned keys,unsigned symbols,unsigned shift):shift(shift),lucky(keys){for(unsigned i=0;i<keys;++i)first.emplace_back(symbols);for(unsigned i=0;i<(keys>>shift);++i)second.emplace_back(symbols);}
    U code(Entropy &entropy,U previous){if(previous>=first.size())bad();auto &a=first[previous],&b=second[previous>>shift];U value;
        if(lucky[previous]>=0){value=a.code(entropy);b.update(value);}else{value=b.code(entropy);a.update(value);}lucky[previous]+=a.compare(b,value);return value;}
};
struct Boolean {
    std::array<U,256> probabilities{};U state=0;
    Boolean(){probabilities.fill(2048);}
    bool code(Entropy &entropy){auto &p=probabilities[state];bool value=entropy.binary(p,12);p=value?p-(p>>6):p+((4096-p)>>6);state=((state<<1)|U(value))&255;return value;}
};
struct History {
    std::array<U,2> values;Boolean state;Probability probability{2};
    explicit History(U initial=0):values{initial,initial+1}{}
    void add(U value,U index=1){if(index>=values.size())bad();for(U i=index;i>0;--i)values[i]=values[i-1];values[0]=value;}
    bool code(Entropy &entropy,U &value){if(!state.code(entropy))return false;U index=probability.code(entropy);if(index>=values.size())bad();value=values[index];add(value,index);return true;}
};
struct Dictionary {
    struct Match{U position=0,length=0;};std::array<Match,128> entries{};Boolean find;History history;Probability probability{128};
    Dictionary(){for(U i=0;i<entries.size();++i)entries[i].length=i+2;}
    void add(Match value,U index=127){if(index>=entries.size())bad();for(U i=index;i>0;--i)entries[i]=entries[i-1];entries[0]=value;}
    bool code(Entropy &entropy,Match &value){if(!find.code(entropy))return false;U index=0;if(!history.code(entropy,index)){index=probability.code(entropy);history.add(index);}if(index>=entries.size())bad();value=entries[index];add(value,index);return true;}
};
U distance_code(U distance){if(!distance)bad();--distance;if(distance<16)return distance;distance-=16;U value=distance/4+1,bits=0;while(value>>=1)++bits;return 16+bits*4+(distance-((1u<<bits)-1)*4)/(1u<<bits);}
void block(const std::vector<unsigned char> &input,std::vector<unsigned char> &output,const std::function<void()> &checkpoint){
    if(input.size()==output.size()){output=input;return;}
    if(input.size()+8>output.size()||output.empty())bad();
    Entropy entropy(input);Prediction alpha(256,256,5),length(128,128,4);Boolean match;Dictionary dictionary;History distance_history(1);Probability distance_probability(128);
    output[0]=(unsigned char)alpha.code(entropy,0);
    uint64_t next_checkpoint=16384;
    for(U pos=1;pos<output.size();){
        if(pos>=next_checkpoint){checkpoint();next_checkpoint=uint64_t(pos)+16384;}
        if(!match.code(entropy)){output[pos]=(unsigned char)alpha.code(entropy,output[pos-1]);++pos;continue;}
        Dictionary::Match entry;U distance,count;
        if(dictionary.code(entropy,entry)){if(entry.position>=pos)bad();distance=pos-entry.position;count=entry.length;}
        else{
            if(!distance_history.code(entropy,distance)){U code=distance_probability.code(entropy);if(code>=std::size(dist_table))bad();distance=dist_table[code]+entropy.code(dist_bits[code]);distance_history.add(distance);}
            U code=length.code(entropy,distance_code(distance));if(code>=std::size(length_table))bad();count=length_table[code]+entropy.code(length_bits[code]);dictionary.add({pos,count});
        }
        if(!distance||distance>pos||!count||count>output.size()-pos)bad();
        for(U i=0;i<count;++i)output[pos+i]=output[pos-distance+i];pos+=count;
    }
    entropy.finish();
}
U be(const unsigned char *p){return U(p[0])<<24|U(p[1])<<16|U(p[2])<<8|p[3];}
void x86(std::vector<unsigned char> &buffer,const std::function<void()> &checkpoint){uint64_t next_checkpoint=16384;for(size_t i=0;i+4<buffer.size();){
    if(i>=next_checkpoint){checkpoint();next_checkpoint=uint64_t(i)+16384;}
    if(buffer[i]==0xe8||buffer[i]==0xe9){if(buffer[i+4]==0||buffer[i+4]==255){
    U address=U(buffer[i+1])|U(buffer[i+2])<<8|U(buffer[i+3])<<16|U(buffer[i+4])<<24;address-=(U)i;address=(address&0x1000000)?address|0xff000000:address&0xffffff;
    for(unsigned j=0;j<4;++j)buffer[i+1+j]=(unsigned char)(address>>(j*8));}i+=5;}else ++i;}}
}
void egg_azo_decode(const EggRead &read,const EggWrite &write,uint64_t expected,uint64_t allocation_limit,const std::function<void()> &checkpoint){
    unsigned char header[12]{};read(header,2);if(header[0]!=0x31||header[1]>1)bad();const bool filter=header[1]!=0;uint64_t total=0;
    while(true){checkpoint();read(header,12);U expanded=be(header),packed=be(header+4),check=be(header+8);if((expanded^packed)!=check||packed>expanded)bad();
        if(!expanded&&!packed){if(total!=expected)bad();break;}if(!expanded||!packed||expanded>expected-total)bad();
        // Probability models use about 400 KiB in addition to the two buffers.
        if(uint64_t(expanded)+packed+1024*1024>allocation_limit)fail("EGG AZO block exceeds the memory budget","resource");
        std::vector<unsigned char> input(packed),output(expanded);read(input.data(),input.size());block(input,output,checkpoint);if(filter)x86(output,checkpoint);write(output.data(),output.size());total+=expanded;
    }
}
