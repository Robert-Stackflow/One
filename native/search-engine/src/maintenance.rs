use crate::output;
use jwalk::rayon::{self, prelude::*};
use serde::Serialize;
use std::{env, fs, io::ErrorKind, path::Path};
use winreg::{RegKey, enums::*};
#[derive(Serialize)]
struct Row {
    name: String,
    source: String,
    status: String,
    command: String,
    location: String,
}
fn row(
    rows: &mut Vec<Row>,
    name: impl Into<String>,
    source: &str,
    status: impl Into<String>,
    command: impl Into<String>,
    location: &str,
) {
    rows.push(Row {
        name: name.into(),
        source: source.into(),
        status: status.into(),
        command: command.into(),
        location: location.into(),
    });
}
fn expand(value: &str) -> String {
    let mut result = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        result.push_str(&rest[..start]);
        let next = &rest[start + 1..];
        let Some(end) = next.find('%') else {
            result.push_str(&rest[start..]);
            return result;
        };
        let token = &next[..end];
        result.push_str(&env::var(token).unwrap_or_else(|_| format!("%{token}%")));
        rest = &next[end + 1..];
    }
    result.push_str(rest);
    result
}
fn status(command: &str) -> String {
    let command = expand(command.trim());
    if command.is_empty() {
        return "为空，需人工检查".into();
    }
    let path = if let Some(tail) = command.strip_prefix('"') {
        let Some(end) = tail.find('"') else {
            return "命令无法解析".into();
        };
        &tail[..end]
    } else {
        let end = command
            .to_ascii_lowercase()
            .find(".exe")
            .map(|n| n + 4)
            .unwrap_or(command.len());
        &command[..end]
    };
    if path.starts_with("\\\\") {
        return "网络路径，未检查在线状态".into();
    }
    let bytes = path.as_bytes();
    if bytes.len() < 3
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || !matches!(bytes[2], b'\\' | b'/')
    {
        return "相对路径或间接命令，需人工检查".into();
    }
    if fs::metadata(&path[..3]).is_err() {
        return "磁盘离线，无法判断".into();
    }
    match fs::metadata(path) {
        Ok(m) => {
            if m.is_dir() {
                "目标为目录，需人工检查"
            } else {
                "目标存在（未验证参数）"
            }
        }
        Err(e) => match e.kind() {
            ErrorKind::PermissionDenied => "无访问权限，无法判断",
            ErrorKind::NotFound => "目标未找到，需人工检查",
            _ => "路径不可访问，无法判断",
        },
    }
    .into()
}
fn raw(key: &RegKey, name: &str) -> Result<String, String> {
    let value = key.get_raw_value(name).map_err(|e| e.to_string())?;
    if !matches!(value.vtype, REG_SZ | REG_EXPAND_SZ) {
        return Err("值不是字符串，需人工检查".into());
    }
    let words: Vec<u16> = value
        .bytes
        .chunks_exact(2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .take_while(|c| *c != 0)
        .collect();
    Ok(String::from_utf16_lossy(&words))
}
pub fn run(startup: bool) {
    let mut rows = Vec::new();
    for (hive, label) in [
        (HKEY_CURRENT_USER, "CurrentUser"),
        (HKEY_LOCAL_MACHINE, "LocalMachine"),
    ] {
        for (view, view_name) in [
            (KEY_WOW64_64KEY, "Registry64"),
            (KEY_WOW64_32KEY, "Registry32"),
        ] {
            let source = format!("{label}/{view_name}");
            let base = RegKey::predef(hive);
            for kind in if startup {
                vec!["Run", "RunOnce"]
            } else {
                vec!["App Paths"]
            } {
                let location = format!("Software\\Microsoft\\Windows\\CurrentVersion\\{kind}");
                match base.open_subkey_with_flags(&location, KEY_READ | view) {
                    Ok(key) => {
                        if startup {
                            for value in key.enum_values() {
                                match value {
                                    Ok((name, _)) => {
                                        let command = raw(&key, &name);
                                        row(
                                            &mut rows,
                                            name,
                                            &format!("{label}/{kind}/{view_name}"),
                                            command
                                                .as_ref()
                                                .map(|s| status(s))
                                                .unwrap_or_else(|e| e.clone()),
                                            command.unwrap_or_default(),
                                            &location,
                                        )
                                    }
                                    Err(e) => row(
                                        &mut rows,
                                        "读取失败",
                                        &source,
                                        e.to_string(),
                                        "",
                                        &location,
                                    ),
                                }
                            }
                        } else {
                            for name in key.enum_keys() {
                                match name {
                                    Ok(name) => {
                                        let target = format!("{location}\\{name}");
                                        let command = key
                                            .open_subkey_with_flags(&name, KEY_READ | view)
                                            .map_err(|e| e.to_string())
                                            .and_then(|key| raw(&key, ""));
                                        row(
                                            &mut rows,
                                            name,
                                            &source,
                                            command
                                                .as_ref()
                                                .map(|s| status(s))
                                                .unwrap_or_else(|e| e.clone()),
                                            command.unwrap_or_default(),
                                            &target,
                                        )
                                    }
                                    Err(e) => row(
                                        &mut rows,
                                        "读取失败",
                                        &source,
                                        e.to_string(),
                                        "",
                                        &location,
                                    ),
                                }
                            }
                        }
                    }
                    Err(e) => {
                        if e.kind() != ErrorKind::NotFound {
                            row(&mut rows, "读取失败", &source, e.to_string(), "", &location)
                        }
                    }
                }
            }
        }
    }
    if !startup {
        extra_registry(&mut rows);
    }
    if startup {
        for (variable, label) in [("APPDATA", "Startup"), ("ProgramData", "CommonStartup")] {
            if let Ok(base) = env::var(variable) {
                let path = Path::new(&base).join("Microsoft/Windows/Start Menu/Programs/Startup");
                let location = path.to_string_lossy();
                match fs::read_dir(&path) {
                    Ok(entries) => {
                        for entry in entries {
                            match entry {
                                Ok(e) => {
                                    if e.file_type().is_ok_and(|t| t.is_file()) {
                                        row(
                                            &mut rows,
                                            e.file_name().to_string_lossy(),
                                            label,
                                            "启动文件存在；快捷方式目标待检查",
                                            e.path().to_string_lossy(),
                                            &location,
                                        )
                                    }
                                }
                                Err(e) => {
                                    row(&mut rows, "启动目录", label, e.to_string(), "", &location)
                                }
                            }
                        }
                    }
                    Err(e) => row(&mut rows, "启动目录", label, e.to_string(), "", &location),
                }
            }
        }
    }
    output(serde_json::to_value(rows).unwrap());
}
fn extra_registry(rows: &mut Vec<Row>) {
    let begin = rows.len();
    for (hive, label) in [
        (HKEY_CURRENT_USER, "CurrentUser"),
        (HKEY_LOCAL_MACHINE, "LocalMachine"),
    ] {
        for (view, view_name) in [
            (KEY_WOW64_64KEY, "Registry64"),
            (KEY_WOW64_32KEY, "Registry32"),
        ] {
            let base = RegKey::predef(hive);
            for (path, category) in [
                (
                    "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
                    "Uninstall",
                ),
                ("Software\\Classes\\CLSID", "COM"),
            ] {
                let Ok(key) = base.open_subkey_with_flags(path, KEY_READ | view) else {
                    continue;
                };
                for id in key.enum_keys().flatten() {
                    let Ok(item) = key.open_subkey_with_flags(&id, KEY_READ | view) else {
                        continue;
                    };
                    if category == "Uninstall" {
                        if let Ok(command) = raw(&item, "UninstallString") {
                            let name = raw(&item, "DisplayName").unwrap_or(id.clone());
                            row(
                                rows,
                                name,
                                &format!("{label}/Uninstall/{view_name}"),
                                "",
                                command,
                                &format!("{path}\\{id}"),
                            );
                        }
                    } else {
                        let name = raw(&item, "").unwrap_or(id.clone());
                        for server in ["InprocServer32", "LocalServer32"] {
                            if let Ok(server_key) =
                                item.open_subkey_with_flags(server, KEY_READ | view)
                            {
                                if let Ok(command) = raw(&server_key, "") {
                                    row(
                                        rows,
                                        &name,
                                        &format!("{label}/COM/{view_name}"),
                                        "",
                                        command,
                                        &format!("{path}\\{id}\\{server}"),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(8)
        .build()
        .unwrap();
    pool.install(|| {
        rows[begin..]
            .par_iter_mut()
            .for_each(|r| r.status = status(&r.command))
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn path_classification() {
        assert_eq!(status(""), "为空，需人工检查");
        assert!(status("\"unterminated").contains("无法解析"));
        assert!(status("\\\\server\\app.exe").contains("网络路径"));
        assert!(status("rundll32.exe shell32.dll").contains("间接命令"));
        assert!(status("%SystemRoot%\\System32\\notepad.exe").contains("目标存在"));
    }
}
