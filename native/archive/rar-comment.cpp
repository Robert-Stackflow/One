#include "rar-comment.h"
#include "heartbeat.h"
#include <propidl.h>
#include <algorithm>
#include <atomic>
#include <cstring>
#include <memory>
#include <span>
#include <zlib.h>

namespace {
using Bytes=std::vector<unsigned char>;
using U32=uint32_t;
using U64=uint64_t;
constexpr size_t comment_limit=256<<10, scan_limit=8<<20;
[[noreturn]] void damaged(){fail("RAR archive comment is damaged or unsupported");}
void cancelled(){if(archive_cancelled())fail("Cancelled","cancelled");archive_activity();}
unsigned word(const unsigned char *p){return p[0]|unsigned(p[1])<<8;}
U32 dword(const unsigned char *p){return word(p)|U32(word(p+2))<<16;}
U32 checksum(std::span<const unsigned char> bytes){return (U32)crc32(0,bytes.data(),(uInt)bytes.size());}
GUID iid(unsigned group,unsigned number){return {0x23170f69,0x40c1,0x278a,{0,0,0,(BYTE)group,0,(BYTE)number,0,0}};}
template<class T> struct Release {void operator()(T *value)const{if(value)value->Release();}};
template<class T> using Com=std::unique_ptr<T,Release<T>>;
struct SeqIn:IUnknown {virtual HRESULT STDMETHODCALLTYPE Read(void*,U32,U32*)=0;};
struct SeqOut:IUnknown {virtual HRESULT STDMETHODCALLTYPE Write(const void*,U32,U32*)=0;};
struct Ratio:IUnknown {virtual HRESULT STDMETHODCALLTYPE SetRatioInfo(const U64*,const U64*)=0;};
struct Coder:IUnknown {virtual HRESULT STDMETHODCALLTYPE Code(SeqIn*,SeqOut*,const U64*,const U64*,Ratio*)=0;};
struct Properties:IUnknown {virtual HRESULT STDMETHODCALLTYPE SetDecoderProperties2(const unsigned char*,U32)=0;};

template<class Interface,unsigned number,unsigned group=3> class Stream:public Interface {
    std::atomic<ULONG> refs{1};
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void **out)override{
        if(!out)return E_POINTER;*out=nullptr;
        if(IsEqualGUID(id,IID_IUnknown)||IsEqualGUID(id,iid(group,number))){*out=this;AddRef();return S_OK;}return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release()override{auto value=--refs;if(!value)delete this;return value;}
    virtual ~Stream()=default;
};
class Input final:public Stream<SeqIn,1> {
    const Bytes &bytes;size_t position=0;
public:
    explicit Input(const Bytes &value):bytes(value){}
    HRESULT STDMETHODCALLTYPE Read(void *data,U32 size,U32 *done)override{
        if(!done)return E_POINTER;*done=0;if(archive_cancelled())return E_ABORT;
        *done=(U32)std::min<size_t>(size,bytes.size()-position);
        if(*done){memcpy(data,bytes.data()+position,*done);position+=*done;archive_activity();}return S_OK;
    }
};
class Output final:public Stream<SeqOut,2> {
    size_t limit;
public:
    Bytes bytes;
    explicit Output(size_t size):limit(size){bytes.reserve(size);}
    HRESULT STDMETHODCALLTYPE Write(const void *data,U32 size,U32 *done)override{
        if(!done)return E_POINTER;*done=0;if(archive_cancelled())return E_ABORT;
        if(!size)return S_OK;
        if(size>limit-bytes.size())return E_FAIL;
        try{const auto *p=(const unsigned char*)data;bytes.insert(bytes.end(),p,p+size);}
        catch(...){return E_OUTOFMEMORY;}
        *done=size;archive_activity();return S_OK;
    }
};
class Progress final:public Stream<Ratio,4,4> {
public:
    HRESULT STDMETHODCALLTYPE SetRatioInfo(const U64*,const U64*)override{
        if(archive_cancelled())return E_ABORT;archive_activity();return S_OK;
    }
};
Bytes decode(HMODULE engine,const Bytes &packed,size_t size,unsigned version,unsigned method){
    if(size>comment_limit||packed.size()>comment_limit)fail("RAR archive comment exceeds the size limit","resource");
    if(method==0x30){if(packed.size()!=size)damaged();return packed;}
    if(method<0x31||method>0x35||version<15||version>40)damaged();
    using Number=HRESULT(WINAPI*)(U32*);
    using Property=HRESULT(WINAPI*)(U32,PROPID,PROPVARIANT*);
    using Create=HRESULT(WINAPI*)(U32,const GUID*,void**);
    auto number=(Number)GetProcAddress(engine,"GetNumberOfMethods");
    auto property=(Property)GetProcAddress(engine,"GetMethodProperty");
    auto create=(Create)GetProcAddress(engine,"CreateDecoder");
    U32 count=0;if(!number||!property||!create||number(&count)!=S_OK||count>1024)damaged();
    const U64 method_id=0x40300+(version<20?1:version<29?2:3);
    Com<Coder> coder;
    for(U32 index=0;index<count;++index){
        PROPVARIANT value{};PropVariantInit(&value);
        const bool found=property(index,0,&value)==S_OK&&value.vt==VT_UI8&&value.uhVal.QuadPart==method_id;
        PropVariantClear(&value);if(!found)continue;
        Coder *object=nullptr;auto id=iid(4,5);const auto status=create(index,&id,(void**)&object);coder.reset(object);
        if(status!=S_OK)damaged();break;
    }
    if(!coder)damaged();
    Properties *object=nullptr;auto id=iid(4,0x22);
    const auto status=coder->QueryInterface(id,(void**)&object);Com<Properties> properties(object);
    const unsigned char solid=0;if(status!=S_OK||!properties||properties->SetDecoderProperties2(&solid,1)!=S_OK)damaged();
    Com<Input> input(new Input(packed));Com<Output> output(new Output(size));const U64 in=packed.size(),out=size;
    // RAR codecs require progress even though the generic ICoder contract allows null.
    Com<Progress> progress(new Progress);
    const auto result=coder->Code(input.get(),output.get(),&in,&out,progress.get());cancelled();
    if(result==E_OUTOFMEMORY)fail("RAR archive comment exceeded the memory budget","resource");
    if(result!=S_OK||output->bytes.size()!=size)damaged();return std::move(output->bytes);
}
std::string text(const Bytes &bytes,bool unicode,bool old){
    std::wstring value;
    if(unicode){
        if(bytes.size()%2)damaged();value.reserve(bytes.size()/2);
        for(size_t i=0;i<bytes.size();i+=2)value.push_back((wchar_t)word(bytes.data()+i));
        if(!value.empty()&&value.front()==0xfeff)value.erase(value.begin());
        // Reject malformed UTF-16 rather than quietly changing the comment.
        for(size_t i=0;i<value.size();++i){if(value[i]>=0xd800&&value[i]<=0xdbff){if(++i>=value.size()||value[i]<0xdc00||value[i]>0xdfff)damaged();}else if(value[i]>=0xdc00&&value[i]<=0xdfff)damaged();}
    }else if(!bytes.empty()){
        const UINT cp=old?CP_OEMCP:CP_ACP;
        const int count=MultiByteToWideChar(cp,0,(const char*)bytes.data(),(int)bytes.size(),nullptr,0);
        if(!count)damaged();value.resize(count);
        if(MultiByteToWideChar(cp,0,(const char*)bytes.data(),(int)bytes.size(),value.data(),count)!=count)damaged();
    }
    while(!value.empty()&&value.back()==0)value.pop_back();
    if(value.find(L'\0')!=std::wstring::npos)damaged();return utf8(value);
}
class Reader {
    HANDLE file;
public:
    U64 size=0;
    explicit Reader(const fs::path &source):file(CreateFileW(source.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_RANDOM_ACCESS,nullptr)){
        LARGE_INTEGER length{};if(file==INVALID_HANDLE_VALUE)fail("Cannot open archive comment","read");
        if(!GetFileSizeEx(file,&length)||length.QuadPart<0){CloseHandle(file);fail("Cannot read archive comment","read");}size=(U64)length.QuadPart;
    }
    ~Reader(){CloseHandle(file);}
    Bytes read(U64 offset,size_t count){
        cancelled();if(offset>size||count>size-offset)damaged();
        LARGE_INTEGER position{};position.QuadPart=offset;DWORD done=0;Bytes bytes(count);
        if(!SetFilePointerEx(file,position,nullptr,FILE_BEGIN)||!ReadFile(file,bytes.data(),(DWORD)count,&done,nullptr)||done!=count)fail("Cannot read archive comment","read");return bytes;
    }
};
std::string legacy(Reader &reader,U64 offset,size_t available,HMODULE engine){
    if(available<13)damaged();auto header=reader.read(offset,13);const auto length=word(header.data()+5);
    if(header[2]!=0x75||length<13||length>available||word(header.data())!=(checksum(std::span(header).subspan(2))&0xffff))damaged();
    auto bytes=decode(engine,reader.read(offset+13,length-13),word(header.data()+7),header[9],header[10]);
    if((checksum(bytes)&0xffff)!=word(header.data()+11))damaged();return text(bytes,false,true);
}
}

std::string rar4_comment(const fs::path &source,HMODULE engine){
    Reader reader(source);auto prefix=reader.read(0,(size_t)std::min<U64>(reader.size,7));
    const unsigned char marker[]={0x52,0x61,0x72,0x21,0x1a,0x07,0};
    U64 position=7;
    if(prefix.size()!=7||memcmp(prefix.data(),marker,7)!=0){
        prefix=reader.read(0,(size_t)std::min<U64>(reader.size,scan_limit+7));
        const auto found=std::search(prefix.begin(),prefix.end(),std::begin(marker),std::end(marker));
        if(found==prefix.end())return {};position=found-prefix.begin()+7;
    }
    auto main=reader.read(position,13);const unsigned main_size=word(main.data()+5),flags=word(main.data()+3);
    if(main[2]!=0x73||main_size<13||word(main.data())!=(checksum(std::span(main).subspan(2))&0xffff))damaged();
    if(flags&2)return legacy(reader,position+13,main_size-13,engine);
    // Encrypted headers cannot be parsed without duplicating the crypto reader.
    // The engine still handles their files; only their comments remain unavailable.
    if(flags&0x80)return {};
    position+=main_size;size_t headers=0,total_headers=0;
    while(position<reader.size){
        if(++headers>1000000)fail("RAR comment search exceeds the header limit","resource");
        auto head=reader.read(position,7);const auto type=head[2];const unsigned length=word(head.data()+5),bits=word(head.data()+3);
        if(length<7||length>reader.size-position)damaged();
        if((total_headers+=length)>64ull*1024*1024)fail("RAR comment search exceeds the header limit","resource");
        if(type==0x7b)return {};
        head=reader.read(position,length);U64 packed=(bits&0x8000)?(length>=11?dword(head.data()+7):0):0;
        if((bits&0x8000)&&length<11)damaged();
        if(type==0x74||type==0x7a){
            if(length<32)damaged();unsigned name=32;
            if(bits&0x100){if(length<40)damaged();packed|=U64(dword(head.data()+32))<<32;name=40;}
            if(word(head.data()+26)>length-name)damaged();
            if(type==0x7a&&!(bits&0x10)&&word(head.data()+26)==3&&memcmp(head.data()+name,"CMT",3)==0){
                if(word(head.data())!=(checksum(std::span(head).subspan(2))&0xffff))damaged();
                if(bits&(0x0007|0x100|0x400))damaged(); // split, encrypted or nonstandard large/salted CMT
                const U64 size=dword(head.data()+11);
                if(size>comment_limit||packed>comment_limit)fail("RAR archive comment exceeds the size limit","resource");
                auto bytes=decode(engine,reader.read(position+length,(size_t)packed),(size_t)size,head[24],head[25]);
                if(checksum(bytes)!=dword(head.data()+16))damaged();return text(bytes,(dword(head.data()+28)&1)!=0,false);
            }
        }
        if(packed>reader.size-position-length)damaged();position+=length+packed;
    }
    return {};
}
