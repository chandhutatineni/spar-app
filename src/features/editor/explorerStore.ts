// Explorer tree state (ExplorerModel in Explorer.swift): open folders, lazy-loaded
// children, what is being created or renamed, and the file operations behind the menus.

import { create } from "zustand";
import { basename, dirname, exec, fs, joinPath, type FileEntry } from "../../lib/api";
import { call } from "../../lib/backend";
import { confirm, alert } from "../../lib/dialogs";
import { prefs } from "../../lib/prefs";
import { useWorkspace } from "../../state/workspace";
import { invalidateFileIndex } from "./fileIndex";

export interface Entry { path: string; name: string; isDir: boolean }

export const ALWAYS_HIDDEN = new Set([".git", ".DS_Store", ".codegraph"]);

interface ExplorerStore {
  root: string;
  expanded: Set<string>;
  showHidden: boolean;
  filter: string;
  renaming: string | null;
  creating: { parent: string; isFolder: boolean } | null;
  selected: string | null;
  cache: Record<string, Entry[]>;
  /** Git status by workspace-relative path. */
  status: Record<string, string>;
  reset(root: string): void;
  load(dir: string, force?: boolean): Promise<void>;
  invalidate(): void;
  toggle(dir: string): void;
  collapseAll(): void;
  reveal(path: string): void;
  targetFolder(): string;
  beginCreate(folder: boolean, parent?: string): void;
  create(name: string): Promise<string | null>;
  rename(path: string, name: string): Promise<string | null>;
  trash(path: string): Promise<boolean>;
  duplicate(path: string): Promise<void>;
  setShowHidden(on: boolean): void;
  refreshStatus(): Promise<void>;
}

const inflight = new Map<string, Promise<void>>();

export const useExplorer = create<ExplorerStore>((set, get) => ({
  root: "",
  expanded: new Set(),
  showHidden: prefs.get("explorerShowHidden", true),
  filter: "",
  renaming: null,
  creating: null,
  selected: null,
  cache: {},
  status: {},

  reset(root) {
    set({ root, expanded: new Set([root]), filter: "", renaming: null, creating: null, selected: null, cache: {}, status: {} });
  },

  async load(dir, force) {
    if (!force && get().cache[dir]) return;
    if (inflight.has(dir)) return inflight.get(dir);
    const p = (async () => {
      let items: FileEntry[] = [];
      try { items = await fs.list(dir); } catch { /* gone */ }
      const { showHidden } = get();
      const entries = items
        .filter((e) => !ALWAYS_HIDDEN.has(e.name) && !e.name.startsWith("mtime-test-") && (showHidden || !e.name.startsWith(".")))
        .map((e) => ({ path: e.path, name: e.name, isDir: e.is_dir }))
        .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })));
      set({ cache: { ...get().cache, [dir]: entries } });
    })().finally(() => inflight.delete(dir));
    inflight.set(dir, p);
    return p;
  },

  /** Re-reads every loaded folder (keeping the old rows until the new ones arrive). */
  invalidate() {
    invalidateFileIndex(get().root);
    const dirs = Object.keys(get().cache);
    const { expanded } = get();
    for (const d of dirs) {
      if (expanded.has(d)) void get().load(d, true);
      else { const c = { ...get().cache }; delete c[d]; set({ cache: c }); }
    }
    void get().refreshStatus();
  },

  toggle(dir) {
    const e = new Set(get().expanded);
    if (e.has(dir)) e.delete(dir); else e.add(dir);
    set({ expanded: e });
  },

  collapseAll() {
    set({ expanded: new Set([get().root]) });
  },

  reveal(path) {
    const { root } = get();
    const e = new Set(get().expanded);
    let dir = dirname(path);
    while (dir.startsWith(root) && dir !== root) {
      e.add(dir);
      dir = dirname(dir);
    }
    set({ expanded: e, selected: path });
  },

  targetFolder() {
    const { selected, root, cache } = get();
    if (!selected) return root;
    const isDir = Object.values(cache).some((list) => list.some((x) => x.path === selected && x.isDir));
    return isDir ? selected : dirname(selected);
  },

  beginCreate(folder, parent) {
    const p = parent ?? get().targetFolder();
    const e = new Set(get().expanded);
    e.add(p);
    set({ expanded: e, creating: { parent: p, isFolder: folder } });
  },

  async create(name) {
    const c = get().creating;
    set({ creating: null });
    const trimmed = name.trim();
    if (!c || !trimmed) return null;
    const path = joinPath(c.parent, trimmed);
    try {
      if (await fs.exists(path)) { await alert(`“${trimmed}” already exists`, "Choose a different name."); return null; }
      if (c.isFolder) await fs.mkdir(path);
      else await fs.writeText(path, "");
    } catch (e) {
      await alert(`Couldn't create “${trimmed}”`, String(e));
      return null;
    }
    get().invalidate();
    // Folders in the name ("a/b/c.ts") open on the way.
    get().reveal(path);
    set({ selected: path });
    return c.isFolder ? null : path;
  },

  async rename(path, name) {
    set({ renaming: null });
    const trimmed = name.trim();
    if (!trimmed || trimmed === basename(path)) return null;
    const dest = joinPath(dirname(path), trimmed);
    try {
      if (await fs.exists(dest)) { await alert(`“${trimmed}” already exists`, "Choose a different name."); return null; }
      await fs.rename(path, dest);
    } catch (e) {
      await alert(`Couldn't rename “${basename(path)}”`, String(e));
      return null;
    }
    get().invalidate();
    set({ selected: dest });
    return dest;
  },

  async trash(path) {
    const ok = await confirm(`Move “${basename(path)}” to the Trash?`, "You can restore it from the Trash.", "Move to Trash", true);
    if (!ok) return false;
    try {
      await call("editor_trash", { path });
    } catch (e) {
      await alert(`Couldn't move “${basename(path)}” to the Trash`, String(e));
      get().invalidate();
      return false;
    }
    get().invalidate();
    return true;
  },

  async duplicate(path) {
    const name = basename(path);
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    let n = 1, dest: string;
    do {
      dest = joinPath(dirname(path), `${base} copy${n > 1 ? ` ${n}` : ""}${ext}`);
      n++;
    } while (await fs.exists(dest));
    const isDir = (await fs.stat(path))?.is_dir;
    if (isDir) await exec.run("cp", ["-R", path, dest]).catch(() => {});
    else await fs.copy(path, dest).catch(() => {});
    get().invalidate();
  },

  setShowHidden(on) {
    prefs.set("explorerShowHidden", on);
    set({ showHidden: on, cache: {} });
    for (const d of get().expanded) void get().load(d, true);
  },

  async refreshStatus() {
    const { root } = get();
    if (!root) return;
    const r = await exec.run("git", ["status", "--porcelain=v1", "-uall", "-z"], { cwd: root }).catch(() => null);
    if (!r?.ok) { set({ status: {} }); return; }
    const status: Record<string, string> = {};
    const parts = r.stdout.split("\0");
    for (let i = 0; i < parts.length; i++) {
      const line = parts[i];
      if (line.length < 4) continue;
      const code = line.slice(0, 2), path = line.slice(3);
      if (code[0] === "R" || code[0] === "C") i++; // the next field is the old name
      status[path] = code.includes("?") || code.includes("A") ? "created" : code.includes("D") ? "deleted" : "modified";
    }
    set({ status });
  },
}));

/** The tree follows the open project. */
useWorkspace.subscribe((s, prev) => {
  if (s.root !== prev.root && s.root) {
    useExplorer.getState().reset(s.root);
    void useExplorer.getState().refreshStatus();
  }
});
