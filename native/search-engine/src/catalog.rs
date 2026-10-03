//! Filesystem metadata access shared by live reconciliation and mapped indexes.
//! Owned results cover only a bounded batch; callers can release their index
//! read lock before touching the filesystem or applying changes.
use super::*;

pub(super) const DIRECTORY_ROWS: usize = 8192;
pub(super) const DIRECTORY_BYTES: usize = 4 * 1024 * 1024;
const CHILDREN: usize = 512;

pub(super) struct Scope {
    roots: Vec<String>,
    excluded: Vec<String>,
    cache: String,
}
impl Scope {
    pub fn new(config: &Config, cache: &str) -> Self {
        Self {
            roots: config.roots.iter().map(|r| key(r)).collect(),
            excluded: config.excluded.iter().map(|r| key(r)).collect(),
            cache: key(cache),
        }
    }
    pub fn empty(&self) -> bool {
        self.roots.is_empty()
    }
    pub fn contains(&self, path: &str) -> bool {
        let normalized = key(path);
        !cache::owned_key(&normalized, &self.cache)
            && self.roots.iter().any(|r| under(&normalized, r))
            && !self.excluded.iter().any(|r| under(&normalized, r))
    }
    pub fn contains_path(&self, path: &impl SearchPath) -> bool {
        !(path.starts_with(&self.cache)
            && cache::owned_key(&format!("{}{}", path.prefix(), path.name()), &self.cache))
            && self.roots.iter().any(|root| path.under(root))
            && !self.excluded.iter().any(|root| path.under(root))
    }
}

pub(super) struct FileState {
    pub path: stored_path::StoredPath,
    pub directory: bool,
    pub modified: u64,
}
impl FileState {
    pub fn record(row: &Record) -> Self {
        Self {
            path: row.item.path.clone(),
            directory: row.item.directory(),
            modified: row.item.modified(),
        }
    }
}
pub(super) struct DirectoryBatch {
    pub directories: Vec<(stored_path::StoredPath, u64)>,
    pub after: Option<PathKey>,
}
pub(super) struct ChildBatch {
    pub paths: Vec<stored_path::StoredPath>,
    pub after: Option<String>,
}

pub(super) trait FileCatalog {
    /// Keys are already normalized. Results retain the original path spelling.
    fn lookup(&self, normalized: &str) -> io::Result<Option<FileState>>;
    fn next_file(&self, normalized: &str) -> io::Result<Option<FileState>>;
    fn directory_batch(&self, after: Option<&PathKey>, scope: &Scope)
    -> io::Result<DirectoryBatch>;

    fn child_batch(&self, parent: &str, after: Option<&str>) -> io::Result<ChildBatch> {
        let prefix = format!("{}\\", key(parent));
        let mut cursor = after.unwrap_or(&prefix).to_owned();
        let mut paths = Vec::new();
        let mut finished = false;
        let mut bytes = 0;
        // Seek past a nested subtree, rather than enumerate every descendant.
        // Limit both emitted children and inspected roots so callers can check
        // cancellation even when no direct child record exists in the index.
        for _ in 0..DIRECTORY_ROWS {
            let Some(row) = self.next_file(&cursor)? else {
                finished = true;
                break;
            };
            let normalized = row.path.key();
            if !normalized.starts_with(&prefix) {
                finished = true;
                break;
            }
            let full = normalized.normalized();
            if let Some(at) = full[prefix.len()..].find('\\') {
                // ']' is the exclusive successor of '\\', including a child
                // whose next component starts with the highest Unicode scalar.
                cursor = format!("{}{}]", prefix, &full[prefix.len()..prefix.len() + at]);
            } else {
                cursor = format!("{full}\0");
                bytes += full.len();
                paths.push(row.path);
            }
            if paths.len() >= CHILDREN || bytes >= DIRECTORY_BYTES {
                break;
            }
        }
        Ok(ChildBatch {
            paths,
            after: (!finished).then_some(cursor),
        })
    }
}
impl FileCatalog for Index {
    fn lookup(&self, normalized: &str) -> io::Result<Option<FileState>> {
        Ok(self
            .rows
            .get(&PathKey::lookup(normalized))
            .map(FileState::record))
    }
    fn next_file(&self, normalized: &str) -> io::Result<Option<FileState>> {
        Ok(self
            .rows
            .range((
                Bound::Included(PathKey::lookup(normalized)),
                Bound::Unbounded,
            ))
            .next()
            .map(|(_, row)| FileState::record(row)))
    }
    fn directory_batch(
        &self,
        after: Option<&PathKey>,
        scope: &Scope,
    ) -> io::Result<DirectoryBatch> {
        let start = after.cloned().map_or(Bound::Unbounded, Bound::Excluded);
        let mut directories = Vec::new();
        let mut last = None;
        let mut bytes = 0;
        for (path, row) in self
            .rows
            .range((start, Bound::Unbounded))
            .take(DIRECTORY_ROWS)
        {
            last = Some(path);
            if row.item.directory() && scope.contains_path(path) {
                bytes += path.prefix().len() + path.name().len();
                directories.push((row.item.path.clone(), row.item.modified()));
                if bytes >= DIRECTORY_BYTES {
                    break;
                }
            }
        }
        Ok(DirectoryBatch {
            directories,
            after: last.cloned(),
        })
    }
}

/// Metadata protocol used by the mapped worker and generation store. These are
/// catalog operations, not search requests, so they do not cancel a query scope.
pub(super) fn request(catalog: &impl FileCatalog, v: &Value) -> io::Result<Value> {
    let text = |name: &str, optional: bool| -> io::Result<&str> {
        let value = if optional && v[name].is_null() {
            ""
        } else {
            v[name]
                .as_str()
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "目录参数无效"))?
        };
        if value.len() > 131_073 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "目录参数过长"));
        }
        Ok(value)
    };
    match v["type"].as_str().unwrap_or("") {
        "metadata" => {
            let row = catalog.lookup(&key(text("path", false)?))?;
            Ok(row.map_or(Value::Null, |row| json!({"path":row.path.display(),"directory":row.directory,"modified":row.modified})))
        }
        "directories" => {
            let config: Config = serde_json::from_value(v["settings"].clone())
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "目录范围无效"))?;
            let scope = Scope::new(&config, text("cache", false)?);
            let after = text("after", true)?;
            let after = (!after.is_empty()).then(|| PathKey::lookup(key(after)));
            let batch = catalog.directory_batch(after.as_ref(), &scope)?;
            Ok(
                json!({"items":batch.directories.into_iter().map(|(path, modified)|json!({"path":path.display(),"modified":modified})).collect::<Vec<_>>(),"after":batch.after.map(|path|path.normalized())}),
            )
        }
        "children" => {
            let parent = text("path", false)?;
            let after = text("after", true)?;
            let prefix = format!("{}\\", key(parent));
            if !after.is_empty() && !after.starts_with(&prefix) {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "目录游标无效"));
            }
            let batch = catalog.child_batch(parent, (!after.is_empty()).then_some(after))?;
            Ok(
                json!({"items":batch.paths.into_iter().map(|p|p.display().into_owned()).collect::<Vec<_>>(),"after":batch.after}),
            )
        }
        _ => Err(io::Error::new(io::ErrorKind::InvalidInput, "目录操作无效")),
    }
}
