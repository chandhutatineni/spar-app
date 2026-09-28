// The IDE status bar (StatusBar.swift): branch and sync, GitHub account, cursor position,
// language, terminal and appearance. It also hosts the source-control commands, since it is
// on screen whenever a project is open.

import { useEffect, useState } from "react";
import { AlertTriangle, GitBranch, Hourglass, Moon, RefreshCw, Sun, SunMoon, SquareTerminal, UserCircle, UserPlus } from "lucide-react";
import { showMenu } from "../../ui";
import { usePref } from "../../lib/prefs";
import { useWorkspace } from "../../state/workspace";
import { languageFor } from "../editor/language";
import { GitHubConnectSheet } from "./GitHubConnect";
import { useGitHubUser } from "./github";
import { useScmCommands } from "./commands";
import * as scm from "./store";
import { Sym } from "./common";

const langName = (l: string) => ({ typescript: "TypeScript", javascript: "JavaScript", json: "JSON", html: "HTML", css: "CSS", scss: "SCSS", yaml: "YAML", sql: "SQL", csharp: "C#", cpp: "C++", plaintext: "Plain Text" } as Record<string, string>)[l] ?? l.charAt(0).toUpperCase() + l.slice(1);

export function StatusBar(_p: any) {
  const g = scm.useScm();
  const user = useGitHubUser();
  const [appearance, setAppearance] = usePref<string>("appearance", "system");
  const [showConnect, setShowConnect] = useState(false);
  const active = useWorkspace((s) => s.activeTab);
  const cursor = useWorkspace((s) => s.cursor);
  const language = useWorkspace((s) => s.language);
  const ws = useWorkspace.getState;
  useScmCommands(() => setShowConnect(true));
  useEffect(() => {
    const h = () => setShowConnect(true);
    window.addEventListener("scm:connect-github", h);
    return () => window.removeEventListener("scm:connect-github", h);
  }, []);

  const appearanceSymbol = appearance === "dark" ? "moon.fill" : appearance === "light" ? "sun.max.fill" : "circle.lefthalf.filled";
  const AppearanceIcon = appearance === "dark" ? Moon : appearance === "light" ? Sun : SunMoon;
  // Every symbol at the bar's 11pt font, as the SwiftUI labels draw them.
  const sym = (n: string, fb: React.ReactNode) => <Sym n={n} s={11} fb={fb} />;
  return (
    <footer className="scm-status" aria-label="Status bar">
      {g.isRepo ? (
        <>
          <button type="button" title="Source control" onClick={() => ws().open({ kind: "sourceControl" })}>
            {sym("arrow.triangle.branch", <GitBranch size={12} />)}
            <span>{g.branch ?? "detached"}</span>
            {g.ahead > 0 && <span>↑{g.ahead}</span>}
            {g.behind > 0 && <span>↓{g.behind}</span>}
          </button>
          {g.remoteUrl && (
            <button type="button" title="Sync: pull, then push" aria-label="Sync" disabled={!!g.busy} onClick={scm.sync}>
              {g.busy ? sym("hourglass", <Hourglass size={12} />) : sym("arrow.triangle.2.circlepath", <RefreshCw size={12} />)}
            </button>
          )}
        </>
      ) : g.isRepo === false ? (
        <button type="button" onClick={() => ws().open({ kind: "sourceControl" })}>{sym("arrow.triangle.branch", <GitBranch size={12} />)}<span>No repository</span></button>
      ) : null}
      <button type="button" title={user ? "GitHub account" : "Connect a GitHub account to push and open pull requests"} onClick={() => setShowConnect(true)}>
        {user ? sym("person.crop.circle", <UserCircle size={12} />) : sym("person.crop.circle.badge.plus", <UserPlus size={12} />)}
        <span>{user?.login ?? "Connect GitHub"}</span>
      </button>
      {g.lastError && (
        <span className="row" style={{ gap: 4, color: "var(--stop)", minWidth: 0 }} title={g.lastError}>
          {sym("exclamationmark.triangle.fill", <AlertTriangle size={12} style={{ flex: "none" }} />)}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.lastError.split("\n")[0]}</span>
        </span>
      )}
      <div className="spacer" />
      {active.kind === "file" && (
        <>
          {cursor && <span>Ln {cursor.line}</span>}
          <span>{langName(language ?? languageFor(active.path))}</span>
        </>
      )}
      <button type="button" title="Toggle the terminal (⌃`)" onClick={() => ws().toggleTerminal()}>{sym("terminal", <SquareTerminal size={12} />)}<span>Terminal</span></button>
      <button type="button" title="Appearance" aria-label="Appearance"
        onMouseDown={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          showMenu([
            { label: "Light", icon: <Sym n="sun.max" s={13} fb={<Sun size={13} />} />, checked: appearance === "light", onClick: () => setAppearance("light") },
            { label: "Dark", icon: <Sym n="moon" s={13} fb={<Moon size={13} />} />, checked: appearance === "dark", onClick: () => setAppearance("dark") },
            { label: "Match System", icon: <Sym n="circle.lefthalf.filled" s={13} fb={<SunMoon size={13} />} />, checked: appearance === "system", onClick: () => setAppearance("system") },
          ], { x: r.right - 170, y: r.top - 96 });
        }}>
        {sym(appearanceSymbol, <AppearanceIcon size={12} />)}
      </button>
      {showConnect && <GitHubConnectSheet onClose={() => setShowConnect(false)} />}
    </footer>
  );
}
