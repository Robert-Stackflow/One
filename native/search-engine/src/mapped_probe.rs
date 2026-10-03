//! Diagnostic immutable disk-index experiment. Not used by the live index,
//! which still owns mutable rows, directory tracking and persistence.
use super::*;
mod overlay;
mod compact;
mod store;
mod import;
use overlay::{Candidate, Overlay};
use std::{
    cmp::Ordering as Order,
    collections::HashMap,
    fs::OpenOptions,
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    ptr::NonNull,
};

const MAGIC: &[u8; 8] = b"ONEMAP03";
// Keep section alignment unchanged from the 64-byte header. A bare 16-byte
// generation extension made mask reads cross cache lines on every row.
const HEADER: usize = 128;
const PARENT: usize = 32;
const ROW: usize = 64;
const MAX_BYTES: u64 = 1024 * 1024 * 1024;
/// Diagnostic commands stay separate from the live mutable service. Returning
/// None lets normal startup continue without opening or migrating any cache.
pub fn command(args: &[String]) -> Option<io::Result<()>> {
    Some(match args.get(1).map(String::as_str)? {
        "mapped-build" => build(args),
        "mapped-query" => serve(args),
        "mapped-store" => store::serve(args),
        "mapped-import" => import::command(args),
        _ => return None,
    })
}
fn generation() -> io::Result<[u8; 16]> {
    let mut value = [0; 16];
    let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), value.as_mut_ptr(), 16, 2) };
    if status < 0 { return Err(io::Error::other(format!("索引版本标识生成失败: {status}"))); }
    Ok(value)
}
fn bad() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Invalid mapped probe image")
}
fn uint(bytes: &[u8], at: usize) -> io::Result<u32> {
    Ok(u32::from_le_bytes(
        bytes.get(at..at + 4).ok_or_else(bad)?.try_into().unwrap(),
    ))
}
fn wide(bytes: &[u8], at: usize) -> io::Result<u64> {
    Ok(u64::from_le_bytes(
        bytes.get(at..at + 8).ok_or_else(bad)?.try_into().unwrap(),
    ))
}
fn put32(bytes: &mut [u8], at: usize, value: u32) {
    bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
}
fn put64(bytes: &mut [u8], at: usize, value: u64) {
    bytes[at..at + 8].copy_from_slice(&value.to_le_bytes());
}
#[derive(Clone, Copy)]
struct Span {
    at: u32,
    len: u32,
}
impl Span {
    fn put(self, bytes: &mut [u8], at: usize) {
        put32(bytes, at, self.at);
        put32(bytes, at + 4, self.len);
    }
}
struct Pool {
    out: BufWriter<File>,
    length: u32,
}
impl Pool {
    fn bytes(&mut self, value: &[u8]) -> io::Result<Span> {
        let len = u32::try_from(value.len()).map_err(|_| bad())?;
        let at = self.length;
        self.length = at.checked_add(len).ok_or_else(bad)?;
        self.out.write_all(value)?;
        Ok(Span { at, len })
    }
    fn text(&mut self, value: &str) -> io::Result<Span> {
        self.bytes(value.as_bytes())
    }
}
struct Temps(Vec<std::path::PathBuf>);
impl Drop for Temps {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = fs::remove_file(path);
        }
    }
}
fn image(index: &Index, target: &Path) -> io::Result<()> {
    // create_new and a PID suffix prevent overwriting unrelated temporary files.
    let mut temps = Temps(Vec::new());
    let mut section = |suffix: &str| -> io::Result<File> {
        let name = target.with_extension(format!("{}.{}.tmp", std::process::id(), suffix));
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&name)?;
        temps.0.push(name);
        Ok(file)
    };
    let mut parents = BufWriter::new(section("parents")?);
    let mut rows = BufWriter::new(section("rows")?);
    let mut phonetic_pool = Pool {
        out: BufWriter::new(section("phonetics")?),
        length: 0,
    };
    let mut pool = Pool {
        out: BufWriter::new(section("data")?),
        length: 0,
    };
    let mut intern = HashMap::<String, u32>::new();
    for row in index.rows.values() {
        let path = row.item.path.key();
        let display = row.item.path.display();
        let split = if path.prefix().is_empty() {
            0
        } else {
            display
                .trim_end_matches(['\\', '/'])
                .rfind(['\\', '/'])
                .map_or(0, |at| at + 1)
        };
        let (display_prefix, display_name) = display.split_at(split);
        if key(display_prefix).trim_end_matches('\\') != path.prefix().trim_end_matches('\\') {
            return Err(bad());
        }
        let parent = if let Some(id) = intern.get(display_prefix) {
            *id
        } else {
            let id = u32::try_from(intern.len()).map_err(|_| bad())?;
            let normalized = pool.text(path.prefix())?;
            let exact = if display_prefix == path.prefix() {
                normalized
            } else {
                pool.text(display_prefix)?
            };
            let mut bytes = [0; PARENT];
            normalized.put(&mut bytes, 0);
            exact.put(&mut bytes, 8);
            put64(&mut bytes, 16, path.prefix_bits() as u64);
            put64(&mut bytes, 24, (path.prefix_bits() >> 64) as u64);
            parents.write_all(&bytes)?;
            intern.insert(display_prefix.to_owned(), id);
            id
        };
        let name = pool.text(path.name())?;
        let lower = if row.lower() == path.name() {
            name
        } else {
            pool.text(row.lower())?
        };
        let exact = if display_name == path.name() {
            name
        } else {
            pool.text(display_name)?
        };
        let mut phonetics = Vec::new();
        for text in row.phonetic() {
            let mut bytes = [0; 8];
            pool.text(text)?.put(&mut bytes, 0);
            phonetics.extend_from_slice(&bytes);
        }
        let table = phonetic_pool.bytes(&phonetics)?;
        let mut bytes = [0; ROW];
        put32(&mut bytes, 0, parent);
        name.put(&mut bytes, 4);
        lower.put(&mut bytes, 12);
        exact.put(&mut bytes, 20);
        put32(&mut bytes, 28, table.at);
        put32(&mut bytes, 32, table.len / 8);
        put64(&mut bytes, 36, row.bits.value() as u64);
        put64(&mut bytes, 44, (row.bits.value() >> 64) as u64);
        put64(&mut bytes, 52, row.item.modified());
        put32(
            &mut bytes,
            60,
            row.item.directory() as u32 | ((row.plain_name() as u32) << 1),
        );
        rows.write_all(&bytes)?;
    }
    parents.flush()?;
    rows.flush()?;
    pool.out.flush()?;
    phonetic_pool.out.flush()?;
    drop(parents);
    drop(rows);
    drop(pool.out);
    drop(phonetic_pool.out);
    let parent_at = HEADER as u64;
    let row_at = parent_at + intern.len() as u64 * PARENT as u64;
    let data_at = row_at + index.rows.len() as u64 * ROW as u64;
    let text_at = data_at + phonetic_pool.length as u64;
    let total = text_at + pool.length as u64;
    if total > MAX_BYTES {
        return Err(bad());
    }
    let final_file = section("image")?;
    let final_name = temps.0.last().unwrap().clone();
    let mut out = BufWriter::new(final_file);
    let mut header = [0; HEADER];
    header[..8].copy_from_slice(MAGIC);
    // A generation identity prevents row-ID deltas from attaching to another
    // base with the same length/count. No full image scan is needed at startup.
    header[64..80].copy_from_slice(&generation()?);
    for (at, value) in [
        (8, intern.len() as u64),
        (16, index.rows.len() as u64),
        (24, parent_at),
        (32, row_at),
        (40, data_at),
        (48, total),
        (56, text_at),
    ] {
        put64(&mut header, at, value);
    }
    out.write_all(&header)?;
    for path in &temps.0[..4] {
        io::copy(&mut File::open(path)?, &mut out)?;
    }
    out.flush()?;
    out.get_ref().sync_all()?;
    drop(out);
    fs::rename(final_name, target)?;
    Ok(())
}
pub fn build(args: &[String]) -> io::Result<()> {
    let cache = args.get(2).ok_or_else(bad)?;
    let target = Path::new(args.get(3).ok_or_else(bad)?);
    let config: Config =
        serde_json::from_reader(File::open(args.get(4).ok_or_else(bad)?)?).map_err(|_| bad())?;
    let start = Instant::now();
    let _lock = cache::acquire(cache)?;
    let (index, _, _) = cache::load(cache, &config)?.ok_or_else(bad)?;
    image(&index, target)?;
    output(
        json!({"count":index.rows.len(),"bytes":fs::metadata(target)?.len(),"buildMs":start.elapsed().as_secs_f64()*1000.0}),
    );
    Ok(())
}

#[link(name = "bcrypt")]
unsafe extern "system" {
    fn BCryptGenRandom(algorithm: *mut std::ffi::c_void, buffer: *mut u8, bytes: u32, flags: u32) -> i32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateFileMappingW(
        file: *mut std::ffi::c_void,
        security: *const std::ffi::c_void,
        protect: u32,
        high: u32,
        low: u32,
        name: *const u16,
    ) -> *mut std::ffi::c_void;
    fn MapViewOfFile(
        mapping: *mut std::ffi::c_void,
        access: u32,
        high: u32,
        low: u32,
        length: usize,
    ) -> *mut std::ffi::c_void;
    fn UnmapViewOfFile(base: *const std::ffi::c_void) -> i32;
    fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
}
struct Mapping {
    _file: File,
    handle: *mut std::ffi::c_void,
    base: NonNull<u8>,
    len: usize,
}
impl Mapping {
    fn open(path: &Path) -> io::Result<Self> {
        // Share reads only: no writer can truncate or alter the mapped image.
        let file = OpenOptions::new().read(true).share_mode(1).open(path)?;
        let len = file.metadata()?.len();
        if !(HEADER as u64..=MAX_BYTES).contains(&len) {
            return Err(bad());
        }
        // The handle belongs to this object until after its view is unmapped.
        let handle = unsafe {
            CreateFileMappingW(
                file.as_raw_handle(),
                std::ptr::null(),
                2,
                0,
                0,
                std::ptr::null(),
            )
        };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let base = unsafe { MapViewOfFile(handle, 4, 0, 0, len as usize) };
        let Some(base) = NonNull::new(base.cast::<u8>()) else {
            let error = io::Error::last_os_error();
            unsafe { CloseHandle(handle) };
            return Err(error);
        };
        Ok(Self {
            _file: file,
            handle,
            base,
            len: len as usize,
        })
    }
    fn bytes(&self) -> &[u8] {
        // A successful read-only view covers len bytes; the file denies writes.
        // The slice borrows self and cannot survive UnmapViewOfFile in Drop.
        unsafe { std::slice::from_raw_parts(self.base.as_ptr(), self.len) }
    }
}
impl Drop for Mapping {
    fn drop(&mut self) {
        unsafe {
            UnmapViewOfFile(self.base.as_ptr().cast());
            CloseHandle(self.handle);
        }
    }
}
struct View<'a> {
    generation: [u8; 16],
    parents: &'a [u8],
    rows: &'a [u8],
    phonetics: &'a [u8],
    data: TextView<'a>,
}
#[derive(Clone, Copy)]
struct TextView<'a> {
    bytes: &'a [u8],
    checked: Option<&'a str>,
}
impl<'a> TextView<'a> {
    fn text(&self, bytes: &[u8], at: usize) -> io::Result<&'a str> {
        let start = uint(bytes, at)? as usize;
        let length = uint(bytes, at + 4)? as usize;
        let end = start.checked_add(length).ok_or_else(bad)?;
        if let Some(text) = self.checked {
            text.get(start..end).ok_or_else(bad)
        } else {
            std::str::from_utf8(self.bytes.get(start..end).ok_or_else(bad)?).map_err(|_| bad())
        }
    }
}
impl<'a> View<'a> {
    fn new(bytes: &'a [u8]) -> io::Result<Self> {
        if bytes.get(..8) != Some(MAGIC) {
            return Err(bad());
        }
        let parents = wide(bytes, 8)?;
        let rows = wide(bytes, 16)?;
        let row_at = (HEADER as u64)
            .checked_add(parents.checked_mul(PARENT as u64).ok_or_else(bad)?)
            .ok_or_else(bad)?;
        let data_at = row_at
            .checked_add(rows.checked_mul(ROW as u64).ok_or_else(bad)?)
            .ok_or_else(bad)?;
        let text_at = wide(bytes, 56)?;
        if wide(bytes, 24)? != HEADER as u64
            || wide(bytes, 32)? != row_at
            || wide(bytes, 40)? != data_at
            || wide(bytes, 48)? != bytes.len() as u64
            || text_at < data_at
            || text_at > bytes.len() as u64
            || (text_at - data_at) % 8 != 0
        {
            return Err(bad());
        }
        Ok(Self {
            generation: bytes.get(64..80).ok_or_else(bad)?.try_into().map_err(|_| bad())?,
            parents: &bytes[HEADER..row_at as usize],
            rows: &bytes[row_at as usize..data_at as usize],
            phonetics: &bytes[data_at as usize..text_at as usize],
            data: TextView {
                bytes: &bytes[text_at as usize..],
                checked: None,
            },
        })
    }
    fn text(&self, bytes: &[u8], at: usize) -> io::Result<&'a str> {
        self.data.text(bytes, at)
    }
    fn validate(&mut self) -> io::Result<()> {
        // Local results only decode their own strings. Validate the complete
        // text pool once before global scan; str::get then checks each boundary
        // without re-reading whole shared prefixes or pinyin strings.
        self.data.checked = Some(std::str::from_utf8(self.data.bytes).map_err(|_| bad())?);
        Ok(())
    }
    fn row(&self, id: usize) -> io::Result<MappedRow<'a>> {
        let start = id.checked_mul(ROW).ok_or_else(bad)?;
        let bytes = self.rows.get(start..start + ROW).ok_or_else(bad)?;
        let start = (uint(bytes, 0)? as usize)
            .checked_mul(PARENT)
            .ok_or_else(bad)?;
        let parent = self.parents.get(start..start + PARENT).ok_or_else(bad)?;
        let count = uint(bytes, 32)? as usize;
        let at = uint(bytes, 28)? as usize;
        let table = self
            .phonetics
            .get(
                at..at
                    .checked_add(count.checked_mul(8).ok_or_else(bad)?)
                    .ok_or_else(bad)?,
            )
            .ok_or_else(bad)?;
        if count > 32 {
            return Err(bad());
        }
        for span in table.chunks_exact(8) {
            self.text(span, 0)?;
        }
        let flags = uint(bytes, 60)?;
        if flags > 3 {
            return Err(bad());
        }
        Ok(MappedRow {
            path: Fragments {
                prefix: self.text(parent, 0)?,
                name: self.text(bytes, 4)?,
                bits: wide(parent, 16)? as u128 | ((wide(parent, 24)? as u128) << 64),
            },
            lower: self.text(bytes, 12)?,
            exact_prefix: self.text(parent, 8)?,
            exact_name: self.text(bytes, 20)?,
            phonetics: PhoneticTable {
                entries: table,
                pool: self.data,
            },
            bits: wide(bytes, 36)? as u128 | ((wide(bytes, 44)? as u128) << 64),
            modified: wide(bytes, 52)?,
            flags,
        })
    }
    fn path(&self, id: usize) -> io::Result<Fragments<'a>> {
        let start = id.checked_mul(ROW).ok_or_else(bad)?;
        let bytes = self.rows.get(start..start + ROW).ok_or_else(bad)?;
        let start = (uint(bytes, 0)? as usize).checked_mul(PARENT).ok_or_else(bad)?;
        let parent = self.parents.get(start..start + PARENT).ok_or_else(bad)?;
        Ok(Fragments { prefix:self.text(parent, 0)?, name:self.text(bytes, 4)?, bits:wide(parent, 16)? as u128 | ((wide(parent, 24)? as u128) << 64) })
    }
    fn count(&self) -> usize {
        self.rows.len() / ROW
    }
    fn possible(&self, id: usize, kind: &str, terms: &[Term], fuzzy: bool) -> io::Result<bool> {
        let start = id.checked_mul(ROW).ok_or_else(bad)?;
        let bytes = self.rows.get(start..start + ROW).ok_or_else(bad)?;
        let flags = uint(bytes, 60)?;
        if flags > 3 {
            return Err(bad());
        }
        let directory = flags & 1 != 0;
        if kind == "folder" && !directory || !kind.is_empty() && kind != "folder" && directory {
            return Ok(false);
        }
        if flags & 2 == 0 {
            return Ok(true);
        }
        let start = (uint(bytes, 0)? as usize)
            .checked_mul(PARENT)
            .ok_or_else(bad)?;
        let parent = self.parents.get(start..start + PARENT).ok_or_else(bad)?;
        let bits = wide(bytes, 36)? as u128 | ((wide(bytes, 44)? as u128) << 64);
        let prefix = wide(parent, 16)? as u128 | ((wide(parent, 24)? as u128) << 64);
        // Share the production rejection rule; rejected rows never decode their
        // strings or allocate pinyin vectors. This saves both page reads and CPU.
        Ok(!impossible_mask(bits, prefix, terms, fuzzy))
    }
    fn lower_bound(&self, text: &str) -> io::Result<usize> {
        let key = Fragments {
            prefix: "",
            name: text,
            bits: 0,
        };
        self.lower_bound_path(key)
    }
    fn lower_bound_path(&self, key: Fragments<'_>) -> io::Result<usize> {
        let (mut low, mut high) = (0, self.count());
        while low < high {
            let mid = low + (high - low) / 2;
            if self.path(mid)? < key {
                low = mid + 1
            } else {
                high = mid
            }
        }
        Ok(low)
    }
}
#[derive(Clone, Copy)]
struct Fragments<'a> {
    prefix: &'a str,
    name: &'a str,
    bits: u128,
}
impl<'a> Fragments<'a> {
    fn from_key(path: &'a PathKey) -> Self { Self { prefix:path.prefix(), name:path.name(), bits:path.prefix_bits() } }
    fn equal_text(&self, text: &str) -> bool { self.prefix.len() + self.name.len() == text.len() && self.starts_with(text) }
}
impl SearchPath for Fragments<'_> {
    fn prefix(&self) -> &str {
        self.prefix
    }
    fn name(&self) -> &str {
        self.name
    }
    fn prefix_bits(&self) -> u128 {
        self.bits
    }
    fn starts_with(&self, text: &str) -> bool {
        if text.len() <= self.prefix.len() {
            self.prefix.starts_with(text)
        } else {
            text.starts_with(self.prefix) && self.name.starts_with(&text[self.prefix.len()..])
        }
    }
    fn under(&self, root: &str) -> bool {
        if !self.starts_with(root) {
            return false;
        }
        if self.prefix.len() + self.name.len() == root.len() {
            return true;
        }
        let next = if root.len() < self.prefix.len() {
            self.prefix.as_bytes().get(root.len())
        } else {
            self.name.as_bytes().get(root.len() - self.prefix.len())
        };
        next == Some(&b'\\')
    }
    fn contains_parent(&self, text: &str) -> bool {
        self.prefix.contains(text)
            || text.rfind('\\').is_some_and(|split| {
                self.prefix.ends_with(&text[..=split]) && self.name.starts_with(&text[split + 1..])
            })
    }
    fn contains(&self, text: &str) -> bool {
        self.name.contains(text) || self.contains_parent(text)
    }
}
impl Ord for Fragments<'_> {
    fn cmp(&self, other: &Self) -> Order {
        if std::ptr::eq(self.prefix, other.prefix) {
            return self.name.cmp(other.name);
        }
        self.prefix
            .bytes()
            .chain(self.name.bytes())
            .cmp(other.prefix.bytes().chain(other.name.bytes()))
    }
}
impl PartialOrd for Fragments<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<Order> {
        Some(self.cmp(other))
    }
}
impl PartialEq for Fragments<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Order::Equal
    }
}
impl Eq for Fragments<'_> {}
struct PhoneticTable<'a> {
    entries: &'a [u8],
    pool: TextView<'a>,
}
impl PhoneticTable<'_> {
    fn iter(&self) -> impl Iterator<Item = &str> {
        self.entries.chunks_exact(8).map(|span| {
            // View::row checked every span against this immutable text pool.
            self.pool.text(span, 0).unwrap()
        })
    }
}
struct MappedRow<'a> {
    path: Fragments<'a>,
    lower: &'a str,
    exact_prefix: &'a str,
    exact_name: &'a str,
    phonetics: PhoneticTable<'a>,
    bits: u128,
    modified: u64,
    flags: u32,
}
impl SearchRow for MappedRow<'_> {
    fn directory(&self) -> bool {
        self.flags & 1 != 0
    }
    fn lower(&self) -> &str {
        self.lower
    }
    fn bits(&self) -> u128 {
        self.bits
    }
    fn phonetic(&self) -> impl Iterator<Item = &str> {
        self.phonetics.iter()
    }
    fn plain_name(&self) -> bool {
        self.flags & 2 != 0
    }
    fn launcher_matches(&self, _: &str) -> Option<bool> {
        None
    }
}
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Source<'a> { Base(usize), Extra(&'a PathKey) }
type Matches<'a> = BinaryHeap<Reverse<(bool, i8, i32, Fragments<'a>, Source<'a>, &'static str)>>;
fn items(heap: &Matches<'_>, view: &View<'_>, overlay: &Overlay) -> io::Result<Vec<Value>> {
    let mut best = heap.iter().map(|r| &r.0).collect::<Vec<_>>();
    best.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then(b.1.cmp(&a.1))
            .then(b.2.cmp(&a.2))
            .then(a.3.cmp(&b.3))
    });
    best.iter().map(|r|{
        let mut item = match r.4 {
            Source::Base(id) => {
                let row=view.row(id)?;let path=format!("{}{}",row.exact_prefix,row.exact_name);
                let name=Path::new(&path).file_name().and_then(|s|s.to_str()).unwrap_or(&path);
                json!({"path":path,"name":name,"directory":row.directory(),"modified":if row.directory(){row.modified/1_000_000}else{0},"size":0})
            }
            Source::Extra(path) => {
                let row = overlay.get(path);
                let mut item = serde_json::to_value(&row.item).map_err(|_| bad())?;
                if row.item.directory() { item["modified"] = json!(row.item.modified()/1_000_000); }
                item
            }
        };
        item["matchKind"] = json!(r.5);
        Ok(item)
    }).collect()
}
struct SearchPass<'a, 'q> {
    heap: Matches<'a>,
    total: usize,
    local_total: usize,
    prefix: &'q str,
    kind: &'q str,
    exts: &'q [String],
    matcher: QueryMatcher<'q>,
    rules: priority::Rules,
}
impl<'a> SearchPass<'a, '_> {
    #[inline(always)]
    fn visit(&mut self, row: &impl SearchRow, path: Fragments<'a>, source: Source<'a>, skip_local: bool) {
        if !accepts(row, self.kind, self.exts) { return; }
        let Some((points, mode)) = self.matcher.score(row, &path) else { return; };
        let local = !self.prefix.is_empty() && path.starts_with(self.prefix);
        if skip_local && local { return; }
        self.total += 1;
        if local { self.local_total += 1; }
        let rank = self.rules.rank(&path);
        if self.heap.len() < 100 || self.heap.peek().is_some_and(|r| (local, rank, points) > (r.0.0, r.0.1, r.0.2)) {
            self.heap.push(Reverse((local, rank, points, path, source, mode)));
            if self.heap.len() > 100 { self.heap.pop(); }
        }
    }
    #[inline(always)]
    fn candidate(&mut self, view: &View<'a>, candidate: Candidate<'a>, skip_local: bool) -> io::Result<()> {
        match candidate {
            Candidate::Base(id) => {
                let row = view.row(id)?;
                self.visit(&row, row.path, Source::Base(id), skip_local);
            }
            Candidate::Extra(path, row) => self.visit(row, Fragments::from_key(path), Source::Extra(path), skip_local),
        }
        Ok(())
    }
}
#[inline(always)]
fn possible_candidate(view: &View<'_>, candidate: &Candidate<'_>, kind: &str, terms: &[Term], fuzzy: bool) -> io::Result<bool> {
    match candidate {
        Candidate::Base(id) => view.possible(*id,kind,terms,fuzzy),
        Candidate::Extra(_,_) => Ok(true),
    }
}
#[derive(Default)]
struct Gate {
    scopes: Mutex<BTreeMap<u64, u64>>,
    serial: AtomicU64,
    stopped: AtomicBool,
}
impl Gate {
    fn current(&self, v: &Value, ticket: u64) -> bool {
        !self.stopped.load(Ordering::Relaxed)
            && self
                .scopes
                .lock()
                .unwrap()
                .get(&v["scope"].as_u64().unwrap_or(0))
                .copied()
                == Some(ticket)
    }
    fn enqueue(&self, v: &Value) -> u64 {
        let ticket = self.serial.fetch_add(1, Ordering::Relaxed) + 1;
        self.scopes
            .lock()
            .unwrap()
            .insert(v["scope"].as_u64().unwrap_or(0), ticket);
        ticket
    }
}
fn cancelled() -> Value {
    json!({"items":[],"total":0,"elapsed":0,"cancelled":true})
}
fn query_image(path: &Path, v: &Value, gate: &Gate, ticket: u64, overlay: &Overlay) -> io::Result<Value> {
    if !gate.current(v, ticket) { return Ok(cancelled()); }
    if v["query"].as_str().unwrap_or("").len() > 4000 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "搜索条件过长"));
    }
    let start = Instant::now();
    let map = Mapping::open(path)?;
    let mut view = View::new(map.bytes())?;
    overlay.check(&view)?;
    let (kind, exts, terms) = parse(v["query"].as_str().unwrap_or(""), v["foldersOnly"].as_bool().unwrap_or(false));
    let fuzzy = v["fuzzy"].as_bool().unwrap_or(true);
    let pinyin = v["pinyin"].as_bool().unwrap_or(true);
    let current = key(v["currentFolder"].as_str().unwrap_or(""));
    let prefix = if current.is_empty() { String::new() } else { format!("{current}\\") };
    let upper = format!("{current}]");
    let progressive = v["progressive"].as_bool().unwrap_or(false) && !prefix.is_empty() && !matches!(kind.as_str(), "app" | "setting");
    let mut pass = SearchPass {
        heap:Matches::new(), total:0, local_total:0, prefix:&prefix, kind:&kind, exts:&exts,
        matcher:QueryMatcher::new(&terms, fuzzy, pinyin),
        rules:priority::Rules::new(&serde_json::from_value::<Vec<priority::Rule>>(v["priorities"].clone()).unwrap_or_default()),
    };
    // Merge the same ordered stream for local and global passes. Appending
    // changes after the base would alter which equal-score rows reach top 100.
    if progressive {
        let range = view.lower_bound(&prefix)?..view.lower_bound(&upper)?;
        if overlay.is_empty() {
            for (n,id) in range.enumerate() {
                if n % 1024 == 0 && !gate.current(v,ticket) { return Ok(cancelled()); }
                if !view.possible(id,&kind,&terms,fuzzy)? { continue; }
                pass.candidate(&view,Candidate::Base(id),false)?;
            }
        } else {
            for (n, candidate) in overlay.iter(&view, range, Some((&prefix, &upper))).enumerate() {
                if n % 1024 == 0 && !gate.current(v, ticket) { return Ok(cancelled()); }
                let candidate=candidate?;
                if !possible_candidate(&view,&candidate,&kind,&terms,fuzzy)? { continue; }
                pass.candidate(&view, candidate, false)?;
            }
        }
        if !gate.current(v, ticket) { return Ok(cancelled()); }
        output(json!({"id":v["id"],"result":{"items":items(&pass.heap,&view,overlay)?,"total":pass.total,"localTotal":pass.local_total,"elapsed":start.elapsed().as_secs_f64()*1000.0,"partial":true}}));
    }
    view.validate()?;
    if !matches!(kind.as_str(), "app" | "setting") {
        if overlay.is_empty() {
            for id in 0..view.count() {
                if id % 1024 == 0 && !gate.current(v,ticket) { return Ok(cancelled()); }
                if !view.possible(id,&kind,&terms,fuzzy)? { continue; }
                pass.candidate(&view,Candidate::Base(id),progressive)?;
            }
        } else {
            for (n, candidate) in overlay.iter(&view, 0..view.count(), None).enumerate() {
                if n % 1024 == 0 && !gate.current(v, ticket) { return Ok(cancelled()); }
                let candidate=candidate?;
                if !possible_candidate(&view,&candidate,&kind,&terms,fuzzy)? { continue; }
                pass.candidate(&view, candidate, progressive)?;
            }
        }
    }
    if !gate.current(v, ticket) { return Ok(cancelled()); }
    let result = json!({"items":items(&pass.heap,&view,overlay)?,"total":pass.total,"localTotal":pass.local_total,"elapsed":start.elapsed().as_secs_f64()*1000.0});
    drop(pass);
    drop(map);
    Ok(result)
}
pub fn serve(args: &[String]) -> io::Result<()> {
    let path = Path::new(args.get(2).ok_or_else(bad)?);
    let journal = args.get(3).map(std::path::PathBuf::from);
    let journal_lock = journal.as_ref().map(|path| cache::acquire(&path.to_string_lossy())).transpose()?;
    let initial_overlay = {
        let map = Mapping::open(path)?;
        let view = View::new(map.bytes())?;
        let overlay = Overlay::load(&view, journal.as_deref())?;
        output(json!({"ready":true,"count":overlay.count(&view)}));
        overlay
    };
    let gate = Arc::new(Gate::default());
    let (tx, rx) = std::sync::mpsc::channel::<(Value, u64)>();
    let worker_gate = gate.clone();
    let worker_path = path.to_path_buf();
    // Stdin stays responsive while the worker maps or searches. The mapping is
    // constructed and dropped in this worker; raw mapping handles never cross
    // threads. Tickets isolate independent search windows.
    let worker = thread::spawn(move || {
        let _journal_lock = journal_lock;
        let mut overlay = initial_overlay;
        for (v, ticket) in rx {
            let result = if v["type"] == "apply" {
                (|| {
                    let changes = serde_json::from_value(v["changes"].clone()).map_err(|_| bad())?;
                    let map = Mapping::open(&worker_path)?;
                    let view = View::new(map.bytes())?;
                    let limit = v["maxEntries"].as_u64().unwrap_or(10_000_000).min(10_000_000) as usize;
                    let next = overlay.stage(&view, changes, limit)?;
                    if let Some(path) = &journal { next.save(path)?; }
                    overlay = next;
                    Ok(overlay.stats(&view))
                })()
            } else { query_image(&worker_path, &v, &worker_gate, ticket, &overlay) };
            match result {
                Ok(result) => output(json!({"id":v["id"],"result":result})),
                Err(e) => output(json!({"id":v["id"],"error":e.to_string()})),
            }
        }
    });
    for line in io::stdin().lock().lines() {
        let line = line?;
        if line.len() > 1_000_000 {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match v["type"].as_str().unwrap_or("") {
            "query" => {
                let ticket = gate.enqueue(&v);
                let _ = tx.send((v, ticket));
            }
            "apply" => { let _ = tx.send((v, 0)); }
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
    gate.stopped.store(true, Ordering::Relaxed);
    drop(tx);
    worker
        .join()
        .map_err(|_| io::Error::other("Mapped query worker stopped unexpectedly"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_matches_heap_semantics() {
        let dir = std::env::temp_dir().join(format!("one-map-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("probe.bin");
        let mut index = Index::default();
        for path in [
            "D:\\",
            "D:\\folder\\report.txt",
            "D:\\folder\\",
            "D:\\Folder\\季度报告.PDF",
            "D:\\İstanbul\\File.txt",
            "D:/Mixed/Folder/Σ.TXT",
            "\\\\Server\\Share\\文档.txt",
            "D:\\folder\\🙂.txt",
        ] {
            index.put(Record::new(path.into(), path.ends_with('\\'), 1));
        }
        image(&index, &file).unwrap();
        let map = Mapping::open(&file).unwrap();
        let view = View::new(map.bytes()).unwrap();
        assert_eq!(view.count(), index.rows.len());
        for ((path, row), id) in index.rows.iter().zip(0..) {
            let disk = view.row(id).unwrap();
            assert_eq!(
                format!("{}{}", disk.path.prefix, disk.path.name),
                path.normalized()
            );
            assert_eq!(
                format!("{}{}", disk.exact_prefix, disk.exact_name),
                row.item.path.display()
            );
            for query in [
                "report",
                "reprot",
                "rpt",
                "jdbg",
                "jidubaogao",
                "folder/report",
                "İstanbul",
                "Σ",
                "🙂",
                "\"D:\\\"",
                "ext:pdf 季度",
            ] {
                let (kind, exts, terms) = parse(query, false);
                for (fuzzy, pinyin) in [(false, false), (true, false), (false, true), (true, true)]
                {
                    assert_eq!(accepts(&disk, &kind, &exts), accepts(row, &kind, &exts));
                    assert_eq!(
                        score(&disk, &disk.path, &terms, fuzzy, pinyin),
                        score(row, path, &terms, fuzzy, pinyin),
                        "{path} / {query}"
                    );
                    if !view.possible(id, &kind, &terms, fuzzy).unwrap() {
                        assert!(
                            !accepts(row, &kind, &exts)
                                || score(row, path, &terms, fuzzy, pinyin).is_none()
                        );
                    }
                }
            }
        }
        let data = map.bytes().to_vec();
        assert!(
            OpenOptions::new().write(true).open(&file).is_err(),
            "Mapped image must deny concurrent writes"
        );
        drop(map);
        assert!(View::new(&data[..63]).is_err());
        let mut corrupt = data.clone();
        put64(&mut corrupt, 8, u64::MAX);
        assert!(View::new(&corrupt).is_err());
        let view = View::new(&data).unwrap();
        assert!(view.row(view.count()).is_err());
        let mut corrupt = data.clone();
        let rows = wide(&corrupt, 32).unwrap() as usize;
        put32(&mut corrupt, rows, u32::MAX);
        assert!(View::new(&corrupt).unwrap().row(0).is_err());
        let mut corrupt = data.clone();
        put32(&mut corrupt, rows + 32, u32::MAX);
        assert!(View::new(&corrupt).unwrap().row(0).is_err());
        let mut corrupt = data.clone();
        let pool = wide(&corrupt, 56).unwrap() as usize;
        let name = uint(&corrupt, rows + 4).unwrap() as usize;
        corrupt[pool + name] = 0xff;
        assert!(View::new(&corrupt).unwrap().row(0).is_err());
        assert!(View::new(&corrupt).unwrap().validate().is_err());
        fs::remove_file(file).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
