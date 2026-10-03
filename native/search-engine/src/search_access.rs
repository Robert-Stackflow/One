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
/// Decisions for only the last parent in an active query. Shared prefixes cover
/// consecutive rows; storage grows with query terms, never with index rows.
pub struct QueryMatcher<'a> {
    terms: &'a [Term],
    fuzzy: bool,
    pinyin: bool,
    path_only: bool,
    parent: Option<(usize, usize, ParentVerdict)>,
    exact_names: bool,
    literal_parent: Option<(usize, usize)>,
    parent_hits: Vec<bool>,
}
impl<'a> QueryMatcher<'a> {
    pub fn new(terms: &'a [Term], fuzzy: bool, pinyin: bool) -> Self {
        let exact_names = !terms.is_empty() && terms.iter().all(|t| t.exact && t.separators == 0);
        Self {
            terms,
            fuzzy,
            pinyin,
            path_only: terms
                .iter()
                .all(|t| t.separators > 0 && (!fuzzy || !t.typo || t.separators > 1)),
            parent: None,
            exact_names,
            literal_parent: None,
            parent_hits: if exact_names {
                vec![false; terms.len()]
            } else {
                Vec::new()
            },
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
    fn exact_score(
        &mut self,
        row: &impl SearchRow,
        path: &impl SearchPath,
    ) -> Option<(i32, &'static str)> {
        let bits = row.bits();
        // Most rows are impossible even after adding parent characters. Keep
        // the original cheap rejection ahead of cached substring decisions.
        if impossible_mask(bits, path.prefix_bits(), self.terms, false) {
            return None;
        }
        let prefix = path.prefix();
        let identity = (prefix.as_ptr() as usize, prefix.len());
        let mut total = if row.directory() { 3 } else { 0 };
        for (id, term) in self.terms.iter().enumerate() {
            // Literal basename terms cannot cross a path separator. Missing
            // name characters let us avoid reading/scanning the name at all.
            let found = if term.bits & bits == term.bits {
                row.lower().find(&term.text)
            } else {
                None
            };
            total += if let Some(at) = found {
                if row.lower() == term.text {
                    1000
                } else if at == 0 {
                    850
                } else {
                    650
                }
            } else {
                // Names outrank paths. Do not scan or cache the parent when
                // every term already matches the basename.
                if self.literal_parent != Some(identity) {
                    let parent_bits = path.prefix_bits();
                    for (term, hit) in self.terms.iter().zip(&mut self.parent_hits) {
                        *hit = term.bits & parent_bits == term.bits && prefix.contains(&term.text);
                    }
                    self.literal_parent = Some(identity);
                }
                if self.parent_hits[id] {
                    180
                } else {
                    return None;
                }
            };
        }
        Some((total, "exact"))
    }
    #[inline(always)]
    pub fn score(
        &mut self,
        row: &impl SearchRow,
        path: &impl SearchPath,
    ) -> Option<(i32, &'static str)> {
        if self.exact_names && row.plain_name() {
            return self.exact_score(row, path);
        }
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
    pub fn shares_parent(&self) -> bool {
        self.path_only || self.exact_names
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
            ("D:\\report\\without-name.txt", false),
            ("D:\\REport\\REPORT", true),
            ("D:\\different\\parent-report.txt", false),
            ("D:\\目录\\季度报告", true),
            ("D:\\目录\\İstanbul.txt", false),
            ("D:\\目录\\Straße.txt", false),
            ("D:\\目录\\report.txt\\", true),
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
            "\"report\"",
            "\"parent\" \"report\"",
            "\"parent\"",
            "\"Report.TXT\"",
            "\"季度报告\"",
            "\"d:\"",
            "\"parent\" \"absent\"",
            "\"parent\" \"report\" \"txt\"",
            "\"İstanbul\"",
            "\"straße\"",
            "\"parentreport\"",
            "\"\"",
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
