use super::*;
use jwalk::rayon::prelude::*;
use std::collections::BTreeSet;

pub fn stamp(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |v| v.as_nanos().min(u64::MAX as u128) as u64)
}
struct Scope {
    roots: Vec<String>,
    excluded: Vec<String>,
    cache: String,
}
impl Scope {
    fn new(config: &Config, cache: &str) -> Self {
        Self {
            roots: config.roots.iter().map(|r| key(r)).collect(),
            excluded: config.excluded.iter().map(|r| key(r)).collect(),
            cache: key(cache),
        }
    }
    fn contains_key(&self, path: &str) -> bool {
        !cache::owned_key(path, &self.cache)
            && self.roots.iter().any(|r| under(path, r))
            && !self.excluded.iter().any(|r| under(path, r))
    }
    fn contains(&self, path: &str) -> bool {
        self.contains_key(&key(path))
    }
    fn contains_path(&self, path: &PathKey) -> bool {
        !(path.starts_with(&self.cache) && cache::owned_key(&path.normalized(), &self.cache))
            && self.roots.iter().any(|root| path.under(root))
            && !self.excluded.iter().any(|root| path.under(root))
    }
}
// Keep metadata checking bounded, including when the cache contains millions of rows.
// Clone shared paths only for directories in the current indexing scope.
fn verification_batch(
    index: &Index,
    after: Option<&PathKey>,
    scope: &Scope,
) -> (Vec<(stored_path::StoredPath, u64)>, Option<PathKey>) {
    const ROWS: usize = 8192;
    let start = after.cloned().map_or(Bound::Unbounded, Bound::Excluded);
    let mut directories = Vec::new();
    let mut last = None;
    for (k, row) in index.rows.range((start, Bound::Unbounded)).take(ROWS) {
        last = Some(k);
        if row.item.directory && scope.contains_path(k) {
            directories.push((row.item.path.clone(), row.item.modified));
        }
    }
    (directories, last.cloned())
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
        if row.item.modified != value {
            row.item.modified = value;
            s.persistence
                .changes(generation, vec![cache::Change::Put(row.item.entry())]);
        }
    }
}
// Seek past nested subtrees instead of walking every descendant for a shallow change.
fn direct_children(s: &Shared, path: &str) -> Vec<String> {
    let index = s.index.read().unwrap();
    let prefix = format!("{}\\", key(path));
    let mut cursor = prefix.clone();
    let mut result = Vec::new();
    loop {
        let Some((k, row)) = index
            .rows
            .range((Bound::Included(PathKey::lookup(&cursor)), Bound::Unbounded))
            .next()
        else {
            break;
        };
        if !k.starts_with(&prefix) {
            break;
        }
        let full = k.normalized();
        let relative = &full[prefix.len()..];
        if let Some(at) = relative.find('\\') {
            cursor = format!("{}{}\\\u{10ffff}", prefix, &relative[..at]);
        } else {
            result.push(row.item.path.to_string());
            cursor = format!("{k}\0");
        }
    }
    result
}
fn reconcile(
    s: &Shared,
    path: &str,
    config: &Config,
    scope: &Scope,
    generation: u64,
    scanned: &mut usize,
    issues: &mut usize,
) {
    if !scope.contains(path) || s.generation.load(Ordering::Relaxed) != generation {
        return;
    }
    // A changed ancestor can become a junction while a notification is queued.
    for ancestor in Path::new(path).ancestors().skip(1) {
        if !scope.contains(&ancestor.to_string_lossy()) {
            break;
        }
        if fs::symlink_metadata(ancestor).is_ok_and(|m| m.is_symlink()) {
            remove(s, path, generation);
            return;
        }
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(m) if !m.is_symlink() => m,
        Ok(_) => {
            remove(s, path, generation);
            return;
        }
        Err(e) => {
            if e.kind() == io::ErrorKind::NotFound {
                remove(s, path, generation);
            } else {
                *issues += 1;
            }
            return;
        }
    };
    let previous = s
        .index
        .read()
        .unwrap()
        .rows
        .get(&PathKey::lookup(key(path)))
        .map(|r| (r.item.directory, r.item.path.display().replace('/', "\\")));
    if previous
        .as_ref()
        .is_some_and(|r| r.1 != path.replace('/', "\\"))
    {
        if let Ok(actual) = fs::canonicalize(path) {
            let actual = actual.to_string_lossy();
            let actual = if let Some(rest) = actual.strip_prefix("\\\\?\\UNC\\") {
                format!("\\\\{rest}")
            } else {
                actual
                    .strip_prefix("\\\\?\\")
                    .unwrap_or(&actual)
                    .to_string()
            };
            if actual != path {
                reconcile(s, &actual, config, scope, generation, scanned, issues);
                return;
            }
        }
    }
    if previous.as_ref().map(|r| r.0) != Some(metadata.is_dir())
        || previous
            .as_ref()
            .is_some_and(|r| r.1 != path.replace('/', "\\"))
    {
        if previous.is_some() {
            remove(s, path, generation);
        }
        if metadata.is_dir() {
            walk(s, path, config, generation, scanned, issues);
        } else {
            insert(
                s,
                &mut vec![Record::new(path.into(), false, generation)],
                generation,
            );
            *scanned += 1;
        }
        return;
    }
    // The index stores names, not file contents. Content writes need no reindex/save.
    if !metadata.is_dir() {
        return;
    }
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => {
            *issues += 1;
            return;
        }
    };
    let mut seen = BTreeSet::new();
    let mut added = Vec::new();
    for entry in entries {
        let Ok(entry) = entry else {
            *issues += 1;
            continue;
        };
        let child = entry.path().to_string_lossy().into_owned();
        if !scope.contains(&child) {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            *issues += 1;
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        let k = key(&child);
        seen.insert(k.clone());
        let previous = s
            .index
            .read()
            .unwrap()
            .rows
            .get(&PathKey::lookup(&k))
            .map(|r| (r.item.directory, r.item.path.to_string()));
        if previous.as_ref().map(|r| r.0) != Some(kind.is_dir())
            || previous.as_ref().is_some_and(|r| r.1 != child)
        {
            if previous.is_some() {
                remove(s, &child, generation);
            }
            added.push(child);
        }
    }
    for old in direct_children(s, path) {
        if !seen.contains(&key(&old)) {
            remove(s, &old, generation);
        }
    }
    for child in added {
        reconcile(s, &child, config, scope, generation, scanned, issues);
    }
    update_dir(s, path, stamp(&metadata), generation);
    *scanned += 1;
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
        let mut work = paths;
        if offline {
            let pool = jwalk::rayon::ThreadPoolBuilder::new()
                .num_threads(4)
                .build()
                .unwrap();
            let mut cursor: Option<PathKey> = None;
            while !scope.roots.is_empty() {
                if s.generation.load(Ordering::Relaxed) != generation {
                    return;
                }
                let (dirs, next) =
                    verification_batch(&s.index.read().unwrap(), cursor.as_ref(), &scope);
                let Some(next) = next else { break };
                let changed: Vec<String> = pool.install(|| {
                    dirs.par_iter()
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
                work.extend(changed);
                cursor = Some(next);
            }
            for root in &config.roots {
                if !s
                    .index
                    .read()
                    .unwrap()
                    .rows
                    .contains_key(&PathKey::lookup(key(root)))
                {
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
                return;
            }
            reconcile(
                &s,
                &path,
                &config,
                &scope,
                generation,
                &mut scanned,
                &mut issues,
            );
        }
        if s.generation.load(Ordering::Relaxed) != generation {
            return;
        }
        s.index.write().unwrap().paths.collect();
        let mut state = s.state.lock().unwrap();
        if offline {
            state.running = false;
        }
        state.scanned = scanned;
        state.issues = issues;
        state.updated = now();
        drop(state);
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
        let (first, cursor) = verification_batch(&index, None, &scope);
        assert!(first.len() <= 8192);
        let (second, last) = verification_batch(&index, cursor.as_ref(), &scope);
        assert_eq!(first.len() + second.len(), 8201);
        assert!(
            verification_batch(&index, last.as_ref(), &scope)
                .1
                .is_none()
        );
        for (path, _) in first.iter().chain(&second) {
            assert!(path.display().starts_with("C:\\Scope\\Dir-"));
        }
        let empty = Scope::new(&Config::default(), "C:\\Scope\\cache.bin");
        assert!(verification_batch(&index, None, &empty).0.is_empty());
    }
}
