// The bottom terminal panel (the Mac app's TerminalPanel in Views/Terminal.swift): several
// terminals as tabs, a drag handle to resize, new / restart / settings / hide.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Plus, RotateCw, Settings, SquareTerminal, X } from "lucide-react";
import { app as appApi } from "../../lib/api";
import { usePref } from "../../lib/prefs";
import { promptText } from "../../lib/dialogs";
import { useWorkspace } from "../../state/workspace";
import { contextMenu } from "../../ui";
import { SFSymbol } from "../../ui/icons";

/** A SwiftUI .borderless small-control button: no bezel, accent tinted, an 11pt symbol. */
function Borderless({ symbol, fallback, title, onClick, disabled }: { symbol: string; fallback: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      style={{ border: 0, background: "transparent", padding: "0 3px", height: 20, display: "inline-flex", alignItems: "center", color: "var(--accent)", opacity: disabled ? 0.35 : 1, flex: "none", cursor: "default" }}>
      <SFSymbol name={symbol} size={11} fallback={fallback} />
    </button>
  );
}
import {
  applyThemeToAll, clearTerminal, closeTerminal, focusTerminal, isDark, newTerminal, renameTerminal,
  restartTerminal, selectTerminal, sessionFor, useTerminals, type TerminalInfo,
} from "./terminals";

export function TerminalPanel(_p: Record<string, unknown> = {}) {
  const { terminals, active } = useTerminals();
  const [height, setHeight] = usePref("terminalHeight", 240);
  const stack = useRef<HTMLDivElement>(null);
  const activeId = terminals.find((t) => t.id === active)?.id ?? terminals[0]?.id;

  // Showing the panel with no terminals starts one (Workspace.toggleTerminal).
  useEffect(() => {
    if (!useTerminals.getState().terminals.length) newTerminal();
    else focusTerminal();
  }, []);

  useTheme();

  // Keep every terminal fitted to the panel.
  useEffect(() => {
    const el = stack.current;
    if (!el) return;
    const ro = new ResizeObserver(() => useTerminals.getState().terminals.forEach((t) => sessionFor(t.id)?.resize()));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { if (activeId) sessionFor(activeId)?.resize(); }, [activeId]);

  const h = Math.min(700, Math.max(120, Number(height) || 240));
  return (
    <div data-testid="terminal-panel" style={{ height: h, flex: "none", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <ResizeHandle height={h} onChange={setHeight} />
      <div className="row" style={{ gap: 4, padding: "4px 10px", flex: "none" }}>
        <span className="muted" style={{ display: "inline-flex", marginRight: 4, flex: "none" }}><SFSymbol name="terminal" size={10} fallback={<SquareTerminal size={12} />} /></span>
        <div role="tablist" aria-label="Terminals" style={{ display: "flex", gap: 2, overflowX: "auto", minWidth: 0, flex: 1, scrollbarWidth: "none" }}>
          {terminals.map((t) => <Tab key={t.id} t={t} active={t.id === activeId} />)}
        </div>
        <Borderless symbol="plus" fallback={<Plus size={13} />} title="New terminal" onClick={() => newTerminal()} />
        <Borderless symbol="arrow.clockwise" fallback={<RotateCw size={12} />} title="Restart this shell" onClick={() => { restartTerminal(); focusTerminal(); }} disabled={!activeId} />
        <Borderless symbol="gearshape" fallback={<Settings size={12} />} title="Terminal settings" onClick={() => appApi.settings().catch(() => {})} />
        <Borderless symbol="chevron.down" fallback={<ChevronDown size={13} />} title="Hide the terminal (⌃`)" onClick={() => useWorkspace.getState().setShowTerminal(false)} />
      </div>
      <div ref={stack} style={{ flex: 1, position: "relative", minHeight: 0, overflow: "hidden" }}>
        {terminals.map((t) => <Host key={t.id} id={t.id} visible={t.id === activeId} />)}
      </div>
    </div>
  );
}

function Tab({ t, active }: { t: TerminalInfo; active: boolean }) {
  const rename = async () => {
    const title = await promptText("Rename Terminal", undefined, t.title);
    if (title != null) renameTerminal(t.id, title);
    focusTerminal(t.id);
  };
  return (
    <div role="tab" aria-selected={active} title={t.title}
      onClick={() => selectTerminal(t.id)}
      onDoubleClick={rename}
      onContextMenu={contextMenu(() => [
        { label: "Rename…", onClick: rename },
        { label: "Clear", onClick: () => { clearTerminal(t.id); focusTerminal(t.id); } },
        { label: "Restart Shell", onClick: () => restartTerminal(t.id) },
        "divider",
        { label: "Close", onClick: () => closeTerminal(t.id) },
      ])}
      style={{
        display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 5, flex: "none", cursor: "default",
        background: active ? "var(--hairline)" : "transparent", fontSize: 10, fontWeight: active ? 600 : 400,
        color: t.exited !== undefined ? "var(--text-2)" : "var(--text)",
      }}>
      <span style={{ whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
      <button type="button" aria-label={`Close ${t.title}`} title="Close"
        onClick={(e) => { e.stopPropagation(); closeTerminal(t.id); }}
        style={{ border: 0, background: "transparent", padding: 0, display: "inline-flex", color: "var(--text-2)" }}>
        <SFSymbol name="xmark" size={8} weight="bold" fallback={<X size={10} strokeWidth={3} />} />
      </button>
    </div>
  );
}

function Host({ id, visible }: { id: string; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const s = sessionFor(id);
    if (ref.current && s) s.attach(ref.current);
  }, [id]);
  useEffect(() => {
    if (visible) { sessionFor(id)?.resize(); }
  }, [visible, id]);
  return (
    <div ref={ref} data-terminal-id={id} onMouseDown={() => useTerminals.setState({ active: id })}
      style={{ position: "absolute", inset: 0, opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }} />
  );
}

/** The hairline at the top of the panel: drag to resize (120–700 px). */
function ResizeHandle({ height, onChange }: { height: number; onChange: (v: number) => void }) {
  const start = useRef<{ y: number; h: number } | null>(null);
  return (
    <div
      role="separator" aria-orientation="horizontal" aria-label="Resize the terminal"
      onDoubleClick={() => onChange(240)}
      onMouseDown={(e) => {
        e.preventDefault();
        start.current = { y: e.clientY, h: height };
        const move = (ev: MouseEvent) => {
          if (!start.current) return;
          onChange(Math.min(700, Math.max(120, start.current.h - (ev.clientY - start.current.y))));
        };
        const up = () => { start.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        document.body.style.cursor = "row-resize";
      }}
      style={{ height: 9, margin: "-4px 0", flex: "none", cursor: "row-resize", position: "relative", zIndex: 5,
        background: "linear-gradient(transparent 4px, var(--hairline) 4px, var(--hairline) 5px, transparent 5px)" }}
    />
  );
}

/** Light/dark: follows the app's appearance (preference or system). */
function useTheme() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const update = () => setDark(isDark());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { mq.removeEventListener("change", update); mo.disconnect(); };
  }, []);
  useEffect(() => applyThemeToAll(dark), [dark]);
}
