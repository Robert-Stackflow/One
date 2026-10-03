mod cache;
mod cleanup;
mod disk;
mod enumeration;
mod incremental;
mod maintenance;
mod path_key;
mod rows;
mod stored_path;
use path_key::{PathKey, PathPool};
use pinyin::ToPinyinMulti;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    borrow::Cow,
    cmp::Reverse,
    collections::{BTreeMap, BinaryHeap},
    fs::{self, File},
    io::{self, BufRead, BufReader, BufWriter, Write},
    ops::Bound,
    path::Path,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

fn default_limit() -> usize {
    2_000_000
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn output(value: Value) {
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let _ = serde_json::to_writer(&mut out, &value);
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}
fn key(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}
fn under(path: &str, root: &str) -> bool {
    path == root || path.strip_prefix(root).is_some_and(|s| s.starts_with('\\'))
}
fn erase(index: &mut Index, path: &str) -> bool {
    let k = key(path);
    let removed = index.rows.remove(&PathKey::lookup(&k));
    if removed.as_ref().is_some_and(|r| r.item.directory()) {
        let prefix = format!("{k}\\");
        let keys: Vec<_> = index
            .rows
            .range((Bound::Included(PathKey::lookup(&prefix)), Bound::Unbounded))
            .take_while(|(p, _)| p.starts_with(&prefix))
            .map(|(p, _)| p.clone())
            .collect();
        for p in keys {
            index.rows.remove(&p);
        }
    }
    removed.is_some()
}
fn mask(s: &str) -> u128 {
    s.chars().fold(0, |v, c| {
        v | (1u128 << ((c as u32).wrapping_mul(2654435761) % 127))
    })
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct Config {
    roots: Vec<String>,
    excluded: Vec<String>,
    #[serde(default = "default_limit", rename = "maxEntries")]
    max_entries: usize,
}
#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    path: String,
    name: String,
    directory: bool,
    modified: u64,
    size: u64,
}
// File rows share their normalized path with the ordered index; only spelling bits are retained.
#[derive(Clone)]
struct StoredEntry {
    path: stored_path::StoredPath,
    metadata: Metadata,
}
#[derive(Clone)]
enum Metadata {
    File,
    FileText(Box<SearchText>),
    Directory(u64),
    DirectoryText(Box<DirectoryText>),
    Launcher(Box<LauncherMetadata>),
}
#[derive(Clone)]
struct DirectoryText {
    modified: u64,
    text: SearchText,
}
#[derive(Clone)]
struct LauncherMetadata {
    name: Box<str>,
    directory: bool,
    modified: u64,
    size: u64,
    text: Option<Box<SearchText>>,
}
impl StoredEntry {
    fn new(path: String, directory: bool) -> Self {
        let path = stored_path::StoredPath::new(path);
        Self {
            path,
            metadata: if directory { Metadata::Directory(0) } else { Metadata::File },
        }
    }
    fn directory(&self) -> bool {
        match &self.metadata {
            Metadata::File | Metadata::FileText(_) => false,
            Metadata::Directory(_) | Metadata::DirectoryText(_) => true,
            Metadata::Launcher(value) => value.directory,
        }
    }
    fn modified(&self) -> u64 {
        match &self.metadata {
            Metadata::File | Metadata::FileText(_) => 0,
            Metadata::Directory(value) => *value,
            Metadata::DirectoryText(value) => value.modified,
            Metadata::Launcher(value) => value.modified,
        }
    }
    fn set_modified(&mut self, modified: u64) {
        match &mut self.metadata {
            Metadata::File | Metadata::FileText(_) => debug_assert_eq!(modified, 0),
            Metadata::Directory(value) => *value = modified,
            Metadata::DirectoryText(value) => value.modified = modified,
            Metadata::Launcher(value) => value.modified = modified,
        }
    }
    fn size(&self) -> u64 {
        match &self.metadata {
            Metadata::Launcher(value) => value.size,
            _ => 0,
        }
    }
    fn text(&self) -> Option<&SearchText> {
        match &self.metadata {
            Metadata::FileText(value) => Some(value),
            Metadata::DirectoryText(value) => Some(&value.text),
            Metadata::Launcher(value) => value.text.as_deref(),
            _ => None,
        }
    }
    fn set_text(&mut self, text: Box<SearchText>) {
        self.metadata = match std::mem::replace(&mut self.metadata, Metadata::File) {
            Metadata::File => Metadata::FileText(text),
            Metadata::Directory(modified) => Metadata::DirectoryText(Box::new(DirectoryText {
                modified,
                text: *text,
            })),
            Metadata::Launcher(mut value) => { value.text = Some(text); Metadata::Launcher(value) },
            _ => unreachable!("search text already stored"),
        };
    }
    fn set_lower(&mut self, lower: String) {
        match &mut self.metadata {
            Metadata::FileText(value) => value.lower = Some(lower.into_boxed_str()),
            Metadata::DirectoryText(value) => value.text.lower = Some(lower.into_boxed_str()),
            Metadata::Launcher(value) => value.text.get_or_insert_with(Default::default).lower = Some(lower.into_boxed_str()),
            _ => self.set_text(Box::new(SearchText { lower: Some(lower.into_boxed_str()), phonetics: None })),
        }
    }
    fn take_text(&mut self) -> Option<Box<SearchText>> {
        let metadata = std::mem::replace(&mut self.metadata, Metadata::File);
        match metadata {
            Metadata::FileText(value) => Some(value),
            Metadata::DirectoryText(value) => { self.metadata = Metadata::Directory(value.modified); Some(Box::new(value.text)) },
            Metadata::Launcher(mut value) => { let text = value.text.take(); self.metadata = Metadata::Launcher(value); text },
            other => { self.metadata = other; None },
        }
    }
    fn search_name(&self) -> &str {
        self.path.key().name()
    }
    fn display_name(&self) -> Option<&str> {
        match &self.metadata {
            Metadata::Launcher(value) => Some(value.name.as_ref()),
            _ => None,
        }
    }
    fn entry(&self) -> Entry {
        let path = self.path.display().into_owned();
        let name = self
            .display_name()
            .unwrap_or_else(|| {
                Path::new(&path)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&path)
            })
            .to_string();
        Entry {
            path,
            name,
            directory: self.directory(),
            modified: self.modified(),
            size: self.size(),
        }
    }
    fn launcher(entry: Entry, text: Option<Box<SearchText>>) -> Self {
        let mut item = Self::new(entry.path, entry.directory);
        item.metadata = Metadata::Launcher(Box::new(LauncherMetadata {
            name: entry.name.into_boxed_str(),
            directory: entry.directory,
            modified: entry.modified,
            size: entry.size,
            text,
        }));
        item
    }
}
impl Serialize for StoredEntry {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Display<'a> {
            path: &'a str,
            name: &'a str,
            directory: bool,
            modified: u64,
            size: u64,
        }
        let path = self.path.display();
        let name = self.display_name().unwrap_or_else(|| {
            Path::new(path.as_ref())
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&path)
        });
        Display {
            path: &path,
            name,
            directory: self.directory(),
            modified: self.modified(),
            size: self.size(),
        }
        .serialize(serializer)
    }
}
#[derive(Clone, Serialize)]
struct Phonetics {
    full: Box<[Box<str>]>,
    initials: Box<[Box<str>]>,
}
#[derive(Clone, Serialize)]
struct Record {
    item: StoredEntry,
    bits: MaskBits,
    seen: u64,
}
#[derive(Clone, Copy, Serialize)]
struct MaskBits([u64; 2]);
impl MaskBits {
    fn new(bits: u128) -> Self { Self([bits as u64, (bits >> 64) as u64]) }
    fn value(self) -> u128 { self.0[0] as u128 | ((self.0[1] as u128) << 64) }
}
#[derive(Clone, Default, Serialize)]
struct SearchText {
    lower: Option<Box<str>>,
    phonetics: Option<Box<Phonetics>>,
}
impl Record {
    fn new(path: String, directory: bool, seen: u64) -> Self {
        let lower = Path::new(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&path)
            .to_lowercase();
        let mut item = StoredEntry::new(path, directory);
        let name = item.search_name();
        if lower.is_ascii() {
            let bits = MaskBits::new(mask(&lower));
            if lower != name {
                item.set_text(Box::new(SearchText { lower: Some(lower.into_boxed_str()), phonetics: None }));
            }
            return Self {
                bits,
                seen,
                item,
            };
        }
        let mut phonetic = vec![String::new()];
        let mut initials = vec![String::new()];
        let mut chinese = false;
        for c in (if lower.is_ascii() { "" } else { &lower }).chars() {
            let variants: Vec<String> = if let Some(p) = c.to_pinyin_multi() {
                chinese = true;
                p.into_iter()
                    .take(3)
                    .map(|p| p.plain().to_owned())
                    .collect()
            } else {
                vec![c.to_string()]
            };
            let mut next = Vec::new();
            let mut short = Vec::new();
            for (base, init) in phonetic.iter().zip(&initials) {
                for v in &variants {
                    if next.len() >= 8 {
                        break;
                    }
                    next.push(format!("{base}{v}"));
                    short.push(format!("{init}{}", v.chars().next().unwrap_or(c)));
                }
            }
            phonetic = next;
            initials = short;
        }
        if !chinese {
            phonetic.clear();
            initials.clear();
        }
        let bits = phonetic
            .iter()
            .chain(initials.iter())
            .fold(mask(&lower), |m, s| m | mask(s));
        let text = (chinese || lower != name).then(|| {
            Box::new(SearchText {
                lower: (lower != name).then(|| lower.into_boxed_str()),
                phonetics: chinese.then(|| {
                    Box::new(Phonetics {
                        full: phonetic.into_iter().map(String::into_boxed_str).collect(),
                        initials: initials.into_iter().map(String::into_boxed_str).collect(),
                    })
                }),
            })
        });
        if let Some(text) = text { item.set_text(text); }
        Self {
            item,
            bits: MaskBits::new(bits),
            seen,
        }
    }
    fn lower(&self) -> &str {
        self.item.text()
            .and_then(|text| text.lower.as_deref())
            .unwrap_or_else(|| self.item.search_name())
    }
    fn phonetic(&self) -> impl Iterator<Item = &str> {
        self.item.text()
            .into_iter()
            .filter_map(|text| text.phonetics.as_ref())
            .flat_map(|p| p.full.iter().chain(p.initials.iter()))
            .map(|s| s.as_ref())
    }
    fn set_lower(&mut self, lower: String) {
        self.item.set_lower(lower);
    }
    fn set_launcher(&mut self, entry: Entry) {
        let text = self.item.take_text();
        self.item = StoredEntry::launcher(entry, text);
    }
}
#[derive(Default, Serialize)]
struct Index {
    rows: rows::Rows,
    #[serde(skip)]
    paths: PathPool,
    #[serde(skip)]
    tracking: bool,
    #[serde(skip)]
    touched: usize,
    #[serde(skip)]
    evict: String,
}
impl Index {
    fn put(&mut self, mut row: Record) -> Option<Record> {
        row.item.path.share_parent(&mut self.paths);
        self.rows.put(row)
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct State {
    running: bool,
    count: usize,
    scanned: usize,
    issues: usize,
    root: String,
    updated: u64,
    error: String,
    watching: bool,
    #[serde(rename = "cacheError")]
    cache_error: String,
}
struct Shared {
    index: RwLock<Index>,
    launchers: RwLock<Index>,
    state: Mutex<State>,
    config: Mutex<Config>,
    generation: AtomicU64,
    query: AtomicU64,
    query_scopes: Mutex<BTreeMap<u64, u64>>,
    writer: Mutex<()>,
    cache: String,
    persistence: cache::Persistence,
    working: AtomicBool,
}
struct Working<'a>(&'a AtomicBool);
impl<'a> Working<'a> {
    fn start(flag: &'a AtomicBool) -> Self {
        flag.store(true, Ordering::SeqCst);
        Self(flag)
    }
}
impl Drop for Working<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
fn send(s: &Shared) {
    let mut state = s.state.lock().unwrap();
    state.count = s.index.read().unwrap().rows.len();
    output(json!({"state":&*state}));
}
fn full(index: &Index, limit: usize) -> bool {
    if index.tracking {
        index.touched >= limit
    } else {
        index.rows.len() >= limit
    }
}
fn insert(s: &Shared, batch: &mut Vec<Record>, generation: u64) {
    let limit = s.config.lock().unwrap().max_entries.clamp(1000, 10_000_000);
    let mut index = s.index.write().unwrap();
    if s.generation.load(Ordering::Relaxed) != generation {
        return;
    }
    for row in batch.drain(..) {
        let path = row.item.path.key();
        if index.tracking && index.touched >= limit {
            break;
        }
        if index.rows.len() >= limit && !index.rows.contains_key(path) {
            if !index.tracking {
                break;
            }
            let stale = index
                .rows
                .range((
                    Bound::Included(PathKey::lookup(&index.evict)),
                    Bound::Unbounded,
                ))
                .find(|(_, r)| r.seen != generation)
                .map(|(k, _)| k.clone());
            if let Some(stale) = stale {
                index.evict = stale.to_string();
                index.rows.remove(&stale);
            } else {
                break;
            }
        }
        if !index.tracking {
            s.persistence
                .changes(generation, vec![cache::Change::Put(row.item.entry())]);
        }
        let previous = index.put(row);
        if index.tracking && previous.is_none_or(|r| r.seen != generation) {
            index.touched += 1;
        }
    }
}
fn walk(
    s: &Shared,
    root: &str,
    config: &Config,
    generation: u64,
    scanned: &mut usize,
    issues: &mut usize,
) {
    enumeration::walk(root, s, config, generation, scanned, issues);
}
fn persist(s: Arc<Shared>) {
    s.persistence.request();
}
fn rebuild(s: Arc<Shared>, config: Config) {
    let generation = s.generation.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut state = s.state.lock().unwrap();
        state.running = true;
        state.scanned = 0;
        state.issues = 0;
        state.error.clear();
    }
    send(&s);
    thread::spawn(move || {
        let _writer = s.writer.lock().unwrap();
        let _working = Working::start(&s.working);
        if s.generation.load(Ordering::Relaxed) != generation {
            return;
        }
        {
            let mut old = s.config.lock().unwrap();
            let mut index = s.index.write().unwrap();
            if old.roots != config.roots
                || old.excluded != config.excluded
                || old.max_entries != config.max_entries
            {
                index.rows.clear();
                index.paths.clear();
            }
            index.tracking = true;
            index.touched = 0;
            index.evict.clear();
            *old = config.clone();
        }
        let (mut scanned, mut issues) = (0, 0);
        for root in &config.roots {
            s.state.lock().unwrap().root = root.clone();
            walk(&s, root, &config, generation, &mut scanned, &mut issues);
            if s.generation.load(Ordering::Relaxed) != generation {
                return;
            }
            if full(&s.index.read().unwrap(), config.max_entries) {
                break;
            }
        }
        if s.generation.load(Ordering::Relaxed) != generation {
            return;
        }
        s.index
            .write()
            .unwrap()
            .rows
            .retain(|_, r| r.seen == generation);
        s.index.write().unwrap().tracking = false;
        s.index.write().unwrap().paths.collect();
        {
            let mut state = s.state.lock().unwrap();
            state.running = false;
            state.scanned = scanned;
            state.issues = issues;
            state.root.clear();
            state.updated = now();
            if s.index.read().unwrap().rows.len() >= config.max_entries {
                state.error = format!("索引已达到 {} 项上限", config.max_entries);
            }
        }
        send(&s);
        persist(s.clone());
    });
}
fn refresh(s: Arc<Shared>, paths: Vec<String>) {
    incremental::refresh(s, paths, false);
}

fn subsequence(hay: &str, needle: &str) -> Option<i32> {
    let mut it = needle.chars();
    let mut next = it.next()?;
    let (mut score, mut run, mut gap) = (0, 0, 0);
    for (i, c) in hay.chars().enumerate() {
        if c == next {
            run += 1;
            score += 8 + run * 3;
            if i == 0 {
                score += 15
            }
            next = match it.next() {
                Some(c) => c,
                None => return Some(score - gap.min(30)),
            };
        } else {
            gap += 1;
            run = 0;
        }
    }
    None
}
fn one_edit(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if !a.is_ascii() || !b.is_ascii() || a.len().abs_diff(b.len()) > 1 {
        return false;
    }
    let (mut i, mut j, mut errors) = (0, 0, 0);
    while i < a.len() && j < b.len() {
        if a[i] == b[j] {
            i += 1;
            j += 1;
            continue;
        }
        errors += 1;
        if errors > 1 {
            return false;
        }
        if a.len() == b.len() {
            if i + 1 < a.len() && a[i] == b[j + 1] && a[i + 1] == b[j] {
                i += 2;
                j += 2
            } else {
                i += 1;
                j += 1
            }
        } else if a.len() > b.len() {
            i += 1
        } else {
            j += 1
        }
    }
    errors + usize::from(i < a.len() || j < b.len()) <= 1
}
#[derive(Clone)]
struct Term {
    text: String,
    exact: bool,
    bits: u128,
    fuzzy: bool,
    typo: bool,
    separators: u8,
}
impl Term {
    fn new(text: String, exact: bool) -> Self {
        let fuzzy = !exact && text.len() <= 128 && text.chars().take(2).count() == 2;
        Self {
            bits: mask(&text),
            typo: fuzzy && text.len() >= 4 && text.is_ascii(),
            separators: text.bytes().filter(|&c| c == b'\\').take(2).count() as u8,
            text,
            exact,
            fuzzy,
        }
    }
}
fn parse(query: &str, folder: bool) -> (String, Vec<String>, Vec<Term>) {
    let mut tokens = Vec::new();
    let (mut token, mut quoted, mut exact) = (String::new(), false, false);
    for c in query.chars() {
        if c == '"' {
            quoted = !quoted;
            exact = true;
        } else if c.is_whitespace() && !quoted {
            if !token.is_empty() {
                tokens.push((std::mem::take(&mut token), exact));
                exact = false;
            }
        } else {
            token.push(c)
        }
    }
    if !token.is_empty() {
        tokens.push((token, exact));
    }
    let mut kind = if folder {
        "folder".to_string()
    } else {
        String::new()
    };
    let mut extensions = Vec::new();
    let mut terms = Vec::new();
    for (raw, exact) in tokens {
        let text = raw.to_lowercase().replace('/', "\\");
        if let Some(t) = text.strip_prefix("ext:") {
            extensions = t
                .split(';')
                .map(|s| s.trim_start_matches('.').to_string())
                .collect();
            continue;
        }
        if let Some((k, v)) = text.split_once(':') {
            if [
                "folder", "file", "doc", "pic", "video", "audio", "app", "setting",
            ]
            .contains(&k)
            {
                kind = k.into();
                if !v.is_empty() {
                    terms.push(Term::new(v.into(), exact));
                }
                continue;
            }
        }
        terms.push(Term::new(text, exact));
    }
    (kind, extensions, terms)
}
fn accepts(row: &Record, kind: &str, exts: &[String]) -> bool {
    let item = &row.item;
    if item.path.key().starts_with("one-launcher:") {
        return exts.is_empty()
            && (kind.is_empty()
                || item
                    .path
                    .key()
                    .starts_with(&format!("one-launcher:{kind}:")));
    }
    if kind == "app" || kind == "setting" {
        return false;
    }
    if kind == "folder" && !item.directory() || !kind.is_empty() && kind != "folder" && item.directory()
    {
        return false;
    }
    if kind.is_empty() && exts.is_empty() {
        return true;
    }
    let ext = row.lower().rsplit('.').next().unwrap_or("");
    if !exts.is_empty() && !exts.iter().any(|value| value == ext) {
        return false;
    }
    let group = match kind {
        "doc" => "txt md pdf doc docx ppt pptx xls xlsx csv rtf epub ods ipynb",
        "pic" => "png jpg jpeg webp gif bmp tif tiff svg avif heic",
        "video" => "mp4 mkv webm avi mov m4v",
        "audio" => "mp3 flac wav m4a ogg aac opus",
        _ => return true,
    };
    group.split(' ').any(|s| s == ext)
}
fn score(
    row: &Record,
    path: &PathKey,
    terms: &[Term],
    fuzzy: bool,
    pinyin: bool,
) -> Option<(i32, &'static str)> {
    // Plain file and directory names are identical to their normalized path
    // keys. Their stored mask already covers the name and every pinyin form;
    // the parent mask covers path matches. Reject impossible candidates before
    // resolving the name or search metadata for millions of rows.
    if matches!(row.item.metadata, Metadata::File | Metadata::Directory(_)) {
        let bits = row.bits.value();
        let all_bits = bits | path.prefix_bits();
        if terms.iter().any(|term| {
            term.bits & all_bits != term.bits
                && !(fuzzy && term.typo && (term.bits & !bits).count_ones() <= 2)
        }) {
            return None;
        }
    }
    let mut total = if row.item.directory() { 3 } else { 0 };
    let mut mode = "exact";
    let lower = row.lower();
    let bits = row.bits.value();
    let file_name = std::ptr::eq(lower, path.name());
    for term in terms {
        let t = &term.text;
        // A normalized basename never contains a separator. Neither literal
        // name matches nor subsequences/pinyin can match path terms. One-edit
        // matching can remove a single separator, so retain that exception.
        if file_name && term.separators > 0 && (!fuzzy || !term.typo || term.separators > 1) {
            if term.bits & (bits | path.prefix_bits()) == term.bits && path.contains_parent(t) {
                total += 180;
                continue;
            }
            return None;
        }
        // File names share their normalized lookup spelling. Their existing
        // masks include every filename, pinyin and parent-path character.
        // Missing characters rule out all matches except eligible ASCII typos.
        // Launcher display names and exceptional spellings keep the full path check.
        if file_name
            && term.bits & bits != term.bits
            && !(fuzzy && term.typo && (term.bits & !bits).count_ones() <= 2)
            && term.bits & (bits | path.prefix_bits()) != term.bits
        {
            return None;
        }
        let mut value = -1;
        if let Some(at) = lower.find(t) {
            value = if lower == t {
                1000
            } else if at == 0 {
                850
            } else {
                650
            };
        } else if !term.exact && pinyin && row.phonetic().any(|s| s.contains(t)) {
            value = 540;
            mode = "pinyin";
        } else if if file_name {
            term.bits & (bits | path.prefix_bits()) == term.bits && path.contains_parent(t)
        } else {
            path.contains(t)
        } {
            value = 180;
        } else if fuzzy && term.fuzzy {
            if term.bits & bits == term.bits {
                if let Some(s) = subsequence(lower, t) {
                    value = 250 + s.min(150);
                    mode = "fuzzy";
                }
                if pinyin {
                    for p in row.phonetic() {
                        if let Some(s) = subsequence(p, t) {
                            if value < 0 {
                                mode = "pinyin";
                            }
                            value = value.max(210 + s.min(120));
                        }
                    }
                }
            }
            if value < 0 && term.typo && (term.bits & !bits).count_ones() <= 2 {
                let stem = lower.rsplit_once('.').map(|(s, _)| s).unwrap_or(lower);
                if one_edit(stem, t) || stem.split([' ', '-', '_']).any(|s| one_edit(s, t)) {
                    value = 160;
                    mode = "typo";
                }
            }
        }
        if value < 0 {
            return None;
        }
        total += value;
    }
    Some((total, mode))
}
fn current_query(s: &Shared, v: &Value, ticket: u64) -> bool {
    s.query_scopes
        .lock()
        .unwrap()
        .get(&v["scope"].as_u64().unwrap_or(0))
        .copied()
        == Some(ticket)
}
type Ranked<'a> = BinaryHeap<Reverse<(bool, i32, PathKey, &'a str)>>;
fn retain_match<'a>(heap: &mut Ranked<'a>, path: &PathKey, points: i32, mode: &'a str, local: bool) {
    if heap.len() < 100 || heap.peek().is_some_and(|v| (local, points) > (v.0.0, v.0.1)) {
        heap.push(Reverse((local, points, path.clone(), mode)));
        if heap.len() > 100 { heap.pop(); }
    }
}
fn ranked_items(heap: &Ranked<'_>, index: &Index, extra: &rows::Rows) -> Vec<Value> {
    let mut best = heap.iter().map(|r| &r.0).collect::<Vec<_>>();
    best.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
    best.iter().map(|(_, _, path, mode)| {
        let item = &index.rows.get(path).or_else(|| extra.get(path)).unwrap().item;
        let mut value = serde_json::to_value(item).unwrap();
        if item.directory() { value["modified"] = json!(item.modified() / 1_000_000); }
        value["matchKind"] = json!(mode);
        value
    }).collect()
}
fn query(s: &Shared, v: &Value, ticket: u64) {
    let start = Instant::now();
    let id = v["id"].as_u64().unwrap_or(0);
    if !current_query(s, v, ticket) {
        output(json!({"id":id,"result":{"items":[],"total":0,"elapsed":0,"cancelled":true}}));
        return;
    }
    let query = v["query"].as_str().unwrap_or("");
    if query.len() > 4000 {
        output(json!({"id":id,"error":"搜索条件过长"}));
        return;
    }
    let (kind, extensions, terms) = parse(query, v["foldersOnly"].as_bool().unwrap_or(false));
    let fuzzy = v["fuzzy"].as_bool().unwrap_or(true);
    let pinyin = v["pinyin"].as_bool().unwrap_or(true);
    let current = key(v["currentFolder"].as_str().unwrap_or(""));
    let index = s.index.read().unwrap();
    let launchers = s.launchers.read().unwrap();
    let extra_rows = &launchers.rows;
    let include_launchers = v["includeLaunchers"].as_bool().unwrap_or(false);
    let mut heap: Ranked<'_> = BinaryHeap::new();
    let mut total = 0;
    let prefix = if current.is_empty() { String::new() } else { format!("{current}\\") };
    let progressive = v["progressive"].as_bool().unwrap_or(false)
        && !prefix.is_empty() && !matches!(kind.as_str(), "app" | "setting");
    // An ordered range visits only the current subtree, without scanning the full index.
    // ']' is the byte immediately after '\\', so this upper bound includes every child.
    if progressive {
        for (n, (path, row)) in index.rows.range(PathKey::lookup(&prefix)..PathKey::lookup(format!("{current}]"))).enumerate() {
            if n % 1024 == 0 && !current_query(s, v, ticket) {
                output(json!({"id":id,"result":{"items":[],"total":0,"elapsed":0,"cancelled":true}}));
                return;
            }
            if accepts(row, &kind, &extensions) {
                if let Some((points, mode)) = score(row, path, &terms, fuzzy, pinyin) {
                    total += 1;retain_match(&mut heap, path, points, mode, true);
                }
            }
        }
        if !current_query(s, v, ticket) {
            output(json!({"id":id,"result":{"items":[],"total":0,"elapsed":0,"cancelled":true}}));
            return;
        }
        output(json!({"id":id,"result":{"items":ranked_items(&heap,&index,extra_rows),"total":total,"localTotal":total,"elapsed":start.elapsed().as_secs_f64()*1000.0,"partial":true}}));
    }
    let mut local_total = total;
    for (n, (path, row)) in index
        .rows
        .iter()
        // Programs/settings live in the launcher index. Their filters reject
        // every filesystem row, so don't walk millions of unrelated files.
        .take(if matches!(kind.as_str(), "app" | "setting") {
            0
        } else {
            usize::MAX
        })
        .chain(extra_rows.iter().filter(|_| include_launchers))
        .enumerate()
    {
        if n % 1024 == 0 && !current_query(s, v, ticket) {
            output(json!({"id":id,"result":{"items":[],"total":0,"elapsed":0,"cancelled":true}}));
            return;
        }
        if !accepts(row, &kind, &extensions) {
            continue;
        }
        if let Some((points, mode)) = score(row, path, &terms, fuzzy, pinyin) {
            // Most rows fail the text match. Resolve current-folder priority only
            // for matches, where it can affect the count and ranking.
            let local = !prefix.is_empty() && path.starts_with(&prefix);
            if progressive && local { continue; }
            total += 1;
            if local { local_total += 1; }
            retain_match(&mut heap, path, points, mode, local);
        }
    }
    if !current_query(s, v, ticket) {
        output(json!({"id":id,"result":{"items":[],"total":0,"elapsed":0,"cancelled":true}}));
        return;
    }
    output(
        json!({"id":id,"result":{"items":ranked_items(&heap,&index,extra_rows),"total":total,"localTotal":local_total,"elapsed":start.elapsed().as_secs_f64()*1000.0}}),
    );
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("cleanup") => {
            cleanup::run(
                args.get(2).cloned().unwrap_or_default(),
                args.get(3).and_then(|v| v.parse().ok()).unwrap_or(86400000),
            );
            return;
        }
        Some("cleanup-remove") => {
            cleanup::remove();
            return;
        }
        Some("disk") => {
            disk::run(args.get(2).cloned().unwrap_or_default());
            return;
        }
        Some("registry") => {
            maintenance::run(false);
            return;
        }
        Some("startup") => {
            maintenance::run(true);
            return;
        }
        _ => {}
    }
    let cache = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "file-index.bin".into());
    let _cache_lock = match cache::acquire(&cache) {
        Ok(lock) => lock,
        Err(e) => {
            output(json!({"state":State{error:format!("索引缓存不可用：{e}"),..State::default()}}));
            return;
        }
    };
    cache::cleanup(&cache);
    let s = Arc::new(Shared {
        index: RwLock::new(Index::default()),
        launchers: RwLock::new(Index::default()),
        state: Mutex::new(State::default()),
        config: Mutex::new(Config::default()),
        generation: AtomicU64::new(0),
        query: AtomicU64::new(0),
        query_scopes: Mutex::new(BTreeMap::new()),
        writer: Mutex::new(()),
        cache,
        persistence: cache::Persistence::default(),
        working: AtomicBool::new(false),
    });
    let saver = cache::start(s.clone());
    let (tx, rx) = std::sync::mpsc::channel::<(Value, u64)>();
    let queries = s.clone();
    thread::spawn(move || {
        while let Ok(v) = rx.recv() {
            query(&queries, &v.0, v.1);
        }
    });
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.len() > 1_000_000 {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match v["type"].as_str().unwrap_or("") {
            "init" => {
                let Ok(config) = serde_json::from_value::<Config>(v["settings"].clone()) else {
                    continue;
                };
                let mut loaded = false;
                if let Ok(Some((index, updated, id))) = cache::load(&s.cache, &config) {
                    *s.index.write().unwrap() = index;
                    s.state.lock().unwrap().updated = updated;
                    s.persistence.loaded(id);
                    loaded = true;
                }
                *s.config.lock().unwrap() = config.clone();
                send(&s);
                if loaded {
                    incremental::refresh(s.clone(), Vec::new(), true);
                } else {
                    rebuild(s.clone(), config);
                }
            }
            "rebuild" => {
                if let Ok(config) = serde_json::from_value(v["settings"].clone()) {
                    rebuild(s.clone(), config)
                }
            }
            "cancel" => {
                s.generation.fetch_add(1, Ordering::SeqCst);
                // Incomplete directories must be revisited after loading a partial scan.
                {
                    let mut index = s.index.write().unwrap();
                    index.tracking = false;
                    for row in index.rows.values_mut() {
                        if row.item.directory() {
                            row.item.set_modified(0);
                        }
                    }
                }
                let mut state = s.state.lock().unwrap();
                state.running = false;
                state.error = "已停止，保留现有索引".into();
                state.root.clear();
                drop(state);
                send(&s);
                persist(s.clone());
            }
            "changes" => {
                if let Ok(paths) = serde_json::from_value(v["paths"].clone()) {
                    refresh(s.clone(), paths)
                }
            }
            "resync" => incremental::refresh(s.clone(), Vec::new(), true),
            "query" => {
                let ticket = s.query.fetch_add(1, Ordering::SeqCst) + 1;
                s.query_scopes
                    .lock()
                    .unwrap()
                    .insert(v["scope"].as_u64().unwrap_or(0), ticket);
                let _ = tx.send((v, ticket));
            }
            "launchers" => {
                if let Ok(entries) = serde_json::from_value::<Vec<Entry>>(v["items"].clone()) {
                    let mut index = Index::default();
                    for entry in entries
                        .into_iter()
                        .filter(|e| e.path.starts_with("one-launcher:"))
                        .take(3000)
                    {
                        let mut row = Record::new(entry.name.clone(), false, 0);
                        row.set_lower(entry.name.to_lowercase());
                        row.set_launcher(entry);
                        index.put(row);
                    }
                    *s.launchers.write().unwrap() = index;
                }
            }
            "release-query" => {
                s.query_scopes
                    .lock()
                    .unwrap()
                    .remove(&v["scope"].as_u64().unwrap_or(0));
            }
            "stop" => break,
            _ => {}
        }
    }
    s.generation.fetch_add(1, Ordering::SeqCst);
    let interrupted = s.working.load(Ordering::SeqCst);
    {
        let mut index = s.index.write().unwrap();
        if index.tracking || interrupted {
            for row in index.rows.values_mut() {
                if row.item.directory() {
                    row.item.set_modified(0);
                }
            }
            index.tracking = false;
            s.persistence.request();
        }
    }
    s.persistence.stop();
    let _ = saver.join();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compact_names_and_launchers() {
        for (path, name) in [
            ("D:\\folder\\report.txt", "report.txt"),
            ("D:\\字体\\季度报告.TXT", "季度报告.TXT"),
            ("D:\\docs\\Résumé-Σ.txt", "Résumé-Σ.txt"),
            ("D:\\folder\\", "folder"),
            ("D:\\", "D:\\"),
            ("\\\\server\\share\\目录", "目录"),
        ] {
            let row = Record::new(path.into(), false, 0);
            assert_eq!(row.item.entry().name, name);
            assert_eq!(row.lower(), name.to_lowercase());
            assert_eq!(
                serde_json::to_value(&row.item).unwrap(),
                serde_json::to_value(row.item.entry()).unwrap()
            );
        }
        let ascii = Record::new("D:\\report.txt".into(), false, 0);
        assert!(ascii.item.text().is_none());
        assert_eq!(ascii.phonetic().count(), 0);
        let accented = Record::new("D:\\Résumé.txt".into(), false, 0);
        assert_eq!(accented.phonetic().count(), 0);
        assert!(std::mem::size_of::<Record>() <= 72);
        let entry = Entry {
            path: "one-launcher:setting:display".into(),
            name: "显示器 分辨率 缩放".into(),
            directory: false,
            size: 42,
            modified: 123456789,
        };
        let mut row = Record::new(entry.name.clone(), false, 0);
        row.set_lower(entry.name.to_lowercase());
        row.set_launcher(entry.clone());
        assert_eq!(
            serde_json::to_value(&row.item).unwrap(),
            serde_json::to_value(entry).unwrap()
        );
        let (_, _, terms) = parse("xianshiqi", false);
        assert!(score(&row, row.item.path.key(), &terms, false, true).is_some());
    }
    #[test]
    fn matching() {
        let r = Record::new("D:\\财务\\季度报告.xlsx".into(), false, 1);
        for q in ["季度", "jidubaogao", "jdbg", "jd bg"] {
            let (_, _, t) = parse(q, false);
            assert!(
                score(&r, r.item.path.key(), &t, true, true).is_some(),
                "{q}"
            );
        }
        let r = Record::new("D:\\report.txt".into(), false, 1);
        for q in ["rpt", "reprot", "reprt"] {
            let (_, _, t) = parse(q, false);
            assert!(
                score(&r, r.item.path.key(), &t, true, true).is_some(),
                "{q}"
            );
        }
        let (_, _, t) = parse("\"reprot\"", false);
        assert!(score(&r, r.item.path.key(), &t, true, true).is_none());
    }
    #[test]
    fn matching_keeps_parent_pinyin_typo_and_exceptional_spellings() {
        for (path, query, fuzzy, pinyin, matched) in [
            ("D:\\Quarterly\\plain.txt", "quarterly", false, false, true),
            ("D:\\季度\\plain.txt", "季度", false, false, true),
            ("D:\\folder\\report.txt", "reprot", true, false, true),
            ("D:\\folder\\report.txt", "reprot", false, true, false),
            ("D:\\folder\\report.txt", "\"reprot\"", true, true, false),
            ("D:\\folder\\report.txt", "reprt", true, false, true),
            ("D:\\folder\\report.txt", "rpt", true, false, true),
            ("D:\\folder\\report.txt", "repotr", true, false, true),
            ("D:\\folder\\report.txt", "rzpqxt", true, false, false),
            ("D:\\folder\\report.txt", "re/port", true, false, true),
            ("D:\\folder\\report.txt", "re/port", false, false, false),
            ("D:\\folder\\report.txt", "r/e/port", true, false, false),
            ("D:\\folder\\季度报告.txt", "jidubaogao", false, true, true),
            ("D:\\folder\\季度报告.txt", "jdbg", true, true, true),
            ("D:\\folder\\季度报告.txt", "jdbg", false, false, false),
            ("D:\\folder\\季度报告.txt", "\"jdbg\"", true, true, false),
            ("D:\\folder\\Résumé-Σ.txt", "résumé", false, false, true),
            ("D:\\İstanbul\\File.txt", "istanbul", false, false, false),
            ("D:\\İstanbul\\File.txt", "İstanbul", false, false, true),
            ("D:\\folder\\🙂.txt", "🙂", false, false, true),
            ("D:\\folder\\文🙂.txt", "文🙂", true, false, true),
            (
                "D:/Mixed/Folder/File.TXT",
                "mixed/folder/file",
                false,
                false,
                true,
            ),
            (
                "D:\\Mixed\\Folder\\File.TXT",
                "folder/file",
                false,
                false,
                true,
            ),
            ("D:\\", "\"D:\\\"", true, true, true),
            (
                "\\\\Server\\Share\\文档.txt",
                "server/share",
                false,
                false,
                true,
            ),
        ] {
            let row = Record::new(path.into(), false, 0);
            let (_, _, terms) = parse(query, false);
            assert_eq!(
                score(&row, row.item.path.key(), &terms, fuzzy, pinyin).is_some(),
                matched,
                "{path} / {query}"
            );
        }
        let entry = Entry {
            path: "one-launcher:app:D:\\SpecialFolder\\Run.exe".into(),
            name: "Different display name".into(),
            directory: false,
            size: 0,
            modified: 0,
        };
        let mut row = Record::new(entry.name.clone(), false, 0);
        row.set_lower(entry.name.to_lowercase());
        row.set_launcher(entry);
        let (_, _, terms) = parse("\"specialfolder\\run.exe\"", false);
        assert!(
            score(&row, row.item.path.key(), &terms, false, false).is_some(),
            "launcher targets remain searchable even when display names differ"
        );
    }
    #[test]
    fn boundaries() {
        assert!(under("d:\\abc\\x", "d:\\abc"));
        assert!(!under("d:\\abcd", "d:\\abc"));
    }
}

#[cfg(test)]
mod scale_benchmark {
    use super::*;
    #[test]
    #[ignore]
    fn large_index() {
        let start = Instant::now();
        let mut index = Index::default();
        for n in 0..100_000 {
            let name = if n % 10 == 0 {
                format!("季度报告-{n:06}.pdf")
            } else {
                format!("report-{n:06}.txt")
            };
            let path = format!("D:\\bench\\group-{}\\{name}", n / 1000);
            let record = Record::new(path.clone(), false, 1);
            index.put(record);
        }
        output(
            json!({"benchmark":{"entries":index.rows.len(),"prepareMs":start.elapsed().as_millis()}}),
        );
        let shared = Shared {
            index: RwLock::new(index),
            launchers: RwLock::new(Index::default()),
            state: Mutex::new(State::default()),
            config: Mutex::new(Config::default()),
            generation: AtomicU64::new(0),
            query: AtomicU64::new(0),
            query_scopes: Mutex::new(BTreeMap::from([(0, 0)])),
            writer: Mutex::new(()),
            cache: String::new(),
            persistence: cache::Persistence::default(),
            working: AtomicBool::new(false),
        };
        for (i, q) in [
            "report-099999",
            "jdbg",
            "jidubaogao",
            "rpt-123",
            "reprot",
            "no-such-file",
            "ext:pdf 090",
        ]
        .iter()
        .enumerate()
        {
            query(&shared, &json!({"id":i,"query":q}), 0);
        }
    }
}
