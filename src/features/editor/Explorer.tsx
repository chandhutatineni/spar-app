// The Explorer sidebar (Explorer.swift): the file tree with create, rename, duplicate,
// move to Trash, git status and context menus.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight, FilePlus, FolderPlus, Workflow, RefreshCw, ChevronsDownUp, Ellipsis, ListFilter, XCircle,
} from "lucide-react";
import { app as appApi, basename, dirname, relativePath } from "../../lib/api";
import { useWorkspace } from "../../state/workspace";
import { contextMenu, MenuButton, type MenuEntry } from "../../ui";
import { SFSymbol } from "../../ui/icons";
import "./editor.css";
import { runInTerminal } from "../terminal";
import { useExplorer, type Entry } from "./explorerStore";
import { fileIndex } from "./fileIndex";
import { FileIcon } from "./FileIcon";
import { useIntegration } from "./integration";

const isMac = navigator.platform.toLowerCase().includes("mac");
const finder = isMac ? "Finder" : "File Manager";

interface Row { entry: Entry; depth: number }

const shellQuote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const copy = (s: string) => navigator.clipboard?.writeText(s).catch(() => {});

export function Explorer() {
  const root = useWorkspace((s) => s.root);
  const activeTab = useWorkspace((s) => s.activeTab);
  const fileTreeVersion = useWorkspace((s) => s.fileTreeVersion);
  const m = useExplorer();
  const integrationChanges = useIntegration((s) => s.changes);
  const [matches, setMatches] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (m.root !== root && root) { m.reset(root); void useExplorer.getState().refreshStatus(); } }, [root]);
  // Open folders load their children lazily.
  useEffect(() => { for (const d of m.expanded) if (!m.cache[d]) void m.load(d); }, [m.expanded, m.cache, m.root]);
  // Changes on disk refresh the tree (debounced by the watcher already).
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } useExplorer.getState().invalidate(); }, [fileTreeVersion]);
  useEffect(() => {
    if (!m.filter) { setMatches([]); return; }
    const q = m.filter.toLowerCase();
    fileIndex(root).then((all) => setMatches(all.filter((p) => p.toLowerCase().includes(q)).slice(0, 300)));
  }, [m.filter, root, fileTreeVersion]);
  // The active file shows (and scrolls into view) in the tree.
  useEffect(() => {
    if (activeTab.kind !== "file" || !activeTab.path.startsWith(root + "/")) return;
    useExplorer.getState().reveal(activeTab.path);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-path="${CSS.escape(activeTab.path)}"]`)?.scrollIntoView({ block: "nearest" }));
  }, [activeTab]);

  const status = useMemo(() => {
    if (integrationChanges) return Object.fromEntries(integrationChanges.map((c) => [c.path, c.status]));
    return m.status;
  }, [integrationChanges, m.status]);
  const changedDirs = useMemo(() => {
    const s = new Set<string>();
    for (const p of Object.keys(status)) { let d = dirname(p); while (d && d !== "/" && d !== "." && d !== p) { s.add(d); const n = dirname(d); if (n === d) break; d = n; } }
    return s;
  }, [status]);

  const rows: Row[] = useMemo(() => {
    if (m.filter) return matches.map((rel) => ({ entry: { path: root + "/" + rel, name: rel, isDir: false }, depth: 0 }));
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const e of m.cache[dir] ?? []) {
        out.push({ entry: e, depth });
        if (e.isDir && m.expanded.has(e.path) && out.length < 5000) walk(e.path, depth + 1);
      }
    };
    walk(root, 0);
    return out;
  }, [m.cache, m.expanded, m.filter, matches, root]);

  const menuItems = (): MenuEntry[] => [
    { label: "Show Hidden Files", checked: m.showHidden, onClick: () => m.setShowHidden(!m.showHidden) },
    { label: "Reveal Active File", onClick: () => { const t = useWorkspace.getState().activeTab; if (t.kind === "file") m.reveal(t.path); } },
    { label: `Open Folder in ${finder}`, onClick: () => appApi.open(root) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }} aria-label="Explorer">
      <div className="row" style={{ gap: 2, padding: "6px 12px" }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{basename(root).toUpperCase()}</span>
        <HeaderButton symbol="doc.badge.plus" fallback={<FilePlus size={13} />} title="New File" onClick={() => m.beginCreate(false)} />
        <HeaderButton symbol="folder.badge.plus" fallback={<FolderPlus size={13} />} title="New Folder" onClick={() => m.beginCreate(true)} />
        <HeaderButton symbol="point.3.connected.trianglepath.dotted" fallback={<Workflow size={13} />} title="New Diagram" onClick={() => useWorkspace.getState().set({ showNewDiagram: true })} />
        <HeaderButton symbol="arrow.clockwise" fallback={<RefreshCw size={13} />} title="Refresh" onClick={() => m.invalidate()} />
        <HeaderButton symbol="rectangle.compress.vertical" fallback={<ChevronsDownUp size={13} />} title="Collapse All" onClick={() => m.collapseAll()} />
        <MenuButton items={menuItems} className="ed-borderless" title="More"><SFSymbol name="ellipsis" size={13} fallback={<Ellipsis size={13} />} /></MenuButton>
      </div>
      <div className="row" style={{ gap: 6, margin: "0 10px 6px", padding: "5px 8px", background: "var(--subtle)", borderRadius: 7, fontSize: 12 }}>
        <span className="faint" style={{ display: "inline-flex" }}><SFSymbol name="line.3.horizontal.decrease" size={12} fallback={<ListFilter size={12} />} /></span>
        <input aria-label="Filter files" placeholder="Filter files" value={m.filter} onChange={(e) => useExplorer.setState({ filter: e.target.value })}
          onKeyDown={(e) => e.key === "Escape" && useExplorer.setState({ filter: "" })}
          style={{ flex: 1, border: 0, outline: "none", background: "transparent", fontSize: 12, lineHeight: "15px", height: 15, padding: 0, minWidth: 0 }} />
        {m.filter && <button type="button" aria-label="Clear filter" className="faint" style={{ border: 0, padding: 0, background: "transparent", display: "inline-flex" }} onClick={() => useExplorer.setState({ filter: "" })}><SFSymbol name="xmark.circle.fill" size={12} fallback={<XCircle size={12} />} /></button>}
      </div>
      <div ref={listRef} role="tree" style={{ flex: 1, overflow: "auto", padding: "4px 0" }} onContextMenu={contextMenu(() => folderMenu(root))}>
        {m.creating?.parent === root && <CreationRow depth={0} folder={m.creating.isFolder} />}
        {rows.map((row) => (
          <div key={row.entry.path}>
            <RowView row={row} status={status} changedDirs={changedDirs} filtering={!!m.filter} />
            {m.creating && row.entry.isDir && m.creating.parent === row.entry.path && m.expanded.has(row.entry.path) && (
              <CreationRow depth={row.depth + 1} folder={m.creating.isFolder} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** An Explorer header button (iconButton in Explorer.swift): a borderless, accent-tinted symbol in a 20×18 frame. */
function HeaderButton({ symbol, fallback, title, onClick }: { symbol: string; fallback: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" className="ed-borderless" title={title} aria-label={title} onClick={onClick}>
      <SFSymbol name={symbol} size={13} fallback={fallback} />
    </button>
  );
}

function statusColor(s?: string) {
  return s === "created" ? "var(--done)" : s === "deleted" ? "var(--stop)" : s === "modified" ? "var(--warn)" : undefined;
}

function RowView({ row, status, changedDirs, filtering }: { row: Row; status: Record<string, string>; changedDirs: Set<string>; filtering: boolean }) {
  const e = row.entry;
  const root = useWorkspace((s) => s.root);
  const active = useWorkspace((s) => s.activeTab.kind === "file" && s.activeTab.path === e.path);
  const m = useExplorer();
  const rel = relativePath(root, e.path);
  const st = status[rel];
  const open = m.expanded.has(e.path);
  return (
    <div role="treeitem" aria-expanded={e.isDir ? open : undefined} aria-selected={active} data-path={e.path} title={rel}
      draggable onDragStart={(ev) => { ev.dataTransfer.setData("text/plain", e.path); ev.dataTransfer.setData("text/uri-list", "file://" + e.path); }}
      onClick={() => {
        useExplorer.setState({ selected: e.path });
        if (e.isDir) m.toggle(e.path); else useWorkspace.getState().open({ kind: "file", path: e.path });
      }}
      onContextMenu={contextMenu(() => (e.isDir ? folderMenu(e.path) : fileMenu(e.path)))}
      style={{ height: 24, display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, margin: "0 4px", borderRadius: 5, paddingLeft: row.depth * 14 + 4, paddingRight: 6,
        background: active ? "color-mix(in srgb, var(--accent) 16%, transparent)" : m.selected === e.path ? "var(--ed-selected)" : undefined }}>
      {e.isDir
        ? <span className="faint" style={{ width: 10, flex: "none", display: "inline-flex", justifyContent: "center", transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }}>
            <SFSymbol name="chevron.right" size={9} weight="semibold" fallback={<ChevronRight size={10} />} />
          </span>
        : <span style={{ width: 10, flex: "none" }} />}
      <FileIcon name={e.name} isDir={e.isDir} open={open} />
      {m.renaming === e.path ? (
        <NameField initial={e.name} onDone={async (v) => {
          if (v == null) { useExplorer.setState({ renaming: null }); return; }
          const ws = useWorkspace.getState();
          const wasOpen = ws.tabs.some((t) => t.kind === "file" && t.path === e.path);
          const dest = await m.rename(e.path, v);
          if (dest && wasOpen) { await ws.closeTab({ kind: "file", path: e.path }); ws.open({ kind: "file", path: dest }); }
        }} />
      ) : (
        <>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: statusColor(st) }}>{filtering ? rel : e.name}</span>
          {st ? <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: statusColor(st) }}>{st === "created" ? "A" : st === "deleted" ? "D" : "M"}</span>
            : e.isDir && changedDirs.has(rel) ? <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--warn)", opacity: 0.7 }} /> : null}
        </>
      )}
    </div>
  );
}

function CreationRow({ depth, folder }: { depth: number; folder: boolean }) {
  const [name, setName] = useState("");
  return (
    <div style={{ height: 26, display: "flex", alignItems: "center", gap: 5, paddingLeft: depth * 14 + 8, paddingRight: 10 }}>
      <span style={{ width: 10 }} />
      <FileIcon name={name} isDir={folder} open={false} />
      <NameField initial="" placeholder={folder ? "Folder name" : "File name (folders with /)"} onChange={setName}
        onDone={async (v) => {
          if (v == null) { useExplorer.setState({ creating: null }); return; }
          const path = await useExplorer.getState().create(v);
          if (path) useWorkspace.getState().open({ kind: "file", path });
        }} />
    </div>
  );
}

function NameField({ initial, placeholder, onDone, onChange }: { initial: string; placeholder?: string; onDone: (v: string | null) => void; onChange?: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, []);
  const finish = (v: string | null) => { if (done.current) return; done.current = true; onDone(v); };
  return (
    <input ref={ref} className="text-field" style={{ height: 20, fontSize: 12.5, padding: "0 5px" }} defaultValue={initial} placeholder={placeholder} aria-label={placeholder ?? "Name"}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") finish(e.currentTarget.value); if (e.key === "Escape") finish(null); }}
      onBlur={(e) => finish(e.currentTarget.value.trim() ? e.currentTarget.value : null)} />
  );
}

// ---- Context menus ----------------------------------------------------------------------

function rel(path: string) {
  const root = useWorkspace.getState().root;
  return path === root ? "." : relativePath(root, path);
}

function attach(kind: "file" | "folder", path: string) {
  const a = useIntegration.getState().attachToChat;
  if (a) a({ kind, path: rel(path) });
}

function commonItems(path: string): MenuEntry[] {
  return [
    { label: `Reveal in ${finder}`, onClick: () => appApi.reveal(path) },
    { label: "Copy Path", onClick: () => copy(path) },
    { label: "Copy Relative Path", onClick: () => copy(rel(path)) },
  ];
}

function fileMenu(path: string): MenuEntry[] {
  const m = useExplorer.getState(), ws = useWorkspace.getState();
  const changed = m.status[rel(path)] || useIntegration.getState().changes?.some((c) => c.path === rel(path));
  return [
    { label: "Open", onClick: () => ws.open({ kind: "file", path }) },
    { label: "Open with Default App", onClick: () => appApi.open(path) },
    ...(/\.html?$/i.test(path) ? [{ label: "Open in Browser", onClick: () => appApi.open(path) }] : []),
    { label: "Add to Chat", disabled: !useIntegration.getState().attachToChat, onClick: () => attach("file", path) },
    ...(changed ? [{ label: "Show Changes", onClick: () => ws.open({ kind: "diff", path: rel(path) }) }] : []),
    "divider",
    { label: "New File…", onClick: () => m.beginCreate(false, dirname(path)) },
    { label: "New Folder…", onClick: () => m.beginCreate(true, dirname(path)) },
    "divider",
    { label: "Rename…", onClick: () => useExplorer.setState({ renaming: path }) },
    { label: "Duplicate", onClick: () => void m.duplicate(path) },
    { label: "Move to Trash", onClick: async () => { if (await m.trash(path)) { if (ws.editor?.isDirty(path)) ws.editor.discard(path); void useWorkspace.getState().closeTab({ kind: "file", path }); } } },
    "divider",
    ...commonItems(path),
  ];
}

function folderMenu(path: string): MenuEntry[] {
  const m = useExplorer.getState(), ws = useWorkspace.getState();
  return [
    { label: "New File…", onClick: () => m.beginCreate(false, path) },
    { label: "New Folder…", onClick: () => m.beginCreate(true, path) },
    "divider",
    { label: "Add to Chat", disabled: !useIntegration.getState().attachToChat, onClick: () => attach("folder", path) },
    { label: "Find in Folder…", onClick: () => { ws.set({ searchInclude: path === ws.root ? "" : rel(path) + "/" }); ws.showSidebar("search"); } },
    { label: "Open in Terminal", onClick: () => runInTerminal(`cd ${shellQuote(path)}`, basename(path)) },
    ...(path !== ws.root ? ["divider" as const, { label: "Rename…", onClick: () => useExplorer.setState({ renaming: path }) }, { label: "Move to Trash", onClick: () => void m.trash(path) }] : []),
    "divider",
    ...commonItems(path),
  ];
}
