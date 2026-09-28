// The integrated terminals (the Mac app's TerminalSession + the terminal parts of
// Workspace): each is a login shell on a real pseudo-terminal, rendered by xterm.js.
//
// An xterm instance lives as long as its shell, not as long as the panel: hiding the panel
// keeps every terminal (and its scrollback) running, like the Mac app.

import { create } from "zustand";
import { Terminal, type ITheme, type ILink } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { app as appApi, basename, fs } from "../../lib/api";
import { prefs } from "../../lib/prefs";
import { useWorkspace } from "../../state/workspace";
import { pty } from "./pty";
import type { DevTask } from "./tasks";

export interface TerminalInfo {
  id: string;
  title: string;
  /** Set when the shell has ended (the tab stays until closed or restarted). */
  exited?: number | null;
}

// ---- Settings (Settings › Terminal; same keys as the Mac app) -----------------------------

export const TERMINAL_DEFAULTS = {
  terminalFontSize: 12.5,
  terminalFontFamily: "",
  terminalShell: "",
  terminalCursorStyle: "block" as "block" | "underline" | "bar",
  terminalCursorBlink: true,
  terminalScrollback: 5000,
};

export function terminalOptions() {
  const d = TERMINAL_DEFAULTS;
  const family = prefs.get("terminalFontFamily", d.terminalFontFamily).replace(/'/g, "").trim() || "SF Mono";
  return {
    fontSize: Number(prefs.get("terminalFontSize", d.terminalFontSize)) || d.terminalFontSize,
    fontFamily: `'${family}', Menlo, Consolas, 'DejaVu Sans Mono', monospace`,
    cursorStyle: prefs.get("terminalCursorStyle", d.terminalCursorStyle),
    cursorBlink: prefs.get("terminalCursorBlink", d.terminalCursorBlink),
    scrollback: Math.max(0, Math.round(Number(prefs.get("terminalScrollback", d.terminalScrollback)) || 0)),
  };
}

export const LIGHT: ITheme = { background: "#FFFFFF", foreground: "#1f2328", cursor: "#1f2328", cursorAccent: "#FFFFFF", selectionBackground: "#b4d5fe" };
export const DARK: ITheme = { background: "#1E1E1E", foreground: "#d4d4d4", cursor: "#d4d4d4", cursorAccent: "#1E1E1E", selectionBackground: "#264f78" };

/** Whether the app currently shows dark (the appearance preference, else the system). */
export function isDark() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

// ---- Sessions -------------------------------------------------------------------------------

class Session {
  readonly term: Terminal;
  readonly fit = new FitAddon();
  /** The element xterm renders into; moved between panel mounts. */
  readonly host: HTMLDivElement;
  opened = false;
  ready: Promise<void>;
  alive = false;
  /** The backend pseudo-terminal's id: new for every (re)start, so a late exit of the old
   *  shell never marks the new one as ended. */
  ptyId = "";
  private lastSize = "";

  constructor(readonly id: string, readonly cwd: string) {
    this.term = new Terminal({ ...terminalOptions(), allowTransparency: false, theme: isDark() ? DARK : LIGHT, allowProposedApi: true, macOptionIsMeta: false });
    this.term.loadAddon(this.fit);
    this.host = document.createElement("div");
    this.host.className = "spar-term-host";
    this.host.style.cssText = "position:absolute;inset:6px 0 0 10px;";
    this.term.onData((d) => this.send(d));
    this.term.onBinary((d) => this.send(d));
    this.term.attachCustomKeyEventHandler((e) => {
      // ⌘K clears the terminal (as in Terminal.app); let the app's menu shortcuts through.
      if (e.type === "keydown" && e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "k") {
        clearTerminal(this.id);
        return false;
      }
      return true;
    });
    this.term.registerLinkProvider(linkProvider(this));
    this.ready = this.spawn();
  }

  private pending = "";
  private flushing = false;

  /** Input to the shell, in order: writes are queued and batched, since backend calls
   *  (and bridge requests) may otherwise overtake each other. */
  send(data: string): Promise<void> {
    if (!this.alive) return Promise.resolve();
    this.pending += data;
    if (!this.flushing) this.flushed = this.flush();
    return this.flushed;
  }
  private flushed: Promise<void> = Promise.resolve();
  private async flush() {
    this.flushing = true;
    try {
      while (this.pending && this.alive) {
        const chunk = this.pending;
        this.pending = "";
        await pty.write(this.ptyId, chunk).catch(() => {});
      }
    } finally {
      this.pending = "";
      this.flushing = false;
    }
  }

  spawn(): Promise<void> {
    const shell = prefs.get("terminalShell", "").trim() || undefined;
    if (this.ptyId) byPty.delete(this.ptyId);
    this.ptyId = `${this.id}.${++spawnCount}`;
    byPty.set(this.ptyId, this);
    return pty.open({ id: this.ptyId, cwd: this.cwd, shell, cols: this.term.cols || 100, rows: this.term.rows || 24 })
      .then(() => {
        this.alive = true;
        this.lastSize = "";
        this.resize();
      })
      .catch((e) => {
        this.term.writeln(`\x1b[31mCould not start the shell: ${String(e?.message ?? e)}\x1b[0m`);
      });
  }

  /** Puts xterm into a panel container (opening it the first time). */
  attach(container: HTMLElement) {
    if (this.host.parentElement !== container) container.appendChild(this.host);
    if (!this.opened) {
      this.term.open(this.host);
      this.opened = true;
    }
    this.resize();
  }

  resize() {
    if (!this.opened || !this.host.isConnected || this.host.clientWidth === 0 || this.host.clientHeight === 0) return;
    try { this.fit.fit(); } catch { return; }
    const size = `${this.term.cols}x${this.term.rows}`;
    if (size !== this.lastSize && this.alive) {
      this.lastSize = size;
      pty.resize(this.ptyId, this.term.cols, this.term.rows).catch(() => {});
    }
  }

  applySettings() {
    const o = terminalOptions();
    this.term.options.fontSize = o.fontSize;
    this.term.options.fontFamily = o.fontFamily;
    this.term.options.cursorStyle = o.cursorStyle;
    this.term.options.cursorBlink = o.cursorBlink;
    this.term.options.scrollback = o.scrollback;
    this.resize();
  }

  setTheme(dark: boolean) {
    this.term.options.theme = dark ? DARK : LIGHT;
  }

  stop() {
    this.alive = false;
    byPty.delete(this.ptyId);
    pty.close(this.ptyId).catch(() => {});
  }

  dispose() {
    this.stop();
    this.term.dispose();
    this.host.remove();
  }
}

const sessions = new Map<string, Session>();
const byPty = new Map<string, Session>();
let spawnCount = 0;
export const sessionFor = (id: string) => sessions.get(id);

// One listener for every terminal's output.
pty.onData(({ id, data }) => byPty.get(id)?.term.write(data));
pty.onExit(({ id, code }) => {
  const s = byPty.get(id);
  if (!s || !s.alive) return;
  s.alive = false;
  s.term.write(`\r\n\x1b[2m[Process exited${code ? ` with code ${code}` : ""}]\x1b[0m\r\n`);
  useTerminals.setState((st) => ({ terminals: st.terminals.map((t) => (t.id === s.id ? { ...t, exited: code } : t)) }));
});

// Settings changed (here or in the Settings window): apply to every terminal.
prefs.subscribe(() => sessions.forEach((s) => s.applySettings()));

// Hang up this window's shells when the page goes away (a reload in the dev browser).
window.addEventListener("beforeunload", () => sessions.forEach((s) => s.stop()));

// ---- Links: URLs open in the browser, file:line opens the file at that line ------------------

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+/g;
const FILE_RE = /(?:^|[\s("'`[])((?:\.{0,2}\/)?(?:[\w.@~-]+\/)*[\w.@-]+\.[A-Za-z0-9]{1,8})(?::(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))?\))?/g;

function resolveFile(cwd: string, p: string) {
  if (p.startsWith("/")) return p;
  if (p.startsWith("~/")) return p; // resolved by the shell only; skipped below
  return `${cwd}/${p.replace(/^\.\//, "")}`;
}

function linkProvider(s: Session) {
  return {
    provideLinks(y: number, cb: (links: ILink[] | undefined) => void) {
      const line = s.term.buffer.active.getLine(y - 1);
      if (!line) return cb(undefined);
      const text = line.translateToString(true);
      const links: ILink[] = [];
      const taken: [number, number][] = [];
      for (const m of text.matchAll(URL_RE)) {
        const url = m[0].replace(/[.,;:!?]+$/, "");
        const start = m.index!;
        taken.push([start, start + url.length]);
        links.push({
          range: { start: { x: start + 1, y }, end: { x: start + url.length, y } },
          text: url,
          decorations: { underline: true, pointerCursor: true },
          activate: () => { appApi.open(url).catch(() => {}); },
        });
      }
      for (const m of text.matchAll(FILE_RE)) {
        const file = m[1];
        const full = m[0].slice(m[0].indexOf(file));
        const start = m.index! + m[0].indexOf(file);
        const end = start + full.length;
        if (taken.some(([a, b]) => start < b && end > a) || file.startsWith("~/") || /^\d+(\.\d+)+$/.test(file)) continue;
        const lineNo = Number(m[2] ?? m[4]) || undefined;
        links.push({
          range: { start: { x: start + 1, y }, end: { x: end, y } },
          text: full,
          decorations: { underline: true, pointerCursor: true },
          activate: async () => {
            const path = resolveFile(s.cwd, file);
            const st = await fs.stat(path).catch(() => null);
            if (st && !st.is_dir) useWorkspace.getState().openFile(path, lineNo);
            else if (st?.is_dir) appApi.reveal(path).catch(() => {});
          },
        });
      }
      cb(links.length ? links : undefined);
    },
  };
}

// ---- Store (the Mac app's Workspace.terminals / activeTerminal) --------------------------------

interface TerminalStore {
  terminals: TerminalInfo[];
  active: string | null;
}

export const useTerminals = create<TerminalStore>(() => ({ terminals: [], active: null }));

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

function defaultShellName() {
  const configured = prefs.get("terminalShell", "").trim();
  if (configured) return basename(configured);
  return navigator.platform.toLowerCase().includes("win") ? "bash" : "zsh";
}

/** The shell's name for new tabs ($SHELL is only known to the backend). */
let shellName: string | null = null;
appApi.info().then((i) => { shellName = i.env.SHELL ? basename(i.env.SHELL) : null; }).catch(() => {});

export function activeId(): string | null {
  const { terminals, active } = useTerminals.getState();
  return terminals.find((t) => t.id === active)?.id ?? terminals[0]?.id ?? null;
}

export function newTerminal(title?: string): string {
  const root = useWorkspace.getState().root;
  const id = uuid();
  const name = prefs.get("terminalShell", "").trim() ? defaultShellName() : shellName ?? defaultShellName();
  const n = useTerminals.getState().terminals.length + 1;
  sessions.set(id, new Session(id, root));
  useTerminals.setState((s) => ({ terminals: [...s.terminals, { id, title: title ?? `${name} ${n}` }], active: id }));
  useWorkspace.getState().setShowTerminal(true);
  focusTerminal(id);
  return id;
}

export function closeTerminal(id: string) {
  const s = sessions.get(id);
  s?.dispose();
  sessions.delete(id);
  const { terminals, active } = useTerminals.getState();
  const left = terminals.filter((t) => t.id !== id);
  useTerminals.setState({ terminals: left, active: active === id ? left[left.length - 1]?.id ?? null : active });
  if (!left.length) useWorkspace.getState().setShowTerminal(false);
}

export function closeAllTerminals() {
  sessions.forEach((s) => s.dispose());
  sessions.clear();
  useTerminals.setState({ terminals: [], active: null });
}

export function selectTerminal(id: string) {
  useTerminals.setState({ active: id });
  focusTerminal(id);
}

export function focusTerminal(id = activeId()) {
  // After the panel has rendered (and attached the terminal).
  if (id) requestAnimationFrame(() => requestAnimationFrame(() => sessions.get(id)?.term.focus()));
}

export function renameTerminal(id: string, title: string) {
  const t = title.trim();
  if (!t) return;
  useTerminals.setState((s) => ({ terminals: s.terminals.map((x) => (x.id === id ? { ...x, title: t } : x)) }));
}

export function clearTerminal(id = activeId()) {
  const s = id ? sessions.get(id) : undefined;
  if (!s) return;
  s.term.clear();
  // Also ask the shell to redraw its prompt at the top.
  s.send("\x0c");
}

/** Restart this shell (the ↻ button). */
export function restartTerminal(id = activeId()) {
  const s = id ? sessions.get(id) : undefined;
  if (!s) return;
  s.stop();
  s.term.reset();
  useTerminals.setState((st) => ({ terminals: st.terminals.map((t) => (t.id === s.id ? { ...t, exited: undefined } : t)) }));
  s.ready = s.spawn();
}

/** Types into the shell without Return. */
export async function sendRaw(id: string, text: string) {
  const s = sessions.get(id);
  if (!s) return;
  await s.ready;
  await s.send(text);
}

/** Runs a shell command in the integrated terminal. With a title, it runs in the terminal of
 *  that name (a task keeps its own terminal). */
export function runInTerminal(command: string, title?: string) {
  let id: string;
  if (title) id = useTerminals.getState().terminals.find((t) => t.title === title)?.id ?? newTerminal(title);
  else id = activeId() ?? newTerminal();
  const s = sessions.get(id);
  if (s && !s.alive && useTerminals.getState().terminals.find((t) => t.id === id)?.exited !== undefined) restartTerminal(id);
  useTerminals.setState({ active: id });
  useWorkspace.getState().setShowTerminal(true);
  sendRaw(id, command + "\r");
}

export const runTask = (t: DevTask) => runInTerminal(t.command, t.name);

/** Ctrl-C in the active terminal, stopping whatever runs in the foreground. */
export function interruptTerminal() {
  const id = activeId();
  if (id) sendRaw(id, "\x03");
}

/** Show/hide the panel; showing it with no terminals starts one. */
export function toggleTerminal() {
  const ws = useWorkspace.getState();
  const show = !ws.showTerminal;
  ws.setShowTerminal(show);
  if (show && !useTerminals.getState().terminals.length) newTerminal();
}

export function applyThemeToAll(dark: boolean) {
  sessions.forEach((s) => s.setTheme(dark));
}
