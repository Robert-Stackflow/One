use std::{
    borrow::Borrow,
    cmp::Ordering,
    collections::HashSet,
    hash::{Hash, Hasher},
    sync::Arc,
};

#[derive(Clone)]
struct Parent(Arc<Prefix>);
struct Prefix {
    text: Box<str>,
    bits: u128,
}
impl Parent {
    fn new(text: &str) -> Self {
        Self(Arc::new(Prefix {
            text: text.into(),
            bits: super::mask(text),
        }))
    }
    fn text(&self) -> &str {
        &self.0.text
    }
}
impl Borrow<str> for Parent {
    fn borrow(&self) -> &str {
        self.text()
    }
}
impl PartialEq for Parent {
    fn eq(&self, other: &Self) -> bool {
        self.text() == other.text()
    }
}
impl Eq for Parent {}
impl Hash for Parent {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.text().hash(state)
    }
}

/// Ordered, normalized path with a shared directory prefix. Searches never join it.
#[derive(Clone)]
pub struct PathKey(Arc<Parts>);
#[derive(Clone)]
struct Parts {
    prefix: Parent,
    name: Box<str>,
}
#[derive(Default)]
pub struct PathPool {
    parents: HashSet<Parent>,
}
impl PathPool {
    pub fn share(&mut self, key: &mut PathKey) {
        let prefix = self
            .parents
            .get(key.0.prefix.text())
            .cloned()
            .unwrap_or_else(|| {
                let prefix = key.0.prefix.clone();
                self.parents.insert(prefix.clone());
                prefix
            });
        if !Arc::ptr_eq(&prefix.0, &key.0.prefix.0) {
            Arc::make_mut(&mut key.0).prefix = prefix;
        }
    }
    pub fn collect(&mut self) {
        self.parents.retain(|path| Arc::strong_count(&path.0) > 1);
        if self.parents.capacity() > self.parents.len().saturating_mul(4) {
            self.parents.shrink_to_fit();
        }
    }
    pub fn clear(&mut self) {
        self.parents.clear();
        self.parents.shrink_to_fit();
    }
}
impl PathKey {
    pub fn new(value: String) -> Self {
        let at = value.rfind('\\').map_or(0, |at| at + 1);
        Self(Arc::new(Parts {
            prefix: Parent::new(&value[..at]),
            name: Box::from(&value[at..]),
        }))
    }
    pub fn lookup(value: impl AsRef<str>) -> Self {
        Self::new(value.as_ref().to_owned())
    }
    pub fn name(&self) -> &str {
        &self.0.name
    }
    pub fn prefix(&self) -> &str {
        self.0.prefix.text()
    }
    pub fn len(&self) -> usize {
        self.prefix().len() + self.0.name.len()
    }
    pub fn normalized(&self) -> String {
        let mut result = String::with_capacity(self.len());
        result.push_str(self.prefix());
        result.push_str(self.name());
        result
    }
    pub fn starts_with(&self, text: &str) -> bool {
        let prefix = self.prefix();
        if text.len() <= prefix.len() {
            prefix.starts_with(text)
        } else {
            text.starts_with(prefix) && self.name().starts_with(&text[prefix.len()..])
        }
    }
    pub fn under(&self, root: &str) -> bool {
        if !self.starts_with(root) {
            return false;
        }
        if self.len() == root.len() {
            return true;
        }
        let at = root.len();
        let next = if at < self.prefix().len() {
            self.prefix().as_bytes().get(at)
        } else {
            self.name().as_bytes().get(at - self.prefix().len())
        };
        next == Some(&b'\\')
    }
    pub fn contains(&self, text: &str) -> bool {
        self.name().contains(text) || self.contains_parent(text)
    }
    pub fn prefix_bits(&self) -> u128 {
        self.0.prefix.0.bits
    }
    pub fn contains_parent(&self, text: &str) -> bool {
        if self.prefix().contains(text) {
            return true;
        }
        // Only a path term with a separator can cross the prefix/file-name boundary.
        let Some(split) = text.rfind('\\') else {
            return false;
        };
        self.prefix().ends_with(&text[..=split]) && self.name().starts_with(&text[split + 1..])
    }
}
fn compare(a: &Parts, b: &Parts) -> Ordering {
    if Arc::ptr_eq(&a.prefix.0, &b.prefix.0) {
        return a.name.cmp(&b.name);
    }
    let mut left = [a.prefix.text().as_bytes(), a.name.as_bytes()].into_iter();
    let mut right = [b.prefix.text().as_bytes(), b.name.as_bytes()].into_iter();
    let mut l = left.next().unwrap();
    let mut r = right.next().unwrap();
    loop {
        if l.is_empty() {
            if let Some(next) = left.next() {
                l = next;
                continue;
            }
            return if r.is_empty() && right.all(|p| p.is_empty()) {
                Ordering::Equal
            } else {
                Ordering::Less
            };
        }
        if r.is_empty() {
            if let Some(next) = right.next() {
                r = next;
                continue;
            }
            return Ordering::Greater;
        }
        let count = l.len().min(r.len());
        let order = l[..count].cmp(&r[..count]);
        if order != Ordering::Equal {
            return order;
        }
        l = &l[count..];
        r = &r[count..];
    }
}
impl Ord for PathKey {
    fn cmp(&self, other: &Self) -> Ordering {
        compare(&self.0, &other.0)
    }
}
impl PartialOrd for PathKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl PartialEq for PathKey {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for PathKey {}
impl std::fmt::Display for PathKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.prefix())?;
        f.write_str(self.name())
    }
}
impl serde::Serialize for PathKey {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.normalized())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn order_and_substrings_are_identical_to_full_paths() {
        let paths = [
            "",
            "c:",
            "c:\\a",
            "c:\\aa",
            "c:\\a.txt",
            "c:\\a\\b",
            "c:\\a\\bb",
            "c:\\a\\b.txt",
            "c:\\a0\\z",
            "c:\\中文\\文件.txt",
            "\\\\server\\share\\a.txt",
            "one-launcher:app:qq",
        ];
        let mut pool = PathPool::default();
        for a in paths {
            let mut key = PathKey::new(a.into());
            pool.share(&mut key);
            for b in paths {
                assert_eq!(key.cmp(&PathKey::new(b.into())), a.cmp(b), "{a:?} / {b:?}");
                assert_eq!(key.starts_with(b), a.starts_with(b));
                assert_eq!(key.contains(b), a.contains(b));
            }
            for (start, _) in a.char_indices() {
                for end in start..=a.len() {
                    if a.is_char_boundary(end) {
                        let term = &a[start..end];
                        assert_eq!(
                            key.contains(term),
                            a.contains(term),
                            "{a:?} contains {term:?}"
                        );
                    }
                }
            }
        }
    }
    #[test]
    fn shared_prefix_ownership_is_reclaimed() {
        let mut pool = PathPool::default();
        let mut a = PathKey::new("d:\\same\\a".into());
        let mut b = PathKey::new("d:\\same\\b".into());
        pool.share(&mut a);
        pool.share(&mut b);
        assert!(Arc::ptr_eq(&a.0.prefix.0, &b.0.prefix.0));
        pool.collect();
        assert_eq!(pool.parents.len(), 1);
        drop(a);
        drop(b);
        pool.collect();
        assert_eq!(pool.parents.len(), 0);
        assert_eq!(pool.parents.capacity(), 0);
    }
}
