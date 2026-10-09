#include "publish-access.h"
#include <aclapi.h>
#include <sddl.h>
#include <cassert>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <vector>
namespace fs=std::filesystem;
struct Held{HANDLE value;explicit Held(HANDLE handle):value(handle){}~Held(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}Held(const Held&)=delete;};
HANDLE open(const fs::path &file,DWORD access,DWORD share=FILE_SHARE_READ){return CreateFileW(file.c_str(),access,share,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);}
bool move(HANDLE handle,const fs::path &target){const auto name=target.wstring();std::vector<unsigned char> bytes(sizeof(FILE_RENAME_INFO)+name.size()*sizeof(wchar_t));const auto info=reinterpret_cast<FILE_RENAME_INFO*>(bytes.data());info->ReplaceIfExists=FALSE;info->RootDirectory=nullptr;info->FileNameLength=(DWORD)(name.size()*sizeof(wchar_t));memcpy(info->FileName,name.data(),info->FileNameLength);return SetFileInformationByHandle(handle,FileRenameInfo,info,(DWORD)bytes.size())!=FALSE;}
void sharing_denied(const fs::path &file,DWORD access,bool readonly){Held other(open(file,access,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE));const auto error=GetLastError();assert(other.value==INVALID_HANDLE_VALUE&&(error==ERROR_SHARING_VIOLATION||(readonly&&error==ERROR_ACCESS_DENIED)));}
void scenario(const fs::path &base,DWORD access,bool data_read,bool readonly=false){
 const auto source=base/L"source.bin",published=base/L"published.bin";BY_HANDLE_FILE_INFORMATION original{},after{};
 if(readonly)assert(SetFileAttributesW(source.c_str(),FILE_ATTRIBUTE_READONLY|FILE_ATTRIBUTE_HIDDEN));
 {
  Held input(open(source,access));assert(input.value!=INVALID_HANDLE_VALUE);assert(GetFileInformationByHandle(input.value,&original));assert(original.nFileSizeLow==7);
  char bytes[8]{};DWORD count=0;const auto readable=ReadFile(input.value,bytes,7,&count,nullptr);const auto read_error=GetLastError();if(data_read)assert(readable&&count==7&&!memcmp(bytes,"payload",7));else assert(!readable&&read_error==ERROR_ACCESS_DENIED);
  sharing_denied(source,GENERIC_WRITE,readonly);sharing_denied(source,DELETE,readonly);
  {Held reader(open(source,GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE));assert(reader.value!=INVALID_HANDLE_VALUE);count=0;assert(ReadFile(reader.value,bytes,7,&count,nullptr)&&count==7&&!memcmp(bytes,"payload",7));}
  assert(!move(input.value,base/L"occupied.bin"));assert(fs::exists(source));
  assert(move(input.value,published));assert(GetFileInformationByHandle(input.value,&after));assert(original.dwVolumeSerialNumber==after.dwVolumeSerialNumber&&original.nFileIndexHigh==after.nFileIndexHigh&&original.nFileIndexLow==after.nFileIndexLow&&original.nFileSizeLow==after.nFileSizeLow&&original.ftLastWriteTime.dwHighDateTime==after.ftLastWriteTime.dwHighDateTime&&original.ftLastWriteTime.dwLowDateTime==after.ftLastWriteTime.dwLowDateTime&&original.dwFileAttributes==after.dwFileAttributes);
  sharing_denied(published,GENERIC_WRITE,readonly);sharing_denied(published,DELETE,readonly);
  FILE_DISPOSITION_INFO deletion{TRUE};if(readonly){assert(!SetFileInformationByHandle(input.value,FileDispositionInfo,&deletion,sizeof(deletion)));assert(SetFileAttributesW(published.c_str(),FILE_ATTRIBUTE_NORMAL));}assert(SetFileInformationByHandle(input.value,FileDispositionInfo,&deletion,sizeof(deletion)));
 }
 assert(!fs::exists(source)&&!fs::exists(published));
 {Held writer(open(base/L"blocked.bin",GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE));assert(writer.value!=INVALID_HANDLE_VALUE);Held input(open(base/L"blocked.bin",access));const auto error=GetLastError();assert(input.value==INVALID_HANDLE_VALUE&&error==ERROR_SHARING_VIOLATION);}
 {Held reader(open(base/L"blocked.bin",GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE));assert(reader.value!=INVALID_HANDLE_VALUE);Held input(open(base/L"blocked.bin",access));const auto error=GetLastError();assert(input.value==INVALID_HANDLE_VALUE&&error==ERROR_SHARING_VIOLATION);}
}
void payload_acl(const fs::path &file,bool deny){
 HANDLE token=nullptr;assert(OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token));Held held_token(token);
 DWORD size=0;GetTokenInformation(token,TokenUser,nullptr,0,&size);assert(size);std::vector<unsigned char> bytes(size);assert(GetTokenInformation(token,TokenUser,bytes.data(),size,&size));
 LPWSTR sid=nullptr;assert(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(bytes.data())->User.Sid,&sid));const std::wstring user=sid;LocalFree(sid);
 const auto sddl=L"D:P"+std::wstring(deny?L"(D;;0x1;;;"+user+L")":L"")+L"(A;;FA;;;"+user+L")(A;;FA;;;SY)";
 PSECURITY_DESCRIPTOR descriptor=nullptr;assert(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(),SDDL_REVISION_1,&descriptor,nullptr));PACL acl=nullptr;BOOL present=FALSE,defaulted=FALSE;assert(GetSecurityDescriptorDacl(descriptor,&present,&acl,&defaulted)&&present);
 auto name=file.wstring();assert(SetNamedSecurityInfoW(name.data(),SE_FILE_OBJECT,DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,nullptr,nullptr,acl,nullptr)==ERROR_SUCCESS);LocalFree(descriptor);
 if(deny){Held original(open(file,GENERIC_READ|DELETE));assert(original.value==INVALID_HANDLE_VALUE&&GetLastError()==ERROR_ACCESS_DENIED);Held minimal(open(file,archive_publish_file_access));assert(minimal.value!=INVALID_HANDLE_VALUE);BY_HANDLE_FILE_INFORMATION info{};assert(GetFileInformationByHandle(minimal.value,&info));}
}
int wmain(int argc,wchar_t **argv){
 if(argc==3){const std::wstring mode=argv[1];assert(mode==L"--deny-payload-read"||mode==L"--allow-payload-read");payload_acl(argv[2],mode==L"--deny-payload-read");return 0;}
 assert(argc==2);const fs::path base=argv[1];scenario(base/L"original",GENERIC_READ|DELETE,true);scenario(base/L"minimal",archive_publish_file_access,false);scenario(base/L"original-readonly",GENERIC_READ|DELETE,true,true);scenario(base/L"minimal-readonly",archive_publish_file_access,false,true);puts("Publishing access passed: metadata and identity/attributes, payload-read denial, compatible readers, blocked writers/deleters, existing-handle conflicts, collision refusal, handle rename/delete, readonly deletion refusal and release in both access modes.");
}
