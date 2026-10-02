use crate::output;
use serde::Serialize;
use serde_json::json;
use std::{
    collections::HashMap,
    fs,
    io::{self, BufRead},
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Instant, UNIX_EPOCH},
};

#[derive(Clone, Serialize)]
struct Node {
    path: String,
    name: String,
    directory: bool,
    size: u64,
    modified: u64,
    parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    issue: Option<String>,
}
struct Scan {
    root: String,
    dirs: HashMap<String, Node>,
    dirty: HashMap<String, Node>,
    files: usize,
    directories: usize,
    issues: Vec<String>,
    issue_count: usize,
    last: Instant,
    current: String,
}
impl Scan {
    fn issue(&mut self, node: &mut Node, message: String) {
        node.issue = Some(message.clone());
        self.issue_count += 1;
        if self.issues.len() < 10000 {
            self.issues.push(format!("{}：{}", node.path, message));
        }
    }
    fn emit(&mut self, force: bool) {
        if !force && self.last.elapsed().as_millis() < 120 && self.dirty.len() < 1800 {
            return;
        }
        output(
            json!({"progress":{"rootPath":self.root,"files":self.files,"directories":self.directories,"bytes":self.dirs[&self.root].size,"path":self.current,"issues":self.issue_count,"nodes":self.dirty.values().collect::<Vec<_>>()}}),
        );
        self.dirty.clear();
        self.last = Instant::now();
    }
}
pub fn run(root: String) {
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = cancel.clone();
    thread::spawn(move || {
        let mut line = String::new();
        let _ = io::stdin().lock().read_line(&mut line);
        flag.store(true, Ordering::Relaxed);
    });
    let result = scan(root, cancel);
    if let Err(error) = result {
        output(json!({"error":error}));
    }
}
fn scan(root: String, cancel: Arc<AtomicBool>) -> Result<(), String> {
    let meta = fs::symlink_metadata(&root).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("请选择目录，不支持目录连接".into());
    }
    let first = Node {
        path: root.clone(),
        name: Path::new(&root)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or(root.clone()),
        directory: true,
        size: 0,
        modified: 0,
        parent: None,
        issue: None,
    };
    let mut s = Scan {
        root: root.clone(),
        dirs: HashMap::from([(root.clone(), first.clone())]),
        dirty: HashMap::from([(root.clone(), first)]),
        files: 0,
        directories: 0,
        issues: Vec::new(),
        issue_count: 0,
        last: Instant::now(),
        current: root.clone(),
    };
    s.emit(true);
    let flag = cancel.clone();
    // Metadata is collected on the directory workers, keeping slow filesystem calls off the renderer.
    let walker = jwalk::WalkDirGeneric::<((), Option<Result<fs::Metadata, String>>)>::new(&root)
        .skip_hidden(false)
        .follow_links(false)
        .parallelism(jwalk::Parallelism::RayonNewPool(4))
        .process_read_dir(move |_, _, _, children| {
            if flag.load(Ordering::Relaxed) {
                children.clear();
                return;
            }
            for entry in children.iter_mut().flatten() {
                entry.client_state =
                    Some(fs::symlink_metadata(entry.path()).map_err(|e| e.to_string()));
                if entry.client_state.as_ref().is_some_and(|m| {
                    m.as_ref()
                        .map_or(true, |m| m.file_type().is_symlink() || !m.is_dir())
                }) {
                    entry.read_children = None;
                }
            }
        });
    for result in walker {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        match result {
            Ok(mut entry) => {
                let path = entry.path().to_string_lossy().into_owned();
                s.current = path.clone();
                let parent = if path == root {
                    None
                } else {
                    entry
                        .path()
                        .parent()
                        .map(|p| p.to_string_lossy().into_owned())
                };
                let mut node = Node {
                    path: path.clone(),
                    name: entry.file_name.to_string_lossy().into_owned(),
                    directory: entry.file_type.is_dir(),
                    size: 0,
                    modified: 0,
                    parent,
                    issue: None,
                };
                match entry
                    .client_state
                    .take()
                    .unwrap_or_else(|| fs::symlink_metadata(&path).map_err(|e| e.to_string()))
                {
                    Ok(meta) => {
                        node.modified = meta
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map_or(0, |t| t.as_millis() as u64);
                        if meta.file_type().is_symlink() {
                            s.issue(&mut node, "跳过符号链接/目录连接".into());
                        } else if meta.is_dir() {
                            s.directories += 1;
                        } else if meta.is_file() {
                            node.size = meta.len();
                            s.files += 1;
                            let mut parent = node.parent.clone();
                            while let Some(path) = parent {
                                let Some(dir) = s.dirs.get_mut(&path) else {
                                    break;
                                };
                                dir.size = dir.size.saturating_add(node.size);
                                parent = dir.parent.clone();
                                s.dirty.insert(path, dir.clone());
                            }
                        }
                    }
                    Err(error) => s.issue(&mut node, error),
                }
                if let Some(error) = entry.read_children.as_ref().and_then(|r| r.error()) {
                    s.issue(&mut node, error.to_string());
                }
                if node.directory {
                    s.dirs.insert(path.clone(), node.clone());
                }
                s.dirty.insert(path, node);
            }
            Err(error) => {
                let path = error
                    .path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or(root.clone());
                if let Some(mut node) = s.dirs.get(&path).cloned() {
                    s.issue(&mut node, error.to_string());
                    s.dirs.insert(path.clone(), node.clone());
                    s.dirty.insert(path, node);
                } else {
                    s.issue_count += 1;
                    if s.issues.len() < 10000 {
                        s.issues.push(error.to_string());
                    }
                }
            }
        };
        s.emit(false);
    }
    s.emit(true);
    if cancel.load(Ordering::Relaxed) {
        return Err("扫描已取消".into());
    }
    if s.issue_count > s.issues.len() {
        s.issues.push(format!(
            "另有 {} 项异常未展开",
            s.issue_count - s.issues.len()
        ));
    }
    output(
        json!({"result":{"rootPath":root,"bytes":s.dirs[&s.root].size,"files":s.files,"directories":s.directories,"issues":s.issues}}),
    );
    Ok(())
}
