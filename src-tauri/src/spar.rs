//! The SPAR CLI: `spar next --json` decides every step; gates live in its ledger.

use crate::platform::{run, sh_quote, to_shell_path};
use serde_json::Value;

pub fn next(root: &str, feature: Option<&str>) -> Result<Value, String> {
    let dir = to_shell_path(root);
    let f = feature.map(|f| format!(" {}", sh_quote(f))).unwrap_or_default();
    let out = run(&format!("cd {} && spar next{} --json", sh_quote(&dir), f)).map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("spar next returned something unexpected: {e}"))
}

/// Features (iterations) under the project's spar/specs.
pub fn features(root: &str) -> Vec<String> {
    let specs = std::path::Path::new(root).join("spar").join("specs");
    let mut out: Vec<String> = std::fs::read_dir(specs)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| !n.starts_with('.'))
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

pub fn register(r: &mut crate::registry::Registry) {
    #[derive(serde::Deserialize)]
    struct N {
        root: String,
        feature: Option<String>,
    }
    r.add("spar_next", |a| {
        let a: N = crate::registry::parse(a)?;
        next(&a.root, a.feature.as_deref())
    });
    r.add("spar_features", |a| {
        let a: N = crate::registry::parse(a)?;
        Ok(serde_json::json!(features(&a.root)))
    });
}
