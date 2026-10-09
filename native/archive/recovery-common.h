#pragma once
#include <windows.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <cwctype>
#include <map>
#include <memory>
#include <string_view>
#include <zlib.h>
#include "common.h"
#include "heartbeat.h"


namespace archive_recovery {
struct Locked {
    HANDLE value=INVALID_HANDLE_VALUE;
    Locked(const fs::path &path,bool directory,DWORD access=FILE_READ_ATTRIBUTES){
        value=CreateFileW(path.c_str(),access,FILE_SHARE_READ,nullptr,OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT|(directory?FILE_FLAG_BACKUP_SEMANTICS:0),nullptr);
        if(value==INVALID_HANDLE_VALUE)fail("Cannot lock recovery path: "+utf8(path.wstring()),"safety");
        BY_HANDLE_FILE_INFORMATION info{};
        if(!GetFileInformationByHandle(value,&info)||(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||
            bool(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=directory||(!directory&&info.nNumberOfLinks!=1)){
            CloseHandle(value);value=INVALID_HANDLE_VALUE;fail("Recovery path contains a link or incompatible file","safety");
        }
    }
    ~Locked(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
    void close(){if(value!=INVALID_HANDLE_VALUE){CloseHandle(value);value=INVALID_HANDLE_VALUE;}}
    Locked(const Locked&)=delete;
};
inline std::string stamp(HANDLE handle,bool identity=false){
    BY_HANDLE_FILE_INFORMATION info{};if(!GetFileInformationByHandle(handle,&info))fail("Cannot verify recovery file identity","safety");
    const auto id=std::to_string(info.dwVolumeSerialNumber)+":"+std::to_string(info.nFileIndexHigh)+":"+std::to_string(info.nFileIndexLow);
    return identity?id:id+":"+std::to_string(info.nFileSizeHigh)+":"+std::to_string(info.nFileSizeLow)+":"+
        std::to_string(info.ftLastWriteTime.dwHighDateTime)+":"+std::to_string(info.ftLastWriteTime.dwLowDateTime);
}
inline std::wstring key(const fs::path &path){auto text=path.wstring();std::transform(text.begin(),text.end(),text.begin(),[](wchar_t c){return c==L'/'?L'\\':std::towlower(c);});return text;}
inline DWORD attributes(const fs::path &path){auto value=GetFileAttributesW(path.c_str());if(value==INVALID_FILE_ATTRIBUTES&&GetLastError()!=ERROR_FILE_NOT_FOUND&&GetLastError()!=ERROR_PATH_NOT_FOUND)fail("Cannot inspect recovery path","safety");return value;}
struct Directories {
    std::map<std::wstring,std::unique_ptr<Locked>> held;
    void hold(const fs::path &path,DWORD access=FILE_READ_ATTRIBUTES){auto name=key(path);if(!held.contains(name))held.emplace(name,std::make_unique<Locked>(path,true,access));}
    // Lock each ancestor before opening a descendant; never traverse a junction.
    bool ancestors(const fs::path &path,bool missing=false){
        if(!path.is_absolute()||path!=path.lexically_normal())fail("Recovery path must be absolute and normalized","safety");
        auto current=path.root_path();hold(current);
        for(const auto &part:path.relative_path()){current/=part;if(attributes(current)==INVALID_FILE_ATTRIBUTES){if(missing)return false;fail("Recovery ancestor is missing","safety");}hold(current);}return true;
    }
};
inline bool cancelled(){DWORD available=0,read=0;unsigned char byte=0;const auto input=GetStdHandle(STD_INPUT_HANDLE);return PeekNamedPipe(input,&byte,1,&read,&available,nullptr)&&available&&read==1&&byte==2;}
inline void check_cancel(){if(cancelled())fail("Recovery stopped; verified files already moved remain recoverable","cancelled");}
inline void move(HANDLE handle,const fs::path &destination){
    const auto name=destination.wstring();std::vector<unsigned char> bytes(sizeof(FILE_RENAME_INFO)+name.size()*sizeof(wchar_t));
    auto info=reinterpret_cast<FILE_RENAME_INFO*>(bytes.data());info->ReplaceIfExists=FALSE;info->RootDirectory=nullptr;
    info->FileNameLength=(DWORD)(name.size()*sizeof(wchar_t));std::memcpy(info->FileName,name.data(),info->FileNameLength);
    if(!SetFileInformationByHandle(handle,FileRenameInfo,info,(DWORD)bytes.size()))fail("Recovery destination appeared or file cannot be moved (Windows error "+std::to_string(GetLastError())+")","safety");
    archive_activity();
}
inline void crash(const std::string &point){
    wchar_t mode[2]{},value[80]{};GetEnvironmentVariableW(L"ONE_TEST_MODE",mode,2);if(std::wstring(mode)!=L"1")return;
    GetEnvironmentVariableW(L"ONE_ARCHIVE_RECOVER_CRASH_POINT",value,80);
    if(utf8(value)==point){TerminateProcess(GetCurrentProcess(),77);ExitProcess(77);}
}
inline bool uuid(const std::wstring &value){if(value.size()!=36)return false;for(size_t i=0;i<value.size();++i){if(i==8||i==13||i==18||i==23){if(value[i]!=L'-')return false;}else if(!((value[i]>=L'0'&&value[i]<=L'9')||(value[i]>=L'a'&&value[i]<=L'f')))return false;}return true;}
inline bool valid_stamp(const std::string &text,unsigned parts){
    unsigned count=0;uint64_t value=0;bool digit=false;
    for(char c:text+':'){if(c==':'){if(!digit||value>0xffffffffull)return false;++count;value=0;digit=false;}else if(c>='0'&&c<='9'){digit=true;value=value*10+unsigned(c-'0');if(value>0xffffffffull)return false;}else return false;}
    return count==parts;
}
inline bool inside(const fs::path &root,const fs::path &path,bool directory=false){
    if(!path.is_absolute()||path!=path.lexically_normal())return false;
    auto prefix=key(root);if(!prefix.ends_with(L'\\'))prefix+=L'\\';const auto name=key(path);
    return name.starts_with(prefix)&&safe_entry(utf8(path.wstring().substr(prefix.size())),directory);
}
// Strict parser for the canonical JSON written by the native publisher. It
// accepts no arrays, arbitrary nesting, duplicate fields or noncanonical escapes.
struct Cursor {
    std::string_view text;size_t at=0;
    void take(std::string_view value){if(text.substr(at,value.size())!=value)fail("Recovery journal format is invalid","safety");at+=value.size();}
    std::string string(){
        const auto start=at;take("\"");std::string value;bool closed=false;
        while(at<text.size()){
            char c=text[at++];if(c=='\"'){closed=true;break;}
            if(c=='\\'){if(at==text.size())break;c=text[at++];if(c=='\"'||c=='\\')value+=c;else if(c=='u'){
                take("00");unsigned byte=0;for(int i=0;i<2;++i){if(at==text.size())fail("Recovery journal escape is incomplete","safety");const auto digit=text[at++];if(digit>='0'&&digit<='9')byte=byte*16+digit-'0';else if(digit>='a'&&digit<='f')byte=byte*16+digit-'a'+10;else fail("Recovery journal escape is invalid","safety");}value+=char(byte);
            }else fail("Recovery journal escape is invalid","safety");}else{if((unsigned char)c<32)fail("Recovery journal contains control characters","safety");value+=c;}
        }
        if(!closed||json(value)!=text.substr(start,at-start))fail("Recovery journal string is not canonical","safety");wide(value);return value;
    }
    uint64_t number(){const auto start=at;uint64_t value=0;while(at<text.size()&&text[at]>='0'&&text[at]<='9'){value=value*10+text[at++]-'0';if(value>3000010)fail("Recovery journal number exceeds limit","safety");}if(at==start||std::to_string(value)!=text.substr(start,at-start))fail("Recovery journal number is invalid","safety");return value;}
    void field(const char *name){take(",");take(json(name));take(":");}
    std::string text_field(const char *name){field(name);return string();}
    uint64_t count_field(const char *name){field(name);return number();}
    bool boolean(){if(text.substr(at,4)=="true"){at+=4;return true;}take("false");return false;}
    bool bool_field(const char *name){field(name);return boolean();}
    void end(){if(at!=text.size())fail("Recovery journal has unexpected fields","safety");}
};
inline void erase(HANDLE handle){FILE_DISPOSITION_INFO value{TRUE};if(!SetFileInformationByHandle(handle,FileDispositionInfo,&value,sizeof(value)))fail("Cannot remove verified recovery data; remaining files retained","safety");archive_activity();}
inline void check_contents(const fs::path &recovery,const std::set<std::wstring> &allowed){
    size_t count=0;for(const auto &entry:fs::directory_iterator(recovery)){
        check_cancel();archive_activity();if(++count>2000001||!allowed.contains(key(entry.path().filename())))fail("Recovery directory contains unknown files; nothing unknown was removed","safety");
        const auto attr=attributes(entry.path());if(attr==INVALID_FILE_ATTRIBUTES||(attr&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT)))fail("Recovery directory contains a link or incompatible file","safety");
    }
}
}
