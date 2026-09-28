// The engine's lifecycle as the UI sees it: status, first-run setup, start/restart with
// the current agent bundles. One engine serves every window.

import { create } from "zustand";
import { call } from "../lib/backend";
import { bundles } from "./bundles";
import { engine as client } from "./client";
import { CLAUDE_VIBE_AGENT, CustomAgents, refreshCopilotModels, HARNESS_BINARIES, VARIANT_HARNESSES, named, type AgentKind, type Availability } from "../features/chat/catalog";
import { exec } from "../lib/api";

export interface EngineStatus { ready: boolean; running: boolean; starting: boolean; message: string; missing: string[]; wsl: boolean; platform: string; port: number }

interface EngineStore {
  status: EngineStatus | null;
  busy: "starting" | "setup" | "restarting" | null;
  error: string | null;
  refresh(): Promise<EngineStatus>;
  start(): Promise<void>;
  restart(): Promise<void>;
  setup(): Promise<void>;
  /** Waits until the engine answers (or gives up after `ms`). */
  waitReady(ms?: number): Promise<boolean>;
  /** Registered agents (name → id, harness), the online host and its harness report. */
  agentIds: Record<string, { id: string; harness: string }>;
  hostId: string | null;
  harnesses: Record<string, unknown>;
  /** The engine runs but the SPAR agent didn't register (only spec-driven chats are affected). */
  sparMissing: boolean;
  /** Which agent CLIs are on this machine (SPAR never installs them). */
  binaries: Record<string, boolean>;
  loadAgents(): Promise<void>;
}

export const useEngine = create<EngineStore>((set, get) => ({
  status: null,
  busy: null,
  error: null,
  agentIds: {},
  hostId: null,
  harnesses: {},
  sparMissing: false,
  binaries: {},
  async loadAgents() {
    try {
      const [agentIds, hostId, harnesses] = await Promise.all([client.agents(), client.onlineHostId(), client.hostHarnesses().catch(() => ({}))]);
      set({ agentIds, hostId, harnesses, sparMissing: !agentIds["spar"] });
    } catch { /* engine not up yet */ }
    const binaries: Record<string, boolean> = {};
    await Promise.all(["bob", ...Object.values(HARNESS_BINARIES)].map(async (b) => { binaries[b] = !!(await exec.which(b).catch(() => null)); }));
    set({ binaries });
    if (availability("copilot") === "ready") refreshCopilotModels();
  },
  async refresh() {
    const s = await call<EngineStatus>("engine_status");
    set({ status: s });
    return s;
  },
  async start() {
    if (get().busy) return;
    set({ busy: "starting", error: null });
    try {
      const b = await bundles();
      set({ status: await call<EngineStatus>("engine_start", b) });
      if (get().status?.ready) await get().loadAgents();
    } catch (e) {
      set({ error: String(e) });
      await get().refresh();
    } finally {
      set({ busy: null });
    }
  },
  async restart() {
    set({ busy: "restarting", error: null });
    try {
      const b = await bundles();
      set({ status: await call<EngineStatus>("engine_restart", b), agentIds: {}, hostId: null });
      await get().waitReady(60_000);
      await get().loadAgents();
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ busy: null });
    }
  },
  async setup() {
    set({ busy: "setup", error: null });
    try {
      await call<string>("engine_setup");
    } catch (e) {
      set({ error: String(e) });
    }
    set({ busy: null });
    const s = await get().refresh();
    if (!s.ready && s.missing.length === 0) await get().start();
  },
  async waitReady(ms = 120_000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const s = get().status;
      if (s?.ready) return true;
      await new Promise((r) => setTimeout(r, 700));
      await get().refresh().catch(() => {});
    }
    return false;
  },
}));

/** Called once per window at launch: start the engine when everything it needs is there. */
export async function bootEngine() {
  const e = useEngine.getState();
  const s = await e.refresh();
  if (s.platform === "windows" && !s.wsl) return;
  // Like the Mac app: first launch installs what's missing (then starts the engine);
  // otherwise setup runs once per launch in the background (SPAR upgrades, playbooks).
  if (s.missing.length > 0) return e.setup();
  call("setup_start").catch(() => {});
  // Always ask: a running engine whose agent prompts are out of date is restarted.
  await e.start();
}

/** The engine agent a chat runs on: vibe Claude uses SPAR's own bundle when it registered. */
export function engineAgentName(kind: AgentKind): string {
  if (kind.family === "claude" && !kind.runsSpar && useEngine.getState().agentIds[CLAUDE_VIBE_AGENT]) return CLAUDE_VIBE_AGENT;
  return kind.name;
}

/** Whether an agent can run on this machine, from the host's harness report and the CLIs present. */
export function availability(agent: string): Availability {
  const { agentIds, harnesses, binaries } = useEngine.getState();
  if (agent === "bob" || agent === "spar-bob") return binaries.bob === false ? "notInstalled" : "ready";
  if (CustomAgents.isCustom(agent)) return "ready";
  const kind = named(agent);
  const base = agent.startsWith("spar-") ? agent.slice(5) : agent;
  const harness = agentIds[agent]?.harness || VARIANT_HARNESSES.find((v) => v.agent === base)?.harness || (kind.family === "claude" ? "claude-native" : undefined);
  if (harness && harnesses[harness] === true) return "ready";
  if (harness && HARNESS_BINARIES[harness]) return binaries[HARNESS_BINARIES[harness]] === false ? "notInstalled" : "ready";
  if (!harness) return "needsSetup";
  const h = harnesses[harness];
  return typeof h === "string" && h === "binary-missing" ? "notInstalled" : "needsSetup";
}

/** Resolves once the engine is ready with a host and agents, or throws. */
export async function engineReady(): Promise<{ hostId: string }> {
  const e = useEngine.getState();
  for (let i = 0; i < 400; i++) {
    const st = useEngine.getState();
    if (st.status?.ready) {
      if (!st.hostId || !Object.keys(st.agentIds).length) await st.loadAgents();
      const hostId = useEngine.getState().hostId;
      if (hostId) return { hostId };
    } else if (st.error && !st.busy) {
      throw new Error(st.error);
    } else if (st.status && st.status.missing.length && !st.busy) {
      throw new Error(st.status.message);
    }
    await new Promise((r) => setTimeout(r, 300));
    if (i % 5 === 4) await e.refresh().catch(() => {});
  }
  throw new Error("The engine did not start.");
}
