//! Bounded changes over an immutable sorted base. Only changed records live on
//! the heap; deleted directory subtrees are represented by row-ID intervals.
use super::*;
mod journal;
use std::{collections::btree_map, iter::Peekable, ops::Range};

const MAX_EXTRA: usize = 20_000;
const MAX_INTERVALS: usize = 20_000;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Mutation {
    Remove(String),
    Put(Entry),
}

#[derive(Clone, Default)]
struct Hidden {
    spans: BTreeMap<usize, usize>,
    count: usize,
}
impl Hidden {
    fn contains(&self, id: usize) -> bool {
        self.spans.range(..=id).next_back().is_some_and(|(_, end)| id < *end)
    }
    fn insert(&mut self, range: Range<usize>) {
        let (mut start, mut end) = (range.start, range.end);
        if start >= end { return; }
        if let Some((&left, &right)) = self.spans.range(..=start).next_back() {
            if right >= start {
                start = left;
                end = end.max(right);
                self.spans.remove(&left);
                self.count -= right - left;
            }
        }
        while let Some((&left, &right)) = self.spans.range(start..=end).next() {
            end = end.max(right);
            self.spans.remove(&left);
            self.count -= right - left;
        }
        self.spans.insert(start, end);
        self.count += end - start;
    }
}

#[derive(Clone, Default)]
pub(super) struct Overlay {
    generation: Option<[u8; 16]>,
    extra: BTreeMap<PathKey, Record>,
    hidden: Hidden,
}
impl Overlay {
    pub fn check(&self, view: &View<'_>) -> io::Result<()> {
        if self.generation.is_some_and(|id| id != view.generation) { return Err(io::Error::other("磁盘增量与索引版本不一致")); }
        Ok(())
    }
    pub fn load(view: &View<'_>, path: Option<&Path>) -> io::Result<Self> {
        if let Some(path) = path { return journal::load(view,path); }
        Ok(Self {generation:Some(view.generation), ..Self::default()})
    }
    pub fn save(&self, path: &Path) -> io::Result<()> { journal::save(self,path) }
    pub fn count(&self, view: &View<'_>) -> usize {
        view.count() - self.hidden.count + self.extra.len()
    }
    pub fn is_empty(&self) -> bool { self.extra.is_empty() && self.hidden.spans.is_empty() }
    pub fn stats(&self, view: &View<'_>) -> Value {
        json!({"count":self.count(view),"changedRows":self.extra.len(),"hiddenRows":self.hidden.count,"hiddenRanges":self.hidden.spans.len()})
    }
    pub fn get(&self, path: &PathKey) -> &Record {
        self.extra.get(path).expect("retained overlay row")
    }
    fn base_id(view: &View<'_>, normalized: &str) -> io::Result<Option<usize>> {
        let id = view.lower_bound(normalized)?;
        Ok((id < view.count() && view.path(id)?.equal_text(normalized)).then_some(id))
    }
    fn apply_one(&mut self, view: &View<'_>, change: Mutation, limit: usize) -> io::Result<()> {
        match change {
            Mutation::Put(item) => {
                let normalized = key(&item.path);
                let lookup = PathKey::lookup(&normalized);
                let id = Self::base_id(view, &normalized)?;
                let exists = self.extra.contains_key(&lookup)
                    || id.is_some_and(|id| !self.hidden.contains(id));
                if !exists && self.count(view) >= limit { return Ok(()); }
                if let Some(id) = id { self.hidden.insert(id..id + 1); }
                let mut row = Record::new(item.path, item.directory, 0);
                row.item.set_modified(item.modified);
                match self.extra.entry(row.item.path.key().clone()) {
                    btree_map::Entry::Occupied(mut entry) => {
                        row.item.path.reuse_key(entry.key());
                        entry.insert(row);
                    }
                    btree_map::Entry::Vacant(entry) => { entry.insert(row); }
                }
            }
            Mutation::Remove(path) => {
                let normalized = key(&path);
                let lookup = PathKey::lookup(&normalized);
                let id = Self::base_id(view, &normalized)?;
                let directory = if let Some(row) = self.extra.get(&lookup) {
                    Some(row.item.directory())
                } else if let Some(id) = id.filter(|id| !self.hidden.contains(*id)) {
                    Some(view.row(id)?.directory())
                } else { None };
                let Some(directory) = directory else { return Ok(()); };
                if let Some(id) = id { self.hidden.insert(id..id + 1); }
                self.extra.remove(&lookup);
                if directory {
                    let prefix = format!("{normalized}\\");
                    // The root point and child range are separate: e.g.
                    // "folder-adjacent" sorts between "folder" and "folder\\".
                    self.hidden.insert(view.lower_bound(&prefix)?..view.lower_bound(&format!("{normalized}]"))?);
                    self.extra.retain(|path, _| !path.starts_with(&prefix));
                }
            }
        }
        Ok(())
    }
    pub fn stage(&self, view: &View<'_>, changes: Vec<Mutation>, limit: usize) -> io::Result<Self> {
        self.check(view)?;
        if changes.len() > 10_000 { return Err(bad()); }
        for change in &changes {
            let (path, invalid_meta) = match change {
                Mutation::Remove(path) => (path.as_str(), false),
                Mutation::Put(item) => (item.path.as_str(), !item.directory && item.modified != 0),
            };
            let normalized = key(path);
            if path.len() > 131_072 || normalized.is_empty() || path.contains('\0')
                || normalized.starts_with("one-launcher:") || invalid_meta { return Err(bad()); }
        }
        // Staging keeps a rejected/corrupt batch from partly changing queries.
        // This copy is bounded by the change limits, never by the base size.
        let mut next = self.clone();
        next.generation = Some(view.generation);
        for change in changes {
            next.apply_one(view, change, limit)?;
            if next.extra.len() > MAX_EXTRA || next.hidden.spans.len() > MAX_INTERVALS {
                return Err(io::Error::new(io::ErrorKind::WouldBlock, "磁盘增量需要合并"));
            }
        }
        Ok(next)
    }
    #[cfg(test)]
    pub fn apply(&mut self, view: &View<'_>, changes: Vec<Mutation>, limit: usize) -> io::Result<()> {
        *self = self.stage(view,changes,limit)?;
        Ok(())
    }
    pub fn iter<'a, 'v>(&'a self, view: &'v View<'a>, range: Range<usize>, scope: Option<(&str, &str)>) -> Union<'a, 'v> {
        let bounds = scope.map(|(lower,upper)|(Bound::Included(PathKey::lookup(lower)),Bound::Excluded(PathKey::lookup(upper))))
            .unwrap_or((Bound::Unbounded,Bound::Unbounded));
        let extra = self.extra.range(bounds);
        Union { view, at:range.start, end:range.end, spans:self.hidden.spans.range(..range.end).peekable(), extra:extra.peekable(), next_extra_at:None }
    }
}

pub(super) enum Candidate<'a> {
    Base(usize),
    Extra(&'a PathKey, &'a Record),
}
pub(super) struct Union<'a, 'v> {
    view: &'v View<'a>,
    at: usize,
    end: usize,
    spans: Peekable<btree_map::Range<'a, usize, usize>>,
    extra: Peekable<btree_map::Range<'a, PathKey, Record>>,
    next_extra_at: Option<usize>,
}
impl<'a> Iterator for Union<'a, '_> {
    type Item = io::Result<Candidate<'a>>;
    #[inline(always)]
    fn next(&mut self) -> Option<Self::Item> {
        while let Some((&start, &end)) = self.spans.peek().copied() {
            if self.at < start { break; }
            self.at = self.at.max(end);
            self.spans.next();
        }
        if let Some((path, _)) = self.extra.peek() {
            // Locate an insertion boundary once per changed row. Comparing
            // paths for every base row would undo the mask's cheap rejection.
            let boundary = if let Some(at) = self.next_extra_at { at } else {
                match self.view.lower_bound_path(Fragments::from_key(path)) {
                    Ok(at) => { self.next_extra_at=Some(at);at },
                    Err(error) => return Some(Err(error)),
                }
            };
            if self.at >= self.end || self.at >= boundary {
                let (path, row) = self.extra.next().unwrap();
                self.next_extra_at=None;
                return Some(Ok(Candidate::Extra(path, row)));
            }
        }
        if self.at >= self.end { return None; }
        let id = self.at;
        self.at += 1;
        Some(Ok(Candidate::Base(id)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn intervals_coalesce_without_counting_twice() {
        let mut hidden = Hidden::default();
        for span in [20..30, 5..10, 10..20, 8..25, 40..42, 0..1, 0..1] { hidden.insert(span); }
        assert_eq!(hidden.spans, BTreeMap::from([(0, 1), (5, 30), (40, 42)]));
        assert_eq!(hidden.count, 28);
        for n in 0..45 { assert_eq!(hidden.contains(n), n == 0 || (5..30).contains(&n) || (40..42).contains(&n)); }
        hidden.insert(0..45);
        assert_eq!(hidden.spans, BTreeMap::from([(0, 45)]));
        assert_eq!(hidden.count, 45);
    }
    fn put(path: &str, directory: bool, stamp: u64) -> Mutation {
        Mutation::Put(Entry { path:path.into(), name:String::new(), directory, modified:if directory { stamp } else { 0 }, size:0 })
    }
    fn reference(index: &mut Index, changes: Vec<Mutation>, limit: usize) {
        for change in changes {
            match change {
                Mutation::Remove(path) => { erase(index, &path); }
                Mutation::Put(item) => {
                    if index.rows.len() < limit || index.rows.contains_key(&PathKey::lookup(key(&item.path))) {
                        let mut row = Record::new(item.path, item.directory, 0);
                        row.item.set_modified(item.modified);
                        index.put(row);
                    }
                }
            }
        }
    }
    fn expected(index: &Index, v: &Value) -> Value {
        let (kind, exts, terms) = parse(v["query"].as_str().unwrap(), v["foldersOnly"].as_bool().unwrap_or(false));
        let (fuzzy, pinyin) = (v["fuzzy"].as_bool().unwrap_or(true),v["pinyin"].as_bool().unwrap_or(true));
        let rules = priority::Rules::new(&serde_json::from_value::<Vec<priority::Rule>>(v["priorities"].clone()).unwrap_or_default());
        let current = key(v["currentFolder"].as_str().unwrap_or(""));
        let prefix = if current.is_empty() {String::new()} else {format!("{current}\\")};
        let (mut total, mut local_total, mut heap) = (0, 0, Ranked::new());
        for (path, row) in index.rows.iter() {
            if accepts(row,&kind,&exts) {
                if let Some((points,mode)) = score(row,path,&terms,fuzzy,pinyin) {
                    let local = !prefix.is_empty() && path.starts_with(&prefix);
                    total += 1;
                    if local {local_total += 1;}
                    retain_match(&mut heap,path,points,mode,local,rules.rank(path));
                }
            }
        }
        json!({"items":ranked_items(&heap,index,&rows::Rows::default()),"total":total,"localTotal":local_total})
    }
    #[test]
    fn mutations_and_order_match_mutable_index() {
        let dir = std::env::temp_dir().join(format!("one-map-overlay-{}",std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("base.bin");
        let mut index = Index::default();
        for path in ["D:\\","D:\\Folder","D:\\Folder\\Nested","D:\\Folder-adjacent","\\\\Server\\Share","D:\\目录"] {
            index.put(Record::new(path.into(),true,0));
        }
        for n in 0..160 {
            for parent in ["D:\\Folder","D:\\Folder\\Nested","D:\\Folder-adjacent"] {
                index.put(Record::new(format!("{parent}\\report-{n:03}.txt"),false,0));
            }
        }
        index.put(Record::new("D:\\目录\\季度报告.pdf".into(),false,0));
        image(&index,&file).unwrap();
        let mut overlay = Overlay::default();
        let batches = vec![
            vec![put("D:\\Folder\\AA-report.txt",false,0),put("D:\\Folder\\report-000.TXT",false,0),put("D:\\Folder\\Nested",true,123_000_000)],
            vec![Mutation::Remove("D:/folder/nested/".into())],
            vec![put("D:\\Folder\\Nested",true,42_000_000),put("D:\\Folder\\Nested\\季度报告.txt",false,0)],
            vec![Mutation::Remove("D:\\Folder".into())],
            vec![Mutation::Remove("D:\\Folder".into()),put("D:\\Folder\\new-report.txt",false,0)],
            // An absent directory root does not erase orphan rows, matching erase.
            vec![Mutation::Remove("D:\\Folder".into()),put("D:\\Folder",true,0)],
            vec![Mutation::Remove("D:\\Folder".into())],
            vec![put("D:\\Folder-adjacent\\report-001.txt",true,91_000_000)],
            vec![put("\\\\SERVER\\Share\\季度报告.txt",false,0)],
            vec![Mutation::Remove("\\\\server\\share".into())],
            vec![put("D:/目录/İ-report.txt",false,0)],
            vec![Mutation::Remove("D:\\".into())],
            vec![put("D:\\",true,0),put("D:\\新目录",true,10_000_000),put("D:\\新目录\\report.pdf",false,0)],
        ];
        for changes in batches {
            let map = Mapping::open(&file).unwrap();
            let view = View::new(map.bytes()).unwrap();
            overlay.apply(&view,changes.clone(),10_000).unwrap();
            reference(&mut index,changes,10_000);
            assert_eq!(overlay.count(&view),index.rows.len());
            let merged: Vec<_> = overlay.iter(&view,0..view.count(),None).map(|candidate| match candidate.unwrap() {
                Candidate::Base(id) => {let row=view.row(id).unwrap();format!("{}{}",row.exact_prefix,row.exact_name)},
                Candidate::Extra(_,row) => row.item.path.to_string(),
            }).collect();
            assert_eq!(merged,index.rows.values().map(|r|r.item.path.to_string()).collect::<Vec<_>>());
            drop(map);
            for query in ["","report","reprot","jdbg","ext:txt report","doc: report","folder:","\"D:/Folder\"","İ-report"] {
                for current in ["","D:\\Folder","D:\\目录"] {
                    let v=json!({"query":query,"scope":1,"currentFolder":current,"priorities":[{"path":"D:\\Folder-adjacent","priority":"uncommon"},{"path":"D:\\目录","priority":"high"}]});
                    let gate=Gate::default();let ticket=gate.enqueue(&v);
                    let mut found=query_image(&file,&v,&gate,ticket,&overlay).unwrap();found.as_object_mut().unwrap().remove("elapsed");
                    assert_eq!(found,expected(&index,&v),"{query} / {current}");
                }
            }
        }
        // Rejections are atomic, including a valid change before a bad item.
        let map = Mapping::open(&file).unwrap();let view=View::new(map.bytes()).unwrap();
        let before=overlay.stats(&view);
        assert!(overlay.apply(&view,vec![put("D:\\would-add.txt",false,0),put("bad\0path",false,0)],10_000).is_err());
        assert_eq!(overlay.stats(&view),before);
        let limit=overlay.count(&view);
        let updates=vec![put("D:\\no-capacity.txt",false,0),put("D:\\新目录",true,22_000_000)];
        overlay.apply(&view,updates.clone(),limit).unwrap();reference(&mut index,updates,limit);
        assert_eq!(overlay.count(&view),index.rows.len());
        assert_eq!(overlay.count(&view),limit);
        drop(map);fs::remove_file(file).unwrap();fs::remove_dir(dir).unwrap();
    }
}
