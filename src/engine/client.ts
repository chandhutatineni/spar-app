// Client for the agent engine's HTTP API (a port of the Mac app's OmnigentClient.swift).
// Requests go through the backend (engine_http) because the engine sends no CORS headers;
// the session stream arrives as `engine:event` events.

import { call, listen } from "../lib/backend";
import { fs } from "../lib/api";

export type JSONValue = any;
export interface Change { path: string; status: string }

interface HttpResult { status: number; body: JSONValue; text?: string | null; error?: string }

export class EngineError extends Error {}

async function request(method: string, path: string, body?: JSONValue, timeoutMs?: number): Promise<HttpResult> {
  return call<HttpResult>("engine_http", { method, path, body, timeout_ms: timeoutMs });
}

async function get(path: string) {
  const r = await request("GET", path);
  if (r.status < 200 || r.status >= 300) throw new EngineError(`GET ${path} → HTTP ${r.status} ${r.error ?? ""}`.trim());
  return r.body;
}

async function post(path: string, body: JSONValue) {
  const r = await request("POST", path, body);
  if (r.status < 200 || r.status >= 300) throw new EngineError(`POST ${path} → HTTP ${r.status} ${r.body?.detail ? JSON.stringify(r.body.detail) : r.error ?? ""}`.trim());
  return r.body;
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", json: "application/json", csv: "text/csv", html: "text/html",
};

let streamSeq = 0;

export const engine = {
  async healthy(): Promise<boolean> {
    try { return (await request("GET", "/health", undefined, 3000)).status === 200; } catch { return false; }
  },

  async onlineHostId(): Promise<string | null> {
    const hosts: JSONValue[] = (await get("/v1/hosts"))?.hosts ?? [];
    return hosts.find((h) => h.status === "online")?.host_id ?? null;
  },

  /** Agent name → {id, harness}; follows every page (SPAR registers more than one page). */
  async agents(): Promise<Record<string, { id: string; harness: string }>> {
    const out: Record<string, { id: string; harness: string }> = {};
    let after: string | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await get("/v1/agents?limit=100" + (after ? `&after=${after}` : ""));
      for (const a of page?.data ?? []) if (a.name && a.id) out[a.name] = { id: a.id, harness: a.harness ?? "" };
      if (page?.has_more !== true || !page?.last_id) break;
      after = page.last_id;
    }
    return out;
  },

  /** Harness → availability as the online host reports it (true, false or "binary-missing"). */
  async hostHarnesses(): Promise<Record<string, JSONValue>> {
    const hosts: JSONValue[] = (await get("/v1/hosts"))?.hosts ?? [];
    return hosts.find((h) => h.status === "online")?.configured_harnesses ?? {};
  },

  async patchSession(id: string, body: JSONValue) {
    const r = await request("PATCH", `/v1/sessions/${id}`, body);
    if (r.status < 200 || r.status >= 300) throw new EngineError(`Could not update the session (HTTP ${r.status}) ${r.body?.detail ?? ""}`);
  },

  stopSession: (id: string) => post(`/v1/sessions/${id}/events`, { type: "stop_session", data: {} }),

  async createSession(agentId: string, hostId: string, workspace: string, launchArgs: string[]): Promise<JSONValue> {
    return post("/v1/sessions", { agent_id: agentId, host_id: hostId, workspace, terminal_launch_args: launchArgs });
  },

  /** Snapshot with `items`, `pending_elicitations` and `status`; null when gone. */
  async session(id: string): Promise<JSONValue | null> {
    const r = await request("GET", `/v1/sessions/${id}`);
    if (r.status === 404) return null;
    if (r.status < 200 || r.status >= 300) throw new EngineError(`GET session → HTTP ${r.status}`);
    return r.body;
  },

  /** Sends a message; files travel as input_image / input_file blocks. */
  async send(id: string, text: string, attachments: string[] = []) {
    const content: JSONValue[] = [{ type: "input_text", text }];
    for (const path of attachments) {
      const name = path.split(/[\\/]/).pop() ?? "file";
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const mime = MIME[ext] ?? "application/octet-stream";
      const data = await fs.readBase64(path);
      if (data.length > 34_000_000) throw new EngineError(`${name} is larger than 25 MB`);
      const uri = `data:${mime};base64,${data}`;
      content.push(mime.startsWith("image/") ? { type: "input_image", image_url: uri, filename: name } : { type: "input_file", file_data: uri, filename: name });
    }
    await post(`/v1/sessions/${id}/events`, { type: "message", data: { role: "user", content } });
  },

  interrupt: (id: string) => post(`/v1/sessions/${id}/events`, { type: "interrupt", data: {} }),

  resolve: (id: string, elicitation: string, accept: boolean) =>
    post(`/v1/sessions/${id}/elicitations/${elicitation}/resolve`, { action: accept ? "accept" : "decline" }),

  async changes(id: string): Promise<Change[]> {
    const data: JSONValue[] = (await get(`/v1/sessions/${id}/resources/environments/default/changes`))?.data ?? [];
    return data.filter((e) => e.path).map((e) => ({ path: e.path, status: e.status ?? "modified" }));
  },

  async diff(id: string, path: string): Promise<{ before: string | null; after: string | null }> {
    const o = await get(`/v1/sessions/${id}/resources/environments/default/diff/${encodePath(path)}`);
    return { before: o?.before ?? null, after: o?.after ?? null };
  },

  /**
   * Live tail of session events. No replay: re-read the snapshot after connecting and
   * de-duplicate items by id. `onEnd` fires when the stream drops (not when closed).
   * Returns a function that closes the stream.
   */
  stream(id: string, onEvent: (e: JSONValue) => void, onEnd: (error: string | null) => void): () => void {
    const key = `s${++streamSeq}-${id}`;
    const offEvent = listen<{ key: string; data: JSONValue }>("engine:event", (p) => p.key === key && onEvent(p.data));
    const offEnd = listen<{ key: string; error: string | null }>("engine:stream-end", (p) => {
      if (p.key === key) { offEvent(); offEnd(); onEnd(p.error); }
    });
    call("engine_stream_open", { key, session: id }).catch((e) => { offEvent(); offEnd(); onEnd(String(e)); });
    return () => { offEvent(); offEnd(); call("engine_stream_close", { key }).catch(() => {}); };
  },
};
