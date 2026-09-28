// The no-project window (WelcomeView.swift; owned by the editor feature): open a project,
// recent projects, and the engine's status.

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Folder, FolderOpen, X } from "lucide-react";
import { app as appApi, basename, pickFolder } from "../../lib/api";
import { useCommand } from "../../lib/commands";
import { prefs } from "../../lib/prefs";
import { useApp } from "../../state/app";
import { useEngine } from "../../engine/engine";
import { Button, Mark, Spinner } from "../../ui";
import { SFSymbol } from "../../ui/icons";

const STAGES = ["Discover", "Design", "Develop", "Deliver"];

export function WelcomeView() {
  const { recents, openProject } = useApp();
  const [home, setHome] = useState("");
  useEffect(() => { appApi.info().then((i) => setHome(i.home)).catch(() => {}); }, []);
  const open = async () => { const p = await pickFolder(); if (p) await openProject(p); };
  useCommand("open-project", { title: "Open Project…", group: "File", shortcut: "⌘O", run: () => void open() });
  useCommand("new-window", { title: "New Window", group: "File", shortcut: "⇧⌘N", run: () => appApi.newWindow() });
  useCommand("settings", { title: "Settings…", group: "App", shortcut: "⌘,", run: () => appApi.settings() });
  // ⌘O in the browser (the app's menu has the accelerator).
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o" && !e.shiftKey) { e.preventDefault(); void open(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const tilde = (p: string) => (home && p.startsWith(home) ? "~" + p.slice(home.length) : p);
  const forget = (p: string) => {
    const next = recents.filter((r) => r !== p);
    prefs.set("recents", next);
    useApp.setState({ recents: next });
    appApi.setRecents(next);
  };

  return (
    <div data-tauri-drag-region style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--bg)" }}>
      <div style={{ flex: 1 }} />
      <div className="col" style={{ alignItems: "center", gap: 14 }}>
        <Mark size={64} />
        <div style={{ fontSize: 34, fontWeight: 600, fontFamily: "ui-rounded, var(--font)" }}>SPAR</div>
        <div className="row muted" style={{ gap: 10, fontSize: 15 }}>
          {STAGES.map((s, i) => <span key={s} className="row" style={{ gap: 10 }}>{i > 0 && <span className="faint">·</span>}{s}</span>)}
        </div>
      </div>
      <Button kind="primary" size="large" style={{ marginTop: 34, minWidth: 180 + 32, height: 36, fontSize: 13, borderRadius: 8 }} icon={<SFSymbol name="folder" size={13} fallback={<FolderOpen size={15} />} />} onClick={() => void open()} title="Open a project (⌘O)">
        Open a project
      </Button>
      {recents.length > 0 && (
        <div className="col" style={{ width: 380, marginTop: 30, gap: 2 }} aria-label="Recent projects">
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-2)", padding: "0 10px 4px" }}>Recent</div>
          {recents.map((p) => <RecentRow key={p} path={p} detail={tilde(p)} onOpen={() => void openProject(p)} onForget={() => forget(p)} />)}
        </div>
      )}
      <div style={{ flex: 1 }} />
      <div style={{ paddingBottom: 18 }}><EngineStatusView /></div>
    </div>
  );
}

function RecentRow({ path, detail, onOpen, onForget }: { path: string; detail: string; onOpen: () => void; onForget: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div role="button" aria-label={`Open ${basename(path)}`} onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className="row" style={{ padding: "6px 10px", borderRadius: 8, background: hover ? "var(--subtle)" : undefined, cursor: "default" }}>
      <span style={{ display: "inline-flex", color: "color-mix(in srgb, var(--accent) 80%, transparent)" }}><SFSymbol name="folder.fill" size={13} fallback={<Folder size={16} color="var(--accent)" fill="var(--accent)" fillOpacity={0.8} />} /></span>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
        <span style={{ fontWeight: 500 }}>{basename(path)}</span>
        <span style={{ fontSize: 10, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
      </div>
      {hover && (
        <button type="button" className="icon-btn" title="Remove from Recent" aria-label="Remove from Recent" style={{ width: 20, height: 20 }}
          onClick={(e) => { e.stopPropagation(); onForget(); }}><X size={12} /></button>
      )}
    </div>
  );
}

/** The engine's state under the welcome page (EngineStatusView). */
export function EngineStatusView() {
  const { status, busy, error, start, setup, refresh } = useEngine();
  useEffect(() => {
    if (status?.ready) return;
    const t = setInterval(() => refresh().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [status?.ready]);
  if (status?.ready) return <span className="row" style={{ color: "var(--done)", gap: 5, fontSize: 12 }}><SFSymbol name="checkmark.circle.fill" size={12} fallback={<CheckCircle2 size={14} />} /> Engine ready</span>;
  const failed = !busy && status && !status.starting && (error || status.missing.length > 0 || (!status.running && status.message));
  if (!failed) {
    return (
      <div className="col" style={{ alignItems: "center", gap: 8, fontSize: 12 }}>
        <span className="row muted"><Spinner small /> {busy === "setup" ? "Setting up…" : status?.message ? status.message + "…" : "Starting…"}</span>
        {busy === "setup" && <span style={{ fontSize: 10, color: "var(--text-2)" }}>One time only. Everything SPAR needs is set up for you.</span>}
      </div>
    );
  }
  return (
    <div className="col" style={{ alignItems: "center", gap: 6, fontSize: 12 }}>
      <span className="row" style={{ color: "var(--warn)", gap: 5 }}><SFSymbol name="exclamationmark.triangle.fill" size={12} fallback={<AlertTriangle size={14} />} /> {error ?? status?.message ?? "The engine isn't running."}</span>
      {status!.missing.map((t) => <span key={t} style={{ fontWeight: 500 }}>{({ omnigent: "the agent engine", spar: "the SPAR CLI" } as Record<string, string>)[t] ?? t}</span>)}
      <div className="row">
        {status!.missing.length > 0 && <Button size="small" onClick={() => void setup()}>Set up</Button>}
        <Button size="small" onClick={() => void start()}>Try again</Button>
      </div>
    </div>
  );
}
