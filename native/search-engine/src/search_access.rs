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

#[derive(Clone, Copy)]
enum ParentVerdict {
    Match,
    Reject,
    Name,
}
/// One bounded parent decision per active query. Shared prefixes often cover
/// many consecutive rows; no per-record cache or full path allocation is needed.
pub struct QueryMatcher<'a> {
    terms: &'a [Term],
    fuzzy: bool,
    pinyin: bool,
    path_only: bool,
    parent: Option<(usize, usize, ParentVerdict)>,
}
impl<'a> QueryMatcher<'a> {
    pub fn new(terms: &'a [Term], fuzzy: bool, pinyin: bool) -> Self {
        Self {
            terms,
            fuzzy,
            pinyin,
            path_only: terms
                .iter()
                .all(|t| t.separators > 0 && (!fuzzy || !t.typo || t.separators > 1)),
            parent: None,
        }
    }
    fn verdict(&mut self, path: &impl SearchPath) -> ParentVerdict {
        let prefix = path.prefix();
        let identity = (prefix.as_ptr() as usize, prefix.len());
        if let Some((at, len, verdict)) = self.parent {
            if (at, len) == identity {
                return verdict;
            }
        }
        let mut verdict = ParentVerdict::Match;
        for term in self.terms {
            if prefix.contains(&term.text) {
                continue;
            }
            // A term can span the parent/name boundary only when the parent
            // ends with its part through the last separator. Otherwise no
            // plain basename in this parent can match this path term.
            if term
                .text
                .rfind('\\')
                .is_some_and(|at| prefix.ends_with(&term.text[..=at]))
            {
                verdict = ParentVerdict::Name;
            } else {
                verdict = ParentVerdict::Reject;
                break;
            }
        }
        self.parent = Some((identity.0, identity.1, verdict));
        verdict
    }
    #[inline(always)]
    pub fn score(
        &mut self,
        row: &impl SearchRow,
        path: &impl SearchPath,
    ) -> Option<(i32, &'static str)> {
        // Plain metadata guarantees that the search name is the normalized
        // basename. Roots, launcher display names and exceptional spellings
        // continue through the original matcher.
        if self.path_only && row.plain_name() {
            match self.verdict(path) {
                ParentVerdict::Match => {
                    return Some((
                        180 * self.terms.len() as i32 + if row.directory() { 3 } else { 0 },
                        "exact",
                    ));
                }
                ParentVerdict::Reject => return None,
                ParentVerdict::Name => {}
            }
        }
        super::score(row, path, self.terms, self.fuzzy, self.pinyin)
    }
    pub fn path_only(&self) -> bool {
        self.path_only
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_parent_decisions_match_general_scoring() {
        let paths = [
            ("D:\\parent\\report.txt", false),
            ("D:\\parent\\another.txt", false),
            ("D:\\parent\\child", true),
            ("D:\\parent\\child\\report.txt", false),
            ("D:\\parent\\Report.TXT", false),
            ("D:\\目录\\report.txt", false),
            ("D:\\parent-adjacent\\report.txt", false),
            ("D:\\", true),
            ("D:\\parent\\季度报告.txt", false),
            ("D:/Mixed/Folder/File.TXT", false),
            ("\\\\server\\share\\report.txt", false),
        ];
        let mut index = Index::default();
        for (path, dir) in paths {
            index.put(Record::new(path.into(), dir, 0));
        }
        for query in [
            "",
            "report",
            "re/port",
            "r/e/port",
            "parent/report",
            "\"parent/report\"",
            "\"d:/parent\"",
            "\"d:/parent\" \"parent/child\"",
            "\"目录/report\"",
            "\"parent/report\" report",
            "\"server/share\"",
            "\"D:/\"",
            "jdbg",
        ] {
            let (_, _, terms) = parse(query, false);
            for (fuzzy, pinyin) in [(false, false), (false, true), (true, false), (true, true)] {
                let mut matcher = QueryMatcher::new(&terms, fuzzy, pinyin);
                // Visit the same parents again in reverse, crossing nested and
                // unrelated prefixes, to exercise cached and fallback paths.
                for (path, row) in index.rows.iter().chain(index.rows.iter().rev()) {
                    assert_eq!(
                        matcher.score(row, path),
                        super::super::score(row, path, &terms, fuzzy, pinyin),
                        "{path} / {query}"
                    );
                }
            }
        }
    }
}
