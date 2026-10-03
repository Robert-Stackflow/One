//! Read-only migration readers. Reuse the cache codec and its complete-transaction
//! recovery rule without building Index or repairing the original files.
use super::*;
pub struct Snapshot {
    reader: BufReader<File>,
    previous: String,
    start: u64,
    remaining: u64,
    pub count: u64,
    pub id: u64,
}
impl Snapshot {
    pub fn open(path: &Path, expected: &Config) -> io::Result<Option<Self>> {
        let file = OpenOptions::new().read(true).share_mode(1).open(path)?;
        if file.metadata()?.len() > MAX_BYTES {
            return Err(bad());
        }
        let mut reader = BufReader::new(file);
        let mut magic = [0; 8];
        reader.read_exact(&mut magic)?;
        if &magic != MAGIC {
            return Ok(None);
        }
        let mut number = [0; 4];
        reader.read_exact(&mut number)?;
        let len = u32::from_le_bytes(number) as usize;
        if len > 1_000_000 {
            return Err(bad());
        }
        let mut config = vec![0; len];
        reader.read_exact(&mut config)?;
        let config: Config = serde_json::from_slice(&config).map_err(|_| bad())?;
        if config.roots != expected.roots
            || config.excluded != expected.excluded
            || config.max_entries != expected.max_entries
        {
            return Ok(None);
        }
        let mut numbers = [0; 24];
        reader.read_exact(&mut numbers)?;
        let id = u64::from_le_bytes(numbers[8..16].try_into().unwrap());
        let count = u64::from_le_bytes(numbers[16..].try_into().unwrap());
        if count > expected.max_entries.min(10_000_000) as u64 {
            return Err(bad());
        }
        let start = reader.stream_position()?;
        Ok(Some(Self {
            reader,
            previous: String::new(),
            start,
            remaining: count,
            count,
            id,
        }))
    }
    pub fn next(&mut self) -> io::Result<Option<Entry>> {
        if self.remaining == 0 {
            let mut byte = [0];
            if self.reader.read(&mut byte)? != 0 {
                return Err(bad());
            }
            return Ok(None);
        }
        get_path(&mut self.reader, &mut self.previous)?;
        let entry = get_entry(&mut self.reader, self.previous.clone())?;
        self.remaining -= 1;
        Ok(Some(entry))
    }
    pub fn rewind(&mut self) -> io::Result<()> {
        self.reader.seek(io::SeekFrom::Start(self.start))?;
        self.remaining = self.count;
        self.previous.clear();
        Ok(())
    }
}
pub struct Journal {
    file: Option<File>,
}
impl Journal {
    pub fn open(path: &Path, id: u64) -> io::Result<Self> {
        let mut file = match OpenOptions::new().read(true).share_mode(1).open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Self { file: None }),
            Err(e) => return Err(e),
        };
        if file.metadata()?.len() > MAX_DELTA {
            return Err(bad());
        }
        let mut head = [0; 16];
        if file.read_exact(&mut head).is_err()
            || &head[..8] != DELTA
            || u64::from_le_bytes(head[8..].try_into().unwrap()) != id
        {
            return Ok(Self { file: None });
        }
        Ok(Self { file: Some(file) })
    }
    pub fn next(&mut self) -> io::Result<Option<Vec<Change>>> {
        let Some(file) = &mut self.file else {
            return Ok(None);
        };
        let mut head = [0; 12];
        let result = (|| -> io::Result<Option<Vec<Change>>> {
            match file.read_exact(&mut head) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
                Err(e) => return Err(e),
            }
            let length = u32::from_le_bytes(head[..4].try_into().unwrap()) as usize;
            if length as u64 > MAX_DELTA {
                return Ok(None);
            }
            let mut bytes = vec![0; length];
            match file.read_exact(&mut bytes) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
                Err(e) => return Err(e),
            }
            if checksum(&bytes) != u64::from_le_bytes(head[4..].try_into().unwrap()) {
                return Ok(None);
            }
            Ok(unpack(&bytes).ok())
        })();
        if !matches!(result, Ok(Some(_))) {
            self.file = None;
        }
        result
    }
}
// Scratch runs use the same bounded path/meta codec as the source snapshot.
pub fn write_entry(w: &mut impl Write, item: &Entry, previous: &str) -> io::Result<()> {
    put_path(w, &item.path, previous)?;
    put_meta(w, item.directory, item.modified)
}
pub fn read_entry(r: &mut impl Read, previous: &mut String) -> io::Result<Entry> {
    get_path(r, previous)?;
    get_entry(r, previous.clone())
}

#[cfg(test)]
pub fn fixture(
    path: &Path,
    config: &Config,
    count: u64,
    entries: impl Iterator<Item = Entry>,
    batches: &[Vec<Change>],
) -> io::Result<()> {
    let mut out = BufWriter::new(File::create(path)?);
    let cfg = serde_json::to_vec(config)?;
    encode(&mut out, &Index::default(), &cfg, 10, 20)?;
    // The test can deliberately use arbitrary row order, as the old decoder
    // permits. Only the row count in this empty snapshot header is replaced.
    drop(out);
    let mut file = OpenOptions::new().write(true).open(path)?;
    file.seek(io::SeekFrom::Start(28 + cfg.len() as u64))?;
    file.write_all(&count.to_le_bytes())?;
    let mut previous = String::new();
    for entry in entries {
        write_entry(&mut file, &entry, &previous)?;
        previous = entry.path;
    }
    drop(file);
    let mut delta = File::create(format!("{}.delta", path.display()))?;
    delta.write_all(DELTA)?;
    delta.write_all(&20u64.to_le_bytes())?;
    for changes in batches {
        let data = packet(changes)?;
        delta.write_all(&(data.len() as u32).to_le_bytes())?;
        delta.write_all(&checksum(&data).to_le_bytes())?;
        delta.write_all(&data)?;
    }
    Ok(())
}
