#include "zip-common.h"
#include "update-common.h"
#include "heartbeat.h"
#include <bcrypt.h>
#include <map>
#include <memory>
#include <mutex>

namespace {
using File=archive_update::File;
struct Source {
    std::vector<fs::path> members;
    std::map<std::wstring,std::unique_ptr<File>> locks;
    std::string expected;
};
// One native process serves one operation. Keep read locks through the final
// revision check, including between a drag's enumeration and materialization.
std::map<std::wstring,Source> sources;
std::mutex source_mutex;
std::wstring key(const fs::path &path){return archive_update::key(utf8(fs::absolute(path).lexically_normal().wstring()));}
Source &state(const fs::path &path){const auto name=key(path);if(!sources.contains(name)&&sources.size()>=64)fail("Too many archive revision sources","safety");return sources[name];}
class Hash {
    BCRYPT_ALG_HANDLE algorithm=nullptr;
    BCRYPT_HASH_HANDLE hash=nullptr;
    std::vector<unsigned char> object;
public:
    Hash(){try{
        ULONG size=0,read=0;
        if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0||
           BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&size),sizeof(size),&read,0)<0||size>65536)fail("Cannot initialize archive revision hash");
        object.resize(size);
        if(BCryptCreateHash(algorithm,&hash,object.data(),size,nullptr,0,0)<0)fail("Cannot initialize archive revision hash");
    }catch(...){close();throw;}}
    ~Hash(){close();}
    void close(){if(hash){BCryptDestroyHash(hash);hash=nullptr;}if(algorithm){BCryptCloseAlgorithmProvider(algorithm,0);algorithm=nullptr;}}
    void add(const std::string &value){
        const auto length=std::to_string(value.size())+":";
        for(const auto *part:{&length,&value})if(BCryptHashData(hash,reinterpret_cast<PUCHAR>(const_cast<char*>(part->data())),(ULONG)part->size(),0)<0)fail("Cannot hash archive revision");
    }
    std::string finish(){unsigned char bytes[32]{};if(BCryptFinishHash(hash,bytes,sizeof(bytes),0)<0)fail("Cannot finish archive revision hash");
        const char hex[]="0123456789abcdef";std::string result="v2:";for(auto byte:bytes){result+=hex[byte>>4];result+=hex[byte&15];}return result;}
};
std::string revision(const std::vector<fs::path> &members){
    if(members.empty()||members.size()>4096)fail("Invalid archive volume set","safety");
    if(members.size()==1){File file(members[0]);return archive_update::stamp(file.handle);}
    Hash hash;hash.add("One archive member identities v2");hash.add(std::to_string(members.size()));
    for(const auto &member:members){if(archive_cancelled())fail("Archive task cancelled","cancelled");archive_activity();
        File file(member);hash.add(utf8(key(member)));hash.add(archive_update::stamp(file.handle));}
    return hash.finish();
}
}

void lock_archive_source(const fs::path &source){std::lock_guard guard(source_mutex);auto &value=state(source);const auto name=key(source);if(!value.locks.contains(name))value.locks.emplace(name,std::make_unique<File>(source,GENERIC_READ,FILE_SHARE_READ));}
void expect_archive_revision(const fs::path &source,const std::string &expected){
    std::lock_guard guard(source_mutex);
    if(expected.empty()||expected.size()>256)fail("Archive revision is invalid");state(source).expected=expected;
}
void bind_archive_members(const fs::path &source,const std::vector<fs::path> &members){
    std::lock_guard guard(source_mutex);
    if(members.empty()||members.size()>4096||key(members[0])!=key(source))fail("Invalid archive volume set","safety");
    std::map<std::wstring,bool> seen;for(const auto &member:members)if(!seen.emplace(key(member),true).second)fail("Duplicate archive volume","safety");
    auto &value=state(source);
    // Single-volume update/create paths manage their own write/replace locks.
    // Additional locks are needed only for a multi-volume family.
    std::map<std::wstring,std::unique_ptr<File>> locks;
    if(members.size()>1)for(const auto &member:members){const auto name=key(member);if(!value.locks.contains(name))locks.emplace(name,std::make_unique<File>(member,GENERIC_READ,FILE_SHARE_READ));}
    const auto current=revision(members);
    if(!value.expected.empty()&&current!=value.expected)fail("Archive changed; reopen it before using the selection");
    value.members=members;
    value.locks.merge(locks);
}
std::string zip_revision(const fs::path &source){
    std::lock_guard guard(source_mutex);
    const auto found=sources.find(key(source));
    return revision(found!=sources.end()&&!found->second.members.empty()?found->second.members:std::vector<fs::path>{source});
}
std::vector<fs::path> archive_source_members(const fs::path &source){
    std::lock_guard guard(source_mutex);const auto found=sources.find(key(source));
    return found!=sources.end()&&!found->second.members.empty()?found->second.members:std::vector<fs::path>{source};
}
