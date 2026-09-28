// What source control reads from the chat/SPAR state (the agent session id, the checkpoint
// taken when the last agent turn began, the selected feature). Those stores belong to the
// chat feature, so they are found defensively: whichever zustand store in src/state has the
// field wins, and a missing store just means "no session".

import { useSyncExternalStore } from "react";

type Store = { getState(): Record<string, any>; setState(p: Record<string, any>): void };

const loaders = import.meta.glob("../../state/*.ts");
let stores: Store[] = [];
let loading: Promise<void> | null = null;

async function load() {
  loading ??= (async () => {
    const found: Store[] = [];
    for (const [path, l] of Object.entries(loaders)) {
      if (/\/(app|workspace)\.ts$/.test(path) || path.endsWith(".test.ts")) continue;
      try {
        const m = (await l()) as Record<string, unknown>;
        for (const v of Object.values(m)) {
          if (typeof v === "function" && typeof (v as any).getState === "function" && typeof (v as any).setState === "function") found.push(v as unknown as Store);
        }
      } catch { /* not there yet */ }
    }
    stores = found;
  })();
  await loading;
}
load();

function read<T>(keys: string[]): T | null {
  for (const s of stores) {
    const st = s.getState();
    for (const k of keys) if (st && st[k] != null) return st[k] as T;
  }
  return null;
}

export async function ready() { await load(); }

/** The agent session's id (for engine.changes / engine.diff when there is no repository). */
export const sessionId = () => read<string>(["sessionId", "session"]);
/** The checkpoint taken when the last agent turn began. */
export const lastTurnStart = () => read<string>(["lastTurnStart"]);
/** The selected SPAR feature and the current phase (for a suggested commit message). */
export const restoredUndo = () => read<string>(["restoredUndo"]);
export const feature = () => read<string>(["feature", "selectedFeature"]);
export const currentPhase = () => read<string>(["currentPhase", "phase"]);

/** Drops files from the chat's "the last turn changed…" list once they are reviewed. */
export function forgetTurnChanges(paths: string[] | "all") {
  for (const s of stores) {
    const st = s.getState();
    if (Array.isArray(st?.lastTurnChanges)) {
      s.setState({ lastTurnChanges: paths === "all" ? [] : st.lastTurnChanges.filter((p: string) => !paths.includes(p)) });
    }
  }
}

/** Adds a note to the chat transcript, when the chat store offers one. */
export function note(text: string) {
  for (const s of stores) {
    const st = s.getState();
    if (typeof st?.note === "function") { st.note(text); return; }
    if (typeof st?.transcript?.note === "function") { st.transcript.note(text); return; }
  }
}

/** "003-user-login" → "User login" (Spar.featureTitle). */
export function featureTitle(id: string) {
  const words = id.split("-");
  if (words.length && /^\d+$/.test(words[0])) words.shift();
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Add to Chat": the chat store's attach, else an event the chat can listen for. */
export function attach(absPath: string) {
  for (const s of stores) {
    const st = s.getState();
    for (const k of ["attach", "attachFile", "attachFiles"]) {
      if (typeof st?.[k] === "function") { st[k](k === "attachFiles" ? [absPath] : absPath); return; }
    }
  }
  window.dispatchEvent(new CustomEvent("spar:attach", { detail: { path: absPath } }));
}

/** Sets a field on whichever peer store has it. */
export function setField(key: string, value: unknown) {
  for (const s of stores) if (s.getState() && key in s.getState()) s.setState({ [key]: value });
}

/** A peer store field as React state (re-renders when that store changes). */
export function usePeerField<T>(key: string): T | null {
  return useSyncExternalStore(
    (cb) => {
      let unsubs: (() => void)[] = [];
      let dead = false;
      load().then(() => { if (!dead) unsubs = stores.map((s) => (s as any).subscribe?.(cb) ?? (() => {})); cb(); });
      return () => { dead = true; unsubs.forEach((u) => u()); };
    },
    () => read<T>([key]),
  );
}
