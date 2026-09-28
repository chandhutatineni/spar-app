// The SPAR loop sidebar (WorkSidebar, LoopNavigator, PhaseRow in SidebarView.swift): the four
// phases as a loop, the iterations, and project shortcuts.
//
// Geometry follows the SwiftUI List(.sidebar): its rows sit 10pt in from the sidebar edges with
// 8pt of padding inside the selection, 32pt tall; section headers are 11pt semibold, 20pt tall.
// The loop navigator is a row with zero insets inside the list's 16pt content margins.

import { useEffect, useState, type ReactNode } from "react";
import { BookText, Landmark, MonitorPlay, Plus, Puzzle, RefreshCcw, TrendingUp, Waypoints } from "lucide-react";
import { useWorkspace } from "../../state/workspace";
import { useChat, isRunning, reloadRules } from "../../state/chat";
import { currentPhase, phaseState, selectFeature, selectPhase, startNextIteration, summary, useSpar } from "../../state/spar";
import { call } from "../../lib/backend";
import { SFSymbol } from "../../ui/icons";
import { usePreview } from "../terminal/preview";
import { LIFECYCLE, PHASE, Spar, type Lifecycle } from "./sparcli";
import { LoopRing, PhaseGlyph, prim } from "./parts";
import "./loop.css";

const ROW_H = 50, ROW_GAP = 4, NODE_X = 34;
const y = (i: number) => i * (ROW_H + ROW_GAP) + ROW_H / 2;

/** A sidebar Label's icon: the SF Symbol at body size in a 20pt column. */
function RowIcon({ name, fallback }: { name: string; fallback: ReactNode }) {
  return (
    <span className="sidebar-icon">
      <SFSymbol name={name} size={13} fallback={fallback} />
    </span>
  );
}

export function WorkSidebar() {
  const sp = useSpar();
  const ws = useWorkspace();
  const rules = useChat((s) => s.rules);
  const previewAvail = usePreview((p) => p.source.kind !== "none");
  const [mcpReady, setMcpReady] = useState<number | null>(null);
  useEffect(() => {
    reloadRules();
    call<any>("mcp_state").then((st) => {
      const ok = (st?.servers ?? []).filter((s: any) => s.enabled && st?.status?.[s.id]?.state === "ok").length;
      setMcpReady(ok);
    }).catch(() => setMcpReady(null));
  }, []);
  const active = ws.activeTab;
  const row = (on: boolean) => `sidebar-row ${on ? "selected" : ""}`;
  return (
    <div className="work-sidebar" aria-label="SPAR loop">
      <LoopNavigator />
      <div className="sidebar-section">
        <span>Iterations</span><span className="spacer" />
        <button className="sidebar-section-btn" title="Start a new iteration" aria-label="Start a new iteration" onClick={startNextIteration}>
          <SFSymbol name="plus" size={11} fallback={<Plus size={12} />} />
        </button>
      </div>
      {[...sp.features].map((f, i) => ({ f, i })).reverse().map(({ f, i }) => {
        const current = f === sp.feature && !sp.draftingNewFeature;
        return (
          <button key={f} className={`${row(current && active.kind === "phase")} iteration`} onClick={() => selectFeature(f)}>
            <LoopRing states={sp.featureStages[f] ?? ["todo", "todo", "todo", "todo"]} size={18} lineWidth={2.5} />
            <span className="col" style={{ gap: 1, minWidth: 0 }}>
              <span className="ellipsis" style={{ fontWeight: current ? 600 : 400, lineHeight: "16px" }}>{Spar.featureTitle(f)}</span>
              <span style={{ fontSize: 10, lineHeight: "13px", color: "var(--text-3)" }}>Iteration {i + 1}</span>
            </span>
          </button>
        );
      })}
      {!sp.features.length && <div className="sidebar-note">Your first iteration starts in Discover.</div>}
      <div className="sidebar-section">Project</div>
      <button className={row(active.kind === "rules")} onClick={() => ws.open({ kind: "rules" })}>
        <RowIcon name="text.book.closed" fallback={<BookText size={15} />} />
        <span className="spacer ellipsis">Rules</span>
        {rules.length > 0 && <span className="sidebar-count">{rules.length}</span>}
      </button>
      {sp.architecture && (
        <button className={row(active.kind === "file" && (active as any).path === sp.architecture)} onClick={() => ws.openFile(sp.architecture!)}>
          <RowIcon name="building.columns" fallback={<Landmark size={15} />} /><span className="spacer ellipsis">Architecture</span>
        </button>
      )}
      {sp.feature && (
        <button className={row(active.kind === "trace")} onClick={() => ws.open({ kind: "trace" })}>
          <RowIcon name="point.3.connected.trianglepath.dotted" fallback={<Waypoints size={15} />} /><span className="spacer ellipsis">Traceability</span>
        </button>
      )}
      <button className={row(active.kind === "impact")} onClick={() => ws.open({ kind: "impact" })}>
        <RowIcon name="chart.line.uptrend.xyaxis" fallback={<TrendingUp size={15} />} /><span className="spacer ellipsis">AI Impact</span>
      </button>
      <button className={row(active.kind === "mcp")} onClick={() => ws.open({ kind: "mcp" })}>
        <RowIcon name="puzzlepiece.extension" fallback={<Puzzle size={15} />} />
        <span className="spacer ellipsis">MCP servers</span>
        {mcpReady != null && <span className="sidebar-count" style={{ color: mcpReady > 0 ? "var(--done)" : undefined }}>{mcpReady}</span>}
      </button>
      {previewAvail && (
        <button className={row(active.kind === "preview")} onClick={() => ws.open({ kind: "preview" })}>
          <RowIcon name="play.rectangle" fallback={<MonitorPlay size={15} />} /><span className="spacer ellipsis">Preview</span>
        </button>
      )}
    </div>
  );
}

/** The four phases as a loop: a rail down through Discover, Design, Develop and Deliver, and
 *  an arc that returns from Deliver to Discover. */
function LoopNavigator() {
  const sp = useSpar();
  const title = sp.draftingNewFeature ? "New iteration" : sp.feature ? Spar.featureTitle(sp.feature) : "New iteration";
  const delivered = sp.next?.action === "done";
  const top = y(0), bottom = y(3), left = 9, inner = NODE_X - 14;
  const discover = PHASE.discover.tint;
  // Color.secondary.opacity(0.35 / 0.5): --text-2 is already the secondary label colour.
  const arc = delivered ? discover : "color-mix(in srgb, var(--text-2) 35%, transparent)";
  const head = delivered ? discover : "color-mix(in srgb, var(--text-2) 50%, transparent)";
  return (
    <div className="loop-nav">
      <div className="row" style={{ gap: 6, padding: "0 14px", height: 16 }}>
        <span className="ellipsis" style={{ fontSize: 13, fontWeight: 600, lineHeight: "16px" }}>{title}</span>
        {(sp.draftingNewFeature || !sp.feature) && (
          <span style={{ fontSize: 9, fontWeight: 700, lineHeight: "11px", color: discover, background: `color-mix(in srgb, ${discover} 12%, transparent)`, padding: "2px 5px", borderRadius: 999, flex: "none" }}>NEW</span>
        )}
      </div>
      <div style={{ position: "relative", height: ROW_H * 4 + ROW_GAP * 3 }}>
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }} aria-hidden>
          <defs>
            {[0, 1, 2].map((i) => (
              <linearGradient key={i} id={`rail${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={PHASE[LIFECYCLE[i]].tint} /><stop offset="1" stopColor={PHASE[LIFECYCLE[i + 1]].tint} />
              </linearGradient>
            ))}
          </defs>
          {[0, 1, 2].map((i) => (
            <rect key={i} x={NODE_X - 1} y={y(i) + 13} width={2} height={ROW_H + ROW_GAP - 26} rx={1}
              fill={phaseState(LIFECYCLE[i], sp) === "done" ? `url(#rail${i})` : prim(0.08)} />
          ))}
          <path d={`M ${inner} ${bottom} C ${left + 2} ${bottom}, ${left} ${bottom - 4}, ${left} ${bottom - 14} L ${left} ${top + 14} C ${left} ${top + 4}, ${left + 2} ${top}, ${inner} ${top}`}
            fill="none" stroke={arc} strokeWidth={1.5} strokeLinecap="round" strokeDasharray={delivered ? undefined : "3 4"} />
          <path d={`M ${inner - 5} ${top - 4} L ${inner} ${top} L ${inner - 5} ${top + 4}`} fill="none" stroke={head} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="col" style={{ gap: ROW_GAP, position: "relative" }}>
          {LIFECYCLE.map((p) => <PhaseRow key={p} phase={p} />)}
        </div>
      </div>
      <button className="loop-next" style={{ paddingLeft: NODE_X - 7 }} title="Loop back to Discover with a new brief" onClick={startNextIteration}>
        <SFSymbol name="arrow.triangle.2.circlepath" size={10} weight="medium" fallback={<RefreshCcw size={11} />} />
        <span>Start the next iteration</span>
      </button>
    </div>
  );
}

function PhaseRow({ phase }: { phase: Lifecycle }) {
  const sp = useSpar();
  const activeTab = useWorkspace((w) => w.activeTab);
  const running = useChat(isRunning);
  const selected = sp.phase === phase && activeTab.kind === "phase";
  const st = phaseState(phase, sp);
  const here = currentPhase(sp) === phase && sp.next?.action !== "done" && !sp.draftingNewFeature;
  const sum = summary(phase, sp);
  const review = sum === "Needs your review";
  const tint = PHASE[phase].tint;
  return (
    <button className={`phase-row ${selected ? "selected" : ""}`} onClick={() => selectPhase(phase)} aria-current={selected ? "page" : undefined}
      style={{ paddingLeft: NODE_X - 13, paddingRight: 10, ["--sel" as any]: `color-mix(in srgb, ${tint} 12%, transparent)`, ["--sel-x" as any]: `${NODE_X - 20}px` }}>
      <span style={{ position: "relative", width: 26, height: 26, flex: "none" }}>
        {/* PulseRing: a still ring at the phase SPAR is on, pulsing while it works. */}
        {here && <span className={`pulse-ring ${running ? "" : "still"}`} style={{ borderColor: tint }} />}
        <PhaseGlyph phase={phase} state={st} size={26} />
      </span>
      <span className="col" style={{ gap: 1, minWidth: 0, flex: 1, position: "relative" }}>
        <span style={{ fontSize: 13, lineHeight: "16px", fontWeight: selected ? 600 : 500, color: st === "todo" && !selected ? "var(--text-2)" : "var(--text)" }}>{PHASE[phase].title}</span>
        <span className="ellipsis" style={{ fontSize: 11, lineHeight: "14px", color: review ? tint : "var(--text-2)" }}>{sum}</span>
      </span>
      {review && <span style={{ width: 7, height: 7, borderRadius: 4, background: tint, flex: "none", position: "relative" }} />}
    </button>
  );
}
