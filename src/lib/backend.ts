// The one way the UI reaches the backend. Inside the app: the Tauri `call` command and
// Tauri events. In a plain browser (development, Playwright): the dev bridge on
// 127.0.0.1:47900, which runs the same backend commands (see src-tauri/src/bridge.rs).

import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const BRIDGE = "http://127.0.0.1:47900";

export class BackendError extends Error {}

/** Runs a backend command by name (see the `register` functions in src-tauri/src). */
export async function call<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (inTauri) {
    try {
      return (await invoke("call", { cmd, args })) as T;
    } catch (e) {
      throw new BackendError(String(e));
    }
  }
  const r = await fetch(`${BRIDGE}/call/${cmd}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json();
  if (!j.ok) throw new BackendError(j.error);
  return j.value as T;
}

type Handler = (payload: any) => void;
const bridgeHandlers = new Map<string, Set<Handler>>();
let polling = false;

async function pollBridge() {
  if (polling) return;
  polling = true;
  let after = 0;
  try {
    // Start from now: only new events.
    const first = await (await fetch(`${BRIDGE}/events?after=${Number.MAX_SAFE_INTEGER}`)).json().catch(() => ({ last: 0 }));
    after = first.last ?? 0;
  } catch { /* bridge not up yet */ }
  for (;;) {
    try {
      const r = await fetch(`${BRIDGE}/events?after=${after}`);
      const j = await r.json();
      after = j.last;
      for (const ev of j.events as { topic: string; payload: unknown }[]) {
        const topic = ev.topic === "menu:bridge" ? "menu" : ev.topic;
        bridgeHandlers.get(topic)?.forEach((h) => h(ev.payload));
      }
    } catch {
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
}

/** Subscribes to a backend event topic (`pty:data`, `fs:change`, `engine:event`, `menu`, …). */
export function listen<T = any>(topic: string, handler: (payload: T) => void): () => void {
  if (inTauri) {
    let un: UnlistenFn | undefined;
    let cancelled = false;
    tauriListen<T>(topic, (e) => handler(e.payload)).then((u) => (cancelled ? u() : (un = u)));
    return () => {
      cancelled = true;
      un?.();
    };
  }
  if (!bridgeHandlers.has(topic)) bridgeHandlers.set(topic, new Set());
  bridgeHandlers.get(topic)!.add(handler as Handler);
  pollBridge();
  return () => bridgeHandlers.get(topic)?.delete(handler as Handler);
}
