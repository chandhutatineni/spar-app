// The open project's navigation state (the Mac app's Workspace: tabs, sidebar, panels).
// One project per window, so this is a module-level store. Chat and SPAR-loop state live
// in their own stores (state/chat.ts, state/spar.ts) owned by the chat feature.

import { create } from "zustand";
import { basename } from "../lib/api";

export type Doc =
  | { kind: "phase" }          // the selected phase's page
  | { kind: "welcome" }        // what the IDE can do
  | { kind: "preview" }        // the live UI preview
  | { kind: "review" }         // multi-file review of changes
  | { kind: "rules" }          // project rules
  | { kind: "search" }         // search across files
  | { kind: "mcp" }            // MCP servers
  | { kind: "sourceControl" }  // commit, push, pull, GitHub
  | { kind: "trace" }          // traceability: requirement → spec → task → code → test
  | { kind: "impact" }         // AI impact and ROI
  | { kind: "file"; path: string }   // absolute path
  | { kind: "diff"; path: string };  // workspace-relative path

export const docId = (d: Doc) => ("path" in d ? `${d.kind}:${d.path}` : d.kind);
export const sameDoc = (a: Doc, b: Doc) => docId(a) === docId(b);

export type SidebarMode = "work" | "files" | "search" | "git";
export type Overlay = "quickOpen" | "commands" | null;

/** What the editor feature plugs in so tabs can ask about unsaved files. */
export interface EditorHooks {
  isDirty(path: string): boolean;
  save(path: string): Promise<void>;
  discard(path: string): void;
  reveal(path: string, line: number): void;
}

interface WorkspaceStore {
  root: string;
  name: string;
  tabs: Doc[];
  activeTab: Doc;
  /** Line to put the cursor on when a file opens. */
  pendingReveal: Record<string, number>;
  sidebarMode: SidebarMode;
  showTerminal: boolean;
  showAgent: boolean;
  chatExpanded: boolean;
  overlay: Overlay;
  showAgentInfo: boolean;
  showNewDiagram: boolean;
  searchInclude: string;
  /** Bumped when files change on disk (explorer, open editors re-read). */
  fileTreeVersion: number;
  reloadToken: number;
  dirty: Set<string>;
  editor: EditorHooks | null;
  /** Set by the chat feature: whether the agent runs the SPAR loop (shows the loop sidebar). */
  workflowMode: boolean;
  /** Set by the chat feature: files the agent changed (badge on the git navigator). */
  changeCount: number;
  /** Set by the editor: cursor and language of the active editor (status bar). */
  cursor: { line: number; column: number } | null;
  language: string | null;

  setRoot(root: string): void;
  open(doc: Doc): void;
  openFile(path: string, line?: number): void;
  closeTab(doc: Doc): Promise<void>;
  showSidebar(mode: SidebarMode): void;
  toggleTerminal(): void;
  setShowTerminal(v: boolean): void;
  toggleAgent(): void;
  setDirty(path: string, dirty: boolean): void;
  set(partial: Partial<WorkspaceStore>): void;
}

export const useWorkspace = create<WorkspaceStore>((set, get) => ({
  root: "",
  name: "",
  tabs: [{ kind: "phase" }],
  activeTab: { kind: "phase" },
  pendingReveal: {},
  sidebarMode: "work",
  showTerminal: false,
  showAgent: true,
  chatExpanded: false,
  overlay: null,
  showAgentInfo: false,
  showNewDiagram: false,
  searchInclude: "",
  fileTreeVersion: 0,
  reloadToken: 0,
  dirty: new Set(),
  editor: null,
  workflowMode: true,
  changeCount: 0,
  cursor: null,
  language: null,

  setRoot(root) {
    set({ root, name: basename(root), tabs: [{ kind: "phase" }], activeTab: { kind: "phase" }, pendingReveal: {}, dirty: new Set(), sidebarMode: "work" });
  },
  open(doc) {
    const { tabs } = get();
    set({ tabs: tabs.some((t) => sameDoc(t, doc)) ? tabs : [...tabs, doc], activeTab: doc });
  },
  openFile(path, line) {
    if (line != null) set({ pendingReveal: { ...get().pendingReveal, [path]: line } });
    get().open({ kind: "file", path });
    if (line != null) get().editor?.reveal(path, line);
  },
  async closeTab(doc) {
    const { tabs, activeTab, editor } = get();
    const i = tabs.findIndex((t) => sameDoc(t, doc));
    if (i < 0) return;
    if (doc.kind === "file" && editor?.isDirty(doc.path)) {
      const { ask } = await import("../lib/dialogs");
      const choice = await ask(`Save changes to ${basename(doc.path)}?`, "Your changes will be lost if you don't save them.", [
        { label: "Cancel", value: "cancel", kind: "cancel" },
        { label: "Don't Save", value: "discard" },
        { label: "Save", value: "save", kind: "primary" },
      ]);
      if (choice === "save") await editor.save(doc.path);
      else if (choice === "discard") editor.discard(doc.path);
      else return;
    }
    const next = tabs.filter((t) => !sameDoc(t, doc));
    const tabsLeft = next.length ? next : [{ kind: "phase" } as Doc];
    set({ tabs: tabsLeft, activeTab: sameDoc(activeTab, doc) ? tabsLeft[Math.min(i, tabsLeft.length - 1)] : activeTab });
  },
  showSidebar(mode) {
    set({ sidebarMode: mode });
  },
  toggleTerminal() {
    set({ showTerminal: !get().showTerminal });
  },
  setShowTerminal(v) {
    set({ showTerminal: v });
  },
  toggleAgent() {
    set({ showAgent: !get().showAgent });
  },
  setDirty(path, dirty) {
    const d = new Set(get().dirty);
    if (dirty) d.add(path); else d.delete(path);
    set({ dirty: d });
  },
  set(partial) {
    set(partial);
  },
}));
