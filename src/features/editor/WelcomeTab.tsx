// Shown when a project opens: what this IDE can do, and where to start (WelcomeTab.swift).

import { useEffect, useState, type ReactNode } from "react";
import {
  BookText, Code2, FilePlus, FileSearch, Folder, FolderCog, GitBranch, MessageSquareText, MonitorPlay, Play, Puzzle,
  Search, SquareTerminal,
} from "lucide-react";
import { exec, fs, spar } from "../../lib/api";
import { usePref } from "../../lib/prefs";
import { useWorkspace } from "../../state/workspace";
import { Button, Mark, Spinner } from "../../ui";
import { primaryTask, runTask, toggleTerminal, useDevTasks } from "../terminal";
import { useExplorer } from "./explorerStore";
import { fileIndex } from "./fileIndex";
import { useIntegration } from "./integration";
import { SFSymbol } from "../../ui/icons";
import { LoopRing } from "../chat/parts";
import { LIFECYCLE } from "../chat/sparcli";
import { phaseState, useSpar } from "../../state/spar";
import "./editor.css";
import { legacyRulesDir, migrateLegacyRules } from "./rules";
import { isLegacy } from "./sparPaths";

async function legacyFolders(root: string) {
  const names: string[] = [];
  if (await isLegacy(root)) names.push(".spar");
  if (await fs.exists(legacyRulesDir(root))) names.push("an older rules folder");
  return names;
}

export function WelcomeTab() {
  const root = useWorkspace((s) => s.root);
  const name = useWorkspace((s) => s.name);
  const version = useWorkspace((s) => s.fileTreeVersion);
  const ig = useIntegration();
  const tasks = useDevTasks((s) => s.tasks);
  const [showOnOpen, setShowOnOpen] = usePref("showWelcomeOnOpen", true);
  const [branch, setBranch] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [legacy, setLegacy] = useState<string[]>([]);
  const [migrating, setMigrating] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);

  useEffect(() => {
    fileIndex(root).then((f) => setCount(f.length));
    exec.run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }).then((r) => setBranch(r.ok ? r.stdout.trim() : null)).catch(() => {});
    legacyFolders(root).then(setLegacy);
  }, [root, version]);

  const ws = useWorkspace.getState;
  const focusChat = () => (ig.focusComposer ? ig.focusComposer() : ws().set({ showAgent: true }));
  const run = primaryTask(tasks, "run");
  const b = ig.branch ?? branch;
  const sp = useSpar();
  const loopStates = LIFECYCLE.map((p) => phaseState(p, sp));

  const migrate = async () => {
    setMigrating(true);
    if (await isLegacy(root)) {
      const r = await spar(root, ["migrate", root]).catch((e) => ({ ok: false, stdout: "", stderr: String(e) }));
      if (!r.ok) { setMigrating(false); setMigrateError((r.stderr || r.stdout).trim()); return; }
    }
    await migrateLegacyRules(root);
    setMigrating(false);
    setLegacy(await legacyFolders(root));
    useWorkspace.setState((s) => ({ fileTreeVersion: s.fileTreeVersion + 1, reloadToken: s.reloadToken + 1 }));
  };

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div className="col" style={{ gap: 28, padding: 40, maxWidth: 980, margin: "0 auto" }}>
        <div className="row" style={{ gap: 16 }}>
          <Mark size={56} />
          <div className="col" style={{ gap: 4 }}>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{name}</div>
            <div className="muted">{b ? `⎇ ${b} · ` : ""}{count ?? "…"} {count === 1 ? "file" : "files"}{ig.agentTitle ? ` · agent: ${ig.agentTitle}` : ""}</div>
          </div>
        </div>

        {(legacy.length > 0 || migrateError) && (
          <div className="card row" style={{ alignItems: "flex-start", gap: 12 }}>
            <span style={{ color: "var(--accent)", display: "inline-flex" }}><SFSymbol name="folder.badge.gearshape" size={17} fallback={<FolderCog size={22} />} /></span>
            <div className="col" style={{ gap: 4, flex: 1 }}>
              <div className="headline">Move SPAR files to a visible spar/ folder</div>
              <div style={{ fontSize: 12, color: migrateError ? "var(--sys-orange)" : "var(--text-2)" }}>
                {migrateError ?? `This project keeps SPAR files in hidden folders (${legacy.join(", ")}). Moving them to spar/ keeps git history and makes them easy to browse and push.`}
              </div>
            </div>
            <Button kind="primary" onClick={() => void migrate()} disabled={migrating}>{migrating ? <Spinner small /> : "Move to spar/"}</Button>
          </div>
        )}

        <div className="col" style={{ gap: 10 }}>
          <div className="headline">Start</div>
          <div className="row" style={{ flexWrap: "nowrap", gap: 10 }}>
            <Action symbol="doc.badge.plus" fallback={<FilePlus size={14} />} title="New file" run={() => { ws().showSidebar("files"); useExplorer.getState().beginCreate(false); }} />
            <Action symbol="doc.text.magnifyingglass" fallback={<FileSearch size={14} />} title="Open file" shortcut="⌘P" run={() => ws().set({ overlay: "quickOpen" })} />
            <Action symbol="magnifyingglass" fallback={<Search size={14} />} title="Search" shortcut="⌘⇧F" run={() => ws().showSidebar("search")} />
            <Action symbol="terminal" fallback={<SquareTerminal size={14} />} title="Terminal" shortcut="⌃`" run={() => toggleTerminal()} />
            {run && <Action symbol="play.fill" fallback={<Play size={14} />} title={`Run ${run.name}`} shortcut="⌘R" run={() => runTask(run)} />}
            <Action symbol="text.bubble" fallback={<MessageSquareText size={14} />} title="Ask the agent" run={focusChat} />
          </div>
        </div>

        {ig.runsSpar !== false && (
          <div className="card row" style={{ gap: 16 }}>
            <LoopRing states={loopStates} size={44} lineWidth={5} />
            <div className="col" style={{ gap: 3, flex: 1, minWidth: 0 }}>
              <div className="headline">{ig.sparSummary?.title ?? "Build something with SPAR"}</div>
              <div className="muted" style={{ fontSize: 12, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {ig.sparSummary?.detail ?? "Describe an idea; SPAR turns it into a spec, a plan, tested code and a verified delivery."}
              </div>
            </div>
            <Button kind="primary" onClick={() => {
              if (ig.sparSummary?.hasFeature) (ig.openWorkflow ?? (() => ws().open({ kind: "phase" })))();
              else if (ig.startNextIteration) ig.startNextIteration();
              else ws().open({ kind: "phase" });
            }}>{ig.sparSummary?.hasFeature ? "Open the workflow" : "Start in Discover"}</Button>
          </div>
        )}

        <div className="col" style={{ gap: 10 }}>
          <div className="headline">What you can do here</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 14 }}>
            {capabilities(focusChat).map((c) => (
              <button key={c.id} type="button" className="card" onClick={c.action}
                style={{ textAlign: "left", padding: 14, display: "flex", flexDirection: "column", gap: 8, cursor: "default", color: "inherit" }}>
                <div className="row">
                  <span style={{ color: c.tint, display: "flex" }}><SFSymbol name={c.symbol} size={15} fallback={c.icon} /></span>
                  <span className="headline">{c.title}</span>
                  <span className="spacer" />
                  {c.shortcut && <span className="mono" style={{ fontSize: 10, lineHeight: "13px", color: "var(--text-2)", padding: "2px 6px", background: "var(--subtle)", borderRadius: 5 }}>{c.shortcut}</span>}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{c.detail}</div>
              </button>
            ))}
          </div>
        </div>

        <label className="row muted" style={{ gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={showOnOpen} onChange={(e) => setShowOnOpen(e.target.checked)} />
          Show this page when a project opens
        </label>
      </div>
    </div>
  );
}

/** A Start button: Label(title, systemImage:) at .callout on Theme.subtle. When the row is tight,
 *  the title wraps and the shortcut drops to a second line, as the SwiftUI HStack does. */
function Action({ symbol, fallback, title, shortcut, run }: { symbol: string; fallback: ReactNode; title: string; shortcut?: string; run: () => void }) {
  return (
    <button type="button" onClick={run} className="ed-start">
      <span className="ed-start-icon"><SFSymbol name={symbol} size={12} fallback={fallback} /></span>
      <span>
        <span className="ed-start-label">{title}</span>
        {shortcut && <>{"  "}<span className="ed-start-label">{shortcut}</span></>}
      </span>
    </button>
  );
}

function capabilities(focusChat: () => void) {
  const ws = useWorkspace.getState;
  return [
    { id: "editor", symbol: "chevron.left.forwardslash.chevron.right", icon: <Code2 size={17} />, tint: "var(--sys-blue)", title: "Code editor", shortcut: "⌘P",
      detail: "The VS Code editor: 80+ languages, IntelliSense, multi-cursor, find and replace, minimap. ⌘K edits a selection with AI; ⌘L adds it to the chat.",
      action: () => ws().set({ overlay: "quickOpen" }) },
    { id: "chat", symbol: "text.bubble", icon: <MessageSquareText size={17} />, tint: "var(--accent)", title: "Agents and chat", shortcut: "⇧⇥",
      detail: "SPAR, Claude Code, Codex, Copilot and more. Pick the model, effort and mode (Agent, Ask, Plan, Debug with ⇧⇥), @-mention files, attach files and images, restore checkpoints.",
      action: focusChat },
    { id: "explorer", symbol: "folder", icon: <Folder size={17} />, tint: "rgb(92,153,230)", title: "Explorer", shortcut: "⌘2",
      detail: "Create, rename, duplicate and delete files; git status at a glance; right-click for Finder, terminal and copy-path actions.",
      action: () => ws().showSidebar("files") },
    { id: "search", symbol: "magnifyingglass", icon: <Search size={17} />, tint: "var(--sys-teal)", title: "Search", shortcut: "⌘⇧F",
      detail: "Search every file with match case, whole word, regex and file filters.", action: () => ws().showSidebar("search") },
    { id: "git", symbol: "arrow.triangle.branch", icon: <GitBranch size={17} />, tint: "var(--sys-orange)", title: "Source control and GitHub", shortcut: "⌘4",
      detail: "Stage, commit and push; review every change hunk by hunk; publish to GitHub and open pull requests.", action: () => ws().showSidebar("git") },
    { id: "terminal", symbol: "terminal", icon: <SquareTerminal size={17} />, tint: "var(--sys-green)", title: "Terminal and tasks", shortcut: "⌃`",
      detail: "Your shell inside the app. ▶ Run, Test and Build use the scripts found in package.json, Makefile, Cargo, SwiftPM and more.",
      action: () => toggleTerminal() },
    { id: "preview", symbol: "play.rectangle", icon: <MonitorPlay size={17} />, tint: "var(--sys-pink)", title: "Live preview and testing", shortcut: "",
      detail: "See the UI as it's built, on desktop, tablet or phone widths; page errors go to the agent; unit, integration, end-to-end and acceptance testing before delivery.",
      action: () => ws().open({ kind: "preview" }) },
    { id: "mcp", symbol: "puzzlepiece.extension", icon: <Puzzle size={17} />, tint: "var(--sys-purple)", title: "MCP servers", shortcut: "",
      detail: "Context7, Playwright, GitHub and more, plus the whole MCP Registry. Servers that fail are ignored.", action: () => ws().open({ kind: "mcp" }) },
    { id: "rules", symbol: "text.book.closed", icon: <BookText size={17} />, tint: "var(--sys-brown)", title: "Rules", shortcut: "",
      detail: "Project rules (spar/rules) and agent instructions the agents follow automatically.", action: () => ws().open({ kind: "rules" }) },
  ];
}

