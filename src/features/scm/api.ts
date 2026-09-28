// Typed wrappers over the source-control backend (src-tauri/src/scm.rs).

import { call } from "../../lib/backend";

export interface Change { path: string; status: "created" | "modified" | "deleted" | string }
export interface GitOut { ok: boolean; status: number; stdout: string; stderr: string; error?: string }
export interface Status {
  is_repo: boolean; branch?: string | null; upstream?: string | null; ahead?: number; behind?: number;
  remote_url?: string | null; branches?: string[]; has_head?: boolean; changes?: Change[]; staged?: string[];
}
export interface Hunk { id: number; header: string; lines: string[]; added: number; removed: number }
export interface FileDiff {
  path: string; status: string; untracked: boolean; header: string[]; hunks: Hunk[]; staged: boolean;
  /** Set when the diff is against a SPAR checkpoint rather than git's HEAD. */
  checkpoint: string | null; added: number; removed: number;
}
export interface Commit { hash: string; short: string; author: string; email: string; date: string; refs: string; subject: string }
export interface Identity { name: string; email: string }
export interface GitHubUser { login: string; name?: string | null; id: number }

export const git = {
  status: (root: string) => call<Status>("scm_status", { root }),
  changes: (root: string) => call<Change[] | null>("scm_changes", { root }),
  versions: (root: string, path: string) => call<{ before: string | null; after: string | null }>("scm_versions", { root, path }),
  run: (root: string, args: string[]) => call<GitOut>("scm_git", { root, args }),
  remote: (root: string, args: string[]) => call<GitOut>("scm_remote", { root, args }),
  init: (root: string) => call<{ ok: boolean; error: string | null }>("scm_init", { root }),
  commit: (root: string, message: string, identity?: Identity) => call<{ ok: boolean; info: string; error: string | null }>("scm_commit", { root, message, identity }),
  initialCommit: (root: string, identity?: Identity) => call<{ ok: boolean; error: string | null }>("scm_initial_commit", { root, identity }),
  stage: (root: string, path: string) => call<GitOut>("scm_stage", { root, path }),
  unstage: (root: string, path: string) => call<GitOut>("scm_unstage", { root, path }),
  discard: (root: string, path: string) => call<GitOut>("scm_discard", { root, path }),
  log: (root: string, limit = 100) => call<Commit[]>("scm_log", { root, limit }),
  show: (root: string, hash: string) => call<string>("scm_show", { root, hash }),
  remotes: (root: string) => call<{ name: string; url: string }[]>("scm_remotes", { root }),
};

export const review = {
  load: (root: string) => call<FileDiff[] | null>("scm_review", { root }),
  since: (root: string, id: string) => call<FileDiff[]>("scm_review_since", { root, id }),
  accept: (root: string, file: FileDiff, hunk?: Hunk) => call<GitOut>("scm_review_accept", { root, file, hunk }),
  reject: (root: string, file: FileDiff, hunk?: Hunk) => call<GitOut>("scm_review_reject", { root, file, hunk }),
};

/** File snapshots in a shadow repository (the Mac app's Checkpoints.swift). */
export const checkpoints = {
  /** Snapshots the work tree; returns the checkpoint id. */
  create: (root: string, label: string) => call<string | null>("checkpoint_create", { root, label }),
  /** Puts every file back as it was at `id` (the current state is snapshotted first: `undo`). */
  restore: (root: string, id: string) => call<{ ok: boolean; undo: string | null; message: string }>("checkpoint_restore", { root, id }),
  changes: (root: string, id: string) => call<Change[]>("checkpoint_changes", { root, id }),
  diff: (root: string, id: string, path: string) => call<string>("checkpoint_diff", { root, id, path }),
  restoreFile: (root: string, id: string, path: string) => call<boolean>("checkpoint_restore_file", { root, id, path }),
  changedFiles: (root: string, id: string) => call<string[]>("checkpoint_changed_files", { root, id }),
  file: (root: string, id: string, path: string) => call<string | null>("checkpoint_file", { root, id, path }),
};

export const githubApi = {
  api: (method: string, path: string, body?: unknown) => call<{ status: number; body: any }>("github_api", { method, path, body }),
  connect: (token: string) => call<GitHubUser>("github_connect", { token }),
  disconnect: () => call<void>("github_disconnect"),
  hasToken: () => call<boolean>("github_has_token"),
  hasCliLogin: () => call<boolean>("github_existing_token"),
  useCliLogin: () => call<GitHubUser>("github_use_existing"),
  loginStart: () => call<void>("github_login_start"),
  loginCancel: () => call<void>("github_login_cancel"),
};

/** "https://github.com/o/r.git" or "git@github.com:o/r.git" → {owner, repo} */
export function parseGitHub(remote: string | null | undefined): { owner: string; repo: string } | null {
  if (!remote) return null;
  const m = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}
