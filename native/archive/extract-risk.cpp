#include "extract-risk.h"
#include <windows.h>
#include <algorithm>
#include <cwctype>
#include <string_view>

namespace {
bool nested(const std::string &name){
    auto suffix=fs::path(wide(name)).extension().wstring();std::transform(suffix.begin(),suffix.end(),suffix.begin(),[](wchar_t c){return std::towlower(c);});
    if(suffix.size()==4&&suffix[0]==L'.'&&suffix[1]>=L'a'&&suffix[1]<=L'k'&&suffix[2]>=L'0'&&suffix[2]<=L'9'&&suffix[3]>=L'0'&&suffix[3]<=L'9')return true;
    for(const auto extension:{L".zip",L".zipx",L".jar",L".apk",L".7z",L".rar",L".tar",L".gz",L".xz",L".tgz",L".txz",L".bz2",L".bzip2",L".tbz",L".tbz2",L".zst",L".zstd",L".tzst",L".cab",L".lha",L".lzh",L".iso",L".wim",L".alz",L".egg",L".001"})if(suffix==extension)return true;
    return false;
}
}
void ExtractionRisk::add(const std::string &name,bool directory,uint64_t size,uint64_t packed){
    count++;
    if(directory){only_tar=false;return;}
    if(size>9007199254740991ull-bytes||packed>9007199254740991ull-compressed)fail("Archive declares too much extracted data","safety");
    bytes+=size;compressed+=packed;if(nested(name))nested_count++;
    auto suffix=fs::path(wide(name)).extension().wstring();std::transform(suffix.begin(),suffix.end(),suffix.begin(),[](wchar_t c){return std::towlower(c);});
    if(suffix!=L".tar")only_tar=false;
}
void ExtractionRisk::check()const{
    const auto limits=extraction_limits();
    const auto source=extraction_policy::env(L"ONE_ARCHIVE_RISK_SOURCE");
    if(source.empty())fail("Extraction source identity is missing","safety");
    const auto revision=zip_revision(source);
    if(!limits.revision.empty()&&utf8(limits.revision)!=revision)fail("压缩包已变化，请重新确认解压风险。","safety");
    // A single TAR inside its expected compression wrapper is not a nested
    // archive risk. Only the service's preparation step sets this exemption.
    const bool wrapper=extraction_policy::env(L"ONE_ARCHIVE_COMPOSITE_PREPARE")==L"1"&&count==1&&only_tar;
    const auto nested=wrapper?0:nested_count;
    // Single-stream handlers may omit packed-size properties. Their physical
    // size is a conservative denominator even for a partial inner selection.
    // Never use a single volume's size for ZIP/7Z/RAR families.
    auto packed=compressed;
    auto extension=fs::path(source).extension().wstring();std::transform(extension.begin(),extension.end(),extension.begin(),[](wchar_t c){return std::towlower(c);});
    if(!packed&&(extension==L".gz"||extension==L".xz"||extension==L".tgz"||extension==L".txz"||extension==L".bz2"||extension==L".bzip2"||extension==L".tbz"||extension==L".tbz2"||extension==L".zst"||extension==L".zstd"||extension==L".tzst")){
        std::error_code error;packed=fs::file_size(source,error);if(error)fail("Cannot check compressed stream size","read");
    }
    // Solid archives may report packed sizes only on the first file. Unknown
    // values are not treated as an infinite compression ratio.
    const bool ratio=packed&&bytes>=64ull*1024*1024&&bytes/packed>=1000;
    // Nested archives are written as ordinary files, never extracted recursively.
    const bool risky=count>=100000||bytes>=64ull*1024*1024*1024||ratio;
    if(bytes>limits.bytes&&!limits.revision.empty())fail("声明展开量超过本次解压上限，请提高上限后重试。","safety");
    if(risky&&limits.revision.empty()){
        emit("{\"type\":\"risk\",\"revision\":"+json(revision)+",\"entries\":"+std::to_string(count)+",\"bytes\":"+std::to_string(bytes)+",\"compressed\":"+std::to_string(packed)+",\"nested\":"+std::to_string(nested)+",\"highRatio\":"+(ratio?"true":"false")+"}");
        fail("请确认解压风险后继续；当前内容尚未写入。","risk");
    }
}
