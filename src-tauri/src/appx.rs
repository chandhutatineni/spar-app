//! App-level things: the native menu (its clicks reach the focused window as a `menu`
//! event {id}), windows, opening files/URLs, and app info.

use crate::events;
use crate::registry::{data_dir, home, parse, resource_dir, Registry};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use tauri::menu::{MenuBuilder, MenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_opener::OpenerExt;

static RECENT: OnceLock<Mutex<Submenu<Wry>>> = OnceLock::new();

fn item(app: &AppHandle, id: &str, text: &str, accel: Option<&str>) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, id, text, true, accel).or_else(|_| MenuItem::with_id(app, id, text, true, None::<&str>))
}

/// The same commands and shortcuts as the Mac app's menus.
pub fn build_menu(app: &AppHandle) -> tauri::Result<()> {
    let i = |id: &str, text: &str, accel: Option<&str>| item(app, id, text, accel);
    let recent = SubmenuBuilder::new(app, "Open Recent").build()?;
    let _ = RECENT.set(Mutex::new(recent.clone()));

    let app_menu = SubmenuBuilder::new(app, "SPAR")
        .about(None)
        .separator()
        .item(&i("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&i("new-window", "New Window", Some("CmdOrCtrl+Shift+N"))?)
        .item(&i("open-project", "Open Project…", Some("CmdOrCtrl+O"))?)
        .item(&recent)
        .item(&i("close-project", "Close Project", Some("CmdOrCtrl+Shift+W"))?)
        .separator()
        .item(&i("save", "Save", Some("CmdOrCtrl+S"))?)
        .separator()
        .item(&i("quick-open", "Go to File…", Some("CmdOrCtrl+P"))?)
        .item(&i("command-palette", "Command Palette…", Some("CmdOrCtrl+Shift+P"))?)
        .item(&i("find-in-files", "Find in Files", Some("CmdOrCtrl+Shift+F"))?)
        .separator()
        .close_window()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit").undo().redo().separator().cut().copy().paste().select_all().build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&i("sidebar-work", "SPAR Loop", Some("CmdOrCtrl+1"))?)
        .item(&i("sidebar-files", "Explorer", Some("CmdOrCtrl+2"))?)
        .item(&i("sidebar-search", "Search", Some("CmdOrCtrl+3"))?)
        .item(&i("sidebar-git", "Source Control Sidebar", Some("CmdOrCtrl+4"))?)
        .item(&i("reveal-in-explorer", "Reveal in Explorer", Some("CmdOrCtrl+Shift+E"))?)
        .separator()
        .item(&i("toggle-terminal", "Toggle Terminal", Some("Ctrl+`"))?)
        .item(&i("source-control", "Source Control", Some("Ctrl+Shift+G"))?)
        .item(&i("welcome", "Welcome", None)?)
        .item(&i("toggle-agent", "Show or Hide the Agent", Some("CmdOrCtrl+Alt+I"))?)
        .separator()
        .item(
            &SubmenuBuilder::new(app, "Appearance")
                .item(&i("appearance-light", "Light", None)?)
                .item(&i("appearance-dark", "Dark", None)?)
                .item(&i("appearance-system", "Match System", None)?)
                .build()?,
        )
        .separator()
        .fullscreen()
        .build()?;
    let run = SubmenuBuilder::new(app, "Run")
        .item(&i("run-run", "Run", Some("CmdOrCtrl+R"))?)
        .item(&i("run-test", "Test", Some("CmdOrCtrl+U"))?)
        .item(&i("run-build", "Build", Some("CmdOrCtrl+Shift+B"))?)
        .item(&i("run-stop", "Stop Running Task", Some("CmdOrCtrl+Shift+C"))?)
        .build()?;
    let agent = SubmenuBuilder::new(app, "Agent")
        .item(&i("agent-continue", "Continue", Some("CmdOrCtrl+Enter"))?)
        .item(&i("agent-stop", "Stop", Some("CmdOrCtrl+."))?)
        .separator()
        .item(&i("agent-watch", "Watch in Terminal", None)?)
        .item(&i("agent-new-chat", "New Chat", Some("CmdOrCtrl+Alt+N"))?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window").minimize().separator().close_window().build()?;
    let mut menu = MenuBuilder::new(app);
    if cfg!(target_os = "macos") {
        menu = menu.item(&app_menu);
    }
    let menu = menu.item(&file).item(&edit).item(&view).item(&run).item(&agent).item(&window).build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref().to_string();
        match id.as_str() {
            "new-window" => {
                let _ = new_window(app, None);
            }
            "settings" => {
                let _ = open_settings(app);
            }
            _ => send_to_focused(app, &id),
        }
    });
    Ok(())
}

fn send_to_focused(app: &AppHandle, id: &str) {
    let payload = json!({"id": id});
    let focused = app.webview_windows().into_values().find(|w| w.is_focused().unwrap_or(false));
    match focused {
        Some(w) => {
            let _ = app.emit_to(EventTarget::webview_window(w.label()), "menu", payload.clone());
        }
        None => {
            if let Some(w) = app.webview_windows().into_values().next() {
                let _ = app.emit_to(EventTarget::webview_window(w.label()), "menu", payload.clone());
            }
        }
    }
    // The development bridge's browser page acts on menu commands too.
    events::emit("menu:bridge", payload);
}

pub fn new_window(app: &AppHandle, project: Option<&str>) -> tauri::Result<()> {
    let n = app.webview_windows().len();
    let label = format!("main-{}-{}", n, std::process::id() % 1000 + n as u32);
    let url = match project {
        Some(p) => format!("index.html#project={}", urlencode(p)),
        None => "index.html".into(),
    };
    let b = WebviewWindowBuilder::new(app, if n == 0 { "main".to_string() } else { label }, WebviewUrl::App(url.into()))
        .title("SPAR")
        .inner_size(1360.0, 860.0)
        .min_inner_size(960.0, 620.0);
    // A unified toolbar like the Mac app: the traffic lights sit in the app's own toolbar.
    #[cfg(target_os = "macos")]
    let b = b.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    b.build()?;
    Ok(())
}

pub fn open_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html#settings".into()))
        .title("Settings")
        // The Mac app's Settings scene: a grouped Form, .frame(width: 480).
        .inner_size(480.0, 760.0)
        .min_inner_size(480.0, 400.0)
        .build()?;
    Ok(())
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub fn register(r: &mut Registry) {
    #[derive(Deserialize)]
    struct Target {
        target: String,
    }
    #[derive(Deserialize)]
    struct Proj {
        project: Option<String>,
    }
    #[derive(Deserialize)]
    struct Paths {
        paths: Vec<String>,
    }
    #[derive(Deserialize)]
    struct Cmd {
        command: String,
    }
    // {platform, home, data_dir, resource_dir, version, bridge, env: {SPAR_*}}
    r.add("app_info", |_| {
        let env: serde_json::Map<String, Value> = std::env::vars().filter(|(k, _)| k.starts_with("SPAR_")).map(|(k, v)| (k, json!(v))).collect();
        Ok(json!({
            "platform": std::env::consts::OS,
            "home": home(),
            "data_dir": data_dir(),
            "resource_dir": resource_dir(),
            "version": env!("CARGO_PKG_VERSION"),
            "bridge": std::env::var("SPAR_DEV_BRIDGE").is_ok(),
            "env": env,
        }))
    });
    // A file, folder or URL in its default app.
    r.add("app_open", |a| {
        let a: Target = parse(a)?;
        let app = events::app().ok_or("no app")?;
        if a.target.starts_with("http://") || a.target.starts_with("https://") || a.target.starts_with("mailto:") {
            app.opener().open_url(&a.target, None::<&str>).map_err(|e| e.to_string())?;
        } else {
            app.opener().open_path(&a.target, None::<&str>).map_err(|e| e.to_string())?;
        }
        Ok(Value::Null)
    });
    r.add("app_reveal", |a| {
        let a: Target = parse(a)?;
        let app = events::app().ok_or("no app")?;
        app.opener().reveal_item_in_dir(&a.target).map_err(|e| e.to_string())?;
        Ok(Value::Null)
    });
    r.add("app_new_window", |a| {
        let a: Proj = parse(a)?;
        let app = events::app().ok_or("no app")?;
        new_window(app, a.project.as_deref()).map_err(|e| e.to_string())?;
        Ok(Value::Null)
    });
    r.add("app_settings", |_| {
        let app = events::app().ok_or("no app")?;
        open_settings(app).map_err(|e| e.to_string())?;
        Ok(Value::Null)
    });
    // File ▸ Open Recent (menu ids `recent:<path>`)
    r.add("app_set_recents", |a| {
        let a: Paths = parse(a)?;
        let app = events::app().ok_or("no app")?;
        if let Some(sub) = RECENT.get() {
            let sub = sub.lock().unwrap();
            while let Ok(Some(_)) = sub.remove_at(0) {}
            for p in a.paths.iter().take(10) {
                let name = std::path::Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(p.clone());
                if let Ok(it) = MenuItem::with_id(app, format!("recent:{p}"), name, true, None::<&str>) {
                    let _ = sub.append(&it);
                }
            }
        }
        Ok(Value::Null)
    });
    // Runs a command in the system terminal (Watch in Terminal).
    r.add("app_run_in_terminal", |a| {
        let a: Cmd = parse(a)?;
        if cfg!(target_os = "macos") {
            let esc = a.command.replace('\\', "\\\\").replace('"', "\\\"");
            let script = format!("tell application \"Terminal\" to do script \"{esc}\"\nactivate application \"Terminal\"");
            std::process::Command::new("osascript").args(["-e", &script]).spawn().map_err(|e| e.to_string())?;
        } else if cfg!(windows) {
            std::process::Command::new("cmd").args(["/c", "start", "wsl.exe", "-e", "bash", "-lc", &a.command]).spawn().map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("x-terminal-emulator").args(["-e", "bash", "-lc", &a.command]).spawn().map_err(|e| e.to_string())?;
        }
        Ok(Value::Null)
    });
    // SPAR_PROJECT is a development aid for the first window of a launch only (like the Mac
    // app); later windows reopen the last project. Returns it once, then null.
    r.add("app_launch_project", |_| {
        static TAKEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if TAKEN.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return Ok(Value::Null);
        }
        Ok(json!(std::env::var("SPAR_PROJECT").ok().filter(|p| !p.is_empty())))
    });
    // How many project windows are open (Settings doesn't count).
    r.add("app_window_count", |_| {
        let app = events::app().ok_or("no app")?;
        Ok(json!(app.webview_windows().keys().filter(|l| l.as_str() != "settings").count()))
    });
    r.add("app_quit", |_| {
        if let Some(app) = events::app() {
            app.exit(0);
        }
        Ok(Value::Null)
    });
}
