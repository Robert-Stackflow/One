use super::*;

#[derive(Clone, Serialize, Deserialize)]
pub struct Rule {
    pub path: String,
    pub priority: Level,
}
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level { High, Normal, Uncommon }
impl Level {
    fn rank(self) -> i8 { match self { Self::High => 1, Self::Normal => 0, Self::Uncommon => -1 } }
}
// Keep tiny rule sets as direct comparisons. Larger sets share their common
// directory prefixes, so a matching row never checks every configured root.
pub struct Rules { linear: Vec<(String, i8)>, tree: Option<Node> }
struct Node { label: Box<[u8]>, rank: Option<i8>, children: Vec<Node> }
impl Node {
    fn empty() -> Self { Self {label: Box::default(), rank: None, children: Vec::new()} }
    fn insert(&mut self, path: &[u8], rank: i8) {
        let common = self.label.iter().zip(path).take_while(|(a,b)| a == b).count();
        if common < self.label.len() {
            let child = Self { label: self.label[common..].into(), rank: self.rank.take(), children: std::mem::take(&mut self.children) };
            self.label = self.label[..common].into();
            self.children.push(child);
        }
        let remaining = &path[common..];
        if remaining.is_empty() { self.rank.get_or_insert(rank); return; }
        match self.children.binary_search_by_key(&remaining[0], |n| n.label[0]) {
            Ok(at) => self.children[at].insert(remaining, rank),
            Err(at) => self.children.insert(at, Self {label: remaining.into(), rank: Some(rank), children: Vec::new()}),
        }
    }
    fn rank(&self, parent: &[u8], name: &[u8]) -> i8 {
        let byte = |at: usize| if at < parent.len() {parent.get(at)} else {name.get(at-parent.len())};
        let mut node=self;let mut offset=0;let mut best=0;
        loop {
            let matched = if offset < parent.len() {
                let count=node.label.len().min(parent.len()-offset);
                parent[offset..offset+count] == node.label[..count] && name.starts_with(&node.label[count..])
            } else { name.get(offset-parent.len()..).is_some_and(|tail| tail.starts_with(&node.label)) };
            if !matched { return best; }
            offset += node.label.len();
            let next=byte(offset);
            if let Some(rank)=node.rank { if next.is_none() || next == Some(&b'\\') {best=rank;} }
            let Some(next)=next else {return best};
            let Ok(at)=node.children.binary_search_by_key(next, |n| n.label[0]) else {return best};
            node=&node.children[at];
        }
    }
}
impl Rules {
    pub fn new(rules: &[Rule]) -> Self {
        let mut compiled: Vec<_> = rules.iter().map(|r| (key(&r.path), r.priority.rank())).collect();
        compiled.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        if compiled.len() > 4 {
            let mut tree=Node::empty();for (path,rank) in &compiled {tree.insert(path.as_bytes(),*rank);}
            Self {linear: Vec::new(), tree: Some(tree)}
        } else {Self {linear: compiled, tree: None}}
    }
    pub fn rank(&self, path: &PathKey) -> i8 {
        if let Some(tree)=&self.tree {tree.rank(path.prefix().as_bytes(),path.name().as_bytes())}
        else {self.linear.iter().find(|(root, _)| path.under(root)).map_or(0, |(_, rank)| *rank)}
    }
    fn rank_key(&self, path: &str) -> i8 {
        if let Some(tree)=&self.tree {tree.rank(path.as_bytes(),&[])}
        else {self.linear.iter().find(|(root, _)| under(path, root)).map_or(0, |(_, rank)| *rank)}
    }
}
pub struct Scan { pub root: String, pub config: Config }
// Split parent scopes at explicit subdirectory boundaries. Each directory is
// visited once, with high-priority scopes before normal and uncommon scopes.
pub fn scans(config: &Config) -> Vec<Scan> {
    let rules = Rules::new(&config.priorities);
    let roots: Vec<_> = config.roots.iter().map(|r| key(r)).collect();
    let excluded: Vec<_> = config.excluded.iter().map(|r| key(r)).collect();
    let mut regions = BTreeMap::new();
    for path in config.roots.iter().chain(config.priorities.iter().map(|r| &r.path)) {
        let normalized = key(path);
        if roots.iter().any(|r| under(&normalized, r)) && !excluded.iter().any(|r| under(&normalized, r)) {
            regions.insert(normalized, path.clone());
        }
    }
    let mut ordered: Vec<_> = regions.iter().collect();
    ordered.sort_by(|a, b| rules.rank_key(b.0).cmp(&rules.rank_key(a.0)).then(a.0.cmp(b.0)));
    ordered.into_iter().map(|(normalized, path)| {
        let mut scope = config.clone();
        scope.excluded.extend(regions.iter().filter(|(child, _)| *child != normalized && under(child, normalized)).map(|(_, path)| path.clone()));
        Scan { root: path.clone(), config: scope }
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn priorities_use_specific_directory_and_preserve_boundaries() {
        let rules = Rules::new(&[
            Rule {path: "C:/work".into(), priority: Level::Uncommon},
            Rule {path: "c:/WORK/project".into(), priority: Level::High},
            Rule {path: "C:/work/project/temp".into(), priority: Level::Normal},
        ]);
        for (path, expected) in [("C:/work/a.txt",-1),("C:/work/project/a.txt",1),("C:/work/project/temp/a.txt",0),("C:/work-else/a.txt",0)] {
            assert_eq!(rules.rank(&PathKey::new(key(path))), expected);
        }
    }
    #[test]
    fn compressed_rules_agree_with_directory_semantics_across_path_parts() {
        let mut source=vec![
            Rule {path:"C:/项目/中文".into(),priority:Level::High},
            Rule {path:"C:/项目/中旬".into(),priority:Level::Uncommon},
            Rule {path:"C:/项目".into(),priority:Level::Uncommon},
            Rule {path:"C:/项目/中文/内部".into(),priority:Level::Normal},
            Rule {path:"//server/share/资料".into(),priority:Level::High},
            Rule {path:"D:/".into(),priority:Level::High},
        ];
        for n in 0..58 {source.push(Rule {path:format!("C:/项目/范围{n}/内部"),priority:match n%3 {0=>Level::High,1=>Level::Normal,_=>Level::Uncommon}});}
        for reversed in [false,true] {
            if reversed {source.reverse();}
            let rules=Rules::new(&source);assert!(rules.tree.is_some());
            let mut reference:Vec<_>=source.iter().map(|r|(key(&r.path),r.priority.rank())).collect();reference.sort_by(|a,b|b.0.len().cmp(&a.0.len()));
            let mut paths=vec!["C:/项目".into(),"C:/项目/中文".into(),"C:/项目/中文/内部/文件.txt".into(),"C:/项目/中文外/文件.txt".into(),"C:/项目/中旬/a.txt".into(),"//server/share/资料/a.txt".into(),"//server/share/资料外/a.txt".into(),"D:/a.txt".into(),"D:/".into(),"E:/a.txt".into(),"one-launcher:app:资料".into()];
            for n in 0..64 {for suffix in ["","/内部","/内部/a.txt","/内部外/a.txt","/内部/嵌套/文件.txt","外/内部/a.txt"] {paths.push(format!("C:/项目/范围{n}{suffix}"));}}
            for path in paths {let normalized=key(&path);let expected=reference.iter().find(|(root,_)|under(&normalized,root)).map_or(0,|(_,rank)|*rank);assert_eq!(rules.rank(&PathKey::new(normalized.clone())),expected,"{path}");assert_eq!(rules.rank_key(&normalized),expected,"{path}");}
        }
    }
    #[test]
    fn scans_cover_overlapping_scopes_once_in_priority_order() {
        let config = Config { roots: vec!["C:/scope".into(),"C:/scope/normal".into()], excluded: vec!["C:/scope/hidden".into()], priorities: vec![
            Rule {path:"C:/scope/normal/high".into(), priority:Level::High},
            Rule {path:"C:/scope/low".into(), priority:Level::Uncommon},
            Rule {path:"C:/scope/hidden/high".into(), priority:Level::High},
        ], ..Config::default() };
        let plan = scans(&config);
        assert_eq!(plan.first().unwrap().root,"C:/scope/normal/high");
        assert_eq!(plan.last().unwrap().root,"C:/scope/low");
        for path in ["C:/scope/a.txt","C:/scope/normal/a.txt","C:/scope/normal/high/a.txt","C:/scope/low/a.txt"] {
            let path=key(path);
            assert_eq!(plan.iter().filter(|s| under(&path,&key(&s.root)) && !s.config.excluded.iter().any(|r| under(&path,&key(r)))).count(),1);
        }
        assert_eq!(plan.len(),4);
    }
}
