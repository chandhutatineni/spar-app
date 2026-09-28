// Source-control commands for the palette (the Mac app's Palette.swift items plus a few more).

import { useCommand } from "../../lib/commands";
import { promptText } from "../../lib/dialogs";
import { showMenu } from "../../ui";
import { useWorkspace } from "../../state/workspace";
import * as scm from "./store";

export function useScmCommands(connectGitHub: () => void) {
  const repo = () => scm.useScm.getState().isRepo === true;
  const remote = () => repo() && !!scm.useScm.getState().remoteUrl && !scm.useScm.getState().busy;
  const openSc = () => useWorkspace.getState().open({ kind: "sourceControl" });
  const sheet = (s: string) => { openSc(); setTimeout(() => window.dispatchEvent(new CustomEvent("scm:sheet", { detail: s })), 50); };

  useCommand("git-push", { title: "Git: Push", group: "Source Control", enabled: remote, run: () => scm.push() });
  useCommand("git-pull", { title: "Git: Pull", group: "Source Control", enabled: remote, run: () => scm.pull() });
  useCommand("git-sync", { title: "Git: Sync (Pull, then Push)", group: "Source Control", enabled: remote, run: () => scm.sync() });
  useCommand("git-review", { title: "Review Changes", group: "Source Control", run: () => scm.openReview() });
  useCommand("git-commit", {
    title: "Git: Commit…", group: "Source Control", enabled: () => repo() && scm.useScm.getState().changes.length > 0,
    run: async () => {
      const m = await promptText("Commit", scm.useScm.getState().staged.size ? `Commit ${scm.useScm.getState().staged.size} staged file(s)` : "Commit all changes", scm.suggestedMessage("sidebar"));
      if (m?.trim()) scm.commit(m);
    },
  });
  useCommand("git-new-branch", {
    title: "Git: New Branch…", group: "Source Control", enabled: repo,
    run: async () => { const n = await promptText("New branch", undefined, "", "New branch name"); if (n?.trim()) scm.createBranch(n.trim().replace(/ /g, "-")); },
  });
  useCommand("git-switch-branch", {
    title: "Git: Switch Branch…", group: "Source Control", enabled: repo,
    run: () => {
      const { branches, branch } = scm.useScm.getState();
      showMenu(branches.map((b) => ({ label: b, checked: b === branch, disabled: b === branch, onClick: () => scm.switchBranch(b) })), { x: window.innerWidth / 2 - 100, y: 80 });
    },
  });
  useCommand("git-init", { title: "Git: Initialize Repository", group: "Source Control", enabled: () => scm.useScm.getState().isRepo === false, run: () => scm.initialize() });
  useCommand("git-publish", { title: "Publish to GitHub…", group: "Source Control", enabled: () => repo() && !scm.useScm.getState().remoteUrl, run: () => sheet("publish") });
  useCommand("git-pull-request", { title: "Open a Pull Request…", group: "Source Control", enabled: () => !!scm.github(), run: () => sheet("pr") });
  useCommand("github-connect", { title: "Connect GitHub…", group: "Source Control", run: connectGitHub });
}
