//! Documents and diagrams: rendering diagram sources to images (d2, PlantUML, Python
//! `diagrams`), the tools that needs, and PDF / Word / PowerPoint export.
//!
//! Tools already on the machine are used as they are. Anything missing is installed on
//! first use into the app's own runtime (`<app data>/runtime`, or `~/.spar-desktop/runtime`
//! inside WSL on Windows, where tools run), never into the Mac app's folder:
//!   runtime/py    a uv virtualenv with diagrams, python-pptx, beautifulsoup4
//!   runtime/env   conda-forge packages via micromamba: graphviz, plantuml (+ Java), pandoc, uv
//!   runtime/bin   micromamba, d2 (when the app doesn't ship it)
//!
//! Progress of installs goes out as `docs:setup` {message, state: running|done|failed}.

use crate::events::emit;
use crate::exec;
use crate::platform::{self, is_windows, sh_quote};
use crate::registry::{data_dir, parse, resource_dir, Registry};
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

const D2_VERSION: &str = "0.9.0";
const RENDER_TIMEOUT: Duration = Duration::from_secs(180);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(900);

// ---- Paths ----------------------------------------------------------------------------

/// A local path as the tools see it (`/mnt/c/...` inside WSL on Windows).
fn sp(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    if is_windows() {
        platform::to_shell_path(&s)
    } else {
        s
    }
}

/// The runtime folder, as a path the tools (and the shell) understand.
fn rt() -> &'static str {
    static RT: OnceLock<String> = OnceLock::new();
    RT.get_or_init(|| {
        if is_windows() {
            let home = platform::run("printf %s \"$HOME\"")
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|h| !h.is_empty())
                .unwrap_or_else(|| "/tmp".into());
            format!("{home}/.spar-desktop/runtime")
        } else {
            data_dir().join("runtime").to_string_lossy().to_string()
        }
    })
}

fn rtp(rel: &str) -> String {
    format!("{}/{}", rt(), rel)
}

/// Whether a runtime path exists (checked inside WSL on Windows).
fn exists(p: &str) -> bool {
    if is_windows() {
        platform::run(&format!("test -e {}", sh_quote(p))).map(|o| o.status.success()).unwrap_or(false)
    } else {
        Path::new(p).exists()
    }
}

fn scratch(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(name);
    let _ = std::fs::create_dir_all(&d);
    d
}

fn hash(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    h.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}

fn unique() -> String {
    let t = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{t:x}{:04x}", rand::random::<u16>())
}

// ---- Running tools --------------------------------------------------------------------

/// The last few lines of a failed run, for the error shown under a diagram.
fn last(o: &exec::Output) -> String {
    let text = if o.stderr.trim().is_empty() { &o.stdout } else { &o.stderr };
    let lines: Vec<&str> = text.trim().lines().collect();
    lines[lines.len().saturating_sub(4)..].join("\n")
}

/// Runs a tool with extra directories in front of PATH (through `sh`, since exec sets PATH
/// itself; inside WSL on Windows this also keeps WSL's own PATH).
fn run_tool(program: &str, args: &[String], cwd: Option<&str>, path_front: &[String], extra: BTreeMap<String, String>, timeout: Duration) -> exec::Output {
    if path_front.is_empty() {
        return exec::run(program, args, cwd, &extra, None, Some(timeout));
    }
    let mut a = vec!["-c".to_string(), format!("PATH={}:\"$PATH\"; exec \"$0\" \"$@\"", sh_quote(&path_front.join(":"))), program.to_string()];
    a.extend(args.iter().cloned());
    exec::run("sh", &a, cwd, &extra, None, Some(timeout))
}

fn runtime_path() -> Vec<String> {
    vec![rtp("py/bin"), rtp("env/bin"), rtp("env/lib/jvm/bin"), rtp("bin")]
}

/// A tool on the person's PATH, in the runtime, or shipped with the app.
fn find(name: &str) -> Option<String> {
    if exec::which(name).is_some() {
        return Some(name.to_string());
    }
    let mut cands = vec![rtp(&format!("env/bin/{name}")), rtp(&format!("bin/{name}"))];
    if !is_windows() {
        cands.push(resource_dir().join("bin").join(name).to_string_lossy().to_string());
        if cfg!(debug_assertions) {
            cands.push(format!("{}/resources/bin/{name}", env!("CARGO_MANIFEST_DIR")));
        }
    }
    cands.into_iter().find(|c| exists(c))
}

// ---- Installing what's missing ----------------------------------------------------------

static INSTALL: Mutex<()> = Mutex::new(());

fn setup_event(message: &str, state: &str) {
    emit("docs:setup", json!({"message": message, "state": state}));
}

/// Runs an install step with progress events; returns an error message on failure.
fn step(message: &str, f: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    setup_event(message, "running");
    match f() {
        Ok(()) => {
            setup_event(message, "done");
            Ok(())
        }
        Err(e) => {
            setup_event(&format!("{message}: {e}"), "failed");
            Err(e)
        }
    }
}

fn shell_script(script: &str) -> Result<(), String> {
    let o = platform::run(script).map_err(|e| e.to_string())?;
    if o.status.success() {
        Ok(())
    } else {
        let e = String::from_utf8_lossy(&o.stderr).trim().to_string();
        Err(if e.is_empty() { "the download failed".into() } else { e.lines().last().unwrap_or_default().to_string() })
    }
}

/// uname-style (os, arch) of the machine the tools run on (WSL on Windows: Linux).
fn tool_platform() -> (&'static str, &'static str) {
    let os = if cfg!(target_os = "macos") { "macos" } else { "linux" };
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "amd64" };
    (os, arch)
}

fn micromamba() -> Result<String, String> {
    if let Some(m) = find("micromamba") {
        return Ok(m);
    }
    let target = rtp("bin/micromamba");
    let plat = match tool_platform() {
        ("macos", "arm64") => "osx-arm64",
        ("macos", _) => "osx-64",
        (_, "arm64") => "linux-aarch64",
        _ => "linux-64",
    };
    step("Downloading the package installer", || {
        let dir = rtp("dl-mm");
        shell_script(&format!(
            "set -e; rm -rf {d}; mkdir -p {d} {bin}; curl -fsSL https://micro.mamba.pm/api/micromamba/{plat}/latest | tar -xj -C {d} bin/micromamba; mv {d}/bin/micromamba {t}; chmod +x {t}; rm -rf {d}",
            d = sh_quote(&dir),
            bin = sh_quote(&rtp("bin")),
            t = sh_quote(&target)
        ))
    })?;
    Ok(target)
}

/// Adds conda-forge packages to the runtime env (the Mac app's Runtime.installPackage).
fn conda_install(pkgs: &[&str], message: &str) -> Result<(), String> {
    let mm = micromamba()?;
    step(message, || {
        let create = !exists(&rtp("env/conda-meta"));
        let mut args: Vec<String> = vec![if create { "create" } else { "install" }.into(), "-y".into(), "-q".into(), "-p".into(), rtp("env"), "-c".into(), "conda-forge".into()];
        args.extend(pkgs.iter().map(|s| s.to_string()));
        let mut env = BTreeMap::new();
        env.insert("MAMBA_ROOT_PREFIX".to_string(), rtp("mamba"));
        let o = exec::run(&mm, &args, None, &env, None, Some(INSTALL_TIMEOUT));
        if o.status == 0 {
            Ok(())
        } else {
            Err(last(&o).lines().rev().take(2).collect::<Vec<_>>().join(" "))
        }
    })
}

/// Java that actually runs (macOS ships a /usr/bin/java stub that only offers to install it).
fn has_java() -> bool {
    exec::which("java").is_some() && exec::run("java", &["-version".into()], None, &BTreeMap::new(), None, Some(Duration::from_secs(20))).status == 0
}

fn ensure_tool(name: &str, pkgs: &[&str], message: &str) -> Result<String, String> {
    if let Some(t) = find(name) {
        return Ok(t);
    }
    let _g = INSTALL.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(t) = find(name) {
        return Ok(t);
    }
    conda_install(pkgs, message)?;
    find(name).ok_or_else(|| format!("{name} wasn't installed"))
}

fn ensure_d2() -> Result<String, String> {
    if let Some(t) = find("d2") {
        return Ok(t);
    }
    let _g = INSTALL.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(t) = find("d2") {
        return Ok(t);
    }
    let (os, arch) = tool_platform();
    let target = rtp("bin/d2");
    step("Downloading D2", || {
        let dir = rtp("dl-d2");
        shell_script(&format!(
            "set -e; rm -rf {d}; mkdir -p {d} {bin}; curl -fsSL https://github.com/d2lang/d2/releases/download/v{v}/d2-v{v}-{os}-{arch}.tar.gz | tar -xz -C {d}; cp \"$(find {d} -type f -name d2 | head -1)\" {t}; chmod +x {t}; rm -rf {d}",
            d = sh_quote(&dir),
            bin = sh_quote(&rtp("bin")),
            v = D2_VERSION,
            t = sh_quote(&target)
        ))
    })?;
    Ok(target)
}

fn ensure_plantuml() -> Result<String, String> {
    if let Some(t) = find("plantuml") {
        return Ok(t);
    }
    if has_java() {
        ensure_tool("plantuml", &["plantuml"], "Installing PlantUML")
    } else {
        ensure_tool("plantuml", &["plantuml", "openjdk=21"], "Installing PlantUML and Java")
    }
}

fn venv_python() -> String {
    rtp("py/bin/python")
}

fn python_ready(py: &str) -> bool {
    exists(py) && exec::run(py, &["-c".into(), "import diagrams, pptx, bs4".into()], None, &BTreeMap::new(), None, Some(Duration::from_secs(60))).status == 0
}

// ---- First-run setup (the Mac app's Runtime: everything up front, nothing on first use) ----

/// Tools SPAR installs into its runtime when this machine lacks them: tmux and git (the
/// engine), uv, Graphviz and PlantUML (+ Java) for diagrams. conda-forge package names.
pub fn missing_runtime_packages() -> Vec<&'static str> {
    let mut pkgs = Vec::new();
    for (tool, pkg) in [("tmux", "tmux"), ("git", "git"), ("uv", "uv"), ("dot", "graphviz"), ("plantuml", "plantuml")] {
        if find(tool).is_none() {
            pkgs.push(pkg);
        }
    }
    if pkgs.contains(&"plantuml") && !has_java() {
        pkgs.push("openjdk=21");
    }
    pkgs
}

/// Installs those packages with the micromamba shipped inside the app.
pub fn install_runtime_packages(pkgs: &[&str]) -> Result<(), String> {
    if pkgs.is_empty() {
        return Ok(());
    }
    let _g = INSTALL.lock().unwrap_or_else(|e| e.into_inner());
    conda_install(pkgs, &format!("Installing {}", pkgs.join(", ")))
}

pub fn diagram_python_ready() -> bool {
    python_ready(&venv_python())
}

/// The Python libraries for diagrams and slides (diagrams, python-pptx, beautifulsoup4).
pub fn install_diagram_python() -> Result<(), String> {
    ensure_python().map(|_| ())
}

/// Where the runtime's tools live, for PATH (after the person's own tools).
pub fn runtime_bins() -> Vec<String> {
    vec![rtp("env/bin"), rtp("bin")]
}

/// The runtime's Python with diagrams, python-pptx and beautifulsoup4 (a uv venv).
fn ensure_python() -> Result<String, String> {
    let py = venv_python();
    let check = |py: &str| python_ready(py);
    if check(&py) {
        return Ok(py);
    }
    let _g = INSTALL.lock().unwrap_or_else(|e| e.into_inner());
    if check(&py) {
        return Ok(py);
    }
    let uv = match find("uv") {
        Some(u) => u,
        None => {
            conda_install(&["uv"], "Installing uv")?;
            find("uv").ok_or("uv wasn't installed")?
        }
    };
    let mut env = BTreeMap::new();
    env.insert("UV_PYTHON_INSTALL_DIR".to_string(), rtp("python"));
    if !exists(&py) {
        step("Creating SPAR's Python environment", || {
            let o = exec::run(&uv, &["venv".into(), "--python".into(), "3.12".into(), rtp("py")], None, &env, None, Some(INSTALL_TIMEOUT));
            if o.status == 0 { Ok(()) } else { Err(last(&o)) }
        })?;
    }
    step("Installing Python libraries for diagrams and slides", || {
        let args: Vec<String> = ["pip", "install", "-q", "--python", &py, "diagrams", "python-pptx", "beautifulsoup4"].iter().map(|s| s.to_string()).collect();
        let o = exec::run(&uv, &args, None, &env, None, Some(INSTALL_TIMEOUT));
        if o.status == 0 { Ok(()) } else { Err(last(&o)) }
    })?;
    Ok(py)
}

// ---- Rendering --------------------------------------------------------------------------

/// Which engine a file is written for (DiagramEngine.detect): d2 | puml | py | mermaid | drawio.
fn detect(path: &str, text: Option<&str>) -> Option<&'static str> {
    let l = path.to_lowercase();
    if l.ends_with(".drawio") || l.ends_with(".drawio.svg") || l.ends_with(".drawio.png") || l.ends_with(".dio") {
        return Some("drawio");
    }
    if l.ends_with(".d2") {
        return Some("d2");
    }
    if l.ends_with(".mmd") || l.ends_with(".mermaid") {
        return Some("mermaid");
    }
    if [".puml", ".plantuml", ".iuml", ".wsd"].iter().any(|e| l.ends_with(e)) {
        return Some("puml");
    }
    if l.ends_with(".py") {
        let t = text.map(String::from).or_else(|| std::fs::read_to_string(path).ok()).unwrap_or_default();
        if t.contains("from diagrams") || t.contains("import diagrams") {
            return Some("py");
        }
    }
    None
}

fn newest(dir: &Path, exts: &[&str]) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().map(|e| exts.contains(&e.to_string_lossy().to_lowercase().as_str())).unwrap_or(false))
        .max_by_key(|p| p.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH))
}

/// Renders a diagram file to an SVG or PNG in a fresh cache folder (DiagramRenderer.render).
fn render_file(path: &str, dark: bool) -> Result<PathBuf, String> {
    let engine = detect(path, None).ok_or("Not a diagram file")?;
    // A fresh folder per render: the image path changes, so the preview reloads.
    let base = scratch("spar-diagrams").join(hash(path));
    if let Ok(rd) = std::fs::read_dir(&base) {
        for e in rd.flatten() {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
    let cache = base.join(unique());
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let file = sp(Path::new(path));
    match engine {
        "d2" => {
            let d2 = ensure_d2()?;
            let out = cache.join("diagram.svg");
            let args: Vec<String> = vec!["--layout".into(), "elk".into(), "--theme".into(), if dark { "200" } else { "0" }.into(), "--pad".into(), "40".into(), file, sp(&out)];
            let o = run_tool(&d2, &args, None, &runtime_path(), BTreeMap::new(), RENDER_TIMEOUT);
            if o.status == 0 && out.exists() { Ok(out) } else { Err(last(&o)) }
        }
        "puml" => {
            let plantuml = ensure_plantuml()?;
            let o = run_tool(&plantuml, &["-tsvg".into(), "-o".into(), sp(&cache), file], None, &runtime_path(), BTreeMap::new(), RENDER_TIMEOUT);
            if let Some(svg) = newest(&cache, &["svg"]) {
                return Ok(svg);
            }
            Err(if o.status == 0 { "PlantUML produced no image".into() } else { last(&o) })
        }
        "py" => {
            let python = ensure_python()?;
            ensure_tool("dot", &["graphviz"], "Installing Graphviz")?;
            // Run in a scratch folder; a no-op `open` stops show=True from launching a viewer.
            let shim = cache.join("shim");
            let _ = std::fs::create_dir_all(&shim);
            for name in ["open", "xdg-open"] {
                let f = shim.join(name);
                let _ = std::fs::write(&f, "#!/bin/sh\nexit 0\n");
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755));
                }
            }
            if is_windows() {
                let _ = platform::run(&format!("chmod +x {}/*", sh_quote(&sp(&shim))));
            }
            let mut front = vec![sp(&shim)];
            front.extend(runtime_path());
            let cwd = cache.to_string_lossy().to_string();
            let o = run_tool(&python, &[file], Some(&cwd), &front, BTreeMap::new(), RENDER_TIMEOUT);
            if let Some(img) = newest(&cache, &["svg", "png", "jpg", "jpeg"]) {
                return Ok(img);
            }
            Err(if o.status == 0 { "The script ran but wrote no image".into() } else { last(&o) })
        }
        _ => Err("Rendered in the editor".into()),
    }
}

static CACHE: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();

fn image_value(file: &Path) -> Result<Value, String> {
    let data = std::fs::read(file).map_err(|e| e.to_string())?;
    let mime = match file.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("svg") => "image/svg+xml",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => "image/png",
    };
    Ok(json!({"file": file, "mime": mime, "data": base64::engine::general_purpose::STANDARD.encode(data)}))
}

/// A diagram source embedded in a document: written to a scratch file (a Python script
/// keeps its own folder so its local imports work) and rendered light, cached by content.
fn render_source(source: &str, ext: &str, path: Option<&str>) -> Result<Value, String> {
    let key = format!("{ext}:{}", hash(source));
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(hit) = cache.lock().unwrap().get(&key) {
        return Ok(hit.clone());
    }
    let file = match (path, ext) {
        (Some(p), "py") => p.to_string(),
        _ => {
            let f = scratch("spar-md").join(format!("{}.{ext}", hash(&key)));
            std::fs::write(&f, source).map_err(|e| e.to_string())?;
            f.to_string_lossy().to_string()
        }
    };
    let img = render_file(&file, false)?;
    let v = image_value(&img)?;
    cache.lock().unwrap().insert(key, v.clone());
    Ok(v)
}

// ---- PDF (headless Chromium-family browser) ----------------------------------------------

/// Chrome, Edge, Chromium or Brave: they print HTML to a paginated, vector PDF. Edge ships
/// with every Windows 10/11, so Windows always has one.
fn find_browser() -> Option<PathBuf> {
    let mut c: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        let home = crate::registry::home();
        for app in ["Google Chrome.app/Contents/MacOS/Google Chrome", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Chromium.app/Contents/MacOS/Chromium", "Brave Browser.app/Contents/MacOS/Brave Browser", "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"] {
            c.push(Path::new("/Applications").join(app));
            c.push(home.join("Applications").join(app));
        }
    } else if cfg!(windows) {
        for var in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
                c.push(base.join("Microsoft/Edge/Application/msedge.exe"));
                c.push(base.join("Google/Chrome/Application/chrome.exe"));
                c.push(base.join("BraveSoftware/Brave-Browser/Application/brave.exe"));
            }
        }
    } else {
        for name in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"] {
            if let Some(p) = exec::which(name) {
                c.push(p);
            }
        }
    }
    c.into_iter().find(|p| p.is_file())
}

fn html_to_pdf(html: &str, dest: &Path) -> Result<(), String> {
    let browser = find_browser().ok_or("PDF export needs Google Chrome, Microsoft Edge, Chromium or Brave, and none was found")?;
    let dir = scratch("spar-export").join(unique());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let page = dir.join("document.html");
    std::fs::write(&page, html).map_err(|e| e.to_string())?;
    let out = dir.join("document.pdf");
    let url = format!("file://{}{}", if cfg!(windows) { "/" } else { "" }, page.to_string_lossy().replace('\\', "/").replace(' ', "%20"));
    let mut cmd = Command::new(&browser);
    cmd.args([
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
        "--allow-file-access-from-files",
        "--no-pdf-header-footer",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=15000",
    ])
    .arg(format!("--user-data-dir={}", dir.join("profile").to_string_lossy()))
    .arg(format!("--print-to-pdf={}", out.to_string_lossy()))
    .arg(url)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start {}: {e}", browser.display()))?;
    // Chrome on macOS can linger after writing the PDF: stop it once the file is complete.
    let start = Instant::now();
    let mut last_size = 0u64;
    let mut stable = 0;
    loop {
        if let Ok(Some(_)) = child.try_wait() {
            break;
        }
        let size = out.metadata().map(|m| m.len()).unwrap_or(0);
        if size > 0 && size == last_size {
            stable += 1;
            if stable >= 10 {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        } else {
            stable = 0;
        }
        last_size = size;
        if start.elapsed() > Duration::from_secs(120) {
            let _ = child.kill();
            return Err("The PDF took too long to print".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let ok = out.metadata().map(|m| m.len() > 0).unwrap_or(false);
    if !ok {
        let mut e = String::new();
        if let Some(mut s) = child.stderr.take() {
            use std::io::Read;
            let _ = s.read_to_string(&mut e);
        }
        return Err(format!("The PDF wasn't written{}", e.lines().last().map(|l| format!(": {l}")).unwrap_or_default()));
    }
    std::fs::copy(&out, dest).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

// ---- Word (pandoc) and PowerPoint (python-pptx) ------------------------------------------

fn html_to_docx(html: &str, dest: &Path) -> Result<(), String> {
    let pandoc = ensure_tool("pandoc", &["pandoc"], "Installing pandoc for Word export").map_err(|e| format!("Couldn't install pandoc for Word export: {e}"))?;
    let tmp = scratch("spar-export").join(format!("spar-export-{}.html", unique()));
    std::fs::write(&tmp, html).map_err(|e| e.to_string())?;
    let out = scratch("spar-export").join(format!("spar-export-{}.docx", unique()));
    let o = run_tool(&pandoc, &["-f".into(), "html".into(), "-t".into(), "docx".into(), "-o".into(), sp(&out), sp(&tmp)], None, &runtime_path(), BTreeMap::new(), Duration::from_secs(300));
    let _ = std::fs::remove_file(&tmp);
    if o.status != 0 || !out.exists() {
        return Err(if o.stderr.trim().is_empty() { "pandoc failed".into() } else { o.stderr.trim().to_string() });
    }
    std::fs::copy(&out, dest).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&out);
    Ok(())
}

fn deck_to_pptx(src: &str, dest: &Path) -> Result<String, String> {
    let python = ensure_python()?;
    let script = scratch("spar-export").join("spar-html2pptx.py");
    std::fs::write(&script, CONVERTER).map_err(|e| e.to_string())?;
    let out = scratch("spar-export").join(format!("deck-{}.pptx", unique()));
    let o = run_tool(&python, &[sp(&script), sp(Path::new(src)), sp(&out)], None, &runtime_path(), BTreeMap::new(), Duration::from_secs(300));
    if o.status != 0 || !out.exists() {
        return Err((if o.stderr.trim().is_empty() { &o.stdout } else { &o.stderr }).trim().to_string());
    }
    std::fs::copy(&out, dest).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&out);
    Ok(o.stdout.trim().to_string())
}

/// HTML deck → editable .pptx (Slides.swift's converter, unchanged).
const CONVERTER: &str = r#"import base64, io, os, re, sys
from bs4 import BeautifulSoup
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor

src, dest = sys.argv[1], sys.argv[2]
base = os.path.dirname(os.path.abspath(src))
soup = BeautifulSoup(open(src, encoding="utf-8").read(), "html.parser")
sections = soup.select("section.slide") or soup.find_all("section")
if not sections:
    sections = [soup.body or soup]

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
blank = prs.slide_layouts[6]
W, H = prs.slide_width, prs.slide_height
M = Inches(0.6)

def text(el):
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()

def image_stream(src_attr):
    if not src_attr:
        return None
    if src_attr.startswith("data:"):
        head, _, data = src_attr.partition(",")
        if "svg" in head:
            return None
        return io.BytesIO(base64.b64decode(data) if ";base64" in head else data.encode())
    path = src_attr if os.path.isabs(src_attr) else os.path.join(base, src_attr)
    if os.path.exists(path) and not path.lower().endswith(".svg"):
        return open(path, "rb")
    return None

def add_title(slide, title, top, size):
    box = slide.shapes.add_textbox(M, top, W - 2 * M, Inches(1.1))
    tf = box.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]; p.text = title
    p.font.size = Pt(size); p.font.bold = True; p.font.color.rgb = RGBColor(0x1F, 0x23, 0x28)

for i, sec in enumerate(sections):
    slide = prs.slides.add_slide(blank)
    notes = sec.find("aside", class_="notes")
    if notes:
        slide.notes_slide.notes_text_frame.text = text(notes)
        notes.extract()
    heading = sec.find(["h1", "h2"])
    title = text(heading) if heading else ""
    if heading:
        heading.extract()
    imgs = [im for im in sec.find_all("img")]
    table = sec.find("table")
    body_blocks = [el for el in sec.find_all(["p", "ul", "ol", "h3", "h4", "pre", "blockquote"])
                   if not el.find_parent(["ul", "ol", "table", "p", "blockquote"])]
    has_body = any(text(b) for b in body_blocks)

    # A slide with only a title (and maybe a subtitle) is a title slide.
    if not imgs and not table and len(body_blocks) <= 1 and not any(b.name in ("ul", "ol", "pre") for b in body_blocks):
        add_title(slide, title, Inches(2.6), 44)
        if body_blocks:
            box = slide.shapes.add_textbox(M, Inches(3.8), W - 2 * M, Inches(1.2))
            p = box.text_frame.paragraphs[0]; p.text = text(body_blocks[0]); p.font.size = Pt(22)
            p.font.color.rgb = RGBColor(0x59, 0x63, 0x6E)
        continue

    add_title(slide, title, Inches(0.4), 32)
    top = Inches(1.6)
    text_width = (W - 2 * M) * (0.55 if imgs and has_body else 1)
    if has_body:
        box = slide.shapes.add_textbox(M, top, text_width, H - top - Inches(0.5))
        tf = box.text_frame; tf.word_wrap = True
        first = True
        def para(t, level=0, bullet=False, size=20, mono=False):
            global first
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            p.text = ("• " if bullet else "") + t
            p.level = min(level, 4)
            p.font.size = Pt(size - 2 * level)
            if mono: p.font.name = "Menlo"
            p.space_after = Pt(6)
        def walk_list(lst, level):
            for li in lst.find_all("li", recursive=False):
                sub = li.find(["ul", "ol"])
                if sub: sub.extract()
                para(text(li), level, bullet=True)
                if sub: walk_list(sub, level + 1)
        for b in body_blocks:
            if b.name in ("ul", "ol"):
                walk_list(b, 0)
            elif b.name == "pre":
                para(b.get_text(), mono=True, size=14)
            elif text(b):
                para(text(b), size=22 if b.name in ("h3", "h4") else 20)
    if table:
        rows = [[text(c) for c in tr.find_all(["th", "td"])] for tr in table.find_all("tr")]
        rows = [r for r in rows if r]
        if rows:
            cols = max(len(r) for r in rows)
            t_top = top if not has_body else H - Inches(0.5) - Inches(0.45) * len(rows)
            shape = slide.shapes.add_table(len(rows), cols, M, max(t_top, top), W - 2 * M, Inches(0.45) * len(rows))
            for r, row in enumerate(rows):
                for c in range(cols):
                    cell = shape.table.cell(r, c)
                    cell.text = row[c] if c < len(row) else ""
                    cell.text_frame.paragraphs[0].font.size = Pt(14)
    for n, im in enumerate(imgs[:2]):
        stream = image_stream(im.get("src"))
        if not stream:
            continue
        left = M + text_width + Inches(0.3) if has_body else M
        width = W - left - M
        height = H - top - Inches(0.5)
        pic = slide.shapes.add_picture(stream, left, top)
        scale = min(width / pic.width, height / pic.height, 1.0)
        pic.width, pic.height = int(pic.width * scale), int(pic.height * scale)
        pic.left = int(left + (width - pic.width) / 2)

prs.save(dest)
print(f"{len(sections)} slides")
"#;

// ---- Commands -----------------------------------------------------------------------------

pub fn register(r: &mut Registry) {
    #[derive(Deserialize)]
    struct Render {
        path: Option<String>,
        source: Option<String>,
        ext: Option<String>,
        #[serde(default)]
        dark: bool,
    }
    #[derive(Deserialize)]
    struct HtmlDest {
        html: String,
        dest: String,
    }
    #[derive(Deserialize)]
    struct PathDest {
        path: String,
        dest: String,
    }
    #[derive(Deserialize)]
    struct Path1 {
        path: String,
    }
    #[derive(Deserialize)]
    struct What {
        what: String,
    }

    // {path, dark} renders a diagram file; {source, ext, path?} a diagram embedded in a
    // document (cached by content). → {file, mime, data (base64)}
    r.add("docs_render_diagram", |a| {
        let a: Render = parse(a)?;
        match (a.source, a.ext) {
            (Some(src), Some(ext)) => render_source(&src, &ext, a.path.as_deref()),
            _ => {
                let path = a.path.ok_or("path or source required")?;
                image_value(&render_file(&path, a.dark)?)
            }
        }
    });
    // Which engine a file is written for: d2 | puml | py | mermaid | drawio | null.
    r.add("docs_detect", |a| {
        let a: Path1 = parse(a)?;
        Ok(json!(detect(&a.path, None)))
    });
    // {html, dest}: a self-contained HTML page printed to a Letter PDF.
    r.add("docs_pdf", |a| {
        let a: HtmlDest = parse(a)?;
        html_to_pdf(&a.html, Path::new(&a.dest))?;
        Ok(Value::Null)
    });
    // {html, dest}: HTML (images as data URIs) → .docx via pandoc.
    r.add("docs_docx", |a| {
        let a: HtmlDest = parse(a)?;
        html_to_docx(&a.html, Path::new(&a.dest))?;
        Ok(Value::Null)
    });
    // {path, dest}: an HTML slide deck → editable .pptx. → "N slides"
    r.add("docs_pptx", |a| {
        let a: PathDest = parse(a)?;
        Ok(json!(deck_to_pptx(&a.path, Path::new(&a.dest))?))
    });
    // What's available without installing anything.
    r.add("docs_tools", |_| {
        let py = venv_python();
        Ok(json!({
            "d2": find("d2").is_some(),
            "plantuml": find("plantuml").is_some(),
            "dot": find("dot").is_some(),
            "python": exists(&py),
            "pandoc": find("pandoc").is_some(),
            "browser": find_browser().map(|p| p.to_string_lossy().to_string()),
            "runtime": rt(),
        }))
    });
    // Installs a tool now (Settings › Diagrams "Check and repair"): d2 | plantuml | python | dot | pandoc | all.
    r.add("docs_ensure", |a| {
        let a: What = parse(a)?;
        let all = a.what == "all";
        let mut errors = Vec::new();
        let mut run = |name: &str, f: &dyn Fn() -> Result<String, String>| {
            if all || a.what == name {
                if let Err(e) = f() {
                    errors.push(format!("{name}: {e}"));
                }
            }
        };
        run("d2", &ensure_d2);
        run("python", &ensure_python);
        run("dot", &|| ensure_tool("dot", &["graphviz"], "Installing Graphviz"));
        run("plantuml", &ensure_plantuml);
        run("pandoc", &|| ensure_tool("pandoc", &["pandoc"], "Installing pandoc for Word export"));
        if errors.is_empty() { Ok(Value::Null) } else { Err(errors.join("\n")) }
    });
}

/// Called when the app exits.
pub fn shutdown() {}
