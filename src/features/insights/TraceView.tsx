// End-to-end traceability for the current iteration: requirement → spec item → task → code →
// test, as a matrix, a graph, per service, and every document behind it. Tasks carry their
// Jira issues once they've been exported. A port of Views/TraceView.swift.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Award, BadgeCheck, CheckCircle2, Circle, Code, FileSearch, FileText, Files, Layers, ListChecks, Package,
  SquareArrowOutUpRight, SquareDashed, Table, TriangleAlert, Waypoints, XCircle, SquareDashedMousePointer,
} from "lucide-react";
import { app, joinPath } from "../../lib/api";
import { onFilesChanged } from "../../state/app";
import { useSpar } from "../../state/spar";
import { useWorkspace } from "../../state/workspace";
import { Button, Segmented, Spinner } from "../../ui";
import { SFSymbol } from "../../ui/icons";
import { Spar } from "../chat/sparcli";
import { ArtifactCard } from "../chat/PhaseView";
import {
  KINDS, Kind, emptyTrace, isEmptyTrace, kindSingular, kindTitle, list, loadTrace, nid, node as findNode, nodeId,
  orphans, rowKeys, uncovered, untested, type Node, type Row, type Service, type State, type Trace,
} from "./trace";
import * as TT from "./traceText";
import { exportToJira, openIssue, site, useIssues, useJiraBlocker, useJiraServer, type TrackerIssue } from "./tracker";
import "./insights.css";
import "./trace.css";

/** An SF Symbol at a SwiftUI point size (TraceView.swift names each one), lucide off macOS. */
const Sf = ({ n, pt = 10, w, fb, color }: { n: string; pt?: number; w?: string; fb: ReactNode; color?: string }) =>
  <SFSymbol name={n} size={pt} weight={w} fallback={fb} style={color ? { color } : undefined} />;

type Mode = "matrix" | "graph" | "services" | "documents";
const MODES: { value: Mode; title: string; icon: ReactNode }[] = [
  { value: "matrix", title: "Matrix", icon: <Sf n="tablecells" pt={12} fb={<Table size={12} />} /> },
  { value: "graph", title: "Graph", icon: <Sf n="point.3.connected.trianglepath.dotted" pt={12} fb={<Waypoints size={12} />} /> },
  { value: "services", title: "Services", icon: <Sf n="square.stack.3d.up" pt={12} fb={<Layers size={12} />} /> },
  { value: "documents", title: "Documents", icon: <Sf n="doc.on.doc" pt={12} fb={<Files size={12} />} /> },
];

const KIND_ICON: Record<Kind, (s?: number) => ReactNode> = {
  [Kind.requirement]: (s = 10) => <Sf n="text.badge.star" pt={s} fb={<Award size={s + 2} />} />,
  [Kind.spec]: (s = 10) => <Sf n="doc.text.magnifyingglass" pt={s} fb={<FileSearch size={s + 2} />} />,
  [Kind.task]: (s = 10) => <Sf n="checklist" pt={s} fb={<ListChecks size={s + 2} />} />,
  [Kind.code]: (s = 10) => <Sf n="chevron.left.forwardslash.chevron.right" pt={s} fb={<Code size={s + 2} />} />,
  [Kind.test]: (s = 10) => <Sf n="checkmark.diamond" pt={s} fb={<BadgeCheck size={s + 2} />} />,
};

const stateColor = (s: State) => (s === "done" || s === "pass" ? "var(--done)" : s === "fail" ? "var(--stop)" : s === "open" ? "var(--warn)" : "var(--text-3)");
const stateLabel = (s: State) => ({ done: "Built", pass: "Verified", fail: "Failing", open: "In progress", none: "Not started" })[s];

/** Paths read better by their file name. */
function shortKey(n: Node): string {
  if (n.kind !== Kind.code && n.kind !== Kind.test) return n.key;
  const file = TT.fileOf(n.key);
  return TT.lastComponent(file) + n.key.slice(file.length);
}
function subtitle(n: Node): string {
  if (n.kind !== Kind.code && n.kind !== Kind.test) return n.title;
  return TT.deletingLastComponent(TT.fileOf(n.key));
}

function reveal(n: Node) {
  if (!n.path) return;
  const ws = useWorkspace.getState();
  if (n.line != null) ws.openFile(n.path, n.line); else ws.open({ kind: "file", path: n.path });
}

const Dot = ({ color, size = 6 }: { color: string; size?: number }) => <span style={{ width: size, height: size, borderRadius: "50%", background: color, flex: "none", display: "inline-block" }} />;

export function TraceView(_p: { [k: string]: unknown } = {}) {
  const root = useSpar((s) => s.root);
  const feature = useSpar((s) => s.feature);
  const doneCount = useSpar((s) => s.tasks.reduce((n, g) => n + g.tasks.filter((t) => t.done).length, 0));
  const reloadToken = useWorkspace((s) => s.reloadToken);
  const issues = useIssues();
  const [trace, setTrace] = useState<Trace>(emptyTrace);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<Mode>("matrix");
  const [selection, setSelection] = useState<string | null>(null);
  const [fileBump, setFileBump] = useState(0);

  // Artifacts written while the page is open (spec, tasks, verification, plan) show at once.
  useEffect(() => {
    if (!feature) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const un = onFilesChanged((paths) => {
      if (paths.some((p) => p.includes(`/specs/${feature}/`) || /\/(roadmap|tenets|standards|references)\.md$/.test(p) || p.includes("/briefs/"))) {
        clearTimeout(t);
        t = setTimeout(() => setFileBump((b) => b + 1), 400);
      }
    });
    return () => { clearTimeout(t); un(); };
  }, [feature]);

  const reloadKey = `${feature ?? ""}#${reloadToken}#${doneCount}#${Object.keys(issues).length}#${fileBump}`;
  useEffect(() => {
    let live = true;
    if (!feature || !root) { setTrace(emptyTrace()); setLoaded(true); return; }
    loadTrace(root, feature).then((t) => { if (live) { setTrace(t); setLoaded(true); } }).catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [root, reloadKey]);

  const empty = isEmptyTrace(trace);
  return (
    <div className="ins-page ins-trace">
      <div className="ins-header">
        <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <div className="title2">Traceability</div>
            {feature && <div className="ins-callout muted">{Spar.featureTitle(feature)} · {feature}</div>}
          </div>
          <div className="spacer" />
          <JiraControls trace={trace} issues={issues} />
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <Segmented value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m.value, label: <span className="row" style={{ gap: 5 }}>{m.icon}{m.title}</span> }))} />
          <div className="spacer" />
          {!empty && <Coverage trace={trace} issues={issues} />}
        </div>
      </div>
      <div className="ins-divider" />
      {!feature ? (
        <Unavailable title="No iteration yet" icon={<Sf n="point.3.connected.trianglepath.dotted" pt={30} fb={<Waypoints size={30} />} />} detail="Traceability appears once SPAR has written a spec." />
      ) : !loaded ? (
        <div className="empty"><Spinner /></div>
      ) : empty ? (
        <Unavailable title="Nothing to trace yet" icon={<Sf n="point.3.connected.trianglepath.dotted" pt={30} fb={<Waypoints size={30} />} />} detail="The chain fills in as the spec, the tasks and the verification are written." />
      ) : mode === "matrix" ? (
        <TraceMatrix trace={trace} issues={issues} showGraph={(id) => { setSelection(id); setMode("graph"); }} />
      ) : mode === "graph" ? (
        <TraceGraph trace={trace} issues={issues} selection={selection} setSelection={setSelection} />
      ) : mode === "services" ? (
        <TraceServices trace={trace} issues={issues} />
      ) : (
        <TraceDocuments trace={trace} />
      )}
    </div>
  );
}

export function Unavailable({ title, icon, detail }: { title: string; icon: ReactNode; detail?: string }) {
  return (
    <div className="empty">
      <div className="faint">{icon}</div>
      <div className="headline" style={{ fontSize: 15, color: "var(--text)" }}>{title}</div>
      {detail && <div className="muted" style={{ maxWidth: 420 }}>{detail}</div>}
    </div>
  );
}

// ---- Header pieces -------------------------------------------------------------------

function Coverage({ trace, issues }: { trace: Trace; issues: Record<string, TrackerIssue> }) {
  const items = list(trace, Kind.spec).filter((n) => n.parent == null);
  const covered = items.length - uncovered(trace).length;
  const tasks = list(trace, Kind.task);
  const done = tasks.filter((t) => t.state === "done").length;
  const tested = trace.rows.filter((r) => r.tests.length).length;
  const n = Object.keys(issues).length;
  const stat = (label: string, value: string, tint: string) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }} aria-label={`${label} ${value}`}>
      <span className="ins-num ins-callout" style={{ fontWeight: 600, color: tint, lineHeight: "15px" }}>{value}</span>
      <span className="ins-caption2 muted" style={{ lineHeight: "13px" }}>{label}</span>
    </div>
  );
  return (
    <div className="row" style={{ gap: 16 }}>
      {stat("Spec covered", `${covered}/${items.length}`, covered === items.length ? "var(--done)" : "var(--warn)")}
      {stat("Tasks done", `${done}/${tasks.length}`, done === tasks.length && tasks.length ? "var(--done)" : "var(--text-2)")}
      {stat("Rows tested", `${tested}/${trace.rows.length}`, tested === trace.rows.length && tested > 0 ? "var(--done)" : "var(--text-2)")}
      {n > 0 && stat("In Jira", `${n}`, "var(--accent)")}
    </div>
  );
}

function JiraControls({ trace, issues }: { trace: Trace; issues: Record<string, TrackerIssue> }) {
  const server = useJiraServer();
  const blocker = useJiraBlocker();
  const epic = issues.epic;
  return (
    <div className="row" style={{ gap: 8 }}>
      {epic && <IssueBadge issue={epic} prefix="Epic" />}
      {!server ? (
        <Button size="small" title="Add a Jira or Atlassian MCP server so the agent can create issues" onClick={() => useWorkspace.getState().open({ kind: "mcp" })}>Connect Jira…</Button>
      ) : !site() ? (
        <Button size="small" title="Set your Jira site URL in Settings" onClick={() => app.settings()}>Set up Jira…</Button>
      ) : null}
      <Button size="small" disabled={blocker != null} title={blocker ?? "Create or update the epic, stories and tasks in Jira"} icon={<Sf n="arrow.up.forward.app" pt={12} fb={<SquareArrowOutUpRight size={12} />} />} onClick={() => exportToJira()}>
        {Object.keys(issues).length === 0 && Object.keys(trace.issues).length === 0 ? "Create in Jira" : "Sync to Jira"}
      </Button>
    </div>
  );
}

/** A tracker key that opens the issue. */
export function IssueBadge({ issue, prefix }: { issue: TrackerIssue; prefix?: string }) {
  return (
    <button type="button" className="ins-issue" disabled={!issue.url} onClick={(e) => { e.stopPropagation(); openIssue(issue); }}
      title={issue.url ?? `Set your Jira site URL in Settings to open ${issue.key}`}>
      <Sf n="arrow.up.forward.square" pt={8} fb={<SquareArrowOutUpRight size={9} />} />
      {prefix ? `${prefix} ${issue.key}` : issue.key}
    </button>
  );
}

// ---- Matrix --------------------------------------------------------------------------

/** Column widths for the matrix: a minimum each, with spare width going to the wordier columns. */
const MIN = [90, 240, 190, 170, 200, 64];   // Kind order, then Result
const WEIGHTS = [0, 3, 2, 2, 3, 0];
const SPACING = 12, INSET = 12;
function fitting(width: number): number[] {
  const spare = Math.max(0, width - (MIN.reduce((a, b) => a + b, 0) + SPACING * 5 + INSET * 2));
  const total = WEIGHTS.reduce((a, b) => a + b, 0);
  return MIN.map((m, i) => m + (spare * WEIGHTS[i]) / total);
}
const totalWidth = (w: number[]) => w.reduce((a, b) => a + b, 0) + SPACING * 5 + INSET * 2;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function TraceMatrix({ trace, issues, showGraph }: { trace: Trace; issues: Record<string, TrackerIssue>; showGraph: (id: string) => void }) {
  const [filter, setFilter] = useState("");
  const [ref, width] = useWidth<HTMLDivElement>();
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return trace.rows;
    return trace.rows.filter((row) => KINDS.some((kind) => rowKeys(row, kind).some((key) =>
      key.toLowerCase().includes(q) || (findNode(trace, kind, key)?.title.toLowerCase().includes(q) ?? false))));
  }, [trace, filter]);
  const widths = fitting(width - 40);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="row" style={{ padding: "10px 20px" }}>
        <input className="text-field" style={{ maxWidth: 320 }} placeholder="Filter by id, title or file" aria-label="Filter by id, title or file" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="spacer" />
        <span className="caption">{rows.length} of {trace.rows.length} rows</span>
      </div>
      <div className="ins-divider" />
      <div ref={ref} style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ width: totalWidth(widths), padding: 20, boxSizing: "content-box", display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="ins-matrix" role="table" aria-label="Traceability matrix">
            <div className="ins-matrix-head" role="row" style={{ gap: SPACING, padding: `8px ${INSET}px` }}>
              {KINDS.map((k) => <span key={k} role="columnheader" className="row" style={{ width: widths[k], gap: 4, flex: "none" }}>{KIND_ICON[k]()}<span className="ins-truncate">{kindTitle(k)}</span></span>)}
              <span role="columnheader" style={{ width: widths[5], flex: "none" }}>Result</span>
            </div>
            {rows.map((row) => <MatrixRow key={row.id} trace={trace} row={row} widths={widths} issues={issues} focus={showGraph} />)}
          </div>
          <Gaps trace={trace} />
        </div>
      </div>
    </div>
  );
}

function MatrixRow({ trace, row, widths, issues, focus }: { trace: Trace; row: Row; widths: number[]; issues: Record<string, TrackerIssue>; focus: (id: string) => void }) {
  const column = (kind: Kind, item: (key: string) => ReactNode) => {
    const keys = rowKeys(row, kind);
    return (
      <div role="cell" style={{ width: widths[kind], flex: "none", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        {keys.length === 0 && <span className="faint">—</span>}
        {keys.map((k) => <div key={k} style={{ minWidth: 0 }}>{item(k)}</div>)}
      </div>
    );
  };
  const n = findNode(trace, Kind.spec, row.spec);
  const specIssue = issues[row.spec];
  return (
    <div role="row" className="ins-matrix-row" style={{ gap: SPACING, padding: `8px ${INSET}px`, background: row.implied ? "var(--subtle)" : undefined }}>
      {column(Kind.requirement, (key) => <span className="mono ins-caption" title={findNode(trace, Kind.requirement, key)?.title || key}>{key}</span>)}
      <div role="cell" style={{ width: widths[Kind.spec], flex: "none", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <button type="button" className="ins-link row" style={{ gap: 6 }} onClick={() => n && reveal(n)}>
          <Dot color={stateColor(n?.state ?? "none")} />
          <span className="mono ins-caption" style={{ fontWeight: 600 }}>{row.spec}</span>
          {specIssue && <IssueBadge issue={specIssue} />}
        </button>
        {n?.title && <span className="ins-caption muted ins-clamp2">{n.title}</span>}
        {row.implied && <span className="ins-caption2 faint">from task tags</span>}
        <button type="button" className="ins-link ins-caption2" style={{ color: "var(--accent)", alignSelf: "flex-start" }} onClick={() => focus(nid(Kind.spec, row.spec))}>Show in graph</button>
      </div>
      {column(Kind.task, (key) => {
        const t = findNode(trace, Kind.task, key);
        return (
          <span className="row" style={{ gap: 5 }}>
            <button type="button" className="ins-link row" style={{ gap: 4 }} title={t?.title || key} onClick={() => t && reveal(t)}>
              {t?.state === "done" ? <Sf n="checkmark.circle.fill" pt={12} fb={<CheckCircle2 size={12} />} color="var(--done)" />
                : <Sf n="circle" pt={12} fb={<Circle size={12} />} color="color-mix(in srgb, var(--text-2) 60%, transparent)" />}
              <span className="mono ins-caption">{key}</span>
            </button>
            {issues[key] && <IssueBadge issue={issues[key]} />}
          </span>
        );
      })}
      {column(Kind.code, (key) => <FileLink trace={trace} kind={Kind.code} k={key} />)}
      {column(Kind.test, (key) => <FileLink trace={trace} kind={Kind.test} k={key} />)}
      <div role="cell" style={{ width: widths[5], flex: "none" }}>
        {row.result === "pass" ? <span className="row ins-caption" style={{ gap: 4, color: "var(--done)" }}><Sf n="checkmark.circle.fill" fb={<CheckCircle2 size={11} />} />Pass</span>
          : row.result === "fail" ? <span className="row ins-caption" style={{ gap: 4, color: "var(--stop)" }}><Sf n="xmark.circle.fill" fb={<XCircle size={11} />} />Fail</span>
          : <span className="faint">—</span>}
      </div>
    </div>
  );
}

function FileLink({ trace, kind, k }: { trace: Trace; kind: Kind; k: string }) {
  const n = findNode(trace, kind, k) ?? { kind, key: k, title: k, state: "none" as State };
  return (
    <button type="button" className="ins-link mono ins-caption ins-truncate" disabled={!n.path} title={k} onClick={() => reveal(n)}
      style={{ color: n.path ? "var(--text)" : "var(--text-2)", maxWidth: "100%" }}>
      {shortKey(n)}
    </button>
  );
}

function Gaps({ trace }: { trace: Trace }) {
  const u = uncovered(trace), o = orphans(trace), x = untested(trace);
  if (!u.length && !o.length && !x.length) return null;
  const col = (title: string, nodes: Node[]) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span className="ins-caption muted" style={{ fontWeight: 600 }}>{title} ({nodes.length})</span>
      {nodes.length === 0 && <span className="ins-caption faint">None</span>}
      {nodes.slice(0, 12).map((n) => (
        <button key={nodeId(n)} type="button" className="ins-link row" style={{ gap: 6, minWidth: 0 }} onClick={() => reveal(n)}>
          <span className="mono ins-caption" style={{ flex: "none" }}>{n.key}</span>
          <span className="ins-caption muted ins-truncate">{n.title}</span>
        </button>
      ))}
      {nodes.length > 12 && <span className="ins-caption2 faint">and {nodes.length - 12} more</span>}
    </div>
  );
  return (
    <section className="ins-card" style={{ padding: 14 }} aria-label="Gaps">
      <div className="row headline" style={{ gap: 6, color: "var(--warn)", marginBottom: 12 }}><Sf n="exclamationmark.triangle" pt={13} fb={<TriangleAlert size={14} />} />Gaps</div>
      <div className="row" style={{ alignItems: "flex-start", gap: 24 }}>
        {col("Spec items no task builds", u)}
        {col("Tasks no spec item asks for", o)}
        {col("Rows with no test", x.map((r) => findNode(trace, Kind.spec, r.spec)).filter(Boolean) as Node[])}
      </div>
    </section>
  );
}

// ---- Graph ---------------------------------------------------------------------------

const COL_W = 210, GAP = 70, NODE_H = 40, ROW_GAP = 8, TOP = 36;
interface Edge { from: string; to: string; rows: Set<number> }
interface Layout {
  columns: Record<number, Node[]>;
  origin: Map<string, { x: number; y: number }>;
  rows: Row[];
  rowNodes: Map<number, Set<string>>;
  edges: Edge[];
  size: { w: number; h: number };
}

function TraceGraph({ trace, issues, selection, setSelection }: { trace: Trace; issues: Record<string, TrackerIssue>; selection: string | null; setSelection: (s: string | null) => void }) {
  const [criteria, setCriteria] = useState(false);
  const [reqFilter, setReqFilter] = useState<string | null>(null);
  const [specFilter, setSpecFilter] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<string | null>(null);
  const filtering = reqFilter != null || specFilter != null || taskFilter != null;

  const l = useMemo<Layout>(() => {
    // Filters keep the rows that carry the chosen requirement, spec item (a story takes its
    // criteria with it) and task.
    const kept = trace.rows.filter((r) => (reqFilter == null || r.requirements.includes(reqFilter))
      && (specFilter == null || r.spec === specFilter || r.spec.startsWith(specFilter + "-"))
      && (taskFilter == null || r.tasks.includes(taskFilter)));
    // Criteria fold into their story unless asked for.
    const rows = kept.map((row) => {
      const story = criteria ? null : findNode(trace, Kind.spec, row.spec)?.parent;
      return story ? { ...row, spec: story } : row;
    });
    const used = new Set<string>();
    for (const r of rows) for (const k of KINDS) for (const key of rowKeys(r, k)) used.add(nid(k, key));
    const columns: Record<number, Node[]> = {};
    const origin = new Map<string, { x: number; y: number }>();
    for (const kind of KINDS) {
      let ns = list(trace, kind);
      if (kind === Kind.spec && !criteria) ns = ns.filter((n) => n.parent == null);
      if (filtering) ns = ns.filter((n) => used.has(nodeId(n)));
      columns[kind] = ns;
      ns.forEach((n, i) => origin.set(nodeId(n), { x: kind * (COL_W + GAP), y: TOP + i * (NODE_H + ROW_GAP) }));
    }
    const edges = new Map<string, Edge>();
    const link = (a: string, b: string, row: number) => {
      const k = a + ">" + b;
      if (!edges.has(k)) edges.set(k, { from: a, to: b, rows: new Set() });
      edges.get(k)!.rows.add(row);
    };
    const rowNodes = new Map<number, Set<string>>();
    for (const r of rows) {
      const s = nid(Kind.spec, r.spec);
      for (const q of r.requirements) link(nid(Kind.requirement, q), s, r.id);
      for (const t of r.tasks) link(s, nid(Kind.task, t), r.id);
      const sources = r.tasks.length ? r.tasks.map((t) => nid(Kind.task, t)) : [s];
      for (const c of r.code) for (const src of sources) link(src, nid(Kind.code, c), r.id);
      const testSources = r.code.length ? r.code.map((c) => nid(Kind.code, c)) : sources;
      for (const x of r.tests) for (const src of testSources) link(src, nid(Kind.test, x), r.id);
      const ids = new Set<string>();
      for (const k of KINDS) for (const key of rowKeys(r, k)) ids.add(nid(k, key));
      rowNodes.set(r.id, ids);
    }
    const tallest = Math.max(0, ...Object.values(columns).map((c) => c.length));
    return { columns, origin, rows, rowNodes, edges: [...edges.values()],
      size: { w: KINDS.length * (COL_W + GAP) - GAP, h: TOP + tallest * (NODE_H + ROW_GAP) + 8 } };
  }, [trace, criteria, reqFilter, specFilter, taskFilter, filtering]);

  const lit = new Set<number>();
  if (selection) for (const [id, ids] of l.rowNodes) if (ids.has(selection)) lit.add(id);
  const litNodes = new Set<string>();
  for (const id of lit) for (const n of l.rowNodes.get(id) ?? []) litNodes.add(n);

  const find = (id: string): Node | undefined => {
    for (const k of KINDS) { const n = l.columns[k]?.find((x) => nodeId(x) === id); if (n) return n; }
    // A criterion picked in the matrix while criteria are folded: show its story.
    return list(trace, Kind.spec).find((x) => nodeId(x) === id);
  };
  const selected = selection ? find(selection) : undefined;
  const only = (n: Node): (() => void) | null => {
    switch (n.kind) {
      case Kind.requirement: return () => setReqFilter(n.key);
      case Kind.spec: return () => setSpecFilter(n.key);
      case Kind.task: return () => setTaskFilter(n.key);
      default: return null;
    }
  };

  const filterMenu = (title: string, value: string | null, set: (v: string | null) => void, nodes: Node[]) => (
    <label className="row ins-caption" style={{ gap: 6 }}>
      <span>{title}</span>
      <select className="text-field" style={{ maxWidth: 220, height: 22, fontSize: 12 }} aria-label={title} value={value ?? ""} onChange={(e) => set(e.target.value || null)}>
        <option value="">All</option>
        {nodes.map((n) => <option key={n.key} value={n.key}>{n.title ? `${n.key} · ${n.title.slice(0, 60)}` : n.key}</option>)}
      </select>
    </label>
  );

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="row" style={{ gap: 10, padding: "8px 20px", flexWrap: "wrap" }}>
          {filterMenu("Requirement", reqFilter, setReqFilter, list(trace, Kind.requirement))}
          {filterMenu("Spec item", specFilter, setSpecFilter, list(trace, Kind.spec).filter((n) => criteria || n.parent == null))}
          {filterMenu("Task", taskFilter, setTaskFilter, list(trace, Kind.task))}
          {filtering && <Button size="small" onClick={() => { setReqFilter(null); setSpecFilter(null); setTaskFilter(null); }}>Clear filters</Button>}
          <div className="spacer" />
          <label className="row ins-caption" style={{ gap: 5 }}>
            <input type="checkbox" checked={criteria} onChange={(e) => setCriteria(e.target.checked)} />Show acceptance criteria
          </label>
          {selection && <Button size="small" onClick={() => setSelection(null)}>Clear selection</Button>}
        </div>
        <div className="ins-divider" />
        {filtering && l.rows.length === 0 ? (
          <Unavailable title="Nothing matches these filters" icon={<SquareDashedMousePointer size={30} />} detail="No row of the trace carries all of them." />
        ) : (
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            <div style={{ position: "relative", width: l.size.w, height: l.size.h, margin: 20 }}>
              <svg width={l.size.w} height={l.size.h} style={{ position: "absolute", inset: 0 }} aria-hidden>
                {l.edges.map((e) => {
                  const a = l.origin.get(e.from), b = l.origin.get(e.to);
                  if (!a || !b) return null;
                  const p0 = { x: a.x + COL_W, y: a.y + NODE_H / 2 }, p1 = { x: b.x, y: b.y + NODE_H / 2 };
                  const dx = (p1.x - p0.x) * 0.5;
                  const on = [...e.rows].some((r) => lit.has(r));
                  return <path key={e.from + ">" + e.to} d={`M${p0.x},${p0.y} C${p0.x + dx},${p0.y} ${p1.x - dx},${p1.y} ${p1.x},${p1.y}`}
                    fill="none" stroke={on ? "var(--accent)" : "var(--text)"} strokeOpacity={on ? 1 : lit.size === 0 ? 0.18 : 0.05} strokeWidth={on ? 2 : 1} />;
                })}
              </svg>
              {KINDS.map((k) => (
                <div key={k} className="row ins-caption muted" style={{ position: "absolute", left: k * (COL_W + GAP), top: 6, gap: 4, fontWeight: 600 }}>
                  {KIND_ICON[k]()}{kindTitle(k)} · {l.columns[k]?.length ?? 0}
                </div>
              ))}
              {KINDS.map((k) => (l.columns[k] ?? []).map((n) => {
                const id = nodeId(n), o = l.origin.get(id)!;
                const issue = k === Kind.spec || k === Kind.task ? issues[n.key] : undefined;
                const dim = lit.size > 0 && !litNodes.has(id) && selection !== id;
                return (
                  <div key={id} role="button" tabIndex={0} aria-label={n.key} aria-pressed={selection === id}
                    className={`ins-gnode ${selection === id ? "on" : ""}`} title={n.title ? `${n.key} — ${n.title}` : n.key}
                    style={{ left: o.x, top: o.y, width: COL_W, height: NODE_H, opacity: dim ? 0.3 : 1 }}
                    onClick={() => setSelection(selection === id ? null : id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelection(selection === id ? null : id); } }}>
                    <Dot color={k === Kind.requirement ? "var(--accent)" : stateColor(n.state)} size={7} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: 4, minWidth: 0 }}>
                        <span className="mono ins-caption ins-truncate" style={{ fontWeight: 600 }}>{shortKey(n)}</span>
                        {issue && <span className="mono ins-caption2 ins-truncate" style={{ color: "var(--accent)", flex: "none" }}>{issue.key}</span>}
                      </div>
                      {subtitle(n) && <span className="ins-caption2 muted ins-truncate">{subtitle(n)}</span>}
                    </div>
                  </div>
                );
              }))}
            </div>
          </div>
        )}
      </div>
      {selected && (
        <>
          <div style={{ width: 0.5, background: "var(--hairline-strong)" }} />
          <GraphInspector trace={trace} node={selected} rows={l.rows.filter((r) => lit.has(r.id))} issues={issues} setSelection={setSelection} only={only(selected)} />
        </>
      )}
    </div>
  );
}

function GraphInspector({ trace, node: n, rows, issues, setSelection, only }: {
  trace: Trace; node: Node; rows: Row[]; issues: Record<string, TrackerIssue>; setSelection: (s: string | null) => void; only: (() => void) | null;
}) {
  const root = useSpar((s) => s.root);
  const connected = (kind: Kind) => {
    const out: string[] = [];
    for (const r of rows) for (const k of rowKeys(r, kind)) if (!out.includes(k)) out.push(k);
    return out;
  };
  const section = (title: string, children: ReactNode) => (
    <div key={title} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="ins-caption muted" style={{ fontWeight: 600 }}>{title}</span>
      {children}
    </div>
  );
  const files = n.kind === Kind.task ? trace.taskPaths[n.key] ?? [] : [];
  return (
    <aside aria-label="Inspector" style={{ width: 300, flex: "none", overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="row ins-caption muted" style={{ gap: 4, fontWeight: 600 }}>{KIND_ICON[n.kind]()}{kindSingular(n.kind)}</span>
        <span className="mono headline selectable" style={{ wordBreak: "break-all" }}>{n.key}</span>
        {n.title && n.title !== n.key && <span className="selectable">{n.title}</span>}
        {n.kind !== Kind.requirement && <span className="row ins-caption" style={{ gap: 4, color: stateColor(n.state) }}><Sf n="circle.fill" fb={<Dot color={stateColor(n.state)} size={8} />} />{stateLabel(n.state)}</span>}
      </div>
      {(n.path || issues[n.key]) && (
        <div className="row" style={{ gap: 8 }}>
          {n.path && <Button size="small" onClick={() => reveal(n)}>Open {TT.lastComponent(n.path)}</Button>}
          {issues[n.key] && <IssueBadge issue={issues[n.key]} />}
        </div>
      )}
      {only && <div><Button size="small" onClick={only}>Show only this chain</Button></div>}
      {files.length > 0 && section("Files", files.map((f) => (
        <button key={f} type="button" className="ins-link mono ins-caption ins-truncate" title={f}
          onClick={() => useWorkspace.getState().open({ kind: "file", path: joinPath(root, TT.fileOf(f)) })}>{f}</button>
      )))}
      {KINDS.filter((k) => k !== n.kind).map((kind) => {
        const keys = connected(kind);
        if (!keys.length) return null;
        return section(kindTitle(kind), keys.map((key) => {
          const m = findNode(trace, kind, key);
          const isFile = m?.kind === Kind.code || m?.kind === Kind.test;
          return (
            <button key={key} type="button" className="ins-link row" style={{ gap: 6, minWidth: 0, alignItems: "baseline" }} onClick={() => setSelection(nid(kind, key))}>
              <Dot color={stateColor(m?.state ?? "none")} />
              <span className="mono ins-caption" style={{ flex: "none" }}>{m ? shortKey(m) : key}</span>
              <span className="ins-caption muted ins-truncate">{isFile ? "" : m?.title ?? ""}</span>
              {issues[key] && <span className="mono ins-caption2" style={{ color: "var(--accent)", flex: "none" }}>{issues[key].key}</span>}
            </button>
          );
        }));
      })}
    </aside>
  );
}

// ---- Services ------------------------------------------------------------------------

function TraceServices({ trace, issues }: { trace: Trace; issues: Record<string, TrackerIssue> }) {
  return (
    <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
      {trace.services.length === 0 && <div className="muted" style={{ padding: 40 }}>No services yet: they come from the plan's project structure.</div>}
      <div className="ins-grid" style={{ padding: 20, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
        {trace.services.map((s) => <ServiceCard key={s.id} trace={trace} service={s} issues={issues} />)}
      </div>
    </div>
  );
}

function ServiceCard({ trace, service, issues }: { trace: Trace; service: Service; issues: Record<string, TrackerIssue> }) {
  const [showAll, setShowAll] = useState(false);
  const tasks = service.tasks.map((k) => findNode(trace, Kind.task, k)).filter(Boolean) as Node[];
  const done = tasks.filter((t) => t.state === "done").length;
  return (
    <section className="ins-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }} aria-label={service.id}>
      <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
        <span style={{ color: "var(--accent)", alignSelf: "center", display: "inline-flex" }}>{service.directory == null ? <Sf n="square.dashed" pt={13} fb={<SquareDashed size={14} />} /> : <Sf n="shippingbox" pt={13} fb={<Package size={14} />} />}</span>
        <span className="headline">{service.id}</span>
        {service.directory && <span className="mono ins-caption muted">{service.directory}/</span>}
        <span className="spacer" />
        <span className="ins-num ins-caption" style={{ color: done === tasks.length ? "var(--done)" : "var(--text-2)" }}>{done}/{tasks.length}</span>
      </div>
      <div className="ins-progress"><div style={{ width: `${(done / Math.max(tasks.length, 1)) * 100}%` }} /></div>
      {service.specItems.length > 0 && <div className="mono ins-caption muted ins-clamp3">{service.specItems.join(" · ")}</div>}
      {(showAll ? tasks : tasks.slice(0, 8)).map((t) => (
        <div key={t.key} className="row ins-callout" style={{ gap: 8, minWidth: 0 }}>
          {t.state === "done" ? <Sf n="checkmark.circle.fill" pt={12} fb={<CheckCircle2 size={13} />} color="var(--done)" />
            : <Sf n="circle" pt={12} fb={<Circle size={13} />} color="color-mix(in srgb, var(--text-2) 60%, transparent)" />}
          <button type="button" className="ins-link row" style={{ gap: 6, minWidth: 0, flex: 1 }} onClick={() => reveal(t)}>
            <span className="mono ins-caption muted" style={{ flex: "none" }}>{t.key}</span>
            <span className="ins-truncate">{t.title}</span>
          </button>
          {issues[t.key] && <IssueBadge issue={issues[t.key]} />}
        </div>
      ))}
      {tasks.length > 8 && (
        <button type="button" className="ins-link ins-caption" style={{ color: "var(--accent)", alignSelf: "flex-start" }} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show ${tasks.length - 8} more`}
        </button>
      )}
      {(service.code.length > 0 || service.tests.length > 0) && (
        <span className="ins-caption muted">
          {service.code.length} code reference{service.code.length === 1 ? "" : "s"} · {service.tests.length} test{service.tests.length === 1 ? "" : "s"}
        </span>
      )}
    </section>
  );
}

// ---- Documents -----------------------------------------------------------------------

const GROUPS = ["Discover", "Design", "Contracts", "Diagrams", "Develop", "Deliver", "Project"];

function TraceDocuments({ trace }: { trace: Trace }) {
  return (
    <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 22 }}>
        {GROUPS.map((group) => {
          const docs = trace.documents.filter((d) => d.group === group);
          if (!docs.length) return null;
          const small = group === "Contracts" || group === "Diagrams";
          return (
            <section key={group} aria-label={group} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="headline">{group}</div>
              {small ? (
                <div className="ins-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                  {docs.map((d) => (
                    <button key={d.path} type="button" className="ins-chip" onClick={() => useWorkspace.getState().open({ kind: "file", path: d.path })}>
                      {group === "Diagrams" ? <Sf n="square.on.square.dashed" pt={13} fb={<SquareDashed size={13} />} /> : <Sf n="doc.plaintext" pt={13} fb={<FileText size={13} />} />}
                      <span className="ins-truncate">{d.title}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="ins-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, alignItems: "start" }}>
                  {docs.map((d) => <ArtifactCard key={d.path} path={d.path} title={d.title} lines={2} />)}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
