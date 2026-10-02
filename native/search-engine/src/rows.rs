use super::{PathKey, Record};
use serde::{Serialize, Serializer, ser::SerializeMap};
use std::{
    collections::{BTreeMap, btree_map},
    ops::RangeBounds,
};

// Tree nodes store small slot IDs. Records occupy bounded contiguous chunks,
// so spare tree capacity does not reserve another full copy of each record.
const CHUNK: usize = 4096;
#[derive(Default)]
struct Chunk {
    data: Option<Box<[Option<Record>]>>,
    live: usize,
}
#[derive(Default)]
struct Slots {
    chunks: Vec<Chunk>,
    free: Vec<u32>,
    next: u32,
}
impl Slots {
    fn insert(&mut self, row: Record) -> u32 {
        let id = self.free.pop().unwrap_or_else(|| {
            let id = self.next;
            self.next = self.next.checked_add(1).expect("index slot limit");
            id
        });
        let chunk = id as usize / CHUNK;
        if chunk == self.chunks.len() {
            self.chunks.push(Chunk::default());
        }
        let chunk = &mut self.chunks[chunk];
        let data = chunk.data.get_or_insert_with(|| {
            std::iter::repeat_with(|| None)
                .take(CHUNK)
                .collect::<Vec<_>>()
                .into_boxed_slice()
        });
        debug_assert!(data[id as usize % CHUNK].is_none());
        data[id as usize % CHUNK] = Some(row);
        chunk.live += 1;
        id
    }
    fn get(&self, id: u32) -> &Record {
        self.chunks[id as usize / CHUNK].data.as_ref().unwrap()[id as usize % CHUNK]
            .as_ref()
            .unwrap()
    }
    fn get_mut(&mut self, id: u32) -> &mut Record {
        self.chunks[id as usize / CHUNK].data.as_mut().unwrap()[id as usize % CHUNK]
            .as_mut()
            .unwrap()
    }
    fn remove(&mut self, id: u32) -> Record {
        let chunk = &mut self.chunks[id as usize / CHUNK];
        let row = chunk.data.as_mut().unwrap()[id as usize % CHUNK]
            .take()
            .unwrap();
        chunk.live -= 1;
        if chunk.live == 0 {
            chunk.data = None;
        }
        self.free.push(id);
        row
    }
}
#[derive(Default)]
pub(super) struct Rows {
    keys: BTreeMap<PathKey, u32>,
    slots: Slots,
}
impl Rows {
    pub fn put(&mut self, mut row: Record) -> Option<Record> {
        match self.keys.entry(row.item.path.key().clone()) {
            btree_map::Entry::Occupied(entry) => {
                // Keep both the normalized path owner and the existing slot.
                row.item.path.reuse_key(entry.key());
                Some(std::mem::replace(self.slots.get_mut(*entry.get()), row))
            }
            btree_map::Entry::Vacant(entry) => {
                entry.insert(self.slots.insert(row));
                None
            }
        }
    }
    pub fn len(&self) -> usize {
        self.keys.len()
    }
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }
    pub fn contains_key(&self, path: &PathKey) -> bool {
        self.keys.contains_key(path)
    }
    pub fn get(&self, path: &PathKey) -> Option<&Record> {
        self.keys.get(path).map(|id| self.slots.get(*id))
    }
    pub fn get_mut(&mut self, path: &PathKey) -> Option<&mut Record> {
        self.keys.get(path).map(|id| self.slots.get_mut(*id))
    }
    pub fn remove(&mut self, path: &PathKey) -> Option<Record> {
        let row = self.keys.remove(path).map(|id| self.slots.remove(id));
        if self.is_empty() {
            self.slots = Slots::default();
        }
        row
    }
    pub fn clear(&mut self) {
        *self = Self::default();
    }
    pub fn retain(&mut self, mut predicate: impl FnMut(&PathKey, &mut Record) -> bool) {
        let slots = &mut self.slots;
        self.keys.retain(|key, id| {
            if predicate(key, slots.get_mut(*id)) {
                true
            } else {
                slots.remove(*id);
                false
            }
        });
        if self.is_empty() {
            self.slots = Slots::default();
        }
    }
    pub fn iter(&self) -> Iter<'_> {
        Iter {
            keys: self.keys.iter(),
            slots: &self.slots,
        }
    }
    pub fn values(&self) -> impl DoubleEndedIterator<Item = &Record> + ExactSizeIterator {
        self.iter().map(|(_, row)| row)
    }
    pub fn values_mut(&mut self) -> impl Iterator<Item = &mut Record> {
        self.slots
            .chunks
            .iter_mut()
            .filter_map(|chunk| chunk.data.as_mut())
            .flat_map(|rows| rows.iter_mut())
            .filter_map(Option::as_mut)
    }
    pub fn range(
        &self,
        range: impl RangeBounds<PathKey>,
    ) -> impl DoubleEndedIterator<Item = (&PathKey, &Record)> {
        self.keys
            .range(range)
            .map(|(key, id)| (key, self.slots.get(*id)))
    }
}
pub(super) struct Iter<'a> {
    keys: btree_map::Iter<'a, PathKey, u32>,
    slots: &'a Slots,
}
impl<'a> Iterator for Iter<'a> {
    type Item = (&'a PathKey, &'a Record);
    fn next(&mut self) -> Option<Self::Item> {
        self.keys.next().map(|(key, id)| (key, self.slots.get(*id)))
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.keys.size_hint()
    }
}
impl DoubleEndedIterator for Iter<'_> {
    fn next_back(&mut self) -> Option<Self::Item> {
        self.keys
            .next_back()
            .map(|(key, id)| (key, self.slots.get(*id)))
    }
}
impl ExactSizeIterator for Iter<'_> {}
impl<'a> IntoIterator for &'a Rows {
    type Item = (&'a PathKey, &'a Record);
    type IntoIter = Iter<'a>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}
impl std::ops::Index<&PathKey> for Rows {
    type Output = Record;
    fn index(&self, path: &PathKey) -> &Record {
        self.get(path).expect("existing index path")
    }
}
impl Serialize for Rows {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.len()))?;
        for (key, row) in self {
            map.serialize_entry(key, row)?;
        }
        map.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removal_replacement_reuse_and_order() {
        let mut rows = Rows::default();
        let count = CHUNK * 3;
        for n in (0..count).rev() {
            rows.put(Record::new(
                format!("D:\\Mixed\\file-{n:05}.txt"),
                false,
                n as u64,
            ));
        }
        rows.retain(|_, row| row.seen >= CHUNK as u64 && row.seen < (2 * CHUNK) as u64);
        assert_eq!(rows.len(), CHUNK);
        assert_eq!(
            rows.slots
                .chunks
                .iter()
                .filter(|chunk| chunk.data.is_some())
                .count(),
            1,
            "empty chunks release their storage"
        );
        for n in 0..CHUNK * 2 {
            rows.put(Record::new(
                format!("D:\\Mixed\\new-{n:05}.txt"),
                false,
                n as u64,
            ));
        }
        assert_eq!(rows.len(), count);
        assert_eq!(
            rows.slots.next as usize, count,
            "removed slots must be reused"
        );
        let key = PathKey::lookup("d:\\mixed\\file-04096.txt");
        let mut replacement = Record::new("d:\\MIXED\\FILE-04096.TXT".into(), true, 999);
        replacement.item.modified = 12345;
        assert!(!rows.put(replacement).unwrap().item.directory);
        assert_eq!(rows.len(), count);
        assert_eq!(rows[&key].item.path.display(), "d:\\MIXED\\FILE-04096.TXT");
        assert_eq!(rows[&key].item.modified, 12345);
        rows.values_mut().for_each(|row| row.seen = 100);
        assert!(rows.values().all(|row| row.seen == 100));
        let keys = rows
            .iter()
            .map(|(key, _)| key.normalized())
            .collect::<Vec<_>>();
        assert!(keys.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(rows.range(key.clone()..).next().unwrap().0 == &key);
        assert!(rows.remove(&key).unwrap().item.directory);
        assert!(rows.get(&key).is_none());
        rows.clear();
        assert!(rows.is_empty());
        assert!(rows.slots.chunks.is_empty());
    }
}
