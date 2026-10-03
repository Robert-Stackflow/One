//! Stream a base/overlay union into another immutable image. This never
//! restores Index and bounds parent interning independently of the row count.
use super::*;
use std::io::Read;

struct Writer {
    temps: Temps,
    parents: BufWriter<File>,
    rows: BufWriter<File>,
    phonetics: Pool,
    text: Pool,
    intern: HashMap<String, u32>,
    intern_bytes: usize,
    parent_count: u32,
    count: usize,
}
impl Writer {
    fn new(target: &Path) -> io::Result<Self> {
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
        let parents = BufWriter::new(section("parents")?);
        let rows = BufWriter::new(section("rows")?);
        let phonetics = Pool {
            out: BufWriter::new(section("phonetics")?),
            length: 0,
        };
        let text = Pool {
            out: BufWriter::new(section("data")?),
            length: 0,
        };
        Ok(Self {
            temps,
            parents,
            rows,
            phonetics,
            text,
            intern: HashMap::new(),
            intern_bytes: 0,
            parent_count: 0,
            count: 0,
        })
    }
    fn write(
        &mut self,
        row: &impl SearchRow,
        path: Fragments<'_>,
        exact_prefix: &str,
        exact_name: &str,
        modified: u64,
    ) -> io::Result<()> {
        let parent = if let Some(&id) = self.intern.get(exact_prefix) {
            id
        } else {
            // A bounded cache can repeat a parent entry after eviction. IDs
            // still address the immutable table; search ordering is unchanged.
            if self.intern.len() >= 32_768
                || self.intern_bytes + exact_prefix.len() > 8 * 1024 * 1024
            {
                self.intern.clear();
                self.intern_bytes = 0;
            }
            let id = self.parent_count;
            self.parent_count = self.parent_count.checked_add(1).ok_or_else(bad)?;
            let normalized = self.text.text(path.prefix)?;
            let exact = if exact_prefix == path.prefix {
                normalized
            } else {
                self.text.text(exact_prefix)?
            };
            let mut bytes = [0; PARENT];
            normalized.put(&mut bytes, 0);
            exact.put(&mut bytes, 8);
            put64(&mut bytes, 16, path.bits as u64);
            put64(&mut bytes, 24, (path.bits >> 64) as u64);
            self.parents.write_all(&bytes)?;
            self.intern_bytes += exact_prefix.len();
            self.intern.insert(exact_prefix.to_owned(), id);
            id
        };
        let name = self.text.text(path.name)?;
        let lower = if row.lower() == path.name {
            name
        } else {
            self.text.text(row.lower())?
        };
        let exact = if exact_name == path.name {
            name
        } else {
            self.text.text(exact_name)?
        };
        let at = self.phonetics.length;
        let mut count = 0u32;
        for text in row.phonetic() {
            if count >= 32 {
                return Err(bad());
            }
            let mut bytes = [0; 8];
            self.text.text(text)?.put(&mut bytes, 0);
            self.phonetics.bytes(&bytes)?;
            count += 1;
        }
        let mut bytes = [0; ROW];
        put32(&mut bytes, 0, parent);
        name.put(&mut bytes, 4);
        lower.put(&mut bytes, 12);
        exact.put(&mut bytes, 20);
        put32(&mut bytes, 28, at);
        put32(&mut bytes, 32, count);
        put64(&mut bytes, 36, row.bits() as u64);
        put64(&mut bytes, 44, (row.bits() >> 64) as u64);
        put64(&mut bytes, 52, modified);
        put32(
            &mut bytes,
            60,
            row.directory() as u32 | ((row.plain_name() as u32) << 1),
        );
        self.rows.write_all(&bytes)?;
        self.count += 1;
        // Enforce the file bound during streaming, before filling the disk.
        if HEADER as u64
            + self.parent_count as u64 * PARENT as u64
            + self.count as u64 * ROW as u64
            + self.phonetics.length as u64
            + self.text.length as u64
            > MAX_BYTES
        {
            return Err(bad());
        }
        Ok(())
    }
    fn finish(mut self, target: &Path, stop: &AtomicBool) -> io::Result<usize> {
        self.parents.flush()?;
        self.rows.flush()?;
        self.phonetics.out.flush()?;
        self.text.out.flush()?;
        drop(self.parents);
        drop(self.rows);
        drop(self.phonetics.out);
        drop(self.text.out);
        let row_at = HEADER as u64 + self.parent_count as u64 * PARENT as u64;
        let data_at = row_at + self.count as u64 * ROW as u64;
        let text_at = data_at + self.phonetics.length as u64;
        let total = text_at + self.text.length as u64;
        let final_name = target.with_extension(format!("{}.image.tmp", std::process::id()));
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&final_name)?;
        self.temps.0.push(final_name.clone());
        let mut out = BufWriter::new(file);
        let mut header = [0; HEADER];
        header[..8].copy_from_slice(MAGIC);
        header[64..80].copy_from_slice(&generation()?);
        for (at, value) in [
            (8, self.parent_count as u64),
            (16, self.count as u64),
            (24, HEADER as u64),
            (32, row_at),
            (40, data_at),
            (48, total),
            (56, text_at),
        ] {
            put64(&mut header, at, value);
        }
        out.write_all(&header)?;
        let mut buffer = [0u8; 64 * 1024];
        for path in &self.temps.0[..4] {
            let mut input = File::open(path)?;
            loop {
                if stop.load(Ordering::Relaxed) {
                    return Err(io::Error::new(io::ErrorKind::Interrupted, "索引合并已取消"));
                }
                let n = input.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                out.write_all(&buffer[..n])?;
            }
        }
        out.flush()?;
        out.get_ref().sync_all()?;
        drop(out);
        if stop.load(Ordering::Relaxed) {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "索引合并已取消"));
        }
        fs::rename(final_name, target)?;
        Ok(self.count)
    }
}
pub(super) fn run(
    base: &Path,
    overlay: &Overlay,
    target: &Path,
    stop: &AtomicBool,
) -> io::Result<usize> {
    let map = Mapping::open(base)?;
    let mut view = View::new(map.bytes())?;
    overlay.check(&view)?;
    view.validate()?;
    let mut writer = Writer::new(target)?;
    let mut previous = None;
    for (n, candidate) in overlay.iter(&view, 0..view.count(), None).enumerate() {
        if n % 1024 == 0 && stop.load(Ordering::Relaxed) {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "索引合并已取消"));
        }
        let candidate = candidate?;
        let path = match &candidate {
            Candidate::Base(id) => view.path(*id)?,
            Candidate::Extra(path, _) => Fragments::from_key(path),
        };
        if previous.is_some_and(|last| last >= path) {
            return Err(bad());
        }
        previous = Some(path);
        match candidate {
            Candidate::Base(id) => {
                let row = view.row(id)?;
                writer.write(&row, path, row.exact_prefix, row.exact_name, row.modified)?;
            }
            Candidate::Extra(_, row) => {
                let display = row.item.path.display();
                let split = if path.prefix.is_empty() {
                    0
                } else {
                    display
                        .trim_end_matches(['\\', '/'])
                        .rfind(['\\', '/'])
                        .map_or(0, |at| at + 1)
                };
                let (prefix, name) = display.split_at(split);
                writer.write(row, path, prefix, name, row.item.modified())?;
            }
        }
    }
    if writer.count != overlay.count(&view) {
        return Err(bad());
    }
    writer.finish(target, stop)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn streaming_merge_preserves_rows_and_cancels_without_output() {
        let dir = std::env::temp_dir().join(format!("one-map-compact-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let base = dir.join("base.bin");
        let target = dir.join("next.bin");
        let mut index = Index::default();
        for path in [
            "D:\\",
            "D:\\Folder",
            "D:\\Folder\\季度报告.PDF",
            "D:/Mixed/İstanbul/Σ.TXT",
            "\\\\Server\\Share\\文档.txt",
        ] {
            index.put(Record::new(
                path.into(),
                path.ends_with('\\') || path == "D:\\Folder",
                0,
            ));
        }
        image(&index, &base).unwrap();
        let map = Mapping::open(&base).unwrap();
        let view = View::new(map.bytes()).unwrap();
        let mut overlay = Overlay::load(&view, None).unwrap();
        overlay
            .apply(
                &view,
                vec![
                    overlay::Mutation::Remove("D:\\Folder".into()),
                    overlay::Mutation::Put(Entry {
                        path: "D:\\Folder\\报告.TXT".into(),
                        name: String::new(),
                        directory: false,
                        modified: 0,
                        size: 0,
                    }),
                ],
                100,
            )
            .unwrap();
        assert!(run(&base, &overlay, &target, &AtomicBool::new(true)).is_err());
        assert!(!target.exists());
        assert_eq!(
            run(&base, &overlay, &target, &AtomicBool::new(false)).unwrap(),
            overlay.count(&view)
        );
        let next = Mapping::open(&target).unwrap();
        let next_view = View::new(next.bytes()).unwrap();
        assert_ne!(view.generation, next_view.generation);
        for (candidate, id) in overlay.iter(&view, 0..view.count(), None).zip(0..) {
            let after = next_view.row(id).unwrap();
            match candidate.unwrap() {
                Candidate::Base(n) => {
                    let before = view.row(n).unwrap();
                    assert!(before.path == after.path);
                    assert_eq!(before.lower, after.lower);
                    assert_eq!(before.exact_prefix, after.exact_prefix);
                    assert_eq!(before.exact_name, after.exact_name);
                    assert_eq!(before.bits, after.bits);
                    assert_eq!(
                        before.phonetic().collect::<Vec<_>>(),
                        after.phonetic().collect::<Vec<_>>()
                    );
                }
                Candidate::Extra(path, row) => {
                    assert!(Fragments::from_key(path) == after.path);
                    assert_eq!(row.lower(), after.lower);
                    assert_eq!(
                        format!("{}{}", after.exact_prefix, after.exact_name),
                        row.item.path.display()
                    );
                }
            }
        }
        drop(next);
        drop(map);
        fs::remove_file(base).unwrap();
        fs::remove_file(target).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
