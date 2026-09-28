//! Development bridge: the backend over HTTP on 127.0.0.1:47900, so the UI can run in a
//! normal browser (and be driven by Playwright) against the real backend.
//! Only started when SPAR_DEV_BRIDGE=1. Never in a release build's default path.
//!
//!   POST /call/<command>   body: JSON args   →  {"ok":true,"value":…} | {"ok":false,"error":"…"}
//!   GET  /events?after=N   long-poll         →  {"last":N,"events":[{"topic","payload"}]}

use crate::{events, registry};
use serde_json::{json, Value};
use std::time::Duration;
use tiny_http::{Header, Method, Response, Server};

pub const PORT: u16 = 47900;

pub fn start() {
    events::enable_bridge_log();
    let server = match Server::http(("127.0.0.1", PORT)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("SPAR dev bridge: cannot listen on {PORT}: {e}");
            return;
        }
    };
    eprintln!("SPAR dev bridge on http://127.0.0.1:{PORT}");
    std::thread::spawn(move || {
        for mut req in server.incoming_requests() {
            std::thread::spawn(move || {
                let cors = [
                    Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
                    Header::from_bytes("Access-Control-Allow-Headers", "content-type").unwrap(),
                    Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
                    Header::from_bytes("Content-Type", "application/json").unwrap(),
                ];
                let url = req.url().to_string();
                let body: Value = if *req.method() == Method::Options {
                    json!(null)
                } else if let Some(cmd) = url.strip_prefix("/call/") {
                    let mut raw = String::new();
                    let _ = req.as_reader().read_to_string(&mut raw);
                    let args: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
                    match registry::dispatch(cmd, args) {
                        Ok(v) => json!({"ok": true, "value": v}),
                        Err(e) => json!({"ok": false, "error": e}),
                    }
                } else if url.starts_with("/events") {
                    let after = url.split("after=").nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
                    events::poll(after, Duration::from_secs(25))
                } else if url == "/commands" {
                    json!(registry::names())
                } else {
                    json!({"ok": false, "error": "not found"})
                };
                let mut resp = Response::from_string(body.to_string());
                for h in cors {
                    resp.add_header(h);
                }
                let _ = req.respond(resp);
            });
        }
    });
}
