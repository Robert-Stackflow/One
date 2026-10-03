//! Borrow metadata from the base/overlay union through the live reconciliation
//! interface. File mappings stay with the caller, not with returned batches.
use super::*;
use crate::catalog::{
    DIRECTORY_BYTES, DIRECTORY_ROWS, DirectoryBatch, FileCatalog, FileState, Scope,
};

pub(super) struct MappedCatalog<'a, 'v> {
    pub view: &'v View<'a>,
    pub overlay: &'a Overlay,
}
impl MappedCatalog<'_, '_> {
    fn state(&self, candidate: Candidate<'_>) -> io::Result<FileState> {
        match candidate {
            Candidate::Extra(_, row) => Ok(FileState::record(row)),
            Candidate::Base(id) => {
                let row = self.view.row(id)?;
                Ok(FileState {
                    path: stored_path::StoredPath::new(format!(
                        "{}{}",
                        row.exact_prefix, row.exact_name
                    )),
                    directory: row.directory(),
                    modified: row.modified,
                })
            }
        }
    }
}
impl FileCatalog for MappedCatalog<'_, '_> {
    fn lookup(&self, normalized: &str) -> io::Result<Option<FileState>> {
        let Some(row) = self.next_file(normalized)? else {
            return Ok(None);
        };
        Ok((row.path.key() == &PathKey::lookup(normalized)).then_some(row))
    }
    fn next_file(&self, normalized: &str) -> io::Result<Option<FileState>> {
        self.overlay.check(self.view)?;
        // A point lookup does not scan or restore the base.
        self.overlay
            .iter_from(self.view, normalized)?
            .next()
            .transpose()?
            .map(|row| self.state(row))
            .transpose()
    }
    fn directory_batch(
        &self,
        after: Option<&PathKey>,
        scope: &Scope,
    ) -> io::Result<DirectoryBatch> {
        self.overlay.check(self.view)?;
        let lower = after.map_or(String::new(), |key| format!("{}\0", key.normalized()));
        let mut directories = Vec::new();
        let mut last = None;
        let mut bytes = 0;
        for candidate in self
            .overlay
            .iter_from(self.view, &lower)?
            .take(DIRECTORY_ROWS)
        {
            let candidate = candidate?;
            let path = match candidate {
                Candidate::Base(id) => self.view.path(id)?,
                Candidate::Extra(path, _) => Fragments::from_key(path),
            };
            // Only the final cursor needs to own its normalized full path.
            last = Some(path);
            let directory = match &candidate {
                Candidate::Base(id) => self.view.directory(*id)?,
                Candidate::Extra(_, row) => row.item.directory(),
            };
            if directory && scope.contains_path(&path) {
                let row = self.state(candidate)?;
                bytes += row.path.key().prefix().len() + row.path.key().name().len();
                directories.push((row.path, row.modified));
                if bytes >= DIRECTORY_BYTES {
                    break;
                }
            }
        }
        Ok(DirectoryBatch {
            directories,
            after: last.map(|path| PathKey::new(format!("{}{}", path.prefix, path.name))),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use overlay::Mutation;
    fn compare(index: &Index, catalog: &impl FileCatalog, config: &Config, cache: &str) {
        let scope = Scope::new(config, cache);
        let mut cursor = None;
        let mut seen = 0;
        loop {
            let memory = index.directory_batch(cursor.as_ref(), &scope).unwrap();
            let disk = catalog.directory_batch(cursor.as_ref(), &scope).unwrap();
            assert_eq!(
                memory.after.as_ref().map(PathKey::normalized),
                disk.after.as_ref().map(PathKey::normalized)
            );
            assert_eq!(memory.directories.len(), disk.directories.len());
            for ((a, am), (b, bm)) in memory.directories.iter().zip(&disk.directories) {
                assert_eq!(a.display(), b.display());
                assert_eq!(am, bm);
                seen += 1;
            }
            assert!(disk.directories.len() <= DIRECTORY_ROWS);
            let bytes: usize = disk
                .directories
                .iter()
                .map(|(p, _)| p.key().prefix().len() + p.key().name().len())
                .sum();
            assert!(bytes <= DIRECTORY_BYTES + 131_072);
            if let Some(next) = disk.after {
                assert!(cursor.as_ref().is_none_or(|last| last < &next));
                cursor = Some(next);
            } else {
                break;
            }
        }
        assert_eq!(
            seen,
            index
                .rows
                .iter()
                .filter(|(path, row)| row.item.directory() && scope.contains_path(*path))
                .count()
        );
        for parent in &config.roots {
            let prefix = format!("{}\\", key(parent));
            let expected: Vec<_> = index
                .rows
                .iter()
                .filter(|(p, _)| {
                    p.starts_with(&prefix) && !p.normalized()[prefix.len()..].contains('\\')
                })
                .map(|(_, r)| r.item.path.display().into_owned())
                .collect();
            let mut cursor = None;
            let mut actual = Vec::new();
            loop {
                let batch = catalog.child_batch(parent, cursor.as_deref()).unwrap();
                assert!(batch.paths.len() <= 512);
                actual.extend(batch.paths.into_iter().map(|p| p.display().into_owned()));
                if let Some(next) = batch.after {
                    assert!(cursor.as_ref().is_none_or(|last| last < &next));
                    cursor = Some(next);
                } else {
                    break;
                }
            }
            assert_eq!(expected, actual);
        }
        for (key, row) in index.rows.iter().step_by(97) {
            let disk = catalog.lookup(&key.normalized()).unwrap().unwrap();
            assert_eq!(row.item.path.display(), disk.path.display());
            assert_eq!(row.item.directory(), disk.directory);
            assert_eq!(row.item.modified(), disk.modified);
        }
        assert!(catalog.lookup("d:\\never-indexed").unwrap().is_none());
    }
    #[test]
    fn metadata_batches_follow_union_mutations_and_compaction_without_losing_spelling() {
        let dir = std::env::temp_dir().join(format!("one-catalog-union-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("base.bin");
        let config = Config {
            roots: vec!["D:\\Root".into(), "\\\\Server\\Share".into()],
            excluded: vec!["D:\\Root\\Excluded".into()],
            ..Default::default()
        };
        let mut index = Index::default();
        for n in 0..18_000 {
            let mut row = Record::new(format!("D:\\Root\\item-{n:05}"), n % 2 == 0, 0);
            row.item
                .set_modified(if n % 2 == 0 { n as u64 + 1 } else { 0 });
            index.put(row);
        }
        for path in [
            "D:\\Root",
            "D:\\Root\\Excluded",
            "D:\\Root\\Excluded\\Child",
            "D:\\Root-adjacent",
            "D:\\Root\\Cache.bin",
            "D:\\Root\\Cache.bin.delta",
            "D:\\Root\\Cache.bin.keep",
            "D:/Root/Σ.TXT",
            "D:\\Root\\İstanbul",
            "\\\\Server\\Share",
            "\\\\Server\\Share\\目录",
        ] {
            let mut row = Record::new(path.into(), true, 0);
            row.item.set_modified(17);
            index.put(row);
        }
        for n in 0..300 {
            for parent in ["D:\\Root\\item-00000", "D:\\Root\\Missing"] {
                index.put(Record::new(
                    format!("{parent}\\\u{10ffff}-{n:04}.txt"),
                    false,
                    0,
                ));
            }
        }
        image(&index, &file).unwrap();
        let map = Mapping::open(&file).unwrap();
        let view = View::new(map.bytes()).unwrap();
        let mut overlay = Overlay::load(&view, None).unwrap();
        compare(
            &index,
            &MappedCatalog {
                view: &view,
                overlay: &overlay,
            },
            &config,
            "D:\\Root\\Cache.bin",
        );
        let changes = vec![
            Mutation::Remove("D:\\Root\\item-00000".into()),
            Mutation::Remove("D:\\Root\\item-00003".into()),
            Mutation::Put(Entry {
                path: "D:\\Root\\ITEM-00002".into(),
                name: String::new(),
                directory: false,
                modified: 0,
                size: 0,
            }),
            Mutation::Put(Entry {
                path: "D:\\Root\\新建目录".into(),
                name: String::new(),
                directory: true,
                modified: 56,
                size: 0,
            }),
        ];
        overlay.apply(&view, changes.clone(), 100_000).unwrap();
        for change in changes {
            match change {
                Mutation::Remove(path) => {
                    erase(&mut index, &path);
                }
                Mutation::Put(item) => {
                    let mut row = Record::new(item.path, item.directory, 0);
                    row.item.set_modified(item.modified);
                    index.put(row);
                }
            }
        }
        compare(
            &index,
            &MappedCatalog {
                view: &view,
                overlay: &overlay,
            },
            &config,
            "D:\\Root\\Cache.bin",
        );
        let compacted = dir.join("compacted.bin");
        compact::run(&file, &overlay, &compacted, &AtomicBool::new(false)).unwrap();
        drop(map);
        let map = Mapping::open(&compacted).unwrap();
        let view = View::new(map.bytes()).unwrap();
        let empty = Overlay::load(&view, None).unwrap();
        compare(
            &index,
            &MappedCatalog {
                view: &view,
                overlay: &empty,
            },
            &config,
            "D:\\Root\\Cache.bin",
        );
        // Metadata operations do not affect a search ticket; malformed cursors
        // are rejected rather than causing a directory walk outside its scope.
        let catalog = MappedCatalog {
            view: &view,
            overlay: &empty,
        };
        let request = json!({"type":"metadata","path":"d:/root/ITEM-00002"});
        assert_eq!(
            crate::catalog::request(&index, &request).unwrap(),
            crate::catalog::request(&catalog, &request).unwrap()
        );
        assert!(
            crate::catalog::request(
                &catalog,
                &json!({"type":"children","path":"D:\\Root","after":"d:\\other"})
            )
            .is_err()
        );
        drop(map);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn long_directory_batches_have_a_text_budget_and_resume_after_a_deleted_cursor() {
        let dir = std::env::temp_dir().join(format!("one-catalog-text-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("base.bin");
        let config = Config {
            roots: vec!["D:\\Long".into()],
            ..Default::default()
        };
        let scope = Scope::new(&config, "D:\\cache.bin");
        let mut index = Index::default();
        for n in 0..2100 {
            index.put(Record::new(
                format!("D:\\Long\\{}-{n:04}", "a".repeat(3000)),
                true,
                0,
            ));
        }
        image(&index, &file).unwrap();
        let map = Mapping::open(&file).unwrap();
        let view = View::new(map.bytes()).unwrap();
        let mut overlay = Overlay::load(&view, None).unwrap();
        compare(
            &index,
            &MappedCatalog {
                view: &view,
                overlay: &overlay,
            },
            &config,
            "D:\\cache.bin",
        );
        let first = index.directory_batch(None, &scope).unwrap();
        assert!(first.directories.len() < 2100 && first.directories.len() < DIRECTORY_ROWS);
        let cursor = first.after.unwrap();
        let last = index.rows.get(&cursor).unwrap().item.path.to_string();
        erase(&mut index, &last);
        overlay
            .apply(&view, vec![Mutation::Remove(last)], 10_000)
            .unwrap();
        let memory = index.directory_batch(Some(&cursor), &scope).unwrap();
        let disk = MappedCatalog {
            view: &view,
            overlay: &overlay,
        }
        .directory_batch(Some(&cursor), &scope)
        .unwrap();
        assert_eq!(first.directories.len() + disk.directories.len(), 2100);
        assert_eq!(memory.directories.len(), disk.directories.len());
        assert_eq!(
            memory.after.unwrap().normalized(),
            disk.after.unwrap().normalized()
        );
        drop(map);
        fs::remove_dir_all(dir).unwrap();
    }
}

pub(super) fn request(path: &Path, overlay: &Overlay, v: &Value) -> io::Result<Value> {
    let map = Mapping::open(path)?;
    let view = View::new(map.bytes())?;
    crate::catalog::request(
        &MappedCatalog {
            view: &view,
            overlay,
        },
        v,
    )
}
