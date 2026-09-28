//! Running tools the way the person's own terminal would.
//!
//! macOS and Linux: through the login shell, so the PATH matches their terminal (a GUI app
//! inherits a bare one). Windows: inside WSL2, where the agent engine and its terminal-driven
//! agents run (the engine's native Claude Code terminal needs a POSIX tty and tmux).

use std::process::{Command, Output, Stdio};

pub fn is_windows() -> bool {
    cfg!(target_os = "windows")
}

/// A command line run in the person's shell (or in WSL on Windows). ~/.local/bin is added
/// so tools installed by setup are found before the profile picks them up.
pub fn shell(script: &str) -> Command {
    // ~/.local/bin (uv tools) and, inside WSL, SPAR's runtime (tmux, git, … it installed).
    let script = &format!("export PATH=\"$HOME/.local/bin:$PATH:$HOME/.spar-desktop/runtime/env/bin:$HOME/.spar-desktop/runtime/bin\"; {script}");
    if is_windows() {
        let mut c = Command::new("wsl.exe");
        c.args(["-e", "bash", "-lc", script]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashes
        }
        c
    } else {
        let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut c = Command::new(sh);
        c.args(["-lc", script]);
        c
    }
}

pub fn run(script: &str) -> std::io::Result<Output> {
    shell(script).stdin(Stdio::null()).output()
}

/// Whether a tool is on the (WSL) PATH.
pub fn has(tool: &str) -> bool {
    run(&format!("command -v {} >/dev/null 2>&1", sh_quote(tool)))
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// A project folder as the shell sees it: unchanged on macOS/Linux, `/mnt/c/...` in WSL.
pub fn to_shell_path(path: &str) -> String {
    if !is_windows() {
        return path.to_string();
    }
    run(&format!("wslpath -a {}", sh_quote(&path.replace('\\', "/"))))
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| path.to_string())
}

pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// WSL on Windows: installed, with a Linux distribution ready?
pub fn wsl_ready() -> bool {
    if !is_windows() {
        return true;
    }
    Command::new("wsl.exe")
        .args(["-e", "true"])
        .stdin(Stdio::null())
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
