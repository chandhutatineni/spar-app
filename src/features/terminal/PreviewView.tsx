// The live preview of the UI being built (the Mac app's PreviewPane in
// Views/PreviewView.swift): toolbar, device widths, the page itself, and any errors the page
// throws (which can go straight to the agent).

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertOctagon, AlertTriangle, AlignLeft, Compass, FileText, Globe, Maximize2, Monitor, Package, Play,
  PlayCircle, RotateCw, Smartphone, Square, Tablet, X, Zap,
} from "lucide-react";
import { app as appApi } from "../../lib/api";
import { usePref } from "../../lib/prefs";
import { useWorkspace } from "../../state/workspace";
import { Button, Segmented, Spinner } from "../../ui";
import { isFailed, preview, sourceLabel, usePreview } from "./preview";
import { SFSymbol } from "../../ui/icons";

/** Lifecycle.develop.tint (PhaseView.swift). */
const DEVELOP = "rgb(237, 128, 46)";

/** A SwiftUI .borderless small-control button: no bezel, accent tinted. */
function Borderless({ symbol, fallback, title, onClick, disabled, active }: { symbol: string; fallback: ReactNode; title: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} aria-pressed={active}
      style={{ border: 0, background: "transparent", padding: "0 2px", height: 20, display: "inline-flex", alignItems: "center", color: "var(--accent)", opacity: disabled ? 0.35 : 1, flex: "none", cursor: "default" }}>
      <SFSymbol name={symbol} size={12} fallback={fallback} />
    </button>
  );
}

/** Sends text to the agent. The chat feature handles `spar:send-to-agent` events (or the
 *  host passes `onSend`). */
export function sendToAgent(text: string) {
  window.dispatchEvent(new CustomEvent("spar:send-to-agent", { detail: { text } }));
}

export interface PreviewViewProps {
  /** A full tab (true) or a card inside another view (false). */
  expanded?: boolean;
  onSend?: (text: string) => void;
  /** Whether the agent can take a message now (idle, with a session). */
  canSend?: boolean;
}

export function PreviewView({ expanded = true, onSend, canSend = true }: PreviewViewProps) {
  const p = usePreview();
  const [device, setDevice] = usePref<"desktop" | "tablet" | "phone">("previewDevice", "desktop");
  const [showLog, setShowLog] = useState(false);
  const send = onSend ?? sendToAgent;
  const isServer = p.source.kind === "devServer";

  // Developing a web app: bring its dev server up without being asked, as long as
  // dependencies are already installed.
  useEffect(() => {
    const s = usePreview.getState();
    if (s.state === "idle" && s.source.kind === "devServer" && !s.source.needsInstall) preview.start();
  }, [p.source.kind]);

  // JavaScript errors reported by the page (static pages carry the error hook).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data?.sparPreviewError;
      if (typeof m === "string") preview.report(m);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const dot = p.state === "running" ? "var(--done)" : p.state === "starting" || p.state === "installing" ? "var(--warn)" : isFailed(p.state) ? "var(--stop)" : "var(--text-3)";
  const address = p.url
    ? p.source.kind === "staticPage" ? p.source.page.slice(p.root.length + 1) : p.url
    : sourceLabel(p.source);
  const busy = p.state === "running" || p.state === "starting" || p.state === "installing";

  return (
    <div data-testid="preview" style={{
      display: "flex", flexDirection: "column", background: "var(--bg)", height: expanded ? "100%" : undefined, minHeight: 0,
      borderRadius: expanded ? 0 : 14, overflow: "hidden",
      border: expanded ? undefined : "0.5px solid var(--hairline-strong)", boxShadow: expanded ? undefined : "0 4px 10px rgba(0,0,0,0.05)",
    }}>
      {/* Toolbar */}
      <div className="row" style={{ gap: 10, padding: "8px 12px", flex: "none", position: "relative" }}>
        <div className="row" style={{ gap: 6, flex: "none" }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: dot }} />
          <span style={{ fontWeight: 600, fontSize: 12 }}>Preview</span>
        </div>
        <div className="row" title={address} style={{ gap: 6, flex: 1, minWidth: 0, padding: "4px 9px", borderRadius: 7, background: "var(--subtle)" }}>
          <span className="faint" style={{ display: "inline-flex", flex: "none" }}><SFSymbol name={isServer ? "network" : "doc.richtext"} size={13} fallback={isServer ? <Globe size={12} /> : <FileText size={12} />} /></span>
          <span className="selectable mono" data-testid="preview-address" style={{ fontSize: 11.5, color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", direction: "rtl", textAlign: "left" }}>
            <bdi>{address}</bdi>
          </span>
        </div>
        <Segmented value={device} onChange={setDevice} options={[
          { value: "desktop", label: <span title="Desktop" style={{ display: "inline-flex" }}><SFSymbol name="desktopcomputer" size={12} fallback={<Monitor size={13} />} /></span> },
          { value: "tablet", label: <span title="Tablet · 820" style={{ display: "inline-flex" }}><SFSymbol name="ipad" size={12} fallback={<Tablet size={13} />} /></span> },
          { value: "phone", label: <span title="Phone · 390" style={{ display: "inline-flex" }}><SFSymbol name="iphone" size={12} fallback={<Smartphone size={13} />} /></span> },
        ]} />
        <Borderless symbol="arrow.clockwise" fallback={<RotateCw size={13} />} title="Reload" disabled={!p.url} onClick={() => preview.reload()} />
        {isServer && (busy
          ? <Borderless symbol="stop.fill" fallback={<Square size={12} fill="currentColor" />} title="Stop the dev server" onClick={() => preview.stop()} />
          : <Borderless symbol="play.fill" fallback={<Play size={13} fill="currentColor" />} title="Start the dev server" onClick={() => preview.start()} />)}
        {isServer && <Borderless symbol="text.alignleft" fallback={<AlignLeft size={13} />} title="Dev server output" active={showLog} onClick={() => setShowLog(!showLog)} />}
        <Borderless symbol="safari" fallback={<Compass size={14} />} title="Open in browser" disabled={!p.url}
          onClick={() => { const u = preview.browserURL(); if (u) appApi.open(u).catch(() => {}); }} />
        {!expanded && <Borderless symbol="arrow.up.left.and.arrow.down.right" fallback={<Maximize2 size={13} />} title="Open the preview in a tab" onClick={() => useWorkspace.getState().open({ kind: "preview" })} />}
        {showLog && <LogPopover onClose={() => setShowLog(false)} />}
      </div>
      <div style={{ height: 0.5, background: "var(--hairline-strong)", flex: "none" }} />

      {/* Content */}
      <div style={{ flex: expanded ? 1 : "none", height: expanded ? undefined : 440, minHeight: 0, background: "var(--subtle)", display: "flex", alignItems: "stretch", justifyContent: "center", position: "relative" }}>
        <Content device={device} canSend={canSend} send={send} />
      </div>

      {p.errors.length > 0 && (
        <>
          <div style={{ height: 0.5, background: "var(--hairline-strong)", flex: "none" }} />
          <div className="row" data-testid="preview-errors" style={{ gap: 10, padding: "7px 12px", background: "color-mix(in srgb, var(--stop) 6%, transparent)", flex: "none" }}>
            <span style={{ color: "var(--stop)", display: "inline-flex", flex: "none" }}><SFSymbol name="exclamationmark.octagon.fill" size={13} fallback={<AlertOctagon size={14} />} /></span>
            <span style={{ fontWeight: 500, fontSize: 12, flex: "none" }}>{p.errors.length} error{p.errors.length === 1 ? "" : "s"} in the page</span>
            <span className="mono muted" style={{ fontSize: 10, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.errors[p.errors.length - 1]}</span>
            <Button size="small" disabled={!canSend} onClick={() => {
              const list = usePreview.getState().errors.map((e) => `- ${e}`).join("\n");
              send(`The live preview of the UI shows these errors:\n${list}\n\nFix them.`);
              preview.clearErrors();
            }}>Send to agent</Button>
            <Borderless symbol="xmark" fallback={<X size={12} />} title="Dismiss" onClick={() => preview.clearErrors()} />
          </div>
        </>
      )}
    </div>
  );
}

function Content({ device, canSend, send }: { device: string; canSend: boolean; send: (t: string) => void }) {
  const p = usePreview();
  const label = sourceLabel(p.source);
  if (p.source.kind === "none") {
    return <Placeholder icon={<SFSymbol name="play.rectangle" size={28} weight="light" fallback={<PlayCircle size={28} strokeWidth={1.25} />} />} title="No UI to preview yet"
      detail="Add a dev script (dev, start, serve or preview) to package.json, or an index.html, and it shows here." />;
  }
  if (p.state === "running" && p.url) {
    const width = device === "tablet" ? 820 : device === "phone" ? 390 : null;
    return (
      <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: width ? 16 : 0, minWidth: 0, overflow: "auto" }}>
        <iframe key={`${p.url}#${p.reloadToken}`} src={p.url} title="Preview" data-testid="preview-frame"
          style={{ border: 0, background: "#fff", width: width ?? "100%", maxWidth: width ?? undefined, flex: width ? "none" : 1, height: "100%",
            borderRadius: width ? 12 : 0, boxShadow: width ? "0 4px 12px rgba(0,0,0,0.12)" : undefined, transition: "width 0.2s ease" }} />
      </div>
    );
  }
  if (p.state === "idle" || p.state === "running") {
    return (
      <Placeholder icon={<SFSymbol name="play.rectangle" size={28} weight="light" fallback={<PlayCircle size={28} strokeWidth={1.25} />} />} title="Preview the UI as it's built"
        detail={`Runs \`${label}\` and shows the page here. It updates as the agent edits files.`}>
        <Button kind="primary" icon={<SFSymbol name="play.fill" size={13} fallback={<Play size={12} fill="currentColor" />} />} style={{ background: DEVELOP }} onClick={() => preview.start()}>Start preview</Button>
      </Placeholder>
    );
  }
  if (p.state === "installing") {
    return <Placeholder icon={<SFSymbol name="shippingbox" size={28} weight="light" fallback={<Package size={28} strokeWidth={1.25} />} />} title="Installing dependencies…" detail={p.log[p.log.length - 1] ?? ""}><Spinner small /></Placeholder>;
  }
  if (p.state === "starting") {
    return <Placeholder icon={<SFSymbol name="bolt.horizontal" size={28} weight="light" fallback={<Zap size={28} strokeWidth={1.25} />} />} title="Starting the dev server…" detail={p.log[p.log.length - 1] ?? ""}><Spinner small /></Placeholder>;
  }
  const message = isFailed(p.state) ? p.state.failed : "";
  return (
    <Placeholder icon={<SFSymbol name="exclamationmark.triangle" size={28} weight="light" fallback={<AlertTriangle size={28} strokeWidth={1.25} />} />} title={message} detail={p.log.slice(-3).join("\n")}>
      <div className="row">
        <Button onClick={() => preview.start()}>Try again</Button>
        <Button disabled={!canSend} onClick={() => send(`The preview (\`${label}\`) fails to start: ${message}\n\nLast output:\n${preview.logTail()}\n\nFix it so the dev server starts.`)}>Ask the agent to fix it</Button>
      </div>
    </Placeholder>
  );
}

function Placeholder({ icon, title, detail, children }: { icon: ReactNode; title: string; detail: string; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center", flex: 1 }}>
      <span style={{ color: DEVELOP, display: "inline-flex" }}>{icon}</span>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
      {detail && <div className="muted" style={{ fontSize: 10, maxWidth: 440, whiteSpace: "pre-line", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{detail}</div>}
      {children}
    </div>
  );
}

function LogPopover({ onClose }: { onClose: () => void }) {
  const log = usePreview((s) => s.log);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => window.addEventListener("mousedown", down));
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, [onClose]);
  const tail = log.slice(-40).join("\n");
  return (
    <div ref={ref} data-testid="preview-log" style={{ position: "absolute", top: "100%", right: 12, width: 520, height: 300, zIndex: 20, background: "var(--card)", borderRadius: 10, boxShadow: "var(--shadow)", overflow: "auto", padding: 12 }}>
      <pre className="selectable mono" style={{ margin: 0, fontSize: 11.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{tail || "No output yet."}</pre>
    </div>
  );
}
