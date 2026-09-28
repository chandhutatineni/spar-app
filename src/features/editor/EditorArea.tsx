// The editor area (EditorArea.swift): the tab bar and every kind of document.

import { useEffect, useState, type ReactNode } from "react";
import {
  BookText, Compass, Diff, FileText, GitBranch, Hammer, ListChecks, MessageSquareText, MonitorPlay, Package,
  Puzzle, ScanSearch, Search, Share, Sparkles, SquareDashed, Wand2, X, File as FileIcon2, Loader2,
} from "lucide-react";
import { app as appApi, basename, relativePath } from "../../lib/api";
import { useCommand } from "../../lib/commands";
import { prefs } from "../../lib/prefs";
import { onFilesChanged } from "../../state/app";
import { docId, sameDoc, useWorkspace, type Doc } from "../../state/workspace";
import { Button, MenuButton, Segmented, Spinner } from "../../ui";
import { PhaseView } from "../chat";
import { canPreview, DocumentView, exportDocument, exportFormats } from "../docs";
import { MCPView } from "../mcp";
import { ImpactView, TraceView } from "../insights";
import { TrendingUp, Waypoints } from "lucide-react";
import { DiffView, ReviewView, SourceControlView } from "../scm";
import { PreviewView } from "../terminal";
import { host } from "./host";
import { acceptInlineEdit, rejectInlineEdit, startInlineEdit, useInline, useInlineEdit } from "./inlineEdit";
import { useIntegration } from "./integration";
import { isBinaryPath } from "./language";
import { MonacoView } from "./MonacoView";
import { RulesView } from "./RulesView";
import { SearchView } from "./SearchView";
import { artifactTitle, isArtifactPath } from "./sparPaths";
import { WelcomeTab } from "./WelcomeTab";
import { useExplorer } from "./explorerStore";
import { SFSymbol } from "../../ui/icons";
import { invalidateFileIndex } from "./fileIndex";

export function EditorArea() {
  const tabs = useWorkspace((s) => s.tabs);
  const active = useWorkspace((s) => s.activeTab);
  const reloadToken = useWorkspace((s) => s.reloadToken);
  useEditorWiring();

  let body: ReactNode;
  switch (active.kind) {
    case "phase": body = <PhaseView />; break;
    case "welcome": body = <WelcomeTab />; break;
    case "preview": body = <PreviewView />; break;
    case "review": body = <ReviewView />; break;
    case "rules": body = <RulesView />; break;
    case "search": body = <SearchView />; break;
    case "mcp": body = <MCPView />; break;
    case "trace": body = <TraceView />; break;
    case "impact": body = <ImpactView />; break;
    case "sourceControl": body = <SourceControlView />; break;
    case "file": body = <FileDoc key={active.path} path={active.path} />; break;
    case "diff": body = <DiffView key={`${active.path}#${reloadToken}`} path={active.path} />; break;
  }
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg)" }}>
      {tabs.length > 1 && <TabBar />}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>{body}</div>
    </div>
  );
}

// ---- Tabs -----------------------------------------------------------------------------

// Tab icons: the SF Symbol TabBar.icon(_:) in EditorArea.swift picks per kind of document.
const PHASE_SYMBOLS: Record<string, string> = {
  Discover: "sparkle.magnifyingglass", Design: "square.on.square.dashed", Develop: "hammer", Deliver: "shippingbox",
};
const PHASE_FALLBACK: Record<string, ReactNode> = {
  Discover: <ScanSearch size={11} />, Design: <SquareDashed size={11} />, Develop: <Hammer size={11} />, Deliver: <Package size={11} />,
};

const tabIcon = (symbol: string, fallback: ReactNode) => <SFSymbol name={symbol} size={10.5} fallback={fallback} />;

function useTabTitle() {
  const phase = useIntegration((s) => s.phase);
  return (doc: Doc): { title: string; icon: ReactNode } => {
    switch (doc.kind) {
      case "phase": {
        const t = phase?.title ?? "Workflow";
        return { title: t, icon: tabIcon(PHASE_SYMBOLS[t] ?? "sparkle.magnifyingglass", PHASE_FALLBACK[t] ?? <Compass size={11} />) };
      }
      case "welcome": return { title: "Welcome", icon: tabIcon("sparkles", <Sparkles size={11} />) };
      case "preview": return { title: "Preview", icon: tabIcon("play.rectangle", <MonitorPlay size={11} />) };
      case "review": return { title: "Review", icon: tabIcon("checklist.checked", <ListChecks size={11} />) };
      case "rules": return { title: "Rules", icon: tabIcon("text.book.closed", <BookText size={11} />) };
      case "search": return { title: "Search", icon: tabIcon("magnifyingglass", <Search size={11} />) };
      case "mcp": return { title: "MCP Servers", icon: tabIcon("puzzlepiece.extension", <Puzzle size={11} />) };
      case "trace": return { title: "Traceability", icon: tabIcon("point.3.connected.trianglepath.dotted", <Waypoints size={11} />) };
      case "impact": return { title: "AI Impact", icon: tabIcon("chart.line.uptrend.xyaxis", <TrendingUp size={11} />) };
      case "sourceControl": return { title: "Source Control", icon: tabIcon("arrow.triangle.branch", <GitBranch size={11} />) };
      case "file": {
        const name = basename(doc.path);
        return { title: isArtifactPath(doc.path) ? artifactTitle(name) : name, icon: tabIcon("doc.text", <FileText size={11} />) };
      }
      case "diff": return { title: basename(doc.path), icon: tabIcon("plusminus", <Diff size={11} />) };
    }
  };
}

function TabBar() {
  const { tabs, activeTab, workflowMode, dirty, closeTab, set } = useWorkspace();
  const titleOf = useTabTitle();
  const home: Doc = workflowMode ? { kind: "phase" } : { kind: "welcome" };
  // HStack(spacing: 2) .padding(.horizontal, 8) .padding(.vertical, 5) on .bar, then a Divider.
  return (
    <div role="tablist" style={{ flex: "none", display: "flex", alignItems: "center", gap: 2, padding: "5px 8px", overflowX: "auto", background: "var(--window)", borderBottom: "1px solid var(--hairline-strong)", scrollbarWidth: "none" }}>
      {tabs.map((doc) => {
        const { title, icon } = titleOf(doc);
        return (
          <TabButton key={docId(doc)} title={title} icon={icon} active={sameDoc(doc, activeTab)}
            tooltip={doc.kind === "file" ? doc.path : doc.kind === "diff" ? doc.path : title}
            dirty={doc.kind === "file" && dirty.has(doc.path)}
            select={() => set({ activeTab: doc })}
            close={sameDoc(doc, home) ? undefined : () => void closeTab(doc)} />
        );
      })}
    </div>
  );
}

function TabButton(p: { title: string; icon: ReactNode; active: boolean; dirty: boolean; tooltip: string; select: () => void; close?: () => void }) {
  const [hover, setHover] = useState(false);
  const showDot = p.dirty && !hover;
  return (
    <div role="tab" aria-selected={p.active} aria-label={p.title} title={p.tooltip}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onMouseDown={(e) => { if (e.button === 1 && p.close) { e.preventDefault(); p.close(); } }}
      onClick={p.select}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 7, flex: "none", cursor: "default", lineHeight: "15px",
        background: p.active ? "var(--bg)" : hover ? "var(--subtle)" : "transparent",
        boxShadow: p.active ? "inset 0 0 0 1px var(--hairline)" : undefined,
      }}>
      <span className="muted" style={{ display: "flex" }}>{p.icon}</span>
      <span style={{ fontSize: 12, fontWeight: p.active ? 500 : 400, whiteSpace: "nowrap" }}>{p.title}</span>
      {p.close && (
        <button type="button" aria-label={p.dirty ? `Close ${p.title} (unsaved)` : `Close ${p.title}`} title={p.dirty ? "Unsaved changes" : "Close"}
          onClick={(e) => { e.stopPropagation(); p.close!(); }}
          style={{ border: 0, padding: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center",
            color: showDot ? "var(--warn)" : "var(--text-2)", opacity: hover || p.active || p.dirty ? 1 : 0 }}>
          {showDot
            ? <span data-testid="dirty-dot" style={{ display: "flex" }}><SFSymbol name="circle.fill" size={7} weight="bold" fallback={<span style={{ width: 7, height: 7, borderRadius: 4, background: "var(--warn)" }} />} /></span>
            : <SFSymbol name="xmark" size={8.5} weight="bold" fallback={<X size={10} strokeWidth={2.6} />} />}
        </button>
      )}
    </div>
  );
}

// ---- Files ----------------------------------------------------------------------------

function FileDoc({ path }: { path: string }) {
  const root = useWorkspace((s) => s.root);
  const dirty = useWorkspace((s) => s.dirty.has(path));
  const previewable = canPreview(path);
  const textual = !isBinaryPath(path);
  const [editing, setEditing] = useState(!previewable);
  const [binary, setBinary] = useState(!previewable && !textual);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const formats = exportFormats(path);
  const showsEditor = editing && textual && !binary;
  const cmdK = useInline((s) => (s.cmdK?.path === path ? s.cmdK : null));
  const edit = useInlineEdit(path);
  const notice = useInline((s) => s.notice);

  // An inline edit in review shows as a diff in the editor.
  useEffect(() => {
    if (edit?.state !== "review" || !showsEditor) return;
    let off = false;
    host.ensure().then(async () => {
      const { fs } = await import("../../lib/api");
      const now = await fs.readText(path).catch(() => "");
      if (!off) host.showDiff(edit.original, now, path);
    });
    return () => { off = true; };
  }, [edit?.state, showsEditor, path]);

  const doExport = async (format: string, label: string) => {
    if (host.has(path)) await host.save(path);
    setExporting(true);
    setMessage({ text: `Exporting to ${label}…` });
    try {
      const out = await exportDocument(path, format);
      setMessage(null);
      if (out) appApi.reveal(out).catch(() => {});
    } catch (e) {
      setMessage({ text: `Couldn't export: ${e}`, error: true });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="row doc-toolbar" style={{ flex: "none", gap: 10, padding: "7px 16px", borderBottom: "1px solid var(--hairline-strong)", minHeight: 27 }}>
        <span className="mono" title={path} style={{ fontSize: 10, color: "var(--text-2)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", direction: "rtl", textAlign: "left", minWidth: 0 }}>
          {"‎" + relativePath(root, path)}
        </span>
        {dirty && <span title="Unsaved changes" aria-label="Unsaved changes" style={{ width: 6, height: 6, borderRadius: 3, background: "var(--warn)", flex: "none" }} />}
        <span className="spacer" />
        {showsEditor && (
          <>
            <Button size="small" icon={<SFSymbol name="wand.and.stars" size={11} fallback={<Wand2 size={12} />} />} title="Edit the selection with the agent (⌘K)" onClick={() => host.cmdK()}>Edit with AI</Button>
            <Button size="small" icon={<SFSymbol name="text.bubble" size={11} fallback={<MessageSquareText size={12} />} />} title="Attach the selection to the chat (⌘L)" onClick={() => host.addToChat()}>Add to chat</Button>
          </>
        )}
        {formats.length > 0 && (
          <>
            {exporting && <Spinner small />}
            <MenuButton className="btn btn-small btn-plain" title="Export this document with its diagrams" disabled={exporting}
              items={formats.map((f) => ({ label: `Export as ${f.label}…`, onClick: () => void doExport(f.format, f.label) }))}>
              <span className="row" style={{ gap: 4, color: "var(--accent)" }}>
                <SFSymbol name="square.and.arrow.up" size={11} fallback={<Share size={12} />} /> Export
                <SFSymbol name="chevron.down" size={8} weight="semibold" fallback={null} />
              </span>
            </MenuButton>
          </>
        )}
        {previewable && textual && (
          <Segmented value={editing ? "edit" : "preview"} onChange={(v) => setEditing(v === "edit")}
            options={[{ value: "preview", label: "Preview" }, { value: "edit", label: "Edit" }]} />
        )}
        {showsEditor && <Button size="small" disabled={!dirty} title="Save (⌘S)" onClick={() => void host.save(path)}>Save</Button>}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
        {binary ? <BinaryFile path={path} />
          : showsEditor ? <MonacoView path={path} onBinary={() => setBinary(true)} />
          : <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}><DocumentView path={path} /></div>}
        <div style={{ position: "absolute", top: 12, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "none", zIndex: 10 }}>
          {edit?.state === "review" && <ReviewBar lines={edit.lines} />}
          {!edit && cmdK && <PromptBar path={path} />}
          {edit?.state === "waiting" && (
            <div className="row" style={{ ...floating, borderRadius: 999, padding: "7px 14px" }}>
              <Loader2 size={13} className="spin" style={{ animation: "spin 0.9s linear infinite" }} />
              <span>The agent is editing lines {edit.lines[0]}–{edit.lines[1]}…</span>
            </div>
          )}
          {notice && <div style={{ ...floating, cursor: "default" }} onClick={() => useInline.setState({ notice: null })}>{notice}</div>}
          {message && <div style={{ ...floating, color: message.error ? "var(--stop)" : undefined }} onClick={() => setMessage(null)}>{message.text}</div>}
        </div>
      </div>
    </div>
  );
}

const floating: React.CSSProperties = {
  pointerEvents: "auto", background: "var(--card)", boxShadow: "var(--shadow)", borderRadius: 12, padding: "8px 12px", maxWidth: 660, fontSize: 12.5,
};

function PromptBar({ path }: { path: string }) {
  const cmdK = useInline((s) => s.cmdK)!;
  const running = useIntegration((s) => !!s.agentRunning);
  const canSend = useIntegration((s) => !!s.sendToChat && s.hasSession !== false);
  const [text, setText] = useState("");
  const cancel = () => { useInline.setState({ cmdK: null }); host.focus(); };
  const run = async () => {
    const what = text.trim();
    if (!what) return;
    if (host.isDirty(path)) await host.save(path);
    startInlineEdit(path, cmdK.full, cmdK.lines, cmdK.selection, what);
  };
  return (
    <div className="row" style={{ ...floating, width: 660, maxWidth: "calc(100% - 24px)", border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)" }}>
      <Wand2 size={14} color="var(--accent)" />
      <span className="mono caption" style={{ whiteSpace: "nowrap" }}>Lines {cmdK.lines[0]}–{cmdK.lines[1]}</span>
      <input autoFocus className="text-field" style={{ border: 0, boxShadow: "none", background: "transparent" }} placeholder="Describe the change…"
        value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void run(); if (e.key === "Escape") cancel(); }} />
      <Button size="small" onClick={cancel}>Cancel</Button>
      <Button size="small" kind="primary" disabled={!text.trim() || running || !canSend} onClick={() => void run()}
        title={canSend ? undefined : "The agent isn't connected"}>Generate</Button>
    </div>
  );
}

function ReviewBar({ lines }: { lines: [number, number] }) {
  const done = () => { host.closeDiff(); host.refreshAll(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); void Promise.resolve(rejectInlineEdit()).then(done); }
      else if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); acceptInlineEdit(); done(); }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);
  return (
    <div className="row" style={{ ...floating, width: 660, maxWidth: "calc(100% - 24px)" }}>
      <Wand2 size={14} color="var(--accent)" />
      <span className="headline">Review the edit to lines {lines[0]}–{lines[1]}</span>
      <span className="spacer" />
      <Button size="small" onClick={() => void Promise.resolve(rejectInlineEdit()).then(done)}>Reject  ⎋</Button>
      <Button size="small" kind="primary" style={{ background: "var(--done)" }} onClick={() => { acceptInlineEdit(); done(); }}>Accept  ⇥</Button>
    </div>
  );
}

function BinaryFile({ path }: { path: string }) {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return (
    <div className="empty">
      <FileIcon2 size={34} className="faint" />
      <div className="headline">{basename(path)}</div>
      <div className="caption">This file isn't text, so it can't be shown in the editor.</div>
      <div className="row" style={{ marginTop: 6 }}>
        <Button onClick={() => appApi.open(path)}>Open with Default App</Button>
        <Button onClick={() => appApi.reveal(path)}>{isMac ? "Reveal in Finder" : "Show in File Manager"}</Button>
      </div>
    </div>
  );
}

// ---- Wiring: editor hooks, disk changes, commands ----------------------------------------

function useEditorWiring() {
  const ws = useWorkspace;

  useEffect(() => {
    ws.getState().set({
      editor: {
        isDirty: (p) => host.isDirty(p),
        save: (p) => host.save(p),
        discard: (p) => host.close(p),
        reveal: (p, line) => {
          if (host.showing(p)) {
            host.revealLine(line);
            const { [p]: _, ...rest } = ws.getState().pendingReveal;
            ws.getState().set({ pendingReveal: rest });
          }
        },
      },
    });
    // Models of files whose tab closed go away (closeTab has already asked about unsaved ones).
    const unsubTabs = ws.subscribe((s, prev) => {
      if (s.tabs === prev.tabs) return;
      const open = new Set(s.tabs.flatMap((t) => (t.kind === "file" ? [t.path] : [])));
      for (const p of host.paths()) if (!open.has(p) && !host.isDirty(p)) host.close(p);
    });
    // Reload open files that changed on disk (the agent's edits), unless they have unsaved changes.
    let timer: number | undefined;
    const offFiles = onFilesChanged(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => { host.refreshAll(); invalidateFileIndex(); }, 150);
    });
    const unsubReload = ws.subscribe((s, prev) => { if (s.reloadToken !== prev.reloadToken || s.fileTreeVersion !== prev.fileTreeVersion) host.refreshAll(); });
    return () => {
      ws.getState().set({ editor: null });
      unsubTabs(); unsubReload(); offFiles(); clearTimeout(timer);
      host.closeAll();
    };
  }, []);

  const activeFile = () => { const t = ws.getState().activeTab; return t.kind === "file" ? t.path : null; };
  useCommand("save", {
    title: "Save", group: "File", shortcut: "⌘S",
    enabled: () => { const p = activeFile(); return !!p && host.has(p); },
    run: () => { const p = activeFile(); if (p) void host.save(p); },
  });
  useCommand("format-document", { title: "Format Document", group: "Editor", shortcut: "⇧⌥F", run: () => host.format() });
  useCommand("toggle-word-wrap", { title: "Toggle Word Wrap", group: "Editor", shortcut: "⌥Z", run: () => prefs.set("editorWordWrap", !prefs.get("editorWordWrap", false)) });
  useCommand("toggle-minimap", { title: "Toggle Minimap", group: "Editor", run: () => prefs.set("editorMinimap", !prefs.get("editorMinimap", true)) });
  useCommand("edit-with-ai", { title: "Edit Selection with AI", group: "Editor", shortcut: "⌘K", enabled: () => !!activeFile(), run: () => host.cmdK() });
  useCommand("add-selection-to-chat", { title: "Add Selection to Chat", group: "Editor", shortcut: "⌘L", enabled: () => !!activeFile(), run: () => host.addToChat() });
  useCommand("new-file", { title: "New File…", group: "File", run: () => { ws.getState().showSidebar("files"); useExplorer.getState().beginCreate(false); } });
  useCommand("new-folder", { title: "New Folder…", group: "File", run: () => { ws.getState().showSidebar("files"); useExplorer.getState().beginCreate(true); } });
  useCommand("open-rules", { title: "Open Rules", group: "View", run: () => ws.getState().open({ kind: "rules" }) });
  useCommand("open-search-page", { title: "Search in Files (Full Page)", group: "View", run: () => ws.getState().open({ kind: "search" }) });
  useCommand("new-diagram", { title: "New Diagram…", group: "File", run: () => ws.getState().set({ showNewDiagram: true }) });
  useCommand("close-tab", {
    title: "Close Tab", group: "File",
    run: () => { const s = ws.getState(); void s.closeTab(s.activeTab); },
  });
}
