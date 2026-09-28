// Git state for the status bar, the git sidebar and the Source Control page, and the
// operations behind them (the Mac app's SourceControl.swift, the review half of
// Composer.swift and Workspace.refreshChanges). One project per window: a module store.

import { create } from "zustand";
import { useApp, onProjectOpen, onProjectClose, onFilesChanged } from "../../state/app";
import { useWorkspace } from "../../state/workspace";
import { engine } from "../../engine/client";
import { git, review as reviewApi, checkpoints, githubApi, parseGitHub, type Change, type FileDiff, type Hunk } from "./api";
import { githubUser, identity } from "./github";
import * as peers from "./peers";

interface ScmStore {
  root: string;
  /** null until the first refresh. */
  isRepo: boolean | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  remoteUrl: string | null;
  branches: string[];
  hasHead: boolean;
  changes: Change[];
  staged: Set<string>;
  busy: string | null;
  lastError: string | null;
  lastInfo: string | null;
  /** The multi-file review; null until loaded. */
  review: FileDiff[] | null;
  /** A checkpoint that undoes the last restore / "reject all". */
  restoredUndo: string | null;
}

const initial = (root = ""): ScmStore => ({
  root, isRepo: null, branch: null, upstream: null, ahead: 0, behind: 0, remoteUrl: null, branches: [], hasHead: false,
  changes: [], staged: new Set(), busy: null, lastError: null, lastInfo: null, review: null, restoredUndo: null,
});

export const useScm = create<ScmStore>(() => initial());

const st = () => useScm.getState();
const set = (p: Partial<ScmStore>) => useScm.setState(p);
const rootOf = () => st().root || useApp.getState().project || "";

export const github = () => parseGitHub(st().remoteUrl);

// ---- Refresh ---------------------------------------------------------------------------

let refreshSeq = 0;

/** Re-reads branch, sync state and the change list. */
export async function refresh() {
  const root = rootOf();
  if (!root) return;
  const seq = ++refreshSeq;
  // A failed call (the backend restarting) says nothing about the repository: keep what we know.
  const s = await git.status(root).catch(() => null);
  if (!s || seq !== refreshSeq || root !== rootOf()) return;
  if (!s.is_repo) {
    set({ isRepo: false, branch: null, upstream: null, ahead: 0, behind: 0, remoteUrl: null, branches: [], staged: new Set() });
    // No repository: the agent session's own change list.
    const id = peers.sessionId();
    const list = id ? await engine.changes(id).catch(() => null) : null;
    set({ changes: list ?? [] });
  } else {
    set({
      isRepo: true, branch: s.branch ?? null, upstream: s.upstream ?? null, ahead: s.ahead ?? 0, behind: s.behind ?? 0,
      remoteUrl: s.remote_url ?? null, branches: s.branches ?? [], hasHead: !!s.has_head,
      changes: s.changes ?? [], staged: new Set(s.staged ?? []),
    });
  }
  useWorkspace.getState().set({ changeCount: st().changes.length });
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Debounced refresh after file changes (350 ms, like the Mac app). */
export function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    refresh();
    if (st().review !== null) loadReview();
  }, 350);
}

/** After files changed under us (discard, reject, restore): reload editors and the review. */
export function refreshAfterFileChange() {
  useWorkspace.setState((w) => ({ reloadToken: w.reloadToken + 1, fileTreeVersion: w.fileTreeVersion + 1 }));
  refresh();
  if (st().review !== null) loadReview();
}

let unFiles: (() => void) | null = null;
function attach(root: string) {
  useScm.setState(initial(root));
  unFiles?.();
  unFiles = onFilesChanged(() => scheduleRefresh());
  peers.ready().then(() => refresh());
}
onProjectOpen(attach);
onProjectClose(() => { unFiles?.(); unFiles = null; useScm.setState(initial()); });
if (useApp.getState().project) attach(useApp.getState().project!);
window.addEventListener("focus", () => { if (rootOf()) refresh(); });

// ---- Operations (SourceControl.swift) ---------------------------------------------------

async function perform(label: string, work: () => Promise<string | null>) {
  set({ busy: label, lastError: null, lastInfo: null });
  let error: string | null;
  try { error = await work(); } catch (e) { error = String(e instanceof Error ? e.message : e); }
  set({ busy: null, lastError: error });
  await refresh();
}

export const initialize = () => perform("Creating repository", async () => {
  const r = await git.init(rootOf());
  return r.ok ? null : r.error;
});

/** Commits staged changes, or everything when nothing is staged. */
export async function commit(message: string): Promise<boolean> {
  let ok = false;
  await perform("Committing", async () => {
    const r = await git.commit(rootOf(), message, identity() ?? undefined);
    ok = r.ok;
    if (ok) set({ lastInfo: r.info });
    return r.ok ? null : r.error;
  });
  return ok;
}

export const switchBranch = (name: string) => perform("Switching branch", async () => {
  const r = await git.run(rootOf(), ["switch", name]);
  return r.ok ? null : r.stderr.trim();
});

export const createBranch = (name: string) => perform("Creating branch", async () => {
  const r = await git.run(rootOf(), ["switch", "-c", name]);
  return r.ok ? null : r.stderr.trim();
});

export const push = () => perform("Pushing", async () => {
  const { upstream, branch } = st();
  const r = await git.remote(rootOf(), upstream == null ? ["push", "-u", "origin", "HEAD"] : ["push"]);
  const gh = github();
  if (r.ok) set({ lastInfo: `Pushed ${branch ?? "branch"} to ${gh ? `${gh.owner}/${gh.repo}` : "origin"}.` });
  return r.ok ? null : r.error ?? r.stderr;
});

export const pull = () => perform("Pulling", async () => {
  const r = await git.remote(rootOf(), ["pull", "--ff-only"]);
  if (r.ok) set({ lastInfo: `Up to date with ${st().upstream ?? "origin"}.` });
  return r.ok ? null : r.error ?? r.stderr;
});

/** Sync: pull, then push (the status bar's button). */
export async function sync() {
  await pull();
  if (!st().lastError) await push();
}

function ghMessage(body: any, status: number) {
  let text: string = body?.message ?? `HTTP ${status}`;
  const first = body?.errors?.[0]?.message;
  if (first) text += `: ${first}`;
  return text;
}

/** Organizations the signed-in account belongs to (needs the read:org scope for private memberships). */
export async function organizations(): Promise<string[]> {
  const r = await githubApi.api("GET", "/user/orgs?per_page=100").catch(() => null);
  return r?.status === 200 && Array.isArray(r.body) ? r.body.map((o: any) => String(o.login)).filter(Boolean) : [];
}

/** Creates a GitHub repository for this project (under `org`, or the account when null), adds it as origin and pushes. */
export async function publish(name: string, isPrivate: boolean, description: string, org: string | null = null): Promise<string | null> {
  let url: string | null = null;
  await perform("Publishing to GitHub", async () => {
    const root = rootOf();
    const first = await git.initialCommit(root, identity() ?? undefined);
    if (!first.ok) return first.error;
    const path = org ? `/orgs/${encodeURIComponent(org)}/repos` : "/user/repos";
    const r = await githubApi.api("POST", path, { name, private: isPrivate, description, auto_init: false });
    const j = r.body;
    if (r.status !== 201 || !j?.full_name || !j?.clone_url || !j?.html_url) {
      const hint = org && (r.status === 403 || r.status === 404)
        ? ` Check that ${org} lets members create repositories and, if it uses SSO, that your token is authorized for it.`
        : "";
      return `GitHub could not create the repository: ${ghMessage(j, r.status)}.${hint}`;
    }
    await git.run(root, ["remote", "remove", "origin"]);
    await git.run(root, ["remote", "add", "origin", j.clone_url]);
    set({ remoteUrl: j.clone_url });
    const out = await git.remote(root, ["push", "-u", "origin", "HEAD"]);
    if (!out.ok) return out.error ?? out.stderr;
    set({ lastInfo: `Published to ${j.full_name}.` });
    url = j.html_url;
    return null;
  });
  return url;
}

export async function defaultBranch(): Promise<string> {
  const gh = github();
  if (gh) {
    const r = await githubApi.api("GET", `/repos/${gh.owner}/${gh.repo}`).catch(() => null);
    if (r?.status === 200 && r.body?.default_branch) return r.body.default_branch;
  }
  return "main";
}

export async function createPullRequest(title: string, body: string, base: string): Promise<string | null> {
  const gh = github();
  const head = st().branch;
  if (!gh || !head) return null;
  let url: string | null = null;
  await perform("Opening pull request", async () => {
    const { upstream, ahead } = st();
    if (upstream == null || ahead > 0) {
      const out = await git.remote(rootOf(), upstream == null ? ["push", "-u", "origin", "HEAD"] : ["push"]);
      if (!out.ok) return out.error ?? out.stderr;
    }
    const r = await githubApi.api("POST", `/repos/${gh.owner}/${gh.repo}/pulls`, { title, head, base, body });
    if (r.status !== 201 || !r.body?.html_url) return `GitHub could not open the pull request: ${ghMessage(r.body, r.status)}`;
    set({ lastInfo: "Pull request opened." });
    url = r.body.html_url;
    return null;
  });
  return url;
}

// ---- Per-file (GitSidebar.swift) ----------------------------------------------------------

export async function toggleStage(path: string) {
  const root = rootOf();
  if (st().staged.has(path)) await git.unstage(root, path); else await git.stage(root, path);
  await refresh();
}

export async function discard(path: string) {
  const r = await git.discard(rootOf(), path).catch((e) => ({ ok: false, stderr: String(e) }) as any);
  if (!r.ok) set({ lastError: (r.stderr || "Could not discard the changes.").trim() });
  refreshAfterFileChange();
}

/** The Mac app's suggested commit message. */
export function suggestedMessage(style: "sidebar" | "page" = "sidebar"): string {
  const f = peers.feature();
  const files = st().changes.map((c) => c.path.split("/").pop()!);
  if (f) {
    if (style === "sidebar") return `feat: ${peers.featureTitle(f).toLowerCase()}`;
    const phase = String(peers.currentPhase() ?? "");
    return `${phase === "develop" || phase === "build" ? "feat" : "docs"}: ${peers.featureTitle(f).toLowerCase()}`;
  }
  if (style === "sidebar") return `Update ${files.slice(0, 3).join(", ")}`;
  return `Update ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}`;
}

// ---- Review (Composer.swift) -------------------------------------------------------------

export function openReview() {
  useWorkspace.getState().open({ kind: "review" });
  loadReview();
}

export async function loadReview() {
  const root = rootOf();
  if (!root) return;
  await peers.ready();
  const fromGit = await reviewApi.load(root).catch(() => null);
  const since = peers.lastTurnStart();
  if (fromGit && (fromGit.length > 0 || !since)) set({ review: fromGit });
  else if (since) set({ review: await reviewApi.since(root, since).catch(() => []) });
  else set({ review: [] });
}

const dropFromReview = (path: string) => set({ review: (st().review ?? []).filter((f) => f.path !== path) });

export async function accept(file: FileDiff, hunk?: Hunk) {
  if (file.checkpoint) {
    // Keeping a checkpoint change needs nothing on disk: it just leaves the list.
    dropFromReview(file.path);
    peers.forgetTurnChanges([file.path]);
    return;
  }
  await reviewApi.accept(rootOf(), file, hunk);
  await loadReview();
  refresh();
}

export async function reject(file: FileDiff, hunk?: Hunk) {
  if (file.checkpoint) {
    await checkpoints.restoreFile(rootOf(), file.checkpoint, file.path);
    dropFromReview(file.path);
    peers.forgetTurnChanges([file.path]);
    refreshAfterFileChange();
    return;
  }
  const r = await reviewApi.reject(rootOf(), file, hunk);
  if (!r.ok && r.stderr) set({ lastError: r.stderr.trim() });
  refreshAfterFileChange();
}

export async function acceptAll() {
  const files = st().review ?? [];
  if (files[0]?.checkpoint) { set({ review: [] }); peers.forgetTurnChanges("all"); return; }
  for (const f of files) await reviewApi.accept(rootOf(), f);
  await loadReview();
  refresh();
}

export async function rejectAll() {
  const root = rootOf();
  const files = st().review ?? [];
  // A checkpoint first, so "reject all" can itself be undone.
  set({ restoredUndo: await checkpoints.create(root, "Before rejecting all changes") });
  for (const f of files) {
    if (f.checkpoint) await checkpoints.restoreFile(root, f.checkpoint, f.path);
    else await reviewApi.reject(root, f);
  }
  if (files[0]?.checkpoint) { set({ review: [] }); peers.forgetTurnChanges("all"); }
  peers.note("Rejected all changes. Undo is available from the review.");
  refreshAfterFileChange();
}

/** Restores every file to a checkpoint (the chat's "restore to before this message"). */
export async function restoreCheckpoint(id: string) {
  const r = await checkpoints.restore(rootOf(), id);
  set({ restoredUndo: r.undo });
  peers.note(r.ok ? "Restored the files to how they were before this message." : `Restore failed: ${r.message}`);
  refreshAfterFileChange();
  return r;
}

export async function undoRestore() {
  // One undo, whichever side made it (the review's "reject all" or the chat's restore).
  const undo = st().restoredUndo ?? peers.restoredUndo();
  if (!undo) return;
  const r = await checkpoints.restore(rootOf(), undo);
  set({ restoredUndo: null });
  peers.setField("restoredUndo", null);
  peers.note(r.ok ? "Undid the restore." : `Undo failed: ${r.message}`);
  refreshAfterFileChange();
}

export { githubUser };
