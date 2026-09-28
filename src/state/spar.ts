// The open project's SPAR loop (the SPAR half of the Mac app's Workspace): features
// (iterations), `spar next`, gates, tasks, the phase being shown and whether it follows the
// agent. Owned by the chat feature; the chat store (state/chat.ts) drives the conversation.

import { create } from "zustand";
import { fs, joinPath } from "../lib/api";
import { prefs } from "../lib/prefs";
import { useWorkspace } from "./workspace";
import {
  LIFECYCLE, PHASE, Spar, lifecycleOf, type GateState, type Lifecycle, type SparNext, type TaskGroup,
} from "../features/chat/sparcli";

interface FeatureInfo {
  artifacts: string[];
  openQuestions: number;
  briefPath: string | null;
  contracts: string[];
}

interface SparStore {
  root: string;
  sparDir: string;
  features: string[];
  feature: string | null;
  next: SparNext | null;
  gates: Record<string, GateState>;
  tasks: TaskGroup[];
  /** Stage states per feature ("done|current|todo" × 4), for the iteration rings. */
  featureStages: Record<string, string[]>;
  /** What's on disk for the selected feature (for summaries and the phase page). */
  info: FeatureInfo;
  architecture: string | null;
  uiApproved: boolean;
  draftingNewFeature: boolean;
  /** Phase navigation: the view follows the agent until the person picks another phase. */
  phase: Lifecycle;
  followAgent: boolean;
  loaded: boolean;
  /** Bumped on every refresh, so artifact cards re-read their excerpts. */
  version: number;
}

const EMPTY_INFO: FeatureInfo = { artifacts: [], openQuestions: 0, briefPath: null, contracts: [] };

export const useSpar = create<SparStore>(() => ({
  root: "", sparDir: "", features: [], feature: null, next: null, gates: {}, tasks: [], featureStages: {},
  info: EMPTY_INFO, architecture: null, uiApproved: false, draftingNewFeature: false, phase: "discover", followAgent: true,
  loaded: false, version: 0,
}));

const get = () => useSpar.getState();
const set = (p: Partial<SparStore>) => useSpar.setState(p);

/** Called after every refresh (the chat posts the next step into the conversation). */
let afterRefresh: (() => void) | null = null;
export function onSparRefreshed(cb: () => void) { afterRefresh = cb; }

export function resetSpar(root: string) {
  set({ root, sparDir: joinPath(root, "spar"), features: [], feature: null, next: null, gates: {}, tasks: [], featureStages: {}, info: EMPTY_INFO,
    architecture: null, uiApproved: false, draftingNewFeature: false, phase: "discover", followAgent: true, loaded: false });
}

function stateIn(stage: Lifecycle, next: SparNext): string {
  if (next.action === "done") return "done";
  return next.stages?.find((s) => s.id === PHASE[stage].sparStage)?.state ?? "todo";
}

/** Where SPAR is for the selected feature. */
export function currentPhase(s: SparStore = get()): Lifecycle | null {
  if (!s.next) return null;
  if (s.next.action === "done") return "deliver";
  return lifecycleOf(s.next.stage);
}

export function phaseState(p: Lifecycle, s: SparStore = get()): string {
  if (!s.next || s.draftingNewFeature) return p === "discover" ? "current" : "todo";
  return stateIn(p, s.next);
}

export const artifactPath = (file: string, feature?: string | null, s: SparStore = get()) => {
  const f = feature ?? s.feature;
  return f ? joinPath(s.sparDir, "specs", f, file) : null;
};

let refreshing: Promise<void> | null = null;
let again = false;

export async function refreshSpar(): Promise<void> {
  if (refreshing) { again = true; return refreshing; }
  refreshing = (async () => {
    do {
      again = false;
      await refreshOnce().catch(() => {});
    } while (again);
  })();
  try { await refreshing; } finally { refreshing = null; }
}

async function refreshOnce() {
  const root = get().root;
  if (!root) return;
  const sparDir = await Spar.dir(root);
  const features = await Spar.features(root);
  let feature = get().feature;
  if (feature && !features.includes(feature)) feature = features[features.length - 1] ?? null;
  if (!feature) feature = features[features.length - 1] ?? null;
  const next = await Spar.next(root, feature);
  if (next?.feature && !feature) feature = next.feature;
  let gates: Record<string, GateState> = {};
  let tasks: TaskGroup[] = [];
  let info = EMPTY_INFO;
  let uiApproved = false;
  if (feature) {
    [gates, tasks] = await Promise.all([Spar.gates(root, feature), Spar.tasks(root, feature)]);
    const [artifacts, openQuestions, briefPath, contracts, ui] = await Promise.all([
      Spar.artifacts(root, feature), Spar.openQuestions(root, feature), Spar.briefPath(root, feature), Spar.contracts(root, feature),
      Spar.hasApproval(root, feature, "ui-review"),
    ]);
    info = { artifacts, openQuestions, briefPath, contracts };
    uiApproved = ui;
  }
  if (root !== get().root) return;
  const arch = joinPath(sparDir, "architecture/architecture.md");
  const architecture = (await fs.exists(arch).catch(() => false)) ? arch : null;
  set({ sparDir, features, feature, next, gates, tasks, info, uiApproved, architecture, loaded: true, version: get().version + 1 });
  afterRefresh?.();
  const cur = currentPhase();
  if (get().followAgent && cur && cur !== get().phase) set({ phase: cur });
  useWorkspace.setState((s) => ({ fileTreeVersion: s.fileTreeVersion + 1, reloadToken: s.reloadToken + 1 }));
  await refreshFeatureStages();
}

async function refreshFeatureStages() {
  const { root, features, feature, next } = get();
  const result: Record<string, string[]> = {};
  for (const f of features.slice(-12)) {
    if (f === feature && next) result[f] = LIFECYCLE.map((p) => stateIn(p, next));
    else {
      const n = await Spar.next(root, f);
      if (n) result[f] = LIFECYCLE.map((p) => stateIn(p, n));
    }
  }
  if (root === get().root) set({ featureStages: result });
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
/** Tasks ticked or a spec written: the phase view follows at once, not only at the end of a
 *  turn. A throttle, not a debounce: an agent that keeps writing under spar/ during a long
 *  build must not postpone the refresh until its turn ends (refreshSpar re-runs once more if
 *  anything changed while it ran). */
export function scheduleSparRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = undefined; refreshSpar(); }, 1000);
}

/** A ticked task shows at once: tasks.md is parsed locally, no `spar` call needed. */
export async function refreshTasksNow() {
  const { root, feature } = get();
  if (!root || !feature) return;
  const tasks = await Spar.tasks(root, feature);
  if (root === get().root && feature === get().feature && JSON.stringify(tasks) !== JSON.stringify(get().tasks)) set({ tasks });
}

export function selectFeature(f: string) {
  set({ feature: f, draftingNewFeature: false, followAgent: true });
  useWorkspace.getState().open({ kind: "phase" });
  refreshSpar();
}

export function selectPhase(p: Lifecycle) {
  set({ followAgent: p === currentPhase(), draftingNewFeature: false, phase: p });
  useWorkspace.getState().open({ kind: "phase" });
}

/** Starts the next pass around the loop. */
export function startNextIteration() {
  set({ draftingNewFeature: true, followAgent: false, phase: "discover" });
  useWorkspace.getState().open({ kind: "phase" });
}

export function cancelNewIteration() {
  set({ draftingNewFeature: false, followAgent: true });
  refreshSpar();
}

/** A one-line status for a phase, shown in the loop navigator. */
export function summary(p: Lifecycle, s: SparStore = get()): string {
  const f = s.feature;
  if (!f || s.draftingNewFeature) return p === "discover" ? "Describe the idea" : "Not started";
  const st = phaseState(p, s);
  const gateName = PHASE[p].gate;
  const gate = gateName ? s.gates[gateName] : undefined;
  if (gateName && gate) {
    if (s.next?.action === "gate" && s.next?.gate === gateName) return "Needs your review";
    if (gate.approved && gate.stale === true) return "Changed since approval";
    if (gate.changes_requested) return "Changes requested";
    if (gate.approved && p !== "develop") return p === "discover" ? "Spec approved" : "Plan approved";
  }
  const has = s.info.artifacts;
  switch (p) {
    case "discover":
      if (s.info.openQuestions > 0) return `${s.info.openQuestions} open question${s.info.openQuestions === 1 ? "" : "s"}`;
      return has.includes("spec.md") ? "Spec drafted" : "Not started";
    case "design":
      if (has.includes("tasks.md")) return "Plan and tasks drafted";
      if (has.includes("plan.md")) return "Plan drafted";
      return st === "current" ? "In progress" : "Not started";
    case "develop": {
      const total = s.tasks.reduce((n, g) => n + g.tasks.length, 0);
      const done = s.tasks.reduce((n, g) => n + g.tasks.filter((t) => t.done).length, 0);
      if (total === 0) return "Not started";
      return done === total ? `All ${total} tasks done` : `${done} of ${total} tasks`;
    }
    case "deliver":
      if (s.next?.action === "done") return "Verified";
      return has.includes("verification.md") ? "Verifying" : "Not started";
  }
}

// ---- UI first (mock data, review, then integrate) --------------------------------------

export const uiFirst = () => prefs.get<boolean>(`uiFirst:${get().root}`, true);
export const setUIFirst = (v: boolean) => prefs.set(`uiFirst:${get().root}`, v);
export const uiFirstRequested = () => { const f = get().feature; return f ? prefs.get<boolean>(`uiFirstRequested:${get().root}:${f}`, false) : false; };
export const setUIFirstRequested = (v: boolean) => { const f = get().feature; if (f) prefs.set(`uiFirstRequested:${get().root}:${f}`, v); };
