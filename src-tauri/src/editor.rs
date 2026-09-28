//! Editor feature backend: moving files to the Trash (the Explorer's "Move to Trash").
//!
//! macOS: Finder's delete (so "Put Back" works), falling back to a move into ~/.Trash.
//! Linux: `gio trash`, falling back to the XDG trash folder. Windows: the Recycle Bin.

use crate::registry::{parse, Registry};
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

fn unique_in(dir: &Path, name: &str) -> PathBuf {
    let mut dest = dir.join(name);
    let mut n = 2;
    while dest.exists() {
        dest = dir.join(format!("{name} {n}"));
        n += 1;
    }
    dest
}

fn home() -> PathBuf {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn trash(path: &Path) -> Result<(), String> {
    let esc = path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
    let ok = Command::new("/usr/bin/osascript")
        .args(["-e", &format!("tell application \"Finder\" to delete (POSIX file \"{esc}\" as alias)")])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if ok && !path.exists() {
        return Ok(());
    }
    let dir = home().join(".Trash");
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    std::fs::rename(path, unique_in(&dir, &name)).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn trash(path: &Path) -> Result<(), String> {
    if Command::new("gio").arg("trash").arg(path).output().map(|o| o.status.success()).unwrap_or(false) {
        return Ok(());
    }
    let base = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".local/share")).join("Trash");
    let (files, info) = (base.join("files"), base.join("info"));
    std::fs::create_dir_all(&files).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&info).map_err(|e| e.to_string())?;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let dest = unique_in(&files, &name);
    let dest_name = dest.file_name().unwrap().to_string_lossy().to_string();
    let abs = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let _ = std::fs::write(info.join(format!("{dest_name}.trashinfo")), format!("[Trash Info]\nPath={}\n", abs.to_string_lossy()));
    std::fs::rename(path, dest).map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn trash(path: &Path) -> Result<(), String> {
    let p = path.to_string_lossy().replace('\'', "''");
    let kind = if path.is_dir() { "DeleteDirectory" } else { "DeleteFile" };
    let script = format!("Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::{kind}('{p}', 'OnlyErrorDialogs', 'SendToRecycleBin')");
    let mut c = Command::new("powershell");
    c.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    let out = c.output().map_err(|e| e.to_string())?;
    if out.status.success() && !path.exists() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn trash(path: &Path) -> Result<(), String> {
    if path.is_dir() { std::fs::remove_dir_all(path) } else { std::fs::remove_file(path) }.map_err(|e| e.to_string())
}

pub fn register(r: &mut Registry) {
    #[derive(Deserialize)]
    struct P {
        path: String,
    }
    r.add("editor_trash", |a| {
        let a: P = parse(a)?;
        let p = Path::new(&a.path);
        if !p.exists() {
            return Err(format!("{} doesn't exist", a.path));
        }
        trash(p)?;
        Ok(Value::Null)
    });
}
