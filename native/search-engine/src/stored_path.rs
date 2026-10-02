use std::{borrow::Cow, sync::Arc};

/// Share the normalized lookup key, retaining exact display spelling with case bits.
/// Unicode case expansions, alternate separators and trailing separators remain lossless.
#[derive(Clone)]
pub struct StoredPath {
    key: Arc<str>,
    spelling: Spelling,
}
#[derive(Clone)]
enum Spelling {
    Same,
    Small([u64; 2]),
    Bits(Box<[u8]>),
    Full(Box<str>),
}
impl StoredPath {
    pub fn new(path: String) -> Self {
        let key: Arc<str> = super::key(&path).into();
        if path == key.as_ref() {
            return Self {
                key,
                spelling: Spelling::Same,
            };
        }
        if path.len() != key.len()
            || path.bytes().zip(key.bytes()).any(|(original, folded)| {
                original != folded
                    && (!original.is_ascii_uppercase() || original.to_ascii_lowercase() != folded)
            })
        {
            return Self {
                key,
                spelling: Spelling::Full(path.into_boxed_str()),
            };
        }
        // Most capitals are in the drive/leading folders or the final file name.
        // Store both windows inline even when the complete path is very long.
        let tail = path.len().saturating_sub(64);
        let mut windows = [0u64; 2];
        let mut wide = false;
        for (at, byte) in path.bytes().enumerate() {
            if !byte.is_ascii_uppercase() {
                continue;
            }
            if at < 64 {
                windows[0] |= 1 << at;
            } else if at >= tail {
                windows[1] |= 1 << (at - tail);
            } else {
                wide = true;
            }
        }
        let spelling = if !wide {
            Spelling::Small(windows)
        } else {
            let mut bits = vec![0; path.len().div_ceil(8)];
            for (at, byte) in path.bytes().enumerate() {
                if byte.is_ascii_uppercase() {
                    bits[at / 8] |= 1 << (at % 8);
                }
            }
            Spelling::Bits(bits.into_boxed_slice())
        };
        Self { key, spelling }
    }
    pub fn key(&self) -> &Arc<str> {
        &self.key
    }
    pub fn reuse_key(&mut self, key: &Arc<str>) {
        debug_assert_eq!(&self.key, key);
        self.key = key.clone();
    }
    pub fn display(&self) -> Cow<'_, str> {
        match &self.spelling {
            Spelling::Same => Cow::Borrowed(&self.key),
            Spelling::Full(original) => Cow::Borrowed(original),
            spelling => {
                let mut bytes = self.key.as_bytes().to_vec();
                match spelling {
                    Spelling::Small(windows) => {
                        for (offset, mask) in [0, self.key.len().saturating_sub(64)]
                            .into_iter()
                            .zip(windows)
                        {
                            let mut mask = *mask;
                            while mask != 0 {
                                let at = offset + mask.trailing_zeros() as usize;
                                bytes[at] = bytes[at].to_ascii_uppercase();
                                mask &= mask - 1;
                            }
                        }
                    }
                    Spelling::Bits(bits) => {
                        for (index, mask) in bits.iter().enumerate() {
                            let mut mask = *mask;
                            while mask != 0 {
                                let at = index * 8 + mask.trailing_zeros() as usize;
                                bytes[at] = bytes[at].to_ascii_uppercase();
                                mask &= mask - 1;
                            }
                        }
                    }
                    _ => unreachable!(),
                }
                Cow::Owned(String::from_utf8(bytes).expect("case bits only change ASCII letters"))
            }
        }
    }
}
impl std::fmt::Display for StoredPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.display())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_spelling_and_normalized_lookup() {
        for path in [
            "d:\\lower\\report.txt",
            "D:\\中文\\File.JSON",
            "D:\\docs\\Résumé-Σ.txt",
            "D:\\İstanbul\\İ.TXT",
            "D:/Mixed/Folder.TXT",
            "D:\\folder\\",
            "D:\\",
            "\\\\Server\\Share\\文件.TXT",
            "one-launcher:app:ABC.Def",
        ] {
            let stored = StoredPath::new(path.into());
            assert_eq!(stored.display(), path);
            assert_eq!(stored.key().as_ref(), crate::key(path));
            assert_eq!(stored.clone().display(), path);
        }
    }
    #[test]
    fn case_bits_across_unicode_and_word_boundaries() {
        for size in [0, 1, 55, 56, 57, 63, 64, 65, 127, 128, 511, 4000] {
            let path = format!("D:\\中文{}\\End.Z", "aB文cD".repeat(size));
            let stored = StoredPath::new(path.clone());
            assert_eq!(stored.display(), path);
            assert_eq!(stored.key().as_ref(), crate::key(&path));
            let path = format!(
                "D:\\{}\\Final-Name.TXT",
                "long-lowercase-folder\\".repeat(size)
            );
            assert_eq!(StoredPath::new(path.clone()).display(), path);
        }
    }
}
