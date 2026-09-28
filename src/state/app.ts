// App-level state for this window: which project is open, recent projects.
// (The Mac app's AppModel; the engine is in engine/engine.ts.)

import { create } from "zustand";
import { app as appApi, fs } from "../lib/api";
import { call, listen } from "../lib/backend";
import { prefs } from "../lib/prefs";
import { useWorkspace } from "./workspace";

type Hook = (root: string) => void;
const openHooks = new Set<Hook>();
const closeHooks = new Set<Hook>();

/** Per-project setup/teardown for features (session restore, git status, …). */
export function onProjectOpen(h: Hook) { openHooks.add(h); return () => openHooks.delete(h); }
export function onProjectClose(h: Hook) { closeHooks.add(h); return () => closeHooks.delete(h); }

interface AppStore {
  project: string | null;
  recents: string[];
  openProject(path: string): Promise<void>;
  closeProject(): void;
}

let unlistenFs: (() => void) | null = null;

async function setTitle(title: string) {
  document.title = title;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  } catch { /* dev browser */ }
}

export const useApp = create<AppStore>((set, get) => ({
  project: null,
  recents: prefs.get<string[]>("recents", []),

  async openProject(path) {
    path = path.replace(/[\\/]+$/, "");
    if (!(await fs.exists(path))) return;
    const prev = get().project;
    if (prev) closeHooks.forEach((h) => h(prev));
    unlistenFs?.();
    useWorkspace.getState().setRoot(path);
    const recents = [path, ...get().recents.filter((r) => r !== path)].slice(0, 10);
    prefs.set("recents", recents);
    prefs.set("lastProject", path);
    set({ project: path, recents });
    appApi.setRecents(recents);
    setTitle(useWorkspace.getState().name);
    fs.watch(path).catch(() => {});
    unlistenFs = listen<{ root: string; paths: string[] }>("fs:change", (p) => {
      if (p.root === path) useWorkspace.setState((s) => ({ fileTreeVersion: s.fileTreeVersion + 1 }));
    });
    openHooks.forEach((h) => h(path));
  },

  closeProject() {
    const prev = get().project;
    if (prev) {
      closeHooks.forEach((h) => h(prev));
      fs.unwatch(prev).catch(() => {});
    }
    unlistenFs?.();
    unlistenFs = null;
    set({ project: null });
    setTitle("SPAR");
  },
}));

/** Which project this window opens: #project=… (New Window for a project), then SPAR_PROJECT
 *  for the first window of a launch only, then — like the Mac app — the last project when this
 *  is the only window (first launch, or after every window closed). */
export async function initialProject(): Promise<string | null> {
  const m = location.hash.match(/project=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  const launch = await call<string | null>("app_launch_project").catch(() => null);
  if (launch) return launch;
  const windows = await call<number>("app_window_count").catch(() => 1);
  return windows <= 1 ? prefs.get<string | null>("lastProject", null) : null;
}

/** Subscribe to file changes under the open project. */
export function onFilesChanged(cb: (paths: string[]) => void) {
  return listen<{ root: string; paths: string[] }>("fs:change", (p) => {
    if (p.root === useApp.getState().project) cb(p.paths);
  });
}
