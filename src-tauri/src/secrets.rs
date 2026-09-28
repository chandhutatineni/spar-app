//! Secrets in a file in the app's data folder (mode 600), like the Mac app. No keychain:
//! an unsigned app gets a keychain prompt on every launch. On macOS the Mac app's secrets
//! are copied over the first time, so a connected GitHub account carries across.

use crate::registry::{data_dir, home, parse, Registry};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());

fn file() -> std::path::PathBuf {
    data_dir().join("secrets.json")
}

fn load() -> BTreeMap<String, String> {
    let path = file();
    if !path.exists() && cfg!(target_os = "macos") {
        let mac_app = home().join("Library/Application Support/SPAR/secrets.json");
        if let Ok(raw) = std::fs::read_to_string(mac_app) {
            let _ = write_file(&raw);
        }
    }
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write_file(raw: &str) -> std::io::Result<()> {
    let path = file();
    std::fs::write(&path, raw)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

pub fn get(key: &str) -> Option<String> {
    let _g = LOCK.lock().unwrap();
    load().get(key).cloned().filter(|v| !v.is_empty())
}

pub fn set(key: &str, value: Option<&str>) -> Result<(), String> {
    let _g = LOCK.lock().unwrap();
    let mut all = load();
    match value {
        Some(v) if !v.is_empty() => {
            all.insert(key.to_string(), v.to_string());
        }
        _ => {
            all.remove(key);
        }
    }
    write_file(&serde_json::to_string_pretty(&all).unwrap()).map_err(|e| e.to_string())
}

/// Environment the engine and every tool get from secrets: the connected GitHub account
/// (for `gh` and pushes), Copilot's token, and any secret named `env:NAME`.
pub fn environment() -> BTreeMap<String, String> {
    let all = {
        let _g = LOCK.lock().unwrap();
        load()
    };
    let mut env = BTreeMap::new();
    if let Some(gh) = all.get("github-token").filter(|v| !v.is_empty()) {
        env.insert("GH_TOKEN".into(), gh.clone());
        env.insert("GITHUB_TOKEN".into(), gh.clone());
    }
    if let Some(t) = all.get("github-copilot").or(all.get("github-token")).filter(|v| !v.is_empty()) {
        env.insert("COPILOT_GITHUB_TOKEN".into(), t.clone());
    }
    for (k, v) in &all {
        if let Some(name) = k.strip_prefix("env:") {
            env.insert(name.to_string(), v.clone());
        }
    }
    env
}

// ---- Human token ----------------------------------------------------------------------
// SPAR records a decision as a person's only with a token the app passes to its own gate
// calls; agents never see it. The file keeps the last few hashes so two app copies work.

static HUMAN: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub fn human_token() -> &'static str {
    HUMAN.get_or_init(|| {
        use rand::RngCore;
        use sha2::{Digest, Sha256};
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let value: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let digest: String = Sha256::digest(value.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
        let dir = home().join(".config/spar");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("human-token");
        let earlier: Vec<String> = std::fs::read_to_string(&path).unwrap_or_default().lines().map(String::from).collect();
        let keep = &earlier[earlier.len().saturating_sub(4)..];
        let mut all = keep.to_vec();
        all.push(digest);
        let _ = std::fs::write(&path, all.join("\n") + "\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        value
    })
}

pub fn register(r: &mut Registry) {
    #[derive(Deserialize)]
    struct Key {
        key: String,
    }
    #[derive(Deserialize)]
    struct Set {
        key: String,
        value: Option<String>,
    }
    r.add("secrets_get", |a| {
        let a: Key = parse(a)?;
        Ok(json!(get(&a.key)))
    });
    r.add("secrets_set", |a| {
        let a: Set = parse(a)?;
        set(&a.key, a.value.as_deref())?;
        Ok(Value::Null)
    });
    // The env the UI adds to the few calls that record a person's decision
    // (`spar gate`, `spar mvp select`, `spar decision`).
    r.add("human_token_env", |_| Ok(json!({"SPAR_HUMAN_TOKEN": human_token()})));
}
