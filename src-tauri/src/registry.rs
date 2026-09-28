//! Every backend command, by name. The UI reaches them through one Tauri command
//! (`call`), and the development bridge (bridge.rs) through HTTP, so both run the same code.
//!
//! A feature module adds its commands in its `register` function:
//!
//! ```ignore
//! pub fn register(r: &mut Registry) {
//!     r.add("git_status", |a| { let a: Root = parse(a)?; ...; Ok(json!(...)) });
//! }
//! ```
//!
//! Handlers are blocking; they run off the UI thread. Anything long-running should
//! start a thread and report through `events::emit`.

use serde::de::DeserializeOwned;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

pub type Handler = Arc<dyn Fn(Value) -> Result<Value, String> + Send + Sync>;

#[derive(Default)]
pub struct Registry {
    map: HashMap<&'static str, Handler>,
}

impl Registry {
    pub fn add(&mut self, name: &'static str, f: impl Fn(Value) -> Result<Value, String> + Send + Sync + 'static) {
        if self.map.insert(name, Arc::new(f)).is_some() {
            panic!("backend command registered twice: {name}");
        }
    }
}

static REGISTRY: OnceLock<HashMap<&'static str, Handler>> = OnceLock::new();

pub fn install(r: Registry) {
    let _ = REGISTRY.set(r.map);
}

pub fn dispatch(cmd: &str, args: Value) -> Result<Value, String> {
    let f = REGISTRY
        .get()
        .and_then(|m| m.get(cmd))
        .cloned()
        .ok_or_else(|| format!("unknown backend command: {cmd}"))?;
    f(args)
}

pub fn names() -> Vec<&'static str> {
    let mut v: Vec<&'static str> = REGISTRY.get().map(|m| m.keys().copied().collect()).unwrap_or_default();
    v.sort();
    v
}

/// Arguments as a typed struct (serde field names are camelCase-agnostic: use snake_case
/// in Rust and send snake_case from the UI).
pub fn parse<T: DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(if v.is_null() { Value::Object(Default::default()) } else { v })
        .map_err(|e| format!("bad arguments: {e}"))
}

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---- App-wide paths -------------------------------------------------------------------

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_paths(data: PathBuf, resources: PathBuf) {
    let _ = std::fs::create_dir_all(&data);
    let _ = DATA_DIR.set(data);
    let _ = RESOURCE_DIR.set(resources);
}

/// The app's own data folder (engine chats, secrets, agent bundles).
pub fn data_dir() -> PathBuf {
    DATA_DIR.get().cloned().unwrap_or_else(|| std::env::temp_dir().join("spar-desktop"))
}

/// Files shipped with the app (`src-tauri/resources` in development).
pub fn resource_dir() -> PathBuf {
    RESOURCE_DIR.get().cloned().unwrap_or_else(|| PathBuf::from("resources"))
}

pub fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default()
}
