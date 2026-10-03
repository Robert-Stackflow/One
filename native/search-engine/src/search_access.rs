use super::*;
pub trait SearchPath {
    fn name(&self) -> &str;
    fn prefix(&self) -> &str;
    fn prefix_bits(&self) -> u128;
    fn starts_with(&self, text: &str) -> bool;
    fn under(&self, root: &str) -> bool;
    fn contains_parent(&self, text: &str) -> bool;
    fn contains(&self, text: &str) -> bool;
}
impl SearchPath for PathKey {
    fn name(&self) -> &str {
        self.name()
    }
    fn prefix(&self) -> &str {
        self.prefix()
    }
    fn prefix_bits(&self) -> u128 {
        self.prefix_bits()
    }
    fn starts_with(&self, text: &str) -> bool {
        self.starts_with(text)
    }
    fn under(&self, root: &str) -> bool {
        self.under(root)
    }
    fn contains_parent(&self, text: &str) -> bool {
        self.contains_parent(text)
    }
    fn contains(&self, text: &str) -> bool {
        self.contains(text)
    }
}
pub trait SearchRow {
    fn directory(&self) -> bool;
    fn lower(&self) -> &str;
    fn bits(&self) -> u128;
    fn phonetic(&self) -> impl Iterator<Item = &str>;
    fn plain_name(&self) -> bool;
    fn launcher_matches(&self, kind: &str) -> Option<bool>;
}
impl SearchRow for Record {
    fn directory(&self) -> bool {
        self.item.directory()
    }
    fn lower(&self) -> &str {
        self.lower()
    }
    fn bits(&self) -> u128 {
        self.bits.value()
    }
    fn phonetic(&self) -> impl Iterator<Item = &str> {
        self.phonetic()
    }
    fn plain_name(&self) -> bool {
        matches!(self.item.metadata, Metadata::File | Metadata::Directory(_))
    }
    fn launcher_matches(&self, kind: &str) -> Option<bool> {
        let path = self.item.path.key();
        path.starts_with("one-launcher:")
            .then(|| kind.is_empty() || path.starts_with(&format!("one-launcher:{kind}:")))
    }
}
