//! Files for the UI: read/write (text and base64), listing, walking, and watching a
//! project folder (`fs:change` {root, paths}, batched).

use crate::events::emit;
use crate::registry::{parse, Registry};
use base64::Engine as _;
use notify::{RecursiveMode, Watcher};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, UNIX_EPOCH};

/// Folders never worth walking or watching.
pub const SKIP: [&str; 12] = [".git", "node_modules", ".build", "target", "dist", "build", ".venv", "venv", "__pycache__", ".next", ".turbo", ".gradle"];

fn entry(p: &Path) -> Value {
    let m = std::fs::symlink_metadata(p).ok();
    let is_dir = p.is_dir();
    json!({
        "name": p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "path": p.to_string_lossy(),
        "is_dir": is_dir,
        "size": m.as_ref().map(|m| m.len()).unwrap_or(0),
        "mtime": m.and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
    })
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<String>, limit: usize, hidden: bool) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut items: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    items.sort();
    for p in items {
        if out.len() >= limit {
            return;
        }
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if SKIP.contains(&name.as_str()) || (!hidden && name.starts_with('.') && name != ".github") {
            continue;
        }
        if p.is_dir() {
            walk(root, &p, out, limit, hidden);
        } else if let Ok(rel) = p.strip_prefix(root) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

struct Watch {
    _w: notify::RecommendedWatcher,
}
static WATCHES: OnceLock<Mutex<HashMap<String, Watch>>> = OnceLock::new();

fn watch(root: &str) -> Result<(), String> {
    let map = WATCHES.get_or_init(|| Mutex::new(HashMap::new()));
    if map.lock().unwrap().contains_key(root) {
        return Ok(());
    }
    let (tx, rx) = std::sync::mpsc::channel::<PathBuf>();
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            for p in ev.paths {
                let _ = tx.send(p);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    w.watch(Path::new(root), RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    let r = root.to_string();
    std::thread::spawn(move || {
        // Batch bursts (a build writes hundreds of files) into one event every ~250ms.
        while let Ok(first) = rx.recv() {
            let mut batch = vec![first];
            std::thread::sleep(Duration::from_millis(250));
            while let Ok(p) = rx.try_recv() {
                batch.push(p);
            }
            let mut paths: Vec<String> = batch
                .iter()
                .filter(|p| !p.components().any(|c| {
                    let s = c.as_os_str().to_string_lossy();
                    SKIP.contains(&s.as_ref()) && s != ".git"
                }))
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            paths.sort();
            paths.dedup();
            if !paths.is_empty() {
                emit("fs:change", json!({"root": r, "paths": paths}));
            }
        }
    });
    map.lock().unwrap().insert(root.to_string(), Watch { _w: w });
    Ok(())
}

pub fn register(r: &mut Registry) {
    #[derive(Deserialize)]
    struct P {
        path: String,
    }
    #[derive(Deserialize)]
    struct W {
        path: String,
        #[serde(default)]
        text: String,
    }
    #[derive(Deserialize)]
    struct WB {
        path: String,
        data: String,
    }
    #[derive(Deserialize)]
    struct Two {
        from: String,
        to: String,
    }
    #[derive(Deserialize)]
    struct Walk {
        root: String,
        limit: Option<usize>,
        #[serde(default)]
        hidden: bool,
    }
    let mkparent = |p: &str| {
        if let Some(d) = Path::new(p).parent() {
            let _ = std::fs::create_dir_all(d);
        }
    };
    r.add("fs_read_text", |a| {
        let a: P = parse(a)?;
        std::fs::read(&a.path).map(|b| json!(String::from_utf8_lossy(&b))).map_err(|e| format!("{}: {e}", a.path))
    });
    r.add("fs_read_base64", |a| {
        let a: P = parse(a)?;
        std::fs::read(&a.path).map(|b| json!(base64::engine::general_purpose::STANDARD.encode(b))).map_err(|e| format!("{}: {e}", a.path))
    });
    r.add("fs_write_text", move |a| {
        let a: W = parse(a)?;
        mkparent(&a.path);
        std::fs::write(&a.path, a.text).map(|_| Value::Null).map_err(|e| format!("{}: {e}", a.path))
    });
    r.add("fs_write_base64", move |a| {
        let a: WB = parse(a)?;
        mkparent(&a.path);
        let bytes = base64::engine::general_purpose::STANDARD.decode(a.data).map_err(|e| e.to_string())?;
        std::fs::write(&a.path, bytes).map(|_| Value::Null).map_err(|e| format!("{}: {e}", a.path))
    });
    // [{name, path, is_dir, size, mtime}], folders first, then by name
    r.add("fs_list", |a| {
        let a: P = parse(a)?;
        let mut items: Vec<PathBuf> = std::fs::read_dir(&a.path).map_err(|e| format!("{}: {e}", a.path))?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
        items.sort_by_key(|p| (!p.is_dir(), p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()));
        Ok(json!(items.iter().map(|p| entry(p)).collect::<Vec<_>>()))
    });
    r.add("fs_stat", |a| {
        let a: P = parse(a)?;
        let p = Path::new(&a.path);
        Ok(if p.exists() { entry(p) } else { Value::Null })
    });
    r.add("fs_exists", |a| {
        let a: P = parse(a)?;
        Ok(json!(Path::new(&a.path).exists()))
    });
    r.add("fs_mkdir", |a| {
        let a: P = parse(a)?;
        std::fs::create_dir_all(&a.path).map(|_| Value::Null).map_err(|e| e.to_string())
    });
    r.add("fs_remove", |a| {
        let a: P = parse(a)?;
        let p = Path::new(&a.path);
        if p.is_dir() { std::fs::remove_dir_all(p) } else { std::fs::remove_file(p) }.map(|_| Value::Null).map_err(|e| e.to_string())
    });
    r.add("fs_rename", move |a| {
        let a: Two = parse(a)?;
        mkparent(&a.to);
        std::fs::rename(&a.from, &a.to).map(|_| Value::Null).map_err(|e| e.to_string())
    });
    r.add("fs_copy", move |a| {
        let a: Two = parse(a)?;
        mkparent(&a.to);
        std::fs::copy(&a.from, &a.to).map(|_| Value::Null).map_err(|e| e.to_string())
    });
    // Project-relative file paths, skipping build/vendor folders and (unless hidden) dotfiles.
    r.add("fs_walk", |a| {
        let a: Walk = parse(a)?;
        let mut out = Vec::new();
        walk(Path::new(&a.root), Path::new(&a.root), &mut out, a.limit.unwrap_or(20_000), a.hidden);
        Ok(json!(out))
    });
    r.add("fs_watch", |a| {
        let a: P = parse(a)?;
        watch(&a.path)?;
        Ok(Value::Null)
    });
    r.add("fs_unwatch", |a| {
        let a: P = parse(a)?;
        if let Some(m) = WATCHES.get() {
            m.lock().unwrap().remove(&a.path);
        }
        Ok(Value::Null)
    });
}
