//! Filesystem reconciliation uses owned catalog batches and a backend's
//! mutation operations. The same path/type/scope rules can serve mutable or
//! persisted indexes without duplicating Windows filesystem behavior.
use super::*;
use catalog::{FileCatalog, Scope};
use std::collections::BTreeSet;

pub(super) trait FilesystemIndex: FileCatalog {
    fn cancelled(&self) -> bool;
    fn remove(&mut self, path: &str) -> io::Result<()>;
    fn update_dir(&mut self, path: &str, modified: u64) -> io::Result<()>;
    fn put(&mut self, path: &str, directory: bool, modified: u64) -> io::Result<()>;
    fn walk(
        &mut self,
        path: &str,
        config: &Config,
        scanned: &mut usize,
        issues: &mut usize,
    ) -> io::Result<()>;
}

pub(super) fn reconcile(
    sink: &mut impl FilesystemIndex,
    path: &str,
    config: &Config,
    scope: &Scope,
    scanned: &mut usize,
    issues: &mut usize,
) -> io::Result<()> {
    if !scope.contains(path) || sink.cancelled() {
        return Ok(());
    }
    // A changed ancestor can become a junction while a notification is queued.
    for ancestor in Path::new(path).ancestors().skip(1) {
        if !scope.contains(&ancestor.to_string_lossy()) {
            break;
        }
        if fs::symlink_metadata(ancestor).is_ok_and(|m| m.is_symlink()) {
            sink.remove(path)?;
            return Ok(());
        }
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(m) if !m.is_symlink() => m,
        Ok(_) => {
            sink.remove(path)?;
            return Ok(());
        }
        Err(e) => {
            if e.kind() == io::ErrorKind::NotFound {
                sink.remove(path)?;
            } else {
                *issues += 1;
            }
            return Ok(());
        }
    };
    let previous = sink
        .lookup(&key(path))?
        .map(|r| (r.directory, r.path.display().replace('/', "\\")));
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
                return reconcile(sink, &actual, config, scope, scanned, issues);
            }
        }
    }
    if previous.as_ref().map(|r| r.0) != Some(metadata.is_dir())
        || previous
            .as_ref()
            .is_some_and(|r| r.1 != path.replace('/', "\\"))
    {
        if previous.is_some() {
            sink.remove(path)?;
        }
        if metadata.is_dir() {
            sink.walk(path, config, scanned, issues)?;
        } else {
            sink.put(path, false, 0)?;
            *scanned += 1;
        }
        return Ok(());
    }
    // The index stores names, not file contents. Content writes need no reindex/save.
    if !metadata.is_dir() {
        return Ok(());
    }
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => {
            *issues += 1;
            return Ok(());
        }
    };
    let mut complete = true;
    let mut seen = BTreeSet::new();
    let mut added = Vec::new();
    for entry in entries {
        if sink.cancelled() {
            return Ok(());
        }
        let Ok(entry) = entry else {
            *issues += 1;
            complete = false;
            continue;
        };
        let child = entry.path().to_string_lossy().into_owned();
        if !scope.contains(&child) {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            *issues += 1;
            complete = false;
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        let k = key(&child);
        seen.insert(k.clone());
        let previous = sink.lookup(&k)?.map(|r| (r.directory, r.path.to_string()));
        if previous.as_ref().map(|r| r.0) != Some(kind.is_dir())
            || previous.as_ref().is_some_and(|r| r.1 != child)
        {
            if previous.is_some() {
                sink.remove(&child)?;
            }
            added.push(child);
        }
    }
    let mut cursor = None;
    loop {
        if !complete {
            break;
        }
        if sink.cancelled() {
            return Ok(());
        }
        let batch = sink.child_batch(path, cursor.as_deref())?;
        for old in batch.paths {
            if !seen.contains(&old.key().normalized()) {
                sink.remove(old.display().as_ref())?;
            }
        }
        cursor = batch.after;
        if cursor.is_none() {
            break;
        }
    }
    for child in added {
        reconcile(sink, &child, config, scope, scanned, issues)?;
    }
    // A partial enumeration must not publish a signature that lets the next
    // offline verification skip this directory. Retain unconfirmed old rows.
    sink.update_dir(
        path,
        if complete {
            incremental::stamp(&metadata)
        } else {
            0
        },
    )?;
    *scanned += 1;
    Ok(())
}
