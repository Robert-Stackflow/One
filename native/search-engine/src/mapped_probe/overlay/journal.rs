//! Atomic bounded delta snapshots, tied to a specific base generation. Until
//! background compaction exists, overflow is an explicit diagnostic error.
use super::*;
use std::io::Read;

const MAGIC: &[u8; 8] = b"ONESPL01";
const HEADER: usize = 40;
const MAX_BYTES: usize = 8 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
struct Saved {
    spans: Vec<(usize, usize)>,
    items: Vec<Entry>,
}
fn checksum(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |h,b| (h ^ *b as u64).wrapping_mul(0x100000001b3))
}
pub(super) fn save(overlay: &Overlay, target: &Path) -> io::Result<()> {
    let saved = Saved {
        spans:overlay.hidden.spans.iter().map(|(&a,&b)|(a,b)).collect(),
        items:overlay.extra.values().map(|r|r.item.entry()).collect(),
    };
    let data = serde_json::to_vec(&saved).map_err(|_|bad())?;
    if data.len() > MAX_BYTES { return Err(io::Error::new(io::ErrorKind::WouldBlock,"磁盘增量需要合并")); }
    let mut header=[0;HEADER];header[..8].copy_from_slice(MAGIC);
    header[8..24].copy_from_slice(&overlay.generation.ok_or_else(bad)?);
    put64(&mut header,24,data.len() as u64);put64(&mut header,32,checksum(&data));
    let temporary=target.with_extension(format!("{}.delta.tmp",std::process::id()));
    // Only remove the temporary created successfully by this writer.
    let mut file=OpenOptions::new().write(true).create_new(true).open(&temporary)?;
    let guard=Temps(vec![temporary.clone()]);
    file.write_all(&header)?;file.write_all(&data)?;file.sync_all()?;drop(file);
    fs::rename(&temporary,target)?;drop(guard);
    Ok(())
}
pub(super) fn load(view: &View<'_>, path: &Path) -> io::Result<Overlay> {
    let mut file=match File::open(path) {
        Ok(file)=>file,
        Err(e) if e.kind()==io::ErrorKind::NotFound => return Ok(Overlay {generation:Some(view.generation),..Overlay::default()}),
        Err(e)=>return Err(e),
    };
    if file.metadata()?.len() > (MAX_BYTES + HEADER) as u64 { return Err(bad()); }
    let mut header=[0;HEADER];file.read_exact(&mut header)?;
    if &header[..8]!=MAGIC {return Err(bad());}
    if header[8..24]!=view.generation {return Err(io::Error::other("磁盘增量与索引版本不一致"));}
    let length=wide(&header,24)?;
    if length > MAX_BYTES as u64 || length + HEADER as u64 != file.metadata()?.len() {return Err(bad());}
    let mut data=vec![0;length as usize];file.read_exact(&mut data)?;
    if checksum(&data)!=wide(&header,32)? {return Err(bad());}
    let saved:Saved=serde_json::from_slice(&data).map_err(|_|bad())?;
    if saved.spans.len()>MAX_INTERVALS || saved.items.len()>MAX_EXTRA {return Err(bad());}
    let mut result=Overlay {generation:Some(view.generation),..Overlay::default()};
    let mut previous=None;
    for (start,end) in saved.spans {
        if start>=end || end>view.count() || previous.is_some_and(|last|last>=start) {return Err(bad());}
        result.hidden.insert(start..end);previous=Some(end);
    }
    for item in saved.items {
        let path=&item.path;
        if path.len()>131_072 || path.contains('\0') || key(path).is_empty()
            || key(path).starts_with("one-launcher:") || (!item.directory && item.modified!=0) {return Err(bad());}
        let lookup=PathKey::lookup(key(path));
        if let Some(id)=Overlay::base_id(view,&key(path))? {
            if !result.hidden.contains(id) {return Err(bad());}
        }
        let mut row=Record::new(item.path,item.directory,0);row.item.set_modified(item.modified);
        if result.extra.insert(lookup,row).is_some() {return Err(bad());}
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delta_roundtrip_checksum_generation_and_failed_replace() {
        let dir=std::env::temp_dir().join(format!("one-map-delta-{}",std::process::id()));fs::create_dir_all(&dir).unwrap();
        let base=dir.join("base.bin");let journal=dir.join("delta.bin");
        let mut index=Index::default();index.put(Record::new("D:\\Folder".into(),true,0));index.put(Record::new("D:\\Folder\\old.txt".into(),false,0));image(&index,&base).unwrap();
        let map=Mapping::open(&base).unwrap();let view=View::new(map.bytes()).unwrap();let initial=load(&view,&journal).unwrap();
        let changes=vec![Mutation::Remove("D:\\Folder".into()),Mutation::Put(Entry {path:"D:\\Folder\\季度报告.txt".into(),name:String::new(),directory:false,modified:0,size:0})];
        let next=initial.stage(&view,changes,100).unwrap();next.save(&journal).unwrap();let saved=fs::read(&journal).unwrap();
        let loaded=load(&view,&journal).unwrap();assert_eq!(loaded.stats(&view),next.stats(&view));assert_eq!(loaded.extra.values().next().unwrap().item.path.display(),"D:\\Folder\\季度报告.txt");
        // A stale unrelated temp must survive create_new failure; the previous
        // acknowledged snapshot remains byte-for-byte intact.
        let temp=journal.with_extension(format!("{}.delta.tmp",std::process::id()));fs::write(&temp,"unrelated").unwrap();
        assert!(next.save(&journal).is_err());assert_eq!(fs::read(&journal).unwrap(),saved);assert_eq!(fs::read(&temp).unwrap(),b"unrelated");fs::remove_file(temp).unwrap();
        let mut corrupt=saved.clone();*corrupt.last_mut().unwrap()^=1;fs::write(&journal,&corrupt).unwrap();assert!(load(&view,&journal).is_err());
        fs::write(&journal,&saved[..saved.len()-1]).unwrap();assert!(load(&view,&journal).is_err());fs::write(&journal,&saved).unwrap();
        drop(map);image(&index,&base).unwrap();let map=Mapping::open(&base).unwrap();let other=View::new(map.bytes()).unwrap();assert!(load(&other,&journal).is_err());assert!(next.check(&other).is_err());
        drop(map);for file in [base,journal] {fs::remove_file(file).unwrap();}fs::remove_dir(dir).unwrap();
    }
}
