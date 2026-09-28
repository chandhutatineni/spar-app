// One Monaco editor per window, shared by every file tab (the Mac app's EditorHost).
// Each file keeps its own model, so undo history and unsaved edits survive tab switches.
// The editor's DOM node moves into whichever file tab is showing (MonacoView).

import type * as Monaco from "monaco-editor";
import { basename, fs, relativePath } from "../../lib/api";
import { alert } from "../../lib/dialogs";
import { prefs } from "../../lib/prefs";
import { runCommand } from "../../lib/commands";
import { useWorkspace } from "../../state/workspace";
import { languageFor } from "./language";
import { useInline } from "./inlineEdit";
import { useIntegration } from "./integration";

type M = typeof Monaco;

interface Entry {
  model: Monaco.editor.ITextModel;
  saved: number;
  view: Monaco.editor.ICodeEditorViewState | null;
}

export interface EditorOptions { fontSize: number; wordWrap: boolean; minimap: boolean; autoSave: boolean; formatOnSave: boolean }

export function editorOptions(): EditorOptions {
  return {
    fontSize: prefs.get("editorFontSize", 13),
    wordWrap: prefs.get("editorWordWrap", false),
    minimap: prefs.get("editorMinimap", true),
    autoSave: prefs.get("editorAutoSave", false),
    formatOnSave: prefs.get("editorFormatOnSave", false),
  };
}

function isDark() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

class EditorHost {
  monaco: M | null = null;
  editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  private diffEditor: Monaco.editor.IStandaloneDiffEditor | null = null;
  private diffModels: Monaco.editor.ITextModel[] = [];
  readonly root: HTMLDivElement;
  private editorEl: HTMLDivElement;
  private diffEl: HTMLDivElement;
  private loading: Promise<void> | null = null;
  private models = new Map<string, Entry>();
  private dirty = new Set<string>();
  private refreshing = false;
  private autosave: number | undefined;
  current: string | null = null;
  opts = editorOptions();

  constructor() {
    this.root = document.createElement("div");
    this.root.style.cssText = "position:absolute;inset:0;";
    this.editorEl = document.createElement("div");
    this.editorEl.style.cssText = "position:absolute;inset:0;";
    this.diffEl = document.createElement("div");
    this.diffEl.style.cssText = "position:absolute;inset:0;display:none;";
    this.root.append(this.editorEl, this.diffEl);
  }

  /** Loads Monaco and creates the editor (once). */
  ensure(): Promise<void> {
    return (this.loading ??= (async () => {
      const { monaco } = await import("./monacoSetup");
      this.monaco = monaco;
      const o = this.opts;
      const ed = monaco.editor.create(this.editorEl, {
        automaticLayout: true, fontSize: o.fontSize, lineHeight: Math.round(o.fontSize * 1.55),
        fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
        minimap: { enabled: o.minimap, renderCharacters: false }, scrollBeyondLastLine: false,
        smoothScrolling: true, cursorSmoothCaretAnimation: "on", padding: { top: 10 },
        bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true },
        renderWhitespace: "selection", stickyScroll: { enabled: true }, formatOnPaste: true,
        tabSize: 2, detectIndentation: true, wordWrap: o.wordWrap ? "on" : "off", mouseWheelZoom: true,
        theme: isDark() ? "spar-dark" : "spar-light", model: null,
      });
      this.editor = ed;
      const K = monaco.KeyMod, C = monaco.KeyCode;
      ed.addCommand(K.CtrlCmd | C.KeyS, () => void this.save());
      ed.addCommand(K.CtrlCmd | C.KeyK, () => this.cmdK());
      ed.addCommand(K.CtrlCmd | C.KeyL, () => this.addToChat());
      ed.addCommand(K.CtrlCmd | C.KeyP, () => useWorkspace.getState().set({ overlay: "quickOpen" }));
      ed.addCommand(K.CtrlCmd | K.Shift | C.KeyP, () => useWorkspace.getState().set({ overlay: "commands" }));
      ed.addCommand(K.CtrlCmd | K.Shift | C.KeyF, () => useWorkspace.getState().showSidebar("search"));
      ed.addCommand(K.WinCtrl | C.Backquote, () => runCommand("toggle-terminal"));
      ed.onDidChangeCursorPosition((e) => {
        if (this.current) useWorkspace.getState().set({ cursor: { line: e.position.lineNumber, column: e.position.column } });
      });
      // Follow the app's appearance and the editor settings.
      const theme = () => monaco.editor.setTheme(isDark() ? "spar-dark" : "spar-light");
      new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", theme);
      prefs.subscribe(() => this.applySettings());
    })());
  }

  applySettings() {
    const o = editorOptions();
    const changed = JSON.stringify(o) !== JSON.stringify(this.opts);
    this.opts = o;
    if (!changed || !this.editor) return;
    this.editor.updateOptions({
      fontSize: o.fontSize, lineHeight: Math.round(o.fontSize * 1.55),
      wordWrap: o.wordWrap ? "on" : "off", minimap: { enabled: o.minimap, renderCharacters: false },
    });
  }

  has(path: string) {
    return this.models.has(path);
  }

  isDirty(path: string) {
    return this.dirty.has(path);
  }

  private setDirty(path: string, d: boolean) {
    if (this.dirty.has(path) === d) return;
    if (d) this.dirty.add(path); else this.dirty.delete(path);
    useWorkspace.getState().setDirty(path, d);
  }

  /** Shows a file (creating its model from `text` the first time) and optionally a line. */
  open(path: string, text: string, line?: number | null) {
    const monaco = this.monaco!, ed = this.editor!;
    let e = this.models.get(path);
    if (!e) {
      const uri = monaco.Uri.file(path);
      monaco.editor.getModel(uri)?.dispose();
      const model = monaco.editor.createModel(text, languageFor(path), uri);
      e = { model, saved: model.getAlternativeVersionId(), view: null };
      const entry = e;
      this.models.set(path, entry);
      model.onDidChangeContent(() => {
        if (this.refreshing) return;
        const d = model.getAlternativeVersionId() !== entry.saved;
        this.setDirty(path, d);
        if (d && this.opts.autoSave && this.current === path) {
          clearTimeout(this.autosave);
          this.autosave = window.setTimeout(() => void this.save(path), 1000);
        }
      });
    }
    if (this.current && this.current !== path && ed.getModel()) {
      const prev = this.models.get(this.current);
      if (prev) prev.view = ed.saveViewState();
    }
    ed.setModel(e.model);
    this.current = path;
    if (e.view) ed.restoreViewState(e.view);
    const pos = ed.getPosition();
    useWorkspace.getState().set({ language: e.model.getLanguageId(), cursor: pos ? { line: pos.lineNumber, column: pos.column } : { line: 1, column: 1 } });
    if (line) this.revealLine(line); else ed.focus();
  }

  /** Picks up edits made on disk (by the agent) unless the buffer has unsaved changes. */
  async refresh(path: string) {
    const e = this.models.get(path);
    if (!e || this.dirty.has(path)) return;
    let text: string;
    try { text = await fs.readText(path); } catch { return; }
    if (e.model.isDisposed() || e.model.getAlternativeVersionId() !== e.saved || e.model.getValue() === text) return;
    this.refreshing = true;
    try {
      e.model.pushEditOperations([], [{ range: e.model.getFullModelRange(), text }], () => null);
    } finally {
      this.refreshing = false;
    }
    e.saved = e.model.getAlternativeVersionId();
    this.setDirty(path, false);
  }

  refreshAll() {
    for (const p of this.models.keys()) void this.refresh(p);
  }

  /** Saves a file (the current one by default), formatting first when that's on. */
  async save(path: string | null = this.current) {
    if (!path) return;
    const e = this.models.get(path);
    if (!e) return;
    if (this.opts.formatOnSave && path === this.current && this.editor) {
      const fmt = this.editor.getAction("editor.action.formatDocument");
      if (fmt && fmt.isSupported()) await fmt.run().catch(() => {});
    }
    const version = e.model.getAlternativeVersionId();
    try {
      await fs.writeText(path, e.model.getValue());
      e.saved = version;
      this.setDirty(path, e.model.getAlternativeVersionId() !== version);
    } catch (err) {
      await alert(`Could not save ${basename(path)}`, String(err));
    }
  }

  format() {
    void this.editor?.getAction("editor.action.formatDocument")?.run();
  }

  /** Forgets a file's model (closing its tab, or "Don't Save"). */
  close(path: string) {
    const e = this.models.get(path);
    if (!e) return;
    if (this.current === path) {
      this.editor?.setModel(null);
      this.current = null;
    }
    e.model.dispose();
    this.models.delete(path);
    this.setDirty(path, false);
  }

  closeAll() {
    for (const p of [...this.models.keys()]) this.close(p);
  }

  /** Paths with a model. */
  paths() {
    return [...this.models.keys()];
  }

  revealLine(line: number) {
    const ed = this.editor;
    if (!ed) return;
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column: 1 });
    ed.focus();
  }

  /** Whether the editor is on screen showing this file. */
  showing(path: string) {
    return this.current === path && this.root.isConnected;
  }

  focus() {
    this.editor?.focus();
  }

  /** Remembers where the view was when the tab hides. */
  saveView() {
    if (this.current && this.editor?.getModel()) {
      const e = this.models.get(this.current);
      if (e) e.view = this.editor.saveViewState();
    }
  }

  private selection() {
    const ed = this.editor, m = ed?.getModel(), s = ed?.getSelection();
    if (!ed || !m || !s || !this.current) return null;
    const text = m.getValueInRange({ startLineNumber: s.startLineNumber, startColumn: 1, endLineNumber: s.endLineNumber, endColumn: m.getLineMaxColumn(s.endLineNumber) });
    return { path: this.current, start: s.startLineNumber, end: Math.max(s.startLineNumber, s.endLineNumber), text, full: m.getValue() };
  }

  /** ⌘K: ask for an instruction to edit the selected lines. */
  cmdK() {
    const s = this.selection();
    if (s) useInline.setState({ cmdK: { path: s.path, lines: [s.start, s.end], selection: s.text, full: s.full } });
  }

  /** ⌘L: attach the selected lines to the chat. */
  addToChat() {
    const s = this.selection();
    if (!s) return;
    const attach = useIntegration.getState().attachToChat;
    if (!attach) {
      void alert("The agent chat isn't available", "Open the agent panel and try again.");
      return;
    }
    const root = useWorkspace.getState().root;
    attach({ kind: "selection", path: relativePath(root, s.path), lines: [s.start, s.end], text: s.text });
  }

  showDiff(original: string, modified: string, path: string) {
    const monaco = this.monaco;
    if (!monaco) return;
    this.editorEl.style.display = "none";
    this.diffEl.style.display = "block";
    if (!this.diffEditor) {
      this.diffEditor = monaco.editor.createDiffEditor(this.diffEl, {
        automaticLayout: true, renderSideBySide: false, readOnly: true, fontSize: 13,
        fontFamily: "'SF Mono', Menlo, Consolas, monospace", minimap: { enabled: false },
      });
    }
    const lang = languageFor(path);
    const o = monaco.editor.createModel(original, lang), m = monaco.editor.createModel(modified, lang);
    this.diffEditor.setModel({ original: o, modified: m });
    this.diffModels.forEach((x) => x.dispose());
    this.diffModels = [o, m];
  }

  closeDiff() {
    if (this.diffEl.style.display === "none") return;
    this.diffEl.style.display = "none";
    this.editorEl.style.display = "block";
    this.diffEditor?.setModel(null);
    this.diffModels.forEach((x) => x.dispose());
    this.diffModels = [];
    this.editor?.layout();
  }
}

export const host = new EditorHost();
