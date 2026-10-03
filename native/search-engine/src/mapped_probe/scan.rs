//! First build writes bounded sorting runs and a streamed immutable image,
//! without retaining a mutable Index containing every discovered file.
use super::*;
use import::{Reader, Sort};

const OWNER: &[u8] = b"One immutable first-build scratch v1\n";
struct Scratch {
    path: std::path::PathBuf,
    lock: Option<File>,
}
fn owned_file(name: &str) -> bool {
    if name == "image.bin" { return true; }
    let Some(name) = name.strip_suffix(".tmp") else { return false; };
    let parts: Vec<_> = name.split('.').collect();
    parts.len() == 3
        && !parts[1].is_empty() && parts[1].bytes().all(|c| c.is_ascii_digit())
        && match parts[0] {
            "sort" => parts[2].strip_prefix("sort-").is_some_and(|n|!n.is_empty()&&n.bytes().all(|c|c.is_ascii_digit())),
            "image" => matches!(parts[2],"parents"|"rows"|"phonetics"|"data"|"image"),
            _ => false,
        }
}
impl Scratch {
    fn open(target: &Path) -> io::Result<Self> {
        let path = target.with_extension("scan");
        match fs::create_dir(&path) {
            Ok(()) => {},
            Err(error) if error.kind()==io::ErrorKind::AlreadyExists => {
                let metadata = fs::symlink_metadata(&path)?;
                if !metadata.is_dir() || metadata.is_symlink() { return Err(bad()); }
            },
            Err(error) => return Err(error),
        }
        let lock = cache::acquire(&path.join("writer").to_string_lossy())?;
        let marker = path.join(".one-first-build-owner");
        match File::open(&marker) {
            Ok(mut file) => {
                if file.metadata()?.len()!=OWNER.len() as u64 { return Err(bad()); }
                let mut bytes = vec![0;OWNER.len()];
                std::io::Read::read_exact(&mut file,&mut bytes)?;
                if bytes!=OWNER { return Err(bad()); }
            },
            Err(error) if error.kind()==io::ErrorKind::NotFound => {
                if fs::read_dir(&path)?.any(|e|e.is_ok_and(|e|e.file_name()!="writer.lock")) {
                    return Err(io::Error::other("首次索引暂存目录不是空目录"));
                }
                let mut file=OpenOptions::new().write(true).create_new(true).open(&marker)?;
                file.write_all(OWNER)?;file.sync_all()?;
            },
            Err(error) => return Err(error),
        }
        // Check the entire inventory before removing any orphan; an unrelated
        // file or nested directory makes this location unsuitable for reuse.
        for entry in fs::read_dir(&path)? {
            let entry=entry?;let name=entry.file_name();let name=name.to_string_lossy();
            if !entry.file_type()?.is_file() || (name!="writer.lock"&&name!=".one-first-build-owner"&&!owned_file(&name)) {
                return Err(io::Error::other("首次索引暂存目录含有其他文件"));
            }
        }
        let scratch = Self {path,lock:Some(lock)};
        for entry in fs::read_dir(&scratch.path)? {
            let entry=entry?;
            if owned_file(&entry.file_name().to_string_lossy()) {fs::remove_file(entry.path())?;}
        }
        Ok(scratch)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        self.lock.take();
        // Single-directory cleanup of exact generated names only. Preserve
        // any unexpected contents; never recursively delete a computed path.
        if let Ok(entries)=fs::read_dir(&self.path) {
            for entry in entries.flatten() {
                let name=entry.file_name();let name=name.to_string_lossy();
                if entry.file_type().is_ok_and(|t|t.is_file()) && (owned_file(&name)||name=="writer.lock"||name==".one-first-build-owner") {
                    let _=fs::remove_file(entry.path());
                }
            }
        }
        let _=fs::remove_dir(&self.path);
    }
}

pub(super) fn run(
    target: &Path,
    config: &Config,
    stop: &AtomicBool,
    mut progress: impl FnMut(&str, usize, usize, usize),
) -> io::Result<Value> {
    let start = Instant::now();
    let limit = config.max_entries.clamp(1000, 10_000_000);
    let mut config = config.clone();
    config.max_entries = limit;
    // Intermediate files live in a dedicated directory. Exclude it from the
    // scan to avoid discovering runs as the builder creates and removes them.
    let scratch = Scratch::open(target)?;
    config.excluded.push(scratch.path.to_string_lossy().into_owned());
    let cache_path = target.to_string_lossy().into_owned();
    let mut sort = Sort::scan(&scratch.path.join("sort.bin"));
    let (mut pending, mut bytes, mut accepted) = (Vec::new(), 0, 0usize);
    let (mut scanned, mut issues) = (0, 0);
    for step in priority::scans(&config) {
        if stop.load(Ordering::Relaxed) { break; }
        enumeration::enumerate(
            &step.root, &cache_path, &step.config, 1, &mut scanned, &mut issues,
            || stop.load(Ordering::Relaxed),
            |rows, scanned, issues| {
                for row in rows {
                    if accepted == limit { break; }
                    let entry = row.item.entry();
                    let path = key(&entry.path);
                    bytes += path.len() + entry.path.len();
                    pending.push((path, entry));
                    accepted += 1;
                    if pending.len() >= 8192 || bytes >= 4 * 1024 * 1024 {
                        sort.spill(std::mem::take(&mut pending), stop)?;
                        bytes = 0;
                    }
                    if accepted == limit {
                        if !pending.is_empty() {sort.spill(std::mem::take(&mut pending),stop)?;bytes=0;}
                        accepted = sort.checkpoint(stop)?;
                        if accepted == limit {break;}
                    }
                }
                progress(&step.root, accepted, scanned, issues);
                Ok(accepted < limit && !stop.load(Ordering::Relaxed))
            },
        )?;
        if accepted == limit { break; }
    }
    if stop.load(Ordering::Relaxed) {
        return Err(io::Error::new(io::ErrorKind::Interrupted, "首次索引构建已取消"));
    }
    if !pending.is_empty() { sort.spill(pending, stop)?; }
    let staged = scratch.path.join("image.bin");
    let count = if let Some(run) = sort.finish(stop)? {
        let mut reader = Reader::open(&run)?;
        import::image_from(|| reader.next(), &staged, stop)?
    } else {
        import::image_from(|| Ok(None), &staged, stop)?
    };
    if stop.load(Ordering::Relaxed) {return Err(io::Error::new(io::ErrorKind::Interrupted,"首次索引构建已取消"));}
    fs::rename(&staged,target)?;
    Ok(json!({"count":count,"scanned":scanned,"issues":issues,
        "capped":accepted==limit,"sortRuns":sort.runs,
        "bytes":fs::metadata(target)?.len(),"buildMs":start.elapsed().as_secs_f64()*1000.0}))
}

pub(super) fn command(args: &[String]) -> io::Result<()> {
    let target = Path::new(args.get(2).ok_or_else(bad)?);
    let config: Config = serde_json::from_reader(File::open(args.get(3).ok_or_else(bad)?)?)
        .map_err(|_| bad())?;
    let _lock = cache::acquire(&target.to_string_lossy())?;
    output(run(target, &config, &AtomicBool::new(false), |root,count,scanned,issues|
        output(json!({"build":{"root":root,"count":count,"scanned":scanned,"issues":issues}})))?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_scan_cancellation_and_publication_failure_keep_the_previous_image() {
        let dir = std::env::temp_dir().join(format!("one-mapped-first-{}-{}",std::process::id(),now()));
        let root = dir.join("files");
        fs::create_dir_all(&root).unwrap();
        for n in 0..10_000 { File::create(root.join(format!("file-{n:05}.txt"))).unwrap(); }
        let target = dir.join("image.bin");
        fs::write(&target,b"previous confirmed bytes").unwrap();
        let config = Config {roots:vec![root.to_string_lossy().into_owned()],max_entries:20_000,..Default::default()};
        let stop = AtomicBool::new(false);
        let result = run(&target,&config,&stop,|_,_,_,_|stop.store(true,Ordering::Relaxed));
        assert_eq!(result.unwrap_err().kind(),io::ErrorKind::Interrupted);
        assert_eq!(fs::read(&target).unwrap(),b"previous confirmed bytes");
        stop.store(false,Ordering::Relaxed);
        // A deny-write/deny-delete reader simulates publication being blocked.
        let lease = OpenOptions::new().read(true).share_mode(1).open(&target).unwrap();
        assert!(run(&target,&config,&stop,|_,_,_,_|{}).is_err());
        assert_eq!(fs::read(&target).unwrap(),b"previous confirmed bytes");
        drop(lease);
        assert_eq!(fs::read_dir(&dir).unwrap().count(),2);
        // Recover only owned files left by a terminated process. Refuse and
        // preserve unrelated contents, even inside an otherwise owned folder.
        let orphan = target.with_extension("scan");
        fs::create_dir(&orphan).unwrap();
        fs::write(orphan.join(".one-first-build-owner"),OWNER).unwrap();
        fs::write(orphan.join("sort.123.sort-0.tmp"),b"unfinished").unwrap();
        fs::write(orphan.join("unrelated.txt"),b"keep").unwrap();
        assert!(run(&target,&config,&stop,|_,_,_,_|{}).is_err());
        assert_eq!(fs::read(orphan.join("unrelated.txt")).unwrap(),b"keep");
        assert_eq!(fs::read(orphan.join(".one-first-build-owner")).unwrap(),OWNER);
        assert!(orphan.join("sort.123.sort-0.tmp").exists());
        fs::remove_file(orphan.join("unrelated.txt")).unwrap();
        let result = run(&target,&config,&stop,|_,_,_,_|{}).unwrap();
        assert_eq!(result["count"],10_001);
        assert!(result["sortRuns"].as_u64().unwrap()>1);
        let map = Mapping::open(&target).unwrap();
        let mut view = View::new(map.bytes()).unwrap();
        view.validate().unwrap();
        assert_eq!(view.count(),10_001);
        drop(map);
        assert_eq!(fs::read_dir(&dir).unwrap().count(),2);
        fs::remove_dir_all(dir).unwrap();
    }
}
