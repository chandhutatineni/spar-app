//! Source control and GitHub (owned by the source-control feature). A port of the Mac app's
//! Git.swift, SourceControl.swift (the git side), Review.swift, Checkpoints.swift and
//! GitHub.swift (REST + the browser sign-in through the GitHub CLI).
//!
//! Every git call goes through `exec::run`, so it gets the login-shell PATH (and WSL on
//! Windows). The GitHub token never leaves the backend except to git's askpass helper.

use crate::events::emit;
use crate::exec::{self, Output};
use crate::platform::to_shell_path;
use crate::registry::{data_dir, err, parse, Registry};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const NET_TIMEOUT: Duration = Duration::from_secs(180);
const LOCAL_TIMEOUT: Duration = Duration::from_secs(60);

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

fn git_env(root: &str, args: &[String], env: &BTreeMap<String, String>, input: Option<&str>, timeout: Duration) -> Output {
    exec::run("git", args, Some(root), env, input, Some(timeout))
}

fn git(root: &str, args: &[&str]) -> Output {
    git_env(root, &s(args), &BTreeMap::new(), None, LOCAL_TIMEOUT)
}

fn ok(o: &Output) -> bool {
    o.status == 0
}

fn trimmed(o: &Output) -> String {
    o.stdout.trim().to_string()
}

fn err_text(o: &Output) -> String {
    (if o.stderr.trim().is_empty() { &o.stdout } else { &o.stderr }).trim().to_string()
}

fn out_json(o: &Output) -> Value {
    json!({"ok": ok(o), "status": o.status, "stdout": o.stdout, "stderr": o.stderr})
}

/// Moves a file to the Trash (what the Mac app does for new files it discards).
fn trash(path: &Path) -> Result<(), String> {
    if !path.exists() && path.symlink_metadata().is_err() {
        return Ok(());
    }
    if cfg!(target_os = "windows") {
        // The Recycle Bin, through the shell's own API.
        let p = path.to_string_lossy().replace('\'', "''");
        let script = format!(
            "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{p}','OnlyErrorDialogs','SendToRecycleBin')"
        );
        let o = std::process::Command::new("powershell").args(["-NoProfile", "-Command", &script]).output().map_err(err)?;
        return if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stderr).trim().to_string()) };
    }
    let home = crate::registry::home();
    let (files, info) = if cfg!(target_os = "macos") {
        (home.join(".Trash"), None)
    } else {
        let base = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".local/share")).join("Trash");
        (base.join("files"), Some(base.join("info")))
    };
    std::fs::create_dir_all(&files).map_err(err)?;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_string(), name[i..].to_string()),
        _ => (name.clone(), String::new()),
    };
    let mut target = files.join(&name);
    let mut n = 2;
    while target.symlink_metadata().is_ok() {
        target = files.join(format!("{stem} {n}{ext}"));
        n += 1;
    }
    if let Err(e) = std::fs::rename(path, &target) {
        // Another volume (or no access to ~/.Trash): let Finder move it to that volume's Trash.
        if cfg!(target_os = "macos") {
            let p = path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
            let o = std::process::Command::new("osascript").args(["-e", &format!("tell application \"Finder\" to delete POSIX file \"{p}\"")]).output().map_err(err)?;
            return if o.status.success() { Ok(()) } else { Err(e.to_string()) };
        }
        return Err(e.to_string());
    }
    if let Some(info) = info {
        let _ = std::fs::create_dir_all(&info);
        let tn = target.file_name().unwrap().to_string_lossy().to_string();
        let _ = std::fs::write(info.join(format!("{tn}.trashinfo")), format!("[Trash Info]\nPath={}\n", path.to_string_lossy()));
    }
    Ok(())
}

// ---- Git.swift -----------------------------------------------------------------------

/// Working-tree changes as git sees them; None outside a repository.
fn changes(root: &str) -> Option<Vec<(String, String)>> {
    let out = git(root, &["status", "--porcelain=v1", "--untracked-files=all"]);
    if !ok(&out) {
        return None;
    }
    Some(
        out.stdout
            .split('\n')
            .take(300)
            .filter_map(|line| {
                if line.chars().count() <= 3 {
                    return None;
                }
                let code: String = line.chars().take(2).collect();
                let mut path: String = line.chars().skip(3).collect();
                if let Some(i) = path.find(" -> ") {
                    path = path[i + 4..].to_string();
                }
                let path = path.trim_matches('"').to_string();
                let status = if code == "??" || code.contains('A') {
                    "created"
                } else if code.contains('D') {
                    "deleted"
                } else {
                    "modified"
                };
                Some((path, status.to_string()))
            })
            .collect(),
    )
}

fn changes_json(list: &[(String, String)]) -> Value {
    json!(list.iter().map(|(p, st)| json!({"path": p, "status": st})).collect::<Vec<_>>())
}

fn staged_set(root: &str) -> HashSet<String> {
    git(root, &["diff", "--cached", "--name-only"]).stdout.split('\n').filter(|l| !l.is_empty()).map(String::from).collect()
}

fn is_untracked(root: &str, path: &str) -> bool {
    !ok(&git(root, &["ls-files", "--error-unmatch", "--", path]))
}

/// SourceControl.refresh() plus the change list and staged files, in one round trip.
fn status(root: &str) -> Value {
    let is_repo = git(root, &["rev-parse", "--is-inside-work-tree"]).stdout.starts_with("true");
    if !is_repo {
        return json!({"is_repo": false});
    }
    let branch = trimmed(&git(root, &["branch", "--show-current"]));
    let up = git(root, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    let upstream = if ok(&up) { Some(trimmed(&up)) } else { None };
    let (mut ahead, mut behind) = (0, 0);
    if upstream.is_some() {
        let counts: Vec<i64> = git(root, &["rev-list", "--left-right", "--count", "HEAD...@{u}"])
            .stdout
            .split(|c: char| c == '\t' || c == ' ' || c == '\n')
            .filter_map(|x| x.parse().ok())
            .collect();
        if counts.len() == 2 {
            ahead = counts[0];
            behind = counts[1];
        }
    }
    let remote = git(root, &["remote", "get-url", "origin"]);
    let branches: Vec<String> = git(root, &["branch", "--format=%(refname:short)"]).stdout.split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    let has_head = ok(&git(root, &["rev-parse", "--verify", "-q", "HEAD"]));
    let list = changes(root).unwrap_or_default();
    json!({
        "is_repo": true,
        "branch": if branch.is_empty() { Value::Null } else { json!(branch) },
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "remote_url": if ok(&remote) { json!(trimmed(&remote)) } else { Value::Null },
        "branches": branches,
        "has_head": has_head,
        "changes": changes_json(&list),
        "staged": staged_set(root).into_iter().collect::<Vec<_>>(),
    })
}

/// (HEAD version, working-tree version) of a file; null where it does not exist.
fn versions(root: &str, path: &str) -> Value {
    let head = git(root, &["show", &format!("HEAD:{path}")]);
    let after = std::fs::read_to_string(Path::new(root).join(path)).ok();
    json!({"before": if ok(&head) { json!(head.stdout) } else { Value::Null }, "after": after})
}

// ---- SourceControl.swift (the network side) ------------------------------------------

fn github_token() -> Option<String> {
    crate::secrets::get("github-token")
}

fn askpass() -> Result<String, String> {
    let path = data_dir().join("git-askpass.sh");
    let script = "#!/bin/sh\ncase \"$1\" in\n  *Username*|*username*) echo \"x-access-token\" ;;\n  *) echo \"$SPAR_GITHUB_TOKEN\" ;;\nesac\n";
    std::fs::write(&path, script).map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700));
    }
    Ok(to_shell_path(&path.to_string_lossy()))
}

fn is_auth_failure(o: &Output) -> bool {
    let text = format!("{}{}", o.stderr, o.stdout).to_lowercase();
    ["authentication failed", "could not read username", "terminal prompts disabled", "permission denied", "403", "invalid username or password"]
        .iter()
        .any(|k| text.contains(k))
}

/// A network git command with the person's own credentials first, then (HTTPS GitHub
/// remotes) with the connected GitHub token through an askpass helper.
fn remote(root: &str, args: &[String]) -> Output {
    let mut env = BTreeMap::new();
    env.insert("GIT_TERMINAL_PROMPT".to_string(), "0".to_string());
    let first = git_env(root, args, &env, None, NET_TIMEOUT);
    if ok(&first) || !is_auth_failure(&first) {
        return first;
    }
    let Some(token) = github_token() else { return first };
    let url = trimmed(&git(root, &["remote", "get-url", "origin"]));
    if !url.starts_with("https://") {
        return first;
    }
    let Ok(helper) = askpass() else { return first };
    env.insert("GIT_ASKPASS".into(), helper);
    env.insert("SPAR_GITHUB_TOKEN".into(), token);
    let mut all = s(&["-c", "credential.helper="]);
    all.extend(args.iter().cloned());
    git_env(root, &all, &env, None, NET_TIMEOUT)
}

fn explain(o: &Output) -> String {
    let text = err_text(o);
    if is_auth_failure(o) {
        return if github_token().is_none() {
            "GitHub needs you to sign in. Connect your GitHub account, then push again.".into()
        } else {
            "GitHub refused the push. Check that the token has Contents: read and write for this repository.".into()
        };
    }
    if text.contains("non-fast-forward") || text.contains("fetch first") {
        return "The remote has commits you don't have yet. Pull first, then push.".into();
    }
    if text.contains("Not possible to fast-forward") || text.contains("have diverged") {
        return "Your branch and the remote both have new commits. Rebase or merge them in the terminal (git pull --rebase), then push.".into();
    }
    let lines: Vec<&str> = text.split('\n').collect();
    lines[lines.len().saturating_sub(3)..].join("\n")
}

/// Git refuses to commit without a name and email; use the GitHub account's (with its
/// private noreply address) for this repository if none is set.
fn ensure_identity(root: &str, identity: &Option<Identity>) {
    if !trimmed(&git(root, &["config", "user.email"])).is_empty() {
        return;
    }
    if let Some(id) = identity {
        let _ = git(root, &["config", "user.name", &id.name]);
        let _ = git(root, &["config", "user.email", &id.email]);
    }
}

#[derive(Deserialize, Clone)]
struct Identity {
    name: String,
    email: String,
}

// ---- Review.swift ----------------------------------------------------------------------

struct Hunk {
    header: String,
    lines: Vec<String>,
}

fn parse_diff(diff: &str) -> (Vec<String>, Vec<Hunk>) {
    let mut header = Vec::new();
    let mut hunks: Vec<Hunk> = Vec::new();
    let mut current: Option<Hunk> = None;
    for line in diff.split('\n') {
        if line.starts_with("@@") {
            if let Some(c) = current.take() {
                hunks.push(c);
            }
            current = Some(Hunk { header: line.to_string(), lines: Vec::new() });
        } else if let Some(c) = current.as_mut() {
            if line.starts_with('+') || line.starts_with('-') || line.starts_with(' ') || line.starts_with('\\') {
                c.lines.push(line.to_string());
            }
        } else if line.starts_with("diff --git") || line.starts_with("---") || line.starts_with("+++") || line.starts_with("new file") || line.starts_with("deleted file") || line.starts_with("index ") {
            header.push(line.to_string());
        }
    }
    if let Some(c) = current {
        hunks.push(c);
    }
    (header, hunks)
}

fn file_json(path: &str, status: &str, untracked: bool, diff: &str, staged: bool, checkpoint: Option<&str>) -> Value {
    let (header, hunks) = parse_diff(diff);
    let hunks: Vec<Value> = hunks
        .iter()
        .enumerate()
        .map(|(i, h)| {
            let added = h.lines.iter().filter(|l| l.starts_with('+')).count();
            let removed = h.lines.iter().filter(|l| l.starts_with('-')).count();
            json!({"id": i, "header": h.header, "lines": h.lines, "added": added, "removed": removed})
        })
        .collect();
    let added: u64 = hunks.iter().map(|h| h["added"].as_u64().unwrap_or(0)).sum();
    let removed: u64 = hunks.iter().map(|h| h["removed"].as_u64().unwrap_or(0)).sum();
    json!({"path": path, "status": status, "untracked": untracked, "header": header, "hunks": hunks, "staged": staged,
           "checkpoint": checkpoint, "added": added, "removed": removed})
}

fn review_load(root: &str) -> Value {
    let Some(list) = changes(root) else { return Value::Null };
    let staged = staged_set(root);
    let mut out = Vec::new();
    for (path, status) in list.iter().take(150) {
        let untracked = is_untracked(root, path);
        let diff = if untracked {
            let text = std::fs::read_to_string(Path::new(root).join(path)).unwrap_or_default();
            let body = text.strip_suffix('\n').unwrap_or(&text);
            let lines: Vec<String> = if body.is_empty() && text.is_empty() { Vec::new() } else { body.split('\n').map(|l| format!("+{l}")).collect() };
            format!("diff --git a/{path} b/{path}\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{} @@\n{}", lines.len(), lines.join("\n"))
        } else {
            git(root, &["diff", "HEAD", "--no-color", "-U3", "--", path]).stdout
        };
        out.push(file_json(path, status, untracked, &diff, staged.contains(path), None));
    }
    json!(out)
}

#[derive(Deserialize)]
struct FileArg {
    path: String,
    #[serde(default)]
    untracked: bool,
    #[serde(default)]
    staged: bool,
    #[serde(default)]
    header: Vec<String>,
}

#[derive(Deserialize)]
struct HunkArg {
    header: String,
    lines: Vec<String>,
}

fn patch(file: &FileArg, hunk: &HunkArg) -> String {
    let mut all: Vec<String> = file
        .header
        .iter()
        .filter(|l| l.starts_with("diff --git") || l.starts_with("---") || l.starts_with("+++") || l.starts_with("new file") || l.starts_with("deleted file"))
        .cloned()
        .collect();
    all.push(hunk.header.clone());
    all.extend(hunk.lines.iter().cloned());
    all.join("\n") + "\n"
}

fn review_accept(root: &str, file: &FileArg, hunk: Option<&HunkArg>) -> Output {
    match hunk {
        Some(h) if !file.untracked => git_env(root, &s(&["apply", "--cached", "--recount", "-"]), &BTreeMap::new(), Some(&patch(file, h)), LOCAL_TIMEOUT),
        _ => git(root, &["add", "--", &file.path]),
    }
}

fn reject_whole(root: &str, file: &FileArg) -> Output {
    if file.untracked {
        return match trash(&Path::new(root).join(&file.path)) {
            Ok(()) => Output { status: 0, stdout: String::new(), stderr: String::new() },
            Err(e) => Output { status: 1, stdout: String::new(), stderr: e },
        };
    }
    git(root, &["checkout", "HEAD", "--", &file.path])
}

fn review_reject(root: &str, file: &FileArg, hunk: Option<&HunkArg>) -> Output {
    match hunk {
        Some(h) if !file.untracked => {
            let p = patch(file, h);
            let out = git_env(root, &s(&["apply", "-R", "--recount", "-"]), &BTreeMap::new(), Some(&p), LOCAL_TIMEOUT);
            if file.staged {
                let _ = git_env(root, &s(&["apply", "-R", "--cached", "--recount", "-"]), &BTreeMap::new(), Some(&p), LOCAL_TIMEOUT);
            }
            out
        }
        _ => reject_whole(root, file),
    }
}

// ---- Checkpoints.swift ---------------------------------------------------------------
// Snapshots in a shadow git repository under the app's data folder that uses the project
// as its work tree; the project's own .git is never touched.

fn cp_dir(root: &str) -> PathBuf {
    use sha2::{Digest, Sha256};
    let key: String = Sha256::digest(root.as_bytes()).iter().take(8).map(|b| format!("{b:02x}")).collect();
    data_dir().join("checkpoints").join(format!("{key}.git"))
}

fn cp_env(root: &str) -> BTreeMap<String, String> {
    let mut e = BTreeMap::new();
    e.insert("GIT_DIR".into(), to_shell_path(&cp_dir(root).to_string_lossy()));
    e.insert("GIT_WORK_TREE".into(), to_shell_path(root));
    for (k, v) in [("GIT_AUTHOR_NAME", "SPAR"), ("GIT_AUTHOR_EMAIL", "checkpoints@spar.local"), ("GIT_COMMITTER_NAME", "SPAR"), ("GIT_COMMITTER_EMAIL", "checkpoints@spar.local")] {
        e.insert(k.into(), v.into());
    }
    e
}

fn cp_git(root: &str, args: &[&str]) -> Output {
    git_env(root, &s(args), &cp_env(root), None, Duration::from_secs(300))
}

fn cp_ensure(root: &str) -> bool {
    let dir = cp_dir(root);
    if dir.join("HEAD").exists() {
        return true;
    }
    let _ = std::fs::create_dir_all(dir.parent().unwrap());
    if !ok(&git(root, &["init", "-q", "--bare", &to_shell_path(&dir.to_string_lossy())])) {
        return false;
    }
    let _ = cp_git(root, &["config", "core.bare", "false"]);
    let exclude = [".git", ".DS_Store", "node_modules/", ".build/", "target/", "dist/", ".next/", ".venv/", "venv/", "__pycache__/", ".codegraph/", "mtime-test-*"].join("\n");
    let _ = std::fs::create_dir_all(dir.join("info"));
    let _ = std::fs::write(dir.join("info/exclude"), exclude);
    true
}

fn cp_create(root: &str, label: &str) -> Option<String> {
    if !cp_ensure(root) {
        return None;
    }
    let _ = cp_git(root, &["add", "-A", "."]);
    let label: String = label.chars().take(200).collect();
    let _ = cp_git(root, &["commit", "-q", "--allow-empty", "--no-verify", "-m", &label]);
    let head = cp_git(root, &["rev-parse", "HEAD"]);
    ok(&head).then(|| trimmed(&head))
}

fn cp_restore(root: &str, id: &str) -> Value {
    let short: String = id.chars().take(8).collect();
    let undo = cp_create(root, &format!("Before restoring {short}"));
    let out = cp_git(root, &["read-tree", "-u", "--reset", id]);
    json!({"ok": ok(&out), "undo": undo, "message": if ok(&out) { "Files restored.".to_string() } else { out.stderr.trim().to_string() }})
}

fn cp_changes(root: &str, id: &str) -> Vec<(String, String)> {
    let _ = cp_git(root, &["add", "-A", "."]);
    cp_git(root, &["diff", "--cached", "--name-status", "--no-renames", id])
        .stdout
        .split('\n')
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let code = parts.next()?;
            let path = parts.next()?;
            let status = if code.starts_with('A') { "created" } else if code.starts_with('D') { "deleted" } else { "modified" };
            Some((path.to_string(), status.to_string()))
        })
        .collect()
}

fn cp_diff(root: &str, id: &str, path: &str) -> String {
    cp_git(root, &["diff", "--cached", "--no-color", "-U3", id, "--", path]).stdout
}

fn cp_restore_file(root: &str, id: &str, path: &str) -> bool {
    if ok(&cp_git(root, &["cat-file", "-e", &format!("{id}:{path}")])) {
        return ok(&cp_git(root, &["checkout", id, "--", path]));
    }
    trash(&Path::new(root).join(path)).is_ok()
}

fn cp_changed_files(root: &str, id: &str) -> Vec<String> {
    let _ = cp_git(root, &["add", "-A", "."]);
    cp_git(root, &["diff", "--cached", "--name-only", id]).stdout.split('\n').filter(|l| !l.is_empty()).map(String::from).collect()
}

fn review_since(root: &str, id: &str) -> Value {
    let list: Vec<Value> = cp_changes(root, id)
        .iter()
        .take(150)
        .map(|(path, status)| file_json(path, status, status == "created", &cp_diff(root, id, path), false, Some(id)))
        .collect();
    json!(list)
}

// ---- GitHub.swift ----------------------------------------------------------------------

fn github_api(method: &str, path: &str, body: Option<&Value>, token: Option<String>) -> Result<Value, String> {
    let token = token.or_else(github_token).ok_or("Connect GitHub first.")?;
    let req = ureq::request(method, &format!("https://api.github.com{path}"))
        .timeout(Duration::from_secs(30))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .set("User-Agent", "SPAR-desktop");
    let res = match body {
        Some(b) => req.set("Content-Type", "application/json").send_string(&b.to_string()),
        None => req.call(),
    };
    let (status, text) = match res {
        Ok(r) => (r.status(), r.into_string().unwrap_or_default()),
        Err(ureq::Error::Status(code, r)) => (code, r.into_string().unwrap_or_default()),
        Err(e) => return Err(e.to_string()),
    };
    Ok(json!({"status": status, "body": serde_json::from_str::<Value>(&text).unwrap_or(Value::Null)}))
}

/// Verifies a token and stores it; returns the account it belongs to.
fn github_connect(token: &str) -> Result<Value, String> {
    let token = token.trim();
    let r = github_api("GET", "/user", None, Some(token.to_string()))?;
    let status = r["status"].as_u64().unwrap_or(0);
    let b = &r["body"];
    if status != 200 || b["login"].as_str().is_none() || b["id"].as_i64().is_none() {
        return Err(if status == 401 { "GitHub rejected this token.".into() } else { format!("Could not verify the token (HTTP {status}).") });
    }
    crate::secrets::set("github-token", Some(token))?;
    let user = json!({"login": b["login"], "name": b["name"], "id": b["id"]});
    emit("github:account", json!({"user": user}));
    Ok(user)
}

// The browser sign-in: the GitHub CLI's web login in SPAR's own config folder, so the
// person's own `gh` setup is left alone. Progress arrives as `github:login` events:
// {phase: "preparing" | "waiting" {code, url} | "finishing" | "done" {user} | "failed" {message}}.

static LOGIN: Mutex<Option<(u64, std::sync::Arc<Mutex<std::process::Child>>)>> = Mutex::new(None);
static LOGIN_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn gh_config_dir() -> PathBuf {
    data_dir().join("gh")
}

fn find_code(text: &str) -> Option<String> {
    let b = text.as_bytes();
    let ok_char = |c: u8| c.is_ascii_uppercase() || c.is_ascii_digit();
    if b.len() < 9 {
        return None;
    }
    (0..=b.len() - 9).find_map(|i| {
        let w = &b[i..i + 9];
        (w[..4].iter().all(|&c| ok_char(c)) && w[4] == b'-' && w[5..].iter().all(|&c| ok_char(c))).then(|| String::from_utf8_lossy(w).to_string())
    })
}

fn login_start() -> Result<(), String> {
    login_cancel();
    emit("github:login", json!({"phase": "preparing"}));
    if exec::which("gh").is_none() {
        let msg = "The GitHub CLI (gh) isn't installed. Install it (brew install gh), or use a personal access token.";
        emit("github:login", json!({"phase": "failed", "message": msg}));
        return Ok(());
    }
    let dir = gh_config_dir();
    let _ = std::fs::create_dir_all(&dir);
    let mut env = BTreeMap::new();
    env.insert("GH_CONFIG_DIR".to_string(), to_shell_path(&dir.to_string_lossy()));
    env.insert("BROWSER".into(), "true".into()); // the app opens the page itself
    env.insert("GH_PROMPT_DISABLED".into(), "1".into());
    let args = s(&["auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https", "--scopes", "repo,workflow,read:org"]);
    let mut c = exec::command("gh", &args, None, &env)?;
    use std::process::Stdio;
    c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match c.spawn() {
        Ok(ch) => ch,
        Err(e) => {
            emit("github:login", json!({"phase": "failed", "message": e.to_string()}));
            return Ok(());
        }
    };
    let seq = LOGIN_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let shown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let pipes: Vec<Box<dyn std::io::Read + Send>> = [child.stdout.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>)]
        .into_iter()
        .flatten()
        .collect();
    for mut p in pipes {
        let shown = shown.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut acc = String::new();
            while let Ok(n) = p.read(&mut buf) {
                if n == 0 {
                    break;
                }
                acc.push_str(&String::from_utf8_lossy(&buf[..n]));
                if let Some(code) = find_code(&acc) {
                    if !shown.swap(true, std::sync::atomic::Ordering::SeqCst) {
                        emit("github:login", json!({"phase": "waiting", "code": code, "url": "https://github.com/login/device"}));
                    }
                }
            }
        });
    }
    use std::io::Read as _;
    let child = std::sync::Arc::new(Mutex::new(child));
    *LOGIN.lock().unwrap() = Some((seq, child.clone()));
    std::thread::spawn(move || {
        let status = loop {
            let done = child.lock().unwrap().try_wait().ok().flatten();
            if let Some(st) = done {
                break st.success();
            }
            std::thread::sleep(Duration::from_millis(200));
        };
        // Cancelled (or replaced by a newer attempt): say nothing.
        let current = LOGIN.lock().unwrap().as_ref().map(|(n, _)| *n) == Some(seq);
        if !current {
            return;
        }
        *LOGIN.lock().unwrap() = None;
        if !status {
            emit("github:login", json!({"phase": "failed", "message": "GitHub sign-in didn't complete. Try again, or use a token."}));
            return;
        }
        emit("github:login", json!({"phase": "finishing"}));
        let mut env = BTreeMap::new();
        env.insert("GH_CONFIG_DIR".to_string(), to_shell_path(&gh_config_dir().to_string_lossy()));
        // The app-wide GH_TOKEN would win over the fresh login: clear it for this call.
        env.insert("GH_TOKEN".into(), String::new());
        env.insert("GITHUB_TOKEN".into(), String::new());
        let r = exec::run("gh", &s(&["auth", "token", "--hostname", "github.com"]), None, &env, None, Some(Duration::from_secs(30)));
        match github_connect(r.stdout.trim()) {
            Ok(user) => emit("github:login", json!({"phase": "done", "user": user})),
            Err(e) => emit("github:login", json!({"phase": "failed", "message": e})),
        }
    });
    Ok(())
}

fn login_cancel() {
    if let Some((_, child)) = LOGIN.lock().unwrap().take() {
        let _ = child.lock().unwrap().kill();
    }
}

/// A token from a `gh` login the person already has, if any.
fn existing_token() -> Option<String> {
    exec::which("gh")?;
    let mut env = BTreeMap::new();
    env.insert("GH_TOKEN".to_string(), String::new());
    env.insert("GITHUB_TOKEN".to_string(), String::new());
    let r = exec::run("gh", &s(&["auth", "token", "--hostname", "github.com"]), None, &env, None, Some(Duration::from_secs(15)));
    let t = r.stdout.trim().to_string();
    (r.status == 0 && !t.is_empty()).then_some(t)
}

// ---- Commands ---------------------------------------------------------------------------

pub fn register(r: &mut Registry) {
    #[derive(Deserialize)]
    struct Root {
        root: String,
    }
    #[derive(Deserialize)]
    struct RootPath {
        root: String,
        path: String,
    }
    #[derive(Deserialize)]
    struct RootArgs {
        root: String,
        args: Vec<String>,
    }
    #[derive(Deserialize)]
    struct Commit {
        root: String,
        message: String,
        identity: Option<Identity>,
    }
    #[derive(Deserialize)]
    struct Init {
        root: String,
        identity: Option<Identity>,
    }
    #[derive(Deserialize)]
    struct ReviewAct {
        root: String,
        file: FileArg,
        hunk: Option<HunkArg>,
    }
    #[derive(Deserialize)]
    struct Label {
        root: String,
        label: String,
    }
    #[derive(Deserialize)]
    struct Id {
        root: String,
        id: String,
    }
    #[derive(Deserialize)]
    struct IdPath {
        root: String,
        id: String,
        path: String,
    }
    #[derive(Deserialize)]
    struct Log {
        root: String,
        limit: Option<u32>,
    }
    #[derive(Deserialize)]
    struct Api {
        method: String,
        path: String,
        body: Option<Value>,
    }
    #[derive(Deserialize)]
    struct Token {
        token: String,
    }

    r.add("scm_status", |a| {
        let a: Root = parse(a)?;
        Ok(status(&a.root))
    });
    r.add("scm_changes", |a| {
        let a: Root = parse(a)?;
        Ok(changes(&a.root).map(|l| changes_json(&l)).unwrap_or(Value::Null))
    });
    r.add("scm_versions", |a| {
        let a: RootPath = parse(a)?;
        Ok(versions(&a.root, &a.path))
    });
    // Local git (no network, no auth): {root, args} → {ok, status, stdout, stderr}
    r.add("scm_git", |a| {
        let a: RootArgs = parse(a)?;
        Ok(out_json(&git_env(&a.root, &a.args, &BTreeMap::new(), None, LOCAL_TIMEOUT)))
    });
    // Network git with the credential fallback; `error` is the explained failure.
    r.add("scm_remote", |a| {
        let a: RootArgs = parse(a)?;
        let o = remote(&a.root, &a.args);
        let mut v = out_json(&o);
        if !ok(&o) {
            v["error"] = json!(explain(&o));
        }
        Ok(v)
    });
    r.add("scm_init", |a| {
        let a: Init = parse(a)?;
        let _ = a.identity;
        let o = git(&a.root, &["init", "-b", "main"]);
        Ok(json!({"ok": ok(&o), "error": if ok(&o) { Value::Null } else { json!(o.stderr.trim()) }}))
    });
    // Commits staged changes, or everything when nothing is staged.
    r.add("scm_commit", |a| {
        let a: Commit = parse(a)?;
        ensure_identity(&a.root, &a.identity);
        if ok(&git(&a.root, &["diff", "--cached", "--quiet"])) {
            let _ = git(&a.root, &["add", "-A"]);
        }
        let o = git(&a.root, &["commit", "-m", &a.message]);
        Ok(json!({"ok": ok(&o), "info": o.stdout.split('\n').next().unwrap_or(""), "error": if ok(&o) { Value::Null } else { json!(err_text(&o)) }}))
    });
    // First commit before publishing a repository that has none.
    r.add("scm_initial_commit", |a| {
        let a: Init = parse(a)?;
        if ok(&git(&a.root, &["rev-parse", "HEAD"])) {
            return Ok(json!({"ok": true}));
        }
        ensure_identity(&a.root, &a.identity);
        let _ = git(&a.root, &["add", "-A"]);
        let o = git(&a.root, &["commit", "-m", "Initial commit"]);
        Ok(json!({"ok": ok(&o), "error": if ok(&o) { Value::Null } else { json!(o.stderr.trim()) }}))
    });
    r.add("scm_stage", |a| {
        let a: RootPath = parse(a)?;
        Ok(out_json(&git(&a.root, &["add", "--", &a.path])))
    });
    r.add("scm_unstage", |a| {
        let a: RootPath = parse(a)?;
        Ok(out_json(&git(&a.root, &["restore", "--staged", "--", &a.path])))
    });
    // Discard one file: untracked files go to the Trash, tracked ones back to HEAD.
    r.add("scm_discard", |a| {
        let a: RootPath = parse(a)?;
        if is_untracked(&a.root, &a.path) {
            trash(&Path::new(&a.root).join(&a.path))?;
            return Ok(json!({"ok": true}));
        }
        Ok(out_json(&git(&a.root, &["checkout", "HEAD", "--", &a.path])))
    });
    r.add("scm_log", |a| {
        let a: Log = parse(a)?;
        let n = format!("-{}", a.limit.unwrap_or(100));
        let o = git(&a.root, &["log", &n, "--date=iso-strict", "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%D%x1f%s"]);
        let list: Vec<Value> = o
            .stdout
            .split('\n')
            .filter(|l| !l.is_empty())
            .filter_map(|l| {
                let p: Vec<&str> = l.split('\u{1f}').collect();
                (p.len() == 7).then(|| json!({"hash": p[0], "short": p[1], "author": p[2], "email": p[3], "date": p[4], "refs": p[5], "subject": p[6]}))
            })
            .collect();
        Ok(json!(list))
    });
    r.add("scm_show", |a| {
        #[derive(Deserialize)]
        struct Show {
            root: String,
            hash: String,
        }
        let a: Show = parse(a)?;
        let o = git(&a.root, &["show", "--stat", "--patch", "--no-color", "--format=%H%n%an <%ae>%n%ad%n%n%B", &a.hash]);
        Ok(json!(o.stdout))
    });
    r.add("scm_remotes", |a| {
        let a: Root = parse(a)?;
        let o = git(&a.root, &["remote", "-v"]);
        let mut seen = HashSet::new();
        let list: Vec<Value> = o
            .stdout
            .split('\n')
            .filter_map(|l| {
                let mut p = l.split_whitespace();
                let (name, url) = (p.next()?, p.next()?);
                seen.insert(name.to_string()).then(|| json!({"name": name, "url": url}))
            })
            .collect();
        Ok(json!(list))
    });

    r.add("scm_review", |a| {
        let a: Root = parse(a)?;
        Ok(review_load(&a.root))
    });
    r.add("scm_review_since", |a| {
        let a: Id = parse(a)?;
        Ok(review_since(&a.root, &a.id))
    });
    r.add("scm_review_accept", |a| {
        let a: ReviewAct = parse(a)?;
        Ok(out_json(&review_accept(&a.root, &a.file, a.hunk.as_ref())))
    });
    r.add("scm_review_reject", |a| {
        let a: ReviewAct = parse(a)?;
        Ok(out_json(&review_reject(&a.root, &a.file, a.hunk.as_ref())))
    });

    r.add("checkpoint_create", |a| {
        let a: Label = parse(a)?;
        Ok(json!(cp_create(&a.root, &a.label)))
    });
    r.add("checkpoint_restore", |a| {
        let a: Id = parse(a)?;
        Ok(cp_restore(&a.root, &a.id))
    });
    r.add("checkpoint_changes", |a| {
        let a: Id = parse(a)?;
        Ok(changes_json(&cp_changes(&a.root, &a.id)))
    });
    r.add("checkpoint_diff", |a| {
        let a: IdPath = parse(a)?;
        Ok(json!(cp_diff(&a.root, &a.id, &a.path)))
    });
    r.add("checkpoint_restore_file", |a| {
        let a: IdPath = parse(a)?;
        Ok(json!(cp_restore_file(&a.root, &a.id, &a.path)))
    });
    r.add("checkpoint_changed_files", |a| {
        let a: Id = parse(a)?;
        Ok(json!(cp_changed_files(&a.root, &a.id)))
    });
    // The file as it was at a checkpoint (null if it didn't exist then).
    r.add("checkpoint_file", |a| {
        let a: IdPath = parse(a)?;
        let o = cp_git(&a.root, &["show", &format!("{}:{}", a.id, a.path)]);
        Ok(if ok(&o) { json!(o.stdout) } else { Value::Null })
    });

    // GitHub REST with the stored token: {method, path, body?} → {status, body}
    r.add("github_api", |a| {
        let a: Api = parse(a)?;
        github_api(&a.method, &a.path, a.body.as_ref(), None)
    });
    r.add("github_connect", |a| {
        let a: Token = parse(a)?;
        github_connect(&a.token)
    });
    r.add("github_disconnect", |_| {
        crate::secrets::set("github-token", None)?;
        emit("github:account", json!({"user": null}));
        Ok(Value::Null)
    });
    r.add("github_has_token", |_| Ok(json!(github_token().is_some())));
    r.add("github_existing_token", |_| Ok(json!(existing_token().is_some())));
    r.add("github_use_existing", |_| {
        let t = existing_token().ok_or("You're not signed in to the GitHub CLI.")?;
        github_connect(&t)
    });
    r.add("github_login_start", |_| {
        login_start()?;
        Ok(Value::Null)
    });
    r.add("github_login_cancel", |_| {
        login_cancel();
        Ok(Value::Null)
    });
}

/// Called when the app exits.
pub fn shutdown() {
    login_cancel();
}
