// Typed wrappers over the backend commands the foundation provides. Feature modules add
// their own wrappers next to their code (e.g. features/terminal/pty.ts).

import { call, inTauri } from "./backend";

export interface FileEntry { name: string; path: string; is_dir: boolean; size: number; mtime: number }
export interface ExecResult { status: number; stdout: string; stderr: string; ok: boolean }
export interface ExecOptions { cwd?: string; env?: Record<string, string>; input?: string; timeoutMs?: number }
export interface AppInfo { platform: "macos" | "windows" | "linux"; home: string; data_dir: string; resource_dir: string; version: string; bridge: boolean; env: Record<string, string> }

export const fs = {
  readText: (path: string) => call<string>("fs_read_text", { path }),
  readBase64: (path: string) => call<string>("fs_read_base64", { path }),
  writeText: (path: string, text: string) => call<void>("fs_write_text", { path, text }),
  writeBase64: (path: string, data: string) => call<void>("fs_write_base64", { path, data }),
  list: (path: string) => call<FileEntry[]>("fs_list", { path }),
  stat: (path: string) => call<FileEntry | null>("fs_stat", { path }),
  exists: (path: string) => call<boolean>("fs_exists", { path }),
  mkdir: (path: string) => call<void>("fs_mkdir", { path }),
  remove: (path: string) => call<void>("fs_remove", { path }),
  rename: (from: string, to: string) => call<void>("fs_rename", { from, to }),
  copy: (from: string, to: string) => call<void>("fs_copy", { from, to }),
  /** Project-relative paths, skipping build/vendor folders (and dotfiles unless hidden). */
  walk: (root: string, limit?: number, hidden = false) => call<string[]>("fs_walk", { root, limit, hidden }),
  /** Emits `fs:change` {root, paths} for changes under root. */
  watch: (path: string) => call<void>("fs_watch", { path }),
  unwatch: (path: string) => call<void>("fs_unwatch", { path }),
};

export const exec = {
  /** Runs a tool to completion with the login-shell PATH and the app's env (GitHub token…). */
  run: (program: string, args: string[] = [], o: ExecOptions = {}) =>
    call<ExecResult>("exec_run", { program, args, cwd: o.cwd, env: o.env, input: o.input, timeout_ms: o.timeoutMs }),
  which: (name: string) => call<string | null>("exec_which", { name }),
  /** Background process; output via `proc:output` {id, stream, data}, end via `proc:exit` {id, status}. */
  spawn: (id: string, program: string, args: string[] = [], o: { cwd?: string; env?: Record<string, string> } = {}) =>
    call<void>("exec_spawn", { id, program, args, cwd: o.cwd, env: o.env }),
  kill: (id: string) => call<void>("exec_kill", { id }),
};

export const secrets = {
  get: (key: string) => call<string | null>("secrets_get", { key }),
  set: (key: string, value: string | null) => call<void>("secrets_set", { key, value }),
  /** Only for the app's own gate/decision calls; never give it to an agent. */
  humanEnv: () => call<Record<string, string>>("human_token_env"),
};

let info: Promise<AppInfo> | undefined;
export const app = {
  info: () => (info ??= call<AppInfo>("app_info")),
  open: (target: string) => call<void>("app_open", { target }),
  reveal: (target: string) => call<void>("app_reveal", { target }),
  newWindow: (project?: string) => call<void>("app_new_window", { project }),
  settings: () => call<void>("app_settings"),
  setRecents: (paths: string[]) => call<void>("app_set_recents", { paths }).catch(() => {}),
  runInTerminal: (command: string) => call<void>("app_run_in_terminal", { command }),
  quit: () => call<void>("app_quit"),
};

/** The SPAR CLI in a project. `human` adds the token for the app's own decision calls. */
export async function spar(root: string, args: string[], o: { human?: boolean; input?: string; timeoutMs?: number } = {}) {
  const env = o.human ? await secrets.humanEnv() : undefined;
  return exec.run("spar", args, { cwd: root, env, input: o.input, timeoutMs: o.timeoutMs });
}

/** Folder picker (native dialog in the app, a prompt in the dev browser). */
export async function pickFolder(title = "Choose a project folder"): Promise<string | null> {
  if (inTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ directory: true, multiple: false, title });
    return typeof r === "string" ? r : null;
  }
  return window.prompt(title + " (path)");
}

export async function pickFiles(title = "Attach files"): Promise<string[]> {
  if (inTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ directory: false, multiple: true, title });
    return Array.isArray(r) ? r : r ? [r] : [];
  }
  const p = window.prompt(title + " (paths, comma-separated)");
  return p ? p.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export async function saveDialog(defaultPath: string, filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (inTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return (await save({ defaultPath, filters })) ?? null;
  }
  return window.prompt("Save as (path)", defaultPath);
}

export const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
export const dirname = (p: string) => p.replace(/[\\/][^\\/]*$/, "") || "/";
export const joinPath = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");
export const relativePath = (root: string, p: string) => (p.startsWith(root + "/") ? p.slice(root.length + 1) : p);
