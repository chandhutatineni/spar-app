// The project window: toolbar, sidebar (loop / files / search / git), editor + terminal,
// the agent panel, and the status bar (part of the layout, so nothing slides under it).

import { FolderOpen, Search, GitBranch, RefreshCcw, PanelLeft, PanelRight, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useWorkspace, type SidebarMode } from "../state/workspace";
import { useApp } from "../state/app";
import { app as appApi, basename, pickFolder } from "../lib/api";
import { usePref } from "../lib/prefs";
import { inTauri } from "../lib/backend";
import { useCommand } from "../lib/commands";
import { SFSymbol } from "../ui/icons";
import { IconButton, Mark, MenuButton, SplitHandle, type MenuEntry } from "../ui";
import { AgentPanel, AgentInfoSheet, ToolbarCost, WorkSidebar } from "../features/chat";
import { EditorArea, Explorer, Palette, SearchView } from "../features/editor";
import { RunMenu, TerminalPanel } from "../features/terminal";
import { GitSidebar, StatusBar } from "../features/scm";
import { NewDiagramSheet } from "../features/docs";

const isMac = navigator.platform.toLowerCase().includes("mac");

export function MainView() {
  const ws = useWorkspace();
  const [sidebarWidth, setSidebarWidth] = usePref("sidebarWidth", 262);
  const [agentWidth, setAgentWidth] = usePref("chatWidth", 470);
  const [showSidebar, setShowSidebar] = usePref("showSidebar", true);
  useCommand("toggle-sidebar", { title: "Show or Hide the Sidebar", group: "View", shortcut: "⌃⌘S", run: () => setShowSidebar(!showSidebar) });
  const [winWidth, setWinWidth] = useState(window.innerWidth);
  useEffect(() => {
    const r = () => setWinWidth(window.innerWidth);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);
  useViewCommands();

  // The chat can take up to all but 420px of the content area.
  const maxAgent = Math.max(380, winWidth - (showSidebar ? sidebarWidth : 0) - 420);
  const agentW = Math.max(360, Math.min(agentWidth, maxAgent));
  const expanded = ws.chatExpanded && ws.showAgent;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Like NavigationSplitView: the sidebar runs the full height (traffic lights sit in it);
          the toolbar only spans the content. */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {showSidebar && (
          <>
            <aside style={{ width: sidebarWidth, flex: "none", display: "flex", flexDirection: "column", background: "var(--sidebar)", borderRight: "0.5px solid var(--hairline-strong)", minWidth: 0 }}>
              <div data-tauri-drag-region style={{ height: "var(--toolbar-h)", flex: "none", display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 8px" }}>
                <IconButton icon={<PanelLeft size={16} />} title="Hide sidebar (⌃⌘S)" onClick={() => setShowSidebar(false)} />
              </div>
              <NavigatorBar />
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {ws.sidebarMode === "work" && <WorkSidebar />}
                {ws.sidebarMode === "files" && <Explorer />}
                {ws.sidebarMode === "search" && <SearchView compact />}
                {ws.sidebarMode === "git" && <GitSidebar />}
              </div>
            </aside>
            <SplitHandle value={sidebarWidth} onChange={setSidebarWidth} min={230} max={380} onReset={() => setSidebarWidth(262)} />
          </>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Toolbar sidebarHidden={!showSidebar} onShowSidebar={() => setShowSidebar(true)} />
          <main style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0, background: "var(--bg)" }}>
            {!expanded && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 420, overflow: "hidden" }}>
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}><EditorArea /></div>
                {ws.showTerminal && <TerminalPanel />}
              </div>
            )}
            {ws.showAgent && (
              <>
                {!expanded && <SplitHandle value={agentW} onChange={setAgentWidth} min={360} max={maxAgent} dir={-1} onReset={() => setAgentWidth(470)} />}
                <div style={{ width: expanded ? undefined : agentW, flex: expanded ? 1 : "none", display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg)", borderLeft: expanded ? undefined : "0.5px solid var(--hairline)" }}>
                  <AgentPanel />
                </div>
              </>
            )}
          </main>
        </div>
      </div>
      <StatusBar />
      {ws.overlay && <Palette mode={ws.overlay} />}
      {ws.showAgentInfo && <AgentInfoSheet onClose={() => ws.set({ showAgentInfo: false })} />}
      {ws.showNewDiagram && <NewDiagramSheet onClose={() => ws.set({ showNewDiagram: false })} />}
    </div>
  );
}

function Toolbar({ sidebarHidden, onShowSidebar }: { sidebarHidden: boolean; onShowSidebar: () => void }) {
  const { name, showAgent, toggleAgent, root } = useWorkspace();
  const { recents, openProject, closeProject } = useApp();
  const items = (): MenuEntry[] => [
    { label: "Open Project…", onClick: async () => { const p = await pickFolder(); if (p) openProject(p); } },
    ...(recents.length > 1 ? [{ section: "Recent" } as MenuEntry, ...recents.slice(1).map((p) => ({ label: basename(p), detail: p, onClick: () => openProject(p) }))] : []),
    "divider",
    { label: isMac ? "Show in Finder" : "Show in File Manager", onClick: () => appApi.open(root) },
    { label: "Close Project", onClick: closeProject },
  ];
  // With the sidebar hidden the traffic lights sit over the toolbar.
  const lead = sidebarHidden && isMac && inTauri ? 80 : 8;
  return (
    <header data-tauri-drag-region className="toolbar" style={{ paddingLeft: lead }}>
      {sidebarHidden && <div className="tb-group"><IconButton icon={<PanelLeft size={16} />} title="Show sidebar (⌃⌘S)" onClick={onShowSidebar} /></div>}
      <div className="tb-group">
        <MenuButton items={items} className="tb-project" title="Project">
          <Mark size={18} />
          <span>{name}</span>
          <ChevronDown size={10} />
        </MenuButton>
      </div>
      <div className="tb-group tb-run"><RunMenu /></div>
      <div className="tb-group">
        <ToolbarCost />
        <IconButton icon={<PanelRight size={16} />} title="Show or hide the agent (⌥⌘I)" active={showAgent} onClick={toggleAgent} />
      </div>
      <div data-tauri-drag-region className="spacer" style={{ alignSelf: "stretch" }} />
    </header>
  );
}

function NavigatorBar() {
  // NavigatorBar in SidebarView.swift: 13pt symbols (semibold when on), accent at 12% behind the
  // selected one, and the change count as an orange capsule 8pt in from the item's top-right.
  const { sidebarMode, showSidebar, workflowMode, changeCount } = useWorkspace();
  const item = (mode: SidebarMode, symbol: string, fallback: React.ReactNode, help: string, badge = 0) => {
    const on = sidebarMode === mode;
    return (
      <button key={mode} type="button" title={help} aria-label={help} onClick={() => showSidebar(mode)}
        style={{ flex: 1, minHeight: 26, border: 0, padding: 0, borderRadius: 6, position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
          background: on ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent", color: on ? "var(--accent)" : "var(--text-2)" }}>
        <SFSymbol name={symbol} size={13} weight={on ? "semibold" : "regular"} fallback={fallback} />
        {badge > 0 && <span style={{ position: "absolute", top: 1, right: 8, fontSize: 8.5, fontWeight: 700, color: "#fff", background: "var(--warn)", borderRadius: 999, padding: "1px 3.5px", lineHeight: "10px" }}>{Math.min(badge, 99)}</span>}
      </button>
    );
  };
  return (
    <div style={{ display: "flex", gap: 2, padding: "5px 8px", borderBottom: "0.5px solid var(--hairline-strong)" }}>
      {workflowMode !== false && item("work", "arrow.triangle.2.circlepath", <RefreshCcw size={15} />, "SPAR loop (⌘1)")}
      {item("files", "folder", <FolderOpen size={15} />, "Explorer (⌘2)")}
      {item("search", "magnifyingglass", <Search size={15} />, "Search (⌘3)")}
      {item("git", "arrow.triangle.branch", <GitBranch size={15} />, "Source control (⌘4)", changeCount ?? 0)}
    </div>
  );
}

/** View / File commands that only need navigation state. */
function useViewCommands() {
  const ws = useWorkspace;
  const { openProject, closeProject } = useApp();
  useCommand("open-project", { title: "Open Project…", group: "File", shortcut: "⌘O", run: async () => { const p = await pickFolder(); if (p) openProject(p); } });
  useCommand("close-project", { title: "Close Project", group: "File", shortcut: "⇧⌘W", run: closeProject });
  useCommand("quick-open", { title: "Go to File…", group: "File", shortcut: "⌘P", run: () => ws.getState().set({ overlay: "quickOpen" }) });
  useCommand("command-palette", { title: "Command Palette…", group: "File", shortcut: "⇧⌘P", run: () => ws.getState().set({ overlay: "commands" }) });
  useCommand("find-in-files", { title: "Find in Files", group: "File", shortcut: "⇧⌘F", run: () => ws.getState().showSidebar("search") });
  useCommand("sidebar-work", { title: "Show the SPAR Loop", group: "View", shortcut: "⌘1", run: () => ws.getState().showSidebar("work") });
  useCommand("sidebar-files", { title: "Show the Explorer", group: "View", shortcut: "⌘2", run: () => ws.getState().showSidebar("files") });
  useCommand("sidebar-search", { title: "Show Search", group: "View", shortcut: "⌘3", run: () => ws.getState().showSidebar("search") });
  useCommand("sidebar-git", { title: "Show the Source Control Sidebar", group: "View", shortcut: "⌘4", run: () => ws.getState().showSidebar("git") });
  useCommand("reveal-in-explorer", { title: "Reveal in Explorer", group: "View", shortcut: "⇧⌘E", run: () => ws.getState().showSidebar("files") });
  useCommand("toggle-terminal", { title: "Toggle Terminal", group: "View", shortcut: "⌃`", run: () => ws.getState().toggleTerminal() });
  useCommand("source-control", { title: "Open Source Control", group: "View", shortcut: "⌃⇧G", run: () => ws.getState().open({ kind: "sourceControl" }) });
  useCommand("welcome", { title: "Open Welcome", group: "View", run: () => ws.getState().open({ kind: "welcome" }) });
  useCommand("toggle-agent", { title: "Show or Hide the Agent", group: "View", shortcut: "⌥⌘I", run: () => ws.getState().toggleAgent() });
  useCommand("new-window", { title: "New Window", group: "File", shortcut: "⇧⌘N", run: () => appApi.newWindow() });
  useCommand("settings", { title: "Settings…", group: "App", shortcut: "⌘,", run: () => appApi.settings() });
}
