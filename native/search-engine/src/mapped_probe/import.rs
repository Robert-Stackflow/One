//! Stream the existing snapshot and complete delta transactions into a mapped
//! image. Canonical snapshots avoid sorting; legacy unordered snapshots use
//! bounded batches and a leveled external merge, never a full mutable Index.
use super::*;
use cache::stream::{Journal, Snapshot, read_entry, write_entry};
use overlay::Mutation;
use std::{io::Read, path::PathBuf};

fn check(stop: &AtomicBool) -> io::Result<()> {
    if stop.load(Ordering::Relaxed) {
        Err(io::Error::new(io::ErrorKind::Interrupted, "索引转换已取消"))
    } else {
        Ok(())
    }
}
struct Run {
    path: PathBuf,
    count: u64,
}
struct Reader {
    input: BufReader<File>,
    previous: String,
    remaining: u64,
}
impl Reader {
    fn open(run: &Run) -> io::Result<Self> {
        let mut input = BufReader::new(File::open(&run.path)?);
        let mut head = [0; 16];
        input.read_exact(&mut head)?;
        if &head[..8] != b"ONERUN01"
            || u64::from_le_bytes(head[8..].try_into().unwrap()) != run.count
        {
            return Err(bad());
        }
        Ok(Self {
            input,
            previous: String::new(),
            remaining: run.count,
        })
    }
    fn next(&mut self) -> io::Result<Option<Entry>> {
        if self.remaining == 0 {
            let mut byte = [0];
            if self.input.read(&mut byte)? != 0 {
                return Err(bad());
            }
            return Ok(None);
        }
        let entry = read_entry(&mut self.input, &mut self.previous)?;
        self.remaining -= 1;
        Ok(Some(entry))
    }
}
struct Sort {
    target: PathBuf,
    temps: Temps,
    serial: usize,
    levels: Vec<Vec<Run>>,
    runs: usize,
}
impl Sort {
    fn new(target: &Path) -> Self {
        Self {
            target: target.into(),
            temps: Temps(Vec::new()),
            serial: 0,
            levels: Vec::new(),
            runs: 0,
        }
    }
    fn output(&mut self, count: u64) -> io::Result<(Run, BufWriter<File>)> {
        let path =
            self.target
                .with_extension(format!("{}.sort-{}.tmp", std::process::id(), self.serial));
        self.serial += 1;
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        self.temps.0.push(path.clone());
        let mut out = BufWriter::new(file);
        out.write_all(b"ONERUN01")?;
        out.write_all(&count.to_le_bytes())?;
        Ok((Run { path, count }, out))
    }
    fn spill(&mut self, mut rows: Vec<(String, Entry)>, stop: &AtomicBool) -> io::Result<()> {
        rows.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        let (run, mut out) = self.output(rows.len() as u64)?;
        let (mut previous, mut last) = (String::new(), None);
        for (n, (path, item)) in rows.into_iter().enumerate() {
            if n % 1024 == 0 {
                check(stop)?;
            }
            if last.as_ref().is_some_and(|s| s >= &path) {
                return Err(bad());
            }
            write_entry(&mut out, &item, &previous)?;
            previous = item.path;
            last = Some(path);
        }
        out.flush()?;
        drop(out);
        self.runs += 1;
        self.carry(run, 0, stop)
    }
    fn carry(&mut self, run: Run, level: usize, stop: &AtomicBool) -> io::Result<()> {
        if self.levels.len() <= level {
            self.levels.push(Vec::new());
        }
        self.levels[level].push(run);
        if self.levels[level].len() == 16 {
            let inputs = std::mem::take(&mut self.levels[level]);
            let merged = self.merge(inputs, stop)?;
            self.carry(merged, level + 1, stop)?;
        }
        Ok(())
    }
    fn merge(&mut self, inputs: Vec<Run>, stop: &AtomicBool) -> io::Result<Run> {
        let count = inputs.iter().map(|r| r.count).sum();
        let (result, mut out) = self.output(count)?;
        let mut readers = inputs
            .iter()
            .map(Reader::open)
            .collect::<io::Result<Vec<_>>>()?;
        let mut items: Vec<Option<Entry>> = (0..readers.len()).map(|_| None).collect();
        let mut heap = BinaryHeap::new();
        for (id, reader) in readers.iter_mut().enumerate() {
            if let Some(item) = reader.next()? {
                heap.push(Reverse((key(&item.path), id)));
                items[id] = Some(item);
            }
        }
        let (mut last, mut previous, mut written) = (None, String::new(), 0);
        while let Some(Reverse((path, id))) = heap.pop() {
            if written % 1024 == 0 {
                check(stop)?;
            }
            if last.as_ref().is_some_and(|s| s >= &path) {
                return Err(bad());
            }
            last = Some(path);
            let item = items[id].take().ok_or_else(bad)?;
            write_entry(&mut out, &item, &previous)?;
            previous = item.path;
            written += 1;
            if let Some(item) = readers[id].next()? {
                heap.push(Reverse((key(&item.path), id)));
                items[id] = Some(item);
            }
        }
        if written != count {
            return Err(bad());
        }
        out.flush()?;
        drop(out);
        drop(readers);
        for run in inputs {
            fs::remove_file(&run.path)?;
            self.temps.0.retain(|p| p != &run.path);
        }
        Ok(result)
    }
    fn finish(&mut self, stop: &AtomicBool) -> io::Result<Option<Run>> {
        let mut runs: Vec<_> = self.levels.drain(..).flatten().collect();
        while runs.len() > 1 {
            let mut next = Vec::new();
            while !runs.is_empty() {
                let group = runs.split_off(runs.len().saturating_sub(16));
                next.push(if group.len() == 1 {
                    group.into_iter().next().unwrap()
                } else {
                    self.merge(group, stop)?
                });
            }
            runs = next;
        }
        Ok(runs.pop())
    }
}
fn batch(
    writer: &mut compact::Writer,
    entries: &mut Vec<Entry>,
    last: &mut Option<PathKey>,
    stop: &AtomicBool,
) -> io::Result<()> {
    check(stop)?;
    for row in cache::restore_records(std::mem::take(entries)) {
        let path = row.item.path.key();
        if last.as_ref().is_some_and(|s| s >= path) {
            return Err(bad());
        }
        writer.record(&row)?;
        *last = Some(path.clone());
    }
    Ok(())
}
fn image_from(
    mut next: impl FnMut() -> io::Result<Option<Entry>>,
    target: &Path,
    stop: &AtomicBool,
) -> io::Result<usize> {
    let mut writer = compact::Writer::new(target)?;
    let (mut entries, mut bytes, mut last) = (Vec::new(), 0, None);
    while let Some(item) = next()? {
        bytes += item.path.len();
        entries.push(item);
        if entries.len() >= 4096 || bytes >= 512 * 1024 {
            batch(&mut writer, &mut entries, &mut last, stop)?;
            bytes = 0;
        }
    }
    batch(&mut writer, &mut entries, &mut last, stop)?;
    writer.finish(target, stop)
}
pub(super) fn run(
    cache: &Path,
    target: &Path,
    config: &Config,
    stop: &AtomicBool,
) -> io::Result<Value> {
    let start = Instant::now();
    let mut source = Snapshot::open(cache, config)?.ok_or_else(bad)?;
    let (mut sorted, mut last) = (true, None);
    while let Some(item) = source.next()? {
        check(stop)?;
        let path = key(&item.path);
        if last.as_ref().is_some_and(|s| s == &path) {
            return Err(bad());
        }
        if last.as_ref().is_some_and(|s| s > &path) {
            sorted = false;
        }
        last = Some(path);
    }
    source.rewind()?;
    let mut owned = Temps(Vec::new());
    let mut serial = 0;
    let stage = |n: usize| target.with_extension(format!("{}.import-{n}.base", std::process::id()));
    let mut base = stage(serial);
    if base.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "转换临时文件已存在",
        ));
    }
    let mut sort = Sort::new(target);
    let count = if sorted {
        image_from(|| source.next(), &base, stop)?
    } else {
        let (mut rows, mut bytes) = (Vec::new(), 0);
        while let Some(item) = source.next()? {
            check(stop)?;
            let normalized = key(&item.path);
            bytes += normalized.len() + item.path.len();
            rows.push((normalized, item));
            if rows.len() >= 8192 || bytes >= 4 * 1024 * 1024 {
                sort.spill(std::mem::take(&mut rows), stop)?;
                bytes = 0;
            }
        }
        if !rows.is_empty() {
            sort.spill(rows, stop)?;
        }
        if let Some(run) = sort.finish(stop)? {
            let mut reader = Reader::open(&run)?;
            image_from(|| reader.next(), &base, stop)?
        } else {
            image_from(|| Ok(None), &base, stop)?
        }
    };
    owned.0.push(base.clone());
    if count as u64 != source.count {
        return Err(bad());
    }
    let mut journal = Journal::open(
        &PathBuf::from(format!("{}.delta", cache.display())),
        source.id,
    )?;
    let mut overlay = {
        let map = Mapping::open(&base)?;
        let view = View::new(map.bytes())?;
        Overlay::load(&view, None)?
    };
    let (mut batches, mut folds) = (0, 0);
    while let Some(changes) = journal.next()? {
        check(stop)?;
        batches += 1;
        let changes: Vec<_> = changes
            .into_iter()
            .map(|c| match c {
                cache::Change::Remove(p) => Mutation::Remove(p),
                cache::Change::Put(e) => Mutation::Put(e),
            })
            .collect();
        loop {
            let result = {
                let map = Mapping::open(&base)?;
                let view = View::new(map.bytes())?;
                overlay.stage(&view, changes.clone(), config.max_entries)
            };
            match result {
                Ok(next) => {
                    overlay = next;
                    break;
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock && !overlay.is_empty() => {
                    serial += 1;
                    let next = stage(serial);
                    if next.exists() {
                        return Err(io::Error::new(
                            io::ErrorKind::AlreadyExists,
                            "转换临时文件已存在",
                        ));
                    }
                    compact::run(&base, &overlay, &next, stop)?;
                    owned.0.push(next.clone());
                    fs::remove_file(&base)?;
                    owned.0.retain(|p| p != &base);
                    base = next;
                    folds += 1;
                    let map = Mapping::open(&base)?;
                    let view = View::new(map.bytes())?;
                    overlay = Overlay::load(&view, None)?;
                }
                Err(e) => return Err(e),
            }
        }
    }
    if !overlay.is_empty() {
        serial += 1;
        let next = stage(serial);
        if next.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "转换临时文件已存在",
            ));
        }
        compact::run(&base, &overlay, &next, stop)?;
        owned.0.push(next.clone());
        fs::remove_file(&base)?;
        owned.0.retain(|p| p != &base);
        base = next;
        folds += 1;
    }
    let count = {
        let map = Mapping::open(&base)?;
        View::new(map.bytes())?.count()
    };
    check(stop)?;
    fs::rename(&base, target)?;
    Ok(
        json!({"count":count,"bytes":fs::metadata(target)?.len(),"buildMs":start.elapsed().as_secs_f64()*1000.0,"sortedSnapshot":sorted,"sortRuns":sort.runs,"deltaBatches":batches,"folds":folds}),
    )
}
pub fn command(args: &[String]) -> io::Result<()> {
    let cache = Path::new(args.get(2).ok_or_else(bad)?);
    let target = Path::new(args.get(3).ok_or_else(bad)?);
    let config: Config =
        serde_json::from_reader(File::open(args.get(4).ok_or_else(bad)?)?).map_err(|_| bad())?;
    let _lock = cache::acquire(&cache.to_string_lossy())?;
    output(run(cache, target, &config, &AtomicBool::new(false))?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(path: String, directory: bool, modified: u64) -> Entry {
        Entry {
            path,
            name: String::new(),
            directory,
            modified: if directory { modified } else { 0 },
            size: 0,
        }
    }
    fn matches_source(base: &Path, target: &Path, config: &Config) {
        let (index, _, _) = cache::load(&base.to_string_lossy(), config)
            .unwrap()
            .unwrap();
        let map = Mapping::open(target).unwrap();
        let view = View::new(map.bytes()).unwrap();
        assert_eq!(view.count(), index.rows.len());
        for ((path, row), id) in index.rows.iter().zip(0..) {
            let disk = view.row(id).unwrap();
            assert!(disk.path == Fragments::from_key(path));
            assert_eq!(
                row.item.path.display(),
                format!("{}{}", disk.exact_prefix, disk.exact_name)
            );
            assert_eq!(row.lower(), disk.lower);
            assert_eq!(row.bits.value(), disk.bits);
            assert_eq!(row.item.modified(), disk.modified);
            assert_eq!(row.item.directory(), disk.directory());
            assert_eq!(
                row.phonetic().collect::<Vec<_>>(),
                disk.phonetic().collect::<Vec<_>>()
            );
        }
    }
    #[test]
    fn unordered_snapshot_and_nonadjacent_duplicates_use_bounded_external_merge() {
        let dir = std::env::temp_dir().join(format!("one-import-sort-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let base = dir.join("cache.bin");
        let target = dir.join("image.bin");
        let config = Config {
            max_entries: 160_000,
            ..Config::default()
        };
        let entries = (0..140_000)
            .rev()
            .map(|n| {
                entry(
                    format!("D:\\Mixed\\目录\\Report-{n:06}.TXT"),
                    n % 97 == 0,
                    (n + 1) * 1_000_000,
                )
            })
            .chain([
                entry("D:/Mixed/Σ.TXT".into(), false, 0),
                entry("D:\\Mixed".into(), true, 123_000_000),
            ]);
        cache::stream::fixture(&base, &config, 140_002, entries, &[]).unwrap();
        let result = run(&base, &target, &config, &AtomicBool::new(false)).unwrap();
        assert_eq!(result["sortedSnapshot"], false);
        assert!(result["sortRuns"].as_u64().unwrap() > 16);
        matches_source(&base, &target, &config);
        let before = fs::read(&target).unwrap();
        let entries = (0..8193).map(|n| {
            entry(
                if n == 8192 {
                    "d:\\mixed\\REPORT-000000.txt".into()
                } else {
                    format!("D:\\Mixed\\Report-{n:06}.txt")
                },
                false,
                0,
            )
        });
        cache::stream::fixture(&base, &config, 8193, entries, &[]).unwrap();
        assert!(run(&base, &target, &config, &AtomicBool::new(false)).is_err());
        assert_eq!(fs::read(&target).unwrap(), before);
        assert!(
            !fs::read_dir(&dir).unwrap().any(|e| e
                .unwrap()
                .path()
                .extension()
                .is_some_and(|s| s == "tmp"))
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn large_delta_folds_and_torn_suffix_are_read_only_and_match_cache_semantics() {
        let dir = std::env::temp_dir().join(format!("one-import-delta-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let base = dir.join("cache.bin");
        let target = dir.join("image.bin");
        let config = Config {
            max_entries: 50_000,
            ..Config::default()
        };
        let mut batches = Vec::new();
        for batch in 0..3 {
            batches.push(
                (0..10_000)
                    .map(|n| {
                        cache::Change::Put(entry(
                            format!("D:\\Changes\\row-{:05}.txt", batch * 10_000 + n),
                            false,
                            0,
                        ))
                    })
                    .collect(),
            );
        }
        batches.push(vec![
            cache::Change::Remove("D:\\Root".into()),
            cache::Change::Put(entry("D:\\Changes\\季度报告.PDF".into(), false, 0)),
            cache::Change::Put(entry(
                "D:\\Changes\\ROW-00000.TXT".into(),
                true,
                123_000_000,
            )),
        ]);
        cache::stream::fixture(
            &base,
            &config,
            2,
            [
                entry("D:\\Root".into(), true, 0),
                entry("D:\\Root\\old.txt".into(), false, 0),
            ]
            .into_iter(),
            &batches,
        )
        .unwrap();
        let delta = PathBuf::from(format!("{}.delta", base.display()));
        OpenOptions::new()
            .append(true)
            .open(&delta)
            .unwrap()
            .write_all(&[0xff, 0x23, 0x11])
            .unwrap();
        let before = fs::read(&delta).unwrap();
        let result = run(&base, &target, &config, &AtomicBool::new(false)).unwrap();
        assert_eq!(result["sortedSnapshot"], true);
        assert_eq!(result["deltaBatches"], 4);
        assert!(result["folds"].as_u64().unwrap() >= 2);
        assert_eq!(fs::read(&delta).unwrap(), before);
        matches_source(&base, &target, &config);
        let existing = fs::read(&target).unwrap();
        assert!(run(&base, &target, &config, &AtomicBool::new(true)).is_err());
        assert_eq!(fs::read(&target).unwrap(), existing);
        // A malformed snapshot must never replace the previously published image.
        OpenOptions::new()
            .append(true)
            .open(&base)
            .unwrap()
            .write_all(&[1])
            .unwrap();
        assert!(run(&base, &target, &config, &AtomicBool::new(false)).is_err());
        assert_eq!(fs::read(&target).unwrap(), existing);
        fs::remove_dir_all(dir).unwrap();
    }
}
