#include <windows.h>
#include <algorithm>
#include <array>
#include <cwctype>
#include <limits>
#include <memory>
#include "alz.h"
#include "entry-details.h"
#include "extract-risk.h"
#include "extract-space.h"
#include "heartbeat.h"
#include "zlib.h"
#include "bzlib.h"

// BZ_NO_STDIO asks the embedding program to handle invariant failures. Each
// archive runs in a disposable helper, so terminate with a protocol error.
extern "C" void bz_internal_error(int){
    emit("{\"type\":\"error\",\"code\":\"archive\",\"message\":\"Archive BZip2 decoder invariant failed\"}");
    ExitProcess(1);
}

namespace {
constexpr uint32_t local_signature=0x015a4c42,central_signature=0x015a4c43,end_signature=0x025a4c43;
struct Handle {
    HANDLE value=INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE handle):value(handle){}
    ~Handle(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
    Handle(const Handle&)=delete;
};
struct Member {Entry entry;uint64_t offset;uint32_t crc,dos_time;uint8_t method;std::array<unsigned char,12> crypto{};};
struct Budget {
    ExtractionLimits limits=extraction_limits();uint64_t bytes=0;ULONGLONG started=GetTickCount64();
    void check(){if(archive_cancelled())fail("Archive operation cancelled","cancelled");
        if(GetTickCount64()-started>limits.milliseconds)fail("Archive operation exceeded its time budget","resource");}
    void add(size_t count){check();if(count>limits.bytes-bytes)fail("Archive operation exceeded its output budget","resource");bytes+=count;archive_activity();}
};

// ALZ has no filename encoding flag. Decode the selected page exactly; default
// to the original Korean page rather than silently truncating or replacing.
std::string decode_name(const std::string &bytes,int selected){
    const UINT page=selected?selected:949;
    if(bytes.find('\0')!=std::string::npos)fail("ALZ contains a NUL in a filename","safety");
    const int length=MultiByteToWideChar(page,MB_ERR_INVALID_CHARS,bytes.data(),(int)bytes.size(),nullptr,0);
    if(!length)fail("ALZ filename cannot be decoded in the selected encoding");
    std::wstring text(length,0);MultiByteToWideChar(page,MB_ERR_INVALID_CHARS,bytes.data(),(int)bytes.size(),text.data(),length);
    BOOL replaced=FALSE;const DWORD flags=page==CP_UTF8?WC_ERR_INVALID_CHARS:WC_NO_BEST_FIT_CHARS;
    const int count=WideCharToMultiByte(page,flags,text.data(),length,nullptr,0,nullptr,page==CP_UTF8?nullptr:&replaced);
    std::string roundtrip(count,0);
    if(!count||!WideCharToMultiByte(page,flags,text.data(),length,roundtrip.data(),count,nullptr,page==CP_UTF8?nullptr:&replaced)||replaced||roundtrip!=bytes)
        fail("ALZ filename cannot be decoded exactly in the selected encoding");
    return utf8(text);
}
std::string password_bytes(const std::string &password,int selected){
    const auto text=wide(password);const UINT page=selected?selected:949;BOOL replaced=FALSE;
    const DWORD flags=page==CP_UTF8?WC_ERR_INVALID_CHARS:WC_NO_BEST_FIT_CHARS;
    if(text.empty())return {};
    const int length=WideCharToMultiByte(page,flags,text.data(),(int)text.size(),nullptr,0,nullptr,page==CP_UTF8?nullptr:&replaced);
    std::string bytes(length,0);
    if(!length||!WideCharToMultiByte(page,flags,text.data(),(int)text.size(),bytes.data(),length,nullptr,page==CP_UTF8?nullptr:&replaced)||replaced)
        fail("ALZ password cannot be represented in the selected encoding","password");
    if(decode_name(bytes,selected)!=password)fail("ALZ password cannot be represented exactly in the selected encoding","password");
    return bytes;
}
uint64_t little(const unsigned char *bytes,unsigned count){uint64_t value=0;for(unsigned i=0;i<count;++i)value|=uint64_t(bytes[i])<<(8*i);return value;}
struct AlzVolume {
    Handle file;fs::path path;uint64_t size=0,start=0,skip=0,count=0;bool next=false;
    AlzVolume(const fs::path &source,size_t ordinal,Budget &budget):file(CreateFileW(source.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr)),path(source){
        if(file.value==INVALID_HANDLE_VALUE)fail("Cannot open required ALZ volume: "+utf8(source.filename().wstring()),"read");
        BY_HANDLE_FILE_INFORMATION info{};LARGE_INTEGER length{};
        if(!GetFileInformationByHandle(file.value,&info)||(info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))||
           !GetFileSizeEx(file.value,&length)||length.QuadPart<24)fail("Invalid or truncated ALZ volume");
        size=(uint64_t)length.QuadPart;unsigned char header[8]{},tail[16]{};read(0,header,sizeof(header),budget);read(size-sizeof(tail),tail,sizeof(tail),budget);
        if(little(header,4)!=0x015a4c41||little(header+4,2)!=10||little(header+6,2)!=ordinal)
            fail("Unsupported ALZ version or incorrect volume order");
        const auto end=little(tail+12,4);
        if(little(tail,4)!=central_signature||little(tail+4,8)||(end!=end_signature&&end!=0x035a4c43))fail("Invalid ALZ volume trailer");
        next=end==0x035a4c43;skip=ordinal?8:0;count=size-skip-(next?16:0);
    }
    void read(uint64_t offset,void *buffer,size_t remaining,Budget &budget){
        if(offset>size||remaining>size-offset)fail("Truncated ALZ volume");LARGE_INTEGER where{};where.QuadPart=(LONGLONG)offset;
        if(!SetFilePointerEx(file.value,where,nullptr,FILE_BEGIN))fail("Cannot seek ALZ volume","read");auto data=static_cast<unsigned char*>(buffer);
        while(remaining){budget.check();const auto chunk=(DWORD)std::min<size_t>(remaining,65536);DWORD actual=0;
            if(!ReadFile(file.value,data,chunk,&actual,nullptr)||actual!=chunk)fail("Cannot read ALZ volume","read");remaining-=chunk;data+=chunk;archive_activity();}
    }
};
class AlzReader {
    Budget io_budget;std::vector<std::unique_ptr<AlzVolume>> volumes;uint64_t length=0,position=0;
public:
    std::vector<Member> members;
    explicit AlzReader(const fs::path &source,int encoding){
        auto primary=source;auto extension=source.extension().wstring();for(auto &c:extension)c=(wchar_t)std::towlower(c);size_t entry_volume=0;
        if(extension!=L".alz"){
            if(extension.size()!=4||extension[0]!=L'.'||extension[1]<L'a'||extension[1]>L'k'||extension[2]<L'0'||extension[2]>L'9'||extension[3]<L'0'||extension[3]>L'9')fail("Invalid ALZ volume extension");
            entry_volume=1+size_t(extension[1]-L'a')*100+size_t(extension[2]-L'0')*10+size_t(extension[3]-L'0');primary.replace_extension(L".alz");
        }
        constexpr size_t max_volumes=1024;if(entry_volume>=max_volumes)fail("ALZ volume count exceeds its resource limit","resource");
        std::vector<fs::path> paths;
        for(size_t ordinal=0;;++ordinal){io_budget.check();auto path=primary;
            if(ordinal){const auto piece_number=ordinal-1;std::wstring suffix=L".a00";suffix[1]=(wchar_t)(L'a'+piece_number/100);suffix[2]=(wchar_t)(L'0'+piece_number%100/10);suffix[3]=(wchar_t)(L'0'+piece_number%10);path.replace_extension(suffix);}
            if(ordinal==entry_volume)path=source;
            auto volume=std::make_unique<AlzVolume>(path,ordinal,io_budget);volume->start=length;
            if(volume->count>UINT64_MAX-length)fail("ALZ volumes exceed their size limit","resource");length+=volume->count;
            const bool next=volume->next;paths.push_back(path);volumes.push_back(std::move(volume));if(!next)break;
            if(ordinal+1==max_volumes)fail("ALZ volume count exceeds its resource limit","resource");
        }
        if(entry_volume>=volumes.size())fail("Selected ALZ volume is not declared by the first volume");
        std::rotate(paths.begin(),paths.begin()+entry_volume,paths.begin()+entry_volume+1);bind_archive_members(source,paths);
        if(number(4)!=0x015a4c41||number(4)!=10)fail("Unsupported ALZ header or version");
        uint64_t names=0;Budget budget;bool ended=false;
        while(position<length){
            budget.check();auto signature=number(4);
            if(signature==central_signature){
                // Only the final volume trailer remains in the logical stream.
                if(number(4)||number(4)||number(4)!=end_signature||position!=length)fail("Invalid or unsupported ALZ footer");
                ended=true;break;
            }
            if(signature!=local_signature)fail("Invalid ALZ member header");
            if(members.size()>=1000000)fail("ALZ directory exceeds its entry budget","resource");
            const auto name_length=number(2),attributes=number(1),time=number(4),descriptor=number(1),reserved=number(1);
            const auto width=descriptor>>4;
            if(!name_length||name_length>32767||reserved||(descriptor&0x0e)||(width!=0&&width!=1&&width!=2&&width!=4&&width!=8))
                fail("Invalid or unsupported ALZ member descriptor");
            const bool directory=(attributes&0x10)!=0,encrypted=(descriptor&1)!=0;
            if(attributes&~0x37)fail("Unsupported ALZ member attributes","safety");
            Member member{{members.size(),{},directory,0,0,encrypted},0,0,(uint32_t)time,0};
            if(width){member.method=(uint8_t)number(1);if(number(1))fail("Unsupported ALZ compression flags");
                member.crc=(uint32_t)number(4);member.entry.compressed=number((unsigned)width);member.entry.size=number((unsigned)width);}
            if(member.method>2)fail("Unsupported ALZ compression method");
            if(member.entry.size>9007199254740991ull||member.entry.compressed>9007199254740991ull)fail("ALZ size exceeds its supported range","resource");
            if((directory&&(member.entry.size||member.entry.compressed||encrypted))||(!width&&encrypted))fail("Invalid ALZ directory or empty member");
            if((names+=name_length)>64ull*1024*1024)fail("ALZ directory exceeds its name budget","resource");
            std::string name((size_t)name_length,0);read(name.data(),name.size());member.entry.name=decode_name(name,encoding);
            if(encrypted)read(member.crypto.data(),member.crypto.size());
            member.offset=position;seek(position+bounded(member.entry.compressed));
            members.push_back(std::move(member));
        }
        if(!ended)fail("ALZ footer is missing or the archive is truncated");
    }
    uint64_t bounded(uint64_t count){if(count>length-position)fail("Truncated ALZ archive");return count;}
    void seek(uint64_t offset){if(offset>length)fail("Invalid ALZ offset");position=offset;}
    void read(void *buffer,size_t count){bounded(count);auto data=static_cast<unsigned char*>(buffer);
        auto volume=std::upper_bound(volumes.begin(),volumes.end(),position,[](uint64_t value,const auto &part){return value<part->start;});
        if(volume==volumes.begin())fail("Invalid ALZ volume offset");--volume;
        while(count){if(volume==volumes.end())fail("Truncated ALZ archive");const auto local=position-(*volume)->start;
            const auto chunk=(size_t)std::min<uint64_t>(count,(*volume)->count-local);if(chunk){(*volume)->read((*volume)->skip+local,data,chunk,io_budget);count-=chunk;data+=chunk;position+=chunk;}++volume;}}
    uint64_t number(unsigned width){unsigned char bytes[8]{};read(bytes,width);uint64_t result=0;for(unsigned i=0;i<width;i++)result|=uint64_t(bytes[i])<<(i*8);return result;}
    std::vector<Entry> entries()const{std::vector<Entry> result;result.reserve(members.size());for(const auto &member:members)result.push_back(member.entry);return result;}
};

void preflight(const std::vector<Entry> &entries){
    std::map<std::wstring,bool> seen;
    for(const auto &entry:entries){
        if(!safe_entry(entry.name,entry.directory))fail("Archive contains an unsafe path: "+entry.name,"safety");
        auto path=entry_path(entry.name).wstring();while(!path.empty()&&(path.back()==L'/'||path.back()==L'\\'))path.pop_back();
        std::transform(path.begin(),path.end(),path.begin(),[](wchar_t ch){return std::towlower(ch==L'/'?L'\\':ch);});
        if(!seen.emplace(path,entry.directory).second)fail("Archive contains duplicate paths","safety");
    }
    for(const auto &[path,directory]:seen)for(auto slash=path.find(L'\\');slash!=std::wstring::npos;slash=path.find(L'\\',slash+1)){
        auto parent=seen.find(path.substr(0,slash));if(parent!=seen.end()&&!parent->second)fail("Archive contains a file/folder path conflict","safety");}
}
class Crypto {
    uint32_t keys[3]{0x12345678,0x23456789,0x34567890};
    static uint32_t crc(uint32_t value,unsigned char byte){return (value>>8)^get_crc_table()[(value^byte)&255];}
    void update(unsigned char byte){keys[0]=crc(keys[0],byte);keys[1]=(keys[1]+(keys[0]&255))*134775813u+1;keys[2]=crc(keys[2],(unsigned char)(keys[1]>>24));}
public:
    explicit Crypto(const std::string &secret){for(unsigned char byte:secret)update(byte);}
    unsigned char byte(unsigned char value){uint32_t temp=(keys[2]&65535)|2;const auto plain=(unsigned char)(value^((temp*(temp^1))>>8));update(plain);return plain;}
    void decode(unsigned char *data,size_t count){for(size_t i=0;i<count;i++)data[i]=byte(data[i]);}
};
struct ZStream {z_stream value{};bool open=false;~ZStream(){if(open)inflateEnd(&value);}};
struct BStream {bz_stream value{};bool open=false;~BStream(){if(open)BZ2_bzDecompressEnd(&value);}};
void decode(AlzReader &reader,const Member &member,const std::string &password,HANDLE output,ExtractionSpace *space,Budget &budget){
    budget.check();const auto &entry=member.entry;if(entry.directory)return;
    Crypto crypto(password);
    if(entry.encrypted){if(password.empty())fail("ALZ password is required","password");auto check=member.crypto;crypto.decode(check.data(),check.size());
        if(check.back()!=(member.crc>>24))fail("ALZ password is incorrect","password");}
    reader.seek(member.offset);uint64_t remaining=entry.compressed,written=0;uLong crc=crc32(0,nullptr,0);
    std::array<unsigned char,65536> input{},out{};
    auto write=[&](size_t count){budget.add(count);if(count>entry.size-written)fail("ALZ member exceeds its declared size","safety");
        if(space)space->require(count);if(output!=INVALID_HANDLE_VALUE){DWORD actual=0;if(!WriteFile(output,out.data(),(DWORD)count,&actual,nullptr)||actual!=count)fail("Cannot write extracted ALZ file","write");}
        crc=crc32(crc,out.data(),(uInt)count);written+=count;};
    auto fill=[&](){budget.check();auto count=(size_t)std::min<uint64_t>(remaining,input.size());reader.read(input.data(),count);remaining-=count;
        if(entry.encrypted)crypto.decode(input.data(),count);return (unsigned)count;};
    if(member.method==0){
        if(entry.compressed!=entry.size)fail("Invalid stored ALZ member size");
        while(remaining){auto count=fill();std::copy_n(input.data(),count,out.data());write(count);}
    }else if(member.method==2){
        ZStream stream;if(inflateInit2(&stream.value,-MAX_WBITS)!=Z_OK)fail("Cannot initialize ALZ Deflate decoder","resource");stream.open=true;
        while(true){budget.check();if(!stream.value.avail_in&&remaining){stream.value.avail_in=fill();stream.value.next_in=input.data();}
            const auto before=stream.value.avail_in;stream.value.next_out=out.data();stream.value.avail_out=(uInt)out.size();
            auto result=inflate(&stream.value,Z_NO_FLUSH);auto count=out.size()-stream.value.avail_out;write(count);
            if(result==Z_STREAM_END){if(remaining||stream.value.avail_in)fail("ALZ Deflate member has trailing data");break;}
            if(result==Z_MEM_ERROR)fail("ALZ Deflate decoder exceeded its memory budget","resource");
            if(result!=Z_OK||(!count&&before==stream.value.avail_in))fail("Invalid or truncated ALZ Deflate member");
        }
    }else{
        BStream stream;auto count=fill();
        // Some ALZip-compatible writers use standard BZh framing for method 1.
        const bool standard=count>=3&&input[0]=='B'&&input[1]=='Z'&&input[2]=='h';
        auto result=standard?BZ2_bzDecompressInit(&stream.value,0,0):BZ2_alzDecompressInit(&stream.value);
        if(result!=BZ_OK)fail("Cannot initialize ALZ BZip2 decoder","resource");stream.open=true;
        stream.value.next_in=(char*)input.data();stream.value.avail_in=count;
        while(true){budget.check();if(!stream.value.avail_in&&remaining){stream.value.avail_in=fill();stream.value.next_in=(char*)input.data();}
            const auto before=stream.value.avail_in;stream.value.next_out=(char*)out.data();stream.value.avail_out=(unsigned)out.size();
            result=BZ2_bzDecompress(&stream.value);count=(unsigned)out.size()-stream.value.avail_out;write(count);
            if(result==BZ_STREAM_END){if(remaining||stream.value.avail_in)fail("ALZ BZip2 member has trailing data");break;}
            if(result==BZ_MEM_ERROR)fail("ALZ BZip2 decoder exceeded its memory budget","resource");
            if(result!=BZ_OK||(!count&&before==stream.value.avail_in))fail("Invalid or truncated ALZ BZip2 member");
        }
    }
    if(written!=entry.size||crc!=member.crc)fail("ALZ member size or CRC32 check failed",entry.encrypted?"password":"archive");
}
}

void alz_list(const fs::path &source,size_t offset,size_t limit,int encoding,const BrowseQuery *query){
    AlzReader reader(source,encoding);const auto revision=zip_revision(source);
    if(query){BrowseRows rows(*query);for(const auto &member:reader.members)rows.add(member.entry);rows.emit_page(reader.members.size(),{},revision,false,offset,limit);}
    else{emit("{\"type\":\"meta\",\"total\":"+std::to_string(reader.members.size())+",\"comment\":\"\",\"revision\":"+json(revision)+",\"editable\":false}");
        for(size_t i=offset;i<reader.members.size()&&i-offset<limit;i++){const auto &entry=reader.members[i].entry;
            emit("{\"type\":\"entry\",\"index\":"+std::to_string(i)+",\"name\":"+json(entry.name)+",\"directory\":"+(entry.directory?"true":"false")+",\"size\":"+std::to_string(entry.size)+",\"compressed\":"+std::to_string(entry.compressed)+",\"encrypted\":"+(entry.encrypted?"true":"false")+"}");}}
    if(zip_revision(source)!=revision)fail("ALZ changed during listing; reopen it");
}
void alz_details(const fs::path &source,size_t index,int encoding){
    AlzReader reader(source,encoding);if(index>=reader.members.size())fail("Entry index is out of range");const auto &member=reader.members[index];
    const char *method=member.method==0?"Store":member.method==1?"BZip2":"Deflate";
    FILETIME local{},utc{};ULARGE_INTEGER ticks{};std::optional<int64_t> modified;
    if(DosDateTimeToFileTime((WORD)(member.dos_time>>16),(WORD)member.dos_time,&local)&&LocalFileTimeToFileTime(&local,&utc)){
        ticks.LowPart=utc.dwLowDateTime;ticks.HighPart=utc.dwHighDateTime;modified=(int64_t)(ticks.QuadPart/10000)-11644473600000ll;}
    emit_details(member.entry,true,modified,member.entry.directory?"":entry_crc(member.crc),method);
}
std::vector<Entry> alz_entries(const fs::path &source,int encoding){AlzReader reader(source,encoding);auto entries=reader.entries();preflight(entries);return entries;}
void alz_test(const fs::path &source,const std::string &password,int encoding,bool result){
    AlzReader reader(source,encoding);Budget budget;size_t done=0;
    const bool encrypted=std::any_of(reader.members.begin(),reader.members.end(),[](const Member &member){return member.entry.encrypted;});
    const auto secret=encrypted?password_bytes(password,encoding):std::string{};
    for(const auto &member:reader.members){decode(reader,member,secret,INVALID_HANDLE_VALUE,nullptr,budget);
        emit("{\"type\":\"progress\",\"done\":"+std::to_string(++done)+",\"total\":"+std::to_string(reader.members.size())+"}");}
    if(result)emit("{\"type\":\"result\",\"count\":"+std::to_string(done)+"}");
}
size_t alz_extract(const fs::path &source,const fs::path &destination,const std::set<size_t> &selected,const std::string &password,int encoding,bool result,const std::vector<std::string> &folders){
    AlzReader reader(source,encoding);auto entries=reader.entries();preflight(entries);auto effective=selected;expand_folders(entries,effective,folders);
    if(!effective.empty()&&*effective.rbegin()>=entries.size())fail("Selected entry index is out of range");
    if(fs::exists(destination))fail("Extraction destination already exists");
    uint64_t expected=0;size_t total=0;ExtractionRisk risk;
    for(const auto &entry:entries)if(effective.empty()||effective.contains(entry.index)){
        if(entry.size>UINT64_MAX-expected)fail("ALZ declares too much extracted data","safety");expected+=entry.size;total++;risk.add(entry.name,entry.directory,entry.size,entry.compressed);}
    risk.check();ExtractionSpace space(destination.parent_path(),expected);Budget budget;size_t done=0;
    const bool encrypted=std::any_of(reader.members.begin(),reader.members.end(),[&](const Member &member){return member.entry.encrypted&&(effective.empty()||effective.contains(member.entry.index));});
    const auto secret=encrypted?password_bytes(password,encoding):std::string{};
    fs::create_directory(destination);
    for(const auto &member:reader.members){const auto &entry=member.entry;if(!effective.empty()&&!effective.contains(entry.index))continue;
        budget.check();auto target=destination/entry_path(entry.name);
        if(entry.directory)fs::create_directories(target);
        else{fs::create_directories(target.parent_path());Handle output(CreateFileW(target.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
            if(output.value==INVALID_HANDLE_VALUE)fail("Cannot create extracted ALZ file","write");decode(reader,member,secret,output.value,&space,budget);}
        emit("{\"type\":\"progress\",\"done\":"+std::to_string(++done)+",\"total\":"+std::to_string(total)+"}");
    }
    space.finish();if(result)emit("{\"type\":\"result\",\"count\":"+std::to_string(done)+"}");return done;
}
