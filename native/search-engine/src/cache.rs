use super::*;
use std::{
    ffi::OsStr,
    fs::OpenOptions,
    io::{Read, Seek},
    os::windows::{ffi::OsStrExt, fs::OpenOptionsExt},
    sync::Condvar,
    time::Duration,
};

pub const MAX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DELTA: u64 = 8 * 1024 * 1024;
const MAGIC: &[u8; 8] = b"ONEIDX06";
const DELTA: &[u8; 8] = b"ONEDEL06";
#[derive(Clone)]
pub enum Change {
    Remove(String),
    Put(Entry),
}
#[derive(Default)]
struct Pending {
    dirty: bool,
    stop: bool,
    full: bool,
    changes: Vec<Change>,
    generation: u64,
    base: u64,
}
#[derive(Default)]
pub struct Persistence {
    pending: Mutex<Pending>,
    wake: Condvar,
}
impl Persistence {
    pub fn request(&self) {
        let mut p = self.pending.lock().unwrap();
        p.dirty = true;
        p.full = true;
        p.changes.clear();
        self.wake.notify_one();
    }
    pub fn changes(&self, generation: u64, changes: Vec<Change>) {
        let mut p = self.pending.lock().unwrap();
        if !p.full {
            if !p.changes.is_empty() && p.generation != generation
                || p.changes.len() + changes.len() > 10000
            {
                p.full = true;
                p.changes.clear();
            } else {
                p.changes.extend(changes);
            }
        }
        p.generation = generation;
        p.dirty = true;
        self.wake.notify_one();
    }
    pub fn loaded(&self, id: u64) {
        self.pending.lock().unwrap().base = id;
    }
    pub fn stop(&self) {
        let mut p = self.pending.lock().unwrap();
        p.stop = true;
        self.wake.notify_one();
    }
}
pub fn owned(path: &str, cache: &str) -> bool {
    let p = key(path);
    let c = key(cache);
    owned_key(&p, &c)
}
pub fn owned_key(p: &str, c: &str) -> bool {
    if p == c {
        return true;
    }
    let Some(suffix) = p.strip_prefix(c).and_then(|s| s.strip_prefix('.')) else {
        return false;
    };
    if matches!(suffix, "lock" | "tmp" | "delta") {
        return true;
    }
    let Some(numbers) = suffix.strip_suffix(".tmp") else {
        return false;
    };
    let parts: Vec<_> = numbers.split('.').collect();
    parts.len() == 2
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|c| c.is_ascii_digit()))
}
// An exclusive handle prevents a second helper from cleaning/writing an active cache.
pub fn acquire(cache: &str) -> io::Result<File> {
    if let Some(parent) = Path::new(cache).parent() {
        fs::create_dir_all(parent)?;
    }
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode(0)
        .open(format!("{cache}.lock"))
}
pub fn cleanup(cache: &str) {
    if fs::symlink_metadata(cache)
        .is_ok_and(|m| m.is_file() && !m.is_symlink() && m.len() > MAX_BYTES)
    {
        let _ = fs::remove_file(cache);
    }
    let Some(parent) = Path::new(cache).parent() else {
        return;
    };
    if let Ok(entries) = fs::read_dir(parent) {
        for e in entries.flatten() {
            let path = e.path();
            let value = path.to_string_lossy();
            if value.ends_with(".tmp")
                && owned(&value, cache)
                && e.file_type().is_ok_and(|t| t.is_file() && !t.is_symlink())
            {
                let _ = fs::remove_file(path);
            }
        }
    }
}
struct Temporary(String);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn bad() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "索引缓存损坏")
}
fn prefix(a: &str, b: &str) -> usize {
    let mut n = a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count();
    while !a.is_char_boundary(n) {
        n -= 1;
    }
    n
}
fn var_size(mut n: u64) -> u64 {
    let mut len = 1;
    while n >= 128 {
        len += 1;
        n >>= 7;
    }
    len
}
fn put_var(w: &mut impl Write, mut n: u64) -> io::Result<()> {
    while n >= 128 {
        w.write_all(&[(n as u8 & 127) | 128])?;
        n >>= 7;
    }
    w.write_all(&[n as u8])
}
fn get_var(r: &mut impl Read) -> io::Result<u64> {
    let mut n = 0;
    for shift in (0..=63).step_by(7) {
        let mut b = [0];
        r.read_exact(&mut b)?;
        if shift == 63 && b[0] > 1 {
            return Err(bad());
        }
        n |= ((b[0] & 127) as u64) << shift;
        if b[0] & 128 == 0 {
            return Ok(n);
        }
    }
    Err(bad())
}
fn put_path(w: &mut impl Write, path: &str, previous: &str) -> io::Result<()> {
    let shared = prefix(&previous, &path);
    put_var(w, shared as u64)?;
    put_var(w, (path.len() - shared) as u64)?;
    w.write_all(&path.as_bytes()[shared..])
}
fn get_path(r: &mut impl Read, previous: &mut String) -> io::Result<()> {
    let shared = get_var(r)? as usize;
    let len = get_var(r)? as usize;
    if shared > previous.len()
        || !previous.is_char_boundary(shared)
        || len > 131072
        || shared + len > 131072
    {
        return Err(bad());
    }
    let mut tail = vec![0; len];
    r.read_exact(&mut tail)?;
    previous.truncate(shared);
    previous.push_str(std::str::from_utf8(&tail).map_err(|_| bad())?);
    if !Path::new(previous).is_absolute() {
        return Err(bad());
    }
    Ok(())
}
fn put_meta(w: &mut impl Write, directory: bool, modified: u64) -> io::Result<()> {
    w.write_all(&[u8::from(directory)])?;
    if directory {
        put_var(w, modified)?;
    }
    Ok(())
}
fn get_entry(r: &mut impl Read, path: String) -> io::Result<Entry> {
    let mut flags = [0];
    r.read_exact(&mut flags)?;
    if flags[0] > 1 {
        return Err(bad());
    }
    let directory = flags[0] == 1;
    Ok(Entry {
        path,
        name: String::new(),
        directory,
        modified: if directory { get_var(r)? } else { 0 },
        size: 0,
    })
}
fn restore(item: Entry) -> Record {
    let mut row = Record::new(item.path, item.directory, 0);
    row.item.modified = item.modified;
    row
}
fn decode_batch(index: &mut Index, batch: &mut Vec<Entry>) -> io::Result<()> {
    use jwalk::rayon::prelude::*;
    static POOL: std::sync::OnceLock<jwalk::rayon::ThreadPool> = std::sync::OnceLock::new();
    let pool = POOL.get_or_init(|| {
        jwalk::rayon::ThreadPoolBuilder::new()
            .num_threads(4)
            .build()
            .unwrap()
    });
    let rows: Vec<_> =
        pool.install(|| std::mem::take(batch).into_par_iter().map(restore).collect());
    for row in rows {
        if index.put(row).is_some() {
            return Err(bad());
        }
    }
    Ok(())
}
fn encoded_size(index: &Index, config: &[u8]) -> u64 {
    let mut size = 36 + config.len() as u64;
    let mut previous = Cow::Borrowed("");
    for row in index.rows.values() {
        let path = row.item.path.display();
        let shared = prefix(&previous, &path);
        let tail = path.len() - shared;
        size += var_size(shared as u64)
            + var_size(tail as u64)
            + tail as u64
            + 1
            + if row.item.directory {
                var_size(row.item.modified)
            } else {
                0
            };
        previous = path;
    }
    size
}
fn encode(
    w: &mut impl Write,
    index: &Index,
    config: &[u8],
    updated: u64,
    id: u64,
) -> io::Result<()> {
    w.write_all(MAGIC)?;
    w.write_all(&(config.len() as u32).to_le_bytes())?;
    w.write_all(config)?;
    w.write_all(&updated.to_le_bytes())?;
    w.write_all(&id.to_le_bytes())?;
    w.write_all(&(index.rows.len() as u64).to_le_bytes())?;
    let mut previous = Cow::Borrowed("");
    for row in index.rows.values() {
        let path = row.item.path.display();
        put_path(w, &path, &previous)?;
        put_meta(w, row.item.directory, row.item.modified)?;
        previous = path;
    }
    Ok(())
}
fn decode(r: &mut impl Read, expected: &Config) -> io::Result<Option<(Index, u64, u64)>> {
    let mut magic = [0; 8];
    r.read_exact(&mut magic)?;
    if &magic != MAGIC {
        return Ok(None);
    }
    let mut length = [0; 4];
    r.read_exact(&mut length)?;
    let len = u32::from_le_bytes(length) as usize;
    if len > 1_000_000 {
        return Err(bad());
    }
    let mut config = vec![0; len];
    r.read_exact(&mut config)?;
    let config: Config = serde_json::from_slice(&config).map_err(|_| bad())?;
    if config.roots != expected.roots
        || config.excluded != expected.excluded
        || config.max_entries != expected.max_entries
    {
        return Ok(None);
    }
    let mut number = [0; 8];
    r.read_exact(&mut number)?;
    let updated = u64::from_le_bytes(number);
    r.read_exact(&mut number)?;
    let id = u64::from_le_bytes(number);
    r.read_exact(&mut number)?;
    let count = u64::from_le_bytes(number);
    if count > expected.max_entries.min(10_000_000) as u64 {
        return Err(bad());
    }
    let mut index = Index::default();
    let mut previous = String::new();
    let mut batch = Vec::with_capacity(4096);
    for _ in 0..count {
        get_path(r, &mut previous)?;
        batch.push(get_entry(r, previous.clone())?);
        if batch.len() >= 4096 {
            decode_batch(&mut index, &mut batch)?;
        }
    }
    decode_batch(&mut index, &mut batch)?;
    let mut trailing = [0];
    if r.read(&mut trailing)? != 0 {
        return Err(bad());
    }
    Ok(Some((index, updated, id)))
}
fn checksum(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ *b as u64).wrapping_mul(0x100000001b3)
    })
}
fn packet(changes: &[Change]) -> io::Result<Vec<u8>> {
    let mut data = Vec::new();
    put_var(&mut data, changes.len() as u64)?;
    let mut previous = "";
    for change in changes {
        let (kind, path) = match change {
            Change::Remove(p) => (0, p),
            Change::Put(e) => (1, &e.path),
        };
        data.push(kind);
        put_path(&mut data, path, previous)?;
        if let Change::Put(e) = change {
            put_meta(&mut data, e.directory, e.modified)?;
        }
        previous = path;
    }
    Ok(data)
}
fn unpack(bytes: &[u8]) -> io::Result<Vec<Change>> {
    let mut r = io::Cursor::new(bytes);
    let count = get_var(&mut r)?;
    if count > 10000 {
        return Err(bad());
    }
    let mut previous = String::new();
    let mut changes = Vec::new();
    for _ in 0..count {
        let mut kind = [0];
        r.read_exact(&mut kind)?;
        get_path(&mut r, &mut previous)?;
        changes.push(match kind[0] {
            0 => Change::Remove(previous.clone()),
            1 => Change::Put(get_entry(&mut r, previous.clone())?),
            _ => return Err(bad()),
        });
    }
    if r.position() != bytes.len() as u64 {
        return Err(bad());
    }
    Ok(changes)
}
fn apply(index: &mut Index, changes: Vec<Change>, limit: usize) {
    for change in changes {
        match change {
            Change::Remove(path) => {
                erase(index, &path);
            }
            Change::Put(item) => {
                let k = key(&item.path);
                if index.rows.len() < limit || index.rows.contains_key(&PathKey::lookup(&k)) {
                    let row = restore(item);
                    index.put(row);
                }
            }
        }
    }
}
pub fn load(path: &str, expected: &Config) -> io::Result<Option<(Index, u64, u64)>> {
    let file = File::open(path)?;
    if file.metadata()?.len() > MAX_BYTES {
        return Err(bad());
    }
    let Some((mut index, updated, id)) =
        decode(&mut BufReader::new(file).take(MAX_BYTES), expected)?
    else {
        return Ok(None);
    };
    let journal = format!("{path}.delta");
    if let Ok(mut file) = OpenOptions::new().read(true).write(true).open(&journal) {
        if file.metadata()?.len() > MAX_DELTA {
            return Err(bad());
        }
        let mut head = [0; 16];
        if file.read_exact(&mut head).is_ok()
            && &head[..8] == DELTA
            && u64::from_le_bytes(head[8..].try_into().unwrap()) == id
        {
            let mut valid = 16;
            loop {
                let mut head = [0; 12];
                if file.read_exact(&mut head).is_err() {
                    break;
                }
                let length = u32::from_le_bytes(head[..4].try_into().unwrap()) as usize;
                if length as u64 > MAX_DELTA {
                    break;
                }
                let mut bytes = vec![0; length];
                if file.read_exact(&mut bytes).is_err()
                    || checksum(&bytes) != u64::from_le_bytes(head[4..].try_into().unwrap())
                {
                    break;
                }
                let Ok(changes) = unpack(&bytes) else {
                    break;
                };
                apply(&mut index, changes, expected.max_entries);
                valid = file.stream_position()?;
            }
            // Only complete checksummed transactions survive an interrupted append.
            file.set_len(valid)?;
        } else {
            drop(file);
            fs::remove_file(&journal)?;
        }
    }
    Ok(Some((index, updated, id)))
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetDiskFreeSpaceExW(
        path: *const u16,
        available: *mut u64,
        total: *mut u64,
        free: *mut u64,
    ) -> i32;
}
fn available(path: &Path) -> io::Result<u64> {
    let path: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();
    let mut bytes = 0;
    let result = unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut bytes,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(bytes)
    }
}
fn space(cache: &str, bytes: u64) -> io::Result<()> {
    let parent = Path::new(cache).parent().ok_or_else(bad)?;
    if available(parent)? < bytes + 64 * 1024 * 1024 {
        return Err(io::Error::other(
            "磁盘剩余空间不足，未写入索引缓存；搜索仍可使用",
        ));
    }
    Ok(())
}
fn write_full(s: &Shared) -> io::Result<u64> {
    let config = s.config.lock().unwrap().clone();
    let updated = s.state.lock().unwrap().updated;
    let index = s.index.read().unwrap();
    let config = serde_json::to_vec(&config)?;
    let bytes = encoded_size(&index, &config);
    if bytes > MAX_BYTES {
        return Err(io::Error::other(
            "缓存超过 512 MB，请降低索引项上限；搜索仍可使用",
        ));
    }
    space(&s.cache, bytes)?;
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let temp = Temporary(format!("{}.tmp", s.cache));
    let mut file = BufWriter::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp.0)?,
    );
    encode(&mut file, &index, &config, updated, id)?;
    file.flush()?;
    file.get_ref().sync_all()?;
    drop(file);
    fs::rename(&temp.0, &s.cache)?;
    // A crash before removing the old journal is safe: it carries a different base ID.
    let _ = fs::remove_file(format!("{}.delta", s.cache));
    Ok(id)
}
fn append(s: &Shared, base: u64, data: &[u8]) -> io::Result<()> {
    space(&s.cache, data.len() as u64 + 28)?;
    let path = format!("{}.delta", s.cache);
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    let before = file.metadata()?.len();
    let mut run = || -> io::Result<()> {
        if before == 0 {
            file.write_all(DELTA)?;
            file.write_all(&base.to_le_bytes())?;
        } else {
            let mut head = [0; 16];
            file.read_exact(&mut head)?;
            if &head[..8] != DELTA || u64::from_le_bytes(head[8..].try_into().unwrap()) != base {
                return Err(bad());
            }
        }
        file.seek(io::SeekFrom::End(0))?;
        file.write_all(&(data.len() as u32).to_le_bytes())?;
        file.write_all(&checksum(data).to_le_bytes())?;
        file.write_all(data)?;
        file.sync_all()
    };
    let result = run();
    if result.is_err() {
        let _ = file.set_len(before);
    }
    result
}
fn save(s: &Shared, full: bool, base: u64, changes: &[Change]) -> io::Result<u64> {
    let data = packet(changes)?;
    let delta = fs::metadata(format!("{}.delta", s.cache)).map_or(0, |m| m.len());
    let snapshot = fs::metadata(&s.cache).map_or(0, |m| m.len());
    let threshold = (snapshot / 4).clamp(1024 * 1024, MAX_DELTA);
    if full || base == 0 || snapshot == 0 || delta + data.len() as u64 + 28 > threshold {
        write_full(s)
    } else {
        if !changes.is_empty() {
            append(s, base, &data)?;
        }
        Ok(base)
    }
}
pub fn start(s: Arc<Shared>) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        loop {
            let mut p = s.persistence.pending.lock().unwrap();
            while !p.dirty && !p.stop {
                p = s.persistence.wake.wait(p).unwrap();
            }
            if p.stop && !p.dirty {
                break;
            }
            if !p.stop {
                let until = Instant::now() + Duration::from_secs(2);
                while !p.stop && Instant::now() < until {
                    p = s
                        .persistence
                        .wake
                        .wait_timeout(p, until.saturating_duration_since(Instant::now()))
                        .unwrap()
                        .0;
                }
            }
            drop(p);
            // Drain only after owning the index writer; a snapshot then covers exactly these changes.
            let _writer = s.writer.lock().unwrap();
            let mut p = s.persistence.pending.lock().unwrap();
            let full = p.full;
            let base = p.base;
            let changes = std::mem::take(&mut p.changes);
            p.dirty = false;
            p.full = false;
            let stopping = p.stop;
            drop(p);
            let result = save(&s, full, base, &changes)
                .map(|id| s.persistence.pending.lock().unwrap().base = id);
            let error = result
                .err()
                .map(|e| format!("缓存保存失败：{e}"))
                .unwrap_or_default();
            if !error.is_empty() {
                let mut p = s.persistence.pending.lock().unwrap();
                p.full = true; /* retry on the next change, without a busy loop */
            }
            let changed = {
                let mut state = s.state.lock().unwrap();
                let changed = state.cache_error != error;
                state.cache_error = error;
                changed
            };
            if changed {
                send(&s);
            }
            if stopping {
                break;
            }
        }
        cleanup(&s.cache);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot_rows(config: &Config, rows: impl Iterator<Item = (String, bool, u64)>) -> Vec<u8> {
        let cfg = serde_json::to_vec(config).unwrap();
        let mut bytes = Vec::new();
        encode(&mut bytes, &Index::default(), &cfg, 10, 20).unwrap();
        let mut previous = String::new();
        let mut count = 0u64;
        for (path, directory, modified) in rows {
            put_path(&mut bytes, &path, &previous).unwrap();
            put_meta(&mut bytes, directory, modified).unwrap();
            previous = path;
            count += 1;
        }
        bytes[28 + cfg.len()..36 + cfg.len()].copy_from_slice(&count.to_le_bytes());
        bytes
    }
    #[test]
    fn large_snapshot_preserves_order_spelling_and_metadata() {
        let config = Config {
            max_entries: 140_001,
            ..Config::default()
        };
        // A decoder must also accept snapshots that weren't written in path order.
        let bytes = snapshot_rows(
            &config,
            (0..140_000)
                .rev()
                .map(|n| {
                    (
                        format!("D:\\MixedCase\\文件夹\\Report-{n:06}.txt"),
                        n % 7 == 0,
                        1234 + n,
                    )
                })
                .chain(std::iter::once(("D:\\MixedCase".into(), true, 1234))),
        );
        let (mut index, updated, id) = decode(&mut &bytes[..], &config).unwrap().unwrap();
        assert_eq!((index.rows.len(), updated, id), (140_001, 10, 20));
        for (n, row) in index
            .rows
            .values()
            .filter(|row| row.item.path.display() != "D:\\MixedCase")
            .enumerate()
        {
            assert_eq!(
                row.item.path.display(),
                format!("D:\\MixedCase\\文件夹\\Report-{n:06}.txt")
            );
            assert_eq!(row.item.directory, n % 7 == 0);
            assert_eq!(
                row.item.modified,
                if n % 7 == 0 { 1234 + n as u64 } else { 0 }
            );
        }
        apply(
            &mut index,
            vec![Change::Remove("d:\\mixedcase".into())],
            config.max_entries,
        );
        assert!(
            index.rows.is_empty(),
            "prefix deletion must work on restored trees"
        );
    }
    #[test]
    fn snapshot_rejects_duplicate_normalized_paths() {
        let config = Config {
            max_entries: 100_000,
            ..Config::default()
        };
        for count in [2, 65_537] {
            let rows = (0..count).map(|n| {
                let path = if n == count - 1 {
                    "d:\\mixedcase\\REPORT-000000.txt".into()
                } else {
                    format!("D:\\MixedCase\\Report-{n:06}.txt")
                };
                (path, false, 0)
            });
            let bytes = snapshot_rows(&config, rows);
            assert!(
                decode(&mut &bytes[..], &config).is_err(),
                "duplicate in snapshot of {count} rows"
            );
        }
    }
    #[test]
    fn precise_ownership() {
        let c = "D:\\One\\file-index.bin";
        for p in [
            c.to_string(),
            format!("{c}.tmp"),
            format!("{c}.lock"),
            format!("{c}.delta"),
            format!("{c}.123456.7.tmp"),
        ] {
            assert!(owned(&p, c));
        }
        for p in [
            "D:\\Other\\file-index.bin.tmp",
            "D:\\One\\file-index.bin.backup.tmp",
            "D:\\One\\file-index.bin.123.tmp",
            "D:\\One\\notes.bin",
        ] {
            assert!(!owned(p, c));
        }
    }
    #[test]
    fn journal_compacts_and_recovers() {
        let directory =
            std::env::temp_dir().join(format!("one-cache-test-{}-{}", std::process::id(), now()));
        fs::create_dir(&directory).unwrap();
        let cache = directory.join("index.bin").to_string_lossy().into_owned();
        let config = Config {
            roots: vec!["D:\\bench".into()],
            max_entries: 1000,
            ..Config::default()
        };
        let mut index = Index::default();
        for n in 0..500u64 {
            let path = format!(
                "D:\\bench\\{}-file.txt",
                format!("{:016x}", n.wrapping_mul(0x9e3779b97f4a7c15)).repeat(30)
            );
            let row = Record::new(path, false, 0);
            index.put(row);
        }
        let changes: Vec<_> = index
            .rows
            .values()
            .map(|r| Change::Put(r.item.entry()))
            .collect();
        let s = Shared {
            index: RwLock::new(index),
            launchers: RwLock::new(Index::default()),
            state: Mutex::new(State::default()),
            config: Mutex::new(config.clone()),
            generation: AtomicU64::new(0),
            query: AtomicU64::new(0),
            query_scopes: Mutex::new(BTreeMap::new()),
            writer: Mutex::new(()),
            cache: cache.clone(),
            persistence: Persistence::default(),
            working: AtomicBool::new(false),
        };
        let original = save(&s, true, 0, &[]).unwrap();
        let mut base = original;
        for _ in 0..8 {
            base = save(&s, false, base, &changes).unwrap();
            assert!(fs::metadata(format!("{cache}.delta")).map_or(0, |m| m.len()) <= MAX_DELTA);
        }
        assert_ne!(base, original, "journal must compact into a fresh base");
        assert_eq!(load(&cache, &config).unwrap().unwrap().0.rows.len(), 500);
        let old_packet = packet(&changes).unwrap();
        let next = write_full(&s).unwrap();
        append(&s, base, &old_packet).unwrap();
        let (_, _, loaded) = load(&cache, &config).unwrap().unwrap();
        assert_eq!(next, loaded);
        assert!(
            !Path::new(&format!("{cache}.delta")).exists(),
            "journal from a replaced snapshot must be ignored"
        );
        fs::remove_file(&cache).unwrap();
        fs::remove_dir(directory).unwrap();
    }
    #[test]
    fn compact_roundtrip() {
        let config = Config {
            roots: vec!["D:\\bench".into()],
            max_entries: 100000,
            ..Config::default()
        };
        let mut index = Index::default();
        for n in 0..100000 {
            let p = format!("D:\\bench\\项目-{:03}\\季度报告-{n:06}.pdf", n / 1000);
            let row = Record::new(p.clone(), false, 1);
            index.put(row);
        }
        for p in ["D:\\bench\\文件夹", "\\\\server\\share\\目录"] {
            let mut row = Record::new(p.into(), true, 1);
            row.item.modified = 123456789;
            index.put(row);
        }
        let config = Config {
            max_entries: 100002,
            ..config
        };
        let old = bincode::serialize(&index).unwrap().len();
        let cfg = serde_json::to_vec(&config).unwrap();
        let mut bytes = Vec::new();
        let start = Instant::now();
        encode(&mut bytes, &index, &cfg, 10, 20).unwrap();
        assert_eq!(bytes.len() as u64, encoded_size(&index, &cfg));
        assert!(bytes.len() * 10 < old);
        println!(
            "compact: {} entries, legacy {} bytes, compact {} bytes, encode {} ms",
            index.rows.len(),
            old,
            bytes.len(),
            start.elapsed().as_millis()
        );
        let (decoded, updated, id) = decode(&mut &bytes[..], &config).unwrap().unwrap();
        assert_eq!((updated, id), (10, 20));
        for (k, v) in &index.rows {
            assert_eq!(
                serde_json::to_value(&v.item).unwrap(),
                serde_json::to_value(&decoded.rows[k].item).unwrap()
            );
        }
        assert!(decode(&mut &bytes[..bytes.len() - 1], &config).is_err());
        let changes = vec![
            Change::Remove("D:\\bench\\文件夹".into()),
            Change::Put(
                Record::new("D:\\bench\\新增.txt".into(), false, 0)
                    .item
                    .entry(),
            ),
        ];
        let packet = packet(&changes).unwrap();
        let mut decoded = decoded;
        apply(&mut decoded, unpack(&packet).unwrap(), config.max_entries);
        assert!(
            !decoded
                .rows
                .contains_key(&PathKey::lookup(key("D:\\bench\\文件夹")))
        );
        assert!(
            decoded
                .rows
                .contains_key(&PathKey::lookup(key("D:\\bench\\新增.txt")))
        );
    }
}
