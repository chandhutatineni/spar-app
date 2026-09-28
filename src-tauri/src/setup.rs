//! First-run setup (a port of the Mac app's Backend/Runtime.swift `ensure()`): installs
//! whatever the agent engine needs that isn't on this machine, in steps the UI shows, and
//! nothing that's already there. Safe to run on every launch. Runs in the person's shell,
//! so on Windows everything lands inside WSL.
//!
//! Steps, in order (the Mac app's, minus the Python diagrams libraries, which the docs
//! feature sets up):
//!   env       uv (and Python 3.12 through it), tmux and git when missing
//!   omnigent  the agent engine
//!   spar      the SPAR CLI from the wheel shipped with the app: installed when missing,
//!             upgraded when the shipped one is newer, then `spar install` (links the
//!             playbooks into ~/.claude) and `spar mcp install`
//! Agent CLIs (Claude Code, Codex, Copilot, Bob…) are never installed: each agent is
//! offered when its CLI is found.
//!
//! Progress: `setup:step` {id, title, state, error} for every change, and `setup:state`
//! {running, steps, log} when a run starts and ends.

use crate::events::emit;
use crate::platform::{run, sh_quote, to_shell_path};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};

#[derive(Clone)]
struct Step {
    id: &'static str,
    title: String,
    state: &'static str, // pending | running | done | skipped | failed
    error: Option<String>,
}

impl Step {
    fn to_json(&self) -> Value {
        json!({"id": self.id, "title": self.title, "state": self.state, "error": self.error})
    }
}

struct Setup {
    steps: Vec<Step>,
    running: bool,
    /// A run finished during this launch (the background run happens once per launch).
    ran: bool,
    log: Vec<String>,
}

static SETUP: Mutex<Option<Setup>> = Mutex::new(None);
static DONE: Condvar = Condvar::new();

fn initial_steps() -> Vec<Step> {
    let machine = if cfg!(target_os = "macos") { "this Mac" } else { "this computer" };
    let s = |id, title: String| Step { id, title, state: "pending", error: None };
    vec![
        s("env", format!("Python and the tools SPAR needs that aren't on {machine}")),
        s("diagrams", "Python libraries for diagrams and slides".into()),
        s("omnigent", "Agent engine".into()),
        s("spar", "SPAR workflow".into()),
    ]
}

fn with<R>(f: impl FnOnce(&mut Setup) -> R) -> R {
    let mut g = SETUP.lock().unwrap();
    let s = g.get_or_insert_with(|| Setup { steps: initial_steps(), running: false, ran: false, log: Vec::new() });
    f(s)
}

pub fn snapshot() -> Value {
    with(|s| {
        json!({
            "running": s.running,
            "ran": s.ran,
            "steps": s.steps.iter().map(Step::to_json).collect::<Vec<_>>(),
            "log": s.log,
            "needs_core_setup": needs_core_setup(),
        })
    })
}

/// The engine can't start without these (the Mac app's `needsCoreSetup`).
pub fn needs_core_setup() -> bool {
    crate::engine::REQUIRED.iter().any(|t| crate::exec::which(t).is_none())
}

fn set_state(id: &str, state: &'static str, error: Option<String>) {
    let step = with(|s| {
        let st = s.steps.iter_mut().find(|x| x.id == id)?;
        st.state = state;
        st.error = error.clone();
        if let Some(e) = &error {
            s.log.push(format!("{id}: {e}"));
        }
        Some(st.to_json())
    });
    if let Some(v) = step {
        emit("setup:step", v);
    }
}

fn log(line: String) {
    with(|s| s.log.push(line));
}

/// Runs a step unless `skip`; `work` returns an error message or None.
fn step(id: &str, skip: bool, work: impl FnOnce() -> Option<String>) -> bool {
    if skip {
        set_state(id, "skipped", None);
        return true;
    }
    set_state(id, "running", None);
    match work() {
        Some(e) => {
            set_state(id, "failed", Some(e));
            false
        }
        None => {
            set_state(id, "done", None);
            true
        }
    }
}

/// Runs a script in the person's shell; None on success, else the last two lines of its output.
fn sh(script: &str) -> Option<String> {
    log(format!("$ {}", script.lines().next().unwrap_or("")));
    match run(&format!("set -e\n{script}")) {
        Err(e) => Some(e.to_string()),
        Ok(o) if o.status.success() => None,
        Ok(o) => {
            let err = String::from_utf8_lossy(&o.stderr);
            let out = String::from_utf8_lossy(&o.stdout);
            let text = if err.trim().is_empty() { out.trim().to_string() } else { err.trim().to_string() };
            let tail: Vec<&str> = text.lines().rev().take(2).collect();
            let msg = tail.into_iter().rev().collect::<Vec<_>>().join(" ");
            Some(if msg.is_empty() { format!("exited with code {}", o.status.code().unwrap_or(-1)) } else { msg })
        }
    }
}

fn ok(script: &str) -> bool {
    run(script).map(|o| o.status.success()).unwrap_or(false)
}

fn has(tool: &str) -> bool {
    crate::exec::which(tool).is_some()
}

/// The SPAR wheel shipped with the app.
pub fn bundled_wheel(resource_dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(resource_dir.join("wheels"))
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|x| x == "whl"))
}

/// "spar_cli-0.3.0-py3-none-any.whl" → "0.3.0"
pub fn wheel_version(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let parts: Vec<&str> = name.split('-').collect();
    (parts.len() > 1).then(|| parts[1].to_string())
}

/// `spar --version` → "0.3.4"; "0" when spar exists but can't report one; None when missing.
fn installed_spar_version() -> Option<String> {
    if !has("spar") {
        return None;
    }
    let o = crate::exec::run("spar", &["--version".into()], None, &Default::default(), None, Some(std::time::Duration::from_secs(20)));
    Some(if o.status == 0 { o.stdout.split_whitespace().last().unwrap_or("0").to_string() } else { "0".into() })
}

pub fn is_newer(a: &str, than: &str) -> bool {
    let x: Vec<i64> = a.split('.').map(|p| p.parse().unwrap_or(0)).collect();
    let y: Vec<i64> = than.split('.').map(|p| p.parse().unwrap_or(0)).collect();
    for i in 0..x.len().max(y.len()) {
        let (l, r) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
        if l != r {
            return l > r;
        }
    }
    false
}

/// Installs whatever is missing. Waits for (and reports) a run already in progress.
pub fn ensure(resource_dir: &Path) -> Result<String, String> {
    {
        let mut g = SETUP.lock().unwrap();
        g.get_or_insert_with(|| Setup { steps: initial_steps(), running: false, ran: false, log: Vec::new() });
        if g.as_ref().unwrap().running {
            let g = DONE.wait_while(g, |s| s.as_ref().is_some_and(|s| s.running)).unwrap();
            drop(g);
            return result();
        }
        let s = g.as_mut().unwrap();
        s.running = true;
        s.steps = initial_steps();
    }
    emit("setup:state", snapshot());

    // 1. Like the Mac app's first launch: tmux, git, uv, Graphviz and PlantUML (+ Java) —
    //    only what this machine lacks — from conda-forge with the micromamba shipped in the
    //    app, then Python 3.12 (through uv) and the Python libraries for diagrams and slides.
    //    Nothing is installed later except pandoc (Word export) and gh (GitHub sign-in), and
    //    only if they're needed. Agent CLIs (Claude Code, Copilot, …) are never installed.
    let pkgs = crate::docs::missing_runtime_packages();
    let python_ok = has("uv") && ok("uv python find 3.12 >/dev/null 2>&1");
    step("env", python_ok && pkgs.is_empty(), || {
        if !pkgs.is_empty() {
            log(format!("Installing: {}", pkgs.join(", ")));
            if let Err(e) = crate::docs::install_runtime_packages(&pkgs) {
                return Some(e);
            }
        }
        if !ok("uv python find 3.12 >/dev/null 2>&1") {
            log("Installing: Python 3.12".into());
            if let Some(e) = sh("uv python install 3.12 >/dev/null") {
                return Some(e);
            }
        }
        None
    });
    step("diagrams", crate::docs::diagram_python_ready(), || crate::docs::install_diagram_python().err());

    // 2. The agent engine.
    step("omnigent", has("omnigent"), || sh("uv tool install --python 3.12 omnigent==0.15.0 >/dev/null"));

    // 3. SPAR itself: installed when missing, upgraded when the app carries a newer version,
    //    and its commands re-linked into ~/.claude so the agents see the current playbooks.
    let wheel = bundled_wheel(resource_dir);
    let bundled = wheel.as_deref().and_then(wheel_version);
    let installed = installed_spar_version();
    let outdated = matches!((&bundled, &installed), (Some(b), Some(i)) if is_newer(b, i));
    let playbooks = ok("test -f \"$HOME/.claude/commands/spar.init.md\"");
    step("spar", installed.is_some() && !outdated && playbooks, || {
        if installed.is_none() || outdated {
            let Some(wheel) = &wheel else { return Some("The SPAR package is missing from the app".into()) };
            let w = sh_quote(&to_shell_path(&wheel.to_string_lossy()));
            // Upgrade the copy that's already on PATH (usually the person's own uv tools).
            let script = if installed.is_some() { format!("uv tool install --force {w} >/dev/null") } else { format!("uv tool install --force --python 3.12 {w} >/dev/null") };
            if let Some(e) = sh(&script) {
                return Some(e);
            }
        }
        if let Some(e) = sh("spar install >/dev/null") {
            return Some(e);
        }
        let _ = sh("spar mcp install >/dev/null 2>&1");
        None
    });

    {
        let mut g = SETUP.lock().unwrap();
        let s = g.as_mut().unwrap();
        s.running = false;
        s.ran = true;
    }
    DONE.notify_all();
    emit("setup:state", snapshot());
    result()
}

/// The last run as the `engine_setup` result: its log, or the failures.
fn result() -> Result<String, String> {
    with(|s| {
        let failed: Vec<String> = s.steps.iter().filter(|x| x.state == "failed").map(|x| format!("{}: {}", x.title, x.error.clone().unwrap_or_default())).collect();
        if failed.is_empty() {
            Ok(s.log.join("\n"))
        } else {
            Err(failed.join("\n"))
        }
    })
}

pub fn register(r: &mut crate::registry::Registry) {
    #[derive(serde::Deserialize)]
    struct Start {
        #[serde(default)]
        force: bool,
    }
    // Runs setup and waits for it (engine.ts `setup()`); progress arrives as events.
    r.add("engine_setup", |_| ensure(&crate::registry::resource_dir()).map(Value::String));
    // {running, ran, steps: [{id, title, state, error}], log, needs_core_setup}
    r.add("setup_status", |_| Ok(snapshot()));
    // Starts a run in the background (once per launch unless `force`: "Check and repair").
    r.add("setup_start", |a| {
        let a: Start = crate::registry::parse(a)?;
        let (running, ran) = with(|s| (s.running, s.ran));
        if !running && (a.force || !ran) {
            std::thread::spawn(|| {
                let _ = ensure(&crate::registry::resource_dir());
            });
        }
        Ok(snapshot())
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert!(is_newer("0.3.4", "0.3.3"));
        assert!(is_newer("0.10.0", "0.9.9"));
        assert!(!is_newer("0.3.4", "0.3.4"));
        assert!(!is_newer("0.3", "0.3.0"));
        assert!(is_newer("0.3.4", "0"));
        assert_eq!(wheel_version(Path::new("/x/spar_cli-0.3.4-py3-none-any.whl")).as_deref(), Some("0.3.4"));
    }

    /// Runs the real setup against the bundled wheel; on a machine that has everything it
    /// skips every step. `cargo test -- --ignored setup` to run it.
    #[test]
    #[ignore]
    fn setup_is_idempotent() {
        ensure(Path::new("resources")).expect("setup");
    }
}
