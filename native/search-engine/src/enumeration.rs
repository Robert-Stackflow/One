use super::*;
use jwalk::rayon::{Scope, ThreadPoolBuilder};
use std::{
    path::PathBuf,
    sync::{
        atomic::AtomicBool,
        mpsc::{SyncSender, sync_channel},
    },
};

// Keep std::fs::DirEntry's cached Windows enumeration metadata. jwalk discards it,
// requiring a second filesystem call to retrieve each directory's timestamp.
struct Walker<'a, F, C> {
    map: &'a F,
    cancel: &'a C,
    stop: &'a AtomicBool,
    tx: SyncSender<Vec<Record>>,
}
impl<F: Fn(PathBuf, fs::Metadata) -> Option<Record> + Sync, C: Fn() -> bool + Sync>
    Walker<'_, F, C>
{
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed) || (self.cancel)()
    }
    fn directory<'scope>(
        &'scope self,
        scope: &Scope<'scope>,
        path: PathBuf,
        row: Record,
        errors: &'scope AtomicU64,
    ) {
        if self.stopped() {
            return;
        }
        if !row.item.directory() {
            let _ = self.tx.send(vec![row]);
            return;
        }
        let mut batch = Vec::with_capacity(1024);
        batch.push(row);
        let mut directories = Vec::new();
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(_) => {
                errors.fetch_add(1, Ordering::Relaxed);
                let _ = self.tx.send(batch);
                return;
            }
        };
        for entry in entries {
            if self.stopped() {
                return;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    errors.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            };
            let meta = match entry.metadata() {
                Ok(meta) => meta,
                Err(_) => {
                    errors.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            };
            let directory = meta.is_dir() && !meta.is_symlink();
            let path = entry.path();
            let Some(row) = (self.map)(path.clone(), meta) else {
                continue;
            };
            if directory {
                directories.push((path, row));
            } else {
                batch.push(row);
                if batch.len() >= 1024 {
                    if self
                        .tx
                        .send(std::mem::replace(&mut batch, Vec::with_capacity(1024)))
                        .is_err()
                    {
                        return;
                    }
                }
            }
        }
        if !batch.is_empty() {
            let _ = self.tx.send(batch);
        }
        // Publish the parent before its descendants, in one batch with its direct files.
        for (path, row) in directories {
            if self.stopped() {
                return;
            }
            scope.spawn(move |scope| self.directory(scope, path, row, errors));
        }
    }
}
pub(super) fn enumerate(
    root: &str,
    cache_path: &str,
    config: &Config,
    generation: u64,
    scanned: &mut usize,
    issues: &mut usize,
    cancel: impl Fn() -> bool + Sync,
    mut consume: impl FnMut(Vec<Record>, usize, usize) -> io::Result<bool>,
) -> io::Result<()> {
    let cache_key = key(cache_path);
    let excluded: Vec<_> = config.excluded.iter().map(|p| key(p)).collect();
    let map = |path: PathBuf, meta: fs::Metadata| {
        let path = path.to_string_lossy().into_owned();
        let k = key(&path);
        if meta.is_symlink()
            || cache::owned_key(&k, &cache_key)
            || excluded.iter().any(|p| under(&k, p))
        {
            return None;
        }
        let mut row = Record::new(path, meta.is_dir(), generation);
        if row.item.directory() {
            row.item.set_modified(incremental::stamp(&meta));
        }
        Some(row)
    };
    let (tx, rx) = sync_channel(16);
    let stop = AtomicBool::new(false);
    let errors = AtomicU64::new(0);
    let result = thread::scope(|scope| {
        let map = &map;
        let cancel = &cancel;
        let stop = &stop;
        let errors = &errors;
        scope.spawn(move || {
            let walker = Walker {
                map,
                cancel,
                stop,
                tx,
            };
            let root = PathBuf::from(root);
            let meta = match fs::symlink_metadata(&root) {
                Ok(meta) => meta,
                Err(_) => {
                    errors.fetch_add(1, Ordering::Relaxed);
                    return;
                }
            };
            let Some(row) = map(root.clone(), meta) else {
                return;
            };
            let pool = ThreadPoolBuilder::new().num_threads(4).build().unwrap();
            pool.scope(|scope| walker.directory(scope, root, row, errors));
        });
        let mut batch = Vec::with_capacity(2048);
        let mut last = Instant::now();
        let mut result = Ok(());
        for rows in rx.iter() {
            if cancel() {
                break;
            }
            *scanned += rows.len();
            batch.extend(rows);
            if batch.len() >= 2048 || last.elapsed().as_millis() > 180 {
                let rows = std::mem::replace(&mut batch, Vec::with_capacity(2048));
                match consume(
                    rows,
                    *scanned,
                    *issues + errors.load(Ordering::Relaxed) as usize,
                ) {
                    Ok(true) => {}
                    Ok(false) => break,
                    Err(error) => {
                        result = Err(error);
                        break;
                    }
                }
                last = Instant::now();
            }
        }
        stop.store(true, Ordering::Relaxed);
        drop(rx);
        if result.is_ok() && !cancel() && !batch.is_empty() {
            result = consume(
                batch,
                *scanned,
                *issues + errors.load(Ordering::Relaxed) as usize,
            )
            .map(|_| ());
        }
        result
    });
    *issues += errors.load(Ordering::Relaxed) as usize;
    result
}

pub fn walk(
    root: &str,
    s: &Shared,
    config: &Config,
    generation: u64,
    scanned: &mut usize,
    issues: &mut usize,
) {
    enumerate(
        root,
        &s.cache,
        config,
        generation,
        scanned,
        issues,
        || s.generation.load(Ordering::Relaxed) != generation,
        |mut batch, scanned, issues| {
            insert(s, &mut batch, generation);
            {
                let mut state = s.state.lock().unwrap();
                state.scanned = scanned;
                state.issues = issues;
            }
            send(s);
            Ok(!full(&s.index.read().unwrap(), config.max_entries))
        },
    )
    .expect("mutable enumeration consumer");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failing_and_cancelled_consumers_release_backpressured_workers() {
        let parent = std::env::temp_dir();
        let dir = parent.join(format!(
            "one-enumeration-consumer-{}-{}",
            std::process::id(),
            now()
        ));
        assert_eq!(dir.parent(), Some(parent.as_path()));
        fs::create_dir(&dir).unwrap();
        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let _owned = Fixture(dir.clone());
        // More packets than the channel can hold: an early consumer error
        // must stop the producer before thread::scope waits for its exit.
        for n in 0..25_000 {
            File::create(dir.join(format!("file-{n:05}"))).unwrap();
        }
        let root = dir.to_string_lossy();
        let config = Config {
            roots: vec![root.into_owned()],
            max_entries: 50_000,
            ..Default::default()
        };
        let mut scanned = 0;
        let mut issues = 0;
        let mut packets = 0;
        let error = enumerate(
            &config.roots[0],
            "Z:\\unused-cache",
            &config,
            1,
            &mut scanned,
            &mut issues,
            || false,
            |rows, _, _| {
                packets += 1;
                assert!(rows.len() <= 3072);
                Err(io::Error::other("consumer rejected"))
            },
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "consumer rejected");
        assert_eq!(packets, 1);
        assert_eq!(issues, 0);
        assert!(scanned < 25_001);
        let cancel = AtomicBool::new(false);
        scanned = 0;
        packets = 0;
        enumerate(
            &config.roots[0],
            "Z:\\unused-cache",
            &config,
            1,
            &mut scanned,
            &mut issues,
            || cancel.load(Ordering::Relaxed),
            |_, _, _| {
                packets += 1;
                cancel.store(true, Ordering::Relaxed);
                Ok(true)
            },
        )
        .unwrap();
        assert_eq!(packets, 1);
        assert!(scanned < 25_001);
        scanned = 0;
        let mut received = 0;
        enumerate(
            &config.roots[0],
            "Z:\\unused-cache",
            &config,
            1,
            &mut scanned,
            &mut issues,
            || false,
            |rows, _, _| {
                received += rows.len();
                Ok(true)
            },
        )
        .unwrap();
        assert_eq!((scanned, received, issues), (25_001, 25_001, 0));
    }
}
