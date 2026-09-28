// The Mac app's PreviewController (Backend/Preview.swift): finds and runs the project's UI
// so the Develop phase can show it live — a dev server from package.json, or a static
// index.html served locally.

import { create } from "zustand";
import { exec, fs } from "../../lib/api";
import { listen } from "../../lib/backend";
import { previewServe } from "./pty";

export type PreviewSource =
  | { kind: "none" }
  | { kind: "staticPage"; page: string }
  | { kind: "devServer"; command: string[]; cwd: string; needsInstall: boolean };

export type PreviewState = "idle" | "installing" | "starting" | "running" | { failed: string };

export const sourceLabel = (s: PreviewSource) =>
  s.kind === "staticPage" ? s.page.split("/").pop() ?? "" : s.kind === "devServer" ? s.command.join(" ") : "";

const sameSource = (a: PreviewSource, b: PreviewSource) => JSON.stringify(a) === JSON.stringify(b);

const WEB_DIRS = ["", "web", "frontend", "app", "client", "ui", "site"];
const STATIC_DIRS = ["", "public", "src", "web", "site", "docs", "app", "dist"];

export interface PreviewProbe {
  read(rel: string): Promise<string | null>;
  exists(rel: string): Promise<boolean>;
  has(tool: string): Promise<boolean>;
}

export async function detectPreview(root: string, p: PreviewProbe): Promise<PreviewSource> {
  for (const dir of WEB_DIRS) {
    const rel = (f: string) => (dir ? `${dir}/${f}` : f);
    const text = await p.read(rel("package.json"));
    if (text == null) continue;
    let scripts: Record<string, unknown> | undefined;
    try { scripts = JSON.parse(text)?.scripts; } catch { continue; }
    if (!scripts || typeof scripts !== "object") continue;
    const script = ["dev", "start", "serve", "preview"].find((s) => typeof scripts![s] === "string");
    if (!script) continue;
    let manager = "npm";
    if ((await p.exists(rel("pnpm-lock.yaml"))) && (await p.has("pnpm"))) manager = "pnpm";
    else if ((await p.exists(rel("yarn.lock"))) && (await p.has("yarn"))) manager = "yarn";
    else if ((await p.exists(rel("bun.lockb"))) && (await p.has("bun"))) manager = "bun";
    const needsInstall = !(await p.exists(rel("node_modules")));
    return { kind: "devServer", command: [manager, "run", script], cwd: dir ? `${root}/${dir}` : root, needsInstall };
  }
  for (const dir of STATIC_DIRS) {
    const rel = dir ? `${dir}/index.html` : "index.html";
    if (await p.exists(rel)) return { kind: "staticPage", page: `${root}/${rel}` };
  }
  return { kind: "none" };
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const URL_PATTERN = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s]*/;

/** The local URL a dev server prints ("Local: http://localhost:5173/"), if any. */
export function findLocalURL(text: string): string | null {
  const m = text.replace(ANSI, "").match(URL_PATTERN);
  if (!m) return null;
  return m[0].replace("0.0.0.0", "localhost").replace(/^[.,)]+|[.,)]+$/g, "");
}

interface PreviewStore {
  root: string;
  source: PreviewSource;
  state: PreviewState;
  url: string | null;
  reloadToken: number;
  errors: string[];
  log: string[];
}

export const usePreview = create<PreviewStore>(() => ({ root: "", source: { kind: "none" }, state: "idle", url: null, reloadToken: 0, errors: [], log: [] }));

const get = () => usePreview.getState();
const set = (p: Partial<PreviewStore>) => usePreview.setState(p);

export const previewAvailable = () => get().source.kind !== "none";
export const previewIsServer = () => get().source.kind === "devServer";
export const isFailed = (s: PreviewState): s is { failed: string } => typeof s === "object";

let procId: string | null = null;
let generation = 0;
let startTimer: ReturnType<typeof setTimeout> | undefined;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;

function append(text: string) {
  const lines = text.replace(ANSI, "").split(/\r?\n|\r/).filter((l) => l.length);
  if (!lines.length) return;
  const log = [...get().log, ...lines];
  set({ log: log.length > 400 ? log.slice(log.length - 400) : log });
}

function consume(text: string) {
  append(text);
  const { state, url } = get();
  if (!(state === "starting" || url == null)) return;
  const found = findLocalURL(text);
  if (found) set({ url: found, state: "running", reloadToken: get().reloadToken + 1 });
}

listen<{ id: string; stream: string; data: string }>("proc:output", (p) => { if (p.id === procId) consume(p.data); });
listen<{ id: string; status: number | null }>("proc:exit", (p) => {
  if (p.id !== procId) return;
  procId = null;
  if (get().state !== "idle") set({ state: { failed: `The dev server exited (code ${p.status ?? -1}).` } });
});

export const preview = {
  /** Resets for a project (or clears with ""). */
  async open(root: string) {
    preview.stop();
    set({ root, source: { kind: "none" }, state: "idle", url: null, errors: [], log: [] });
    if (root) await preview.detect();
  },

  async detect() {
    const root = get().root;
    if (!root) return;
    const found = await detectPreview(root, {
      read: (rel) => fs.readText(`${root}/${rel}`).catch(() => null),
      exists: (rel) => fs.exists(`${root}/${rel}`).catch(() => false),
      has: (tool) => exec.which(tool).then((w) => !!w).catch(() => false),
    });
    if (root !== get().root || sameSource(found, get().source)) return;
    set({ source: found });
    if (found.kind === "staticPage") {
      const { url } = await previewServe(root).catch(() => ({ url: "" }));
      if (!url) { set({ state: { failed: "Could not serve the page." } }); return; }
      const rel = found.page.slice(root.length + 1).split("/").map(encodeURIComponent).join("/");
      set({ url: url + rel, state: "running" });
    } else if (found.kind === "none") {
      set({ url: null, state: "idle" });
    }
  },

  /** A URL the person's browser can open (the file itself for static pages). */
  browserURL(): string | null {
    const { source, url } = get();
    if (source.kind === "staticPage") return source.page;
    return url;
  },

  async start() {
    const source = get().source;
    if (source.kind !== "devServer") { preview.reload(); return; }
    preview.stop();
    const gen = ++generation;
    set({ errors: [], log: [] });
    const { command, cwd } = source;
    if (source.needsInstall) {
      set({ state: "installing" });
      const r = await exec.run(command[0], ["install"], { cwd });
      if (gen !== generation) return;
      append(r.stdout + r.stderr);
      if (!r.ok) { set({ state: { failed: "Installing dependencies failed." } }); return; }
      set({ source: { ...source, needsInstall: false } });
    }
    set({ state: "starting" });
    if (!(await exec.which(command[0]).catch(() => null))) {
      set({ state: { failed: `${command[0]} is not installed.` } });
      return;
    }
    if (gen !== generation) return;
    const id = `preview:${Date.now()}`;
    procId = id;
    try {
      // CRA, Vite and friends: don't open a browser tab; plain output for URL detection.
      await exec.spawn(id, command[0], command.slice(1), { cwd, env: { BROWSER: "none", FORCE_COLOR: "0", NO_COLOR: "1" } });
    } catch (e) {
      procId = null;
      set({ state: { failed: String((e as Error)?.message ?? e) } });
      return;
    }
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      if (gen === generation && get().state === "starting") set({ state: { failed: "No local URL appeared in the dev server's output." } });
    }, 90_000);
  },

  stop() {
    generation++;
    clearTimeout(startTimer);
    if (procId) exec.kill(procId).catch(() => {});
    procId = null;
    if (previewIsServer()) set({ state: "idle", url: null });
  },

  reload() {
    set({ errors: [], reloadToken: get().reloadToken + 1 });
  },

  /** Files changed: dev servers hot-reload by themselves; a static page is reloaded after
   *  the edits settle. */
  filesChanged() {
    preview.detect();
    if (get().source.kind !== "staticPage") return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => preview.reload(), 600);
  },

  report(error: string) {
    const { errors } = get();
    if (errors.length >= 50 || errors.includes(error)) return;
    set({ errors: [...errors, error] });
  },

  clearErrors() { set({ errors: [] }); },

  logTail: () => get().log.slice(-40).join("\n"),
};
