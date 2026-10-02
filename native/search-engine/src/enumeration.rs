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
        if !row.item.directory {
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
pub fn walk(
    root: &str,
    s: &Shared,
    config: &Config,
    generation: u64,
    scanned: &mut usize,
    issues: &mut usize,
) {
    let cache_key = key(&s.cache);
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
        if row.item.directory {
            row.item.modified = incremental::stamp(&meta);
        }
        Some(row)
    };
    let cancel = || s.generation.load(Ordering::Relaxed) != generation;
    let (tx, rx) = sync_channel(16);
    let stop = AtomicBool::new(false);
    let errors = AtomicU64::new(0);
    thread::scope(|scope| {
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
        for rows in rx.iter() {
            if cancel() {
                break;
            }
            *scanned += rows.len();
            batch.extend(rows);
            if batch.len() >= 2048 || last.elapsed().as_millis() > 180 {
                insert(s, &mut batch, generation);
                {
                    let mut state = s.state.lock().unwrap();
                    state.scanned = *scanned;
                    state.issues = *issues + errors.load(Ordering::Relaxed) as usize;
                }
                send(s);
                last = Instant::now();
                if full(&s.index.read().unwrap(), config.max_entries) {
                    break;
                }
            }
        }
        stop.store(true, Ordering::Relaxed);
        drop(rx);
        if !cancel() {
            insert(s, &mut batch, generation);
        }
    });
    *issues += errors.load(Ordering::Relaxed) as usize;
}
