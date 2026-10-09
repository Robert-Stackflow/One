#include <windows.h>
#include <algorithm>
#include <cwctype>
#include <memory>
#include <regex>
#include "egg.h"
#include "egg-codecs.h"
#include "entry-details.h"
#include "extract-risk.h"
#include "extract-space.h"
#include "heartbeat.h"
#include "resources.h"

namespace {
struct Handle {
    HANDLE value=INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE handle):value(handle){}
    ~Handle(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
    Handle(const Handle&)=delete;
};
struct Budget {
    ExtractionLimits limits=extraction_limits();uint64_t bytes=0;ULONGLONG started=GetTickCount64();
    void check(){if(archive_cancelled())fail("Archive operation cancelled","cancelled");
        if(GetTickCount64()-started>limits.milliseconds)fail("Archive operation exceeded its time budget","resource");}
    void add(size_t count){check();if(count>limits.bytes-bytes)fail("Archive operation exceeded its output budget","resource");bytes+=count;archive_activity();}
};
std::wstring folded(std::wstring value){for(auto &c:value)c=(wchar_t)std::towlower(c);return value;}
std::string decode_name(const std::string &bytes,unsigned page){
    if(bytes.empty())return {};
    if(bytes.size()>32767||bytes.find('\0')!=std::string::npos)fail("Invalid EGG filename","safety");
    if(!page)page=GetACP();
    const int length=MultiByteToWideChar(page,MB_ERR_INVALID_CHARS,bytes.data(),(int)bytes.size(),nullptr,0);
    if(!length)fail("EGG filename cannot be decoded in the selected encoding");
    std::wstring text(length,0);MultiByteToWideChar(page,MB_ERR_INVALID_CHARS,bytes.data(),(int)bytes.size(),text.data(),length);
    BOOL replaced=FALSE;const DWORD flags=page==CP_UTF8?WC_ERR_INVALID_CHARS:WC_NO_BEST_FIT_CHARS;
    const int count=WideCharToMultiByte(page,flags,text.data(),length,nullptr,0,nullptr,page==CP_UTF8?nullptr:&replaced);
    std::string roundtrip(count,0);
    if(!count||!WideCharToMultiByte(page,flags,text.data(),length,roundtrip.data(),count,nullptr,page==CP_UTF8?nullptr:&replaced)||replaced||roundtrip!=bytes)
        fail("EGG filename cannot be decoded exactly in the selected encoding");
    return utf8(text);
}
std::string decode_comment(const std::string &bytes){
    if(bytes.empty())return {};
    const int length=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,bytes.data(),(int)bytes.size(),nullptr,0);
    if(!length)fail("EGG comment is not valid UTF-8");
    std::wstring text(length,0);MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,bytes.data(),(int)bytes.size(),text.data(),length);return utf8(text);
}
class Volume {
    Handle file;
public:
    fs::path path;uint64_t size=0,start=0;EggVolumeHeader header;
    Volume(const fs::path &source,Budget &budget):file(CreateFileW(source.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr)),path(source){
        BY_HANDLE_FILE_INFORMATION info{};LARGE_INTEGER length{};
        if(file.value==INVALID_HANDLE_VALUE||!GetFileInformationByHandle(file.value,&info)||
           (info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))||!GetFileSizeEx(file.value,&length)||length.QuadPart<0)
            fail("Cannot open EGG volume","read");
        size=(uint64_t)length.QuadPart;
        header=egg_volume_header([&](uint64_t offset,unsigned char *data,size_t count){read(offset,data,count,budget);},size,[&]{budget.check();});
    }
    void read(uint64_t offset,unsigned char *data,size_t count,Budget &budget){
        if(offset>size||count>size-offset)fail("Truncated EGG volume");
        LARGE_INTEGER position{};position.QuadPart=(LONGLONG)offset;
        if(!SetFilePointerEx(file.value,position,nullptr,FILE_BEGIN))fail("Cannot seek EGG volume","read");
        while(count){budget.check();const auto chunk=(DWORD)std::min<size_t>(count,65536);DWORD actual=0;
            if(!ReadFile(file.value,data,chunk,&actual,nullptr)||actual!=chunk)fail("Cannot read EGG volume","read");
            count-=chunk;data+=chunk;archive_activity();}
    }
};
class EggReader {
    std::vector<std::unique_ptr<Volume>> volumes;uint64_t length=0;
public:
    Budget budget;EggDirectory directory;std::vector<Entry> entries;
    uint64_t memory=uint64_t(archive_resources().memory_mib)*1024*1024;
    EggReader(const fs::path &source,int encoding){
        volumes.push_back(std::make_unique<Volume>(source,budget));
        if(volumes.front()->header.split){
            // Only siblings from the same numbered EGG family are candidates.
            std::wsmatch match;const auto name=source.filename().wstring();
            if(std::regex_match(name,match,std::wregex(L"(.*)\\.vol[0-9]+\\.egg",std::regex_constants::icase))){
                const auto prefix=folded(match[1].str()+L".vol");size_t scanned=0;
                for(const auto &item:fs::directory_iterator(source.has_parent_path()?source.parent_path():fs::path(L"."))){
                    budget.check();if(++scanned>100000)fail("EGG volume discovery exceeded its scan budget","resource");
                    auto candidate=folded(item.path().filename().wstring());
                    if(candidate==folded(name)||!candidate.starts_with(prefix)||!candidate.ends_with(L".egg"))continue;
                    const auto digits=candidate.substr(prefix.size(),candidate.size()-prefix.size()-4);
                    if(digits.empty()||digits.find_first_not_of(L"0123456789")!=std::wstring::npos)continue;
                    if(volumes.size()>=1024)fail("EGG has too many volumes","resource");
                    volumes.push_back(std::make_unique<Volume>(item.path(),budget));
                }
            }
        }
        std::vector<EggVolumeHeader> headers;for(const auto &volume:volumes)headers.push_back(volume->header);
        const auto order=egg_order_volumes(headers);std::vector<std::unique_ptr<Volume>> sorted;std::vector<fs::path> paths;
        for(auto index:order){auto &volume=volumes[index];volume->start=length;
            const auto count=volume->size-volume->header.payload;if(count>UINT64_MAX-length)fail("EGG volumes are too large","resource");
            length+=count;paths.push_back(volume->path);sorted.push_back(std::move(volume));}
        volumes=std::move(sorted);
        // Revision binding requires the user's entry volume first; decoding
        // still uses the linked first-to-last order held above.
        const auto entry=std::find(paths.begin(),paths.end(),source);if(entry==paths.end())fail("Invalid EGG entry volume");
        std::rotate(paths.begin(),entry,entry+1);bind_archive_members(source,paths);
        // Reserve another eighth for decoded UTF-8 names and UI Entry copies.
        EggIndexLimits limits;limits.memory=memory/8;limits.names=std::min<uint64_t>(limits.names,memory/32);
        directory=egg_directory([&](uint64_t offset,unsigned char *data,size_t count){read(offset,data,count);},length,volumes.front()->header.solid,limits,[&]{budget.check();});
        entries.reserve(directory.members.size());
        for(const auto &member:directory.members){budget.check();
            auto name=decode_name(member.name,encoding?(unsigned)encoding:member.encoding);std::replace(name.begin(),name.end(),'\\','/');
            entries.push_back({entries.size(),std::move(name),member.directory(),member.size,member.packed,member.encryption.encrypted()});}
    }
    void read(uint64_t offset,unsigned char *data,size_t count){
        if(offset>length||count>length-offset)fail("Truncated EGG payload");
        auto found=std::upper_bound(volumes.begin(),volumes.end(),offset,[](uint64_t value,const auto &volume){return value<volume->start;});
        if(found==volumes.begin())fail("Invalid EGG volume offset");--found;
        while(count){if(found==volumes.end())fail("Truncated EGG payload");auto &volume=**found;
            const auto local=offset-volume.start,available=volume.size-volume.header.payload-local;
            const auto chunk=(size_t)std::min<uint64_t>(count,available);
            if(chunk){volume.read(volume.header.payload+local,data,chunk,budget);offset+=chunk;data+=chunk;count-=chunk;}++found;}
    }
};
void preflight(const EggReader &reader){
    std::map<std::wstring,bool> seen;
    for(const auto &entry:reader.entries){const auto &member=reader.directory.members[entry.index];
        const auto mode=member.posix_mode&0170000;
        if((member.name_flags&16)||member.link()||(member.posix_info&&mode&&mode!=0100000&&mode!=0040000)||
           (member.attributes&~0x87)||!safe_entry(entry.name,entry.directory))fail("EGG contains an unsafe or unsupported entry","safety");
        auto name=entry_path(entry.name).wstring();while(!name.empty()&&(name.back()==L'/'||name.back()==L'\\'))name.pop_back();
        std::replace(name.begin(),name.end(),L'/',L'\\');name=folded(name);
        if(!seen.emplace(name,entry.directory).second)fail("EGG contains colliding filenames","safety");
    }
    for(const auto &[name,directory]:seen){(void)directory;auto parent=fs::path(name).parent_path();while(!parent.empty()){
        auto found=seen.find(parent.wstring());if(found!=seen.end()&&!found->second)fail("EGG contains a file/folder conflict","safety");parent=parent.parent_path();}}
}
using Begin=std::function<void(size_t)>;using Write=std::function<void(size_t,const unsigned char*,size_t)>;
void walk(EggReader &reader,const std::set<size_t> &selected,const std::string &password,const Begin &begin,const Write &write,const Begin &end){
    const auto wanted=[&](size_t index){return selected.empty()||selected.contains(index);};
    const auto decode=[&](const EggBlock &block,EggCipher &cipher,const EggWrite &output){uint64_t offset=block.offset;
        egg_decode_block(block,[&](unsigned char *data,size_t count){reader.read(offset,data,count);offset+=count;},
            [&](const unsigned char *data,size_t count){reader.budget.add(count);output(data,count);},cipher,reader.memory*3/4,[&]{reader.budget.check();});};
    if(!reader.directory.solid){
        for(size_t i=0;i<reader.entries.size();++i){if(!wanted(i))continue;reader.budget.check();begin(i);
            const auto &member=reader.directory.members[i];EggCipher cipher(member.encryption,password);
            for(size_t n=0;n<member.block_count;++n)decode(reader.directory.blocks[member.first_block+n],cipher,[&](const unsigned char *data,size_t count){write(i,data,count);});
            cipher.finish();end(i);}
        return;
    }
    size_t index=0;uint64_t remaining=0;bool opened=false;
    const auto advance=[&]{while(index<reader.entries.size()&&!opened){const auto &entry=reader.entries[index];if(wanted(index))begin(index);
        remaining=entry.size;if(!remaining){if(wanted(index))end(index);++index;}else opened=true;}};
    advance();EggCipher cipher(EggEncryption{},{});
    for(const auto &block:reader.directory.blocks)decode(block,cipher,[&](const unsigned char *data,size_t count){while(count){
        if(index>=reader.entries.size()||!opened)fail("EGG solid output exceeds declared file sizes");
        const auto chunk=(size_t)std::min<uint64_t>(count,remaining);if(wanted(index))write(index,data,chunk);
        remaining-=chunk;data+=chunk;count-=chunk;if(!remaining){if(wanted(index))end(index);++index;opened=false;advance();}}});
    cipher.finish();if(index!=reader.entries.size()||opened)fail("EGG solid output is incomplete");
}
void progress(size_t done,size_t total){emit("{\"type\":\"progress\",\"done\":"+std::to_string(done)+",\"total\":"+std::to_string(total)+"}");}
}

void egg_list(const fs::path &source,size_t offset,size_t limit,int encoding,const BrowseQuery *query){
    EggReader reader(source,encoding);const auto revision=zip_revision(source);
    const auto comment=decode_comment(reader.directory.comment);
    if(query){BrowseRows rows(*query);for(const auto &entry:reader.entries){reader.budget.check();rows.add(entry);}rows.emit_page(reader.entries.size(),comment,revision,false,offset,limit);}
    else{emit("{\"type\":\"meta\",\"total\":"+std::to_string(reader.entries.size())+",\"comment\":"+json(comment)+",\"revision\":"+json(revision)+",\"editable\":false}");
        for(size_t i=offset;i<reader.entries.size()&&i-offset<limit;++i){reader.budget.check();const auto &entry=reader.entries[i];
            emit("{\"type\":\"entry\",\"index\":"+std::to_string(i)+",\"name\":"+json(entry.name)+",\"directory\":"+(entry.directory?"true":"false")+",\"size\":"+std::to_string(entry.size)+",\"compressed\":"+std::to_string(entry.compressed)+",\"encrypted\":"+(entry.encrypted?"true":"false")+"}");}}
    if(zip_revision(source)!=revision)fail("EGG changed during listing; reopen it");
}
void egg_details(const fs::path &source,size_t index,int encoding){
    EggReader reader(source,encoding);if(index>=reader.entries.size())fail("Entry index is out of range");const auto &member=reader.directory.members[index];
    std::optional<int64_t> modified;
    if(member.windows_info)modified=(int64_t)(member.windows_time/10000)-11644473600000ll;
    else if(member.posix_info&&member.unix_time<=uint64_t(INT64_MAX/1000))modified=(int64_t)member.unix_time*1000;
    std::string method,crc;const char *names[]={"Store","Deflate","BZip2","AZO","LZMA"};
    for(size_t n=0;n<member.block_count;++n){auto value=reader.directory.blocks[member.first_block+n].method;auto name=value<5?names[value]:"Unknown";
        if(method.empty())method=name;else if(method!=name){method="Mixed";break;}}
    if(!reader.directory.solid&&member.block_count==1)crc=entry_crc(reader.directory.blocks[member.first_block].crc);
    emit_details(reader.entries[index],!reader.directory.solid,modified,crc,method,reader.directory.solid);
}
std::vector<Entry> egg_entries(const fs::path &source,int encoding){EggReader reader(source,encoding);preflight(reader);return reader.entries;}
void egg_test(const fs::path &source,const std::string &password,int encoding,bool result){
    EggReader reader(source,encoding);size_t done=0;walk(reader,{},password,[](size_t){},[](size_t,const unsigned char*,size_t){},[&](size_t){progress(++done,reader.entries.size());});
    if(result)emit("{\"type\":\"result\",\"count\":"+std::to_string(done)+"}");
}
size_t egg_extract(const fs::path &source,const fs::path &destination,const std::set<size_t> &selected,const std::string &password,int encoding,bool result,const std::vector<std::string> &folders){
    EggReader reader(source,encoding);preflight(reader);auto effective=selected;expand_folders(reader.entries,effective,folders);
    if(!effective.empty()&&*effective.rbegin()>=reader.entries.size())fail("Selected entry index is out of range");
    if(fs::exists(destination))fail("Extraction destination already exists");
    uint64_t expected=0;size_t total=0;ExtractionRisk risk;bool packed_added=false;
    for(const auto &entry:reader.entries)if(effective.empty()||effective.contains(entry.index)){
        if(entry.size>UINT64_MAX-expected)fail("EGG declares too much extracted data","safety");expected+=entry.size;++total;
        const auto packed=reader.directory.solid?(packed_added||entry.directory?0:reader.directory.packed):entry.compressed;
        risk.add(entry.name,entry.directory,entry.size,packed);if(!entry.directory)packed_added=true;}
    risk.check();ExtractionSpace space(destination.parent_path(),expected);size_t done=0;std::unique_ptr<Handle> output;
    fs::create_directory(destination);
    walk(reader,effective,password,[&](size_t index){const auto &entry=reader.entries[index];const auto target=destination/entry_path(entry.name);
        if(entry.directory)fs::create_directories(target);else{fs::create_directories(target.parent_path());output=std::make_unique<Handle>(CreateFileW(target.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
            if(output->value==INVALID_HANDLE_VALUE)fail("Cannot create extracted EGG file","write");}},
        [&](size_t,const unsigned char *data,size_t count){space.require(count);DWORD written=0;
            if(!output||!WriteFile(output->value,data,(DWORD)count,&written,nullptr)||written!=count)fail("Cannot write extracted EGG file","write");},
        [&](size_t){output.reset();progress(++done,total);});
    space.finish();if(result)emit("{\"type\":\"result\",\"count\":"+std::to_string(done)+"}");return done;
}
