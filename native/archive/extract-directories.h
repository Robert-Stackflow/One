#pragma once
#include "common.h"
#include <windows.h>
#include <memory>
#include <mutex>
#include <unordered_map>

// A bounded cache of locked staging directories. A live output keeps its
// entire parent chain alive even when another path evicts the cache.
class ExtractionDirectories final {
    struct Held;
public:
    using Lease=std::shared_ptr<const Held>;
    static constexpr size_t maximum_cached=4096;
private:
    struct Held {
        HANDLE value=INVALID_HANDLE_VALUE;Lease parent;
        Held(const fs::path &path,Lease ancestor,bool staging=true):parent(std::move(ancestor)){
            // Attribute-only opens do not reliably prevent a leaf-directory
            // rename. Lock directory contents within staging as well.
            value=CreateFileW(path.c_str(),FILE_READ_ATTRIBUTES|(staging?FILE_LIST_DIRECTORY:0),FILE_SHARE_READ,nullptr,OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
            if(value==INVALID_HANDLE_VALUE)fail("Cannot lock extraction directory: "+utf8(path.wstring()),"write");
            BY_HANDLE_FILE_INFORMATION info{};
            if(!GetFileInformationByHandle(value,&info)||!(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)||(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)){
                CloseHandle(value);value=INVALID_HANDLE_VALUE;fail("Extraction directory is a link or incompatible file: "+utf8(path.wstring()),"safety");
            }
        }
        ~Held(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
        Held(const Held&)=delete;
    };
    fs::path rootPath;Lease root;size_t rootDepth=0,capacity;
    std::unordered_map<fs::path,Lease> cached;std::mutex mutex;
public:
    explicit ExtractionDirectories(const fs::path &destination,size_t cache_capacity=maximum_cached):rootPath(destination),capacity(cache_capacity){
        if(!capacity||capacity>maximum_cached)fail("Invalid extraction directory cache limit","resource");
        if(!destination.is_absolute()||destination!=destination.lexically_normal()||destination==destination.root_path())fail("Extraction staging path must be absolute and normalized","safety");
        // Lock the immediate parent across create/open, then validate its
        // ancestry and identity. Do not lock unrelated jobs' directory contents.
        auto creating_parent=std::make_shared<Held>(destination.parent_path(),nullptr);
        auto current=destination.root_path();Lease parent=std::make_shared<Held>(current,nullptr,false);rootDepth=1;
        for(const auto &part:destination.parent_path().relative_path()){
            if(++rootDepth>512)fail("Extraction path is too deep","safety");current/=part;parent=std::make_shared<Held>(current,std::move(parent),false);
        }
        if(++rootDepth>512)fail("Extraction path is too deep","safety");
        BY_HANDLE_FILE_INFORMATION before{},after{};
        if(!GetFileInformationByHandle(creating_parent->value,&before)||!GetFileInformationByHandle(parent->value,&after)||
            before.dwVolumeSerialNumber!=after.dwVolumeSerialNumber||before.nFileIndexHigh!=after.nFileIndexHigh||before.nFileIndexLow!=after.nFileIndexLow)
            fail("Extraction parent changed before staging creation","safety");
        if(!CreateDirectoryW(destination.c_str(),nullptr))fail("Cannot create exclusive extraction staging directory","write");
        root=std::make_shared<Held>(destination,std::move(parent));
    }
    Lease ensure(const fs::path &directory){
        std::lock_guard lock(mutex);
        if(directory==rootPath)return root;
        if(const auto found=cached.find(directory);found!=cached.end())return found->second;
        if(!directory.is_absolute()||directory!=directory.lexically_normal())fail("Invalid extraction directory path","safety");
        const auto relative=directory.lexically_relative(rootPath);
        if(relative.empty()||relative.is_absolute())fail("Extraction directory escapes staging","safety");
        auto current=rootPath;auto parent=root;auto depth=rootDepth;
        for(const auto &part:relative){
            if(part==L"."||part==L".."||++depth>512)fail("Extraction directory escapes staging or is too deep","safety");
            current/=part;
            if(const auto found=cached.find(current);found!=cached.end()){parent=found->second;continue;}
            if(!CreateDirectoryW(current.c_str(),nullptr)&&GetLastError()!=ERROR_ALREADY_EXISTS)fail("Cannot create extracted directory","write");
            auto held=std::make_shared<Held>(current,std::move(parent));
            if(cached.size()>=capacity)cached.clear();
            cached.emplace(current,held);parent=std::move(held);
        }
        return parent;
    }
};
