#include "recovery-common.h"
#include "stage-ownership.h"

using namespace archive_recovery;

namespace {
struct VolumeItem {
    fs::path source,target,backup,displaced;
    std::string source_stamp,target_stamp;
    bool backed_up=false,published=false;
};
struct VolumePlan {
    fs::path stage,primary;
    std::string parent_identity,stage_identity,recovery_identity;
    int format=0;
    size_t old_count=0,new_count=0;
    bool prepared=false,committed=false,rollback=false,rolled_back=false;
    std::vector<VolumeItem> items;
};
bool private_directory(const fs::path &path,const fs::path &parent,const std::wstring &prefix){
    const auto name=path.filename().wstring();
    return path.is_absolute()&&path==path.lexically_normal()&&key(path.parent_path())==key(parent)&&name.starts_with(prefix)&&uuid(name.substr(prefix.size()));
}
void scope(const fs::path &parent,const fs::path &recovery){
    if(!parent.is_absolute()||parent!=parent.lexically_normal()||parent.wstring().find(L':',2)!=std::wstring::npos||
        !private_directory(recovery,parent,L".one-volume-recovery-"))fail("Invalid explicit volume recovery scope","safety");
}
std::set<std::wstring> family(const fs::path &primary,int format,size_t count){
    std::set<std::wstring> names;
    for(size_t index=0;index<count;++index){
        auto name=primary.filename();
        if(format==0&&index)name.replace_extension(std::wstring(L".z")+(index<10?L"0":L"")+std::to_wstring(index));
        if(format==7){auto number=std::to_wstring(index+1);if(number.size()<3)number.insert(0,3-number.size(),L'0');
            const auto text=name.wstring();name=text.substr(0,text.size()-3)+number;}
        names.insert(key(name));
    }
    return names;
}
// Version 3 is deliberately distinct from extraction's version 2: an item can
// be an old-only removed tail or a new-only added volume, and the stage UUID is
// independent of the recovery UUID. Never infer ownership from a directory name.
VolumePlan read_volume_plan(Locked &manifest,const fs::path &parent,const fs::path &recovery){
    LARGE_INTEGER size{};if(!GetFileSizeEx(manifest.value,&size)||size.QuadPart<=0||size.QuadPart>64ll*1024*1024)
        fail("Volume recovery journal exceeds size limit","safety");
    VolumePlan plan;uLong crc=0;uint64_t sequence=0,read=0;std::string pending;
    bool header=false,publishing=false;size_t backed_up=0,published=0,last_backup=0,last_publication=0;
    std::set<std::wstring> old_names,new_names,all_names;
    std::set<std::string> identities;
    auto remember=[&](const std::string &value){
        if(!valid_stamp(value,7))fail("Volume recovery fingerprint is invalid","safety");
        const auto first=value.find(':'),second=value.find(':',first+1),third=value.find(':',second+1);
        if(!identities.insert(value.substr(0,third)).second)fail("Volume recovery files alias each other","safety");
    };
    auto line=[&](const std::string &text){
        if(text.size()>512*1024)fail("Volume recovery journal line exceeds limit","safety");
        Cursor cur{text};cur.take("{\"sequence\":");if(cur.number()!=sequence++||sequence>12300)fail("Volume recovery journal sequence is invalid","safety");
        cur.take(",\"record\":{\"type\":");const auto type=cur.string();
        if(type=="header"){
            if(header||sequence!=1||cur.count_field("version")!=3||cur.text_field("kind")!="volume-update")fail("Volume recovery journal version is invalid","safety");
            const fs::path recorded_parent=wide(cur.text_field("parent"));plan.stage=wide(cur.text_field("stage"));const fs::path recorded_recovery=wide(cur.text_field("recovery"));
            if(key(recorded_parent)!=key(parent)||key(recorded_recovery)!=key(recovery)||!private_directory(plan.stage,parent,L".one-update-"))
                fail("Volume recovery journal differs from the explicit scope","safety");
            plan.parent_identity=cur.text_field("parentIdentity");plan.stage_identity=cur.text_field("stageIdentity");plan.recovery_identity=cur.text_field("recoveryIdentity");
            const auto primary=cur.text_field("primary");plan.primary=parent/fs::path(wide(primary));plan.format=(int)cur.count_field("format");
            plan.old_count=(size_t)cur.count_field("oldVolumes");plan.new_count=(size_t)cur.count_field("newVolumes");
            if(!valid_stamp(plan.parent_identity,3)||!valid_stamp(plan.stage_identity,3)||!valid_stamp(plan.recovery_identity,3)||
                plan.parent_identity==plan.stage_identity||plan.parent_identity==plan.recovery_identity||plan.stage_identity==plan.recovery_identity||
                !safe_entry(primary,false)||plan.primary.parent_path()!=parent||!plan.old_count||!plan.new_count||plan.old_count>4096||plan.new_count>4096||
                (plan.format!=0&&plan.format!=7)||(plan.format==0&&(!key(plan.primary).ends_with(L".zip")||plan.old_count<2))||
                (plan.format==7&&!key(plan.primary).ends_with(L".7z.001")))fail("Volume recovery header is invalid","safety");
            old_names=family(plan.primary,plan.format,plan.old_count);new_names=family(plan.primary,plan.format,plan.new_count);
            all_names=old_names;all_names.insert(new_names.begin(),new_names.end());header=true;
        }else{
            if(!header||plan.rolled_back)fail("Volume recovery journal state order is invalid","safety");
            if(type=="item"){
                if(plan.prepared||plan.rollback||plan.items.size()>=all_names.size())fail("Volume recovery item order is invalid","safety");
                const auto index=cur.count_field("index");VolumeItem item;
                item.source=wide(cur.text_field("source"));item.target=wide(cur.text_field("target"));item.backup=wide(cur.text_field("backup"));
                item.source_stamp=cur.text_field("sourceStamp");item.target_stamp=cur.text_field("targetStamp");
                const auto name=*std::next(all_names.begin(),plan.items.size());
                if(index!=plan.items.size()||key(item.target)!=key(parent/name)||item.target!=item.target.lexically_normal()||
                    key(item.backup)!=key(recovery/(std::to_wstring(index)+L".original"))||item.backup!=item.backup.lexically_normal()||
                    (new_names.contains(name)?(key(item.source)!=key(plan.stage/name)||item.source!=item.source.lexically_normal()||item.source_stamp.empty()):(!item.source.empty()||!item.source_stamp.empty()))||
                    (old_names.contains(name)?item.target_stamp.empty():!item.target_stamp.empty()))fail("Volume recovery item is outside its canonical family","safety");
                if(!item.source_stamp.empty())remember(item.source_stamp);if(!item.target_stamp.empty())remember(item.target_stamp);
                item.displaced=recovery/(std::to_wstring(index)+L".displaced");plan.items.push_back(std::move(item));
            }else if(type=="prepared"){
                if(plan.prepared||plan.rollback||plan.items.size()!=all_names.size()||cur.count_field("items")!=plan.items.size())fail("Volume recovery plan is incomplete","safety");plan.prepared=true;
            }else if(type=="backed-up"||type=="published"){
                if(!plan.prepared||plan.rollback||plan.committed)fail("Volume recovery progress order is invalid","safety");
                const auto index=cur.count_field("index");if(index>=plan.items.size())fail("Volume recovery progress item is unknown","safety");auto &item=plan.items[(size_t)index];
                if(type=="backed-up"){
                    if(publishing||item.target_stamp.empty()||item.backed_up||(backed_up&&index<=last_backup))fail("Volume recovery backup order is invalid","safety");
                    item.backed_up=true;last_backup=(size_t)index;++backed_up;
                }else{
                    if(backed_up!=plan.old_count||item.source_stamp.empty()||item.published||(published&&index<=last_publication))fail("Volume recovery publication order is invalid","safety");
                    publishing=true;item.published=true;last_publication=(size_t)index;++published;
                }
            }else if(type=="committed"){
                const auto removed=old_names.size()>new_names.size()?old_names.size()-new_names.size():0;
                if(!plan.prepared||plan.rollback||plan.committed||backed_up!=plan.old_count||published!=plan.new_count||
                    cur.count_field("count")!=plan.new_count||cur.count_field("removed")!=removed)fail("Volume recovery commit is invalid","safety");plan.committed=true;
            }else if(type=="rollback-started"){
                if(!plan.prepared||plan.committed||plan.rollback)fail("Volume recovery rollback order is invalid","safety");plan.rollback=true;
            }else if(type=="rolled-back"){
                if(!plan.rollback)fail("Volume recovery rollback completion is invalid","safety");plan.rolled_back=true;
            }else fail("Volume recovery journal record is unknown","safety");
        }
        cur.take("}");const auto prefix=cur.at;const auto checksum=cur.text_field("crc32");cur.take("}");cur.end();
        crc=crc32(crc,reinterpret_cast<const Bytef*>(text.data()),(uInt)prefix);char expected[9]{};std::snprintf(expected,sizeof(expected),"%08lx",(unsigned long)crc);
        if(checksum!=expected)fail("Volume recovery journal checksum is invalid","safety");
    };
    char buffer[64*1024];DWORD got=0;
    while(ReadFile(manifest.value,buffer,sizeof(buffer),&got,nullptr)&&got){
        check_cancel();archive_activity();read+=got;if(read>uint64_t(size.QuadPart))fail("Volume recovery journal changed while reading","safety");
        pending.append(buffer,got);size_t start=0,end;
        while((end=pending.find('\n',start))!=std::string::npos){line(pending.substr(start,end-start));start=end+1;}pending.erase(0,start);
        if(pending.size()>512*1024)fail("Volume recovery journal line exceeds limit","safety");
    }
    if(read!=uint64_t(size.QuadPart)||!pending.empty()||!header||!plan.prepared)fail("Volume recovery journal is truncated or incomplete","safety");return plan;
}
struct Slot {
    fs::path path;std::unique_ptr<Locked> file;std::string fingerprint;
    explicit Slot(const fs::path &value):path(value){if(!path.empty()&&attributes(path)!=INVALID_FILE_ATTRIBUTES){file=std::make_unique<Locked>(path,false,GENERIC_READ|DELETE);fingerprint=stamp(file->value);}}
    void verify() const {
        check_cancel();archive_activity();if(path.empty())return;
        if(!file){if(attributes(path)!=INVALID_FILE_ATTRIBUTES)fail("An unowned file appeared during volume recovery","safety");return;}
        BY_HANDLE_FILE_INFORMATION info{};
        if(!GetFileInformationByHandle(file->value,&info)||info.nNumberOfLinks!=1||stamp(file->value)!=fingerprint)
            fail("Volume recovery file identity or links changed; remaining files retained","safety");
    }
    void move_to(Slot &destination){
        verify();destination.verify();if(!file||destination.file)fail("Volume recovery move conflicts with an existing file","safety");
        move(file->value,destination.path);destination.file=std::move(file);destination.fingerprint=std::move(fingerprint);fingerprint.clear();
    }
    bool remove(){verify();if(!file)return false;erase(file->value);file->close();file.reset();fingerprint.clear();return true;}
};
struct VolumeState {
    Slot source,target,backup,displaced;
    explicit VolumeState(const VolumeItem &item):source(item.source),target(item.target),backup(item.backup),displaced(item.displaced){}
    void verify(const VolumeItem &item,bool committed,bool final) const {
        source.verify();target.verify();backup.verify();displaced.verify();
        const bool original=!item.target_stamp.empty()&&target.fingerprint==item.target_stamp;
        const bool next=!item.source_stamp.empty()&&target.fingerprint==item.source_stamp;
        if((target.file&&!original&&!next)||(backup.file&&(item.target_stamp.empty()||backup.fingerprint!=item.target_stamp))||
            (source.file&&source.fingerprint!=item.source_stamp)||(displaced.file&&(item.source_stamp.empty()||displaced.fingerprint!=item.source_stamp)))
            fail("A volume recovery copy was changed; files retained","safety");
        if(unsigned(bool(source.file))+unsigned(next)+unsigned(bool(displaced.file))>1)fail("New volume exists at multiple recovery positions","safety");
        if(committed){
            if((item.source_stamp.empty()?bool(target.file):!next)||source.file||displaced.file)fail("Committed volume family changed; copies retained","safety");
        }else{
            if(!item.target_stamp.empty()&&unsigned(original)+unsigned(bool(backup.file))!=1)fail("Original volume is missing or duplicated; copies retained","safety");
            if(final&&(backup.file||(!item.target_stamp.empty()?!original:bool(target.file))))fail("Original volume family has not finished restoring; cleanup refused","safety");
        }
    }
};
struct Recovery {
    Directories dirs;
    std::unique_ptr<Locked> manifest;
    struct JournalLock {
        HANDLE value=INVALID_HANDLE_VALUE;
        ~JournalLock(){close();}
        void close(){if(value!=INVALID_HANDLE_VALUE){CloseHandle(value);value=INVALID_HANDLE_VALUE;}}
    } staging_journal;
    VolumePlan plan;
    std::vector<VolumeState> states;
    std::set<std::wstring> recovery_names{L"manifest.jsonl"},stage_names;
    fs::path parent,recovery;
    bool stage_exists=false;
    Recovery(const fs::path &p,const fs::path &r,bool cleanup):parent(p),recovery(r){
        scope(p,r);dirs.ancestors(parent);dirs.hold(recovery,FILE_READ_ATTRIBUTES|(cleanup?DELETE:0));
        manifest=std::make_unique<Locked>(recovery/L"manifest.jsonl",false,GENERIC_READ|DELETE);
        const auto before=stamp(manifest->value);plan=read_volume_plan(*manifest,parent,recovery);
        if(attributes(recovery/L"stage.jsonl")!=INVALID_FILE_ATTRIBUTES){
            staging_journal.value=archive_stage::lock_published_journal(plan.primary,plan.stage,recovery,manifest->value);recovery_names.insert(L"stage.jsonl");
        }
        if(before!=stamp(manifest->value)||plan.parent_identity!=stamp(dirs.held.at(key(parent))->value,true)||
            plan.recovery_identity!=stamp(dirs.held.at(key(recovery))->value,true))fail("Volume recovery directory or journal changed","safety");
        stage_exists=attributes(plan.stage)!=INVALID_FILE_ATTRIBUTES;
        if(stage_exists){dirs.hold(plan.stage,FILE_READ_ATTRIBUTES|(cleanup?DELETE:0));if(plan.stage_identity!=stamp(dirs.held.at(key(plan.stage))->value,true))fail("Volume staging directory identity changed","safety");}
        states.reserve(plan.items.size());
        for(const auto &item:plan.items){
            check_cancel();if(!item.target_stamp.empty())recovery_names.insert(key(item.backup.filename()));
            if(!item.source_stamp.empty()){recovery_names.insert(key(item.displaced.filename()));stage_names.insert(key(item.source.filename()));}
            states.emplace_back(item);
        }
    }
    void verify(bool final=false){
        check_contents(recovery,recovery_names);if(stage_exists)check_contents(plan.stage,stage_names);
        const auto primary=key(plan.primary.filename());const auto prefix=plan.format==0?primary.substr(0,primary.size()-4)+L".z":primary.substr(0,primary.size()-3);
        std::set<std::wstring> expected;for(const auto &item:plan.items)expected.insert(key(item.target.filename()));
        size_t visited=0;for(const auto &entry:fs::directory_iterator(parent)){
            check_cancel();archive_activity();if(++visited>1000000)fail("Volume parent exceeds inspection limit","safety");
            const auto name=key(entry.path().filename());if(expected.contains(name))continue;
            if(name.starts_with(prefix)&&name.size()>prefix.size()&&std::all_of(name.begin()+prefix.size(),name.end(),[](wchar_t c){return c>=L'0'&&c<=L'9';}))
                fail("Volume parent contains an unowned numeric member","safety");
        }
        for(size_t i=0;i<states.size();++i)states[i].verify(plan.items[i],plan.committed,final);
    }
};
void progress(size_t done,size_t total){emit("{\"type\":\"progress\",\"done\":"+std::to_string(done)+",\"total\":"+std::to_string(total)+"}");}
}

void recover_volume_update(const fs::path &parent,const fs::path &recovery){
    Recovery job(parent,recovery,false);
    if(job.plan.committed)fail("Volume update was committed; use explicit recovery cleanup instead of rollback","safety");
    job.verify();emit("{\"type\":\"ready\"}");if(archive_acknowledgement()!=1)fail("Volume recovery cancelled before moving files","cancelled");job.verify();
    size_t displaced=0,restored=0,done=0;const auto total=job.states.size()*2;
    // Remove every published new volume before restoring any old one. The
    // immutable original plan plus current identities make either phase retryable.
    for(size_t i=0;i<job.states.size();++i){
        auto &state=job.states[i];const auto &item=job.plan.items[i];state.verify(item,false,false);
        if(state.target.file&&state.target.fingerprint==item.source_stamp){state.target.move_to(state.displaced);++displaced;crash("displaced:"+std::to_string(i));}
        progress(++done,total);
    }
    for(size_t i=0;i<job.states.size();++i){
        auto &state=job.states[i];state.verify(job.plan.items[i],false,false);
        if(state.backup.file){state.backup.move_to(state.target);++restored;crash("restored:"+std::to_string(i));}
        progress(++done,total);
    }
    job.verify(true);
    emit("{\"type\":\"result\",\"count\":"+std::to_string(restored)+",\"displaced\":"+std::to_string(displaced)+",\"retained\":true,\"cancelled\":false}");
}

void cleanup_volume_update(const fs::path &parent,const fs::path &recovery){
    scope(parent,recovery);
    // Resume the last directory-only step without inventing ownership of any
    // stage whose manifest has already gone. Stage deletion precedes this step.
    {
        Directories dirs;dirs.ancestors(parent);
        if(attributes(recovery)==INVALID_FILE_ATTRIBUTES){emit("{\"type\":\"result\",\"count\":0,\"cancelled\":false}");return;}
        dirs.hold(recovery,FILE_READ_ATTRIBUTES|DELETE);
        if(attributes(recovery/L"manifest.jsonl")==INVALID_FILE_ATTRIBUTES){
            check_contents(recovery,{});emit("{\"type\":\"ready\"}");if(archive_acknowledgement()!=1)fail("Volume cleanup cancelled","cancelled");check_cancel();check_contents(recovery,{});
            erase(dirs.held.at(key(recovery))->value);dirs.held.erase(key(recovery));emit("{\"type\":\"result\",\"count\":0,\"cancelled\":false}");return;
        }
    }
    Recovery job(parent,recovery,true);job.verify(true);
    emit("{\"type\":\"ready\"}");if(archive_acknowledgement()!=1)fail("Volume cleanup cancelled before removal","cancelled");job.verify(true);
    size_t removed=0,done=0;
    for(size_t i=0;i<job.states.size();++i){
        auto &state=job.states[i];state.verify(job.plan.items[i],job.plan.committed,true);
        if(job.plan.committed){if(state.backup.remove()){++removed;crash("cleanup:"+std::to_string(i));}}
        else{
            if(state.source.remove()){++removed;crash("cleanup-stage:"+std::to_string(i));}
            if(state.displaced.remove()){++removed;crash("cleanup:"+std::to_string(i));}
        }
        progress(++done,job.states.size());
    }
    job.verify(true);check_contents(recovery,job.staging_journal.value==INVALID_HANDLE_VALUE?std::set<std::wstring>{L"manifest.jsonl"}:std::set<std::wstring>{L"manifest.jsonl",L"stage.jsonl"});
    if(job.stage_exists){
        check_contents(job.plan.stage,{});erase(job.dirs.held.at(key(job.plan.stage))->value);job.dirs.held.erase(key(job.plan.stage));job.stage_exists=false;
        crash("cleanup-stage-directory");
    }
    if(job.staging_journal.value!=INVALID_HANDLE_VALUE){check_cancel();erase(job.staging_journal.value);job.staging_journal.close();crash("cleanup-handoff-journal");}
    check_cancel();erase(job.manifest->value);job.manifest->close();crash("cleanup-manifest");
    erase(job.dirs.held.at(key(recovery))->value);job.dirs.held.erase(key(recovery));crash("cleanup-directory");
    emit("{\"type\":\"result\",\"count\":"+std::to_string(removed)+",\"cancelled\":false}");
}
