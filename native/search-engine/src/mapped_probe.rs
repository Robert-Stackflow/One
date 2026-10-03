//! Diagnostic immutable disk-index experiment. Not used by the live index,
//! which still owns mutable rows, directory tracking and persistence.
use super::*;
use std::{
    cmp::Ordering as Order,
    collections::HashMap,
    fs::OpenOptions,
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    ptr::NonNull,
};

const MAGIC: &[u8; 8] = b"ONEMAP01";
const HEADER: usize = 64;
const PARENT: usize = 32;
const ROW: usize = 64;
const MAX_BYTES: u64 = 1024 * 1024 * 1024;
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
            display.trim_end_matches(['\\', '/']).rfind(['\\', '/']).map_or(0, |at| at + 1)
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
        let table = pool.bytes(&phonetics)?;
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
    drop(parents);
    drop(rows);
    drop(pool.out);
    let parent_at = HEADER as u64;
    let row_at = parent_at + intern.len() as u64 * PARENT as u64;
    let data_at = row_at + index.rows.len() as u64 * ROW as u64;
    let total = data_at + pool.length as u64;
    if total > MAX_BYTES {
        return Err(bad());
    }
    let final_file = section("image")?;
    let final_name = temps.0.last().unwrap().clone();
    let mut out = BufWriter::new(final_file);
    let mut header = [0; HEADER];
    header[..8].copy_from_slice(MAGIC);
    for (at, value) in [
        (8, intern.len() as u64),
        (16, index.rows.len() as u64),
        (24, parent_at),
        (32, row_at),
        (40, data_at),
        (48, total),
    ] {
        put64(&mut header, at, value);
    }
    out.write_all(&header)?;
    for path in &temps.0[..3] {
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
    parents: &'a [u8],
    rows: &'a [u8],
    data: &'a [u8],
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
        if wide(bytes, 24)? != HEADER as u64
            || wide(bytes, 32)? != row_at
            || wide(bytes, 40)? != data_at
            || wide(bytes, 48)? != bytes.len() as u64
            || wide(bytes, 56)? != 0
            || data_at > bytes.len() as u64
        {
            return Err(bad());
        }
        Ok(Self {
            parents: &bytes[HEADER..row_at as usize],
            rows: &bytes[row_at as usize..data_at as usize],
            data: &bytes[data_at as usize..],
        })
    }
    fn text(&self, bytes: &[u8], at: usize) -> io::Result<&'a str> {
        let start = uint(bytes, at)? as usize;
        let len = uint(bytes, at + 4)? as usize;
        std::str::from_utf8(
            self.data
                .get(start..start.checked_add(len).ok_or_else(bad)?)
                .ok_or_else(bad)?,
        )
        .map_err(|_| bad())
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
            .data
            .get(
                at..at
                    .checked_add(count.checked_mul(8).ok_or_else(bad)?)
                    .ok_or_else(bad)?,
            )
            .ok_or_else(bad)?;
        if count > 32 {
            return Err(bad());
        }
        let mut phonetics = Vec::with_capacity(count);
        for span in table.chunks_exact(8) {
            phonetics.push(self.text(span, 0)?);
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
            phonetics,
            bits: wide(bytes, 36)? as u128 | ((wide(bytes, 44)? as u128) << 64),
            modified: wide(bytes, 52)?,
            flags,
        })
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
        let (mut low, mut high) = (0, self.count());
        while low < high {
            let mid = low + (high - low) / 2;
            if self.row(mid)?.path < key {
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
struct MappedRow<'a> {
    path: Fragments<'a>,
    lower: &'a str,
    exact_prefix: &'a str,
    exact_name: &'a str,
    phonetics: Vec<&'a str>,
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
        self.phonetics.iter().copied()
    }
    fn plain_name(&self) -> bool {
        self.flags & 2 != 0
    }
    fn launcher_matches(&self, _: &str) -> Option<bool> {
        None
    }
}
type Matches<'a> = BinaryHeap<Reverse<(bool, i8, i32, Fragments<'a>, usize, &'static str)>>;
fn items(heap: &Matches<'_>, view: &View<'_>) -> io::Result<Vec<Value>> {
    let mut best = heap.iter().map(|r| &r.0).collect::<Vec<_>>();
    best.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then(b.1.cmp(&a.1))
            .then(b.2.cmp(&a.2))
            .then(a.3.cmp(&b.3))
    });
    best.iter().map(|r|{
        let row=view.row(r.4)?;let path=format!("{}{}",row.exact_prefix,row.exact_name);
        let name=Path::new(&path).file_name().and_then(|s|s.to_str()).unwrap_or(&path);
        Ok(json!({"path":path,"name":name,"directory":row.directory(),"modified":if row.directory(){row.modified/1_000_000}else{0},"size":0,"matchKind":r.5}))
    }).collect()
}
fn query_image(path: &Path, v: &Value) -> io::Result<Value> {
    let start = Instant::now();
    let map = Mapping::open(path)?;
    let view = View::new(map.bytes())?;
    let (kind, exts, terms) = parse(
        v["query"].as_str().unwrap_or(""),
        v["foldersOnly"].as_bool().unwrap_or(false),
    );
    let fuzzy = v["fuzzy"].as_bool().unwrap_or(true);
    let pinyin = v["pinyin"].as_bool().unwrap_or(true);
    let rules = priority::Rules::new(
        &serde_json::from_value::<Vec<priority::Rule>>(v["priorities"].clone()).unwrap_or_default(),
    );
    let current = key(v["currentFolder"].as_str().unwrap_or(""));
    let prefix = if current.is_empty() {
        String::new()
    } else {
        format!("{current}\\")
    };
    let progressive = v["progressive"].as_bool().unwrap_or(false)
        && !prefix.is_empty()
        && !matches!(kind.as_str(), "app" | "setting");
    let mut heap = Matches::new();
    let (mut total, mut local_total) = (0, 0);
    let mut visit = |id: usize, skip_local: bool| -> io::Result<()> {
        if !view.possible(id, &kind, &terms, fuzzy)? {
            return Ok(());
        }
        let row = view.row(id)?;
        if accepts(&row, &kind, &exts) {
            if let Some((points, mode)) = score(&row, &row.path, &terms, fuzzy, pinyin) {
                let local = !prefix.is_empty() && row.path.starts_with(&prefix);
                if skip_local && local {
                    return Ok(());
                }
                total += 1;
                if local {
                    local_total += 1;
                }
                let priority = rules.rank(&row.path);
                if heap.len() < 100
                    || heap
                        .peek()
                        .is_some_and(|r| (local, priority, points) > (r.0.0, r.0.1, r.0.2))
                {
                    heap.push(Reverse((local, priority, points, row.path, id, mode)));
                    if heap.len() > 100 {
                        heap.pop();
                    }
                }
            }
        }
        Ok(())
    };
    // Local range is found directly in the sorted disk table, before global scan.
    if progressive {
        for id in view.lower_bound(&prefix)?..view.lower_bound(&format!("{current}]"))? {
            visit(id, false)?;
        }
    }
    // End the mutable borrows before publishing local results.
    drop(visit);
    if progressive {
        output(
            json!({"id":v["id"],"result":{"items":items(&heap,&view)?,"total":total,"localTotal":local_total,"elapsed":start.elapsed().as_secs_f64()*1000.0,"partial":true}}),
        );
    }
    for id in 0..if matches!(kind.as_str(), "app" | "setting") {
        0
    } else {
        view.count()
    } {
        if !view.possible(id, &kind, &terms, fuzzy)? {
            continue;
        }
        let row = view.row(id)?;
        if !accepts(&row, &kind, &exts) {
            continue;
        }
        if let Some((points, mode)) = score(&row, &row.path, &terms, fuzzy, pinyin) {
            let local = !prefix.is_empty() && row.path.starts_with(&prefix);
            if progressive && local {
                continue;
            }
            total += 1;
            if local {
                local_total += 1;
            }
            let priority = rules.rank(&row.path);
            if heap.len() < 100
                || heap
                    .peek()
                    .is_some_and(|r| (local, priority, points) > (r.0.0, r.0.1, r.0.2))
            {
                heap.push(Reverse((local, priority, points, row.path, id, mode)));
                if heap.len() > 100 {
                    heap.pop();
                }
            }
        }
    }
    let result = json!({"items":items(&heap,&view)?,"total":total,"localTotal":local_total,"elapsed":start.elapsed().as_secs_f64()*1000.0});
    drop(heap);
    drop(map);
    Ok(result)
}
pub fn serve(args: &[String]) -> io::Result<()> {
    let path = Path::new(args.get(2).ok_or_else(bad)?);
    {
        let map = Mapping::open(path)?;
        let view = View::new(map.bytes())?;
        output(json!({"ready":true,"count":view.count()}));
    }
    for line in io::stdin().lock().lines() {
        let line = line?;
        if line.len() > 1_000_000 {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match v["type"].as_str().unwrap_or("") {
            "query" => match query_image(path, &v) {
                Ok(result) => output(json!({"id":v["id"],"result":result})),
                Err(e) => output(json!({"id":v["id"],"error":e.to_string()})),
            },
            "stop" => break,
            _ => {}
        }
    }
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
                        assert!(!accepts(row, &kind, &exts) || score(row, path, &terms, fuzzy, pinyin).is_none());
                    }
                }
            }
        }
        let data = map.bytes().to_vec();
        assert!(OpenOptions::new().write(true).open(&file).is_err(), "Mapped image must deny concurrent writes");
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
        let pool = wide(&corrupt, 40).unwrap() as usize;
        let name = uint(&corrupt, rows + 4).unwrap() as usize;
        corrupt[pool + name] = 0xff;
        assert!(View::new(&corrupt).unwrap().row(0).is_err());
        fs::remove_file(file).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
