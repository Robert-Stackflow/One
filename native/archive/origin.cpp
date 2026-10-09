#include <windows.h>
#include <algorithm>
#include <array>
#include <memory>
#include "origin.h"

namespace {
std::wstring environment(const wchar_t *name,DWORD limit){
    const auto size=GetEnvironmentVariableW(name,nullptr,0);if(!size)return {};
    if(size>limit)fail("Source-mark environment value exceeds its limit","safety");
    std::wstring result(size,L'\0');SetLastError(ERROR_SUCCESS);
    const auto actual=GetEnvironmentVariableW(name,result.data(),size);
    if(actual>=size||(!actual&&GetLastError()!=ERROR_SUCCESS))fail("Source-mark environment changed","safety");
    result.resize(actual);return result;
}
struct Handle {
    HANDLE value=INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE value):value(value){}
    ~Handle(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
    Handle(const Handle&)=delete;
};
std::unique_ptr<Handle> hold(const fs::path &path,bool directory,DWORD access=FILE_READ_ATTRIBUTES,DWORD share=FILE_SHARE_READ|FILE_SHARE_WRITE){
    auto result=std::make_unique<Handle>(CreateFileW(path.c_str(),access,share,nullptr,OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT|(directory?FILE_FLAG_BACKUP_SEMANTICS:0),nullptr));
    if(result->value==INVALID_HANDLE_VALUE)fail("Cannot lock source-mark path (Windows error "+std::to_string(GetLastError())+")","safety");
    BY_HANDLE_FILE_INFORMATION info{};
    if(!GetFileInformationByHandle(result->value,&info)||(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||
        bool(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=directory)fail("Source-mark path contains a link or incompatible file","safety");
    return result;
}
std::vector<std::unique_ptr<Handle>> ancestors(const fs::path &path){
    if(!path.is_absolute()||path!=path.lexically_normal())fail("Source-mark path must be absolute and normalized","safety");
    std::vector<std::unique_ptr<Handle>> result;
    auto current=path.root_path();result.push_back(hold(current,true));
    for(const auto &part:path.relative_path()){
        // The colon for Zone.Identifier is constructed here, never accepted
        // from an archive entry, an environment override or a caller path.
        if(part.wstring().find(L':')!=std::wstring::npos)fail("Invalid source-mark path","safety");
        current/=part;result.push_back(hold(current,true));
        if(result.size()>512)fail("Source-mark path is too deep","safety");
    }
    return result;
}
std::string trim(std::string value){
    const auto start=value.find_first_not_of(" \t\r");if(start==std::string::npos)return {};
    return value.substr(start,value.find_last_not_of(" \t\r")-start+1);
}
std::string lower(std::string value){for(auto &ch:value)if(ch>='A'&&ch<='Z')ch+=('a'-'A');return value;}
unsigned parse(const unsigned char *bytes,size_t size){
    std::string text;
    if(size>=2&&bytes[0]==0xff&&bytes[1]==0xfe){
        if(size%2)fail("Malformed UTF-16 source mark","safety");
        std::wstring decoded;for(size_t i=2;i<size;i+=2)decoded.push_back(wchar_t(bytes[i]|unsigned(bytes[i+1])<<8));
        try{text=utf8(decoded);}catch(const std::exception &){fail("Malformed UTF-16 source mark","safety");}
    }else{
        size_t offset=size>=3&&bytes[0]==0xef&&bytes[1]==0xbb&&bytes[2]==0xbf?3:0;
        text.assign(reinterpret_cast<const char*>(bytes+offset),size-offset);
    }
    // Some downloaders include the string terminator in the ADS length.
    // Strip only terminal padding after decoding (also covers UTF-16); an
    // embedded NUL must not hide conflicting ZoneId fields or other content.
    const auto end=text.find_last_not_of('\0');
    text.resize(end==std::string::npos?0:end+1);
    if(text.find('\0')!=std::string::npos)fail("Malformed source mark","safety");
    // Browser URL fields may use an ANSI code page. Only the ASCII section
    // and ZoneId are interpreted; URL/referrer fields are never propagated.
    bool section=false,seen_section=false,seen_id=false;unsigned zone=0;
    for(size_t start=0;start<text.size();){
        auto end=text.find('\n',start);if(end==std::string::npos)end=text.size();
        auto line=trim(text.substr(start,end-start));start=end+1;
        if(line.empty()||line[0]==';'||line[0]=='#')continue;
        if(line[0]=='['){section=lower(line)=="[zonetransfer]";if(section){if(seen_section)fail("Duplicate source-mark section","safety");seen_section=true;}continue;}
        auto equal=line.find('=');if(!section||equal==std::string::npos)continue;
        if(lower(trim(line.substr(0,equal)))!="zoneid")continue;
        auto value=trim(line.substr(equal+1));
        if(seen_id||value.size()!=1||value[0]<'0'||value[0]>'4')fail("Invalid or duplicate source zone","safety");
        seen_id=true;zone=unsigned(value[0]-'0');
    }
    if(!seen_id)fail("Source mark has no valid ZoneId","safety");
    // Do not manufacture trust marks for local/intranet/trusted-zone files.
    return zone>=3?zone:0;
}
void mark(const fs::path &file,unsigned zone){
    auto base=hold(file,false);BY_HANDLE_FILE_INFORMATION before{};
    if(!GetFileInformationByHandle(base->value,&before)||before.nNumberOfLinks!=1)fail("Source-mark target is not an exclusive staged file","safety");
    Handle stream(CreateFileW((file.wstring()+L":Zone.Identifier").c_str(),GENERIC_WRITE,FILE_SHARE_READ,nullptr,CREATE_NEW,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
    if(stream.value==INVALID_HANDLE_VALUE)fail("Cannot preserve download source mark (Windows error "+std::to_string(GetLastError())+"); use a filesystem supporting named streams or explicitly disable propagation","write");
    BY_HANDLE_FILE_INFORMATION after{};
    if(!GetFileInformationByHandle(stream.value,&after)||after.dwVolumeSerialNumber!=before.dwVolumeSerialNumber||
        after.nFileIndexHigh!=before.nFileIndexHigh||after.nFileIndexLow!=before.nFileIndexLow)fail("Source-mark file identity changed","safety");
    const auto text="[ZoneTransfer]\r\nZoneId="+std::to_string(zone)+"\r\n";DWORD written=0;
    if(!WriteFile(stream.value,text.data(),(DWORD)text.size(),&written,nullptr)||written!=text.size()||!FlushFileBuffers(stream.value))
        fail("Cannot write or flush download source mark","write");
}
}
struct ArchiveOrigin::State {
    unsigned zone=0;
    std::vector<std::unique_ptr<Handle>> parents;
    std::unique_ptr<Handle> source,stream;
};
ArchiveOrigin::ArchiveOrigin(const fs::path &source):state(std::make_unique<State>()){
    const auto policy=environment(L"ONE_ARCHIVE_PROPAGATE_ZONE",8);
    if(!policy.empty()&&policy!=L"0"&&policy!=L"1")fail("Invalid source-mark policy","safety");
    auto original=source;
    const auto override=environment(L"ONE_ARCHIVE_ZONE_SOURCE",32768);
    if(!override.empty())original=override;
    if(!original.is_absolute()||original!=original.lexically_normal()||original.filename().wstring().find(L':')!=std::wstring::npos)fail("Invalid source-mark source","safety");
    state->parents=ancestors(original.parent_path());state->source=hold(original,false,GENERIC_READ,FILE_SHARE_READ);
    const auto expected=environment(L"ONE_ARCHIVE_ZONE_STAMP",256);
    if(!expected.empty()){
        BY_HANDLE_FILE_INFORMATION info{};if(!GetFileInformationByHandle(state->source->value,&info))fail("Cannot verify original archive","read");
        auto number=[](DWORD high,DWORD low){return (uint64_t(high)<<32)|low;};
        auto time=[&](const FILETIME &value){const auto raw=number(value.dwHighDateTime,value.dwLowDateTime);return raw>=116444736000000000ull?(raw-116444736000000000ull)*100:0;};
        const auto stamp=std::to_wstring(number(info.nFileSizeHigh,info.nFileSizeLow))+L":"+std::to_wstring(time(info.ftLastWriteTime))+L":"+std::to_wstring(time(info.ftCreationTime))+L":"+std::to_wstring(number(info.nFileIndexHigh,info.nFileIndexLow));
        if(stamp!=expected)fail("Original archive changed; reopen it before extracting","safety");
    }
    if(policy==L"0")return;
    state->stream=std::make_unique<Handle>(CreateFileW((original.wstring()+L":Zone.Identifier").c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
    if(state->stream->value==INVALID_HANDLE_VALUE){
        const auto error=GetLastError();if(error!=ERROR_FILE_NOT_FOUND&&error!=ERROR_PATH_NOT_FOUND&&error!=ERROR_INVALID_NAME&&error!=ERROR_NOT_SUPPORTED)
            fail("Cannot read download source mark (Windows error "+std::to_string(error)+")","read");
        state->stream.reset();return;
    }
    LARGE_INTEGER size{};if(!GetFileSizeEx(state->stream->value,&size)||size.QuadPart<1||size.QuadPart>4096)fail("Source mark exceeds 4 KiB or is empty","safety");
    std::array<unsigned char,4097> bytes{};DWORD read=0;
    if(!ReadFile(state->stream->value,bytes.data(),(DWORD)bytes.size(),&read,nullptr)||read!=size.QuadPart)fail("Cannot read complete download source mark","read");
    state->zone=parse(bytes.data(),read);
}
ArchiveOrigin::~ArchiveOrigin()=default;
unsigned ArchiveOrigin::zone() const{return state->zone;}
size_t ArchiveOrigin::apply(const fs::path &stage) const{
    if(!state->zone)return 0;
    // Lock every ancestor against deletion, then retain only the current
    // directory stack. File contents never enter this metadata pass.
    auto parents=ancestors(stage);size_t nodes=0,files=0;
    struct Frame {fs::directory_iterator current,end;std::unique_ptr<Handle> lock;};
    std::vector<Frame> stack;stack.push_back({fs::directory_iterator(stage),{},nullptr});
    while(!stack.empty()){
        if(archive_cancelled())fail("Source-mark propagation cancelled","cancelled");
        auto &frame=stack.back();if(frame.current==frame.end){stack.pop_back();continue;}
        auto file=frame.current->path();++frame.current;
        if(++nodes>1000000)fail("Too many source-mark targets","safety");
        const auto attr=GetFileAttributesW(file.c_str());
        if(attr==INVALID_FILE_ATTRIBUTES||attr&FILE_ATTRIBUTE_REPARSE_POINT)fail("Source-mark staging contains a link or missing file","safety");
        if(attr&FILE_ATTRIBUTE_DIRECTORY){
            if(stack.size()+parents.size()>512)fail("Source-mark staging is too deep","safety");
            auto locked=hold(file,true);stack.push_back({fs::directory_iterator(file),{},std::move(locked)});
        }else{mark(file,state->zone);++files;}
    }
    emit("{\"type\":\"origin\",\"zone\":"+std::to_string(state->zone)+",\"stagedFiles\":"+std::to_string(files)+"}");
    return files;
}
