//! Live preview of a static page (owned by the terminal feature).
//!
//! The Mac app serves project files through a `spar-preview://` scheme so a page's scripts
//! are same-origin (fetch works, errors keep their details). Here a small local server on
//! 127.0.0.1 does the same, for the app's web view and the dev browser alike. HTML pages get
//! a script that reports JavaScript errors to the preview pane (`postMessage` to the parent).
//!
//! Commands: `preview_serve {root}` → `{url}` (one server per project, kept while the app runs).

use crate::registry::{parse, Registry};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static SERVERS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

const ERROR_HOOK: &str = r#"<script>(function(){
  function post(m){ try { window.parent.postMessage({ sparPreviewError: String(m) }, '*'); } catch(e) {} }
  window.addEventListener('error', function(e){
    post((e.message || 'Error') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', function(e){
    post('Unhandled promise rejection: ' + ((e.reason && e.reason.message) || e.reason));
  });
  var original = console.error;
  console.error = function(){ post(Array.prototype.map.call(arguments, String).join(' ')); original.apply(console, arguments); };
})();</script>"#;

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs" | "cjs") => "text/javascript; charset=utf-8",
        Some("json" | "map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml",
        Some("wasm") => "application/wasm",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// The file a request path names, never outside the project.
fn resolve(root: &Path, url: &str) -> Option<PathBuf> {
    let path = url.split(['?', '#']).next().unwrap_or("");
    let rel = percent_decode(path);
    let mut file = root.to_path_buf();
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => return None,
            p => file.push(p),
        }
    }
    if file.is_dir() {
        file.push("index.html");
    }
    let canon = file.canonicalize().ok()?;
    canon.starts_with(root).then_some(canon)
}

fn serve(root: PathBuf) -> Result<String, String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server.server_addr().to_ip().map(|a| a.port()).ok_or("no port")?;
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let header = |k: &str, v: &str| tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap();
            match resolve(&root, req.url()).and_then(|f| std::fs::read(&f).ok().map(|d| (f, d))) {
                Some((file, mut data)) => {
                    let ty = mime(&file);
                    if ty.starts_with("text/html") {
                        let text = String::from_utf8_lossy(&data).to_string();
                        let at = text.to_ascii_lowercase().find("<head>").map(|i| i + 6).unwrap_or(0);
                        data = format!("{}{}{}", &text[..at], ERROR_HOOK, &text[at..]).into_bytes();
                    }
                    let resp = tiny_http::Response::from_data(data)
                        .with_header(header("Content-Type", ty))
                        .with_header(header("Cache-Control", "no-store"));
                    let _ = req.respond(resp);
                }
                None => {
                    let resp = tiny_http::Response::from_string("Not found")
                        .with_status_code(404)
                        .with_header(header("Content-Type", "text/plain"));
                    let _ = req.respond(resp);
                }
            }
        }
    });
    Ok(format!("http://127.0.0.1:{port}/"))
}

pub fn register(r: &mut Registry) {
    #[derive(Deserialize)]
    struct Serve {
        root: String,
    }
    r.add("preview_serve", |a| {
        let a: Serve = parse(a)?;
        let root = PathBuf::from(&a.root).canonicalize().map_err(|e| e.to_string())?;
        let key = root.to_string_lossy().to_string();
        let mut map = SERVERS.get_or_init(Default::default).lock().unwrap();
        if let Some(url) = map.get(&key) {
            return Ok(json!({"url": url}));
        }
        let url = serve(root)?;
        map.insert(key, url.clone());
        Ok(json!({"url": url}))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_leaves_the_project() {
        let dir = std::env::temp_dir().join("spar-preview-test");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub/index.html"), "<p>hi</p>").unwrap();
        let root = dir.canonicalize().unwrap();
        assert!(resolve(&root, "/sub/").unwrap().ends_with("sub/index.html"));
        assert!(resolve(&root, "/sub/index.html?x=1").is_some());
        assert!(resolve(&root, "/../etc/passwd").is_none());
        assert!(resolve(&root, "/%2e%2e/etc/passwd").is_none());
        assert_eq!(percent_decode("a%20b"), "a b");
    }
}
