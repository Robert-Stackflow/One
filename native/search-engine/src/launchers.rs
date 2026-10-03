//! Ephemeral program/settings records shared by both index backends. They are
//! never persisted with filesystem entries and retain their display metadata.
use super::*;

pub(super) fn index(items: &Value) -> Option<Index> {
    let entries = serde_json::from_value::<Vec<Entry>>(items.clone()).ok()?;
    let mut index = Index::default();
    for entry in entries.into_iter().filter(|e| e.path.starts_with("one-launcher:")).take(3000) {
        let mut row = Record::new(entry.name.clone(), false, 0);
        row.set_lower(entry.name.to_lowercase());
        row.set_launcher(entry);
        index.put(row);
    }
    Some(index)
}
