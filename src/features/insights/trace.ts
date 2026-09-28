// One feature, end to end: requirement → spec item → task → code → test. Read from what SPAR
// writes — spec.md, tasks.md and its Traceability table, verification.md's matrix, plan.md's
// services — plus the tracker keys in issues.md. A port of `Trace` in Backend/Trace.swift.

import { fs, joinPath } from "../../lib/api";
import { Spar } from "../chat/sparcli";
import * as T from "./traceText";
import { parseIssues, trackerPath, type TrackerIssue } from "./issues";
import { prefs } from "../../lib/prefs";

export enum Kind { requirement = 0, spec = 1, task = 2, code = 3, test = 4 }
export const KINDS: Kind[] = [Kind.requirement, Kind.spec, Kind.task, Kind.code, Kind.test];
export const kindTitle = (k: Kind) => ["Requirements", "Spec items", "Tasks", "Code", "Tests"][k];
export const kindSingular = (k: Kind) => ["Requirement", "Spec item", "Task", "Code", "Test"][k];

export type State = "none" | "open" | "done" | "pass" | "fail";

export interface Node {
  kind: Kind;
  key: string;
  title: string;
  path?: string | null;
  line?: number | null;
  state: State;
  /** An acceptance criterion's story. */
  parent?: string | null;
}
export const nodeId = (n: { kind: Kind; key: string }) => `${n.kind}:${n.key}`;
export const nid = (kind: Kind, key: string) => `${kind}:${key}`;

/** One line of the matrix: a spec item and everything that traces to it. */
export interface Row {
  id: number;
  requirements: string[];
  spec: string;
  tasks: string[];
  code: string[];
  tests: string[];
  result?: string | null;
  /** From a task's story tag rather than the Traceability table. */
  implied?: boolean;
}

export function rowKeys(row: Row, kind: Kind): string[] {
  switch (kind) {
    case Kind.requirement: return row.requirements;
    case Kind.spec: return [row.spec];
    case Kind.task: return row.tasks;
    case Kind.code: return row.code;
    case Kind.test: return row.tests;
  }
}

export interface Service { id: string; directory: string | null; tasks: string[]; specItems: string[]; code: string[]; tests: string[] }
export interface Document { title: string; group: string; path: string }

export interface Trace {
  nodes: Record<number, Node[]>;
  rows: Row[];
  services: Service[];
  documents: Document[];
  issues: Record<string, TrackerIssue>;
  /** The files each task's `Files.` line names. */
  taskPaths: Record<string, string[]>;
}

export const emptyTrace = (): Trace => ({ nodes: {}, rows: [], services: [], documents: [], issues: {}, taskPaths: {} });

export const list = (t: Trace, kind: Kind): Node[] => t.nodes[kind] ?? [];
export const node = (t: Trace, kind: Kind, key: string): Node | undefined => t.nodes[kind]?.find((n) => n.key === key);

/** Stories and NFRs no task builds (acceptance criteria count through their story). */
export function uncovered(t: Trace): Node[] {
  const built = new Set(t.rows.filter((r) => r.tasks.length).map((r) => r.spec));
  return list(t, Kind.spec).filter((n) => {
    if (n.parent != null) return false;
    return !built.has(n.key) && ![...built].some((b) => b.startsWith(n.key + "-"));
  });
}

/** Tasks no spec item asks for. */
export function orphans(t: Trace): Node[] {
  const cited = new Set(t.rows.flatMap((r) => r.tasks));
  return list(t, Kind.task).filter((n) => !cited.has(n.key));
}

export const untested = (t: Trace): Row[] => t.rows.filter((r) => !r.implied && r.tests.length === 0);
export const isEmptyTrace = (t: Trace) => t.rows.length === 0 && list(t, Kind.task).length === 0 && list(t, Kind.spec).length === 0;

// ---- Building ------------------------------------------------------------------------

export interface TraceInput {
  root: string;
  feature: string;
  specPath: string;
  tasksPath: string;
  spec?: string | null;
  tasks?: string | null;
  verification?: string | null;
  plan?: string | null;
  issues?: string | null;
  /** The Jira site from Settings (issue links). */
  jiraURL?: string;
  /** Where requirements are described: the brief, the roadmap (the spec is added last). */
  sources: [string, string][];
  /** Project-relative files that exist (code and test nodes link to them). */
  exists: (relative: string) => boolean;
}

/** `titles` collects what the table calls each spec id ("US1 — register and log in"). */
function tableRows(table: T.Table, start: number, titles: Record<string, string>): Row[] {
  const column = (prefix: string) => { const i = table.header.findIndex((h) => h.startsWith(prefix)); return i < 0 ? null : i; };
  const prd = column("prd"), specC = column("spec item"), taskC = column("task"), codeC = column("code"),
    testC = column("test"), resultC = column("result");
  const out: Row[] = [];
  for (const { cells } of table.rows) {
    const cell = (i: number | null) => (i == null || i >= cells.length ? "" : cells[i]);
    const specCell = T.plain(cell(specC));
    if (!specCell || specCell.includes("{{")) continue;
    const id = T.match(/^([A-Z]+\d*(?:-[A-Z]*\d+)*)/, specCell);
    if (!id || !/\d/.test(id)) continue;
    const title = T.trimLead(specCell.slice(id.length));
    if (title && titles[id] == null) titles[id] = title;
    const result = T.plain(cell(resultC)).toLowerCase().split(" ")[0];
    out.push({
      id: start + out.length,
      requirements: T.values(cell(prd)).map((v) => v.split(" ")[0]),
      spec: id,
      tasks: T.all(/\b(T\d{3,})\b/, cell(taskC)),
      code: T.values(cell(codeC)),
      tests: T.values(cell(testC)),
      result: result === "pass" || result === "fail" ? result : null,
    });
  }
  return out;
}

/** Where a requirement id is written down: a table row it starts, or a bullet that names it. */
function describe(id: string, sources: [string, string][]): { title: string; path: string; line: number } | null {
  for (const [path, text] of sources) {
    for (const [n, line] of T.lines(text)) {
      const c = T.cells(line);
      if (c && c.length > 1 && T.plain(c[0]) === id) return { title: T.plain(c[1]), path, line: n };
      for (const marker of [`**${id}**`, `**${id}.**`, `- ${id} `, `- ${id}:`, `${id}:`, `${id} —`]) {
        if (line.startsWith(marker) || line.startsWith("- " + marker)) {
          const r = line.indexOf(marker);
          return { title: T.trimLead(T.plain(line.slice(r + marker.length))), path, line: n };
        }
      }
    }
  }
  return null;
}

const traceHeader = (h: string[]) => h.some((x) => x.startsWith("spec item"));

export function buildTrace(input: TraceInput): Trace {
  const { root, feature, specPath, tasksPath } = input;
  const t = emptyTrace();
  t.issues = input.issues ? parseIssues(input.issues, feature, input.jiraURL ?? "") : {};

  // Spec items: stories, their acceptance criteria, NFRs.
  const spec: Node[] = [];
  const has = (key: string) => spec.some((n) => n.key === key);
  const satisfies: Record<string, string[]> = {};
  const specText = input.spec ?? null;
  if (specText != null) {
    let story: string | null = null;
    for (const [n, line] of T.lines(specText)) {
      if (line.startsWith("## ")) { story = null; continue; }
      let id: string | null;
      if (line.startsWith("### ") && (id = T.match(/^###\s+(US\d+)\b/, line))) {
        story = id;
        const title = T.plain(line.slice(4).slice(id.length)).replace(/\s*[—–-]+\s*priority\s+P\d+.*$/i, "");
        spec.push({ kind: Kind.spec, key: id, title: T.trimLead(title), path: specPath, line: n, state: "none" });
      } else if (story && line.startsWith("**Satisfies.**")) {
        satisfies[story] = T.values(line.slice("**Satisfies.**".length)).map((v) => v.split(" ")[0]).filter((v) => /\d/.test(v));
      } else if ((id = T.match(/\*\*(US\d+-AC\d+)\*\*/, line)) && !has(id) && line.includes(`**${id}**`)) {
        const r = line.indexOf(`**${id}**`) + id.length + 4;
        spec.push({ kind: Kind.spec, key: id, title: T.trimLead(T.plain(line.slice(r))), path: specPath, line: n, state: "none", parent: id.split("-")[0] });
      } else {
        const c = T.cells(line);
        if (c && c.length > 1 && (id = T.match(/^(NFR-[A-Z]{1,2}\d+)$/, c[0])) && !has(id)) {
          spec.push({ kind: Kind.spec, key: id, title: T.plain(c[1]), path: specPath, line: n, state: "none" });
        }
      }
    }
  }

  // Tasks, their story tags and files; the Traceability table.
  const tasks: Node[] = [];
  const rowTitles: Record<string, string> = {};
  const storyOf: Record<string, string | undefined> = {};
  const done = new Set<string>();
  if (input.tasks != null) {
    let current: string | null = null;
    for (const [n, line] of T.lines(input.tasks)) {
      if (line.startsWith("## ")) { current = null; continue; }
      let id: string | null;
      if (line.startsWith("### ") && (id = T.match(/^###\s+(T\d{3,})\b/, line))) {
        current = id;
        const rest = line.slice(line.indexOf(id) + id.length);
        storyOf[id] = T.all(/\[(US\d+)\]/, rest)[0];
        const title = rest.replace(/\[[^\]]*\]/g, "");
        tasks.push({ kind: Kind.task, key: id, title: T.trimLead(T.plain(title)), path: tasksPath, line: n, state: "none" });
      } else if (current && line.startsWith("- **Files.**")) {
        t.taskPaths[current] = T.code(line);
      } else if ((id = T.match(/^- \[[xX]\] (T\d{3,})\b/, line))) {
        done.add(id);
      }
    }
    const table = T.table(input.tasks, "traceab", traceHeader);
    if (table) t.rows = tableRows(table, 0, rowTitles);
  }
  for (const task of tasks) task.state = done.has(task.key) ? "done" : "open";

  // What verification proved: its matrix fills in the code, the tests and their results.
  const vtable = input.verification ? T.table(input.verification, "traceab", traceHeader) : null;
  if (vtable) {
    for (const v of tableRows(vtable, t.rows.length, rowTitles)) {
      const r = t.rows.find((x) => x.spec === v.spec);
      if (r) {
        if (v.code.length) r.code = v.code;
        if (v.tests.length) r.tests = v.tests;
        if (!r.tasks.length) r.tasks = v.tasks;
        r.result = v.result ?? r.result;
      } else {
        t.rows.push(v);
      }
    }
  }

  // A story's Satisfies line names the requirements behind each of its rows.
  for (const r of t.rows) {
    const story = T.match(/^(US\d+)\b/, r.spec);
    if (!story) continue;
    for (const req of satisfies[story] ?? []) if (!r.requirements.includes(req)) r.requirements.push(req);
  }

  // Tasks the table doesn't cite still belong to the story they are tagged with.
  const cited = new Set(t.rows.flatMap((r) => r.tasks));
  const implied: Record<string, string[]> = {};
  const impliedOrder: string[] = [];
  for (const task of tasks) {
    if (cited.has(task.key)) continue;
    const s = storyOf[task.key];
    if (!s || s === "US0") continue;
    if (!implied[s]) { impliedOrder.push(s); implied[s] = []; }
    implied[s].push(task.key);
  }
  for (const s of impliedOrder) {
    t.rows.push({ id: t.rows.length, requirements: [...(satisfies[s] ?? [])], spec: s, tasks: implied[s], code: [], tests: [], implied: true });
  }

  // Every id a row cites is a node, with its parent story when it's a criterion.
  for (const r of t.rows) {
    if (!has(r.spec)) {
      const parent = T.match(/^(US\d+)-AC\d+$/, r.spec);
      spec.push({ kind: Kind.spec, key: r.spec, title: rowTitles[r.spec] ?? "", path: specText?.includes(r.spec) ? specPath : null, state: "none", parent });
    }
  }
  for (const n of [...spec]) {
    if (n.parent && !has(n.parent)) spec.push({ kind: Kind.spec, key: n.parent, title: "", path: specPath, state: "none" });
  }

  // Requirements: what the rows and the stories cite, described from the brief and roadmap.
  const sources: [string, string][] = [...input.sources, ...(specText != null ? [[specPath, specText] as [string, string]] : [])];
  const reqKeys: string[] = [];
  for (const key of [...t.rows.flatMap((r) => r.requirements), ...spec.flatMap((n) => satisfies[n.key] ?? [])]) {
    if (!reqKeys.includes(key)) reqKeys.push(key);
  }
  const requirements: Node[] = reqKeys.map((key) => {
    const found = describe(key, sources);
    return { kind: Kind.requirement, key, title: found?.title ?? "", path: found?.path ?? null, line: found?.line ?? null, state: "none" };
  });

  // Code and tests, pointing at their files when they exist.
  const artifact = (kind: Kind, key: string): Node => {
    const file = T.fileOf(key);
    return { kind, key, title: key, path: input.exists(file) ? joinPath(root, file) : null, state: "none" };
  };
  const codeNodes: Node[] = [], testNodes: Node[] = [];
  for (const r of t.rows) {
    for (const c of r.code) if (!codeNodes.some((n) => n.key === c)) codeNodes.push(artifact(Kind.code, c));
    for (const x of r.tests) if (!testNodes.some((n) => n.key === x)) testNodes.push(artifact(Kind.test, x));
  }
  for (const tn of testNodes) {
    const results = t.rows.filter((r) => r.tests.includes(tn.key)).map((r) => r.result).filter(Boolean);
    tn.state = results.includes("fail") ? "fail" : results.includes("pass") ? "pass" : "none";
  }
  const doneTasks = new Set(tasks.filter((x) => x.state === "done").map((x) => x.key));
  for (const s of spec) {
    const mine = t.rows.filter((r) => r.spec === s.key || r.spec.startsWith(s.key + "-"));
    const results = mine.map((r) => r.result).filter(Boolean) as string[];
    const taskKeys = new Set(mine.flatMap((r) => r.tasks));
    s.state = results.includes("fail") ? "fail"
      : results.length && results.every((x) => x === "pass") ? "pass"
      : taskKeys.size && [...taskKeys].every((k) => doneTasks.has(k)) ? "done"
      : taskKeys.size === 0 ? "none" : "open";
  }

  // Order each column by first appearance in the rows, so the graph's edges run level.
  const ordered = (nodes: Node[], kind: Kind): Node[] => {
    const seen: string[] = [];
    for (const r of t.rows) {
      for (const k of rowKeys(r, kind)) if (!seen.includes(k)) seen.push(k);
      const p = kind === Kind.spec ? T.match(/^(US\d+)-AC\d+$/, r.spec) : null;
      if (p && !seen.includes(p)) {
        const i = seen.indexOf(r.spec);
        seen.splice(i < 0 ? seen.length : i, 0, p);
      }
    }
    const rank = new Map<string, number>();
    seen.forEach((k, i) => { if (!rank.has(k)) rank.set(k, i); });
    return nodes.map((n, i) => ({ n, i }))
      .sort((a, b) => (rank.get(a.n.key) ?? Infinity) - (rank.get(b.n.key) ?? Infinity) || a.i - b.i)
      .map((x) => x.n);
  };
  t.nodes = {
    [Kind.requirement]: ordered(requirements, Kind.requirement), [Kind.spec]: ordered(spec, Kind.spec),
    [Kind.task]: ordered(tasks, Kind.task), [Kind.code]: codeNodes, [Kind.test]: testNodes,
  };
  t.services = services(t, input.plan ?? null);
  return t;
}

/**
 * Services from plan.md's `Service | Directory` table (else the top-level folders the work
 * touches), each with the tasks, spec items, code and tests that land in it.
 */
function services(t: Trace, plan: string | null): Service[] {
  let out: Service[] = [];
  const table = plan ? T.table(plan, null, (h) => h.some((x) => x.startsWith("service")) && h.some((x) => x.startsWith("dir"))) : null;
  if (table) {
    const si = table.header.findIndex((x) => x.startsWith("service")), di = table.header.findIndex((x) => x.startsWith("dir"));
    for (const { cells } of table.rows) {
      if (cells.length <= Math.max(si, di)) continue;
      const name = T.plain(cells[si]);
      const dir = T.plain(cells[di]).replace(/^[/. ]+|[/. ]+$/g, "");
      if (!name || name.includes("{{") || out.some((s) => s.id === name)) continue;
      out.push({ id: name, directory: dir || null, tasks: [], specItems: [], code: [], tests: [] });
    }
  }
  const allPaths = [...Object.values(t.taskPaths).flat(), ...t.rows.flatMap((r) => [...r.code, ...r.tests])];
  if (!out.length) {
    const counts = new Map<string, number>();
    for (const p of allPaths) {
      const parts = T.fileOf(p).split("/").filter(Boolean);
      if (parts.length > 1) counts.set(parts[0], (counts.get(parts[0]) ?? 0) + 1);
    }
    out = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => ({ id: k, directory: k, tasks: [], specItems: [], code: [], tests: [] }));
  }
  const owns = (s: Service, path: string) => {
    if (!s.directory) return false;
    const f = T.fileOf(path);
    return f === s.directory || f.startsWith(s.directory + "/");
  };
  const shared: Service = { id: "Project-wide", directory: null, tasks: [], specItems: [], code: [], tests: [] };
  for (const task of list(t, Kind.task)) {
    const rows = t.rows.filter((r) => r.tasks.includes(task.key));
    const paths = [...(t.taskPaths[task.key] ?? []), ...rows.flatMap((r) => r.code)];
    const hits = out.filter((s) => paths.some((p) => owns(s, p)));
    if (!hits.length) shared.tasks.push(task.key);
    for (const s of hits) s.tasks.push(task.key);
  }
  for (const s of [...out, shared]) {
    const isShared = s === shared;
    const rows = t.rows.filter((r) => r.tasks.some((k) => s.tasks.includes(k)));
    for (const r of rows) if (!s.specItems.includes(r.spec)) s.specItems.push(r.spec);
    for (const c of rows.flatMap((r) => r.code)) if (!s.code.includes(c) && (isShared || owns(s, c))) s.code.push(c);
    for (const x of rows.flatMap((r) => r.tests)) if (!s.tests.includes(x) && (isShared || owns(s, x))) s.tests.push(x);
  }
  return [...out, shared].filter((s) => s.tasks.length);
}

// ---- Loading -------------------------------------------------------------------------

const read = (p: string | null | undefined) => (p ? fs.readText(p).catch(() => null) : Promise.resolve(null));
const exists = (p: string) => fs.exists(p).catch(() => false);

export async function loadTrace(root: string, feature: string): Promise<Trace> {
  const base = await Spar.dir(root);
  const dir = joinPath(base, "specs", feature);
  const specPath = joinPath(dir, "spec.md"), tasksPath = joinPath(dir, "tasks.md");
  const briefPath = await Spar.briefPath(root, feature);
  const roadmapPath = joinPath(base, "roadmap.md");
  const [spec, tasks, verification, plan, issues, brief, roadmap] = await Promise.all([
    read(specPath), read(tasksPath), read(joinPath(dir, "verification.md")), read(joinPath(dir, "plan.md")),
    read(trackerPath(base, feature)), read(briefPath), read(roadmapPath),
  ]);
  const sources: [string, string][] = [];
  if (briefPath && brief != null) sources.push([briefPath, brief]);
  if (roadmap != null) sources.push([roadmapPath, roadmap]);
  // Code and test references: which files exist (checked in one pass before building).
  const input: TraceInput = { root, feature, specPath, tasksPath, spec, tasks, verification, plan, issues, sources, exists: () => false,
    jiraURL: prefs.get<string>("jiraURL", "") };
  const draft = buildTrace(input);
  const files = [...list(draft, Kind.code), ...list(draft, Kind.test)].map((n) => T.fileOf(n.key));
  const found = new Set<string>();
  await Promise.all([...new Set(files)].map(async (f) => { if (await exists(joinPath(root, f))) found.add(f); }));
  const t = buildTrace({ ...input, exists: (f) => found.has(f) });
  t.documents = await documents(root, base, feature, briefPath);
  return t;
}

/** Every document behind the chain, in the order the loop writes them. */
async function documents(root: string, base: string, feature: string, briefPath: string | null): Promise<Document[]> {
  const dir = joinPath(base, "specs", feature);
  const wanted: [string, string, string | null][] = [
    ["Brief", "Discover", briefPath],
    ["Roadmap", "Discover", joinPath(base, "roadmap.md")],
    ["Spec", "Discover", joinPath(dir, "spec.md")],
    ...([["plan.md", "Plan"], ["research.md", "Research"], ["data-model.md", "Data model"], ["architecture.md", "Architecture"],
      ["threat-model.md", "Threat model"], ["tasks.md", "Tasks"]] as const).map(([f, title]) => [title, "Design", joinPath(dir, f)] as [string, string, string]),
  ];
  for (const p of await Spar.contracts(root, feature)) wanted.push([T.lastComponent(p), "Contracts", p]);
  const diagrams = (await fs.list(joinPath(dir, "diagrams")).catch(() => []))
    .filter((e) => !e.name.startsWith(".")).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of diagrams) wanted.push([e.name, "Diagrams", e.path]);
  wanted.push(["Build log", "Develop", joinPath(dir, "build-log.md")]);
  wanted.push(["Issues", "Develop", trackerPath(base, feature)]);
  for (const [f, title] of [["verification.md", "Verification"], ["test-report.md", "Test report"], ["release.md", "Release"]]) wanted.push([title, "Deliver", joinPath(dir, f)]);
  wanted.push(["Architecture", "Project", joinPath(base, "architecture/architecture.md")]);
  for (const [f, title] of [["tenets.md", "Tenets"], ["standards.md", "Standards"], ["references.md", "References"]]) wanted.push([title, "Project", joinPath(base, f)]);
  const present = await Promise.all(wanted.map(([, , p]) => (p ? exists(p) : Promise.resolve(false))));
  const out: Document[] = [];
  wanted.forEach(([title, group, p], i) => {
    if (p && present[i] && !out.some((d) => d.path === p)) out.push({ title, group, path: p });
  });
  return out;
}
