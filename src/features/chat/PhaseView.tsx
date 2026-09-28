// The page for one phase of the loop (PhaseView.swift): header, the gate review, the phase's
// artifacts, tasks and changes, testing, and the way into the next iteration.
//
// Typography follows the macOS text styles (title3 15, headline 13 semibold, callout 12,
// subheadline 11, caption 10) and every icon is the SF Symbol PhaseView.swift names.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowRight, BadgeCheck, Check, ChevronLeft, ChevronRight, Eye, FileText, Hammer, Lightbulb, MessageSquareText,
  PencilLine, FilePlus, Play, RefreshCcw, TriangleAlert, Undo2, Upload, CircleCheck, Circle, XCircle, Diamond, Info,
  UserCheck, File, Layers,
} from "lucide-react";
import { Button, Spinner, Toggle } from "../../ui";
import { SFSymbol } from "../../ui/icons";
import { fs, basename } from "../../lib/api";
import { useWorkspace } from "../../state/workspace";
import {
  artifactPath, cancelNewIteration, currentPhase, phaseState, selectPhase, setUIFirst, startNextIteration, useSpar,
} from "../../state/spar";
import { beginRefine, continueWork, decide, focusComposer, isRunning, send, setDraft, useChat } from "../../state/chat";
import { usePref } from "../../lib/prefs";
import { PreviewView } from "../terminal/PreviewView";
import { usePreview } from "../terminal/preview";
import { PILLAR_INFO, TEST_PILLARS, allPillarsInstruction, pillarInstruction, runLocally, taskCommands, testResults, type PillarResult, type TestPillar } from "../terminal/testing";
import { PHASE, Spar, excerpt, nextPhase, previousPhase, type Lifecycle } from "./sparcli";
import { LoopRing, PhaseGlyph, prim } from "./parts";
import { IssueBadge, useIssues } from "../insights";
import "./chat.css";
import "./loop.css";

const openFile = (p: string) => useWorkspace.getState().openFile(p);

/** An SF Symbol at a SwiftUI point size, with a lucide fallback off macOS. */
function Sf({ n, pt = 13, w = "regular", fb, style }: { n: string; pt?: number; w?: string; fb: ReactNode; style?: CSSProperties }) {
  return <SFSymbol name={n} size={pt} weight={w} fallback={fb} style={style} />;
}

/** SwiftUI Label: symbol then title. */
function Label({ n, fb, children, gap = 5, pt = 13, style }: { n: string; fb: ReactNode; children: ReactNode; gap?: number; pt?: number; style?: CSSProperties }) {
  return <span className="label-row" style={{ gap, ...style }}><Sf n={n} pt={pt} fb={fb} />{children}</span>;
}

/** Lifecycle.symbol in Spar.swift. */
const PHASE_SYMBOL: Record<Lifecycle, string> = {
  discover: "sparkle.magnifyingglass", design: "square.on.square.dashed", develop: "hammer", deliver: "shippingbox",
};
/** TestPillar.symbol in Testing.swift. */
const PILLAR_SYMBOL: Record<TestPillar, string> = { unit: "cube", integration: "square.stack.3d.up", e2e: "safari", acceptance: "checkmark.seal" };

const secondary = "var(--text-2)";
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };
const clamp = (n: number): CSSProperties => ({ display: "-webkit-box", WebkitLineClamp: n, WebkitBoxOrient: "vertical", overflow: "hidden" });
const prominent = (tint: string): CSSProperties => ({ background: tint });
/** A tinted, stroked 14pt box (ReviseBox, TestingPanel, GateReview). */
const tintBox = (tint: string, fill: number, stroke: number, pad: number): CSSProperties => ({
  padding: pad, borderRadius: 14, background: `color-mix(in srgb, ${tint} ${fill}%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tint} ${stroke}%, transparent)`,
});

export function PhaseView() {
  const sp = useSpar();
  const phase = sp.phase;
  const chat = useChat();
  const previewAvail = usePreview((p) => p.source.kind !== "none");
  const hasWork = phase === "develop" ? sp.tasks.length > 0 || chat.changes.length > 0 : PHASE[phase].artifacts.some((a) => sp.info.artifacts.includes(a));
  return (
    <div className="phase-page" aria-label={`${PHASE[phase].title} phase`}>
      <div className="phase-page-inner">
        {!sp.feature || sp.draftingNewFeature ? (
          phase === "discover" ? <BriefComposer /> : (
            <>
              <PhaseHeader phase={phase} />
              {(phase === "develop" || phase === "deliver") && previewAvail && <PreviewCard />}
              <NotStarted phase={phase} />
            </>
          )
        ) : (
          <>
            <PhaseHeader phase={phase} />
            {sp.next?.action === "gate" && sp.next.gate === PHASE[phase].gate && <GateReview tint={PHASE[phase].tint} />}
            <PhaseContent phase={phase} />
            {phaseState(phase, sp) !== "todo" && hasWork && <ReviseBox phase={phase} />}
            <PhaseFooter phase={phase} />
          </>
        )}
      </div>
    </div>
  );
}

function PreviewCard() {
  const running = useChat(isRunning);
  const sessionId = useChat((s) => s.sessionId);
  return (
    <div style={{ height: 420, display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", border: `1px solid ${prim(0.08)}`, flex: "none" }}>
      <PreviewView expanded={false} onSend={(t) => send(t)} canSend={!running && !!sessionId} />
    </div>
  );
}

// ---- Header & footer -------------------------------------------------------------------

function PhaseHeader({ phase }: { phase: Lifecycle }) {
  const sp = useSpar();
  const running = useChat(isRunning);
  const st = phaseState(phase, sp);
  const here = currentPhase(sp) === phase && sp.next?.action !== "done";
  const tint = PHASE[phase].tint;
  const [pillText, pillColor] = st === "done" ? ["Complete", "var(--done)"] : st === "current" ? [here ? "In progress" : "Current", tint] : ["Up next", secondary];
  return (
    <div className="col" style={{ gap: 16 }}>
      {sp.feature && !sp.draftingNewFeature && (
        <div className="row" style={{ gap: 6, fontSize: 12, color: secondary }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2 }}>ITERATION {sp.features.indexOf(sp.feature) + 1}</span>
          <span>·</span><span style={ellipsis}>{Spar.featureTitle(sp.feature)}</span>
        </div>
      )}
      <div className="row" style={{ gap: 18 }}>
        <PhaseGlyph phase={phase} state={st} size={54} />
        <div className="col" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 32, fontWeight: 700, lineHeight: "38px" }}>{PHASE[phase].title}</span>
          <span style={{ fontSize: 15, lineHeight: "19px", color: secondary }}>{PHASE[phase].purpose}</span>
        </div>
        <span style={{ marginLeft: 12, flex: "none", fontSize: 10, fontWeight: 600, lineHeight: "13px", padding: "5px 10px", borderRadius: 999, color: pillColor, background: `color-mix(in srgb, ${pillColor} 12%, transparent)` }}>{pillText}</span>
      </div>
      {here && sp.next && (running || sp.next.action !== "gate") && (
        <div className="row" style={{ gap: 8, fontSize: 12, minWidth: 0 }}>
          {running ? <><Spinner small /><span style={{ color: secondary }}>SPAR is working on this phase now</span></>
            : (
              <>
                <Sf n="arrow.forward.circle.fill" pt={12} fb={<ArrowRight size={14} />} style={{ color: tint }} />
                <span style={{ fontWeight: 500, flex: "none" }}>Next step: {Spar.actionTitle(sp.next)}</span>
                <span style={{ ...ellipsis, color: secondary }}>— {sp.next.reason}</span>
              </>
            )}
        </div>
      )}
    </div>
  );
}

function PhaseFooter({ phase }: { phase: Lifecycle }) {
  return (
    <div className="row" style={{ paddingTop: 8 }}>
      {phase !== "discover" && (
        <button className="phase-link" onClick={() => selectPhase(previousPhase(phase))}>
          <Label n="chevron.left" pt={12} fb={<ChevronLeft size={13} />}>{PHASE[previousPhase(phase)].title}</Label>
        </button>
      )}
      <span className="spacer" />
      {phase === "deliver"
        ? <button className="phase-link" onClick={startNextIteration}><Label n="arrow.triangle.2.circlepath" pt={12} fb={<RefreshCcw size={13} />}>Start the next iteration</Label></button>
        : <button className="phase-link" onClick={() => selectPhase(nextPhase(phase))}>{PHASE[nextPhase(phase)].title} <Sf n="chevron.right" pt={12} fb={<ChevronRight size={13} />} /></button>}
    </div>
  );
}

/** SectionTitle: a headline that sits 16pt above what it titles. */
function SectionTitle({ children }: { children: ReactNode }) {
  return <span className="headline" style={{ marginBottom: -14 }}>{children}</span>;
}

function PhaseContent({ phase }: { phase: Lifecycle }) {
  const sp = useSpar();
  const changes = useChat((s) => s.changes);
  const previewAvail = usePreview((p) => p.source.kind !== "none");
  const f = sp.feature!;
  const present = sp.info.artifacts;
  switch (phase) {
    case "discover":
      return <DiscoverContent feature={f} />;
    case "design": {
      const files = PHASE.design.artifacts.filter((a) => present.includes(a));
      if (!files.length) return <NotStarted phase={phase} />;
      return (
        <>
          <div className="grid-cards">{files.map((file) => <ArtifactCard key={file} path={artifactPath(file)!} title={Spar.artifactTitle(file)} tint={PHASE.design.tint} />)}</div>
          {sp.info.contracts.length > 0 && (
            <>
              <SectionTitle>Contracts</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                {sp.info.contracts.map((p) => (
                  <button key={p} onClick={() => openFile(p)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, border: 0, background: prim(0.04), color: "inherit", textAlign: "left", minWidth: 0 }}>
                    <Sf n="doc.plaintext" fb={<FileText size={13} />} /><span style={ellipsis}>{basename(p)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      );
    }
    case "develop":
      return (
        <>
          {previewAvail && <><UIFirstBar /><PreviewCard /></>}
          {!sp.tasks.length && !previewAvail && !changes.length ? <NotStarted phase={phase} /> : (
            <>
              {sp.tasks.length > 0 && <NowBuilding />}
              {sp.tasks.length > 0 && <TaskBoard />}
              {changes.length > 0 && <ChangesCard />}
              {present.includes("build-log.md") && <ArtifactCard path={artifactPath("build-log.md")!} title="Build log" tint={PHASE.develop.tint} />}
            </>
          )}
        </>
      );
    case "deliver":
      return (
        <>
          <TestingPanel />
          {previewAvail && <PreviewCard />}
          <DeliverContent feature={f} />
        </>
      );
  }
}

function DiscoverContent({ feature }: { feature: string }) {
  const sp = useSpar();
  const running = useChat(isRunning);
  const q = sp.info.openQuestions;
  return (
    <div className="col" style={{ gap: 16 }}>
      {q > 0 && (
        <div className="card row" style={{ gap: 12, padding: 16 }}>
          <Sf n="questionmark.bubble.fill" pt={17} fb={<MessageSquareText size={20} />} style={{ color: "var(--warn)" }} />
          <div className="col" style={{ gap: 2, flex: 1 }}>
            <span className="headline">{q} open question{q === 1 ? "" : "s"} in the spec</span>
            <span style={{ fontSize: 12, color: secondary }}>Answer them so the design rests on decisions, not guesses.</span>
          </div>
          <Button disabled={running} onClick={() => send(`/spar.explore ${feature}`)}>Answer questions</Button>
        </div>
      )}
      {/* HStack(alignment: .top, spacing: 16) of equal-width cards. */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {sp.info.briefPath && <div style={{ flex: 1, minWidth: 0 }}><ArtifactCard path={sp.info.briefPath} title="Brief" tint={PHASE.discover.tint} lines={5} /></div>}
        {sp.info.artifacts.includes("spec.md") && <div style={{ flex: 1, minWidth: 0 }}><ArtifactCard path={artifactPath("spec.md")!} title="Spec" tint={PHASE.discover.tint} lines={5} /></div>}
      </div>
    </div>
  );
}

function DeliverContent({ feature }: { feature: string }) {
  const sp = useSpar();
  const delivered = sp.next?.action === "done";
  const followOn = (title: string, symbol: string, fb: ReactNode, detail: string, run: () => void) => (
    <button className="card row" style={{ gap: 12, flex: 1, textAlign: "left", padding: 14, color: "inherit" }} onClick={run}>
      <Sf n={symbol} pt={15} fb={fb} style={{ color: PHASE.deliver.tint }} />
      <span className="col" style={{ gap: 2 }}><span style={{ fontWeight: 600 }}>{title}</span><span style={{ fontSize: 10, color: secondary }}>{detail}</span></span>
    </button>
  );
  return (
    <div className="col" style={{ gap: 18 }}>
      {sp.info.artifacts.includes("verification.md")
        ? <ArtifactCard path={artifactPath("verification.md")!} title="Verification" tint={PHASE.deliver.tint} lines={4} />
        : <NotStarted phase="deliver" />}
      {delivered && (
        <div className="row" style={{ gap: 12 }}>
          {followOn("Export to your tracker", "tray.and.arrow.up", <Upload size={18} />, "Create issues for every task", () => send(Spar.stepRequest("issues", feature)))}
          {followOn("Run a retrospective", "lightbulb", <Lightbulb size={18} />, "Turn lessons into governance", () => send(Spar.stepRequest("retro", feature)))}
        </div>
      )}
      <div className="card row" style={{ gap: 16, padding: 18 }}>
        <LoopRing states={["done", "done", "done", delivered ? "done" : "current"]} size={44} lineWidth={5} />
        <div className="col" style={{ gap: 3, flex: 1 }}>
          <span className="headline">{delivered ? "This iteration is complete" : "Every delivery starts the next loop"}</span>
          <span style={{ fontSize: 12, color: secondary }}>Take what you learned back to Discover and start the next iteration.</span>
        </div>
        <Button kind="primary" size="large" style={prominent(PHASE.discover.tint)} icon={<Sf n="arrow.triangle.2.circlepath" fb={<RefreshCcw size={14} />} />} onClick={startNextIteration}>Next iteration</Button>
      </div>
    </div>
  );
}

function NotStarted({ phase }: { phase: Lifecycle }) {
  const sp = useSpar();
  const running = useChat(isRunning);
  const sessionId = useChat((s) => s.sessionId);
  const current = currentPhase(sp) === phase;
  const tint = PHASE[phase].tint;
  return (
    <div className="col" style={{ alignItems: "center", gap: 12, padding: "44px 0", position: "relative" }}>
      {/* strokeBorder(lineWidth 1, dash [5, 4]) in Theme.hairline.opacity(2), 14pt corners. */}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }} aria-hidden>
        <rect x={0.5} y={0.5} rx={14} style={{ width: "calc(100% - 1px)", height: "calc(100% - 1px)" }} fill="none" stroke={prim(0.16)} strokeWidth={1} strokeDasharray="5 4" />
      </svg>
      <Sf n={PHASE_SYMBOL[phase]} pt={28} w="light" fb={<Layers size={30} />} style={{ color: `color-mix(in srgb, ${tint} 80%, transparent)` }} />
      <span style={{ fontSize: 15, color: secondary }}>{current ? `SPAR is ready to start ${PHASE[phase].title.toLowerCase()}.` : PHASE[phase].notStartedText}</span>
      {current && sp.feature && !sp.draftingNewFeature && (
        <Button kind="primary" style={prominent(tint)} icon={<Sf n="play.fill" fb={<Play size={12} />} />} disabled={running || !sessionId} onClick={() => continueWork()}>Start {PHASE[phase].title}</Button>
      )}
    </div>
  );
}

// ---- Testing ---------------------------------------------------------------------------

function TestingPanel() {
  const sp = useSpar();
  const running = useChat(isRunning);
  const sessionId = useChat((s) => s.sessionId);
  const [results, setResults] = useState<Partial<Record<TestPillar, PillarResult>>>({});
  const reportPath = artifactPath("test-report.md");
  const [hasReport, setHasReport] = useState(false);
  useEffect(() => {
    testResults(sp.root, sp.feature).then(setResults).catch(() => setResults({}));
    if (reportPath) fs.exists(reportPath).then(setHasReport).catch(() => setHasReport(false));
  }, [sp.version, sp.feature]);
  const passed = TEST_PILLARS.filter((p) => results[p]?.state === "pass").length;
  const disabled = running || !sessionId;
  const f = sp.feature!;
  const tint = PHASE.deliver.tint;
  return (
    <div className="col" style={{ gap: 14, ...tintBox(tint, 5, 20, 18) }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="col" style={{ gap: 2, flex: 1 }}>
          <span className="headline">Test before delivering</span>
          <span style={{ fontSize: 12, color: passed === 4 ? "var(--done)" : secondary }}>
            {passed === 4 ? "All four pillars pass. Ready to deliver." : `${passed} of 4 pillars pass. Deliver when all four do, or deliver now and finish testing after.`}
          </span>
        </div>
        <Button icon={<Sf n="play" fb={<Play size={12} />} />} title="Run the project's tests and start the app, without the agent" onClick={() => runLocally()}>Run locally</Button>
        <Button kind="primary" style={{ ...prominent(tint), marginLeft: 8 }} icon={<Sf n="checkmark.diamond" fb={<Diamond size={12} />} />} disabled={disabled} onClick={() => send(allPillarsInstruction(f, taskCommands()))}>Run all four</Button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {TEST_PILLARS.map((p) => {
          const r = results[p];
          return (
            <div key={p} className="card col" style={{ padding: 12, gap: 8 }}>
              <div className="row" style={{ fontSize: 10, fontWeight: 600 }}>
                <Sf n={PILLAR_SYMBOL[p]} pt={10} fb={<Layers size={12} />} style={{ color: tint }} />
                <span className="headline">{PILLAR_INFO[p].title}</span>
                <span className="spacer" />
                {r?.state === "pass" ? <Label n="checkmark.circle.fill" pt={10} gap={3} fb={<CircleCheck size={11} />} style={{ color: "var(--done)" }}>Pass</Label>
                  : r?.state === "fail" ? <Label n="xmark.circle.fill" pt={10} gap={3} fb={<XCircle size={11} />} style={{ color: "var(--stop)" }}>Fail</Label>
                  : <span style={{ color: "var(--text-3)" }}>Not run</span>}
              </div>
              <span style={{ fontSize: 10, color: secondary, ...clamp(3) }}>{r?.detail || PILLAR_INFO[p].detail}</span>
              <div><Button size="small" disabled={disabled} onClick={() => send(pillarInstruction(p, f, taskCommands()))}>{r ? "Run again" : "Run"}</Button></div>
            </div>
          );
        })}
      </div>
      {hasReport && reportPath && <button className="phase-link" style={{ alignSelf: "flex-start", fontSize: 10, fontWeight: 400 }} onClick={() => openFile(reportPath)}>Open test report</button>}
    </div>
  );
}

/** UI-first delivery: the interface with mock data, reviewed, then integration. */
function UIFirstBar() {
  const approved = useSpar((s) => s.uiApproved);
  const root = useSpar((s) => s.root);
  const [on] = usePref<boolean>(`uiFirst:${root}`, true);
  const tint = PHASE.develop.tint;
  return (
    <div className="row" style={{ gap: 10, padding: "10px 14px", borderRadius: 12, background: `color-mix(in srgb, ${tint} 6%, transparent)` }}>
      <Sf n="rectangle.on.rectangle.angled" fb={<Eye size={15} />} style={{ color: tint }} />
      <div className="col" style={{ gap: 1, flex: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>UI first with mock data</span>
        <span style={{ fontSize: 10, color: secondary }}>{approved ? "UI approved; integrating real data." : "Build the interface with mock data, review it here, then integrate."}</span>
      </div>
      {approved ? <Label n="checkmark.seal.fill" pt={10} gap={4} fb={<BadgeCheck size={12} />} style={{ fontSize: 10, color: "var(--done)" }}>Approved</Label>
        : <span className="phase-toggle-small"><Toggle on={on} onChange={(v) => setUIFirst(v)} /></span>}
    </div>
  );
}

// ---- Develop ---------------------------------------------------------------------------

function NowBuilding() {
  const sp = useSpar();
  const entries = useChat((s) => s.entries);
  const running = useChat(isRunning);
  const open = sp.tasks.flatMap((g) => g.tasks.filter((t) => !t.done).map((t) => ({ group: g.id, task: t })));
  if (!open.length) return null;
  const edits: { name: string; summary: string }[] = [];
  for (let i = entries.length - 1; i >= 0 && edits.length < 4; i--) {
    const k = entries[i].kind;
    if (k.type === "tool" && !k.failed && (k.name === "Edited" || k.name === "Wrote") && k.summary && !edits.some((e) => e.summary === k.summary)) edits.push(k);
  }
  const building = running && currentPhase(sp) === "develop";
  const { group, task } = open[0];
  const tint = PHASE.develop.tint;
  return (
    <div className="card row" style={{ alignItems: "flex-start", gap: 14, padding: 16 }}>
      <span style={{ width: 38, height: 38, borderRadius: 19, background: `color-mix(in srgb, ${tint} 14%, transparent)`, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        {building ? <Spinner small /> : <Sf n="hammer.fill" fb={<Hammer size={16} />} style={{ color: tint }} />}
      </span>
      <div className="col" style={{ gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: tint }}>{building ? "NOW BUILDING" : "NEXT UP"}</span>
        <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
          <span className="mono" style={{ fontSize: 12, color: secondary, flex: "none" }}>{task.id}</span>
          <span className="headline" style={clamp(2)}>{task.title}</span>
        </div>
        <span style={{ fontSize: 10, color: secondary }}>{group}</span>
        {edits.length > 0 && (
          <div className="row" style={{ gap: 6, paddingTop: 4, flexWrap: "wrap" }}>
            {edits.map((e) => (
              <Label key={e.summary} n={e.name === "Wrote" ? "doc.badge.plus" : "pencil"} pt={10} gap={4} fb={e.name === "Wrote" ? <FilePlus size={11} /> : <PencilLine size={11} />}
                style={{ fontSize: 10, padding: "3px 7px", borderRadius: 999, background: prim(0.04) }}>{e.summary}</Label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskBoard() {
  const sp = useSpar();
  const issues = useIssues();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const total = sp.tasks.reduce((n, g) => n + g.tasks.length, 0);
  const done = sp.tasks.reduce((n, g) => n + g.tasks.filter((t) => t.done).length, 0);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row">
        <span className="headline">Tasks</span><span className="spacer" />
        <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: secondary }}>{done} of {total} done</span>
        {issues.epic && <IssueBadge issue={issues.epic} prefix="Epic" />}
        <Button size="small" onClick={() => useWorkspace.getState().open({ kind: "trace" })}>Traceability</Button>
        <Button size="small" onClick={() => { const p = artifactPath("tasks.md"); if (p) openFile(p); }}>Open tasks.md</Button>
      </div>
      {/* ProgressView(value:).tint(develop): a 4pt rounded track. */}
      <div style={{ height: 4, borderRadius: 2, background: prim(0.1) }}><div style={{ width: `${(done / Math.max(total, 1)) * 100}%`, height: "100%", borderRadius: 2, background: PHASE.develop.tint }} /></div>
      {sp.tasks.map((g) => {
        const all = expanded.has(g.id);
        const gd = g.tasks.filter((t) => t.done).length;
        return (
          <div key={g.id} className="card col" style={{ gap: 8, padding: 14 }}>
            <div className="row">
              <span style={{ fontSize: 11, fontWeight: 600 }}>{g.id}</span><span className="spacer" />
              <span style={{ fontSize: 10, fontVariantNumeric: "tabular-nums", color: gd === g.tasks.length ? "var(--done)" : secondary }}>{gd}/{g.tasks.length}</span>
            </div>
            {(all ? g.tasks : g.tasks.slice(0, 6)).map((t) => (
              <div key={t.id} className="row" style={{ gap: 10, alignItems: "baseline", fontSize: 12 }}>
                <span style={{ alignSelf: "flex-start", display: "inline-flex", height: 15, alignItems: "center" }}>
                  {t.done ? <Sf n="checkmark.circle.fill" pt={12} fb={<CircleCheck size={13} />} style={{ color: "var(--done)" }} />
                    : <Sf n="circle" pt={12} fb={<Circle size={13} />} style={{ color: "color-mix(in srgb, var(--text-2) 60%, transparent)" }} />}
                </span>
                <span className="mono" style={{ fontSize: 10, color: secondary, flex: "none" }}>{t.id}</span>
                <span style={{ color: t.done ? secondary : "var(--text)", flex: 1, ...clamp(2) }}>{t.title}</span>
                {issues[t.id] && <IssueBadge issue={issues[t.id]} />}
              </div>
            ))}
            {g.tasks.length > 6 && (
              <button className="phase-link" style={{ alignSelf: "flex-start", fontSize: 10, fontWeight: 400 }} onClick={() => { const n = new Set(expanded); if (all) n.delete(g.id); else n.add(g.id); setExpanded(n); }}>
                {all ? "Show fewer" : `Show ${g.tasks.length - 6} more`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Text truncated in the middle (.truncationMode(.middle)): the tail always shows. */
function MiddleTruncated({ text }: { text: string }) {
  const cut = Math.max(0, text.length - 18);
  return (
    <span style={{ display: "flex", minWidth: 0, flex: 1, whiteSpace: "nowrap" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{text.slice(0, cut)}</span>
      <span style={{ flex: "none" }}>{text.slice(cut)}</span>
    </span>
  );
}

function ChangesCard() {
  const changes = useChat((s) => s.changes);
  return (
    <div className="card col" style={{ gap: 8, padding: 14 }}>
      <div className="row">
        <span className="headline">Changes</span><span className="spacer" />
        <span style={{ fontSize: 12, color: secondary }}>{changes.length} file{changes.length === 1 ? "" : "s"}</span>
        <Button size="small" onClick={() => useWorkspace.getState().open({ kind: "review" })}>Review changes</Button>
      </div>
      {changes.slice(0, 10).map((c) => (
        <button key={c.path} className="row" style={{ gap: 8, fontSize: 12, background: "none", border: 0, padding: 0, color: "inherit", textAlign: "left", width: "100%", minWidth: 0 }}
          onClick={() => useWorkspace.getState().open({ kind: "diff", path: c.path })}>
          <Sf n="doc" pt={12} fb={<File size={13} />} style={{ color: secondary }} />
          <MiddleTruncated text={c.path} />
          <span className="mono" style={{ fontWeight: 700, fontSize: 10, color: c.status === "created" ? "var(--done)" : c.status === "deleted" ? "var(--stop)" : "var(--warn)" }}>
            {c.status === "created" ? "A" : c.status === "deleted" ? "D" : "M"}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---- Artifacts -------------------------------------------------------------------------

export function ArtifactCard({ path, title, tint = "var(--accent)", lines = 3 }: { path: string; title: string; tint?: string; lines?: number }) {
  const version = useSpar((s) => s.version);
  const { gates, next } = useSpar();
  const [text, setText] = useState("");
  useEffect(() => { fs.readText(path).then((t) => setText(excerpt(t))).catch(() => setText("")); }, [path, version]);
  const file = basename(path);
  const gate = Spar.isArtifactPath(path) ? Object.values(gates).find((g) => g.artifacts.includes(file)) : undefined;
  let status: ReactNode = null;
  if (gate) {
    if (gate.approved && gate.stale !== true) status = <Label n="checkmark.seal.fill" fb={<BadgeCheck size={13} />} style={{ color: "var(--done)" }}>Approved</Label>;
    else if (gate.stale === true) status = <Label n="exclamationmark.circle" fb={<TriangleAlert size={13} />} style={{ color: "var(--warn)" }}>Changed since approval</Label>;
    else if (gate.changes_requested) status = <Label n="arrow.uturn.backward" fb={<Undo2 size={13} />} style={{ color: "var(--warn)" }}>Changes requested</Label>;
    else if (next?.gate === gate.gate) status = <Label n="eye" fb={<Eye size={13} />} style={{ color: tint }}>Needs your review</Label>;
  }
  return (
    <button className="art-card" onClick={() => openFile(path)} aria-label={`Open ${title}`} style={{ width: "100%" }}>
      <div className="row" style={{ gap: 8, width: "100%" }}>
        <span style={{ width: 3, height: 16, borderRadius: 2, background: tint, flex: "none" }} />
        <span className="headline">{title}</span><span className="spacer" />{status}
      </div>
      <span style={{ fontSize: 12, color: secondary, width: "100%", ...clamp(lines) }}>{text}</span>
      <span className="art-open" style={{ alignSelf: "flex-end", fontSize: 10, fontWeight: 500, color: tint }}>Open</span>
    </button>
  );
}

// ---- Iterating -------------------------------------------------------------------------

function ReviseBox({ phase }: { phase: Lifecycle }) {
  const sessionId = useChat((s) => s.sessionId);
  const tint = PHASE[phase].tint;
  return (
    <div className="row" style={{ gap: 14, ...tintBox(tint, 5, 15, 18) }}>
      <Sf n="arrow.triangle.2.circlepath" pt={15} fb={<RefreshCcw size={18} />} style={{ color: tint }} />
      <div className="col" style={{ gap: 3, flex: 1 }}>
        <span className="headline">Refine {PHASE[phase].title.toLowerCase()}</span>
        <span style={{ fontSize: 12, color: secondary }}>Tell SPAR what to change in the chat. It reworks this phase and reopens any approval that depended on it.</span>
      </div>
      <Button kind="primary" style={{ ...prominent(tint), marginLeft: 8 }} icon={<Sf n="text.bubble" fb={<MessageSquareText size={12} />} />} disabled={!sessionId} onClick={() => beginRefine(phase)}>Refine in chat</Button>
    </div>
  );
}

/** A human gate, shown on the page of the phase it closes. */
function GateReview({ tint }: { tint: string }) {
  const sp = useSpar();
  const running = useChat(isRunning);
  const [requesting, setRequesting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = sp.next!;
  const gate = next.gate ?? "";
  const doDecide = async (approve: boolean) => {
    setBusy(true);
    const err = await decide(gate, approve, note);
    setError(err);
    setBusy(false);
    if (!err) {
      // Send the feedback straight back into the loop.
      if (!approve) continueWork(`Changes requested at ${gate}: ${note}`);
      setNote("");
      setRequesting(false);
    }
  };
  return (
    <div className="col" style={{ gap: 14, ...tintBox(tint, 6, 35, 20) }} aria-label="Your review">
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <Sf n="person.crop.circle.badge.checkmark" pt={26} fb={<UserCheck size={28} />} style={{ color: tint }} />
        <div className="col" style={{ gap: 3 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Your review: {Spar.actionTitle(next).replace("Review the ", "")}</span>
          <span style={{ color: secondary }}>{next.reason}</span>
        </div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {(sp.gates[gate]?.artifacts ?? []).map((file) => (
          <Button key={file} icon={<Sf n="doc.text" fb={<FileText size={12} />} />} onClick={() => { const p = artifactPath(file); if (p) openFile(p); }}>Read {Spar.artifactTitle(file).toLowerCase()}</Button>
        ))}
      </div>
      {requesting && <textarea className="text-area" rows={3} autoFocus placeholder="What should change?" value={note} onChange={(e) => setNote(e.target.value)} />}
      {error && <span className="selectable" style={{ fontSize: 10, color: "var(--stop)" }}>{error}</span>}
      <div className="row">
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>Your decision is recorded in the project's decision ledger.</span>
        <span className="spacer" />
        {requesting ? (
          <>
            <Button onClick={() => setRequesting(false)}>Cancel</Button>
            <Button disabled={!note.trim() || busy} onClick={() => doDecide(false)}>Send back</Button>
          </>
        ) : (
          <>
            <Button onClick={() => setRequesting(true)}>Request changes</Button>
            <Button kind="primary" style={{ ...prominent(tint), minWidth: 90 }} icon={<Sf n="checkmark" fb={<Check size={12} />} />} disabled={busy || running} onClick={() => doDecide(true)}>Approve</Button>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Starting an iteration -------------------------------------------------------------

const EXAMPLES = [
  "A CLI that records daily standup notes in the repo and shows today's notes, blockers first",
  "Add sign-in with email magic links to the web app",
  "A settings page where users can export their data as CSV",
];

function BriefComposer() {
  const sp = useSpar();
  useEffect(() => { focusComposer(); }, []);
  const tint = PHASE.discover.tint;
  return (
    <div className="col" style={{ gap: 20, paddingTop: 24 }}>
      <div className="row" style={{ gap: 14 }}>
        <PhaseGlyph phase="discover" state="current" size={54} />
        <div className="col" style={{ gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, color: secondary }}>ITERATION {sp.features.length + (sp.draftingNewFeature || !sp.feature ? 1 : 0)}</span>
          <span style={{ fontSize: 32, fontWeight: 700, lineHeight: "38px" }}>What do you want to build?</span>
        </div>
      </div>
      <span style={{ fontSize: 15, lineHeight: "19px", color: secondary }}>Describe the problem, who has it and what good looks like, in a sentence or a page. SPAR turns it into a spec, designs it, builds it and proves it, and stops only when it needs your review.</span>
      <div className="card row" style={{ gap: 12, padding: 16 }}>
        <Sf n="text.bubble.fill" pt={17} fb={<MessageSquareText size={20} />} style={{ color: tint }} />
        <div className="col" style={{ gap: 2, flex: 1 }}>
          <span className="headline">Type your idea in the chat</span>
          <span style={{ fontSize: 12, color: secondary }}>Press ↩ to start discovery. Use @ to point at files or folders it should know about.</span>
        </div>
        <Button kind="primary" style={prominent(tint)} icon={<Sf n="arrow.right" fb={<ArrowRight size={12} />} />} onClick={focusComposer}>Go to chat</Button>
      </div>
      <div className="col" style={{ gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: secondary }}>Or start from an example</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="example-row" onClick={() => { setDraft(ex); focusComposer(); }}>
            <Sf n="lightbulb" pt={12} fb={<Lightbulb size={14} />} style={{ color: tint }} /> <span>{ex}</span>
          </button>
        ))}
      </div>
      {sp.next?.action === "run" && !sp.next.feature && (
        <Label n="info.circle" pt={12} fb={<Info size={13} />} style={{ fontSize: 12, color: secondary }}>SPAR will {Spar.actionTitle(sp.next).toLowerCase()} first.</Label>
      )}
      {sp.draftingNewFeature && sp.features.length > 0 && (
        <button className="phase-link" style={{ alignSelf: "flex-start", fontSize: 13, fontWeight: 400 }} onClick={cancelNewIteration}>Cancel new iteration</button>
      )}
    </div>
  );
}
