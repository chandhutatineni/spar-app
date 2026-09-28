// Every change against HEAD in one place (ReviewView.swift). Accept stages a file or hunk;
// reject reverts it (new files go to the Trash). Without a repository, or when git sees
// nothing, it reviews what the last agent turn changed since its checkpoint.

import { useEffect, useState } from "react";
import { Check, CheckCircle2, ChevronRight, RotateCw, Undo2, X } from "lucide-react";
import { Button, Spinner } from "../../ui";
import { useWorkspace } from "../../state/workspace";
import { joinPath } from "../../lib/api";
import type { FileDiff, Hunk } from "./api";
import { StatusLetter, Sym } from "./common";
import * as peers from "./peers";
import { accept, acceptAll, loadReview, reject, rejectAll, undoRestore, useScm } from "./store";

export function ReviewView(_p: { embedded?: boolean } = {}) {
  const files = useScm((s) => s.review);
  const mine = useScm((s) => s.restoredUndo);
  const theirs = peers.usePeerField<string>("restoredUndo");
  const restoredUndo = mine ?? theirs;
  const branch = useScm((s) => s.branch);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => { loadReview(); }, []);

  const list = files ?? [];
  const added = list.reduce((n, f) => n + f.added, 0), removed = list.reduce((n, f) => n + f.removed, 0);
  const toggle = (p: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" }} aria-label="Review changes">
      <div className="row" style={{ gap: 12, padding: "12px 20px", flex: "none" }}>
        <div className="col" style={{ gap: 2, fontSize: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Review changes</div>
          <div>
            <span className="muted">{list.length} file{list.length === 1 ? "" : "s"} · </span><span style={{ color: "var(--done)" }}>+{added}</span>{"  "}<span style={{ color: "var(--stop)" }}>−{removed}</span>
          </div>
        </div>
        <div className="spacer" />
        {restoredUndo && <Button icon={<Sym n="arrow.uturn.backward" s={13} fb={<Undo2 size={13} />} />} onClick={undoRestore}>Undo</Button>}
        <Button title="Refresh" onClick={() => loadReview()} style={{ padding: "0 8px" }}><span aria-label="Refresh" style={{ display: "inline-flex" }}><Sym n="arrow.clockwise" s={13} fb={<RotateCw size={14} />} /></span></Button>
        <Button onClick={rejectAll} disabled={!list.length} style={{ color: "var(--stop)" }}>Reject all</Button>
        <Button kind="primary" icon={<Sym n="checkmark" s={13} fb={<Check size={13} />} />} onClick={acceptAll} disabled={!list.length} style={{ background: "var(--done)" }}>Accept all</Button>
      </div>
      <div style={{ height: 0.5, background: "var(--hairline-strong)", flex: "none" }} />
      {files == null ? (
        <div className="empty"><Spinner /></div>
      ) : list.length === 0 ? (
        <div className="empty">
          <span style={{ color: "var(--done)", display: "inline-flex" }}><Sym n="checkmark.circle" s={30} w="light" fb={<CheckCircle2 size={30} strokeWidth={1.3} />} /></span>
          <div className="headline">Nothing to review</div>
          <div className="muted">{branch == null ? "Nothing has changed since the last agent turn began." : "The working tree matches the last commit."}</div>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          {list.map((f) => <FileCard key={f.path} file={f} collapsed={collapsed.has(f.path)} onToggle={() => toggle(f.path)} />)}
        </div>
      )}
    </div>
  );
}

function FileCard({ file, collapsed, onToggle }: { file: FileDiff; collapsed: boolean; onToggle: () => void }) {
  const root = useWorkspace((s) => s.root);
  return (
    <div className="scm-card" data-path={file.path}>
      <div className="row" style={{ gap: 10, padding: "9px 12px", background: "var(--subtle)" }}>
        <button type="button" className="scm-menu muted" style={{ width: 12, justifyContent: "center", color: "var(--text-2)" }} onClick={onToggle} aria-label={collapsed ? "Expand" : "Collapse"}>
          <span style={{ display: "inline-flex", transform: collapsed ? undefined : "rotate(90deg)", transition: "transform .15s" }}><Sym n="chevron.right" s={11} fb={<ChevronRight size={12} />} /></span>
        </button>
        <StatusLetter status={file.status} size={10} />
        <button type="button" className="scm-menu mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left", display: "block" }}
          onClick={() => useWorkspace.getState().openFile(joinPath(root, file.path))}><bdi>{file.path}</bdi></button>
        <span className="mono" style={{ fontSize: 10, color: "var(--done)", flex: "none" }}>+{file.added}</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--stop)", flex: "none" }}>−{file.removed}</span>
        {file.staged && <span className="row" style={{ gap: 3, fontSize: 10, color: "var(--done)", flex: "none" }}><Sym n="checkmark.circle.fill" s={10} fb={<CheckCircle2 size={11} />} />Accepted</span>}
        <div className="spacer" />
        <Button size="small" onClick={() => reject(file)}>Reject</Button>
        <Button size="small" onClick={() => accept(file)} disabled={file.staged}>Accept</Button>
      </div>
      {!collapsed && file.hunks.map((h) => <HunkView key={h.id} file={file} hunk={h} />)}
    </div>
  );
}

const kindColor = (k: string) => (k === "+" ? "var(--done)" : k === "-" ? "var(--stop)" : "var(--text-2)");
const kindBg = (k: string) => (k === "+" ? "color-mix(in srgb, var(--done) 10%, transparent)" : k === "-" ? "color-mix(in srgb, var(--stop) 10%, transparent)" : "transparent");

function HunkView({ file, hunk }: { file: FileDiff; hunk: Hunk }) {
  return (
    <div>
      <div className="row" style={{ padding: "4px 12px", background: "color-mix(in srgb, var(--accent) 4%, transparent)", minHeight: 22 }}>
        <span className="mono muted" style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hunk.header}</span>
        <div className="spacer" />
        {file.hunks.length > 1 && (
          <>
            <button type="button" className="scm-bl" title="Reject this change" aria-label="Reject this change" onClick={() => reject(file, hunk)}><Sym n="xmark" s={11} fb={<X size={12} />} /></button>
            <button type="button" className="scm-bl" title="Accept this change" aria-label="Accept this change" onClick={() => accept(file, hunk)}><Sym n="checkmark" s={11} fb={<Check size={12} />} /></button>
          </>
        )}
      </div>
      <div className="selectable" style={{ overflowX: "auto" }}>
        <div style={{ minWidth: "max(600px, 100%)", width: "max-content" }}>
          {hunk.lines.slice(0, 400).map((line, i) => {
            const k = line[0] ?? " ";
            return (
              <div key={i} className="mono" style={{ display: "flex", gap: 8, fontSize: 11.5, padding: "0.5px 12px", background: kindBg(k), whiteSpace: "pre", minWidth: "100%" }}>
                <span style={{ width: 10, color: kindColor(k), flex: "none" }}>{k === "\\" ? " " : k}</span>
                <span>{line.slice(1) || " "}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
