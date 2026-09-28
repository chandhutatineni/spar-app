mod appx;
mod bridge;
mod docs;
mod editor;
mod engine;
mod events;
mod exec;
mod fsx;
mod mcp;
mod platform;
mod preview;
mod pty;
mod registry;
mod scm;
mod secrets;
mod setup;
mod spar;
mod symbols;

use serde_json::Value;
use tauri::Manager;

/// The one Tauri command: every backend command is reached by name (see registry.rs).
#[tauri::command]
async fn call(cmd: String, args: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || registry::dispatch(&cmd, args))
        .await
        .map_err(|e| e.to_string())?
}

fn registry() -> registry::Registry {
    let mut r = registry::Registry::default();
    appx::register(&mut r);
    engine::register(&mut r);
    exec::register(&mut r);
    fsx::register(&mut r);
    secrets::register(&mut r);
    setup::register(&mut r);
    spar::register(&mut r);
    pty::register(&mut r);
    preview::register(&mut r);
    docs::register(&mut r);
    scm::register(&mut r);
    mcp::register(&mut r);
    symbols::register(&mut r);
    editor::register(&mut r);
    r
}

fn shutdown() {
    pty::shutdown();
    docs::shutdown();
    scm::shutdown();
    mcp::shutdown();
    exec::kill_all();
    engine::stop();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = app.path().app_data_dir().expect("app data dir");
            let resources = app.path().resource_dir().map(|d| d.join("resources")).unwrap_or_else(|_| "resources".into());
            registry::set_paths(data, resources);
            events::set_app(app.handle().clone());
            registry::install(registry());
            if std::env::var("SPAR_DEV_BRIDGE").is_ok() {
                bridge::start();
            }
            appx::build_menu(app.handle())?;
            // SPAR_DEV_BRIDGE_ONLY: no window; the UI runs in a browser against the bridge.
            if std::env::var("SPAR_DEV_BRIDGE_ONLY").is_err() {
                appx::new_window(app.handle(), None)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![call])
        .build(tauri::generate_context!())
        .expect("error while building the SPAR app")
        .run(|_app, event| match event {
            tauri::RunEvent::Exit => shutdown(),
            // Keep running (and the engine up) when the last window closes, like the Mac app;
            // the bridge-only mode never has a window.
            tauri::RunEvent::ExitRequested { api, code, .. } if code.is_none() => {
                if std::env::var("SPAR_DEV_BRIDGE_ONLY").is_ok() || cfg!(target_os = "macos") {
                    api.prevent_exit();
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { has_visible_windows: false, .. } => {
                if std::env::var("SPAR_DEV_BRIDGE_ONLY").is_err() {
                    let _ = appx::new_window(_app, None);
                }
            }
            _ => {}
        });
}
