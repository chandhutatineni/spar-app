// Preferences (the Mac app's UserDefaults / @AppStorage), shared by every window and kept
// in sync across them. Same key names as the Mac app where they exist.

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const cache = new Map<string, unknown>();

const MISSING = Symbol("missing");
/** Unset keys: each caller's own fallback (kept stable for useSyncExternalStore). */
const fallbacks = new Map<string, unknown>();

function read<T>(key: string, fallback: T): T {
  if (!cache.has(key)) {
    let v: unknown = MISSING;
    try {
      const raw = localStorage.getItem("pref:" + key);
      if (raw != null) v = JSON.parse(raw);
    } catch { /* storage unavailable */ }
    cache.set(key, v);
  }
  const v = cache.get(key);
  if (v !== MISSING) return v as T;
  // Never cache one caller's fallback for everyone (readers may pass different defaults).
  const fk = key + "\u0000" + JSON.stringify(fallback);
  if (!fallbacks.has(fk)) fallbacks.set(fk, fallback);
  return fallbacks.get(fk) as T;
}

export const prefs = {
  get<T>(key: string, fallback: T): T {
    return read(key, fallback);
  },
  set<T>(key: string, value: T) {
    cache.set(key, value === undefined || value === null ? MISSING : value);
    try {
      if (value === undefined || value === null) localStorage.removeItem("pref:" + key);
      else localStorage.setItem("pref:" + key, JSON.stringify(value));
    } catch { /* storage unavailable */ }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

window.addEventListener("storage", (e) => {
  if (e.key?.startsWith("pref:")) {
    cache.delete(e.key.slice(5));
    listeners.forEach((l) => l());
  }
});

/** A preference as React state: `const [size, setSize] = usePref("editorFontSize", 13)`. */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const v = useSyncExternalStore(prefs.subscribe, () => read(key, fallback));
  return [v, (nv: T) => prefs.set(key, nv)];
}
