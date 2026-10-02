use crate::output;
use jwalk::rayon::prelude::*;
use serde::Deserialize;
use serde_json::json;
use std::{
    fs,
    io::{self, Read},
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    sync::{
        Mutex,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};
#[derive(Deserialize)]
struct FileEntry {
    path: String,
    size: u64,
    mtime: u64,
}
#[derive(Deserialize)]
struct DeleteRequest {
    root: String,
    files: Vec<FileEntry>,
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetFinalPathNameByHandleW(
        handle: *mut std::ffi::c_void,
        path: *mut u16,
        length: u32,
        flags: u32,
    ) -> u32;
    fn SetFileInformationByHandle(
        handle: *mut std::ffi::c_void,
        class: u32,
        info: *const u8,
        size: u32,
    ) -> i32;
}
fn normalized(path: &str) -> String {
    path.trim_start_matches(r"\\?\")
        .trim_end_matches('\\')
        .to_lowercase()
}
pub fn remove() {
    let mut input = String::new();
    let request = io::stdin()
        .take(128 * 1024 * 1024)
        .read_to_string(&mut input)
        .and_then(|_| serde_json::from_str::<DeleteRequest>(&input).map_err(io::Error::other));
    let Ok(request) = request else {
        output(json!({"error":"清理请求无效"}));
        return;
    };
    if request.files.len() > 200000 || request.root.is_empty() {
        output(json!({"error":"清理范围无效"}));
        return;
    }
    let root = normalized(&request.root);
    let prefix = format!("{root}\\");
    let failures = Mutex::new(Vec::new());
    let failed = AtomicUsize::new(0);
    let removed = AtomicUsize::new(0);
    let completed = AtomicUsize::new(0);
    let bytes = AtomicU64::new(0);
    let last = Mutex::new(Instant::now());
    let pool = jwalk::rayon::ThreadPoolBuilder::new()
        .num_threads(8)
        .build()
        .unwrap();
    pool.install(|| {
        request.files.par_iter().for_each(|f| {
            let result = (|| -> io::Result<()> {
                // Open the actual file with DELETE access, then validate and delete that handle.
                // A directory junction changed after scanning cannot redirect deletion outside the root.
                let file = fs::OpenOptions::new()
                    .access_mode(0x10000 | 0x80)
                    .share_mode(7)
                    .custom_flags(0x00200000)
                    .open(&f.path)?;
                let meta = file.metadata()?;
                if !meta.is_file()
                    || meta.file_type().is_symlink()
                    || meta.len() != f.size
                    || meta
                        .modified()?
                        .duration_since(UNIX_EPOCH)
                        .map_err(io::Error::other)?
                        .as_millis()
                        != f.mtime as u128
                {
                    return Err(io::Error::other("文件已变化"));
                }
                let mut name = vec![0u16; 32768];
                let len = unsafe {
                    GetFinalPathNameByHandleW(
                        file.as_raw_handle(),
                        name.as_mut_ptr(),
                        name.len() as u32,
                        0,
                    )
                };
                if len == 0 || len as usize >= name.len() {
                    return Err(io::Error::last_os_error());
                }
                let actual = normalized(&String::from_utf16_lossy(&name[..len as usize]));
                if !actual.starts_with(&prefix) {
                    return Err(io::Error::other("文件链接已变化，超出清理范围"));
                }
                let disposition = 1u8;
                if unsafe { SetFileInformationByHandle(file.as_raw_handle(), 4, &disposition, 1) }
                    == 0
                {
                    return Err(io::Error::last_os_error());
                }
                drop(file);
                removed.fetch_add(1, Ordering::Relaxed);
                bytes.fetch_add(f.size, Ordering::Relaxed);
                Ok(())
            })();
            if let Err(e) = result {
                failed.fetch_add(1, Ordering::Relaxed);
                let mut errors = failures.lock().unwrap();
                if errors.len() < 500 {
                    errors.push(json!({"name":f.path,"error":e.to_string()}));
                }
            }
            let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
            if done % 250 == 0 {
                let mut time = last.lock().unwrap();
                if time.elapsed().as_millis() > 150 {
                    output(json!({"progress":{"completed":done,"total":request.files.len()}}));
                    *time = Instant::now();
                }
            }
        })
    });
    output(
        json!({"result":{"items":removed.load(Ordering::Relaxed),"bytes":bytes.load(Ordering::Relaxed),"failedCount":failed.load(Ordering::Relaxed),"failed":failures.into_inner().unwrap()}}),
    );
}
pub fn run(root: String, age: u64) {
    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .saturating_sub(age as u128);
    let mut files = Vec::new();
    let mut skipped = 0usize;
    let mut truncated = false;
    if fs::symlink_metadata(&root)
        .map(|m| m.file_type().is_symlink() || !m.is_dir())
        .unwrap_or(true)
    {
        output(json!({"files":files,"skipped":1,"truncated":false}));
        return;
    }
    for entry in jwalk::WalkDir::new(&root)
        .follow_links(false)
        .skip_hidden(false)
        .parallelism(jwalk::Parallelism::RayonNewPool(4))
    {
        match entry {
            Ok(e) => {
                if !e.file_type().is_file() {
                    continue;
                }
                if files.len() >= 200000 {
                    truncated = true;
                    break;
                }
                let path = e.path();
                match fs::symlink_metadata(&path) {
                    Ok(m) => {
                        if m.file_type().is_symlink() {
                            continue;
                        }
                        let modified = m
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok());
                        if let Some(t) = modified {
                            let ms = t.as_millis();
                            if ms < cutoff {
                                files.push(json!({"path":path.to_string_lossy(),"size":m.len(),"mtime":ms as u64,"root":root}));
                            }
                        } else {
                            skipped += 1;
                        }
                    }
                    Err(_) => skipped += 1,
                }
            }
            Err(_) => skipped += 1,
        }
    }
    output(json!({"files":files,"skipped":skipped,"truncated":truncated}));
}
