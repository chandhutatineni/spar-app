//! Running tools. macOS/Linux: directly, with the PATH of the person's login shell (a GUI
//! app inherits a bare one). Windows: inside WSL, with env forwarded through WSLENV.

use crate::events::emit;
use crate::platform::{is_windows, sh_quote, to_shell_path};
use crate::registry::{home, parse, Registry};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

static PATH: OnceLock<String> = OnceLock::new();

/// Login-shell PATH plus the usual install locations (the person's tools win).
pub fn path() -> &'static str {
    PATH.get_or_init(|| {
        let h = home().to_string_lossy().to_string();
        let mut parts: Vec<String> = Vec::new();
        if !is_windows() {
            let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
            if let Ok(mut child) = Command::new(sh)
                .args(["-lc", "printf '__PATH__%s' \"$PATH\""])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
            {
                let start = Instant::now();
                while start.elapsed() < Duration::from_secs(5) {
                    if let Ok(Some(_)) = child.try_wait() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(30));
                }
                let _ = child.kill();
                let mut s = String::new();
                if let Some(mut out) = child.stdout.take() {
                    let _ = out.read_to_string(&mut s);
                }
                if let Some(p) = s.split("__PATH__").nth(1) {
                    parts.extend(p.trim().split(':').map(String::from));
                }
            }
        }
        for extra in [
            format!("{h}/.local/bin"),
            "/opt/homebrew/bin".into(),
            "/usr/local/bin".into(),
            format!("{h}/.cargo/bin"),
            "/usr/bin".into(),
            "/bin".into(),
            "/usr/sbin".into(),
            "/sbin".into(),
        ] {
            parts.push(extra);
        }
        // Tools SPAR installed into its own runtime (and the ones it ships) come after the person's.
        if !is_windows() {
            parts.extend(crate::docs::runtime_bins());
            parts.push(crate::registry::resource_dir().join("bin").to_string_lossy().to_string());
        }
        if let Ok(p) = std::env::var("PATH") {
            parts.extend(p.split(if is_windows() { ';' } else { ':' }).map(String::from));
        }
        let mut seen = std::collections::HashSet::new();
        parts.retain(|p| !p.is_empty() && seen.insert(p.clone()));
        parts.join(":")
    })
}

pub fn which(name: &str) -> Option<PathBuf> {
    if is_windows() {
        return crate::platform::has(name).then(|| PathBuf::from(name));
    }
    if name.contains('/') {
        return std::path::Path::new(name).exists().then(|| PathBuf::from(name));
    }
    path().split(':').map(|d| PathBuf::from(d).join(name)).find(|p| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            p.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
        }
        #[cfg(not(unix))]
        {
            p.is_file()
        }
    })
}

/// The environment every tool and the engine get.
pub fn base_env() -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    env.insert("OMNIGENT_DISABLE_TELEMETRY".into(), "true".into());
    env.insert("DO_NOT_TRACK".into(), "1".into());
    env.extend(crate::secrets::environment());
    env
}

/// A ready-to-spawn command for `program args` in `cwd`, with the base env plus `extra`.
pub fn command(program: &str, args: &[String], cwd: Option<&str>, extra: &BTreeMap<String, String>) -> Result<Command, String> {
    let mut env = base_env();
    env.extend(extra.clone());
    if is_windows() {
        let mut script = String::new();
        if let Some(c) = cwd {
            script.push_str(&format!("cd {} && ", sh_quote(&to_shell_path(c))));
        }
        script.push_str("exec ");
        script.push_str(&sh_quote(program));
        for a in args {
            script.push(' ');
            script.push_str(&sh_quote(a));
        }
        let mut c = crate::platform::shell(&script);
        let names: Vec<String> = env.keys().map(|k| format!("{k}/u")).collect();
        c.envs(&env).env("WSLENV", names.join(":"));
        Ok(c)
    } else {
        let exe = which(program).ok_or_else(|| format!("{program} not found on PATH"))?;
        let mut c = Command::new(exe);
        c.args(args).envs(&env).env("PATH", path());
        if let Some(d) = cwd {
            c.current_dir(d);
        }
        Ok(c)
    }
}

pub struct Output {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

pub fn run(program: &str, args: &[String], cwd: Option<&str>, extra: &BTreeMap<String, String>, input: Option<&str>, timeout: Option<Duration>) -> Output {
    let mut c = match command(program, args, cwd, extra) {
        Ok(c) => c,
        Err(e) => return Output { status: 127, stdout: String::new(), stderr: e },
    };
    c.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match c.spawn() {
        Ok(ch) => ch,
        Err(e) => return Output { status: 126, stdout: String::new(), stderr: e.to_string() },
    };
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        let text = text.to_string();
        std::thread::spawn(move || {
            let _ = stdin.write_all(text.as_bytes());
        });
    }
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let t_out = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = out.read_to_end(&mut b);
        b
    });
    let t_err = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = err.read_to_end(&mut b);
        b
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s.code().unwrap_or(-1),
            Ok(None) => {
                if timeout.is_some_and(|t| start.elapsed() > t) {
                    let _ = child.kill();
                    let _ = child.wait();
                    break 124;
                }
                std::thread::sleep(Duration::from_millis(15));
            }
            Err(_) => break -1,
        }
    };
    Output {
        status,
        stdout: String::from_utf8_lossy(&t_out.join().unwrap_or_default()).to_string(),
        stderr: String::from_utf8_lossy(&t_err.join().unwrap_or_default()).to_string(),
    }
}

// ---- Long-running processes ----------------------------------------------------------

static PROCS: OnceLock<Mutex<HashMap<String, Arc<Mutex<Child>>>>> = OnceLock::new();

fn procs() -> &'static Mutex<HashMap<String, Arc<Mutex<Child>>>> {
    PROCS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Starts `program` in the background; output arrives as `proc:output` {id, stream, data}
/// and the end as `proc:exit` {id, status}.
pub fn spawn(id: &str, program: &str, args: &[String], cwd: Option<&str>, extra: &BTreeMap<String, String>) -> Result<(), String> {
    let mut c = command(program, args, cwd, extra)?;
    c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0); // so kill stops the whole tree (npm → node …)
    }
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    for (name, pipe) in [("stdout", child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>)), ("stderr", child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>))] {
        if let Some(mut p) = pipe {
            let id = id.to_string();
            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                while let Ok(n) = p.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    emit("proc:output", json!({"id": id, "stream": name, "data": String::from_utf8_lossy(&buf[..n])}));
                }
            });
        }
    }
    let child = Arc::new(Mutex::new(child));
    procs().lock().unwrap().insert(id.to_string(), child.clone());
    let id = id.to_string();
    std::thread::spawn(move || loop {
        let done = child.lock().unwrap().try_wait().ok().flatten();
        if let Some(s) = done {
            procs().lock().unwrap().remove(&id);
            emit("proc:exit", json!({"id": id, "status": s.code()}));
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    });
    Ok(())
}

pub fn kill(id: &str) {
    if let Some(child) = procs().lock().unwrap().get(id).cloned() {
        let mut c = child.lock().unwrap();
        #[cfg(unix)]
        {
            let _ = Command::new("kill").args(["-TERM", &format!("-{}", c.id())]).status();
        }
        let _ = c.kill();
    }
}

pub fn kill_all() {
    let ids: Vec<String> = procs().lock().unwrap().keys().cloned().collect();
    for id in ids {
        kill(&id);
    }
}

pub fn register(r: &mut Registry) {
    #[derive(Deserialize)]
    struct RunArgs {
        program: String,
        #[serde(default)]
        args: Vec<String>,
        cwd: Option<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        input: Option<String>,
        timeout_ms: Option<u64>,
    }
    #[derive(Deserialize)]
    struct SpawnArgs {
        id: String,
        program: String,
        #[serde(default)]
        args: Vec<String>,
        cwd: Option<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
    }
    #[derive(Deserialize)]
    struct Id {
        id: String,
    }
    #[derive(Deserialize)]
    struct Name {
        name: String,
    }
    // {program, args, cwd?, env?, input?, timeout_ms?} → {status, stdout, stderr, ok}
    r.add("exec_run", |a| {
        let a: RunArgs = parse(a)?;
        let o = run(&a.program, &a.args, a.cwd.as_deref(), &a.env, a.input.as_deref(), a.timeout_ms.map(Duration::from_millis));
        Ok(json!({"status": o.status, "stdout": o.stdout, "stderr": o.stderr, "ok": o.status == 0}))
    });
    r.add("exec_which", |a| {
        let a: Name = parse(a)?;
        Ok(json!(which(&a.name).map(|p| p.to_string_lossy().to_string())))
    });
    r.add("exec_spawn", |a| {
        let a: SpawnArgs = parse(a)?;
        spawn(&a.id, &a.program, &a.args, a.cwd.as_deref(), &a.env)?;
        Ok(Value::Null)
    });
    r.add("exec_kill", |a| {
        let a: Id = parse(a)?;
        kill(&a.id);
        Ok(Value::Null)
    });
    r.add("exec_path", |_| Ok(json!(path())));
}
