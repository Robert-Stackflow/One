#include "recovery-common.h"
#include "publish-access.h"

using namespace archive_recovery;

// Extraction-specific version 2 recovery; volume updates have a separate plan.
namespace {
struct Item {size_t index;fs::path target,backup,displaced;bool directory,existing,created=false,published=false;std::string source_stamp,target_stamp,directory_identity;};
struct Plan {std::vector<Item> items;uint64_t skipped=0;bool prepared=false,committed=false,rollback=false,rolled_back=false;std::string parent_identity,recovery_identity;};
Plan read_plan(Locked &manifest,const fs::path &parent,const fs::path &recovery,const fs::path &stage){
    LARGE_INTEGER size{};if(!GetFileSizeEx(manifest.value,&size)||size.QuadPart<=0||size.QuadPart>512ll*1024*1024)fail("Recovery journal exceeds size limit","safety");
    Plan plan;uLong crc=0;uint64_t sequence=0,published=0,read=0;std::string pending;bool header=false;std::set<std::wstring> targets;
    auto line=[&](const std::string &text){
        if(text.size()>512*1024)fail("Recovery journal line exceeds size limit","safety");Cursor cur{text};cur.take("{\"sequence\":");if(cur.number()!=sequence++||sequence>3000010)fail("Recovery journal sequence is invalid","safety");cur.take(",\"record\":{\"type\":");const auto type=cur.string();
        if(type=="header"){
            if(header||sequence!=1||cur.count_field("version")!=2)fail("Recovery journal version is invalid","safety");
            const auto p=fs::path(wide(cur.text_field("parent"))),s=fs::path(wide(cur.text_field("stage"))),r=fs::path(wide(cur.text_field("recovery")));
            if(key(p)!=key(parent)||key(s)!=key(stage)||key(r)!=key(recovery))fail("Recovery journal scope differs from the explicit request","safety");
            plan.parent_identity=cur.text_field("parentIdentity");const auto stage_id=cur.text_field("stageIdentity");plan.recovery_identity=cur.text_field("recoveryIdentity");const auto conflict=cur.text_field("conflict");
            if(!valid_stamp(plan.parent_identity,3)||!valid_stamp(stage_id,3)||!valid_stamp(plan.recovery_identity,3)||(conflict!="rename"&&conflict!="skip"&&conflict!="replace"))fail("Recovery journal identities are invalid","safety");header=true;
        }else{
            if(!header)fail("Recovery journal header is missing","safety");
            if(type=="item"){
                if(plan.prepared||plan.rollback||plan.items.size()>=1000000)fail("Recovery journal plan order is invalid","safety");
                Item item{};item.index=(size_t)cur.count_field("index");const auto source=fs::path(wide(cur.text_field("source")));item.target=wide(cur.text_field("target"));item.backup=wide(cur.text_field("backup"));item.directory=cur.bool_field("directory");item.existing=cur.bool_field("existing");item.source_stamp=cur.text_field("sourceStamp");item.target_stamp=cur.text_field("targetStamp");item.displaced=recovery/(std::to_wstring(item.index)+L".displaced");
                if(item.index>=1000000||(!plan.items.empty()&&item.index<=plan.items.back().index)||!inside(stage,source,item.directory)||!inside(parent,item.target,item.directory)||inside(recovery,item.target,item.directory)||key(item.target)==key(recovery)||inside(stage,item.target,item.directory)||key(item.target)==key(stage)||key(item.backup)!=key(recovery/(std::to_wstring(item.index)+L".original"))||
                    (item.directory?(!item.source_stamp.empty()||!item.target_stamp.empty()):(!valid_stamp(item.source_stamp,7)||(item.existing?(!valid_stamp(item.target_stamp,7)||item.source_stamp==item.target_stamp):!item.target_stamp.empty())))||!targets.emplace(key(item.target)).second)fail("Recovery journal contains an invalid or duplicate target","safety");
                plan.items.push_back(std::move(item));
            }else if(type=="prepared"){
                if(plan.prepared||plan.rollback||cur.count_field("items")!=plan.items.size())fail("Recovery journal prepared plan is invalid","safety");plan.skipped=cur.count_field("skipped");if(plan.items.size()+plan.skipped>1000000)fail("Recovery journal plan exceeds entry limit","safety");plan.prepared=true;
            }else if(type=="directory-created"||type=="published"){
                if(!plan.prepared||plan.rollback||plan.committed)fail("Recovery journal progress order is invalid","safety");const auto index=cur.count_field("index");auto it=std::lower_bound(plan.items.begin(),plan.items.end(),index,[](const Item &item,uint64_t wanted){return item.index<wanted;});
                if(it==plan.items.end()||it->index!=index)fail("Recovery journal refers to an unknown item","safety");
                if(type=="directory-created"){it->directory_identity=cur.text_field("identity");if(!it->directory||it->existing||it->created||!valid_stamp(it->directory_identity,3))fail("Recovery journal directory progress is invalid","safety");it->created=true;}
                else{if(it->published||(it->directory&&!it->existing&&!it->created))fail("Recovery journal publication is invalid","safety");it->published=true;++published;}
            }else if(type=="committed"){
                if(!plan.prepared||plan.rollback||plan.committed||cur.count_field("count")!=plan.items.size()||published!=plan.items.size()||cur.count_field("skipped")!=plan.skipped)fail("Recovery journal completion is invalid","safety");plan.committed=true;
            }else if(type=="rollback-started"){
                if(plan.rollback)fail("Recovery journal rollback order is invalid","safety");plan.rollback=true;
            }else if(type=="rolled-back"){
                if(!plan.rollback||plan.rolled_back)fail("Recovery journal rollback completion is invalid","safety");plan.rolled_back=true;
            }else fail("Recovery journal contains an unknown record","safety");
        }
        cur.take("}");const auto prefix=cur.at;const auto checksum=cur.text_field("crc32");cur.take("}");cur.end();
        crc=crc32(crc,reinterpret_cast<const Bytef*>(text.data()),(uInt)prefix);char expected[9]{};std::snprintf(expected,sizeof(expected),"%08lx",(unsigned long)crc);if(checksum!=expected)fail("Recovery journal checksum is invalid","safety");
    };
    char buffer[64*1024];DWORD got=0;
    while(ReadFile(manifest.value,buffer,sizeof(buffer),&got,nullptr)&&got){
        check_cancel();read+=got;if(read>uint64_t(size.QuadPart))fail("Recovery journal changed during reading","safety");archive_activity();pending.append(buffer,got);size_t start=0,end;
        while((end=pending.find('\n',start))!=std::string::npos){line(pending.substr(start,end-start));start=end+1;}pending.erase(0,start);if(pending.size()>512*1024)fail("Recovery journal line exceeds size limit","safety");
    }
    if(read!=uint64_t(size.QuadPart)||!pending.empty()||!header||!plan.prepared)fail("Recovery journal is truncated or has no complete plan","safety");return plan;
}
std::string file_stamp(const fs::path &path){const auto present=attributes(path);archive_activity();if(present==INVALID_FILE_ATTRIBUTES)return {};Locked file(path,false);return stamp(file.value);}
struct State {std::string target,backup,displaced;};
State inspect(const Item &item,Directories &dirs){
    State state;if(item.directory){if(dirs.ancestors(item.target,true)&&item.created&&stamp(dirs.held.at(key(item.target))->value,true)!=item.directory_identity)fail("Created recovery target directory changed; files were retained","safety");return state;}
    const auto exists=dirs.ancestors(item.target.parent_path(),true);if(exists)state.target=file_stamp(item.target);
    state.backup=file_stamp(item.backup);state.displaced=file_stamp(item.displaced);
    if(!state.backup.empty()&&(!item.existing||state.backup!=item.target_stamp))fail("Recovery original copy changed; files were retained","safety");
    if(!state.displaced.empty()&&state.displaced!=item.source_stamp)fail("Recovery displaced file changed; files were retained","safety");
    if(!state.target.empty()&&state.target!=item.source_stamp&&(!item.existing||state.target!=item.target_stamp))fail("Target was modified after extraction; files were retained: "+utf8(item.target.wstring()),"safety");
    if(state.target==item.source_stamp&&!state.displaced.empty())fail("Both target and displaced file exist; files were retained","safety");
    if(item.existing){
        if(state.target==item.target_stamp&&!state.backup.empty())fail("Both original target and backup exist; files were retained","safety");
        if(state.target!=item.target_stamp&&state.backup.empty())fail("Original recovery copy is missing; target was retained","safety");
    }
    if(!exists&&!state.backup.empty())fail("Original target directory is missing; recovery copy was retained","safety");return state;
}
// Require the entire target to be in its final state before discarding any
// recovery copy. The second pass rechecks each file immediately before deletion.
fs::path cleanup_candidate(const Item &item,bool committed,Directories &dirs){
    if(item.directory){inspect(item,dirs);return {};}
    const bool parent_exists=dirs.ancestors(item.target.parent_path(),true);
    const auto target=parent_exists?file_stamp(item.target):std::string{},backup=file_stamp(item.backup),displaced=file_stamp(item.displaced);
    if(committed){
        if(target!=item.source_stamp)fail("Cleanup target changed after committed extraction; recovery copies retained","safety");
        if(!displaced.empty()||(!backup.empty()&&(!item.existing||backup!=item.target_stamp)))fail("Cleanup recovery copy changed; files retained","safety");
        return backup.empty()?fs::path{}:item.backup;
    }
    if(!backup.empty()||(item.existing?target!=item.target_stamp:!target.empty()))fail("Recovery has not finished restoring original files; cleanup refused","safety");
    if(!displaced.empty()&&displaced!=item.source_stamp)fail("Cleanup displaced copy changed; files retained","safety");
    return displaced.empty()?fs::path{}:item.displaced;
}
}

void extract_recover(const fs::path &parent,const fs::path &recovery){
    const auto name=recovery.filename().wstring();if(!name.starts_with(L".one-recovery-")||!uuid(name.substr(14))||recovery.parent_path()!=parent)fail("Invalid explicit recovery scope","safety");
    Directories dirs;dirs.ancestors(parent);dirs.hold(recovery);
    // A publisher/second restorer cannot acquire the same manifest while this
    // handle is held, and no writer can change the plan after validation.
    Locked manifest(recovery/L"manifest.jsonl",false,GENERIC_READ|DELETE);
    const auto original_stamp=stamp(manifest.value);const auto stage=parent/(L".one-extract-"+name.substr(14));auto plan=read_plan(manifest,parent,recovery,stage);
    if(plan.committed&&!plan.rollback)fail("Extraction was committed; use explicit backup cleanup instead of rollback","safety");
    if(plan.parent_identity!=stamp(dirs.held.at(key(parent))->value,true)||plan.recovery_identity!=stamp(dirs.held.at(key(recovery))->value,true))fail("Recovery directory identity changed","safety");
    // Whole-plan validation catches ordinary conflicts before the first move.
    // Each mutation then rechecks under its own exclusive file handle.
    for(const auto &item:plan.items){check_cancel();inspect(item,dirs);}
    if(stamp(manifest.value)!=original_stamp)fail("Recovery journal changed","safety");
    emit("{\"type\":\"ready\"}");if(archive_acknowledgement()!=1)fail("Recovery cancelled before moving files","cancelled");
    size_t restored=0,displaced=0,done=0;ULONGLONG last=0;
    for(const auto &item:plan.items){
        check_cancel();if(item.directory){++done;continue;}const auto state=inspect(item,dirs);
        if(state.target==item.source_stamp){
            Locked current(item.target,false,archive_publish_file_access);if(stamp(current.value)!=item.source_stamp)fail("Target changed before recovery; retained","safety");
            move(current.value,item.displaced);++displaced;crash("displaced:"+std::to_string(item.index));
        }
        if(!state.backup.empty()){
            Locked original(item.backup,false,archive_publish_file_access);if(stamp(original.value)!=item.target_stamp)fail("Original copy changed before recovery; retained","safety");
            move(original.value,item.target);++restored;crash("restored:"+std::to_string(item.index));
        }
        ++done;const auto now=GetTickCount64();if(!last||now-last>=100||done==plan.items.size()){emit("{\"type\":\"progress\",\"done\":"+std::to_string(done)+",\"total\":"+std::to_string(plan.items.size())+"}");last=now;}
    }
    // The immutable original journal and displaced contents deliberately remain.
    // Re-running is safe from the current identities, without a second write log
    // whose torn tail could prevent completing a previously interrupted restore.
    emit("{\"type\":\"result\",\"count\":"+std::to_string(restored)+",\"displaced\":"+std::to_string(displaced)+",\"retained\":true,\"cancelled\":false}");
}

void extract_cleanup(const fs::path &parent,const fs::path &recovery){
    const auto name=recovery.filename().wstring();if(!name.starts_with(L".one-recovery-")||!uuid(name.substr(14))||recovery.parent_path()!=parent)fail("Invalid explicit recovery cleanup scope","safety");
    Directories dirs;dirs.ancestors(parent);
    if(attributes(recovery)==INVALID_FILE_ATTRIBUTES){emit("{\"type\":\"result\",\"count\":0,\"cancelled\":false}");return;}
    dirs.hold(recovery,FILE_READ_ATTRIBUTES|DELETE);
    const auto manifest_path=recovery/L"manifest.jsonl";
    // A crash after deleting the final manifest may leave only the empty folder.
    // Removing that explicitly named empty folder needs no untrusted plan. The
    // kernel refuses directory deletion if a new child appears in the meantime.
    if(attributes(manifest_path)==INVALID_FILE_ATTRIBUTES){
        check_contents(recovery,{});emit("{\"type\":\"ready\"}");if(archive_acknowledgement()!=1)fail("Recovery cleanup cancelled","cancelled");check_cancel();check_contents(recovery,{});
        erase(dirs.held.at(key(recovery))->value);dirs.held.erase(key(recovery));emit("{\"type\":\"result\",\"count\":0,\"cancelled\":false}");return;
    }
    Locked manifest(manifest_path,false,GENERIC_READ|DELETE);const auto before=stamp(manifest.value);
    auto plan=read_plan(manifest,parent,recovery,parent/(L".one-extract-"+name.substr(14)));
    if(plan.parent_identity!=stamp(dirs.held.at(key(parent))->value,true)||plan.recovery_identity!=stamp(dirs.held.at(key(recovery))->value,true))fail("Cleanup directory identity changed; files retained","safety");
    const bool committed=plan.committed&&!plan.rollback;
    std::set<std::wstring> allowed{L"manifest.jsonl"};for(const auto &item:plan.items)if(!item.directory){if(item.existing)allowed.insert(key(item.backup.filename()));allowed.insert(key(item.displaced.filename()));}
    check_contents(recovery,allowed);
    for(const auto &item:plan.items){check_cancel();cleanup_candidate(item,committed,dirs);}
    if(stamp(manifest.value)!=before)fail("Cleanup journal changed; files retained","safety");
    emit("{\"type\":\"ready\"}");if(archive_acknowledgement()!=1)fail("Recovery cleanup cancelled","cancelled");
    check_cancel();check_contents(recovery,allowed);
    size_t removed=0,done=0;ULONGLONG last=0;
    for(const auto &item:plan.items){
        check_cancel();
        // Keep the validated target unmodifiable until its recovery copy has
        // been removed. A transient stamp check alone leaves a write race.
        std::unique_ptr<Locked> target_guard;
        if(!item.directory&&attributes(item.target)!=INVALID_FILE_ATTRIBUTES)target_guard=std::make_unique<Locked>(item.target,false);
        const auto candidate=cleanup_candidate(item,committed,dirs);
        if(!candidate.empty()){
            Locked file(candidate,false,archive_publish_file_access);const auto expected=committed?item.target_stamp:item.source_stamp;
            if(stamp(file.value)!=expected)fail("Cleanup recovery file changed before removal; remaining files retained","safety");
            erase(file.value);file.close();++removed;crash("cleanup:"+std::to_string(item.index));
        }
        ++done;const auto now=GetTickCount64();if(!last||now-last>=100||done==plan.items.size()){emit("{\"type\":\"progress\",\"done\":"+std::to_string(done)+",\"total\":"+std::to_string(plan.items.size())+"}");last=now;}
    }
    check_cancel();check_contents(recovery,{L"manifest.jsonl"});
    erase(manifest.value);manifest.close();crash("cleanup-manifest");
    erase(dirs.held.at(key(recovery))->value);dirs.held.erase(key(recovery));crash("cleanup-directory");
    emit("{\"type\":\"result\",\"count\":"+std::to_string(removed)+",\"cancelled\":false}");
}
