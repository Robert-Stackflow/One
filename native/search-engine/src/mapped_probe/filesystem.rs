//! Filesystem writes use bounded overlays over mapped generations. Full
//! batches fold into an unpublished owned base; only the store can publish.
use super::*;
use crate::catalog::{DirectoryBatch, FileCatalog, FileState, Scope};
use crate::filesystem::FilesystemIndex;
use overlay::Mutation;

pub(super) struct Changes {
    // Drop the mapping before its staged file guard on error/cancellation.
    pub map: Arc<Mapping>,
    pub overlay: Overlay,
    pub batches: Vec<Vec<Mutation>>,
    pub stage: Option<Stage>,
    pub folds: usize,
    pub scanned: usize,
    pub issues: usize,
}
pub(super) struct Stage {
    pub id: String,
    pub base: std::path::PathBuf,
    pub delta: std::path::PathBuf,
    guard: Temps,
}
impl Stage {
    fn new(cache: &str) -> io::Result<Self> {
        let id=store::id()?;
        let (base,delta)=store::paths(Path::new(cache).parent().ok_or_else(bad)?,&id);
        Ok(Self {id,guard:Temps(vec![base.clone()]),base,delta})
    }
    pub fn own_delta(&mut self) { self.guard.0.push(self.delta.clone()); }
    pub fn keep(&mut self) { self.guard.0.clear(); }
}
impl Changes {
    pub fn stats(&self) -> io::Result<Value> {
        Ok(self.overlay.stats(&View::new(self.map.bytes())?))
    }
    // JSON expansion can exceed the encoded journal budget even when a batch
    // fits its replay budget. Fold the final overlay rather than lose writes.
    pub fn fold(&mut self, cache: &str, cancel: &impl Fn()->bool) -> io::Result<()> {
        let stage=Stage::new(cache)?;
        compact::run_mapping_cancel(&self.map,&self.overlay,&stage.base,cancel)?;
        let next=Arc::new(Mapping::open(&stage.base)?);
        let overlay=Overlay::load(&View::new(next.bytes())?,None)?;
        self.map=next;
        self.overlay=overlay;
        self.stage=Some(stage);
        self.batches.clear();
        self.folds+=1;
        Ok(())
    }
}
struct Writer<'v, C> {
    map: Arc<Mapping>,
    overlay: Overlay,
    batches: Vec<Vec<Mutation>>,
    stage: Option<Stage>,
    folds: usize,
    changes: usize,
    bytes: usize,
    cache: &'v str,
    limit: usize,
    cancel: &'v C,
    progress: &'v (dyn Fn(usize)+Sync),
}
impl<C: Fn() -> bool + Sync> Writer<'_, C> {
    fn fold(&mut self) -> io::Result<()> {
        (self.progress)(self.folds+1);
        let stage=Stage::new(self.cache)?;
        compact::run_mapping_cancel(&self.map,&self.overlay,&stage.base,self.cancel)?;
        let next=Arc::new(Mapping::open(&stage.base)?);
        let overlay=Overlay::load(&View::new(next.bytes())?,None)?;
        self.map=next;
        self.overlay=overlay;
        // The previous private base can be reclaimed after its view drops.
        self.stage=Some(stage);
        self.batches.clear();self.changes=0;self.bytes=0;self.folds+=1;
        Ok(())
    }
    fn edit(&mut self, change: Mutation) -> io::Result<()> {
        if self.cancelled() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "目录更新已取消"));
        }
        let bytes = match &change {
            Mutation::Remove(path) => path.len(),
            Mutation::Put(row) => row.path.len() + row.name.len() + 64,
        };
        // Keep each replay batch bounded, but continue the transaction in a
        // private generation. Neither partial overlays nor bases are published.
        if self.changes >= 18_000 || self.bytes + bytes > 4 * 1024 * 1024 || self.overlay.nearly_full() {
            self.fold()?;
        }
        let view=View::new(self.map.bytes())?;
        self.overlay.edit(&view, change.clone(), self.limit)?;
        if self.batches.last().is_none_or(|batch| batch.len() >= 1024) {
            self.batches.push(Vec::new());
        }
        self.batches.last_mut().unwrap().push(change);
        self.changes += 1;
        self.bytes += bytes;
        Ok(())
    }
}
impl<C: Fn() -> bool + Sync> FileCatalog for Writer<'_, C> {
    fn lookup(&self, path: &str) -> io::Result<Option<FileState>> {
        let view=View::new(self.map.bytes())?;
        catalog::MappedCatalog {view:&view,overlay:&self.overlay}.lookup(path)
    }
    fn next_file(&self, path: &str) -> io::Result<Option<FileState>> {
        let view=View::new(self.map.bytes())?;
        catalog::MappedCatalog {view:&view,overlay:&self.overlay}.next_file(path)
    }
    fn directory_batch(
        &self,
        after: Option<&PathKey>,
        scope: &Scope,
    ) -> io::Result<DirectoryBatch> {
        let view=View::new(self.map.bytes())?;
        catalog::MappedCatalog {view:&view,overlay:&self.overlay}.directory_batch(after, scope)
    }
}
impl<C: Fn() -> bool + Sync> FilesystemIndex for Writer<'_, C> {
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
        if previous.is_none() && self.overlay.count(&View::new(self.map.bytes())?) >= self.limit {
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
                Ok(!self.cancelled() && self.overlay.count(&View::new(self.map.bytes())?) < self.limit)
            },
        )
    }
}
pub(super) fn refresh(
    map: Arc<Mapping>,
    overlay: &Overlay,
    config: &Config,
    cache: &str,
    paths: Vec<String>,
    offline: bool,
    cancel: impl Fn() -> bool + Sync,
    progress: &(dyn Fn(usize)+Sync),
) -> io::Result<Changes> {
    overlay.check(&View::new(map.bytes())?)?;
    let scope = Scope::new(config, cache);
    let mut writer = Writer {
        map,
        overlay: overlay.clone(),
        batches: Vec::new(),
        stage: None,
        folds: 0,
        changes: 0,
        bytes: 0,
        cache,
        limit: config.max_entries,
        cancel: &cancel,
        progress,
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
        map: writer.map,
        overlay: writer.overlay,
        batches: writer.batches,
        stage: writer.stage,
        folds: writer.folds,
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
        let map = Arc::new(Mapping::open(&seed).unwrap());
        let view = View::new(map.bytes()).unwrap();
        let config = Config {
            roots: vec![root.to_string_lossy().into_owned()],
            excluded: vec![excluded.to_string_lossy().into_owned()],
            max_entries: 10000,
            ..Default::default()
        };
        let cache = dir.join("cache.bin").to_string_lossy().into_owned();
        let empty = Overlay::load(&view, None).unwrap();
        let first = refresh(map.clone(), &empty, &config, &cache, Vec::new(), true, || false, &|_|{}).unwrap();
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
            map.clone(),
            &first.overlay,
            &config,
            &cache,
            vec![renamed.to_string_lossy().into_owned()],
            false,
            || false,
            &|_|{},
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
            map.clone(),
            &case.overlay,
            &config,
            &cache,
            Vec::new(),
            true,
            || false,
            &|_|{},
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
                map.clone(),
                &typed.overlay,
                &config,
                &cache,
                vec![root.to_string_lossy().into_owned()],
                false,
                || calls.fetch_add(1, Ordering::Relaxed) > 4,
                &|_|{},
            )
            .err()
            .unwrap()
            .kind(),
            io::ErrorKind::Interrupted
        );
        assert_eq!(typed.overlay.count(&view), 3);
        let recovered = refresh(
            map.clone(),
            &typed.overlay,
            &config,
            &cache,
            Vec::new(),
            true,
            || false,
            &|_|{},
        )
        .unwrap();
        assert_eq!(recovered.overlay.count(&view), 11);
        let unchanged = refresh(
            map.clone(),
            &recovered.overlay,
            &config,
            &cache,
            Vec::new(),
            true,
            || false,
            &|_|{},
        )
        .unwrap();
        assert!(unchanged.batches.is_empty());
        assert_eq!(unchanged.scanned, 0);
        // A full batch folds privately and continues, retaining the original
        // acknowledged overlay until the store publishes the transaction.
        let mut writer = Writer {
            map: map.clone(),
            overlay: typed.overlay.clone(),
            batches: Vec::new(),
            stage: None,
            folds: 0,
            changes: 0,
            bytes: 0,
            cache: &cache,
            limit: 100000,
            cancel: &|| false,
            progress: &|_|{},
        };
        writer.changes = 20000;
        writer.put(&root.join("unpublished.txt").to_string_lossy(), false, 0).unwrap();
        assert_eq!(writer.folds,1);
        assert!(writer.stage.is_some());
        assert_eq!(writer.overlay.count(&View::new(writer.map.bytes()).unwrap()),4);
        assert_eq!(typed.overlay.count(&view),3);
        drop(writer);
        drop((first,case,typed,recovered,unchanged));
        drop(map);
        fs::remove_dir_all(dir).unwrap();
    }
}
