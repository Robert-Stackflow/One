use super::*;
use catalog::{FileCatalog, Scope};
use jwalk::rayon::prelude::*;

pub fn stamp(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |v| v.as_nanos().min(u64::MAX as u128) as u64)
}
fn remove(s: &Shared, path: &str, generation: u64) {
    let mut index = s.index.write().unwrap();
    if s.generation.load(Ordering::Relaxed) != generation {
        return;
    }
    if !erase(&mut index, path) {
        return;
    }
    drop(index);
    s.persistence
        .changes(generation, vec![cache::Change::Remove(path.into())]);
}
fn update_dir(s: &Shared, path: &str, value: u64, generation: u64) {
    let mut index = s.index.write().unwrap();
    if s.generation.load(Ordering::Relaxed) != generation {
        return;
    }
    if let Some(row) = index.rows.get_mut(&PathKey::lookup(key(path))) {
        if row.item.modified() != value {
            row.item.set_modified(value);
            s.persistence
                .changes(generation, vec![cache::Change::Put(row.item.entry())]);
        }
    }
}
struct Live<'a> {
    shared: &'a Shared,
    generation: u64,
}
impl FileCatalog for Live<'_> {
    fn lookup(&self, path: &str) -> io::Result<Option<catalog::FileState>> {
        self.shared.index.read().unwrap().lookup(path)
    }
    fn next_file(&self, path: &str) -> io::Result<Option<catalog::FileState>> {
        self.shared.index.read().unwrap().next_file(path)
    }
    fn directory_batch(
        &self,
        after: Option<&PathKey>,
        scope: &Scope,
    ) -> io::Result<catalog::DirectoryBatch> {
        self.shared
            .index
            .read()
            .unwrap()
            .directory_batch(after, scope)
    }
    fn child_batch(&self, parent: &str, after: Option<&str>) -> io::Result<catalog::ChildBatch> {
        self.shared.index.read().unwrap().child_batch(parent, after)
    }
}
impl filesystem::FilesystemIndex for Live<'_> {
    fn cancelled(&self) -> bool {
        self.shared.generation.load(Ordering::Relaxed) != self.generation
    }
    fn remove(&mut self, path: &str) -> io::Result<()> {
        remove(self.shared, path, self.generation);
        Ok(())
    }
    fn update_dir(&mut self, path: &str, modified: u64) -> io::Result<()> {
        update_dir(self.shared, path, modified, self.generation);
        Ok(())
    }
    fn put(&mut self, path: &str, directory: bool, modified: u64) -> io::Result<()> {
        let mut row = Record::new(path.into(), directory, self.generation);
        row.item.set_modified(modified);
        insert(self.shared, &mut vec![row], self.generation);
        Ok(())
    }
    fn walk(
        &mut self,
        path: &str,
        config: &Config,
        scanned: &mut usize,
        issues: &mut usize,
    ) -> io::Result<()> {
        walk(self.shared, path, config, self.generation, scanned, issues);
        Ok(())
    }
}
pub fn refresh(s: Arc<Shared>, paths: Vec<String>, offline: bool) {
    let generation = if offline {
        s.generation.fetch_add(1, Ordering::SeqCst) + 1
    } else {
        s.generation.load(Ordering::SeqCst)
    };
    if offline {
        let mut state = s.state.lock().unwrap();
        state.running = true;
        state.scanned = 0;
        state.error.clear();
        drop(state);
        send(&s);
    }
    thread::spawn(move || {
        let _writer = s.writer.lock().unwrap();
        let _working = Working::start(&s.working);
        if s.generation.load(Ordering::Relaxed) != generation {
            return;
        }
        let config = s.config.lock().unwrap().clone();
        let scope = Scope::new(&config, &s.cache);
        let (mut scanned, mut issues) = (0, 0);
        let mut live = Live {
            shared: &s,
            generation,
        };
        let result = (|| -> io::Result<()> {
            let mut work = paths;
            if offline {
                let pool = jwalk::rayon::ThreadPoolBuilder::new()
                    .num_threads(4)
                    .build()
                    .unwrap();
                let mut cursor: Option<PathKey> = None;
                while !scope.empty() {
                    if s.generation.load(Ordering::Relaxed) != generation {
                        return Ok(());
                    }
                    let batch = live.directory_batch(cursor.as_ref(), &scope)?;
                    let Some(next) = batch.after else { break };
                    let changed: Vec<String> = pool.install(|| {
                        batch
                            .directories
                            .par_iter()
                            .filter_map(|(path, modified)| {
                                if s.generation.load(Ordering::Relaxed) != generation {
                                    return None;
                                }
                                let display = path.display();
                                match fs::symlink_metadata(display.as_ref()) {
                                    Ok(m)
                                        if m.is_dir()
                                            && !m.is_symlink()
                                            && *modified != 0
                                            && stamp(&m) == *modified =>
                                    {
                                        None
                                    }
                                    _ => Some(display.into_owned()),
                                }
                            })
                            .collect()
                    });
                    // Reconcile this bounded batch before reading the next one.
                    // The path cursor survives deletion or subtree replacement;
                    // do not retain every changed directory until verification ends.
                    for path in changed {
                        if s.generation.load(Ordering::Relaxed) != generation {
                            return Ok(());
                        }
                        filesystem::reconcile(
                            &mut live,
                            &path,
                            &config,
                            &scope,
                            &mut scanned,
                            &mut issues,
                        )?;
                    }
                    cursor = Some(next);
                }
                for root in &config.roots {
                    if live.lookup(&key(root))?.is_none() {
                        work.push(root.clone());
                    }
                }
            }
            // Reconcile the parent before advancing its signature; a second buffered event may not have arrived yet.
            if !offline {
                let parents: Vec<_> = work
                    .iter()
                    .filter_map(|p| {
                        Path::new(p)
                            .parent()
                            .map(|p| p.to_string_lossy().into_owned())
                    })
                    .collect();
                work.extend(parents);
            }
            work.sort();
            work.dedup();
            for path in work {
                if s.generation.load(Ordering::Relaxed) != generation {
                    return Ok(());
                }
                filesystem::reconcile(
                    &mut live,
                    &path,
                    &config,
                    &scope,
                    &mut scanned,
                    &mut issues,
                )?;
            }
            if s.generation.load(Ordering::Relaxed) != generation {
                return Ok(());
            }
            Ok(())
        })();
        if s.generation.load(Ordering::Relaxed) != generation {
            return;
        }
        s.index.write().unwrap().paths.collect();
        let mut state = s.state.lock().unwrap();
        if offline {
            state.running = false;
        }
        if let Err(error) = result {
            state.error = format!("目录校验失败：{error}");
        } else if state.error.starts_with("目录校验失败：") {
            state.error.clear();
        }
        state.scanned = scanned;
        state.issues = issues;
        state.updated = now();
        drop(state);
        // Every completed mutation has already queued its cache change. Mark
        // the work finished before observers can immediately request a stop.
        drop(_working);
        send(&s);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_verification_keeps_scope_spelling_and_every_directory() {
        let config = Config {
            roots: vec!["C:\\Scope".into()],
            excluded: vec!["c:/scope/Excluded".into()],
            ..Default::default()
        };
        let scope = Scope::new(&config, "C:\\Scope\\cache.bin");
        assert!(scope.contains("c:\\SCOPE\\Dir.TXT"));
        assert!(!scope.contains("C:\\Scoped\\other"));
        assert!(!scope.contains("C:\\Scope\\Excluded\\Child"));
        assert!(!scope.contains("C:\\Scope\\cache.bin.123.456.tmp"));
        assert!(scope.contains("C:\\Scope\\cache.bin.something"));
        let mut index = Index::default();
        for i in 0..8201 {
            index.put(Record::new(format!("C:\\Scope\\Dir-{i:05}"), true, 1));
        }
        for path in [
            "C:\\Scope\\Excluded\\Child",
            "D:\\Other",
            "C:\\Scope\\cache.bin",
        ] {
            index.put(Record::new(path.into(), true, 1));
        }
        index.put(Record::new("C:\\Scope\\file.txt".into(), false, 1));
        let batch = index.directory_batch(None, &scope).unwrap();
        let (first, cursor) = (batch.directories, batch.after);
        assert!(first.len() <= 8192);
        let batch = index.directory_batch(cursor.as_ref(), &scope).unwrap();
        let (second, last) = (batch.directories, batch.after);
        assert_eq!(first.len() + second.len(), 8201);
        assert!(
            index
                .directory_batch(last.as_ref(), &scope)
                .unwrap()
                .after
                .is_none()
        );
        for (path, _) in first.iter().chain(&second) {
            assert!(path.display().starts_with("C:\\Scope\\Dir-"));
        }
        let empty = Scope::new(&Config::default(), "C:\\Scope\\cache.bin");
        assert!(
            index
                .directory_batch(None, &empty)
                .unwrap()
                .directories
                .is_empty()
        );
    }
}
