// Quick Open (⌘P) and the command palette (⇧⌘P), as one floating panel (Palette.swift).
// The palette lists every registered command that has a title (lib/commands.ts).

import { useEffect, useMemo, useRef, useState } from "react";
import { Command as CommandIcon, FileSearch, FileText, TerminalSquare } from "lucide-react";
import { basename, dirname, joinPath, relativePath } from "../../lib/api";
import { runCommand, useCommands } from "../../lib/commands";
import { useWorkspace, type Overlay } from "../../state/workspace";
import { fileIndex } from "./fileIndex";
import { SFSymbol } from "../../ui/icons";

/** The SF Symbol Palette.swift shows for the same command (the rest get `command`). */
const COMMAND_SYMBOLS: Record<string, string> = {
  "quick-open": "doc.text.magnifyingglass", "find-in-files": "magnifyingglass", "sidebar-search": "magnifyingglass", "open-search-page": "magnifyingglass",
  "toggle-terminal": "terminal", "terminal-new": "terminal", "source-control": "arrow.triangle.branch", "sidebar-git": "arrow.triangle.branch",
  "git-push": "arrow.up", "git-pull": "arrow.down", "git-review": "checklist.checked", "open-rules": "text.book.closed", "welcome": "sparkles",
  "agent-focus": "text.bubble", "toggle-agent": "text.bubble", "appearance-light": "sun.max", "appearance-dark": "moon", "appearance-system": "circle.lefthalf.filled",
  "run-run": "play.fill", "run-test": "checkmark.diamond", "run-build": "hammer", "sidebar-files": "folder", "new-diagram": "point.3.connected.trianglepath.dotted",
  "new-file": "doc.badge.plus", "new-folder": "folder.badge.plus", "format-document": "text.alignleft", "toggle-word-wrap": "arrow.turn.down.left",
  "toggle-minimap": "sidebar.squares.right", "agent-continue": "play.fill", "git-new-branch": "arrow.triangle.branch", "git-switch-branch": "arrow.triangle.branch",
};

interface Item { id: string; title: string; detail: string; icon: React.ReactNode; run: () => void }

/** Quick-open ranking (exact name, name prefix, name contains, path contains, subsequence). */
export function rankFiles(all: string[], query: string, limit = 60): string[] {
  const q = query.toLowerCase();
  const scored: [string, number][] = [];
  for (const path of all) {
    const lower = path.toLowerCase(), name = basename(lower);
    let score: number | null = null;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 10 + name.length;
    else if (name.includes(q)) score = 100 + name.length;
    else if (lower.includes(q)) score = 1000 + path.length;
    else {
      let i = 0, ok = true;
      for (const c of q) { const f = lower.indexOf(c, i); if (f < 0) { ok = false; break; } i = f + 1; }
      if (ok) score = 5000 + path.length;
    }
    if (score != null) scored.push([path, score]);
  }
  return scored.sort((a, b) => a[1] - b[1]).slice(0, limit).map((s) => s[0]);
}

export function Palette({ mode }: { mode: Exclude<Overlay, null> }) {
  const root = useWorkspace((s) => s.root);
  const tabs = useWorkspace((s) => s.tabs);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const commands = useCommands();
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => useWorkspace.getState().set({ overlay: null });

  useEffect(() => { if (mode === "quickOpen") fileIndex(root).then(setFiles); }, [mode, root]);
  useEffect(() => { setQuery(""); setIndex(0); }, [mode]);

  const items: Item[] = useMemo(() => {
    if (mode === "quickOpen") {
      let ranked: string[];
      if (!query) {
        const open = tabs.flatMap((t) => (t.kind === "file" ? [relativePath(root, t.path)] : [])).reverse();
        ranked = [...open, ...files.slice(0, 50)];
      } else ranked = rankFiles(files, query);
      return [...new Set(ranked)].map((rel) => ({
        id: rel, title: basename(rel), detail: rel.includes("/") ? dirname(rel) : "", icon: <SFSymbol name="doc" size={12} fallback={<FileText size={14} />} />,
        run: () => useWorkspace.getState().open({ kind: "file", path: joinPath(root, rel) }),
      }));
    }
    const q = query.toLowerCase();
    return commands
      .filter(([, c]) => c.title && (c.enabled?.() ?? true) && (!q || c.title.toLowerCase().includes(q) || (c.group ?? "").toLowerCase().includes(q)))
      .sort((a, b) => (a[1].group ?? "").localeCompare(b[1].group ?? "") || a[1].title!.localeCompare(b[1].title!))
      .map(([id, c]) => ({
        id, title: c.title!, detail: [c.shortcut, c.group].filter(Boolean).join("  ·  "),
        icon: <SFSymbol name={COMMAND_SYMBOLS[id] ?? (id.startsWith("run-") ? "terminal" : "command")} size={12} fallback={id.startsWith("run-") ? <TerminalSquare size={14} /> : <CommandIcon size={14} />} />, run: () => runCommand(id),
      }));
  }, [mode, query, files, commands, tabs, root]);

  useEffect(() => { listRef.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" }); }, [index]);

  const pick = (i = index) => {
    const it = items[i];
    if (!it) return;
    close();
    it.run();
  };

  return (
    <div className="modal-backdrop" style={{ background: "transparent", paddingTop: "calc(var(--toolbar-h) + 60px)" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label={mode === "quickOpen" ? "Go to file" : "Command palette"}
        style={{ width: 620, maxWidth: "calc(100vw - 32px)", background: "color-mix(in srgb, var(--window) 88%, transparent)", backdropFilter: "blur(30px) saturate(1.8)", WebkitBackdropFilter: "blur(30px) saturate(1.8)",
          borderRadius: 14, border: "1px solid var(--hairline)", boxShadow: "0 12px 60px rgba(0,0,0,0.25)", overflow: "hidden", alignSelf: "flex-start" }}>
        <div className="row" style={{ padding: 12 }}>
          <span className="muted" style={{ display: "inline-flex" }}>
            {mode === "quickOpen" ? <SFSymbol name="doc.text.magnifyingglass" size={13} fallback={<FileSearch size={16} />} /> : <SFSymbol name="command" size={13} fallback={<CommandIcon size={16} />} />}
          </span>
          <input autoFocus aria-label={mode === "quickOpen" ? "Go to file" : "Run a command"} placeholder={mode === "quickOpen" ? "Go to file…" : "Run a command…"}
            value={query} onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0))); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); pick(); }
              else if (e.key === "Escape") { e.preventDefault(); close(); }
            }}
            style={{ flex: 1, border: 0, outline: "none", background: "transparent", fontSize: 15 }} />
        </div>
        <div style={{ height: 1, background: "var(--hairline-strong)" }} />
        <div ref={listRef} role="listbox" style={{ maxHeight: 360, overflow: "auto", padding: 6 }}>
          {items.map((it, i) => (
            <div key={it.id} data-i={i} role="option" aria-selected={i === index} onMouseMove={() => i !== index && setIndex(i)} onClick={() => pick(i)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderRadius: 7, fontSize: 12, background: i === index ? "color-mix(in srgb, var(--accent) 14%, transparent)" : undefined }}>
              <span className="muted" style={{ width: 18, display: "flex", justifyContent: "center", flex: "none" }}>{it.icon}</span>
              <span style={{ whiteSpace: "nowrap" }}>{it.title}</span>
              <span className="faint" style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: mode === "quickOpen" ? "rtl" : undefined, textAlign: "left" }}>
                {mode === "quickOpen" ? "‎" + it.detail : it.detail}
              </span>
            </div>
          ))}
          {items.length === 0 && <div className="caption" style={{ padding: "10px 12px" }}>{mode === "quickOpen" ? "No matching files" : "No matching commands"}</div>}
        </div>
      </div>
    </div>
  );
}
