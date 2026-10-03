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
const MAX_DIRECTORY_TASKS: u64 = 64;
struct Tasks {
    pending: AtomicU64,
    limit: u64,
    #[cfg(test)]
    peak: AtomicU64,
    #[cfg(test)]
    inline: AtomicU64,
}
impl Tasks {
    fn new(limit: u64) -> Self {
        Self { pending: AtomicU64::new(0), limit,
            #[cfg(test)] peak: AtomicU64::new(0),
            #[cfg(test)] inline: AtomicU64::new(0) }
    }
    fn acquire(&self) -> Option<Task<'_>> {
        let previous = self.pending.fetch_update(Ordering::Relaxed, Ordering::Relaxed,
            |n| (n < self.limit).then_some(n + 1)).ok()?;
        #[cfg(test)] self.peak.fetch_max(previous + 1, Ordering::Relaxed);
        #[cfg(not(test))] let _ = previous;
        Some(Task(self))
    }
}
struct Task<'a>(&'a Tasks);
impl Drop for Task<'_> {
    fn drop(&mut self) { self.0.pending.fetch_sub(1, Ordering::Relaxed); }
}
struct Directory {
    entries: fs::ReadDir,
    batch: Vec<Record>,
}
struct Walker<'a, F, C> {
    map: &'a F,
    cancel: &'a C,
    stop: &'a AtomicBool,
    tx: SyncSender<Vec<Record>>,
    tasks: &'a Tasks,
}
impl<F: Fn(PathBuf, fs::Metadata) -> Option<Record> + Sync, C: Fn() -> bool + Sync>
    Walker<'_, F, C>
{
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed) || (self.cancel)()
    }
    fn flush(&self, batch: &mut Vec<Record>) -> bool {
        batch.is_empty() || self.tx.send(std::mem::take(batch)).is_ok()
    }
    fn open_directory(&self, path: PathBuf, row: Record, errors: &AtomicU64) -> Option<Directory> {
        match fs::read_dir(path) {
            Ok(entries) => Some(Directory { entries, batch: vec![row] }),
            Err(_) => {
                errors.fetch_add(1, Ordering::Relaxed);
                let _ = self.tx.send(vec![row]);
                None
            }
        }
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
        let Some(mut current) = self.open_directory(path, row, errors) else { return };
        // A saturated scheduler uses an explicit depth-first stack, not more
        // queued closures or recursion. Suspended parents have empty batches;
        // their size depends on tree depth, never the directory's width.
        let mut parents = Vec::new();
        loop {
            if self.stopped() {
                return;
            }
            let Some(entry) = current.entries.next() else {
                if !self.flush(&mut current.batch) { return; }
                if let Some(parent) = parents.pop() { current = parent; continue; }
                return;
            };
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
                // Flush the parent before a child can publish; file batches
                // may continue as the parent iterator advances.
                if !self.flush(&mut current.batch) { return; }
                if let Some(task) = self.tasks.acquire() {
                    scope.spawn(move |scope| {
                        let _task = task;
                        self.directory(scope, path, row, errors);
                    });
                } else {
                    #[cfg(test)] self.tasks.inline.fetch_add(1, Ordering::Relaxed);
                    if let Some(child) = self.open_directory(path, row, errors) {
                        parents.push(current);
                        current = child;
                    }
                }
            } else {
                current.batch.push(row);
                if current.batch.len() >= 1024 && !self.flush(&mut current.batch) {
                    return;
                }
            }
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
    let tasks = Tasks::new(MAX_DIRECTORY_TASKS);
    let result = thread::scope(|scope| {
        let map = &map;
        let cancel = &cancel;
        let stop = &stop;
        let errors = &errors;
        let tasks = &tasks;
        scope.spawn(move || {
            let walker = Walker {
                map,
                cancel,
                stop,
                tx,
                tasks,
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
    fn wide_and_deep_trees_bound_tasks_and_publish_parents_before_children() {
        let parent=std::env::temp_dir();
        let dir=parent.join(format!("one-bounded-walker-{}-{}",std::process::id(),now()));
        assert_eq!(dir.parent(),Some(parent.as_path()));
        fs::create_dir(&dir).unwrap();
        struct Fixture(PathBuf);
        impl Drop for Fixture { fn drop(&mut self) { let _=fs::remove_dir_all(&self.0); } }
        let _owned=Fixture(dir.clone());
        let mut expected=BTreeMap::new();expected.insert(key(&dir.to_string_lossy()),true);
        for n in 0..256 {
            let group=dir.join(format!("group-{n:04}"));fs::create_dir(&group).unwrap();
            expected.insert(key(&group.to_string_lossy()),true);
            let file=group.join("季度报告.TXT");File::create(&file).unwrap();
            expected.insert(key(&file.to_string_lossy()),false);
            for child in ["left","right"] {
                let child=group.join(child);fs::create_dir(&child).unwrap();
                expected.insert(key(&child.to_string_lossy()),true);
                let file=child.join("leaf.txt");File::create(&file).unwrap();
                expected.insert(key(&file.to_string_lossy()),false);
            }
        }
        let mut deep=dir.clone();
        for n in 0..48 {deep=deep.join("d");fs::create_dir(&deep).unwrap();expected.insert(key(&deep.to_string_lossy()),true);
            let file=deep.join(format!("depth-{n:02}.txt"));File::create(&file).unwrap();expected.insert(key(&file.to_string_lossy()),false);}
        for (limit,cancel_early) in [(MAX_DIRECTORY_TASKS,false),(0,false),(MAX_DIRECTORY_TASKS,true)] {
            let tasks=Tasks::new(limit);let cancel=AtomicBool::new(false);let stop=AtomicBool::new(false);
            let errors=AtomicU64::new(0);let (tx,rx)=sync_channel(16);let mut actual=BTreeMap::new();
            let map=|path:PathBuf,metadata:fs::Metadata|Some(Record::new(path.to_string_lossy().into_owned(),metadata.is_dir(),1));
            let cancelled=||cancel.load(Ordering::Relaxed);
            thread::scope(|threads| {
                let walker=Walker {map:&map,cancel:&cancelled,stop:&stop,tx,tasks:&tasks};
                let root=dir.clone();let errors=&errors;
                threads.spawn(move || {
                    let row=Record::new(root.to_string_lossy().into_owned(),true,1);
                    ThreadPoolBuilder::new().num_threads(4).build().unwrap().scope(|scope|walker.directory(scope,root,row,errors));
                });
                for batch in rx.iter() {
                    assert!(batch.len()<=1024);
                    for row in batch {
                        let path=row.item.entry().path;let normalized=key(&path);
                        if Path::new(&path)!=dir {let parent=key(&Path::new(&path).parent().unwrap().to_string_lossy());assert!(actual.contains_key(&parent),"child published before parent: {path}");}
                        assert!(actual.insert(normalized,row.item.directory()).is_none(),"duplicate row: {path}");
                    }
                    if cancel_early {cancel.store(true,Ordering::Relaxed);break;}
                    thread::sleep(std::time::Duration::from_millis(1));
                }
                drop(rx);
            });
            assert_eq!(tasks.pending.load(Ordering::Relaxed),0);
            assert!(tasks.peak.load(Ordering::Relaxed)<=limit);
            assert_eq!(errors.load(Ordering::Relaxed),0);
            if cancel_early {assert!(actual.len()<expected.len());} else {assert_eq!(actual,expected);}
            if limit==0 {assert!(tasks.inline.load(Ordering::Relaxed)>256);}
        }
    }
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
