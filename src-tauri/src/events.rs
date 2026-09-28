//! Backend → UI events. Delivered to every app window as Tauri events and, when the
//! development bridge runs, kept in a short log the browser long-polls.
//!
//! Topics use `area:name` (e.g. `pty:data`, `fs:change`, `engine:event`). Payloads carry
//! the ids (terminal id, stream key, project root) listeners filter on.

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();
static BRIDGE: OnceLock<()> = OnceLock::new();

struct Log {
    seq: u64,
    items: VecDeque<(u64, String, Value)>,
}
static LOG: Mutex<Log> = Mutex::new(Log { seq: 0, items: VecDeque::new() });
static READY: Condvar = Condvar::new();

pub fn set_app(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn app() -> Option<&'static AppHandle> {
    APP.get()
}

pub fn enable_bridge_log() {
    let _ = BRIDGE.set(());
}

pub fn emit(topic: &str, payload: Value) {
    if let Some(app) = APP.get() {
        let _ = app.emit(topic, payload.clone());
    }
    if BRIDGE.get().is_some() {
        let mut log = LOG.lock().unwrap();
        log.seq += 1;
        let seq = log.seq;
        log.items.push_back((seq, topic.to_string(), payload));
        while log.items.len() > 20_000 {
            log.items.pop_front();
        }
        READY.notify_all();
    }
}

/// Events after `after`, waiting up to `wait` for the first one.
pub fn poll(after: u64, wait: Duration) -> Value {
    let mut log = LOG.lock().unwrap();
    // Wait only when the client is up to date. A client starting "from now" (`after` beyond
    // the log) gets the current position at once, instead of missing what arrives meanwhile.
    if log.seq == after {
        log = READY.wait_timeout_while(log, wait, |l| l.seq <= after).unwrap().0;
    }
    let events: Vec<Value> = log
        .items
        .iter()
        .filter(|(s, _, _)| *s > after)
        .map(|(_, t, p)| json!({"topic": t, "payload": p}))
        .collect();
    json!({"last": log.seq, "events": events})
}
