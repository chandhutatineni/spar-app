//! MCP servers the app provides to its Claude-based agents (a port of the Mac app's
//! Backend/MCP.swift): the list (data dir `mcp.json`), live status from an MCP handshake,
//! and the agent's config (`mcp-servers.json`, passed to Claude Code with --mcp-config).
//! Servers that fail their check are left out of the agent's config, so a broken server
//! never blocks a session. State changes reach every window as `mcp:changed` {state}.
//!
//! Registry search results are parsed in the UI (features/mcp/mcpJson.ts); this module
//! only fetches them, since the registry sends no CORS headers for the dev browser.

use crate::events::emit;
use crate::registry::{data_dir, home, parse, Registry};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    #[default]
    Stdio,
    Http,
    Sse,
}

impl Kind {
    fn raw(self) -> &'static str {
        match self {
            Kind::Stdio => "stdio",
            Kind::Http => "http",
            Kind::Sse => "sse",
        }
    }
}

fn yes() -> bool {
    true
}

/// Same JSON shape as the Mac app's `MCPServer` Codable, so `mcp.json` files are interchangeable.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Server {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub kind: Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub builtin: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, rename = "usesGitHubToken")]
    pub uses_github_token: bool,
}

#[derive(Clone, Debug, PartialEq)]
enum Status {
    Checking,
    Ok(usize),
    Failed(String),
}

impl Status {
    fn to_json(&self) -> Value {
        match self {
            Status::Checking => json!({"state": "checking"}),
            Status::Ok(n) => json!({"state": "ok", "tools": n}),
            Status::Failed(why) => json!({"state": "failed", "error": why}),
        }
    }
}

#[derive(Default)]
struct Store {
    loaded: bool,
    servers: Vec<Server>,
    status: HashMap<String, Status>,
    tools: HashMap<String, Vec<String>>,
}

static STORE: std::sync::LazyLock<Mutex<Store>> = std::sync::LazyLock::new(|| Mutex::new(Store::default()));
static SAVE: Mutex<()> = Mutex::new(());

fn stdio_default(id: &str, title: &str, summary: &str, command: &str, args: &[&str]) -> Server {
    Server {
        id: id.into(),
        title: title.into(),
        summary: summary.into(),
        kind: Kind::Stdio,
        command: Some(command.into()),
        args: args.iter().map(|s| s.to_string()).collect(),
        env: BTreeMap::new(),
        url: None,
        headers: BTreeMap::new(),
        enabled: true,
        builtin: true,
        source: None,
        uses_github_token: false,
    }
}

/// The built-in servers (MCPStore.defaults).
pub fn defaults() -> Vec<Server> {
    vec![
        stdio_default("context7", "Context7", "Up-to-date documentation and code examples for libraries and frameworks.", "npx", &["-y", "@upstash/context7-mcp"]),
        stdio_default("playwright", "Playwright", "Drive a real browser: navigate, click, fill forms, take snapshots and screenshots.", "npx", &["-y", "@playwright/mcp@latest"]),
        Server {
            id: "github".into(),
            title: "GitHub".into(),
            summary: "Issues, pull requests, code search and repository operations, using your connected GitHub account.".into(),
            kind: Kind::Http,
            command: None,
            args: vec![],
            env: BTreeMap::new(),
            url: Some("https://api.githubcopilot.com/mcp/".into()),
            headers: BTreeMap::new(),
            enabled: true,
            builtin: true,
            source: None,
            uses_github_token: true,
        },
        stdio_default("sequential-thinking", "Sequential Thinking", "Structured, revisable step-by-step reasoning for hard problems.", "npx", &["-y", "@modelcontextprotocol/server-sequential-thinking"]),
        stdio_default("fetch", "Fetch", "Fetch web pages and convert them to Markdown.", "uvx", &["mcp-server-fetch"]),
        stdio_default("memory", "Memory", "A persistent knowledge graph the agent can read and write across sessions.", "npx", &["-y", "@modelcontextprotocol/server-memory"]),
    ]
}

// ---- Files ----------------------------------------------------------------------------

fn store_path() -> PathBuf {
    data_dir().join("mcp.json")
}

/// The file passed to Claude Code with --mcp-config.
pub fn config_path() -> PathBuf {
    data_dir().join("mcp-servers.json")
}

fn github_token() -> Option<String> {
    crate::secrets::get("github-token")
}

fn load(s: &mut Store) {
    if s.loaded {
        return;
    }
    s.loaded = true;
    let path = store_path();
    let mut raw = std::fs::read_to_string(&path).ok();
    // First run on a Mac that has the SPAR Mac app: start from its servers (read only).
    if raw.is_none() && cfg!(target_os = "macos") {
        raw = std::fs::read_to_string(home().join("Library/Application Support/SPAR/mcp.json")).ok();
    }
    match raw.and_then(|r| serde_json::from_str::<Vec<Server>>(&r).ok()) {
        Some(saved) => {
            s.servers = saved;
            // New built-in servers appear for existing users too.
            for d in defaults() {
                if !s.servers.iter().any(|x| x.id == d.id) {
                    s.servers.push(d);
                }
            }
        }
        None => s.servers = defaults(),
    }
    save(s);
}

fn write_private(path: &PathBuf, data: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&tmp, path)
}

fn save(s: &Store) {
    let _g = SAVE.lock().unwrap();
    if let Ok(data) = serde_json::to_vec(&s.servers) {
        let _ = std::fs::create_dir_all(data_dir());
        let _ = std::fs::write(store_path(), data);
    }
    write_agent_config_locked(s);
}

/// Claude Code's config: enabled servers that have not failed. GitHub's token is filled
/// in from the connected account; without one the server is skipped.
fn agent_config(servers: &[Server], status: &HashMap<String, Status>, token: Option<&str>) -> Value {
    let mut entries: BTreeMap<String, Value> = BTreeMap::new();
    for s in servers.iter().filter(|s| s.enabled) {
        if matches!(status.get(&s.id), Some(Status::Failed(_))) {
            continue;
        }
        match s.kind {
            Kind::Stdio => {
                let Some(command) = &s.command else { continue };
                let mut e: BTreeMap<&str, Value> = BTreeMap::new();
                e.insert("command", json!(command));
                e.insert("args", json!(s.args));
                if !s.env.is_empty() {
                    e.insert("env", json!(s.env));
                }
                entries.insert(s.id.clone(), json!(e));
            }
            Kind::Http | Kind::Sse => {
                let Some(url) = &s.url else { continue };
                let mut headers = s.headers.clone();
                if s.uses_github_token {
                    let Some(t) = token else { continue };
                    headers.insert("Authorization".into(), format!("Bearer {t}"));
                }
                let mut e: BTreeMap<&str, Value> = BTreeMap::new();
                e.insert("type", json!(s.kind.raw()));
                e.insert("url", json!(url));
                if !headers.is_empty() {
                    e.insert("headers", json!(headers));
                }
                entries.insert(s.id.clone(), json!(e));
            }
        }
    }
    let mut root: BTreeMap<&str, Value> = BTreeMap::new();
    root.insert("mcpServers", json!(entries));
    json!(root)
}

fn write_agent_config_locked(s: &Store) {
    let token = github_token();
    let cfg = agent_config(&s.servers, &s.status, token.as_deref());
    if let Ok(text) = serde_json::to_string_pretty(&cfg) {
        let _ = write_private(&config_path(), text.as_bytes()); // may contain tokens
    }
}

fn snapshot(s: &Store) -> Value {
    let status: BTreeMap<&String, Value> = s.status.iter().map(|(k, v)| (k, v.to_json())).collect();
    json!({
        "servers": s.servers,
        "status": status,
        "tools": s.tools,
        "config_path": config_path().to_string_lossy(),
        "store_path": store_path().to_string_lossy(),
    })
}

/// Runs `f` on the loaded store; saves and tells every window when `changed` says so.
fn with_store<R>(f: impl FnOnce(&mut Store) -> (R, bool)) -> R {
    let (r, snap) = {
        let mut s = STORE.lock().unwrap();
        load(&mut s);
        let (r, changed) = f(&mut s);
        if changed {
            save(&s);
        }
        (r, changed.then(|| snapshot(&s)))
    };
    if let Some(v) = snap {
        emit("mcp:changed", v);
    }
    r
}

fn set_status(id: &str, st: Option<Status>, tools: Option<Vec<String>>) {
    let snap = {
        let mut s = STORE.lock().unwrap();
        load(&mut s);
        match st {
            Some(v) => s.status.insert(id.to_string(), v),
            None => s.status.remove(id),
        };
        if let Some(t) = tools {
            s.tools.insert(id.to_string(), t);
        }
        write_agent_config_locked(&s);
        snapshot(&s)
    };
    emit("mcp:changed", snap);
}

// ---- Health checks ----------------------------------------------------------------------

/// Runs the MCP handshake (initialize, then tools/list) and records the result.
pub fn check(server: &Server) {
    if server.uses_github_token && github_token().is_none() {
        set_status(&server.id, Some(Status::Failed("Connect GitHub to use this server".into())), None);
        return;
    }
    set_status(&server.id, Some(Status::Checking), None);
    let result = match server.kind {
        Kind::Stdio => probe_stdio(server, Duration::from_secs(45)),
        Kind::Http | Kind::Sse => probe_http(server),
    };
    // The server may have been removed or changed meanwhile; only record for the same one.
    let current = with_store(|s| (s.servers.iter().find(|x| x.id == server.id).cloned(), false));
    if current.is_none() {
        return;
    }
    match result {
        Ok(names) => set_status(&server.id, Some(Status::Ok(names.len())), Some(names)),
        Err(e) => set_status(&server.id, Some(Status::Failed(e)), None),
    }
}

fn check_in_background(server: Server) {
    std::thread::spawn(move || check(&server));
}

pub fn check_all() {
    let servers = with_store(|s| (s.servers.iter().filter(|x| x.enabled).cloned().collect::<Vec<_>>(), false));
    for s in servers {
        check_in_background(s);
    }
}

fn initialize() -> Value {
    json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
           "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                      "clientInfo": {"name": "spar-desktop", "version": "0.1.0"}}})
}

fn initialized() -> Value {
    json!({"jsonrpc": "2.0", "method": "notifications/initialized"})
}

fn list_tools() -> Value {
    json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
}

fn tool_names(msg: &Value) -> Vec<String> {
    msg.pointer("/result/tools")
        .and_then(|t| t.as_array())
        .map(|a| a.iter().filter_map(|t| t.get("name").and_then(|n| n.as_str()).map(String::from)).collect())
        .unwrap_or_default()
}

/// Probe processes still running (killed on quit).
static PROBES: Mutex<Option<HashSet<u32>>> = Mutex::new(None);

fn kill_tree(pid: u32) {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill").args(["-TERM", &format!("-{pid}")]).stderr(Stdio::null()).status();
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
    }
}

/// Starts the server, performs the handshake over stdio, lists its tools.
pub fn probe_stdio(server: &Server, timeout: Duration) -> Result<Vec<String>, String> {
    let command = server.command.clone().unwrap_or_default();
    if command.is_empty() || crate::exec::which(&command).is_none() {
        return Err(format!("{} is not installed", if command.is_empty() { "command" } else { &command }));
    }
    let mut c = crate::exec::command(&command, &server.args, None, &server.env)?;
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0); // npx → node: stop the whole tree afterwards
    }
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    PROBES.lock().unwrap().get_or_insert_with(HashSet::new).insert(pid);
    let mut stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let (tx, rx) = mpsc::channel::<Value>();
    let out_thread = stdout.map(|out| {
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines() {
                let Ok(line) = line else { break };
                if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                    if tx.send(v).is_err() {
                        break;
                    }
                }
            }
        })
    });
    let errors = Arc::new(Mutex::new(String::new()));
    let err_thread = stderr.map(|mut err| {
        let errors = errors.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = err.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let mut e = errors.lock().unwrap();
                e.push_str(&String::from_utf8_lossy(&buf[..n]));
                if e.len() > 64_000 {
                    let cut = e.len() - 32_000;
                    let cut = (cut..e.len()).find(|i| e.is_char_boundary(*i)).unwrap_or(e.len());
                    e.drain(..cut);
                }
            }
        })
    });
    let mut send = |v: Value| {
        if let Some(w) = stdin.as_mut() {
            let _ = w.write_all(format!("{v}\n").as_bytes());
            let _ = w.flush();
        }
    };
    send(initialize());
    let deadline = Instant::now() + timeout;
    let result = loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break Err(format!("No response within {} seconds", timeout.as_secs()));
        }
        match rx.recv_timeout(left) {
            Ok(msg) => match msg.get("id").and_then(|i| i.as_i64()) {
                Some(1) => {
                    send(initialized());
                    send(list_tools());
                }
                Some(2) => break Ok(tool_names(&msg)),
                _ => {}
            },
            Err(mpsc::RecvTimeoutError::Timeout) => break Err(format!("No response within {} seconds", timeout.as_secs())),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // stdout closed: the server exited.
                let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
                if let Some(t) = err_thread {
                    let _ = t.join();
                }
                let err = errors.lock().unwrap().clone();
                let last = err.lines().map(str::trim).filter(|l| !l.is_empty()).last().map(String::from);
                PROBES.lock().unwrap().get_or_insert_with(HashSet::new).remove(&pid);
                return Err(last.unwrap_or_else(|| format!("exited with code {code}")));
            }
        }
    };
    drop(stdin);
    kill_tree(pid);
    let _ = child.kill();
    let _ = child.wait();
    PROBES.lock().unwrap().get_or_insert_with(HashSet::new).remove(&pid);
    drop(out_thread);
    drop(err_thread);
    result
}

/// Streamable HTTP: POST initialize, then tools/list with the session id.
pub fn probe_http(server: &Server) -> Result<Vec<String>, String> {
    let url = server.url.clone().filter(|u| u.starts_with("http://") || u.starts_with("https://")).ok_or("Invalid URL")?;
    let mut headers = server.headers.clone();
    if server.uses_github_token {
        if let Some(t) = github_token() {
            headers.insert("Authorization".into(), format!("Bearer {t}"));
        }
    }
    let post = |body: &Value, session: Option<&str>| -> Result<(Option<Value>, Option<String>), String> {
        let mut req = ureq::post(&url)
            .timeout(Duration::from_secs(20))
            .set("Content-Type", "application/json")
            .set("Accept", "application/json, text/event-stream");
        for (k, v) in &headers {
            req = req.set(k, v);
        }
        if let Some(s) = session {
            req = req.set("Mcp-Session-Id", s);
        }
        match req.send_string(&body.to_string()) {
            Ok(r) => {
                let session = r.header("Mcp-Session-Id").map(String::from);
                let text = r.into_string().unwrap_or_default();
                Ok((parse_http_body(&text), session))
            }
            Err(ureq::Error::Status(code, _)) => Err(format!("HTTP {code}{}", if code == 401 { ": needs authorization" } else { "" })),
            Err(e) => Err(e.to_string()),
        }
    };
    let (_, session) = post(&initialize(), None)?;
    let _ = post(&initialized(), session.as_deref());
    let (list, _) = post(&list_tools(), session.as_deref())?;
    Ok(list.map(|l| tool_names(&l)).unwrap_or_default())
}

/// Responses may be plain JSON or a server-sent event stream: the last JSON object wins.
fn parse_http_body(text: &str) -> Option<Value> {
    text.lines()
        .rev()
        .map(|l| l.strip_prefix("data:").unwrap_or(l).trim())
        .find_map(|l| serde_json::from_str::<Value>(l).ok().filter(|v| v.is_object()))
        .or_else(|| serde_json::from_str::<Value>(text).ok().filter(|v| v.is_object()))
}

// ---- Editing ----------------------------------------------------------------------------

fn unique_id(servers: &[Server], base: &str) -> String {
    let mut id = base.to_string();
    let mut n = 2;
    while servers.iter().any(|s| s.id == id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

pub fn register(r: &mut Registry) {
    #[derive(Deserialize)]
    struct Enabled {
        id: String,
        on: bool,
    }
    #[derive(Deserialize)]
    struct One {
        server: Server,
    }
    #[derive(Deserialize)]
    struct Id {
        id: String,
    }
    #[derive(Deserialize)]
    struct Many {
        servers: Vec<Server>,
    }
    #[derive(Deserialize)]
    struct Query {
        query: String,
    }

    // → {servers, status: {id: {state, tools?, error?}}, tools: {id: [names]}, config_path, store_path}
    r.add("mcp_state", |_| Ok(with_store(|s| (snapshot(s), false))));
    r.add("mcp_config_path", |_| Ok(json!(config_path().to_string_lossy())));
    r.add("mcp_set_enabled", |a| {
        let a: Enabled = parse(a)?;
        let server = with_store(|s| match s.servers.iter_mut().find(|x| x.id == a.id) {
            Some(x) => {
                x.enabled = a.on;
                (Some(x.clone()), true)
            }
            None => (None, false),
        });
        if let Some(sv) = server.filter(|_| a.on) {
            check_in_background(sv);
        }
        Ok(Value::Null)
    });
    // {server} → the id it was added under (made unique)
    r.add("mcp_add", |a| {
        let a: One = parse(a)?;
        let added = with_store(|s| {
            let mut sv = a.server.clone();
            sv.id = unique_id(&s.servers, &sv.id);
            s.servers.push(sv.clone());
            (sv, true)
        });
        let id = added.id.clone();
        check_in_background(added);
        Ok(json!(id))
    });
    r.add("mcp_remove", |a| {
        let a: Id = parse(a)?;
        with_store(|s| {
            s.servers.retain(|x| x.id != a.id || x.builtin);
            s.status.remove(&a.id);
            ((), true)
        });
        Ok(Value::Null)
    });
    r.add("mcp_update", |a| {
        let a: One = parse(a)?;
        let found = with_store(|s| match s.servers.iter_mut().find(|x| x.id == a.server.id) {
            Some(x) => {
                *x = a.server.clone();
                (true, true)
            }
            None => (false, false),
        });
        if found {
            check_in_background(a.server);
        }
        Ok(json!(found))
    });
    // The whole list (JSON import / edit-as-JSON, parsed in the UI); then checks every server.
    r.add("mcp_set_servers", |a| {
        let a: Many = parse(a)?;
        with_store(|s| {
            let ids: HashSet<&String> = a.servers.iter().map(|x| &x.id).collect();
            s.status.retain(|k, _| ids.contains(k));
            s.servers = a.servers.clone();
            ((), true)
        });
        std::thread::spawn(check_all);
        Ok(Value::Null)
    });
    r.add("mcp_check", |a| {
        let a: Id = parse(a)?;
        if let Some(sv) = with_store(|s| (s.servers.iter().find(|x| x.id == a.id).cloned(), false)) {
            check_in_background(sv);
        }
        Ok(Value::Null)
    });
    r.add("mcp_check_all", |_| {
        std::thread::spawn(check_all);
        Ok(Value::Null)
    });
    // A connected (or disconnected) GitHub account: rewrite the config and re-check GitHub.
    r.add("mcp_github_changed", |_| {
        let github = with_store(|s| {
            write_agent_config_locked(s);
            (s.servers.iter().find(|x| x.id == "github").cloned(), false)
        });
        if let Some(g) = github {
            check_in_background(g);
        }
        Ok(Value::Null)
    });
    // Settings ▸ "Manage MCP servers…": project windows open the MCP servers tab
    // (they run the `show-mcp` command registered by features/mcp).
    r.add("mcp_show", |_| {
        emit("menu", json!({"id": "show-mcp"}));
        Ok(Value::Null)
    });
    // Searches the official MCP Registry; the raw response (the UI parses it), or null.
    r.add("mcp_registry_search", |a| {
        let a: Query = parse(a)?;
        let res = ureq::get("https://registry.modelcontextprotocol.io/v0/servers")
            .query("search", &a.query)
            .query("limit", "40")
            .timeout(Duration::from_secs(20))
            .call();
        Ok(match res {
            Ok(r) => r.into_json::<Value>().unwrap_or(Value::Null),
            Err(_) => Value::Null,
        })
    });

    // At launch, like the Mac app's boot: load (writes the agent config), then check all.
    std::thread::spawn(|| {
        with_store(|_| ((), false));
        check_all();
    });
}

/// Called when the app exits: stop any server still being checked.
pub fn shutdown() {
    let pids: Vec<u32> = PROBES.lock().unwrap().get_or_insert_with(HashSet::new).drain().collect();
    for pid in pids {
        kill_tree(pid);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mac_app_json_round_trips() {
        let raw = r#"[{"id":"github","title":"GitHub","summary":"s","kind":"http","args":[],"env":{},"url":"https://api.githubcopilot.com/mcp/","headers":{},"enabled":true,"builtin":true,"usesGitHubToken":true}]"#;
        let v: Vec<Server> = serde_json::from_str(raw).unwrap();
        assert!(v[0].uses_github_token && v[0].kind == Kind::Http);
        let back = serde_json::to_string(&v).unwrap();
        assert!(back.contains("\"usesGitHubToken\":true") && !back.contains("\"command\""));
    }

    #[test]
    fn agent_config_skips_failed_disabled_and_tokenless_github() {
        let mut servers = defaults();
        servers[1].enabled = false; // playwright
        let mut status = HashMap::new();
        status.insert("fetch".to_string(), Status::Failed("x".into()));
        let cfg = agent_config(&servers, &status, None);
        let m = cfg["mcpServers"].as_object().unwrap();
        let keys: Vec<&String> = m.keys().collect();
        assert_eq!(keys, vec!["context7", "memory", "sequential-thinking"]);
        assert_eq!(m["context7"], json!({"command": "npx", "args": ["-y", "@upstash/context7-mcp"]}));
        let cfg = agent_config(&servers, &HashMap::new(), Some("tok"));
        assert_eq!(cfg["mcpServers"]["github"], json!({"type": "http", "url": "https://api.githubcopilot.com/mcp/", "headers": {"Authorization": "Bearer tok"}}));
    }

    #[test]
    fn sse_bodies_parse() {
        let v = parse_http_body("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"a\"}]}}\n\n").unwrap();
        assert_eq!(tool_names(&v), vec!["a"]);
    }

    #[test]
    fn stdio_probe_of_a_fake_server() {
        // A tiny MCP server in sh: answers initialize and tools/list.
        let script = r#"while read -r line; do case "$line" in *'"id":1'*) echo '{"jsonrpc":"2.0","id":1,"result":{}}';; *'"id":2'*) echo '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"echo"},{"name":"add"}]}}';; esac; done"#;
        let mut s = stdio_default("fake", "Fake", "", "sh", &["-c", script]);
        s.builtin = false;
        assert_eq!(probe_stdio(&s, Duration::from_secs(10)).unwrap(), vec!["echo", "add"]);
        let bad = stdio_default("bad", "Bad", "", "sh", &["-c", "echo boom >&2; exit 3"]);
        assert_eq!(probe_stdio(&bad, Duration::from_secs(10)).unwrap_err(), "boom");
        let missing = stdio_default("m", "M", "", "definitely-not-a-tool-xyz", &[]);
        assert_eq!(probe_stdio(&missing, Duration::from_secs(1)).unwrap_err(), "definitely-not-a-tool-xyz is not installed");
    }
}
