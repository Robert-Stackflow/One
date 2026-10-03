//! Diagnostic generation store. An atomic manifest publishes a complete
//! base/delta pair while a background builder works beside ordinary queries.
use super::*;
use overlay::Mutation;
use std::{path::PathBuf, sync::{mpsc, Weak}};
mod service;
use service::Service;

const OWNER: &str = "One mapped generation store 1\n";
const CURRENT: &str = ".one-mapped-current.json";
#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    config: Option<Config>,
}
pub(super) fn id() -> io::Result<String> {
    Ok(generation()?.iter().map(|b| format!("{b:02x}")).collect())
}
fn valid_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
pub(super) fn paths(dir: &Path, value: &str) -> (PathBuf, PathBuf) {
    (
        dir.join(format!(".one-mapped-{value}.base")),
        dir.join(format!(".one-mapped-{value}.delta")),
    )
}
fn publish(dir: &Path, value: &str, config: Option<&Config>) -> io::Result<()> {
    let temporary = dir.join(format!(".one-mapped-current.{}.tmp", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let guard = Temps(vec![temporary.clone()]);
    serde_json::to_writer(
        &mut file,
        &Manifest {
            version: 1,
            id: value.into(),
            config: config.cloned(),
        },
    )
    .map_err(|_| bad())?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, dir.join(CURRENT))?;
    drop(guard);
    Ok(())
}
fn owns(name: &str) -> bool {
    if name == "build.base" { return true; }
    if let Some(tail)=name.strip_prefix("build.") {
        let parts:Vec<_>=tail.split('.').collect();
        if parts.len()==3 && !parts[0].is_empty() && parts[0].bytes().all(|b|b.is_ascii_digit()) {
            return parts[2]=="base" && parts[1].strip_prefix("import-").is_some_and(|n|!n.is_empty()&&n.bytes().all(|b|b.is_ascii_digit()))
                || parts[2]=="tmp" && (matches!(parts[1],"parents"|"rows"|"phonetics"|"data"|"image") || parts[1].strip_prefix("sort-").is_some_and(|n|!n.is_empty()&&n.bytes().all(|b|b.is_ascii_digit())));
        }
        if parts.len()==5 && !parts[0].is_empty() && parts[0].bytes().all(|b|b.is_ascii_digit()) && parts[2]==parts[0] {
            return parts[1].strip_prefix("import-").is_some_and(|n|!n.is_empty()&&n.bytes().all(|b|b.is_ascii_digit()))
                && matches!(parts[3],"parents"|"rows"|"phonetics"|"data"|"image") && parts[4]=="tmp";
        }
    }
    if let Some(pid) = name
        .strip_prefix(".one-mapped-current.")
        .and_then(|s| s.strip_suffix(".tmp"))
    {
        return !pid.is_empty() && pid.bytes().all(|b| b.is_ascii_digit());
    }
    let Some(tail) = name.strip_prefix(".one-mapped-") else {
        return false;
    };
    if tail.len() < 33 || !tail.get(..32).is_some_and(valid_id) {
        return false;
    }
    let tail = &tail[32..];
    if matches!(tail, ".base" | ".delta") {
        return true;
    }
    let parts: Vec<_> = tail.strip_prefix('.').unwrap_or("").split('.').collect();
    parts.len() == 3
        && !parts[0].is_empty()
        && parts[0].bytes().all(|b| b.is_ascii_digit())
        && matches!(
            parts[1],
            "parents" | "rows" | "phonetics" | "data" | "image" | "delta"
        )
        && parts[2] == "tmp"
}
fn cleanup(dir: &Path, active: &str) {
    let (base, delta) = paths(dir, active);
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path == base || path == delta {
                continue;
            }
            if owns(&entry.file_name().to_string_lossy())
                && entry
                    .file_type()
                    .is_ok_and(|t| t.is_file() && !t.is_symlink())
            {
                let _ = fs::remove_file(path);
            }
        }
    }
}
// Readers retain an immutable overlay and a read-only file lease. Concurrent
// readers/writers of a generation share one immutable mapped view; the lease
// keeps only a weak mapping reference so idle state does not retain the view.
struct BaseLease {
    file: Option<File>,
    base: PathBuf,
    delta: PathBuf,
    retired: AtomicBool,
    verified_text: AtomicBool,
    mapping: Mutex<Weak<Mapping>>,
}
impl BaseLease {
    fn open(base: &Path, delta: &Path) -> io::Result<Arc<Self>> {
        let file = OpenOptions::new().read(true).share_mode(1).open(base)?;
        Ok(Arc::new(Self {
            file: Some(file), base: base.into(), delta: delta.into(),
            retired: AtomicBool::new(false),
            verified_text: AtomicBool::new(false),
            mapping: Mutex::new(Weak::new()),
        }))
    }
    fn mapping(&self) -> io::Result<Arc<Mapping>> {
        let mut cached = self.mapping.lock().unwrap();
        if let Some(mapping) = cached.upgrade() { return Ok(mapping); }
        let mapping = Arc::new(Mapping::open(&self.base)?);
        *cached = Arc::downgrade(&mapping);
        Ok(mapping)
    }
}
impl Drop for BaseLease {
    fn drop(&mut self) {
        // Close the deny-delete lease before removing this retired pair.
        self.file.take();
        if self.retired.load(Ordering::Relaxed) {
            let _ = fs::remove_file(&self.base);
            let _ = fs::remove_file(&self.delta);
        }
    }
}
struct ReadSnapshot {
    base: Arc<BaseLease>,
    overlay: Arc<Overlay>,
}
impl ReadSnapshot {
    fn from_state(state: &State) -> Arc<Self> {
        Arc::new(Self { base: state.lease.clone(), overlay: state.overlay.clone() })
    }
    fn request(&self, request: &Value, gate: &Gate, ticket: u64, launchers: &Index) -> io::Result<Value> {
        if matches!(request["type"].as_str(), Some("metadata" | "directories" | "children")) {
            if gate.stopped.load(Ordering::Relaxed) {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "索引读取已停止"));
            }
            let mapping = self.base.mapping()?;
            let view = View::new(mapping.bytes())?;
            crate::catalog::request(&catalog::MappedCatalog {view: &view, overlay: &self.overlay}, request)
        } else {
            if !gate.current(request, ticket) { return Ok(cancelled()); }
            let start = Instant::now();
            let mapping = self.base.mapping()?;
            query_mapping(&mapping, request, gate, ticket, &self.overlay, launchers, start, Some(&self.base.verified_text))
        }
    }
}
fn publish_readers(published: &RwLock<Arc<ReadSnapshot>>, state: &State) {
    let next = ReadSnapshot::from_state(state);
    // No mapping, I/O or query holds this lock. Construct before locking, then
    // drop the predecessor outside it, including any retired file cleanup.
    let previous = std::mem::replace(&mut *published.write().unwrap(), next);
    drop(previous);
}
struct State {
    dir: PathBuf,
    id: String,
    base: PathBuf,
    delta: PathBuf,
    overlay: Arc<Overlay>,
    lease: Arc<BaseLease>,
    config: Option<Config>,
}
impl State {
    fn open(seed: &Path, dir: &Path) -> io::Result<(Self, File)> {
        Self::open_with(Some(seed),dir)
    }
    fn open_with(seed: Option<&Path>, dir: &Path) -> io::Result<(Self, File)> {
        fs::create_dir_all(dir)?;
        let lock = cache::acquire(&dir.join("writer").to_string_lossy())?;
        let marker = dir.join(".one-mapped-owner");
        let previously_owned=marker.exists();
        if previously_owned {
            if fs::read_to_string(&marker)? != OWNER {
                return Err(bad());
            }
        } else {
            // Refuse an unrelated nonempty directory. The lock just created
            // above is the sole permitted entry before ownership is recorded.
            if fs::read_dir(dir)?.any(|e| e.is_ok_and(|e| e.file_name() != "writer.lock")) {
                return Err(io::Error::other("索引存储目录不是空目录"));
            }
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(marker)?;
            file.write_all(OWNER.as_bytes())?;
            file.sync_all()?;
        }
        let manifest = dir.join(CURRENT);
        let (current, config) = match File::open(&manifest) {
            Ok(file) => {
                if file.metadata()?.len() > 1_000_000 {
                    return Err(bad());
                }
                let m: Manifest = serde_json::from_reader(file).map_err(|_| bad())?;
                if m.version != 1 || !valid_id(&m.id) {
                    return Err(bad());
                }
                (m.id, m.config)
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                // A missing manifest beside published generations is damage,
                // not a new store. Keep every byte for recovery and reimport.
                if previously_owned && fs::read_dir(dir)?.any(|entry|entry.is_ok_and(|entry| {
                    let name=entry.file_name();let name=name.to_string_lossy();
                    owns(&name) && (name.ends_with(".base") || name.ends_with(".delta"))
                })) {return Err(bad());}
                let current = id()?;
                let (base, delta) = paths(dir, &current);
                let mut owned = Temps(Vec::new());
                if let Some(seed)=seed {
                    let input = Mapping::open(seed)?;
                    let mut file = OpenOptions::new().write(true).create_new(true).open(&base)?;
                    owned.0.push(base.clone());
                    // Copy immutable bytes, never millions of heap records.
                    file.write_all(input.bytes())?;file.sync_all()?;drop(file);
                } else {
                    if base.exists() {return Err(io::Error::new(io::ErrorKind::AlreadyExists,"索引主体已存在"));}
                    image(&Index::default(),&base)?;owned.0.push(base.clone());
                }
                let input=Mapping::open(&base)?;
                let view=View::new(input.bytes())?;
                let overlay = Overlay::load(&view, None)?;
                overlay.save(&delta)?;
                owned.0.push(delta);
                publish(dir, &current, None)?;
                owned.0.clear();
                (current, None)
            }
            Err(e) => return Err(e),
        };
        let (base, delta) = paths(dir, &current);
        File::open(&delta)?;
        let map = Mapping::open(&base)?;
        let view = View::new(map.bytes())?;
        let overlay = Overlay::load(&view, Some(&delta))?;
        drop(map);
        cleanup(dir, &current);
        let lease = BaseLease::open(&base, &delta)?;
        Ok((
            Self {
                dir: dir.into(),
                id: current,
                base,
                delta,
                overlay: Arc::new(overlay),
                lease,
                config,
            },
            lock,
        ))
    }
    fn apply(&mut self, changes: Vec<Mutation>, limit: usize) -> io::Result<Value> {
        let map = self.lease.mapping()?;
        let view = View::new(map.bytes())?;
        let next = self.overlay.stage(&view, changes, limit)?;
        next.save(&self.delta)?;
        self.overlay = Arc::new(next);
        Ok(self.overlay.stats(&view))
    }
    fn needs_merge(&self) -> bool {
        let Ok(map) = self.lease.mapping() else {
            return false;
        };
        let Ok(view) = View::new(map.bytes()) else {
            return false;
        };
        let stats = self.overlay.stats(&view);
        stats["changedRows"].as_u64().unwrap_or(0) >= 4000
            || stats["hiddenRanges"].as_u64().unwrap_or(0) >= 4000
            || stats["hiddenRows"].as_u64().unwrap_or(0) >= 1000.max(view.count() as u64 / 4)
    }
    fn refresh(&mut self, request:&Value, cancel:impl Fn()->bool+Sync) -> io::Result<(Value,Vec<Vec<Mutation>>,usize,bool)> {
        let mut config:Config=serde_json::from_value(request["config"].clone()).map_err(|_|bad())?;
        if config.roots.len()>64||config.excluded.len()>64||config.max_entries>10_000_000 {return Err(bad());}
        // The owned generation files must not index themselves or recursively
        // generate updates when the store is inside an indexed root.
        config.excluded.push(self.dir.to_string_lossy().into_owned());
        let paths:Vec<String>=serde_json::from_value(request["paths"].clone()).map_err(|_|bad())?;
        if paths.len()>10_000||paths.iter().any(|path|path.len()>131_072||path.contains('\0')) {return Err(bad());}
        let cache=self.dir.join("writer").to_string_lossy().into_owned();
        let map=self.lease.mapping()?;
        let progress=|fold|output(json!({"refresh":{"id":request["id"],"state":"folding","fold":fold}}));
        let mut changes=filesystem::refresh(map,&self.overlay,&config,&cache,paths,request["offline"].as_bool().unwrap_or(false),&cancel,&progress)?;
        if cancel() {return Err(io::Error::new(io::ErrorKind::Interrupted,"目录更新已取消"));}
        let mut small_saved=false;
        if changes.stage.is_none() && !changes.batches.is_empty() {
            match changes.overlay.save(&self.delta) {
                Ok(())=>{small_saved=true;},
                Err(error) if error.kind()==io::ErrorKind::WouldBlock=>{
                    progress(changes.folds+1);changes.fold(&cache,&cancel)?;
                },
                Err(error)=>return Err(error),
            }
        }
        // Save errors in a private generation remain unacknowledged. JSON
        // expansion can overflow even after a row-bounded scan; fold once more.
        if let Some(stage)=&mut changes.stage {
            stage.own_delta();
            match changes.overlay.save(&stage.delta) {
                Ok(())=>{},
                Err(error) if error.kind()==io::ErrorKind::WouldBlock=>{
                    progress(changes.folds+1);changes.fold(&cache,&cancel)?;
                    let stage=changes.stage.as_mut().unwrap();stage.own_delta();changes.overlay.save(&stage.delta)?;
                },
                Err(error)=>return Err(error),
            }
        }
        // Once the live delta save starts, successful persistence is its
        // commit point; never report cancellation while leaving new bytes.
        if cancel() && !small_saved {return Err(io::Error::new(io::ErrorKind::Interrupted,"目录更新已取消"));}
        let stats=changes.stats()?;
        let replaced=changes.stage.is_some();
        if let Some(stage)=&mut changes.stage {
            self.publish_version(&stage.id,changes.overlay)?;
            stage.keep();
        } else if !changes.batches.is_empty() {self.overlay=Arc::new(changes.overlay);}
        let changed=replaced||!changes.batches.is_empty();
        Ok((json!({"stats":stats,"scanned":changes.scanned,"issues":changes.issues,"stagedFolds":changes.folds,"replacedBase":replaced,"changed":changed}),changes.batches,config.max_entries,replaced))
    }
    fn install(&mut self, new_id: &str, tail: Vec<(Vec<Mutation>, usize)>) -> io::Result<Value> {
        let (base, _) = paths(&self.dir, new_id);
        let map = Mapping::open(&base)?;
        let view = View::new(map.bytes())?;
        let mut overlay = Overlay::load(&view, None)?;
        for (changes, limit) in tail {
            overlay = overlay.stage(&view, changes, limit)?;
        }
        drop(map);
        self.publish_version(new_id,overlay)
    }
    fn publish_version(&mut self, new_id:&str, overlay:Overlay) -> io::Result<Value> {
        let (base,delta)=paths(&self.dir,new_id);
        let map=Mapping::open(&base)?;
        let view=View::new(map.bytes())?;
        overlay.check(&view)?;
        let stats=overlay.stats(&view);
        overlay.save(&delta)?;
        drop(map);
        // Prepare the next read lease before the manifest commit. Publication
        // after it is infallible and cannot acknowledge an unreadable version.
        let lease = BaseLease::open(&base, &delta)?;
        publish(&self.dir, new_id, self.config.as_ref())?;
        // Publication is the commit point. Every earlier failure leaves the
        // old manifest and its acknowledged delta untouched.
        self.id = new_id.into();
        self.base = base;
        self.delta = delta;
        self.overlay = Arc::new(overlay);
        self.lease.retired.store(true, Ordering::Relaxed);
        self.lease = lease;
        // Other builders may still be running. Their owned intermediates are
        // reclaimed by guards, or by cleanup after the builder thread joins.
        Ok(stats)
    }
}
enum Message {
    Request(Value, u64),
    Build(Value, Arc<AtomicBool>, u64),
    Finished(String, io::Result<usize>),
    Stop,
}
struct Merge {
    id: String,
    request: Option<Value>,
    stop: Arc<AtomicBool>,
    thread: thread::JoinHandle<()>,
    tail: Vec<(Vec<Mutation>, usize)>,
    tail_count: usize,
    tail_bytes: usize,
    invalid: bool,
    start: Instant,
}
impl Merge {
    fn start(
        state: &State,
        request: Option<Value>,
        sender: mpsc::Sender<Message>,
    ) -> io::Result<Self> {
        let id = id()?;
        let base = state.lease.clone();
        let target = paths(&state.dir, &id).0;
        let overlay = state.overlay.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let finished_id = id.clone();
        let thread = thread::spawn(move || {
            let result = base.mapping().and_then(|mapping|compact::run_mapping(&mapping, &overlay, &target, &flag));
            let _ = sender.send(Message::Finished(finished_id, result));
        });
        Ok(Self {
            id,
            request,
            stop,
            thread,
            tail: Vec::new(),
            tail_count: 0,
            tail_bytes: 0,
            invalid: false,
            start: Instant::now(),
        })
    }
    fn record(&mut self, changes: Vec<Mutation>, limit: usize) {
        if self.invalid {
            return;
        }
        let bytes = changes
            .iter()
            .map(|c| match c {
                Mutation::Remove(p) => p.len(),
                Mutation::Put(e) => e.path.len() + e.name.len() + 64,
            })
            .sum::<usize>();
        if self.tail_count + changes.len() > 20_000 || self.tail_bytes + bytes > 8 * 1024 * 1024 {
            // The acknowledged old delta remains authoritative. Cancel rather
            // than let a background job retain an unbounded replay history.
            self.invalid = true;
            self.stop.store(true, Ordering::Relaxed);
            self.tail.clear();
            return;
        }
        self.tail_count += changes.len();
        self.tail_bytes += bytes;
        self.tail.push((changes, limit));
    }
}
pub fn serve(args: &[String]) -> io::Result<()> {
    let seed = Path::new(args.get(2).ok_or_else(bad)?);
    let dir = Path::new(args.get(3).ok_or_else(bad)?);
    let (state, lock) = State::open(seed, dir)?;
    run(state, lock, None)
}
/// The application protocol shares the same reader/writer and generation
/// lifecycle as the verification store. Legacy bytes are read only while
/// holding their writer lock; the complete mutable Index is never restored.
pub fn service(args: &[String]) -> io::Result<()> {
    let cache = PathBuf::from(args.get(2).ok_or_else(bad)?);
    let _cache_lock = cache::acquire(&cache.to_string_lossy())?;
    let dir = PathBuf::from(format!("{}.mapped", cache.display()));
    let (state, lock) = match State::open_with(None, &dir) {
        Ok(value)=>value,
        Err(error) if matches!(error.kind(),io::ErrorKind::InvalidData|io::ErrorKind::NotFound)=>recover_store(&dir,error)?,
        Err(error)=>return Err(error),
    };
    run(state, lock, Some(Service::new(cache)))
}
fn recover_store(dir:&Path,original:io::Error)->io::Result<(State,File)> {
    let marker=dir.join(".one-mapped-owner");
    if fs::symlink_metadata(dir)?.file_type().is_symlink()
        || fs::symlink_metadata(&marker)?.file_type().is_symlink()
        || fs::read_to_string(&marker)?!=OWNER {return Err(original);}
    // Quarantine damaged generations below the excluded store directory. A
    // sibling backup could itself be indexed during the next full scan.
    let guard=cache::acquire(&dir.join("writer").to_string_lossy())?;
    let mut damaged=Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry=entry?;let name=entry.file_name();let name=name.to_string_lossy();
        if name.strip_prefix("recovery-").is_some_and(valid_id) && entry.file_type()?.is_dir() {continue;}
        if !entry.file_type()?.is_file() || !matches!(name.as_ref(),".one-mapped-owner"|CURRENT|"writer.lock")&&!owns(&name) {return Err(original);}
        if !matches!(name.as_ref(),".one-mapped-owner"|"writer.lock") {damaged.push(entry.path());}
    }
    let backup=dir.join(format!("recovery-{}",id()?));
    fs::create_dir(&backup)?;
    for path in damaged {
        let name=path.file_name().ok_or_else(bad)?;
        fs::rename(&path,backup.join(name))?;
    }
    drop(guard);
    State::open_with(None,dir)
}
fn run(mut state: State, lock: File, mut service: Option<Service>) -> io::Result<()> {
    let map = Mapping::open(&state.base)?;
    let view = View::new(map.bytes())?;
    if service.is_none() { output(json!({"ready":true,"count":state.overlay.count(&view),"generation":state.id})); }
    drop(map);
    let gate = Arc::new(Gate::default());
    let worker_gate = gate.clone();
    let refreshes=Arc::new(AtomicU64::new(0));
    let worker_refreshes=refreshes.clone();
    let builds = Arc::new(Mutex::new(None::<Arc<AtomicBool>>));
    let input_builds = builds.clone();
    let service_protocol = service.is_some();
    let published = Arc::new(RwLock::new(ReadSnapshot::from_state(&state)));
    let reader_published = published.clone();
    let reader_gate = gate.clone();
    let launchers = Arc::new(RwLock::new(Arc::new(Index::default())));
    let reader_launchers = launchers.clone();
    let (read_tx, read_rx) = mpsc::channel::<(Value, u64)>();
    let reader = thread::spawn(move || {
        for (request, ticket) in read_rx {
            let snapshot = reader_published.read().unwrap().clone();
            let launcher_snapshot = reader_launchers.read().unwrap().clone();
            reply(&request, snapshot.request(&request, &reader_gate, ticket, &launcher_snapshot));
        }
    });
    let (tx, rx) = mpsc::channel();
    let worker_tx = tx.clone();
    let worker = thread::spawn(move || {
        let _lock = lock;
        let mut active: Option<Merge> = None;
        if state.needs_merge() {
            match Merge::start(&state, None, worker_tx.clone()) {
                Ok(job) => {
                    active = Some(job);
                    output(json!({"merge":{"state":"running"}}));
                }
                Err(e) => output(json!({"merge":{"state":"error","error":e.to_string()}})),
            }
        }
        for message in rx {
            match message {
                Message::Stop => break,
                Message::Finished(id, result) => {
                    if active.as_ref().is_none_or(|job|job.id != id) { continue; }
                    let Some(job) = active.take() else {
                        continue;
                    };
                    let joined = job.thread.join();
                    let result = if joined.is_err() {
                        Err(io::Error::other("索引合并线程失败"))
                    } else if job.invalid || worker_gate.stopped.load(Ordering::Relaxed) {
                        Err(io::Error::new(io::ErrorKind::Interrupted, "索引合并已取消"))
                    } else {
                        result.and_then(|_| state.install(&job.id, job.tail))
                    };
                    let success = result.is_ok();
                    if success { publish_readers(&published, &state); }
                    if let Some(service)=&mut service {service.merge_finished(&result);}
                    let retry = job.invalid;
                    if let Some(request) = job.request {
                        reply(&request,result.map(|stats|json!({"stats":stats,"generation":state.id,"mergeMs":job.start.elapsed().as_secs_f64()*1000.0})));
                    } else {
                        output(match &result {
                            Ok(stats) => {
                                json!({"merge":{"state":"done","generation":state.id,"stats":stats,"mergeMs":job.start.elapsed().as_secs_f64()*1000.0}})
                            }
                            Err(e) => json!({"merge":{"state":"error","error":e.to_string()}}),
                        });
                    }
                    cleanup(&state.dir, &state.id);
                    if (success || retry)
                        && !worker_gate.stopped.load(Ordering::Relaxed)
                        && state.needs_merge()
                    {
                        match Merge::start(&state, None, worker_tx.clone()) {
                            Ok(job) => {
                                active = Some(job);
                                output(json!({"merge":{"state":"running"}}));
                            }
                            Err(e) => {
                                output(json!({"merge":{"state":"error","error":e.to_string()}}))
                            }
                        }
                    }
                    // Replay overflow retries from the latest acknowledged
                    // snapshot; I/O failures await a later explicit retry.
                }
                Message::Build(v, stop, ticket) => {
                    let Some(service) = &mut service else { continue; };
                    if let Some(job) = active.take() {
                        job.stop.store(true,Ordering::Relaxed);
                        let _ = job.thread.join();
                        cleanup(&state.dir,&state.id);
                    }
                    let result = service.build(&mut state,&v,&stop,||worker_gate.stopped.load(Ordering::Relaxed)||worker_refreshes.load(Ordering::Relaxed)!=ticket);
                    publish_readers(&published,&state);
                    service.finish(&state,result,true);
                    if !worker_gate.stopped.load(Ordering::Relaxed) && state.needs_merge() {
                        match Merge::start(&state,None,worker_tx.clone()) {
                            Ok(job)=>{active=Some(job);output(json!({"merge":{"state":"running"}}));}
                            Err(error)=>service.merge_finished(&Err(error)),
                        }
                    }
                }
                Message::Request(v, ticket) => match v["type"].as_str().unwrap_or("") {
                    "compact" => {
                        if active.is_some() {
                            reply(
                                &v,
                                Err(io::Error::new(io::ErrorKind::WouldBlock, "索引正在合并")),
                            );
                            continue;
                        }
                        match Merge::start(&state, Some(v.clone()), worker_tx.clone()) {
                            Ok(job) => {
                                active = Some(job);
                                output(json!({"merge":{"state":"running"}}));
                            }
                            Err(e) => reply(&v, Err(e)),
                        }
                    }
                    "apply" | "refresh" => {
                        let foreground=v["type"]!="refresh"||v["offline"].as_bool().unwrap_or(false);
                        if foreground { if let Some(service) = &mut service { service.begin(&state); } }
                        let result = (|| {
                            if v["type"]=="refresh" {
                                let request = if let Some(service)=&service {service.refresh_request(&v,&state.dir)?} else {v.clone()};
                                let (result,batches,limit,replaced)=state.refresh(&request,||worker_gate.stopped.load(Ordering::Relaxed)||worker_refreshes.load(Ordering::Relaxed)!=ticket)?;
                                if let Some(job)=&mut active {
                                    if replaced {job.invalid=true;job.stop.store(true,Ordering::Relaxed);job.tail.clear();}
                                    else {for batch in batches {job.record(batch,limit);}}
                                }
                                return Ok(result);
                            }
                            let changes: Vec<Mutation> =
                                serde_json::from_value(v["changes"].clone()).map_err(|_| bad())?;
                            let limit = v["maxEntries"]
                                .as_u64()
                                .unwrap_or(10_000_000)
                                .min(10_000_000) as usize;
                            let stats = state.apply(changes.clone(), limit)?;
                            if let Some(job) = &mut active {
                                job.record(changes, limit);
                            }
                            Ok(stats)
                        })();
                        let success = result.is_ok();
                        if success { publish_readers(&published, &state); }
                        if let Some(service) = &mut service {
                            service.finish(&state,result,foreground);
                        } else { reply(&v, result); }
                        if success
                            && active.is_none()
                            && !worker_gate.stopped.load(Ordering::Relaxed)
                            && state.needs_merge()
                        {
                            match Merge::start(&state, None, worker_tx.clone()) {
                                Ok(job) => {
                                    active = Some(job);
                                    output(json!({"merge":{"state":"running"}}));
                                }
                                Err(e) => {
                                    output(json!({"merge":{"state":"error","error":e.to_string()}}))
                                }
                            }
                        }
                    }
                    _ => reply(&v, Err(io::Error::new(io::ErrorKind::InvalidInput, "未知索引修改请求"))),
                },
            }
        }
        if let Some(job) = active {
            job.stop.store(true, Ordering::Relaxed);
            let _ = job.thread.join();
            cleanup(&state.dir, &state.id);
        }
    });
    let input = (|| -> io::Result<()> {
        for line in io::stdin().lock().lines() {
            let line = line?;
            if line.len() > 1_000_000 {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match v["type"].as_str().unwrap_or("") {
                "init" | "rebuild" if service_protocol => {
                    let stop = Arc::new(AtomicBool::new(false));
                    if let Some(previous)=input_builds.lock().unwrap().replace(stop.clone()) { previous.store(true,Ordering::Relaxed); }
                    let ticket=refreshes.fetch_add(1,Ordering::SeqCst)+1;
                    let _=tx.send(Message::Build(v,stop,ticket));
                }
                "changes" | "resync" if service_protocol => {
                    let ticket = if v["type"]=="resync" {refreshes.fetch_add(1,Ordering::SeqCst)+1} else {refreshes.load(Ordering::SeqCst)};
                    let mut request=v;
                    request["offline"]=json!(request["type"]=="resync");
                    request["type"]=json!("refresh");
                    if request["paths"].is_null() {request["paths"]=json!([]);}
                    let _=tx.send(Message::Request(request,ticket));
                }
                "cancel" if service_protocol => {
                    refreshes.fetch_add(1,Ordering::SeqCst);
                    if let Some(stop)=&*input_builds.lock().unwrap() {stop.store(true,Ordering::Relaxed);}
                }
                "launchers" => {
                    if let Some(index) = crate::launchers::index(&v["items"]) {
                        let previous = std::mem::replace(&mut *launchers.write().unwrap(), Arc::new(index));
                        drop(previous);
                    }
                }
                "query" => {
                    let ticket = gate.enqueue(&v);
                    let _ = read_tx.send((v, ticket));
                }
                "refresh" => {
                    let ticket=refreshes.fetch_add(1,Ordering::SeqCst)+1;
                    let _=tx.send(Message::Request(v,ticket));
                }
                "cancel-refresh" => {
                    refreshes.fetch_add(1,Ordering::SeqCst);
                    reply(&v,Ok(json!({"cancelled":true})));
                }
                "metadata" | "directories" | "children" => {
                    let _ = read_tx.send((v, 0));
                }
                "apply" | "compact" => {
                    let _ = tx.send(Message::Request(v, 0));
                }
                "release-query" => {
                    gate.scopes
                        .lock()
                        .unwrap()
                        .remove(&v["scope"].as_u64().unwrap_or(0));
                }
                "stop" => break,
                _ => {}
            }
        }
        Ok(())
    })();
    gate.stopped.store(true, Ordering::Relaxed);
    if let Some(stop)=&*builds.lock().unwrap() {stop.store(true,Ordering::Relaxed);}
    let _ = tx.send(Message::Stop);
    drop(tx);
    drop(read_tx);
    let writer_result = worker.join();
    let reader_result = reader.join();
    writer_result.map_err(|_| io::Error::other("Mapped store writer stopped unexpectedly"))?;
    reader_result.map_err(|_| io::Error::other("Mapped store reader stopped unexpectedly"))?;
    input
}
fn reply(request: &Value, result: io::Result<Value>) {
    output(match result {
        Ok(result) => json!({"id":request["id"],"result":result}),
        Err(e) => json!({"id":request["id"],"error":e.to_string()}),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn damaged_store_is_quarantined_without_touching_legacy_or_unowned_files() {
        let root=std::env::temp_dir().join(format!("one-map-recovery-{}-{}",std::process::id(),id().unwrap()));
        fs::create_dir(&root).unwrap();
        let legacy=root.join("legacy.bin");fs::write(&legacy,b"legacy snapshot stays intact").unwrap();
        for failure in ["manifest","missing-manifest","base"] {
            let dir=root.join(failure);
            let (state,lock)=State::open_with(None,&dir).unwrap();
            let base=state.base.clone();let manifest=dir.join(CURRENT);
            drop(state);drop(lock);
            let original_base=fs::read(&base).unwrap();
            let original_manifest=fs::read(&manifest).unwrap();
            match failure {
                "manifest"=>fs::write(&manifest,b"not json").unwrap(),
                "missing-manifest"=>fs::remove_file(&manifest).unwrap(),
                _=>fs::write(&base,b"not an index image").unwrap(),
            }
            let damaged_base=fs::read(&base).unwrap();
            let damaged_manifest=fs::read(&manifest).ok();
            let error=State::open_with(None,&dir).err().unwrap();
            assert!(matches!(error.kind(),io::ErrorKind::InvalidData|io::ErrorKind::NotFound));
            let (restored,lock)=recover_store(&dir,error).unwrap();
            let backups:Vec<_>=fs::read_dir(&dir).unwrap().map(Result::unwrap)
                .filter(|entry|entry.file_name().to_string_lossy().starts_with("recovery-"))
                .collect();
            assert_eq!(backups.len(),1);
            assert_eq!(fs::read(backups[0].path().join(base.file_name().unwrap())).unwrap(),damaged_base);
            assert_eq!(fs::read(backups[0].path().join(CURRENT)).ok(),damaged_manifest);
            assert_eq!(fs::read(&legacy).unwrap(),b"legacy snapshot stays intact");
            assert_ne!(fs::read(&restored.base).unwrap(),b"not an index image");
            if failure=="base" {assert_eq!(fs::read(backups[0].path().join(CURRENT)).unwrap(),original_manifest);}
            if failure=="missing-manifest" {assert_eq!(damaged_base,original_base);}
            drop(restored);drop(lock);
        }
        let dir=root.join("foreign");let (state,lock)=State::open_with(None,&dir).unwrap();
        drop(state);drop(lock);
        fs::write(dir.join(CURRENT),b"not json").unwrap();
        let extra=dir.join("unrelated.txt");fs::write(&extra,b"keep me").unwrap();
        let error=State::open_with(None,&dir).err().unwrap();
        assert!(recover_store(&dir,error).is_err());
        assert_eq!(fs::read(&extra).unwrap(),b"keep me");
        assert!(!fs::read_dir(&dir).unwrap().any(|entry|entry.unwrap().file_name().to_string_lossy().starts_with("recovery-")));
        fs::remove_file(extra).unwrap();
        let busy=cache::acquire(&dir.join("writer").to_string_lossy()).unwrap();
        assert!(recover_store(&dir,bad()).is_err());
        drop(busy);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn generation_publication_and_orphan_recovery_preserve_confirmed_changes() {
        let dir = std::env::temp_dir().join(format!("one-map-store-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let seed = dir.join("seed.bin");
        let store = dir.join("store");
        let mut index = Index::default();
        index.put(Record::new("D:\\Old.txt".into(), false, 0));
        image(&index, &seed).unwrap();
        let (mut state, lock) = State::open(&seed, &store).unwrap();
        let old_id = state.id.clone();
        let put = || {
            Mutation::Put(Entry {
                path: "D:\\新报告.TXT".into(),
                name: String::new(),
                directory: false,
                modified: 0,
                size: 0,
            })
        };
        state.apply(vec![put()], 100).unwrap();
        let next = id().unwrap();
        compact::run(
            &state.base,
            &state.overlay,
            &paths(&store, &next).0,
            &AtomicBool::new(false),
        )
        .unwrap();
        let stale = store.join(format!(".one-mapped-current.{}.tmp", std::process::id()));
        fs::write(&stale, "unrelated").unwrap();
        assert!(
            state
                .install(
                    &next,
                    vec![(vec![Mutation::Remove("D:\\Old.txt".into())], 100)]
                )
                .is_err()
        );
        assert_eq!(state.id, old_id);
        drop(state);
        drop(lock);
        let (mut restored, lock) = State::open(&seed, &store).unwrap();
        assert_eq!(restored.id, old_id);
        assert!(!paths(&store, &next).0.exists());
        assert!(!stale.exists());
        let next = id().unwrap();
        compact::run(
            &restored.base,
            &restored.overlay,
            &paths(&store, &next).0,
            &AtomicBool::new(false),
        )
        .unwrap();
        restored
            .install(
                &next,
                vec![(vec![Mutation::Remove("D:\\Old.txt".into())], 100)],
            )
            .unwrap();
        assert_eq!(restored.id, next);
        assert!(!paths(&store, &old_id).0.exists());
        drop(restored);
        drop(lock);
        fs::remove_file(seed).unwrap();
        let (state, lock) = State::open(&dir.join("missing-seed"), &store).unwrap();
        let map = Mapping::open(&state.base).unwrap();
        let view = View::new(map.bytes()).unwrap();
        assert_eq!(state.overlay.count(&view), 1);
        let visible = state
            .overlay
            .iter(&view, 0..view.count(), None)
            .map(|r| match r.unwrap() {
                Candidate::Base(n) => view.row(n).unwrap().exact_name.to_owned(),
                Candidate::Extra(_, r) => r.item.entry().name,
            })
            .collect::<Vec<_>>();
        assert_eq!(visible, vec!["新报告.TXT"]);
        assert!(!owns(".one-mapped-../outside.base"));
        assert!(!owns(".one-mapped-current.user.tmp"));
        assert!(!owns(".one-mapped-🙂🙂🙂🙂🙂🙂🙂🙂x.base"));
        drop(map);
        drop(state);
        drop(lock);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn readers_hold_confirmed_overlay_and_retired_base_until_the_last_lease() {
        let dir = std::env::temp_dir().join(format!("one-map-readers-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let seed = dir.join("seed.bin");
        let store = dir.join("store");
        let mut index = Index::default();
        index.put(Record::new("D:\\Old.txt".into(), false, 0));
        image(&index, &seed).unwrap();
        let (mut state, lock) = State::open(&seed, &store).unwrap();
        let published = RwLock::new(ReadSnapshot::from_state(&state));
        let old = published.read().unwrap().clone();
        let old_base = state.base.clone();
        let mapping = state.lease.mapping().unwrap();
        let weak = Arc::downgrade(&mapping);
        let lease = state.lease.clone();
        let shared = thread::spawn(move || {
            let mapping = lease.mapping().unwrap();
            assert_eq!(View::new(mapping.bytes()).unwrap().count(), 1);
            mapping
        }).join().unwrap();
        assert!(Arc::ptr_eq(&mapping, &shared), "Concurrent readers must reuse the same mapped view");
        drop(shared);
        drop(mapping);
        assert!(weak.upgrade().is_none(), "Idle leases must not keep mapped pages resident");
        assert!(state.lease.mapping.lock().unwrap().upgrade().is_none());
        let gate = Gate::default();
        let metadata = json!({"type":"metadata","path":"D:\\New.txt"});
        state.apply(vec![Mutation::Put(Entry {
            path: "D:\\New.txt".into(), name: String::new(), directory: false,
            modified: 0, size: 0,
        })], 100).unwrap();
        publish_readers(&published, &state);
        let launchers = Index::default();
        assert_eq!(old.request(&metadata, &gate, 0, &launchers).unwrap(), Value::Null);
        assert_eq!(published.read().unwrap().request(&metadata, &gate, 0, &launchers).unwrap()["path"], "D:\\New.txt");
        let next = id().unwrap();
        compact::run(&state.base, &state.overlay, &paths(&store, &next).0, &AtomicBool::new(false)).unwrap();
        state.install(&next, Vec::new()).unwrap();
        publish_readers(&published, &state);
        assert!(old_base.exists(), "A pinned query must retain the retired base");
        let query = json!({"type":"query","scope":71,"query":""});
        let ticket = gate.enqueue(&query);
        assert!(!old.base.verified_text.load(Ordering::Acquire));
        assert_eq!(old.request(&query, &gate, ticket, &launchers).unwrap()["total"], 1);
        assert!(old.base.verified_text.load(Ordering::Acquire));
        assert_eq!(old.request(&query, &gate, ticket, &launchers).unwrap()["total"], 1);
        assert!(!published.read().unwrap().base.verified_text.load(Ordering::Acquire));
        assert_eq!(published.read().unwrap().request(&query, &gate, ticket, &launchers).unwrap()["total"], 2);
        assert!(published.read().unwrap().base.verified_text.load(Ordering::Acquire));
        assert_eq!(published.read().unwrap().request(&query, &gate, ticket, &launchers).unwrap()["total"], 2);
        drop(old);
        assert!(!old_base.exists(), "Retired generation is reclaimed after its last reader");
        drop(published);
        drop(state);
        drop(lock);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn encoded_delta_overflow_folds_without_rejecting_a_small_filesystem_update() {
        let dir=std::env::temp_dir().join(format!("one-map-encoded-{}",std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let seed=dir.join("seed.bin");let store=dir.join("store");let root=dir.join("files");
        fs::create_dir_all(&root).unwrap();image(&Index::default(),&seed).unwrap();
        let (mut state,lock)=State::open(&seed,&store).unwrap();
        let prefix=format!("D:\\Legacy\\{}\\","a".repeat(440));
        let sample=Entry {path:format!("{prefix}old-000000.txt"),name:"old-000000.txt".into(),directory:false,modified:0,size:0};
        let rows=(8*1024*1024-96*1024)/(serde_json::to_vec(&sample).unwrap().len()+1);
        assert!(rows+1001<18_976);
        for first in (0..rows).step_by(10_000) {
            let changes=(first..rows.min(first+10_000)).map(|n|Mutation::Put(Entry {
                path:format!("{prefix}old-{n:06}.txt"),..sample.clone()
            })).collect();
            state.apply(changes,100000).unwrap();
        }
        let old_id=state.id.clone();
        assert!(fs::metadata(&state.delta).unwrap().len()>7*1024*1024);
        for n in 0..1000 {fs::write(root.join(format!("actual-{n:04}.txt")),"x").unwrap();}
        let request=json!({"id":91,"config":{"roots":[root],"excluded":[],"maxEntries":100000},"paths":[],"offline":true});
        let (result,batches,_,replaced)=state.refresh(&request,||false).unwrap();
        assert!(replaced);assert_eq!(result["stagedFolds"],1);assert!(batches.is_empty());
        assert_eq!(result["stats"]["count"],rows+1001);assert_ne!(state.id,old_id);
        assert_eq!(result["stats"]["changedRows"],0);
        assert!(fs::metadata(&state.delta).unwrap().len()<1024);
        drop(state);drop(lock);
        let (state,lock)=State::open(&dir.join("missing-seed"),&store).unwrap();
        let map=state.lease.mapping().unwrap();let view=View::new(map.bytes()).unwrap();
        assert_eq!(state.overlay.count(&view),rows+1001);
        drop(map);drop(state);drop(lock);fs::remove_dir_all(dir).unwrap();
    }
}
