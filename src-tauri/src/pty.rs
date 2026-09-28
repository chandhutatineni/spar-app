//! Terminals: pseudo-terminals for the terminal panel (owned by the terminal feature).
//!
//! The Mac app's TerminalSession: a login shell on a real pseudo-terminal. On Windows the
//! shell runs inside WSL (wsl.exe), where the person's tools and the agents live.
//!
//! Commands:
//! - `pty_open {id, cwd, shell?, cols, rows, env?}` → `{shell}` (the program started)
//! - `pty_write {id, data}`, `pty_resize {id, cols, rows}`, `pty_close {id}`, `pty_list`
//!
//! Events: `pty:data {id, data}` (UTF-8 text, never split inside a character) and
//! `pty:exit {id, code}` when the shell ends.

use crate::events::emit;
use crate::registry::{parse, Registry};
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::sync::{Mutex, OnceLock};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The shell to start: the `terminalShell` setting when it is an executable file,
/// otherwise $SHELL, otherwise zsh (the Mac app's rule).
#[cfg(unix)]
fn pick_shell(configured: Option<&str>) -> String {
    use std::os::unix::fs::PermissionsExt;
    if let Some(s) = configured.map(str::trim).filter(|s| !s.is_empty()) {
        let ok = std::fs::metadata(s).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false);
        if ok {
            return s.to_string();
        }
    }
    std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into())
}

fn environment(extra: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut env = crate::exec::base_env();
    env.remove("OMNIGENT_DISABLE_TELEMETRY");
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("COLORTERM".into(), "truecolor".into());
    env.insert("TERM_PROGRAM".into(), "SPAR".into());
    if !crate::platform::is_windows() {
        env.insert("PATH".into(), crate::exec::path().to_string());
        if std::env::var("LANG").is_err() {
            env.insert("LANG".into(), "en_US.UTF-8".into());
        }
    }
    env.extend(extra.clone());
    env
}

#[cfg(unix)]
fn build_command(cwd: &str, shell: Option<&str>, env: &BTreeMap<String, String>) -> (CommandBuilder, String) {
    let sh = pick_shell(shell);
    let mut c = CommandBuilder::new(&sh);
    c.arg("-l");
    if std::path::Path::new(cwd).is_dir() {
        c.cwd(cwd);
    } else {
        c.cwd(crate::registry::home());
    }
    for (k, v) in env {
        c.env(k, v);
    }
    c.env_remove("OMNIGENT_DISABLE_TELEMETRY");
    (c, sh)
}

/// Windows: the shell runs inside WSL, in the project folder. The environment is forwarded
/// through WSLENV (as exec.rs does for tools).
#[cfg(not(unix))]
fn build_command(cwd: &str, shell: Option<&str>, env: &BTreeMap<String, String>) -> (CommandBuilder, String) {
    let mut c = CommandBuilder::new("wsl.exe");
    if !cwd.is_empty() {
        c.args(["--cd", cwd]);
    }
    let sh = shell.map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    if let Some(s) = &sh {
        c.args(["-e", s.as_str(), "-l"]);
    }
    for (k, v) in env {
        c.env(k, v);
    }
    let names: Vec<String> = env.keys().map(|k| format!("{k}/u")).collect();
    c.env("WSLENV", names.join(":"));
    c.cwd(crate::registry::home());
    (c, sh.unwrap_or_else(|| "wsl".into()))
}

/// Splits `buf` into the longest valid UTF-8 prefix (lossy for real errors) and the bytes of
/// a character cut off at the end, which wait for the next read.
fn take_utf8(carry: &mut Vec<u8>, buf: &[u8]) -> String {
    carry.extend_from_slice(buf);
    let mut out = String::new();
    loop {
        match std::str::from_utf8(carry) {
            Ok(s) => {
                out.push_str(s);
                carry.clear();
                return out;
            }
            Err(e) => {
                let good = e.valid_up_to();
                out.push_str(std::str::from_utf8(&carry[..good]).unwrap_or_default());
                match e.error_len() {
                    None => {
                        carry.drain(..good);
                        return out;
                    }
                    Some(n) => {
                        out.push('\u{FFFD}');
                        carry.drain(..good + n);
                    }
                }
            }
        }
    }
}

fn open(id: String, cwd: String, shell: Option<String>, cols: u16, rows: u16, extra: BTreeMap<String, String>) -> Result<Value, String> {
    if sessions().lock().unwrap().contains_key(&id) {
        return Err(format!("terminal {id} is already open"));
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let env = environment(&extra);
    let (cmd, sh) = build_command(&cwd, shell.as_deref(), &env);
    let mut child: Box<dyn Child + Send + Sync> = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    sessions().lock().unwrap().insert(id.clone(), Session { master: pair.master, writer, killer });

    std::thread::spawn(move || {
        let mut buf = vec![0u8; 65536];
        let mut carry = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = take_utf8(&mut carry, &buf[..n]);
                    if !text.is_empty() {
                        emit("pty:data", json!({"id": id, "data": text}));
                    }
                }
            }
        }
        let code = child.wait().map(|s| s.exit_code() as i64).unwrap_or(-1);
        sessions().lock().unwrap().remove(&id);
        emit("pty:exit", json!({"id": id, "code": code}));
    });
    Ok(json!({"shell": sh}))
}

fn close(id: &str) {
    let s = sessions().lock().unwrap().remove(id);
    if let Some(mut s) = s {
        let _ = s.killer.kill(); // SIGHUP, like closing a terminal window
        drop(s.writer);
        drop(s.master);
    }
}

pub fn register(r: &mut Registry) {
    #[derive(Deserialize)]
    struct Open {
        id: String,
        #[serde(default)]
        cwd: String,
        shell: Option<String>,
        #[serde(default = "cols")]
        cols: u16,
        #[serde(default = "rows")]
        rows: u16,
        #[serde(default)]
        env: BTreeMap<String, String>,
    }
    fn cols() -> u16 {
        100
    }
    fn rows() -> u16 {
        24
    }
    r.add("pty_open", |a| {
        let a: Open = parse(a)?;
        open(a.id, a.cwd, a.shell, a.cols, a.rows, a.env)
    });

    #[derive(Deserialize)]
    struct Write_ {
        id: String,
        data: String,
    }
    r.add("pty_write", |a| {
        let a: Write_ = parse(a)?;
        let mut map = sessions().lock().unwrap();
        let s = map.get_mut(&a.id).ok_or_else(|| format!("no terminal {}", a.id))?;
        s.writer.write_all(a.data.as_bytes()).map_err(|e| e.to_string())?;
        let _ = s.writer.flush();
        Ok(Value::Null)
    });

    #[derive(Deserialize)]
    struct Resize {
        id: String,
        cols: u16,
        rows: u16,
    }
    r.add("pty_resize", |a| {
        let a: Resize = parse(a)?;
        let map = sessions().lock().unwrap();
        if let Some(s) = map.get(&a.id) {
            s.master
                .resize(PtySize { rows: a.rows.max(2), cols: a.cols.max(10), pixel_width: 0, pixel_height: 0 })
                .map_err(|e| e.to_string())?;
        }
        Ok(Value::Null)
    });

    #[derive(Deserialize)]
    struct Id {
        id: String,
    }
    r.add("pty_close", |a| {
        let a: Id = parse(a)?;
        close(&a.id);
        Ok(Value::Null)
    });

    r.add("pty_list", |_| {
        let mut ids: Vec<String> = sessions().lock().unwrap().keys().cloned().collect();
        ids.sort();
        Ok(json!(ids))
    });
}

/// Called when the app exits: hang up every shell.
pub fn shutdown() {
    let ids: Vec<String> = sessions().lock().unwrap().keys().cloned().collect();
    for id in ids {
        close(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::take_utf8;

    #[test]
    fn keeps_split_characters_for_the_next_read() {
        let mut carry = Vec::new();
        let bytes = "é!".as_bytes();
        assert_eq!(take_utf8(&mut carry, &bytes[..1]), "");
        assert_eq!(take_utf8(&mut carry, &bytes[1..]), "é!");
        assert_eq!(take_utf8(&mut carry, &[0xff, b'a']), "\u{FFFD}a");
    }
}
