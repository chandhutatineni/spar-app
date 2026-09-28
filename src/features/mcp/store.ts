// The MCP servers as the UI sees them (the Mac app's MCPStore). The backend (mcp.rs) owns
// the list, status and the agent's config file; every window mirrors it via `mcp:changed`.

import { create } from "zustand";
import { call, listen } from "../../lib/backend";
import { importJSON, parseRegistry, type MCPServer, type MCPStatus, type RegistryEntry } from "./mcpJson";

interface State {
  servers: MCPServer[];
  status: Record<string, MCPStatus>;
  tools: Record<string, string[]>;
  configPath: string;
  storePath: string;
  loaded: boolean;
}

interface MCPStore extends State {
  load(): Promise<void>;
  setEnabled(id: string, on: boolean): Promise<void>;
  add(server: MCPServer): Promise<string>;
  remove(id: string): Promise<void>;
  update(server: MCPServer): Promise<void>;
  check(id: string): Promise<void>;
  checkAll(): Promise<void>;
  /** Import or replace from JSON; throws JSONError with a message for the person. */
  importJSON(text: string, replace: boolean, name?: string): Promise<number>;
  search(query: string): Promise<RegistryEntry[]>;
  statusOf(id: string): MCPStatus;
}

interface Snapshot { servers: MCPServer[]; status: Record<string, MCPStatus>; tools: Record<string, string[]>; config_path: string; store_path: string }

const apply = (s: Snapshot): Partial<State> => ({ servers: s.servers, status: s.status, tools: s.tools, configPath: s.config_path, storePath: s.store_path, loaded: true });

let subscribed = false;
/**
 * Re-reads the state after a change. Events keep it live; this covers missed ones (the dev
 * bridge drops events across restarts) by re-reading while a check is still pending.
 */
let pending: ReturnType<typeof setTimeout> | undefined;
async function reread(tries = 40) {
  const s = await call<Snapshot>("mcp_state");
  useMCP.setState(apply(s));
  clearTimeout(pending);
  const waiting = s.servers.some((x) => x.enabled && (!s.status[x.id] || s.status[x.id].state === "checking"));
  if (waiting && tries > 0) pending = setTimeout(() => reread(tries - 1).catch(() => {}), 1500);
}

export const useMCP = create<MCPStore>((set, get) => ({
  servers: [],
  status: {},
  tools: {},
  configPath: "",
  storePath: "",
  loaded: false,
  async load() {
    if (!subscribed) {
      subscribed = true;
      listen<Snapshot>("mcp:changed", (s) => set(apply(s)));
    }
    await reread();
  },
  async setEnabled(id, on) { await call("mcp_set_enabled", { id, on }); await reread(); },
  async add(server) { const id = await call<string>("mcp_add", { server }); await reread(); return id; },
  async remove(id) { await call("mcp_remove", { id }); await reread(); },
  async update(server) { await call("mcp_update", { server }); await reread(); },
  async check(id) { await call("mcp_check", { id }); await reread(); },
  async checkAll() { await call("mcp_check_all"); await reread(); },
  async importJSON(text, replace, name = "server") {
    const r = importJSON(text, replace, get().servers, name);
    await call("mcp_set_servers", { servers: r.servers });
    await reread();
    return r.count;
  },
  async search(query) {
    return parseRegistry(await call("mcp_registry_search", { query }).catch(() => null));
  },
  statusOf: (id) => get().status[id] ?? { state: "unknown" },
}));

/** Enabled servers whose check passed ("MCP servers · 5 ready"). */
export function useReadyCount(): number {
  return useMCP((s) => s.servers.filter((x) => x.enabled && s.status[x.id]?.state === "ok").length);
}

/** The file to pass to Claude Code with --mcp-config (the chat feature's launch args). */
export const mcpConfigPath = () => call<string>("mcp_config_path");

/** Call after the GitHub account is connected or disconnected (the GitHub server uses it). */
export const githubAccountChanged = () => call("mcp_github_changed").catch(() => {});
