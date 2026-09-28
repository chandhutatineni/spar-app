// The SPAR CLI and the project's spar/ folder (a port of the Mac app's Spar.swift, the
// Lifecycle enum, and the test-report / UI-first helpers from Testing.swift).
// `spar next --json` is the one deterministic answer to "what now?".

import { fs, joinPath, spar as runSpar, exec } from "../../lib/api";

export interface SparStage { id: string; label: string; state: string }
export interface SparOption { id: string; label: string; detail?: string | null }
export interface SparNext {
  action: string;
  feature?: string | null;
  /** The phase command that owns this step (init, explore, design, build, deliver, adopt, fix). */
  phase?: string | null;
  phase_command?: string | null;
  command?: string | null;
  scope?: string | null;
  gate?: string | null;
  owner?: string | null;
  stage: string;
  reason: string;
  stages: SparStage[];
  options?: SparOption[] | null;
  followons?: string[] | null;
}

export interface GateState {
  gate: string;
  artifacts: string[];
  approved: boolean;
  changes_requested: boolean;
  stale?: boolean | null;
  note?: string | null;
  by?: string | null;
}

// ---- Lifecycle --------------------------------------------------------------------------

export type Lifecycle = "discover" | "design" | "develop" | "deliver";
export const LIFECYCLE: Lifecycle[] = ["discover", "design", "develop", "deliver"];

export const PHASE: Record<Lifecycle, {
  title: string; subtitle: string; icon: string; tint: string; purpose: string; artifacts: string[];
  gate: string | null; reviseCommand: string; revisePrompt: string; sparStage: string; notStartedText: string;
}> = {
  discover: {
    title: "Discover", subtitle: "Brief & spec", icon: "ScanSearch", tint: "#1f99cc", sparStage: "brief",
    purpose: "Understand the problem and agree on what to build.", artifacts: ["spec.md"], gate: "approve-spec",
    reviseCommand: "explore", revisePrompt: "What should change in the spec?", notStartedText: "Discovery starts with a brief.",
  },
  design: {
    title: "Design", subtitle: "Plan & tasks", icon: "Layers", tint: "#5c57f2", sparStage: "design",
    purpose: "Decide how to build it, then break it into tasks.", artifacts: ["plan.md", "research.md", "data-model.md", "tasks.md"], gate: "approve-plan",
    reviseCommand: "design", revisePrompt: "What should change in the plan or tasks?", notStartedText: "Design begins once you approve the spec.",
  },
  develop: {
    title: "Develop", subtitle: "Build", icon: "Hammer", tint: "#ed802e", sparStage: "build",
    purpose: "Build it task by task, tests first.", artifacts: ["build-log.md"], gate: "checkpoint",
    reviseCommand: "build", revisePrompt: "What should change in the build?", notStartedText: "Development begins once you approve the plan.",
  },
  deliver: {
    title: "Deliver", subtitle: "Verify & ship", icon: "Package", tint: "#33a878", sparStage: "prove",
    purpose: "Prove it works, ship it, and carry the lessons into the next iteration.", artifacts: ["verification.md", "test-report.md"], gate: null,
    reviseCommand: "deliver", revisePrompt: "What should be verified again?", notStartedText: "Delivery begins when the build is complete.",
  },
};

export function lifecycleOf(sparStage: string): Lifecycle | null {
  switch (sparStage) {
    case "brief": return "discover";
    case "design": return "design";
    case "build": return "develop";
    case "prove": case "done": return "deliver";
    default: return null;
  }
}
export const nextPhase = (p: Lifecycle) => LIFECYCLE[(LIFECYCLE.indexOf(p) + 1) % 4];
export const previousPhase = (p: Lifecycle) => LIFECYCLE[(LIFECYCLE.indexOf(p) + 3) % 4];

export const stageTitle = (stage: string) => (stage === "done" ? "Delivered" : (lifecycleOf(stage) && PHASE[lifecycleOf(stage)!].title) || cap(stage));
export const stageTint = (stage: string) => (stage === "done" ? "var(--done)" : (lifecycleOf(stage) && PHASE[lifecycleOf(stage)!].tint) || "var(--accent)");

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- The CLI ---------------------------------------------------------------------------

function decode<T>(output: string): T | null {
  const start = output.indexOf("{");
  if (start < 0) return null;
  try { return JSON.parse(output.slice(start)) as T; } catch { return null; }
}

export interface TaskItem { id: string; title: string; done: boolean }
export interface TaskGroup { id: string; tasks: TaskItem[] }
export const groupDone = (g: TaskGroup) => g.tasks.filter((t) => t.done).length;

export const TENETS_GATE = "approve-tenets";
export const FIX_GATE = "approve-fix";
export const TENETS_FILES = ["tenets.md", "standards.md", "references.md"];
export const ARTIFACT_ORDER = ["spec.md", "plan.md", "research.md", "data-model.md", "tasks.md", "build-log.md", "verification.md", "test-report.md"];

const MARKERS = ["specs", "tenets.md", "standards.md", "manifest.json", "decisions.jsonl", "briefs"];

async function exists(p: string) { return fs.exists(p).catch(() => false); }

export const Spar = {
  async next(root: string, feature: string | null): Promise<SparNext | null> {
    const args = ["next", ...(feature ? [feature] : []), "--json"];
    const r = await runSpar(root, args).catch(() => null);
    return r ? decode<SparNext>(r.stdout) : null;
  },

  async gates(root: string, feature: string): Promise<Record<string, GateState>> {
    const r = await runSpar(root, ["gate", feature, "--json"]).catch(() => null);
    return (r && decode<{ gates: Record<string, GateState> }>(r.stdout)?.gates) || {};
  },

  /** Writes a human decision to the hash-chained ledger (the app's own call, with the human token). */
  async decide(root: string, feature: string, gate: string, approve: boolean, note: string, target = "") {
    const args = ["gate", approve ? "approve" : "request-changes", ...(feature ? [feature] : []), gate, ...(target ? [target] : [])];
    if (note || !approve) args.push("--note", note);
    return runSpar(root, args, { human: true });
  },

  /** Which MVP to build first is the person's call. */
  mvpSelect(root: string, option: string) {
    return runSpar(root, ["mvp", "select", option, "--note", "Chosen in the SPAR app"], { human: true });
  },

  /** Follow-on steps that aren't phase commands (retrospective, issue export). */
  stepRequest(step: string, feature: string) {
    return `Run SPAR's ${step} step for ${feature}: follow ~/.claude/spar-steps/${step}.md.`;
  },

  /** The project's SPAR folder: spar/ (a real workspace), else the legacy .spar/, else spar/. */
  async dirName(root: string): Promise<string> {
    for (const m of MARKERS) if (await exists(joinPath(root, "spar", m))) return "spar";
    if (await exists(joinPath(root, ".spar"))) return ".spar";
    return "spar";
  },
  async dir(root: string) { return joinPath(root, await Spar.dirName(root)); },

  async isWorkspace(root: string) {
    const d = await Spar.dir(root);
    for (const m of MARKERS) if (await exists(joinPath(d, m))) return true;
    return false;
  },

  isArtifactPath: (p: string) => p.includes("/spar/specs/") || p.includes("/.spar/specs/"),

  async architecturePath(root: string) { return joinPath(await Spar.dir(root), "architecture/architecture.md"); },

  async features(root: string): Promise<string[]> {
    const specs = joinPath(await Spar.dir(root), "specs");
    const list = await fs.list(specs).catch(() => []);
    return list.filter((e) => e.is_dir && !e.name.startsWith(".")).map((e) => e.name).sort();
  },

  async artifacts(root: string, feature: string): Promise<string[]> {
    const d = joinPath(await Spar.dir(root), "specs", feature);
    const names = new Set((await fs.list(d).catch(() => [])).map((e) => e.name));
    return ARTIFACT_ORDER.filter((a) => names.has(a));
  },

  artifactTitle(file: string): string {
    return ({
      "spec.md": "Spec", "plan.md": "Plan", "research.md": "Research", "data-model.md": "Data model", "tasks.md": "Tasks",
      "build-log.md": "Build log", "verification.md": "Verification", "test-report.md": "Test report", "case.md": "Brief",
      "architecture.md": "Architecture",
    } as Record<string, string>)[file] ?? file;
  },

  /** "001-record-note-and-see-today" → "Record note and see today" */
  featureTitle(id: string): string {
    const words = id.split("-").filter(Boolean);
    if (words.length && /^\d+$/.test(words[0])) words.shift();
    const s = words.join(" ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  },

  actionTitle(next: SparNext): string {
    switch (next.action) {
      case "run":
        switch (next.command ?? "") {
          case "tenets": return "Propose the engineering principles";
          case "fix": return "Rework the fix";
          case "adopt": return "Map the existing codebase";
          case "context": return "Gather organisation context";
          case "specify": return "Write the spec";
          case "clarify": return "Resolve open questions";
          case "roadmap": return "Shape the roadmap";
          case "plan": return "Design the solution";
          case "tasks": return "Break the plan into tasks";
          case "analyze": return "Cross-check the artifacts";
          case "build": return "Build the next tasks";
          case "verify": return "Testing end to end";
          case "release": return "Shipping";
          default: return cap(next.command ?? "");
        }
      case "check": return "Run the checks";
      case "fix": return "Fix what the checks found";
      case "gate":
        switch (next.gate ?? "") {
          case "approve-tenets": return "Review the engineering principles";
          case "approve-fix": return "Review the fix";
          case "approve-release": return "Ready to ship";
          case "approve-spec": return "Review the spec";
          case "approve-plan": return "Review the plan";
          case "checkpoint": return "Review the checkpoint";
          default: return "Your review";
        }
      case "prompt": return next.command === "init" ? "What do you want to build?" : "What should we build?";
      case "select": return "Choose what to build first";
      case "setup": return "Set this up to continue";
      case "blocked": return "Blocked";
      case "done": return "Delivered";
      default: return cap(next.action);
    }
  },

  /** Parses tasks.md: `## Phase …` groups, `### T001 [US1] Title` headings, `- [x] T001` lines. */
  parseTasks(text: string): TaskGroup[] {
    const order: { group: string; id: string }[] = [];
    const titles = new Map<string, string>();
    const done = new Set<string>();
    let group = "Tasks";
    // The same task line the CLI reads: `- [x] T001`, `* [ ] **T001**`; a checklist item that
    // only mentions a task ("- [x] tests for T003 pass") is not that task.
    const checkPattern = /^[-*]\s*\[( |x|X)\]\s*\**(T\d{3})\b/;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line.startsWith("## ")) { group = line.slice(3).trim(); continue; }
      const check = checkPattern.exec(line);
      const isHeading = line.startsWith("### ");
      if (!isHeading && !check) continue;
      let id: string, end: number;
      if (check) { id = check[2]; end = check[0].length; }
      else {
        const m = /\bT\d{3}\b/.exec(line);
        if (!m) continue;
        id = m[0]; end = m.index + id.length;
      }
      if (check && check[1] !== " ") done.add(id);
      const rest = line.slice(end).replace(/\[[^\]]*\]/g, "").replace(/^[ —\-:*]+|[ —\-:*]+$/g, "");
      if (!titles.has(id) || (isHeading && rest)) {
        if (!titles.has(id)) order.push({ group, id });
        if (rest || !titles.has(id)) titles.set(id, rest);
      }
    }
    const groups: TaskGroup[] = [];
    for (const { group: g, id } of order) {
      const item = { id, title: titles.get(id) ?? "", done: done.has(id) };
      const existing = groups.find((x) => x.id === g);
      if (existing) existing.tasks.push(item); else groups.push({ id: g, tasks: [item] });
    }
    return groups.filter((g) => !g.id.toLowerCase().startsWith("traceab"));
  },

  async tasks(root: string, feature: string): Promise<TaskGroup[]> {
    const text = await fs.readText(joinPath(await Spar.dir(root), "specs", feature, "tasks.md")).catch(() => null);
    return text == null ? [] : Spar.parseTasks(text);
  },

  /** The brief (`spar/briefs/<id>/case.md`) a spec was written from. */
  async briefPath(root: string, feature: string): Promise<string | null> {
    const dirName = await Spar.dirName(root);
    const text = await fs.readText(joinPath(root, dirName, "specs", feature, "spec.md")).catch(() => null);
    const m = text?.match(/\.?spar\/briefs\/[^\s/`)]+\/case\.md/);
    if (!m) return null;
    const p = joinPath(root, m[0].replace(/^\.?spar\//, dirName + "/"));
    return (await exists(p)) ? p : null;
  },

  async openQuestions(root: string, feature: string): Promise<number> {
    const text = await fs.readText(joinPath(await Spar.dir(root), "specs", feature, "spec.md")).catch(() => null);
    return text ? text.split("[NEEDS CLARIFICATION").length - 1 : 0;
  },

  async contracts(root: string, feature: string): Promise<string[]> {
    const d = joinPath(await Spar.dir(root), "specs", feature, "contracts");
    return (await fs.list(d).catch(() => [])).filter((e) => !e.name.startsWith(".")).map((e) => e.path).sort();
  },

  /** Whether the ledger holds a human approval with this name for a feature. */
  async hasApproval(root: string, feature: string, name: string): Promise<boolean> {
    const text = await fs.readText(joinPath(await Spar.dir(root), "decisions.jsonl")).catch(() => null);
    if (!text) return false;
    for (const line of text.split("\n").reverse()) {
      try {
        const o = JSON.parse(line);
        if (o?.action?.name === name && o?.context?.feature_id === feature) return o.verdict === "approved";
      } catch { /* not a record */ }
    }
    return false;
  },

  /** Records the UI review in the ledger (a person's decision: human token). */
  async approveUI(root: string, feature: string) {
    const who = (await exec.run("git", ["config", "user.name"], { cwd: root }).catch(() => null))?.stdout.trim() || "person";
    return runSpar(root, ["decision", "--subject", who, "--subject-kind", "human",
      "--action-kind", "artifact.approve", "--name", "ui-review",
      "--resource", "ui-preview", "--verdict", "approved",
      "--feature", feature, "--phase", "build",
      "--explanation", "UI with mock data approved in the live preview"], { human: true });
  },
};

// ---- Artifact excerpts ----------------------------------------------------------------

/** The first prose paragraph under the first section heading. */
export function excerpt(text: string): string {
  const prose = text.replace(/<!--[\s\S]*?-->/g, "");
  const lines = prose.split("\n").map((l) => l.trim());
  const usable = (l: string) => l.length > 40 && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("```") && !l.startsWith("---")
    && !(l.startsWith("**") && l.includes(":**") && l.includes(" · "));
  let start = lines.findIndex((l) => l.startsWith("## "));
  if (start < 0) start = 0;
  const line = lines.slice(start).find(usable) ?? lines.find(usable) ?? "";
  return line.replace(/\*\*/g, "").replace(/`/g, "").replace(/^[-*>] |^\d+\. /, "");
}

// ---- Testing pillars ------------------------------------------------------------------

export type Pillar = "unit" | "integration" | "e2e" | "acceptance";
export const PILLARS: { id: Pillar; title: string; detail: string; icon: string }[] = [
  { id: "unit", title: "Unit", detail: "Every requirement has fast, isolated tests of the code that implements it.", icon: "Box" },
  { id: "integration", title: "Integration", detail: "The real pieces work together: APIs, storage, services, the file system.", icon: "Layers" },
  { id: "e2e", title: "End-to-end", detail: "The app runs locally and a real browser (Playwright) walks each user flow from the spec.", icon: "Globe" },
  { id: "acceptance", title: "Acceptance", detail: "SPAR verifies each acceptance criterion and builds the requirement → test traceability matrix.", icon: "BadgeCheck" },
];

export function pillarInstruction(p: Pillar, f: string, testCommand: string | null, runCommand: string | null, hasUI: boolean): string {
  const title = PILLARS.find((x) => x.id === p)!.title;
  const report = `Then update spar/specs/${f}/test-report.md: keep a table \`| Pillar | Result | Details |\` and set the ${title} row's Result to PASS or FAIL with a one-line summary.`;
  switch (p) {
    case "unit":
      return `Testing pillar 1 of 4, unit tests for ${f}: make sure every requirement in the spec has unit tests, write the missing ones, run them${testCommand ? ` with \`${testCommand}\`` : ""}, and fix failures. ${report}`;
    case "integration":
      return `Testing pillar 2 of 4, integration tests for ${f}: write and run tests that exercise the real components together (for example API and storage, CLI and file system, service calls) rather than mocks, and fix failures. ${report}`;
    case "e2e":
      if (hasUI) return `Testing pillar 3 of 4, end-to-end for ${f}: start the app locally${runCommand ? ` (\`${runCommand}\`)` : ""}, then use the Playwright MCP browser tools to walk through every acceptance scenario in the spec as a user would, checking what the page shows. Save screenshots to spar/specs/${f}/e2e/ and fix what fails. ${report}`;
      return `Testing pillar 3 of 4, end-to-end for ${f}: run the program locally the way a user would${runCommand ? ` (\`${runCommand}\`)` : ""} and walk through every acceptance scenario in the spec, checking the real output. Fix what fails. ${report}`;
    case "acceptance":
      return `/spar.build ${f} Afterwards, testing pillar 4 of 4: set the Acceptance row in spar/specs/${f}/test-report.md to PASS only if every acceptance criterion is met, otherwise FAIL with what is missing.`;
  }
}

export interface PillarResult { state: "notRun" | "pass" | "fail"; detail: string }

/** Reads the `| Pillar | Result | Details |` table the agent maintains. */
export function parseTestReport(text: string): Partial<Record<Pillar, PillarResult>> {
  const out: Partial<Record<Pillar, PillarResult>> = {};
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter((c, i, a) => !(c === "" && (i === 0 || i === a.length - 1)));
    if (cells.length < 2) continue;
    const name = cells[0].toLowerCase();
    const pillar: Pillar | null = name.startsWith("unit") ? "unit" : name.startsWith("integration") ? "integration"
      : name.startsWith("end") || name.startsWith("e2e") ? "e2e" : name.startsWith("accept") ? "acceptance" : null;
    if (!pillar) continue;
    const result = cells[1].toUpperCase();
    out[pillar] = { state: result.includes("PASS") ? "pass" : result.includes("FAIL") ? "fail" : "notRun", detail: cells[2] ?? "" };
  }
  return out;
}

/** Whether the project has a UI to preview (Preview.swift's detection). */
export async function detectUI(root: string): Promise<{ available: boolean; isServer: boolean; runCommand: string | null }> {
  for (const dir of ["", "web", "frontend", "app", "client", "ui", "site"]) {
    const base = dir ? joinPath(root, dir) : root;
    const text = await fs.readText(joinPath(base, "package.json")).catch(() => null);
    if (!text) continue;
    try {
      const scripts = JSON.parse(text)?.scripts ?? {};
      const s = ["dev", "start", "serve", "preview"].find((k) => scripts[k] != null);
      if (s) return { available: true, isServer: true, runCommand: `npm run ${s}` };
    } catch { /* not JSON */ }
  }
  for (const dir of ["", "public", "src", "web", "site", "docs", "app", "dist"]) {
    if (await exists(joinPath(dir ? joinPath(root, dir) : root, "index.html"))) return { available: true, isServer: false, runCommand: null };
  }
  return { available: false, isServer: false, runCommand: null };
}
