// The open project's agent chat (the chat half of the Mac app's Workspace.swift plus
// Composer.swift): one engine session per agent per project, the transcript, the composer,
// the queue, approvals, and the SPAR workflow as one conversation. Owned by the chat feature.

import { create } from "zustand";
import { app as appApi, basename, exec, fs, joinPath, relativePath, spar as runSpar } from "../lib/api";
import { mcpConfigPath } from "../features/mcp/store";
import { call } from "../lib/backend";
import { prefs } from "../lib/prefs";
import { onFilesChanged, onProjectClose, onProjectOpen } from "./app";
import { useWorkspace } from "./workspace";
import {
  artifactPath, currentPhase, onSparRefreshed, refreshSpar, refreshTasksNow, resetSpar, scheduleSparRefresh, selectPhase, setUIFirstRequested,
  startNextIteration, uiFirst, uiFirstRequested, useSpar,
} from "./spar";
import { engine as client, type Change } from "../engine/client";
import { engineAgentName, engineReady, useEngine } from "../engine/engine";
import {
  AgentPrefsStore, CLAUDE_VIBE_AGENT, autoApproves, baseOf, defaultMode, diagramConventions, effortTitle, interactionInfo, isCustom, launchArgs,
  models, modes, named, PORTABLE_SPAR_PROMPT, resolve, SLIDES_CONVENTIONS, type AgentKind, type AgentPrefs, type Interaction,
} from "../features/chat/catalog";
import { Transcript, type Entry, type StepCard } from "../features/chat/transcript";
import { singleLine } from "../features/chat/wire";
import { Spar, FIX_GATE, TENETS_GATE, PHASE, type Lifecycle, type SparOption } from "../features/chat/sparcli";
import { restoreCheckpoint as scmRestore, undoRestore as scmUndo } from "../features/scm/store";
import { BobRunner, Checkpoints, loadRules, ruleApplies, type ProjectRule } from "../features/chat/support";
import { previewAvailable, previewIsServer, preview, usePreview } from "../features/terminal/preview";

// ---- Types -----------------------------------------------------------------------------

/** Something attached to the next message (@-mentions, selections, files, a phase to refine). */
export type ContextChip =
  | { kind: "file"; path: string }        // workspace-relative
  | { kind: "folder"; path: string }
  | { kind: "changes" }
  | { kind: "previewErrors" }
  | { kind: "devLog" }
  | { kind: "web" }
  | { kind: "refine"; phase: Lifecycle }
  | { kind: "selection"; path: string; from: number; to: number; text: string }
  | { kind: "attachment"; path: string }; // absolute path sent with the message

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "bmp"];
export const chipIsImage = (c: ContextChip) => c.kind === "attachment" && IMAGE_EXT.includes((c.path.split(".").pop() ?? "").toLowerCase());
export function chipId(c: ContextChip): string {
  switch (c.kind) {
    case "file": return `file:${c.path}`;
    case "folder": return `folder:${c.path}`;
    case "refine": return `refine:${c.phase}`;
    case "selection": return `sel:${c.path}:${c.from}-${c.to}`;
    case "attachment": return `att:${c.path}`;
    default: return c.kind;
  }
}
export function chipTitle(c: ContextChip): string {
  switch (c.kind) {
    case "file": return basename(c.path);
    case "folder": return basename(c.path) + "/";
    case "changes": return "Git changes";
    case "previewErrors": return "Preview errors";
    case "devLog": return "Dev server log";
    case "web": return "Web";
    case "refine": return `Refine ${PHASE[c.phase].title}`;
    case "selection": return `${basename(c.path)}:${c.from}–${c.to}`;
    case "attachment": return basename(c.path);
  }
}

export interface QueuedMessage { id: string; text: string }
export interface ChatRecord { id: string; title: string; date: number }
export interface InlineEdit { path: string; original: string; from: number; to: number; state: "waiting" | "review" }

interface ChatStore {
  root: string;
  baseAgent: AgentKind;
  specDriven: boolean;
  prefs: AgentPrefs;
  sessionId: string | null;
  status: string;
  blockedOn: string | null;
  cost: number;
  /** The model the agent actually reports using, e.g. "claude-opus-5-5[1m]". */
  sessionModel: string | null;
  connectionError: string | null;
  /** The agent's tmux terminal, for Watch in Terminal. */
  terminal: { socket: string; target: string } | null;
  entries: Entry[];
  draft: string;
  chips: ContextChip[];
  queue: QueuedMessage[];
  /** Question forms already answered (by entry id), so they show as sent. */
  answered: string[];
  allowAllInChat: boolean;
  changes: Change[];
  lastTurnChanges: string[];
  lastTurnStart: string | null;
  /** Message entry id → checkpoint taken just before it was sent. */
  checkpoints: Record<string, string>;
  restoredUndo: string | null;
  inlineEdit: InlineEdit | null;
  /** For other features: a line in the conversation. */
  note(text: string): void;
  historyIndex: number | null;
  focusToken: number;
  rules: ProjectRule[];
}

const CLAUDE = named("claude-native-ui");

export const useChat = create<ChatStore>(() => ({
  root: "", baseAgent: CLAUDE, specDriven: true, prefs: AgentPrefsStore.load(CLAUDE.name), sessionId: null, status: "starting",
  blockedOn: null, cost: 0, sessionModel: null, connectionError: null, terminal: null, entries: [], draft: "", chips: [], queue: [],
  answered: [], allowAllInChat: false, changes: [], lastTurnChanges: [], lastTurnStart: null, checkpoints: {}, restoredUndo: null,
  inlineEdit: null, historyIndex: null, focusToken: 0, rules: [],
  note: (text: string) => tx((t) => t.note(text)),
}));

const S = () => useChat.getState();
const set = (p: Partial<ChatStore>) => useChat.setState(p);

// ---- Non-reactive session state --------------------------------------------------------

let transcript = new Transcript();
let generation = 0;            // bumps whenever the session changes: stale async work stops
let closeStream: (() => void) | null = null;
let watchdog: ReturnType<typeof setInterval> | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let lastEventAt = Date.now();
let lastActivityAt = Date.now();
let stallShown = false;
/** A message was just sent: until the engine reports the turn running (and then idle
 *  again), a stale "idle" is not the end of it. */
let lastSendAt = 0;
let sawRunningSinceSend = true;
let modelJustReset = false;
let lastStage: string | null = null;
let stepFeature: string | null = null;
let turnCheckpoint: string | null = null;
let lastAutoSignature = "";
let pendingSparText: string | null = null;
let outgoingAttachments: string[] = [];
let rulesSent = new Set<string>();
let bob: BobRunner | null = null;
let checkpointStore: Checkpoints | null = null;
let devActionsRan = false;
let historyStash = "";
/** Automatic continues since the person last did something (reset when they send or decide). */
let autoSteps = 0;
let unlistenFiles: (() => void) | null = null;
let changesTimer: ReturnType<typeof setTimeout> | undefined;
let mcpConfig: string | null = null;
/** Set by Stop so nothing starts again by itself until the person sends something. */
let stoppedByUser = false;
/** Tasks done when the current turn was sent: a build that ticks tasks carries on. */
let turnStartDone = 0;
const tasksDone = () => useSpar.getState().tasks.reduce((n, g) => n + g.tasks.filter((t) => t.done).length, 0);
/** The session cost already recorded for the impact report, and when the unrecorded work began. */
let impactBase: { session: string; cost: number } | null = null;
let impactStart: number | null = null;

/** Applies a change to the transcript and publishes it. */
function tx<T>(fn: (t: Transcript) => T): T {
  const r = fn(transcript);
  set({ entries: transcript.entries.slice() });
  return r;
}
export const currentTranscript = () => transcript;

// ---- Derived ----------------------------------------------------------------------------

export const agentOf = (s: ChatStore = S()) => resolve(s.baseAgent, s.specDriven);
export const isRunning = (s: ChatStore = S()) => s.status === "running" || s.status === "waiting";
export const interactionOf = (s: ChatStore = S()): Interaction => (["agent", "ask", "plan", "debug"].includes(s.prefs.interaction ?? "") ? s.prefs.interaction as Interaction : "agent");
export const availableInteractions = (s: ChatStore = S()): Interaction[] => {
  const f = agentOf(s).family;
  return f === "claude" || f === "codex" ? ["agent", "ask", "plan", "debug"] : ["agent", "ask", "debug"];
};
/** Claude Code's permission mode for the current interaction and approval choice. */
export function effectivePermission(s: ChatStore = S()): string | null {
  const a = agentOf(s);
  if (a.family !== "claude") return null;
  return interactionInfo(interactionOf(s)).readOnly ? "plan" : (s.prefs.mode ?? defaultMode(a));
}
const currentLaunchArgs = () => launchArgs(agentOf(), effectivePermission(), mcpConfig);

export function modelTitle(s: ChatStore = S()) {
  if (s.prefs.model) return models(agentOf(s)).find((m) => m.id === s.prefs.model)?.title ?? s.prefs.model;
  return "Default model";
}
export function modeTitle(s: ChatStore = S()) {
  const m = s.prefs.mode ?? defaultMode(agentOf(s));
  return m ? modes(agentOf(s)).find((x) => x.id === m)?.title ?? null : null;
}

const sessionKey = () => {
  const a = agentOf();
  // Spec-driven Claude keeps the original per-project key; every other agent has its own chat,
  // or switching to Copilot would resume Claude Code's session under Copilot's name.
  return a.runsSpar && a.family === "claude" ? `session:${S().root}` : `session:${S().root}:${a.name}`;
};
const historyKey = () => `chats:${S().root}:${agentOf().name}`;
const promptKey = () => `promptHistory:${S().root}`;

/** Earlier chats with the current agent in this project, newest first. */
export function chatHistory(): ChatRecord[] {
  return [...prefs.get<ChatRecord[]>(historyKey(), [])].sort((a, b) => b.date - a.date);
}

async function attention() {
  try {
    const { getCurrentWindow, UserAttentionType } = await import("@tauri-apps/api/window");
    await getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
  } catch { /* dev browser */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Project lifecycle -----------------------------------------------------------------

function resetSessionState() {
  generation++;
  closeStream?.();
  closeStream = null;
  clearInterval(watchdog);
  clearTimeout(settleTimer);
  transcript = new Transcript();
  lastStage = null;
  stepFeature = null;
  stallShown = false;
  sawRunningSinceSend = true;
  lastSendAt = 0;
  modelJustReset = false;
  turnCheckpoint = null;
  lastAutoSignature = "";
}

onProjectOpen((root) => { openProject(root); });
onProjectClose(() => closeProject());

async function openProject(root: string) {
  resetSessionState();
  // Older versions stored "spar" / "spar-<agent>" as the agent itself.
  const saved = prefs.get<string>(`agent:${root}`, "spar");
  const kind = named(saved);
  const base = kind.runsSpar ? named(saved === "spar" ? "claude-native-ui" : saved.slice(5)) : kind;
  const specDriven = prefs.get<boolean | null>(`specDriven:${root}`, null) ?? !!kind.runsSpar;
  bob = null;
  checkpointStore = new Checkpoints(root);
  devActionsRan = false;
  rulesSent = new Set();
  autoSteps = 0;
  outgoingAttachments = [];
  pendingSparText = null;
  set({
    root, baseAgent: base, specDriven, prefs: AgentPrefsStore.load(base.name), sessionId: null, status: "starting", blockedOn: null,
    cost: 0, sessionModel: null, connectionError: null, terminal: null, entries: [], draft: "", chips: [], queue: [], answered: [],
    allowAllInChat: false, changes: [], lastTurnChanges: [], lastTurnStart: null, checkpoints: {}, restoredUndo: null, inlineEdit: null,
    historyIndex: null, rules: [],
  });
  resetSpar(root);
  applyMode();
  if (prefs.get<boolean>("showWelcomeOnOpen", true) && agentOf().runsSpar) {
    const ws = useWorkspace.getState();
    ws.open({ kind: "welcome" });
  }
  mcpConfig = await mcpConfigPath().catch(() => null);
  if (mcpConfig && !(await fs.exists(mcpConfig).catch(() => false))) mcpConfig = null;
  const env = (await appApi.info().catch(() => null))?.env ?? {};
  // Development aid: SPAR_OPEN=<file|review|rules|preview|search|scm|mcp|trace|impact|diff:path> opens a tab.
  if (env.SPAR_OPEN) {
    const ws = useWorkspace.getState();
    const o = env.SPAR_OPEN;
    const named: Record<string, () => void> = {
      review: () => ws.open({ kind: "review" }), rules: () => ws.open({ kind: "rules" }), preview: () => ws.open({ kind: "preview" }),
      search: () => ws.showSidebar("search"), scm: () => ws.open({ kind: "sourceControl" }), mcp: () => ws.open({ kind: "mcp" }),
      trace: () => ws.open({ kind: "trace" }), impact: () => ws.open({ kind: "impact" }),
    };
    if (named[o]) named[o]();
    else if (o.startsWith("diff:")) ws.open({ kind: "diff", path: o.slice(5) });
    else ws.openFile(o);
  }
  if (env.SPAR_DRAFT) set({ draft: env.SPAR_DRAFT });
  if (env.SPAR_SIDEBAR && ["work", "files", "search", "git"].includes(env.SPAR_SIDEBAR)) useWorkspace.getState().showSidebar(env.SPAR_SIDEBAR as "work");
  if (env.SPAR_AGENTINFO) useWorkspace.getState().set({ showAgentInfo: true });
  // Development aid: SPAR_NEWCHAT=1 starts a fresh chat instead of resuming (once per launch).
  if (env.SPAR_NEWCHAT && !sessionStorage.getItem("spar:newchat")) {
    sessionStorage.setItem("spar:newchat", "1");
    rememberSession(sessionKey(), NEW_CHAT);
  }
  unlistenFiles?.();
  unlistenFiles = onFilesChanged((paths) => {
    const real = paths.filter((p) => !p.includes("/.git/") && !p.endsWith("/.git"));
    if (!real.length) return;
    refreshChanges();
    // Tasks ticked, a spec or plan written: the phase view and task list follow at once.
    const f = useSpar.getState().feature;
    if (f && real.some((p) => p.endsWith(`/specs/${f}/tasks.md`))) refreshTasksNow();
    if (real.some((p) => p.includes("/spar/") || p.includes("/.spar/"))) scheduleSparRefresh();
  });
  refreshChanges();
  reloadRules();
  await refreshSpar();
  // Development aids: SPAR_AGENT=<agent name>, SPAR_PHASE=<discover|design|develop|deliver|new>.
  if (env.SPAR_AGENT) switchAgent(named(env.SPAR_AGENT));
  if (env.SPAR_PHASE) {
    if (env.SPAR_PHASE === "new") startNextIteration();
    else if (env.SPAR_PHASE in PHASE) selectPhase(env.SPAR_PHASE as Lifecycle);
  }
  attachSession();
}

function closeProject() {
  resetSessionState();
  unlistenFiles?.();
  unlistenFiles = null;
  bob?.stop();
}

export async function reloadRules() {
  const root = S().root;
  if (!root) return;
  const rules = await loadRules(root, await Spar.dir(root));
  if (root === S().root) set({ rules });
}

/** Keeps the tabs and sidebar in step with the agent: the SPAR workflow (phase pages, loop)
 *  only while a spec-driven agent is selected. */
function applyMode() {
  const workflow = !!agentOf().runsSpar;
  const ws = useWorkspace.getState();
  if (workflow) {
    const tabs = ws.tabs.some((t) => t.kind === "phase") ? ws.tabs : [{ kind: "phase" } as const, ...ws.tabs];
    ws.set({ workflowMode: true, tabs });
  } else {
    let tabs = ws.tabs.filter((t) => t.kind !== "phase");
    if (!tabs.some((t) => t.kind === "welcome")) tabs = [{ kind: "welcome" }, ...tabs];
    ws.set({
      workflowMode: false, tabs,
      activeTab: ws.activeTab.kind === "phase" ? { kind: "welcome" } : ws.activeTab,
      sidebarMode: ws.sidebarMode === "work" ? "files" : ws.sidebarMode,
    });
  }
}

// ---- Session ---------------------------------------------------------------------------
// The chat each project and agent is on (UserDefaults in the Mac app). Kept in preferences and
// in a file in the app's data folder, so a window with empty storage resumes the same chat
// instead of starting another agent process.

/** Marks "start a fresh chat next time" (New Chat). */
const NEW_CHAT = "new";
let sessionFile: Promise<string> | null = null;
const sessionsPath = () => (sessionFile ??= appApi.info().then((i) => joinPath(i.data_dir, "chat-sessions.json")));

async function readSessions(): Promise<Record<string, string>> {
  try { return JSON.parse(await fs.readText(await sessionsPath())) ?? {}; } catch { return {}; }
}

async function savedSession(key: string): Promise<string | null> {
  return prefs.get<string | null>(key, null) ?? (await readSessions())[key] ?? null;
}

async function rememberSession(key: string, id: string | null) {
  prefs.set(key, id);
  const all = await readSessions();
  if (id) all[key] = id; else delete all[key];
  await fs.writeText(await sessionsPath(), JSON.stringify(all, null, 1)).catch(() => {});
}

/** The most recently used session of this agent in this folder, if the engine has one. */
async function latestSession(agentId: string, root: string): Promise<string | null> {
  const roots = new Set([root, root.startsWith("/private/") ? root.slice(8) : "/private" + root]);
  let best: { id: string; at: number } | null = null;
  let after = "";
  for (let page = 0; page < 10; page++) {
    const r = await call<{ status: number; body: any }>("engine_http", { method: "GET", path: `/v1/sessions?limit=100${after ? `&after=${after}` : ""}` }).catch(() => null);
    const data: any[] = r?.body?.data ?? [];
    for (const x of data) {
      if (x.agent_id !== agentId || !roots.has(x.workspace) || x.status === "failed") continue;
      const at = x.updated_at ?? x.created_at ?? 0;
      if (!best || at > best.at) best = { id: x.id, at };
    }
    if (!r?.body?.has_more || !r.body.last_id) break;
    after = r.body.last_id;
  }
  return best?.id ?? null;
}


async function attachSession() {
  const gen = generation;
  const kind = agentOf();
  if (kind.family === "bob") {
    // IBM Bob runs straight from its CLI; there is no engine session.
    bob = new BobRunner(S().root, kind.name);
    const has = await exec.which("bob").catch(() => null);
    set({ sessionId: "bob", status: "idle", connectionError: has ? null : "The bob CLI is not installed" });
    postStepToChat();
    runDevActions();
    return;
  }
  try {
    const { hostId } = await engineReady();
    if (gen !== generation) return;
    const agentId = useEngine.getState().agentIds[engineAgentName(kind)]?.id;
    if (!agentId) {
      if (kind.runsSpar) throw new Error(`Spec-driven ${kind.title} didn't start (the SPAR agent isn't registered; details in the engine's server.log). Switch to Vibe to keep working.`);
      throw new Error(`${kind.title} is not available on this server`);
    }
    let snapshot: any = null;
    const key = sessionKey();
    const saved = await savedSession(key);
    // Whether a saved session runs on the agent this chat is for.
    const belongs = (snap: any) => {
      const name: string = snap?.agent_name ?? "";
      if (!name) return !snap?.agent_id || snap.agent_id === agentId;
      if (name === engineAgentName(kind) || name === kind.name) return true;
      // Vibe Claude moved from the stock agent to SPAR's own bundle; both are Claude Code.
      return kind.family === "claude" && !kind.runsSpar && ["claude-native-ui", CLAUDE_VIBE_AGENT].includes(name);
    };
    if (saved && saved !== NEW_CHAT) {
      snapshot = await client.session(saved).catch(() => null);
      // Saved by an older build that shared one chat between agents.
      if (snapshot && !belongs(snapshot)) snapshot = null;
      else if (!snapshot) tx((t) => t.note("Your earlier chat for this project isn't in the engine any more, so this is a new one. Your files and SPAR's specs are unchanged."));
    }
    // Nothing remembered (a fresh profile, another window): carry on with this project's latest
    // chat with this agent rather than starting another agent process.
    if (!snapshot && saved !== NEW_CHAT) {
      const latest = await latestSession(agentId, S().root);
      if (latest) snapshot = await client.session(latest).catch(() => null);
    }
    if (!snapshot) snapshot = await client.createSession(agentId, hostId, S().root, currentLaunchArgs());
    if (gen !== generation || agentOf().name !== kind.name) return;
    const id: string | undefined = snapshot?.id;
    if (!id) throw new Error("The engine did not start a session.");
    // Keep the session's model and effort in step with the composer.
    const p = S().prefs;
    const sync: Record<string, unknown> = {};
    if ((snapshot.model_override ?? null) !== p.model) sync.model_override = p.model ?? "default";
    if ((snapshot.reasoning_effort ?? null) !== p.effort) sync.reasoning_effort = p.effort ?? "default";
    const args = currentLaunchArgs();
    if (kind.family === "claude" && JSON.stringify(snapshot.terminal_launch_args ?? null) !== JSON.stringify(args)) sync.terminal_launch_args = args;
    if (Object.keys(sync).length) await client.patchSession(id, sync).catch(() => {});
    modelJustReset = sync.model_override !== undefined;
    rememberSession(sessionKey(), id);
    set({ sessionId: id, connectionError: null, answered: prefs.get<string[]>(`answered:${id}`, []) });
    startStream(id);
    if (pendingSparText && kind.runsSpar) {
      const text = pendingSparText;
      pendingSparText = null;
      send(text);
    }
    runDevActions();
  } catch (e) {
    if (gen !== generation) return;
    set({ connectionError: e instanceof Error ? e.message : String(e), status: "offline" });
  }
}

const QUIET_EVENTS = new Set(["session.heartbeat", "session.presence", "session.changed_files.invalidated", "session.usage"]);

function startStream(id: string) {
  const gen = generation;
  const connect = () => {
    if (gen !== generation) return;
    // Subscribe first, then read the snapshot, so nothing falls in between.
    closeStream = client.stream(id, (ev) => {
      lastEventAt = Date.now();
      // Keepalives and viewer presence are not the agent doing anything.
      if (!QUIET_EVENTS.has(ev?.type)) { lastActivityAt = Date.now(); stallShown = false; }
      handle(ev);
    }, () => {
      closeStream = null;
      if (gen === generation) setTimeout(connect, 1500);
    });
    client.session(id).then((snap) => { if (snap && gen === generation) apply(snap); }).catch(() => {});
  };
  connect();
  // A stream can go quiet without failing; while the agent works, re-read the snapshot every
  // few seconds so the chat never freezes (items are deduplicated).
  clearInterval(watchdog);
  watchdog = setInterval(async () => {
    if (gen !== generation) return;
    if ((S().status !== "idle" || transcript.waitingOnBackground) && Date.now() - lastEventAt > 12_000) {
      const snap = await client.session(id).catch(() => null);
      if (snap && gen === generation) {
        const before = transcript.entries.length;
        apply(snap, true);
        if (transcript.entries.length !== before) lastActivityAt = Date.now();
      }
    }
    // Working with nothing new for five minutes: say so and offer a way out.
    if (S().status === "running" && !transcript.pendingApprovals.length && Date.now() - lastActivityAt > 300_000 && !stallShown) {
      stallShown = true;
      const mins = Math.floor((Date.now() - lastActivityAt) / 60_000);
      tx((t) => t.step({
        action: "stalled", title: `No progress for ${mins} minutes`,
        reason: `${agentOf().title} is still marked as working but hasn't done anything new. It may be stuck on a long request.`,
        stage: useSpar.getState().next?.stage ?? "brief", gate: null, command: null,
      }));
    }
  }, 8000);
  refreshChanges();
}

function apply(snapshot: any, fromWatchdog = false) {
  for (const item of snapshot.items ?? []) transcript.ingest(item);
  for (const e of snapshot.pending_elicitations ?? []) ingestElicitation(e);
  const patch: Partial<ChatStore> = {};
  if (typeof snapshot.status === "string") {
    const was = S().status;
    patch.status = snapshot.status;
    if (snapshot.status === "idle") transcript.settleTools();
    set({ ...patch, entries: transcript.entries.slice() });
    // The stream missed the end of a turn: finish it now.
    if (fromWatchdog && snapshot.status === "idle" && was !== "idle") turnEnded();
  }
  if (S().status === "failed" && snapshot.last_task_error?.message) reportError(snapshot.last_task_error.message);
  const extra: Partial<ChatStore> = { entries: transcript.entries.slice() };
  if (typeof snapshot.total_cost_usd === "number") extra.cost = snapshot.total_cost_usd;
  // llm_model is the last model used, which is stale right after an override is cleared.
  if (typeof snapshot.llm_model === "string" && !modelJustReset) extra.sessionModel = snapshot.llm_model;
  set(extra);
  postStepToChat();
}

function ingestElicitation(e: any) {
  const id = e.elicitation_id ?? e.id;
  if (typeof id !== "string") return;
  const params = e.params ?? e;
  const raw: string | null = typeof params.content_preview === "string" ? params.content_preview : null;
  const preview = readablePreview(raw);
  transcript.approval(id, readableRequest(params.message ?? null, raw), preview, params.target_session_id ?? null);
  set({ entries: transcript.entries.slice() });
  // SPAR's own read-only bookkeeping, "Allow all" for this chat, or the agent's "Allow all
  // commands" mode: answer it now and keep the chat free of it.
  if (Transcript.isSafeBookkeeping(preview ?? "") || S().allowAllInChat || autoApproves(agentOf(), S().prefs.mode)) {
    const entry = transcript.entries.find((x) => x.id === id);
    if (entry) {
      answer(entry, true);
      tx((t) => t.remove(id));
    }
    return;
  }
  attention();
}

/** Pulls `"key": "value"` out of a tool preview, even one the engine cut short. */
function field(key: string, raw: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(raw);
  if (!m) return null;
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
}

/** "Copilot wants to use shell" → "Copilot wants to run a command". */
function readableRequest(message: string | null, preview: string | null): string {
  const m = message ?? "The agent wants to continue";
  const intent = preview ? field("intention", preview) ?? field("description", preview) : null;
  if (intent) return m.replace("use **shell**", "run a command").replace("use shell", "run a command") + " — " + intent;
  return m;
}

/** "Bash({"command": "mkdir x", ...})" → "mkdir x"; file tools show the path. */
function readablePreview(raw: string | null): string | null {
  if (raw == null) return null;
  const open = raw.indexOf("(");
  if (open >= 0 && raw.endsWith(")")) {
    try {
      const args = JSON.parse(raw.slice(open + 1, -1));
      if (args && typeof args === "object") {
        const cmd = args.fullCommandText ?? args.command;
        if (typeof cmd === "string") return cmd;
        const path = args.file_path ?? args.path;
        if (typeof path === "string") return path;
      }
    } catch { /* truncated */ }
  }
  for (const key of ["fullCommandText", "command", "file_path", "path", "url"]) {
    const v = field(key, raw);
    if (v != null) return v;
  }
  return raw;
}

/** Agent failures in plain words; sign-in problems get a next step. */
function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  const title = agentOf().title;
  if (lower.includes("authentication") || lower.includes("not logged in") || lower.includes("login"))
    return `${title} needs you to sign in first. Run its CLI once in Terminal, sign in, then send your message again.`;
  if (["usage limit", "session limit", "rate limit", "hit your limit", "quota"].some((k) => lower.includes(k))) {
    const m = raw.match(/resets?[^.·\n]*/i);
    const reset = m ? ` (${m[0].trim()})` : "";
    return `${title} has reached its usage limit${reset}. Wait for it to reset, or switch to another agent from the agent menu; your specs and tasks carry over.`;
  }
  return `${title} stopped: ${(raw.split("\n")[0] ?? raw).slice(0, 240)}`;
}

/** Notes an agent failure. A model the agent rejects is cleared, so the next message doesn't
 *  fail the same way. */
function reportError(raw: string) {
  const lower = raw.toLowerCase();
  const badModel = ["selected model", "model is not", "not have access to", "unknown model", "model not found"].some((k) => lower.includes(k));
  const model = S().prefs.model;
  if (badModel && model) {
    setModel(null);
    tx((t) => t.note(`${agentOf().title} can't use ${model}, so it's back on its default model. Send your message again.`));
    return;
  }
  tx((t) => t.note(friendlyError(raw)));
}

function handle(ev: any) {
  switch (ev?.type) {
    case "response.output_text.delta":
      tx((t) => t.delta(ev.message_id ?? "", ev.delta ?? ""));
      break;
    case "response.output_item.done":
      if (ev.item) tx((t) => t.ingest(ev.item));
      break;
    case "session.input.consumed": {
      const d = ev.data;
      if (d?.data && typeof d.item_id === "string") {
        tx((t) => t.ingest({ ...d.data, id: d.item_id, type: d.type ?? "message" }));
        settleIfIdle();
      }
      break;
    }
    case "session.status": {
      if (ev.status === "running") { modelJustReset = false; sawRunningSinceSend = true; }
      if (ev.status === "failed") {
        const err = typeof ev.error === "string" ? ev.error : ev.error?.message;
        if (err) reportError(err);
      }
      const was = S().status;
      let status: string = ev.status ?? was;
      // An "idle" that arrives before the new turn even started is stale: keep waiting.
      if (status === "idle" && !sawRunningSinceSend && Date.now() - lastSendAt < 20_000) status = "running";
      set({ status, blockedOn: ev.blocked_on ?? null });
      if (status === "idle" && was !== "idle") turnEnded();
      break;
    }
    case "response.elicitation_request":
      ingestElicitation(ev);
      break;
    case "response.elicitation_resolved":
      if (typeof ev.elicitation_id === "string") tx((t) => t.resolveApproval(ev.elicitation_id, ev.action === "accept"));
      break;
    case "session.usage": {
      if (typeof ev.total_cost_usd === "number" && ev.total_cost_usd > 0) set({ cost: ev.total_cost_usd });
      const byModel = ev.usage_by_model;
      if (byModel && typeof byModel === "object" && (!modelJustReset || isRunning())) {
        const top = Object.entries(byModel).sort((a: any, b: any) => (a[1]?.total_cost_usd ?? 0) - (b[1]?.total_cost_usd ?? 0)).pop();
        if (top) set({ sessionModel: top[0] });
      }
      break;
    }
    case "session.changed_files.invalidated":
      refreshChanges();
      break;
    case "session.resource.created": {
      const r = ev.resource;
      if (r?.type === "terminal" && typeof r.metadata?.tmux_socket === "string") set({ terminal: { socket: r.metadata.tmux_socket, target: r.metadata.tmux_target ?? "main" } });
      break;
    }
    case "response.error": case "response.failed":
      reportError(ev.error?.message ?? "The agent hit an error.");
      break;
  }
}

/** The agent can resume on its own (a background agent reported back) without the session
 *  ever leaving "idle". When items arrive while idle, a quiet moment ends the turn. */
function settleIfIdle() {
  if (S().status !== "idle") return;
  clearTimeout(settleTimer);
  const gen = generation;
  settleTimer = setTimeout(() => { if (gen === generation && S().status === "idle") turnEnded(); }, 6000);
}

/** The cost the engine measured for the work since the last record, written to
 *  spar/impact/events.jsonl so the impact report counts it once. */
async function recordImpactUsage() {
  const sid = S().sessionId ?? "";
  const base = impactBase, start = impactStart;
  if (!base || start == null) return;
  if (!base.session) base.session = sid;
  if (base.session !== sid) { impactBase = null; impactStart = null; return; }
  const cost = S().cost;
  const delta = cost - base.cost;
  impactBase = { session: sid, cost };
  impactStart = null;
  const root = S().root;
  if (!(delta > 0.000001) || !(await fs.exists(joinPath(root, "spar")).catch(() => false))) return;
  const a = agentOf();
  runSpar(root, ["impact", "usage", "--cost-usd", delta.toFixed(6), "--start", new Date(start).toISOString().replace(/\.\d{3}Z$/, "Z"),
    "--agent", a.name, "--model", S().sessionModel ?? "", "--family", a.family, "--session", sid]).catch(() => {});
}

function turnEnded() {
  tx((t) => t.settleTools());
  refreshChanges();
  recordImpactUsage();
  if (turnCheckpoint && checkpointStore) {
    const sha = turnCheckpoint;
    turnCheckpoint = null;
    set({ lastTurnStart: sha });
    checkpointStore.changedFiles(sha).then((files) => set({ lastTurnChanges: files })).catch(() => {});
  }
  inlineEditTurnEnded();
  // Send the next queued instruction, if any.
  const q = S().queue;
  if (q.length) {
    const [item, ...rest] = q;
    set({ queue: rest });
    setTimeout(() => send(item.text), 400);
  }
  (async () => {
    await refreshSpar();
    const n = useSpar.getState().next;
    if (n?.action === "gate" || n?.action === "done") attention();
    autoContinueIfAutomatic();
  })();
}

/** Steps that need no person (run, check, fix) carry on by themselves when the agent's turn
 *  ends; only gates, choices, a missing brief, blocked and done stop. Capped so a step that
 *  keeps failing can't loop. */
function autoContinueIfAutomatic() {
  const a = agentOf();
  const n = useSpar.getState().next;
  if (!a.runsSpar || stoppedByUser || S().queue.length || isRunning() || !S().sessionId || transcript.pendingApprovals.length || transcript.waitingOnBackground
    || !prefs.get<boolean>("continueAfterApproval", true) || !n || !["run", "check", "fix"].includes(n.action)) return;
  // Waiting on the person's answers: never answer for them.
  if (n.command === "clarify" || transcript.lastReplyAsks) return;
  // A turn that ticked tasks made progress: the cap counts turns that didn't.
  const progressed = tasksDone() > turnStartDone;
  if (progressed) autoSteps = 0;
  // Other agents run a whole phase in one turn, except a build, which goes a few tasks per turn
  // and carries on while tasks keep getting ticked.
  if (a.family !== "claude" && !(n.command === "build" && progressed)) return;
  if (autoSteps >= 4) return;
  // The last automatic continue changed nothing: stop rather than spend tokens repeating it.
  const signature = `${n.phase ?? ""}|${n.action}|${n.command ?? ""}|${n.feature ?? ""}|${n.reason}`;
  if (signature === lastAutoSignature) return;
  lastAutoSignature = signature;
  autoSteps++;
  const gen = generation;
  setTimeout(async () => {
    const sid = S().sessionId;
    if (gen !== generation || isRunning() || !sid) return;
    // Only when the engine agrees the agent has really stopped (not waiting on an approval).
    const snap = await client.session(sid).catch(() => null);
    if (!snap || snap.status !== "idle" || (snap.pending_elicitations ?? []).length || snap.blocked_on != null) return;
    continueWork();
  }, 1500);
}

/** The SPAR workflow as one conversation: announce stage changes and put the next step
 *  (Continue, or a gate to approve) into the chat. */
function postStepToChat() {
  const sp = useSpar.getState();
  const next = sp.next;
  if (!next || !agentOf().runsSpar || isRunning() || sp.draftingNewFeature || !S().sessionId || transcript.waitingOnBackground
    || !(sawRunningSinceSend || Date.now() - lastSendAt > 20_000)) return;
  const stage = next.action === "done" ? "done" : next.stage;
  if (lastStage != null && lastStage !== stage && lastStage !== "" && stepFeature === sp.feature) transcript.milestone(lastStage, stage);
  lastStage = stage;
  stepFeature = sp.feature;
  if (stage === "build" && uiFirst() && previewAvailable() && uiFirstRequested() && !sp.uiApproved) {
    // UI first: the mock-data UI is ready to look at before integration.
    tx((t) => t.step({ action: "ui-review", title: "Review the UI (mock data)",
      reason: "The interface runs with mock data in the live preview. Approve it to integrate real data and services, or ask for changes.",
      stage: "build", gate: null, command: null }));
    if (previewIsServer() && usePreview.getState().state === "idle") preview.start?.();
    useWorkspace.getState().open({ kind: "preview" });
    return;
  }
  // Questions asked as a form carry their own buttons; no extra card.
  if (transcript.lastReplyHasForm) { set({ entries: transcript.entries.slice() }); return; }
  if (next.action === "run" && (next.command === "clarify" || transcript.lastReplyAsks)) {
    // The agent asked its questions in the reply above; answer them in the chat.
    tx((t) => t.step({ action: "answer", title: "Answer the questions above",
      reason: "Reply in the chat (for example “1: email and password, 2: 30 days”), or take every recommendation at once.",
      stage, gate: null, command: next.command ?? null }));
    return;
  }
  tx((t) => t.step({ action: next.action, title: Spar.actionTitle(next), reason: next.reason, stage, gate: next.gate ?? null, command: next.command ?? null }));
}
onSparRefreshed(postStepToChat);

/** Development aids that drive real flows at launch: SPAR_SEND=<message>, SPAR_ATTACH=<files>. */
async function runDevActions() {
  if (devActionsRan) return;
  devActionsRan = true;
  const env = (await appApi.info().catch(() => null))?.env ?? {};
  const k = `spar:devsend:${S().root}`;
  if (sessionStorage.getItem(k)) return;
  if (env.SPAR_ATTACH) attachFiles(env.SPAR_ATTACH.split(","));
  if (env.SPAR_SEND) {
    sessionStorage.setItem(k, "1");
    set({ draft: env.SPAR_SEND.replace(/\\n/g, "\n") });
    submit();
  }
  // SPAR_INLINE=<relative path>:<first>-<last>:<instruction> runs a ⌘K edit.
  if (env.SPAR_INLINE) {
    sessionStorage.setItem(k, "1");
    const [rel, range, instruction] = [env.SPAR_INLINE.split(":")[0], env.SPAR_INLINE.split(":")[1], env.SPAR_INLINE.split(":").slice(2).join(":")];
    const [a, b] = (range ?? "").split("-").map(Number);
    if (rel && a && b && instruction) {
      const path = joinPath(S().root, rel);
      const text = await fs.readText(path).catch(() => "");
      const sel = text.split("\n").slice(a - 1, b).join("\n");
      useWorkspace.getState().openFile(path);
      startInlineEdit(path, text, a, b, sel, instruction);
    }
  }
}

// ---- Changes ---------------------------------------------------------------------------

export function refreshChanges() {
  clearTimeout(changesTimer);
  changesTimer = setTimeout(async () => {
    const root = S().root;
    if (!root) return;
    let list: Change[] | null = null;
    const r = await exec.run("git", ["status", "--porcelain", "-uall"], { cwd: root }).catch(() => null);
    if (r?.ok) {
      list = r.stdout.split("\n").filter((l) => l.length > 3).map((l) => {
        const code = l.slice(0, 2);
        const path = l.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, "");
        return { path, status: code.includes("?") || code.includes("A") ? "created" : code.includes("D") ? "deleted" : "modified" };
      });
    } else if (S().sessionId && S().sessionId !== "bob") {
      list = await client.changes(S().sessionId!).catch(() => null);
    }
    if (root !== S().root || !list) return;
    set({ changes: list });
    useWorkspace.getState().set({ changeCount: list.length });
  }, 350);
}

// ---- Sending ---------------------------------------------------------------------------

/** "Drafting the engineering principles…" for a workflow command the app sends. */
function workflowStatus(command: string): string {
  const name = command.slice("/spar.".length).split(" ")[0];
  const n = useSpar.getState().next;
  if (n && (n.phase === name || command.startsWith(n.phase_command ?? "~"))) return Spar.actionTitle(n) + "…";
  return ({
    init: "Setting the project up…", explore: "Working on the spec…", design: "Designing…", build: "Building…", deliver: "Verifying…",
    adopt: "Mapping the codebase…", fix: "Fixing the bug…", reconcile: "Lining the specs up with the code…", sync: "Updating the specs…",
  } as Record<string, string>)[name] ?? "Working…";
}

/** Agents other than Claude Code have no `/spar.*` slash commands: turn one into a plain
 *  request that points at the same playbook. */
function portable(text: string): string {
  const a = agentOf();
  if (!a.runsSpar || a.family === "claude" || !text.startsWith("/spar.")) return text;
  const rest = text.slice("/spar.".length);
  const command = rest.split(" ")[0];
  const args = rest.slice(command.length).trim();
  // A turn has a time limit (an hour for Copilot), and a whole phase in one turn runs into it.
  const chunk = command === "build"
    ? " Build at most three tasks in this turn, ticking each in tasks.md the moment it passes, then stop and say which task is next; the app starts the next turn."
    : "";
  return `Run SPAR's \`${command}\` command${args ? ` with: ${args}` : ""}. Follow ~/.claude/commands/spar.${command}.md and the loop in ~/.claude/spar-steps/phase-loop.md (each step is ~/.claude/spar-steps/<step>.md; do any spar-* agent's part yourself from ~/.claude/agents/<agent>.md).` + chunk;
}

/** Sends to the current agent. SPAR commands need spec-driven mode, switching to it first. */
/** A `quiet` request shows only that status line in the chat, not the request itself. */
export function send(text: string, display: string | null = null, quiet: string | null = null) {
  const original = text;
  if (text.includes("/spar.") && !agentOf().runsSpar) {
    pendingSparText = text;
    setSpecDriven(true);
    return;
  }
  const sessionId = S().sessionId;
  if (!sessionId) return;
  const gen = generation;
  const body = portable(text);
  const attachments = outgoingAttachments;
  outgoingAttachments = [];
  set({ status: "running" });
  stoppedByUser = false;
  turnStartDone = tasksDone();
  lastActivityAt = lastSendAt = Date.now();
  stallShown = false;
  sawRunningSinceSend = false;
  if (impactStart == null) impactStart = lastSendAt;
  // A new session starts at zero; a resumed one has already spent what it shows.
  if (impactBase?.session !== sessionId) impactBase = { session: sessionId, cost: S().cost };
  (async () => {
    const wire = await singleLine(body, attachments, S().root);
    if (gen !== generation) return;
    let entry: string;
    if (original.startsWith("/spar.")) {
      // Workflow steps never appear as something the person said. What they typed (a brief,
      // feedback) does; otherwise a short status line says what's happening.
      transcript.echoHidden(wire, display == null ? workflowStatus(original) : null);
      if (display != null) { entry = transcript.echoUser(display); transcript.forgetEcho(display); }
      else entry = `hidden-${Date.now()}`;
    } else if (quiet ?? display) {
      // For a message that isn't a workflow command, `display` is the status line shown
      // instead of the request (the tracker's "Creating the Jira issues…").
      transcript.echoHidden(wire, quiet ?? display);
      entry = `hidden-${Date.now()}`;
    } else {
      const shown = attachments.length ? body + "\n📎 " + attachments.map(basename).join(", ") : body;
      entry = transcript.echoUser(shown);
      if (wire !== shown) transcript.echoHidden(wire, null);
    }
    set({ entries: transcript.entries.slice() });
    if (agentOf().family === "bob") { sendToBob(wire, entry); return; }
    // Snapshot the files first so this turn can be rolled back.
    const sha = await checkpointStore?.create(body.slice(0, 120)).catch(() => null);
    if (sha) {
      set({ checkpoints: { ...S().checkpoints, [entry]: sha } });
      if (!turnCheckpoint) turnCheckpoint = sha;
    }
    if (gen !== generation) return;
    try { await client.send(sessionId, wire); } catch (e) {
      tx((t) => t.note(`Could not send: ${e instanceof Error ? e.message : String(e)}`));
      // Nothing started: free the chat instead of waiting on a turn that never began.
      if (S().status === "running" && !sawRunningSinceSend) set({ status: "idle" });
    }
  })();
}

/** One `bob run` per message; events stream into the transcript. */
async function sendToBob(prompt: string, entry: string) {
  if (!bob) return;
  const runner = bob;
  const full = agentOf().runsSpar && !runner.taskId ? PORTABLE_SPAR_PROMPT + "\n\n" + prompt : prompt;
  const sha = await checkpointStore?.create(prompt.slice(0, 120)).catch(() => null);
  if (sha) { set({ checkpoints: { ...S().checkpoints, [entry]: sha } }); if (!turnCheckpoint) turnCheckpoint = sha; }
  runner.run(full, (ev) => {
    switch (ev?.type) {
      case "message":
        if (ev.role === "assistant" && typeof ev.content === "string" && ev.content) tx((t) => t.assistant(ev.content));
        break;
      case "tool_call":
        tx((t) => t.tool(ev.name ?? "tool", typeof ev.input === "string" ? ev.input : ""));
        break;
      case "result":
        if (typeof ev.stats?.session_costs === "number") set({ cost: S().cost + ev.stats.session_costs });
        if (ev.status && ev.status !== "success") tx((t) => t.note(`IBM Bob ended: ${ev.status}`));
        set({ status: "idle" });
        turnEnded();
        break;
    }
  }, (code, err) => {
    if (code !== 0 && S().status === "running") {
      const first = err.split("\n")[0] || `exit code ${code}`;
      tx((t) => t.note(`IBM Bob stopped: ${first}` + (first.toLowerCase().includes("key") ? " Add your Bob API key from the agent menu." : "")));
    }
    if (S().status !== "idle") { set({ status: "idle" }); turnEnded(); }
  });
}

/** Interrupts the turn; when the agent is still working a few seconds later (a dialog in its
 *  terminal swallows the interrupt) the session is stopped. The conversation carries on with
 *  the next message. */
async function forceStop(sid: string) {
  const working = async () => {
    const st = (await client.session(sid).catch(() => null))?.status;
    return st === "running" || st === "waiting";
  };
  await client.interrupt(sid).catch(() => {});
  for (let i = 0; i < 4; i++) {
    await sleep(1500);
    if (!(await working())) return;
  }
  await client.stopSession(sid).catch(() => {});
  await sleep(1500);
}

export function stop() {
  if (agentOf().family === "bob") { bob?.stop(); return; }
  const sid = S().sessionId;
  if (!sid) return;
  stoppedByUser = true;
  set({ queue: [] });
  tx((t) => t.resolveSteps());
  (async () => {
    await forceStop(sid);
    set({ status: "idle", blockedOn: null });
    stallShown = false;
    tx((t) => { t.settleTools(); t.note(`Stopped. Send a message when you want ${agentOf().title} to carry on.`); });
    await refreshSpar();
  })();
}

export function answer(entry: Entry, allow: boolean) {
  if (entry.kind.type !== "approval") return;
  const sid = entry.kind.sessionId ?? S().sessionId;
  if (!sid) return;
  tx((t) => t.resolveApproval(entry.id, allow));
  client.resolve(sid, entry.id, allow).catch((e) => tx((t) => t.note(`Approval failed: ${e instanceof Error ? e.message : String(e)}`)));
}

/** Approve every request for the rest of this chat. */
export function allowAll(entry: Entry) {
  set({ allowAllInChat: true });
  answer(entry, true);
  for (const p of transcript.pendingApprovals) answer(p, true);
  tx((t) => t.note("Allowing every command for the rest of this chat. Start a new chat to be asked again."));
}

/** The agent stopped responding: stop the session (forcefully if an interrupt doesn't take)
 *  and pick up the same step again. */
export function stopAndRetry() {
  const sid = S().sessionId;
  if (!sid) return;
  tx((t) => { t.resolveSteps(); t.note(`Stopping ${agentOf().title} and trying the step again…`); });
  (async () => {
    await forceStop(sid);
    set({ status: "idle" });
    stallShown = false;
    lastActivityAt = Date.now();
    await refreshSpar();
    if (agentOf().runsSpar) continueWork();
  })();
}

export function keepWaiting() {
  tx((t) => t.resolveSteps());
  lastActivityAt = Date.now();
  stallShown = false;
}

// ---- The SPAR workflow -----------------------------------------------------------------

/** Extra instruction for the first build turn of a feature with a UI. */
function uiFirstContext(): string | null {
  const sp = useSpar.getState();
  if (!uiFirst() || !previewAvailable() || sp.uiApproved || sp.next?.stage !== "build") return null;
  return "UI first: build only the user interface for this feature, with realistic mock data (no real backend, API or persistence yet). Make it run in the live preview, then stop so I can review the UI before you integrate it.";
}

/** The single primary action: let SPAR advance the feature to its next human gate. */
export function continueWork(context = "") {
  const { next, feature } = useSpar.getState();
  // `spar next` names the phase command that owns the next step.
  let command = next?.phase_command ?? "/spar.explore";
  const perFeature = ["explore", "design", "build", "deliver", "reconcile", "sync"].includes(next?.phase ?? "explore");
  if (feature && perFeature && next?.action !== "prompt") command += ` ${feature}`;
  let extra = context.trim();
  if (!extra) {
    const ui = uiFirstContext();
    if (ui) { extra = ui; setUIFirstRequested(true); }
  }
  if (extra) command += ` ${extra}`;
  send(command, context ? context : null);
}

export async function startFeature(brief: string) {
  const text = brief.trim();
  if (!text) return;
  useSpar.setState({ draftingNewFeature: false, followAgent: true, feature: null });
  const { features, next, root } = { ...useSpar.getState(), root: S().root };
  if (!features.length) {
    // A new project: keep the brief in spar/briefs/pending.md. SPAR drafts the engineering
    // principles, stops once for their review, then turns this brief into the roadmap and spec.
    const briefs = joinPath(await Spar.dir(root), "briefs");
    await fs.mkdir(briefs).catch(() => {});
    await fs.writeText(joinPath(briefs, "pending.md"), text + "\n").catch(() => {});
    autoSteps = 0;
    send((next?.command === "adopt" ? "/spar.adopt " : "/spar.init ") + text, text);
  } else {
    send(`/spar.explore ${text}`, text);
  }
}

/** Which MVP to build first is the person's call: record it in the ledger, then carry on. */
export async function choose(option: SparOption) {
  autoSteps = 0;
  const r = await Spar.mvpSelect(S().root, option.id).catch((e) => ({ ok: false, stdout: "", stderr: String(e) }));
  await refreshSpar();
  if (r.ok) {
    tx((t) => t.note(`You chose ${option.label}.`));
    continueWork();
  } else {
    tx((t) => t.note(`Couldn't record the choice: ${(r.stderr || r.stdout).trim()}`));
  }
}

/** A gate decision, recorded as the person's (the app's own call with the human token). */
export async function decide(gate: string, approve: boolean, note: string): Promise<string | null> {
  const { feature, next } = useSpar.getState();
  const f = feature ?? "";
  const projectGate = gate === TENETS_GATE || gate === FIX_GATE;
  if (!f && !projectGate) return "No feature selected";
  autoSteps = 0;
  // A fix is decided by its id (the step's scope); the engineering principles by the gate alone.
  const target = gate === FIX_GATE ? next?.scope ?? "" : "";
  const out = await Spar.decide(S().root, projectGate ? "" : f, gate, approve, note, target).catch((e) => ({ ok: false, stdout: "", stderr: String(e) }));
  await refreshSpar();
  if (out.ok) {
    tx((t) => t.note(approve ? `You approved ${gate.replace(/-/g, " ")}.` : `You requested changes: ${note}`));
    // Approved tasks go to Jira first when it's set up; the build carries on when that turn ends.
    const { tracker } = await import("../features/insights");
    if (tracker.afterApproval(gate, approve)) return null;
    // Approving moves straight on to the next step.
    const n = useSpar.getState().next;
    if (approve && prefs.get<boolean>("continueAfterApproval", true) && n && ["run", "check", "fix"].includes(n.action)) continueWork();
    return null;
  }
  return (out.stderr || out.stdout).trim();
}

/** Iterating on a phase: feed the person's words to the command that owns it. */
export function revise(p: Lifecycle, feedback: string) {
  const text = feedback.trim();
  const f = useSpar.getState().feature;
  if (!f || !text) return;
  send(`/spar.${PHASE[p].reviseCommand} ${f} ${text}`, text);
}

export async function approveUI() {
  const f = useSpar.getState().feature;
  if (!f) return;
  const out = await Spar.approveUI(S().root, f).catch((e) => ({ ok: false, stderr: String(e), stdout: "" }));
  if (!out.ok) tx((t) => t.note(`Could not record the UI approval: ${out.stderr.slice(0, 200)}`));
  tx((t) => t.note("You approved the UI."));
  await refreshSpar();
  continueWork("The UI with mock data is approved. Now integrate it with the real data, services and persistence, keeping the UI as approved.");
}

export function requestUIChanges(note: string) {
  send(`Change the UI (still with mock data, no integration yet): ${note}`);
}

// ---- Composer --------------------------------------------------------------------------

export function focusComposer() {
  useWorkspace.getState().set({ showAgent: true });
  set({ focusToken: S().focusToken + 1 });
}

export function attach(chip: ContextChip) {
  if (!S().chips.some((c) => chipId(c) === chipId(chip))) set({ chips: [...S().chips, chip] });
  focusComposer();
}

export function removeChip(chip: ContextChip) {
  set({ chips: S().chips.filter((c) => chipId(c) !== chipId(chip)) });
}

export function beginRefine(phase: Lifecycle) {
  set({ chips: [{ kind: "refine", phase }, ...S().chips.filter((c) => c.kind !== "refine")] });
  focusComposer();
}

/** Project files as references, anything else (and images) as attachments. */
export function attachFiles(paths: string[]) {
  const root = S().root;
  for (const p of paths.map((x) => x.trim()).filter(Boolean)) {
    const chip: ContextChip = { kind: "attachment", path: p };
    if (p.startsWith(root + "/") && !chipIsImage(chip)) attach({ kind: "file", path: relativePath(root, p) });
    else attach(chip);
  }
}

/** Saves a pasted or dropped image and attaches it. */
export async function attachImage(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const dir = joinPath((await appApi.info()).data_dir, "attachments");
  await fs.mkdir(dir).catch(() => {});
  const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const path = joinPath(dir, `image-${Date.now()}.${ext}`);
  await fs.writeBase64(path, btoa(bin));
  attach({ kind: "attachment", path });
}

export const setDraft = (draft: string) => set({ draft });

/** The first thing typed into a project SPAR hasn't set up yet is what to build. */
async function isNewProjectBrief(): Promise<boolean> {
  const { features, next } = useSpar.getState();
  if (!agentOf().runsSpar || features.length || !next) return false;
  if (next.action === "prompt") return true;
  return next.action === "run" && ["tenets", "adopt"].includes(next.command ?? "")
    && !(await fs.exists(joinPath(await Spar.dir(S().root), "briefs/pending.md")).catch(() => false));
}

/** The one entry point for everything typed into the composer. */
export async function submit() {
  const typed = S().draft.trim();
  if (!typed) return;
  rememberPrompt(typed);
  if (isRunning()) {
    set({ queue: [...S().queue, { id: `q-${Date.now()}`, text: typed }], draft: "" });
    return;
  }
  set({ draft: "" });
  autoSteps = 0;
  const chips = S().chips;
  if (!chips.length && agentOf().runsSpar && handleWorkflowShortcut(typed)) return;
  outgoingAttachments = chips.filter((c): c is { kind: "attachment"; path: string } => c.kind === "attachment").map((c) => c.path);
  const refine = chips.find((c): c is { kind: "refine"; phase: Lifecycle } => c.kind === "refine")?.phase;
  const body = await compose(typed);
  set({ chips: [] });
  const sp = useSpar.getState();
  if (sp.draftingNewFeature || (await isNewProjectBrief())) startFeature(body);
  else if (refine) revise(refine, body);
  else if (sp.next?.action === "prompt" && agentOf().runsSpar) continueWork(body);
  else send(body);
}

/** "continue", "next", "approve"… move the SPAR workflow without a button. */
function handleWorkflowShortcut(typed: string): boolean {
  const t = typed.toLowerCase().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");
  const n = useSpar.getState().next;
  if (!n) return false;
  if (n.action === "gate" && n.gate && ["approve", "approved", "lgtm", "looks good", "ship it", "approve it"].includes(t)) {
    tx((x) => x.echoUser(typed));
    decide(n.gate, true, "").then((err) => { if (err) tx((x) => x.note(err)); });
    return true;
  }
  if (["run", "check", "fix"].includes(n.action) && ["continue", "next", "go", "go on", "proceed", "keep going", "yes", "ok", "okay", "y", "next step"].includes(t)) {
    continueWork();
    return true;
  }
  return false;
}

/** Adds the mode prefix, attached context and relevant rules to a message. */
async function compose(typed: string): Promise<string> {
  // Claude Code treats fast multi-line input as a paste, so simple context stays on the
  // message's own line; only real blocks go below it.
  const inline: string[] = [];
  const blocks: string[] = [];
  const attached = [...S().chips];
  const pv = usePreview.getState();
  const has = (k: string) => attached.some((c) => c.kind === k);
  if (interactionOf() === "debug") {
    if (pv.errors.length && !has("previewErrors")) attached.push({ kind: "previewErrors" });
    if (previewIsServer() && pv.log.length && !has("devLog")) attached.push({ kind: "devLog" });
  }
  const mentioned: string[] = [];
  for (const chip of attached) {
    switch (chip.kind) {
      case "file": inline.push(`file ${chip.path}`); mentioned.push(chip.path); break;
      case "folder": inline.push(`folder ${chip.path}/`); mentioned.push(chip.path + "/x"); break;
      case "selection":
        blocks.push(`${chip.path}, lines ${chip.from}–${chip.to}:\n\`\`\`\n${chip.text}\n\`\`\``);
        mentioned.push(chip.path);
        break;
      case "changes": {
        const diff = await gitDiffText();
        if (!diff) inline.push("there are no uncommitted changes");
        else blocks.push("Current git changes:\n```diff\n" + diff + "\n```");
        break;
      }
      case "previewErrors":
        if (pv.errors.length) blocks.push("Errors in the live preview:\n" + pv.errors.map((e) => `- ${e}`).join("\n"));
        break;
      case "devLog":
        blocks.push("Dev server output (last lines):\n```\n" + pv.log.slice(-40).join("\n") + "\n```");
        break;
      case "web": inline.push("search the web if it helps"); break;
    }
  }
  // Rules: always-apply ones once per session, glob rules when a mentioned or changed file matches.
  const relevant = [...mentioned, ...S().changes.map((c) => c.path)];
  for (const rule of S().rules) {
    if (!rulesSent.has(rule.path) && ruleApplies(rule, relevant)) {
      inline.push(`follow the project rule in ${relativePath(S().root, rule.path)}`);
      rulesSent.add(rule.path);
    }
  }
  // Diagram and slide conventions, once per chat, for agents that don't get them as system
  // instructions (Claude Code and the engine's SPAR agents do).
  const a = agentOf();
  if (a.family !== "claude" && !a.runsSpar && !isCustom(a) && !rulesSent.has("diagram-conventions")) {
    inline.push(diagramConventions(), SLIDES_CONVENTIONS);
    rulesSent.add("diagram-conventions");
  }
  let text = typed;
  const prefix = interactionInfo(interactionOf()).prefix;
  if (prefix) text = prefix + " " + text;
  if (inline.length) text += " (Context: " + inline.join("; ") + ".)";
  if (blocks.length) text += "\n\n" + blocks.join("\n\n");
  return text;
}

async function gitDiffText(): Promise<string> {
  const r = await exec.run("git", ["diff", "HEAD", "--no-color", "--stat", "--patch"], { cwd: S().root }).catch(() => null);
  const text = r?.stdout ?? "";
  return text.length > 8000 ? text.slice(0, 8000) + "\n… (truncated)" : text;
}

// ---- Prompt history (↑ / ↓) ------------------------------------------------------------

function rememberPrompt(text: string) {
  const list = prefs.get<string[]>(promptKey(), []);
  const next = list[list.length - 1] === text ? list : [...list, text];
  prefs.set(promptKey(), next.slice(-100));
  set({ historyIndex: null });
}

/** Steps through what was sent before, like a shell. Returns false when there is nothing to do. */
export function historyStep(direction: number): boolean {
  const list = prefs.get<string[]>(promptKey(), []);
  if (!list.length) return false;
  const i = S().historyIndex;
  let idx: number;
  if (i != null) {
    const n = i + direction;
    if (n >= list.length) { set({ historyIndex: null, draft: historyStash }); return true; }
    idx = Math.max(0, n);
  } else {
    if (direction >= 0) return false;
    historyStash = S().draft;
    idx = list.length - 1;
  }
  set({ historyIndex: idx, draft: list[idx] });
  return true;
}

// ---- @-mentions ------------------------------------------------------------------------

let indexCache: { root: string; at: number; files: string[] } | null = null;
async function fileIndex(root: string): Promise<string[]> {
  if (indexCache && indexCache.root === root && Date.now() - indexCache.at < 20_000) return indexCache.files;
  const files = await fs.walk(root, 4000).catch(() => [] as string[]);
  const dirs = new Set<string>();
  for (const f of files) { const parts = f.split("/"); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/") + "/"); }
  const all = [...files.filter((f) => !basename(f).startsWith("mtime-test-")), ...dirs];
  indexCache = { root, at: Date.now(), files: all };
  return all;
}

const subsequence = (needle: string, hay: string) => {
  let hi = 0;
  for (const c of needle) { const f = hay.indexOf(c, hi); if (f < 0) return false; hi = f + 1; }
  return true;
};

/** Files and folders for @-mention search. */
export async function mentionCandidates(query: string): Promise<ContextChip[]> {
  const q = query.toLowerCase();
  const specials: ContextChip[] = [{ kind: "changes" }, { kind: "web" }];
  if (previewAvailable()) specials.push({ kind: "previewErrors" }, { kind: "devLog" });
  const matching = specials.filter((c) => !q || chipTitle(c).toLowerCase().includes(q)).slice(0, 3);
  const ranked = (await fileIndex(S().root)).map((path): [string, number] | null => {
    if (!q) return [path, path.length];
    const lower = path.toLowerCase();
    const name = basename(lower.replace(/\/$/, ""));
    if (name.startsWith(q)) return [path, path.length];
    if (name.includes(q)) return [path, 1000 + path.length];
    if (subsequence(q, lower)) return [path, 3000 + path.length];
    return null;
  }).filter((x): x is [string, number] => x != null).sort((a, b) => a[1] - b[1]).slice(0, 8)
    .map(([p]): ContextChip => (p.endsWith("/") ? { kind: "folder", path: p.slice(0, -1) } : { kind: "file", path: p }));
  return [...matching, ...ranked];
}

// ---- Agent and options -----------------------------------------------------------------

/** Remembers the current chat (titled by its first message) before leaving it. */
function rememberChat() {
  const id = S().sessionId;
  if (!id || id === "bob") return;
  const first = transcript.entries.find((e) => e.kind.type === "user");
  const title = first && first.kind.type === "user" ? first.kind.text.split("\n")[0].slice(0, 60) : null;
  if (!title) return;
  const list = chatHistory().filter((c) => c.id !== id);
  list.unshift({ id, title, date: Date.now() });
  prefs.set(historyKey(), list.slice(0, 30));
}

/** A chat being left mid-turn would keep working (and asking for approvals) with nothing on
 *  screen to show it. Interrupt it; its history stays in the chat list. */
function stopLeavingSession() {
  set({ allowAllInChat: false });
  if (agentOf().family === "bob") { bob?.stop(); return; }
  const sid = S().sessionId;
  if (!sid || !(isRunning() || transcript.pendingApprovals.length)) return;
  client.interrupt(sid).catch(() => {});
}

function detach() {
  resetSessionState();
  set({ sessionId: null, status: "starting", blockedOn: null, entries: [], terminal: null, sessionModel: null, lastTurnChanges: [], checkpoints: {}, answered: [] });
}

/** Spec-driven (SPAR workflow) or vibe (plain chat), for the current agent. */
export function setSpecDriven(on: boolean) {
  if (on === S().specDriven) return;
  switchAgent(S().baseAgent, on);
}

export function switchAgent(kind: AgentKind, specDriven?: boolean) {
  const base = baseOf(kind);
  const mode = specDriven ?? (kind.runsSpar ? true : S().specDriven);
  if (base.name === S().baseAgent.name && mode === S().specDriven && S().sessionId) return;
  stopLeavingSession();
  rememberChat();
  const root = S().root;
  prefs.set(`specDriven:${root}`, mode);
  prefs.set(`agent:${root}`, base.name);
  set({ baseAgent: base, specDriven: mode, prefs: AgentPrefsStore.load(base.name) });
  applyMode();
  rulesSent = new Set();
  detach();
  if (!mode) useSpar.setState({ draftingNewFeature: false });
  attachSession();
  refreshSpar();
}

export function setModel(id: string | null) {
  const p = { ...S().prefs, model: id };
  set({ prefs: p, sessionModel: null });
  AgentPrefsStore.save(S().baseAgent.name, p);
  const sid = S().sessionId;
  if (!sid || agentOf().family === "bob") return;
  client.patchSession(sid, { model_override: id ?? "default" })
    .then(() => tx((t) => t.note(`Model: ${modelTitle()}. Applies from your next message.`)))
    .catch((e) => tx((t) => t.note(String(e.message ?? e))));
}

export function setEffort(effort: string | null) {
  const p = { ...S().prefs, effort };
  set({ prefs: p });
  AgentPrefsStore.save(S().baseAgent.name, p);
  const sid = S().sessionId;
  if (!sid || agentOf().family === "bob") return;
  client.patchSession(sid, { reasoning_effort: effort ?? "default" })
    .then(() => tx((t) => t.note(`Reasoning effort: ${effortTitle(effort)}.`)))
    .catch((e) => tx((t) => t.note(String(e.message ?? e))));
}

/** Permission modes are launch flags, so the agent restarts with the new mode; the
 *  conversation carries over. */
export function setMode(mode: string) {
  const p = { ...S().prefs, mode };
  set({ prefs: p });
  AgentPrefsStore.save(S().baseAgent.name, p);
  const a = agentOf();
  if (a.family !== "claude") {
    // The app answers approvals for these agents; nothing to relaunch.
    if (autoApproves(a, mode)) for (const pending of transcript.pendingApprovals) answer(pending, true);
    tx((t) => t.note(autoApproves(a, mode) ? `${a.title} can now run commands without asking in this project.` : `${a.title} will ask before running commands.`));
    return;
  }
  const sid = S().sessionId;
  if (!sid) return;
  const title = modes(a).find((m) => m.id === mode)?.title ?? mode;
  (async () => {
    try {
      await client.patchSession(sid, { terminal_launch_args: currentLaunchArgs() });
      if (!isRunning()) await client.stopSession(sid).catch(() => {});
      tx((t) => t.note(`Mode: ${title}${isRunning() ? " — applies after this turn." : "."}`));
    } catch (e) { tx((t) => t.note(String((e as Error).message ?? e))); }
  })();
}

export function setInteraction(mode: Interaction) {
  const before = effectivePermission();
  const p = { ...S().prefs, interaction: mode };
  set({ prefs: p });
  AgentPrefsStore.save(S().baseAgent.name, p);
  const sid = S().sessionId;
  if (!sid) return;
  const a = agentOf();
  (async () => {
    if (a.family === "codex") await client.patchSession(sid, { collaboration_mode: mode === "plan" ? "plan" : "default" }).catch(() => {});
    else if (a.family === "claude" && effectivePermission() !== before) {
      await client.patchSession(sid, { terminal_launch_args: currentLaunchArgs() }).catch(() => {});
      if (!isRunning()) await client.stopSession(sid).catch(() => {});
    }
  })();
}

export function cycleInteraction() {
  const all = availableInteractions();
  const i = all.indexOf(interactionOf());
  setInteraction(all[(i + 1) % all.length]);
}

export function resumeChat(id: string) {
  rememberChat();
  rememberSession(sessionKey(), id);
  detach();
  attachSession();
}

export function newSession() {
  set({ allowAllInChat: false });
  stopLeavingSession();
  rememberChat();
  bob?.reset();
  rememberSession(sessionKey(), NEW_CHAT);
  detach();
  attachSession();
}

/** Restarts the agent so it picks up a changed set of MCP servers; the conversation carries
 *  over. Waits for the current turn if one is running. */
export async function reloadAgentTools() {
  const sid = S().sessionId;
  if (!sid || agentOf().family !== "claude") return;
  mcpConfig = await mcpConfigPath().catch(() => null);
  if (mcpConfig && !(await fs.exists(mcpConfig).catch(() => false))) mcpConfig = null;
  await client.patchSession(sid, { terminal_launch_args: currentLaunchArgs() }).catch(() => {});
  if (!isRunning()) await client.stopSession(sid).catch(() => {});
  tx((t) => t.note(isRunning() ? "MCP servers update after this turn." : "MCP servers updated. The agent reloads its tools with your next message."));
}

/** Watch in Terminal: attach to the agent's own terminal session. */
export function openTerminal() {
  const term = S().terminal;
  if (!term) return;
  // Through a small script under the app's data folder, so Terminal never shows the engine's
  // internal socket path or session name (tmux's status line is hidden too).
  void (async () => {
    const info = await appApi.info();
    const dir = `${info.data_dir}/agent-terminal`;
    const script = `${dir}/watch-agent`;
    const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
    await fs.writeText(script, `#!/bin/sh\nprintf '\\033]0;SPAR agent\\007'\nclear\nln -sf ${q(term.socket)} ${q(dir + "/agent.sock")}\nexec tmux -S ${q(dir + "/agent.sock")} attach -t ${q(term.target)} \\; set-option -t ${q(term.target)} status off\n`);
    await exec.run("chmod", ["+x", script]);
    await appApi.runInTerminal(`clear; exec ${q(script)}`);
  })().catch((e) => tx((t) => t.note(String(e))));
}

export function markAnswered(entryId: string) {
  const answered = [...S().answered, entryId];
  set({ answered });
  const sid = S().sessionId;
  if (sid) prefs.set(`answered:${sid}`, answered.slice(-50));
}

export function moveQueued(i: number, by: number) {
  const q = [...S().queue];
  const j = i + by;
  if (j < 0 || j >= q.length) return;
  [q[i], q[j]] = [q[j], q[i]];
  set({ queue: q });
}
export const setQueue = (queue: QueuedMessage[]) => set({ queue });
export const dismissTurnChanges = () => set({ lastTurnChanges: [] });

// ---- Checkpoints -----------------------------------------------------------------------

export async function restoreCheckpoint(entryId: string) {
  const sha = S().checkpoints[entryId];
  if (!sha) return;
  // Source control owns the checkpoints; it notes the result here and refreshes.
  const r = await scmRestore(sha).catch((e) => ({ ok: false, undo: null, message: String(e) }));
  set({ restoredUndo: r.undo });
  refreshAfterFileChange();
}

export async function undoRestore() {
  await scmUndo();
  set({ restoredUndo: null });
  refreshAfterFileChange();
}

export function refreshAfterFileChange() {
  useWorkspace.setState((s) => ({ reloadToken: s.reloadToken + 1, fileTreeVersion: s.fileTreeVersion + 1 }));
  refreshSpar();
  refreshChanges();
}

// ---- Inline edits (⌘K) -----------------------------------------------------------------

export function startInlineEdit(path: string, text: string, from: number, to: number, selection: string, instruction: string) {
  const rel = relativePath(S().root, path);
  set({ inlineEdit: { path, original: text, from, to, state: "waiting" } });
  send(`Edit ${rel}, lines ${from}–${to}:\n\`\`\`\n${selection}\n\`\`\`\nInstruction: ${instruction}\nChange only what the instruction needs, keep the rest of the file as it is, and don't reply with the code.`);
}

async function inlineEditTurnEnded() {
  const edit = S().inlineEdit;
  if (!edit || edit.state !== "waiting") return;
  const now = await fs.readText(edit.path).catch(() => edit.original);
  if (now === edit.original) {
    set({ inlineEdit: null });
    tx((t) => t.note("The ⌘K edit made no changes."));
  } else {
    set({ inlineEdit: { ...edit, state: "review" } });
    useWorkspace.setState((s) => ({ reloadToken: s.reloadToken + 1 }));
  }
}

export const acceptInlineEdit = () => set({ inlineEdit: null });
export async function rejectInlineEdit() {
  const edit = S().inlineEdit;
  if (!edit) return;
  await fs.writeText(edit.path, edit.original).catch(() => {});
  set({ inlineEdit: null });
  refreshAfterFileChange();
}

// "Add to Chat" from other features.
if (typeof window !== "undefined") {
  window.addEventListener("spar:attach", (e) => {
    const path = (e as CustomEvent<{ path: string }>).detail?.path;
    if (path) attachFiles([path]);
  });
}

// Other features hand text to the agent (the preview's "Send errors to the agent").
if (typeof window !== "undefined") {
  window.addEventListener("spar:send-to-agent", (e) => {
    const text = (e as CustomEvent<{ text: string }>).detail?.text;
    if (text && S().sessionId) send(text);
  });
}

export { currentPhase, artifactPath };
export type { StepCard };
