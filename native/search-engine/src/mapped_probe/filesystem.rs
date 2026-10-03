//! Filesystem writes over a borrowed mapped base and an owned staging overlay.
//! Commit/persistence belongs to the generation store; no full Index is built.
use super::*;
use crate::catalog::{DirectoryBatch, FileCatalog, FileState, Scope};
use crate::filesystem::FilesystemIndex;
use overlay::Mutation;

pub(super) struct Changes {
    pub overlay: Overlay,
    pub batches: Vec<Vec<Mutation>>,
    pub scanned: usize,
    pub issues: usize,
}
struct Writer<'a, 'v, C> {
    view: &'v View<'a>,
    overlay: Overlay,
    batches: Vec<Vec<Mutation>>,
    changes: usize,
    bytes: usize,
    cache: &'v str,
    limit: usize,
    cancel: &'v C,
}
impl<C: Fn() -> bool + Sync> Writer<'_, '_, C> {
    fn catalog(&self) -> catalog::MappedCatalog<'_, '_> {
        catalog::MappedCatalog {
            view: self.view,
            overlay: &self.overlay,
        }
    }
    fn edit(&mut self, change: Mutation) -> io::Result<()> {
        if self.cancelled() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "目录更新已取消"));
        }
        let bytes = match &change {
            Mutation::Remove(path) => path.len(),
            Mutation::Put(row) => row.path.len() + row.name.len() + 64,
        };
        // Match the generation store's bounded replay history. Refuse the
        // entire staging transaction rather than silently drop later writes.
        if self.changes >= 20_000 || self.bytes + bytes > 8 * 1024 * 1024 {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "目录更新需要分批合并",
            ));
        }
        self.overlay.edit(self.view, change.clone(), self.limit)?;
        if self.batches.last().is_none_or(|batch| batch.len() >= 1024) {
            self.batches.push(Vec::new());
        }
        self.batches.last_mut().unwrap().push(change);
        self.changes += 1;
        self.bytes += bytes;
        Ok(())
    }
}
impl<C: Fn() -> bool + Sync> FileCatalog for Writer<'_, '_, C> {
    fn lookup(&self, path: &str) -> io::Result<Option<FileState>> {
        self.catalog().lookup(path)
    }
    fn next_file(&self, path: &str) -> io::Result<Option<FileState>> {
        self.catalog().next_file(path)
    }
    fn directory_batch(
        &self,
        after: Option<&PathKey>,
        scope: &Scope,
    ) -> io::Result<DirectoryBatch> {
        self.catalog().directory_batch(after, scope)
    }
}
impl<C: Fn() -> bool + Sync> FilesystemIndex for Writer<'_, '_, C> {
    fn cancelled(&self) -> bool {
        (self.cancel)()
    }
    fn remove(&mut self, path: &str) -> io::Result<()> {
        if self.lookup(&key(path))?.is_some() {
            self.edit(Mutation::Remove(path.into()))?;
        }
        Ok(())
    }
    fn update_dir(&mut self, path: &str, modified: u64) -> io::Result<()> {
        if self
            .lookup(&key(path))?
            .is_some_and(|row| row.directory && row.modified != modified)
        {
            self.put(path, true, modified)?;
        }
        Ok(())
    }
    fn put(&mut self, path: &str, directory: bool, modified: u64) -> io::Result<()> {
        let previous = self.lookup(&key(path))?;
        if previous.as_ref().is_some_and(|row| {
            row.directory == directory && row.modified == modified && row.path.display() == path
        }) {
            return Ok(());
        }
        if previous.is_none() && self.overlay.count(self.view) >= self.limit {
            return Ok(());
        }
        self.edit(Mutation::Put(Entry {
            path: path.into(),
            name: String::new(),
            directory,
            modified,
            size: 0,
        }))
    }
    fn walk(
        &mut self,
        path: &str,
        config: &Config,
        scanned: &mut usize,
        issues: &mut usize,
    ) -> io::Result<()> {
        let cancel = self.cancel;
        enumeration::enumerate(
            path,
            self.cache,
            config,
            0,
            scanned,
            issues,
            cancel,
            |rows, _, _| {
                for row in rows {
                    let entry = row.item.entry();
                    self.put(&entry.path, entry.directory, entry.modified)?;
                }
                Ok(!self.cancelled() && self.overlay.count(self.view) < self.limit)
            },
        )
    }
}
pub(super) fn refresh(
    view: &View<'_>,
    overlay: &Overlay,
    config: &Config,
    cache: &str,
    paths: Vec<String>,
    offline: bool,
    cancel: impl Fn() -> bool + Sync,
) -> io::Result<Changes> {
    overlay.check(view)?;
    let scope = Scope::new(config, cache);
    let mut writer = Writer {
        view,
        overlay: overlay.clone(),
        batches: Vec::new(),
        changes: 0,
        bytes: 0,
        cache,
        limit: config.max_entries,
        cancel: &cancel,
    };
    let (mut scanned, mut issues) = (0, 0);
    if offline {
        crate::filesystem::verify(&mut writer, config, &scope, &mut scanned, &mut issues)?;
    }
    let mut work = paths;
    if !offline {
        let parents: Vec<_> = work
            .iter()
            .filter_map(|path| {
                Path::new(path)
                    .parent()
                    .map(|parent| parent.to_string_lossy().into_owned())
            })
            .collect();
        work.extend(parents);
    }
    work.sort();
    work.dedup();
    for path in work {
        crate::filesystem::reconcile(
            &mut writer,
            &path,
            config,
            &scope,
            &mut scanned,
            &mut issues,
        )?;
    }
    if writer.cancelled() {
        return Err(io::Error::new(io::ErrorKind::Interrupted, "目录更新已取消"));
    }
    Ok(Changes {
        overlay: writer.overlay,
        batches: writer.batches,
        scanned,
        issues,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn staged_filesystem_changes_preserve_scope_case_types_and_atomic_cancellation() {
        let dir = std::env::temp_dir().join(format!("one-mapped-fs-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let root = dir.join("files");
        fs::create_dir_all(&root).unwrap();
        let excluded = root.join("excluded");
        fs::create_dir_all(&excluded).unwrap();
        fs::write(excluded.join("hidden.txt"), "x").unwrap();
        let file = root.join("quarter.txt");
        fs::write(&file, "x").unwrap();
        let seed = dir.join("seed.bin");
        image(&Index::default(), &seed).unwrap();
        let map = Mapping::open(&seed).unwrap();
        let view = View::new(map.bytes()).unwrap();
        let config = Config {
            roots: vec![root.to_string_lossy().into_owned()],
            excluded: vec![excluded.to_string_lossy().into_owned()],
            max_entries: 10000,
            ..Default::default()
        };
        let cache = dir.join("cache.bin").to_string_lossy().into_owned();
        let empty = Overlay::load(&view, None).unwrap();
        let first = refresh(&view, &empty, &config, &cache, Vec::new(), true, || false).unwrap();
        assert_eq!(first.issues, 0);
        assert_eq!(first.overlay.count(&view), 2);
        assert_eq!(empty.count(&view), 0);
        let catalog = catalog::MappedCatalog {
            view: &view,
            overlay: &first.overlay,
        };
        assert!(
            catalog
                .lookup(&key(&excluded.to_string_lossy()))
                .unwrap()
                .is_none()
        );
        let renamed = root.join("QUARTER.TXT");
        fs::rename(&file, &renamed).unwrap();
        let case = refresh(
            &view,
            &first.overlay,
            &config,
            &cache,
            vec![renamed.to_string_lossy().into_owned()],
            false,
            || false,
        )
        .unwrap();
        assert_eq!(
            catalog::MappedCatalog {
                view: &view,
                overlay: &case.overlay
            }
            .lookup(&key(&renamed.to_string_lossy()))
            .unwrap()
            .unwrap()
            .path
            .display(),
            renamed.to_string_lossy()
        );
        fs::remove_file(&renamed).unwrap();
        fs::create_dir(&renamed).unwrap();
        fs::write(renamed.join("inside.txt"), "x").unwrap();
        let typed = refresh(
            &view,
            &case.overlay,
            &config,
            &cache,
            Vec::new(),
            true,
            || false,
        )
        .unwrap();
        assert_eq!(typed.overlay.count(&view), 3);
        assert!(
            catalog::MappedCatalog {
                view: &view,
                overlay: &typed.overlay
            }
            .lookup(&key(&renamed.to_string_lossy()))
            .unwrap()
            .unwrap()
            .directory
        );
        for n in 0..8 {
            fs::write(root.join(format!("cancel-{n}.txt")), "x").unwrap();
        }
        let calls = AtomicU64::new(0);
        assert_eq!(
            refresh(
                &view,
                &typed.overlay,
                &config,
                &cache,
                vec![root.to_string_lossy().into_owned()],
                false,
                || calls.fetch_add(1, Ordering::Relaxed) > 4
            )
            .err()
            .unwrap()
            .kind(),
            io::ErrorKind::Interrupted
        );
        assert_eq!(typed.overlay.count(&view), 3);
        let recovered = refresh(
            &view,
            &typed.overlay,
            &config,
            &cache,
            Vec::new(),
            true,
            || false,
        )
        .unwrap();
        assert_eq!(recovered.overlay.count(&view), 11);
        let unchanged = refresh(
            &view,
            &recovered.overlay,
            &config,
            &cache,
            Vec::new(),
            true,
            || false,
        )
        .unwrap();
        assert!(unchanged.batches.is_empty());
        assert_eq!(unchanged.scanned, 0);
        // A wide generated directory must fail as one staging transaction at
        // the overlay bound, retaining the acknowledged predecessor.
        let mut writer = Writer {
            view: &view,
            overlay: typed.overlay.clone(),
            batches: Vec::new(),
            changes: 0,
            bytes: 0,
            cache: &cache,
            limit: 100000,
            cancel: &|| false,
        };
        writer.changes = 20000;
        assert_eq!(
            writer
                .put(&root.join("unpublished.txt").to_string_lossy(), false, 0)
                .unwrap_err()
                .kind(),
            io::ErrorKind::WouldBlock
        );
        assert_eq!(writer.overlay.count(&view), 3);
        drop(map);
        fs::remove_dir_all(dir).unwrap();
    }
}
