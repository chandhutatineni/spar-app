//! The agent engine: a private server on loopback plus the host that runs agents on this
//! machine. On Windows both run inside WSL2 (WSL forwards localhost, so the app reaches it).
//!
//! This module only manages processes and carries HTTP. What the agents are (their specs,
//! prompts, custom-model agents) is decided by the UI (src/engine/), which passes the
//! bundles to `engine_start`. HTTP goes through here because the engine sends no CORS
//! headers, and the session stream is relayed as `engine:event` {key, data} events.

use crate::events::emit;
use crate::platform::{has, is_windows, run, sh_quote, shell, wsl_ready};
use crate::registry::{data_dir, parse, Registry};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Not 47817: that is the Mac app's engine port. Sharing one would make either app use the
/// other's engine (different agents, different chat history).
pub const PORT: u16 = 47827;
pub const REQUIRED: [&str; 3] = ["omnigent", "spar", "tmux"];

fn base() -> String {
    format!("http://127.0.0.1:{PORT}")
}

#[derive(Deserialize, Clone)]
pub struct Bundle {
    pub name: String,
    /// The agent spec (config.yaml)
    pub yaml: String,
}

struct State {
    children: Vec<Child>,
    starting: bool,
}
static STATE: Mutex<State> = Mutex::new(State { children: Vec::new(), starting: false });
static START: Mutex<()> = Mutex::new(());

pub fn healthy() -> bool {
    let Ok(mut s) = TcpStream::connect_timeout(&([127, 0, 0, 1], PORT).into(), Duration::from_millis(400)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
    if s.write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").is_err() {
        return false;
    }
    let mut buf = [0u8; 16];
    matches!(s.read(&mut buf), Ok(n) if n >= 12 && &buf[9..12] == b"200")
}

pub fn status() -> Value {
    let platform = std::env::consts::OS;
    let wsl = wsl_ready();
    if is_windows() && !wsl {
        return json!({"ready": false, "running": false, "starting": false, "message": "WSL isn't set up", "missing": ["wsl"], "wsl": false, "platform": platform, "port": PORT});
    }
    let missing: Vec<&str> = REQUIRED.iter().copied().filter(|t| crate::exec::which(t).is_none()).collect();
    let ready = missing.is_empty() && healthy();
    let (ours, starting) = {
        let mut s = STATE.lock().unwrap();
        s.children.retain_mut(|c| matches!(c.try_wait(), Ok(None)));
        (!s.children.is_empty(), s.starting)
    };
    let message = if !missing.is_empty() {
        // Never show tool ids: the engine is "the agent engine" to the person.
        let names: Vec<&str> = missing.iter().map(|m| match *m { "omnigent" => "the agent engine", "spar" => "the SPAR CLI", other => other }).collect();
        format!("Missing: {}", names.join(", "))
    } else if ready {
        "Ready".into()
    } else if starting {
        "Starting…".into()
    } else {
        "Stopped".into()
    };
    json!({"ready": ready, "running": ours, "starting": starting, "message": message, "missing": missing, "wsl": wsl, "platform": platform, "port": PORT})
}

/// Where the engine keeps chats and agent bundles, as the shell sees it.
fn shell_data_dir() -> String {
    if is_windows() {
        let _ = run("mkdir -p ~/.local/share/spar-desktop/engine");
        return run("echo ~/.local/share/spar-desktop")
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|_| "/tmp/spar-desktop".into());
    }
    let d = data_dir();
    let _ = std::fs::create_dir_all(d.join("engine"));
    d.to_string_lossy().to_string()
}

fn write_bundles(bundles: &[Bundle]) -> Result<Vec<String>, String> {
    let data = shell_data_dir();
    let mut out = Vec::new();
    for b in bundles {
        let dir = format!("{data}/agents/{}", b.name);
        if is_windows() {
            let script = format!("mkdir -p {q} && cat > {q}/config.yaml <<'SPAR_EOF'\n{}\nSPAR_EOF", b.yaml, q = sh_quote(&dir));
            run(&script).map_err(|e| e.to_string())?;
        } else {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            std::fs::write(format!("{dir}/config.yaml"), &b.yaml).map_err(|e| e.to_string())?;
        }
        out.push(dir);
    }
    Ok(out)
}

fn spawn(script: &str, env: &BTreeMap<String, String>) -> Result<(), String> {
    let mut c = shell(script);
    c.envs(env).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if is_windows() {
        let names: Vec<String> = env.keys().map(|k| format!("{k}/u")).collect();
        c.env("WSLENV", names.join(":"));
    } else {
        c.env("PATH", crate::exec::path());
    }
    let child = c.spawn().map_err(|e| e.to_string())?;
    STATE.lock().unwrap().children.push(child);
    Ok(())
}

/// Starts the server (with these agents) and the host, unless an engine already answers.
pub fn start(bundles: &[Bundle], extra_env: &BTreeMap<String, String>) -> Result<(), String> {
    let _one = START.lock().unwrap();
    // The engine reads agent prompts only when it starts: if an engine this app started
    // earlier is still running with different prompts, restart it (never someone else's).
    let fingerprint = fingerprint(bundles, extra_env);
    let stamp = data_dir().join("engine.fingerprint");
    if healthy() {
        // Also restart one that is missing any of our agents (one that failed to load a bundle).
        let current = std::fs::read_to_string(&stamp).ok().as_deref() == Some(fingerprint.as_str()) && missing_agents(bundles).is_empty();
        if current || !stop_own_engine() {
            return Ok(());
        }
    }
    let _ = std::fs::create_dir_all(data_dir());
    let _ = std::fs::write(&stamp, &fingerprint);
    STATE.lock().unwrap().starting = true;
    let result = (|| {
        let dirs = write_bundles(bundles)?;
        let data = shell_data_dir();
        let mut env = crate::exec::base_env();
        env.extend(extra_env.clone());
        let agents: String = dirs.iter().map(|d| format!(" --agent {}", sh_quote(d))).collect();
        spawn(
            &format!(
                "exec omnigent server --host 127.0.0.1 --port {PORT}{agents} --database-uri {db} --artifact-location {art} >> {log} 2>&1",
                db = sh_quote(&format!("sqlite:///{data}/engine/chat.db")),
                art = sh_quote(&format!("{data}/engine/artifacts")),
                log = sh_quote(&format!("{data}/engine/server.log")),
            ),
            &env,
        )?;
        for _ in 0..240 {
            if healthy() {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        if !healthy() {
            return Err(format!("The engine did not start. See {data}/engine/server.log"));
        }
        spawn(
            &format!(
                "exec omnigent host --server {} --no-open --non-interactive >> {log} 2>&1",
                base(),
                log = sh_quote(&format!("{data}/engine/host.log"))
            ),
            &env,
        )
    })();
    STATE.lock().unwrap().starting = false;
    result
}

/// The bundles whose agent the running engine hasn't registered.
fn missing_agents(bundles: &[Bundle]) -> Vec<String> {
    let mut registered = std::collections::HashSet::new();
    let mut after = String::new();
    for _ in 0..20 {
        let path = format!("/v1/agents?limit=100{}", if after.is_empty() { String::new() } else { format!("&after={after}") });
        let page = http("GET", &path, None, Duration::from_secs(5));
        let body = &page["body"];
        for a in body["data"].as_array().into_iter().flatten() {
            if let Some(n) = a["name"].as_str() {
                registered.insert(n.to_string());
            }
        }
        match (body["has_more"].as_bool(), body["last_id"].as_str()) {
            (Some(true), Some(id)) => after = id.to_string(),
            _ => break,
        }
    }
    if registered.is_empty() {
        return vec![]; // couldn't ask: don't restart on a guess
    }
    bundles.iter().map(|b| b.name.clone()).filter(|n| !registered.contains(n)).collect()
}

/// A hash of every agent spec (and the env names) the engine is about to load.
fn fingerprint(bundles: &[Bundle], env: &BTreeMap<String, String>) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    for b in bundles {
        h.update(b.name.as_bytes());
        h.update(b.yaml.as_bytes());
    }
    for k in env.keys() {
        h.update(k.as_bytes());
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Stops an engine on our port that this app started (its agents live in our data folder),
/// whether from this run or an earlier one. Returns whether it stopped one.
fn stop_own_engine() -> bool {
    stop();
    if is_windows() || !healthy() {
        return !healthy();
    }
    let agents = format!("{}/agents", shell_data_dir());
    let pattern = format!("omnigent server --host 127.0.0.1 --port {PORT} --agent {agents}");
    let killed = std::process::Command::new("pkill").args(["-f", &pattern]).status().map(|s| s.success()).unwrap_or(false);
    if !killed {
        return false;
    }
    let _ = std::process::Command::new("pkill").args(["-f", &format!("omnigent host --server http://127.0.0.1:{PORT}")]).status();
    for _ in 0..40 {
        if !healthy() {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    !healthy()
}

/// Models an OpenAI-compatible server offers (`GET <base>/models`), for the custom agent sheet.
fn probe_models(base_url: &str, api_key: &str) -> Vec<String> {
    let url = format!("{}/models", base_url.trim().trim_end_matches('/'));
    let mut req = ureq::get(&url).timeout(Duration::from_secs(4));
    if !api_key.is_empty() {
        req = req.set("Authorization", &format!("Bearer {api_key}"));
    }
    let Ok(res) = req.call() else { return vec![] };
    let Ok(v) = res.into_json::<Value>() else { return vec![] };
    let mut out: Vec<String> = v["data"].as_array().map(|a| a.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect()).unwrap_or_default();
    out.sort();
    out
}

pub fn stop() {
    let children: Vec<Child> = STATE.lock().unwrap().children.drain(..).collect();
    for mut c in children {
        let _ = c.kill();
        let _ = c.wait();
    }
    // Killing wsl.exe leaves the Linux processes running; stop them inside WSL.
    if is_windows() {
        let _ = run(&format!("pkill -TERM -f 'omnigent (server|host) .*{PORT}'"));
    }
}

// ---- HTTP ----------------------------------------------------------------------------

fn http(method: &str, path: &str, body: Option<&Value>, timeout: Duration) -> Value {
    let req = ureq::request(method, &format!("{}{path}", base())).timeout(timeout);
    let res = match body {
        // JSON content type doubles as the server's CSRF guard.
        Some(b) => req.set("Content-Type", "application/json").send_string(&b.to_string()),
        None => req.call(),
    };
    let (status, text) = match res {
        Ok(r) => (r.status(), r.into_string().unwrap_or_default()),
        Err(ureq::Error::Status(code, r)) => (code, r.into_string().unwrap_or_default()),
        Err(e) => return json!({"status": 0, "body": null, "error": e.to_string()}),
    };
    let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    json!({"status": status, "body": parsed, "text": if parsed.is_null() { json!(text) } else { Value::Null }})
}

static STREAMS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn streams() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Tails a session's event stream; each event arrives as `engine:event` {key, data} and
/// the end as `engine:stream-end` {key, error}. No replay: re-read the snapshot after.
fn open_stream(key: String, session: String) {
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(old) = streams().lock().unwrap().insert(key.clone(), stop.clone()) {
        old.store(true, Ordering::SeqCst);
    }
    std::thread::spawn(move || {
        let res = ureq::get(&format!("{}/v1/sessions/{session}/stream", base()))
            .set("Accept", "text/event-stream")
            .call();
        let error = match res {
            Err(e) => Some(e.to_string()),
            Ok(r) => {
                let reader = BufReader::new(r.into_reader());
                let mut err = None;
                for line in reader.lines() {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    match line {
                        Ok(l) => {
                            let Some(payload) = l.strip_prefix("data:") else { continue };
                            let payload = payload.trim();
                            if payload == "[DONE]" {
                                break;
                            }
                            if let Ok(v) = serde_json::from_str::<Value>(payload) {
                                emit("engine:event", json!({"key": key, "data": v}));
                            }
                        }
                        Err(e) => {
                            err = Some(e.to_string());
                            break;
                        }
                    }
                }
                err
            }
        };
        let mut map = streams().lock().unwrap();
        if map.get(&key).is_some_and(|s| Arc::ptr_eq(s, &stop)) {
            map.remove(&key);
        }
        drop(map);
        if !stop.load(Ordering::SeqCst) {
            emit("engine:stream-end", json!({"key": key, "error": error}));
        }
    });
}

pub fn register(r: &mut Registry) {
    #[derive(Deserialize)]
    struct StartArgs {
        #[serde(default)]
        bundles: Vec<Bundle>,
        #[serde(default)]
        env: BTreeMap<String, String>,
    }
    #[derive(Deserialize)]
    struct HttpArgs {
        method: String,
        path: String,
        body: Option<Value>,
        timeout_ms: Option<u64>,
    }
    #[derive(Deserialize)]
    struct StreamArgs {
        key: String,
        session: Option<String>,
    }
    // {ready, running, starting, message, missing[], wsl, platform, port}
    r.add("engine_status", |_| Ok(status()));
    r.add("engine_start", |a| {
        let a: StartArgs = parse(a)?;
        start(&a.bundles, &a.env)?;
        Ok(status())
    });
    r.add("engine_stop", |_| {
        stop();
        Ok(status())
    });
    r.add("engine_restart", |a| {
        let a: StartArgs = parse(a)?;
        stop();
        for _ in 0..40 {
            if !healthy() {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        start(&a.bundles, &a.env)?;
        Ok(status())
    });
    // {method, path, body?, timeout_ms?} → {status, body (JSON or null), text?, error?}
    r.add("engine_http", |a| {
        let a: HttpArgs = parse(a)?;
        Ok(http(&a.method, &a.path, a.body.as_ref(), Duration::from_millis(a.timeout_ms.unwrap_or(30_000))))
    });
    r.add("engine_stream_open", |a| {
        let a: StreamArgs = parse(a)?;
        open_stream(a.key, a.session.ok_or("session is required")?);
        Ok(Value::Null)
    });
    r.add("engine_stream_close", |a| {
        let a: StreamArgs = parse(a)?;
        if let Some(s) = streams().lock().unwrap().remove(&a.key) {
            s.store(true, Ordering::SeqCst);
        }
        Ok(Value::Null)
    });
    r.add("engine_probe_models", |a| {
        #[derive(Deserialize)]
        struct P {
            base_url: String,
            #[serde(default)]
            api_key: String,
        }
        let a: P = parse(a)?;
        Ok(json!(probe_models(&a.base_url, &a.api_key)))
    });
    // Whether the engine's Copilot SDK extra is installed where the engine lives.
    r.add("engine_copilot_installed", |_| {
        let out = run(r#"for d in "$HOME"/.local/share/uv/tools/omnigent/lib/python*/site-packages; do ls "$d" 2>/dev/null; done | grep -Eiq '^(github_copilot_sdk|copilot$)' && echo yes"#)
            .map_err(|e| e.to_string())?;
        Ok(json!(String::from_utf8_lossy(&out.stdout).trim() == "yes"))
    });
    // Adds the `copilot` extra, pinned to the installed engine version.
    r.add("engine_copilot_install", |_| {
        let out = run(r#"export PATH="$HOME/.local/bin:$PATH"; v=$(omnigent --version 2>/dev/null | awk '{print $2}'); spec="omnigent[copilot]"; [ -n "$v" ] && spec="omnigent[copilot]==$v"; uv tool install --force --python 3.12 "$spec" 2>&1 | tail -4"#)
            .map_err(|e| e.to_string())?;
        Ok(json!({"ok": out.status.success(), "log": String::from_utf8_lossy(&out.stdout).trim()}))
    });
    // Where the engine's logs and chats live (Settings ▸ Engine ▸ Logs).
    r.add("engine_data_dir", |_| Ok(json!(format!("{}/engine", shell_data_dir()))));
    r.add("engine_has", |a| {
        #[derive(Deserialize)]
        struct N {
            name: String,
        }
        let a: N = parse(a)?;
        Ok(json!(has(&a.name)))
    });
}
