//! Application-facing lifecycle. Queries and filesystem transactions reuse the
//! generation store; initialization/builds are cancellable on its writer thread.
use super::*;

pub(super) struct Service {
    cache: PathBuf,
    config: Option<Config>,
    state: crate::State,
}
fn same(a:&Config,b:&Config)->bool {
    a.roots==b.roots && a.excluded==b.excluded && a.max_entries==b.max_entries
}
fn count(state:&State)->io::Result<usize> {
    let map=state.lease.mapping()?;
    Ok(state.overlay.count(&View::new(map.bytes())?))
}
impl Service {
    pub(super) fn new(cache:PathBuf)->Self {Self {cache,config:None,state:crate::State::default()}}
    pub(super) fn begin(&mut self,state:&State) {
        self.state.running=true;
        self.state.count=count(state).unwrap_or(self.state.count);
        self.state.error.clear();self.state.scanned=0;self.state.issues=0;
        output(json!({"state":self.state}));
    }
    pub(super) fn finish(&mut self,state:&State,result:io::Result<Value>,foreground:bool) {
        // File content writes do not alter the name index. Keep the UI still
        // when a local notification produces no confirmed index change.
        if !foreground && self.state.error.is_empty() && result.as_ref().is_ok_and(|value|value["changed"]==false) {return;}
        self.state.running=false;self.state.root.clear();self.state.updated=now();
        self.state.count=count(state).unwrap_or(self.state.count);
        match result {
            Ok(result)=>{
                self.state.scanned=result["scanned"].as_u64().unwrap_or(self.state.scanned as u64) as usize;
                self.state.issues=result["issues"].as_u64().unwrap_or(self.state.issues as u64) as usize;
                self.state.error.clear();
            }
            Err(error)=>self.state.error=if error.kind()==io::ErrorKind::Interrupted {"已停止，保留现有索引".into()} else {error.to_string()},
        }
        output(json!({"state":self.state}));
    }
    pub(super) fn merge_finished(&mut self,result:&io::Result<Value>) {
        self.state.cache_error=match result {
            Ok(_)=>String::new(),
            Err(error) if error.kind()==io::ErrorKind::Interrupted=>return,
            Err(error)=>error.to_string(),
        };
        output(json!({"state":self.state}));
    }
    fn effective(&self,config:&Config,dir:&Path)->Config {
        let mut effective=config.clone();
        effective.excluded.push(dir.to_string_lossy().into_owned());
        for path in [self.cache.clone(),PathBuf::from(format!("{}.delta",self.cache.display())),PathBuf::from(format!("{}.lock",self.cache.display()))] {
            effective.excluded.push(path.to_string_lossy().into_owned());
        }
        effective
    }
    pub(super) fn refresh_request(&self,request:&Value,dir:&Path)->io::Result<Value> {
        let config=self.config.as_ref().ok_or_else(||io::Error::other("搜索服务尚未初始化"))?;
        let mut result=request.clone();result["config"]=serde_json::to_value(self.effective(config,dir)).map_err(|_|bad())?;
        Ok(result)
    }
    pub(super) fn build(&mut self,state:&mut State,request:&Value,stop:&AtomicBool,cancel:impl Fn()->bool+Sync)->io::Result<Value> {
        self.begin(state);
        let mut config:Config=serde_json::from_value(request["settings"].clone()).map_err(|_|bad())?;
        config.max_entries=config.max_entries.clamp(1000,10_000_000);
        if config.roots.len()>64 || config.excluded.len()>64 || config.roots.iter().chain(&config.excluded).any(|p|p.contains('\0')||p.len()>131_072) {return Err(bad());}
        self.config=Some(config.clone());
        if stop.load(Ordering::Relaxed)||cancel() {return Err(io::Error::new(io::ErrorKind::Interrupted,"索引构建已取消"));}
        let warm=request["type"]=="init" && state.config.as_ref().is_some_and(|old|same(old,&config));
        if !warm {
            let temporary=state.dir.join("build.base");
            let generated=Temps(vec![temporary.clone()]);
            // State::open cleaned only names owned by this store. Never replace
            // a symlink, directory or unexpected colliding build output.
            if temporary.exists() {return Err(io::Error::new(io::ErrorKind::AlreadyExists,"索引构建输出已存在"));}
            let imported=if request["type"]=="init" && state.config.is_none() && self.cache.exists() {
                match import::run(&self.cache,&temporary,&config,stop) {
                    Ok(value)=>Some(value),
                    Err(error) if error.kind()==io::ErrorKind::Interrupted=>return Err(error),
                    Err(_)=>None,
                }
            } else {None};
            let built=if let Some(value)=imported {value} else {
                let effective=self.effective(&config,&state.dir);
                scan::run(&temporary,&effective,stop,|root,_,scanned,issues|{
                    self.state.root=root.into();self.state.scanned=scanned;self.state.issues=issues;
                    output(json!({"state":self.state}));
                })?
            };
            if stop.load(Ordering::Relaxed)||cancel() {return Err(io::Error::new(io::ErrorKind::Interrupted,"索引构建已取消"));}
            let next=id()?;let (base,delta)=paths(&state.dir,&next);
            fs::rename(&temporary,&base)?;
            let mut owned=Temps(vec![base.clone(),delta]);
            let map=Mapping::open(&base)?;let overlay=Overlay::load(&View::new(map.bytes())?,None)?;drop(map);
            let previous=state.config.replace(config.clone());
            if let Err(error)=state.publish_version(&next,overlay) {state.config=previous;return Err(error);}
            owned.0.clear();drop(generated);
            // A fresh scan has already visited the directories. A migrated
            // legacy snapshot still needs offline verification before ready.
            if built.get("scanned").is_some() {return Ok(built);}
        }
        let request=self.refresh_request(&json!({"type":"refresh","paths":[],"offline":true}),&state.dir)?;
        state.refresh(&request,||stop.load(Ordering::Relaxed)||cancel()).map(|(result,_,_,_)|result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_rebuild_keeps_the_matching_config_and_generation() {
        let dir=std::env::temp_dir().join(format!("one-disk-service-{}-{}",std::process::id(),now()));
        let first=dir.join("first");let second=dir.join("second");
        fs::create_dir_all(&first).unwrap();fs::create_dir_all(&second).unwrap();
        fs::write(first.join("Old.txt"),b"old").unwrap();fs::write(second.join("New.txt"),b"new").unwrap();
        let cache=dir.join("legacy.bin");fs::write(&cache,b"broken legacy cache retained").unwrap();
        let store=dir.join("store");let (mut state,lock)=State::open_with(None,&store).unwrap();
        let a=Config {roots:vec![first.to_string_lossy().into_owned()],max_entries:10_000,..Default::default()};
        let b=Config {roots:vec![second.to_string_lossy().into_owned()],max_entries:10_000,..Default::default()};
        let mut service=Service::new(cache.clone());let stop=AtomicBool::new(false);
        assert_eq!(service.build(&mut state,&json!({"type":"init","settings":a}),&stop,||false).unwrap()["count"],2);
        let previous=state.id.clone();let saved=fs::read(store.join(CURRENT)).unwrap();
        let obstruction=store.join(format!(".one-mapped-current.{}.tmp",std::process::id()));
        fs::write(&obstruction,b"owned publication failure").unwrap();
        assert!(service.build(&mut state,&json!({"type":"rebuild","settings":b}),&stop,||false).is_err());
        assert_eq!(state.id,previous);assert!(same(state.config.as_ref().unwrap(),&a));
        assert_eq!(fs::read(store.join(CURRENT)).unwrap(),saved);
        assert_eq!(fs::read(&cache).unwrap(),b"broken legacy cache retained");
        assert_eq!(fs::read(&obstruction).unwrap(),b"owned publication failure");
        fs::remove_file(obstruction).unwrap();
        stop.store(true,Ordering::Relaxed);
        assert_eq!(service.build(&mut state,&json!({"type":"rebuild","settings":b}),&stop,||false).unwrap_err().kind(),io::ErrorKind::Interrupted);
        assert_eq!(state.id,previous);assert_eq!(fs::read(store.join(CURRENT)).unwrap(),saved);
        drop(state);drop(lock);fs::remove_file(&cache).unwrap();
        let (state,lock)=State::open_with(None,&store).unwrap();assert!(same(state.config.as_ref().unwrap(),&a));assert_eq!(count(&state).unwrap(),2);
        assert!(owns("build.42.import-1.42.rows.tmp"));assert!(!owns("build.42.import-1.other.rows.tmp"));assert!(!owns("build.42.import--1.42.rows.tmp"));
        drop(state);drop(lock);fs::remove_dir_all(dir).unwrap();
    }
}
