// The connected GitHub account (GitHub.swift): the token lives in the backend's secrets
// ("github-token"); the account itself is the "githubUser" preference, like the Mac app's
// UserDefaults key, so every window (and Settings) sees it change.

import { useEffect, useState } from "react";
import { listen } from "../../lib/backend";
import { prefs, usePref } from "../../lib/prefs";
import { githubApi, type GitHubUser, type Identity } from "./api";

export const newTokenURL = "https://github.com/settings/personal-access-tokens/new";

export const githubUser = () => prefs.get<GitHubUser | null>("githubUser", null);
export const useGitHubUser = () => usePref<GitHubUser | null>("githubUser", null)[0];

function setUser(u: GitHubUser | null) {
  prefs.set("githubUser", u ? { login: u.login, name: u.name ?? null, id: u.id } : null);
  window.dispatchEvent(new CustomEvent("github-account-changed", { detail: u }));
}

/** Name and private noreply address for commits in a repository without an identity. */
export function identity(): Identity | null {
  const u = githubUser();
  return u ? { name: u.name || u.login, email: `${u.id}+${u.login}@users.noreply.github.com` } : null;
}

/** Verifies a token and stores it with the account it belongs to. */
export async function connect(token: string) {
  const u = await githubApi.connect(token);
  setUser(u);
  return u;
}

export async function disconnect() {
  await githubApi.disconnect();
  setUser(null);
}

// Any window's connect/disconnect (the backend emits to all of them).
listen<{ user: GitHubUser | null }>("github:account", ({ user }) => {
  const cur = githubUser();
  if ((cur?.login ?? null) !== (user?.login ?? null)) setUser(user);
});

// A token carried over from the Mac app, with no account remembered here yet: look it up
// (read-only: the token itself is not changed).
(async () => {
  if (githubUser()) return;
  try {
    if (!(await githubApi.hasToken())) return;
    const r = await githubApi.api("GET", "/user");
    if (r.status === 200 && r.body?.login) setUser({ login: r.body.login, name: r.body.name, id: r.body.id });
  } catch { /* offline */ }
})();

// ---- Browser sign-in (GitHubBrowserLogin) ------------------------------------------------

export type LoginPhase =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "waiting"; code: string; url: string }
  | { phase: "finishing" }
  | { phase: "done"; user: GitHubUser }
  | { phase: "failed"; message: string };

export function useBrowserLogin() {
  const [state, setState] = useState<LoginPhase>({ phase: "idle" });
  useEffect(() => listen<LoginPhase>("github:login", (p) => {
    setState(p);
    if (p.phase === "waiting") {
      navigator.clipboard?.writeText(p.code).catch(() => {});
      import("../../lib/api").then(({ app }) => app.open(p.url).catch(() => window.open(p.url, "_blank")));
    }
    if (p.phase === "done") setUser(p.user);
  }), []);
  return {
    state,
    start: async () => { setState({ phase: "preparing" }); await githubApi.loginStart().catch((e) => setState({ phase: "failed", message: String(e) })); },
    cancel: () => { if (state.phase !== "idle" && state.phase !== "done" && state.phase !== "failed") githubApi.loginCancel().catch(() => {}); setState({ phase: "idle" }); },
  };
}
