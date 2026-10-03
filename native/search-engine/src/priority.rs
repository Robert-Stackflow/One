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
pub struct Rules(Vec<(String, i8)>);
impl Rules {
    pub fn new(rules: &[Rule]) -> Self {
        let mut compiled: Vec<_> = rules.iter().map(|r| (key(&r.path), r.priority.rank())).collect();
        compiled.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        Self(compiled)
    }
    pub fn rank(&self, path: &PathKey) -> i8 {
        self.0.iter().find(|(root, _)| path.under(root)).map_or(0, |(_, rank)| *rank)
    }
    fn rank_key(&self, path: &str) -> i8 {
        self.0.iter().find(|(root, _)| under(path, root)).map_or(0, |(_, rank)| *rank)
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
