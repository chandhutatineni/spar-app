// Source control in the sidebar (GitSidebar.swift): branch, sync, commit, and each changed
// file with stage and discard. The full hunk-level review opens as a tab.

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, CloudUpload, GitBranch, Minus, Plus, Undo2, X } from "lucide-react";
import { Button, Spinner, contextMenu, showMenu, type MenuEntry } from "../../ui";
import { useWorkspace } from "../../state/workspace";
import { joinPath } from "../../lib/api";
import type { Change } from "./api";
import { base, dir, ErrorText, StatusLetter, Sym } from "./common";
import { FileIcon } from "../editor/FileIcon";
import { GitHubConnectSheet } from "./GitHubConnect";
import { useGitHubUser } from "./github";
import * as scm from "./store";
import * as peers from "./peers";

export function GitSidebar(_p: any) {
  const g = scm.useScm();
  const user = useGitHubUser();
  const [message, setMessage] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const ws = useWorkspace.getState;

  if (g.isRepo === null) return <div className="empty"><Spinner /></div>;
  if (!g.isRepo) {
    return (
      <div className="empty" style={{ gap: 10 }}>
        <div className="headline">Not a Git repository</div>
        <Button kind="primary" onClick={scm.initialize}>Initialize repository</Button>
      </div>
    );
  }

  const gh = scm.github();
  const canCommit = !!message.trim() && g.changes.length > 0 && !g.busy;
  const doCommit = async (push = false) => {
    const text = message;
    if (!text.trim()) return;
    if (await scm.commit(text)) {
      setMessage("");
      if (push && scm.useScm.getState().remoteUrl) await scm.push();
    }
  };

  const branchMenu = (): MenuEntry[] => [
    ...g.branches.map((b) => ({ label: b, checked: b === g.branch, disabled: b === g.branch, onClick: () => scm.switchBranch(b) })),
    "divider",
    { label: "More in Source Control…", onClick: () => ws().open({ kind: "sourceControl" }) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }} aria-label="Source control sidebar">
      <div className="col" style={{ gap: 6, padding: "8px 12px 6px" }}>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="scm-menu" style={{ fontSize: 12, fontWeight: 600 }} title="Switch branch"
            onMouseDown={(e) => { e.stopPropagation(); showMenu(branchMenu(), e.currentTarget); }}>
            <Sym n="arrow.triangle.branch" s={12} fb={<GitBranch size={13} />} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{g.branch ?? "detached"}</span>
            <span className="muted" style={{ display: "inline-flex" }}><Sym n="chevron.down" s={8} w="semibold" fb={<ChevronDown size={10} />} /></span>
          </button>
          <div className="spacer" />
          {g.busy && <Spinner small />}
          {g.remoteUrl ? (
            <>
              <button type="button" className="scm-bl" title={g.behind > 0 ? `Pull ${g.behind} commit(s)` : "Pull"} aria-label="Pull" disabled={!!g.busy} onClick={scm.pull}><Sym n="arrow.down" s={13} fb={<ArrowDown size={14} />} /></button>
              <button type="button" className="scm-bl" title={g.ahead > 0 ? `Push ${g.ahead} commit(s)` : "Push"} aria-label="Push" disabled={!!g.busy} onClick={scm.push}><Sym n="arrow.up" s={13} fb={<ArrowUp size={14} />} /></button>
            </>
          ) : (
            <button type="button" className="scm-bl" title="Publish to GitHub" aria-label="Publish to GitHub" onClick={() => ws().open({ kind: "sourceControl" })}><Sym n="icloud.and.arrow.up" s={13} fb={<CloudUpload size={14} />} /></button>
          )}
        </div>
        {gh && <div className="muted" style={{ fontSize: 10 }}>{gh.owner}/{gh.repo}{g.ahead > 0 ? ` · ↑${g.ahead}` : ""}{g.behind > 0 ? ` · ↓${g.behind}` : ""}</div>}
        {!gh && g.remoteUrl && (g.ahead > 0 || g.behind > 0) && <div className="muted" style={{ fontSize: 10 }}>{g.ahead > 0 ? `↑${g.ahead}` : ""}{g.ahead > 0 && g.behind > 0 ? " · " : ""}{g.behind > 0 ? `↓${g.behind}` : ""}</div>}
        {g.lastError ? (
          <>
            <ErrorText>{g.lastError}</ErrorText>
            {!user && g.lastError.includes("sign in") && <button type="button" className="scm-link" style={{ fontSize: 10, alignSelf: "flex-start" }} onClick={() => setShowConnect(true)}>Connect GitHub</button>}
          </>
        ) : g.lastInfo ? (
          <div style={{ fontSize: 10, color: "var(--done)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{g.lastInfo}</div>
        ) : null}
      </div>

      <div className="col" style={{ gap: 6, padding: "0 12px 8px" }}>
        <textarea className="text-area" rows={Math.min(5, Math.max(1, message.split("\n").length))} placeholder="Message (⌘↩ to commit)" value={message}
          aria-label="Commit message" onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (canCommit) doCommit(); } }}
          style={{ fontSize: 11, lineHeight: "14px", padding: "3px 6px", borderRadius: 5, resize: "none", minHeight: 22 }} />
        {/* SwiftUI centres a bordered button in its maxWidth frame; the whole row is disabled together. */}
        <div className="row" style={{ gap: 6 }}>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <Button kind="primary" size="small" disabled={!canCommit} onClick={() => doCommit()}>
              {g.staged.size === 0 ? "Commit All" : `Commit ${g.staged.size}`}
            </Button>
          </div>
          <button type="button" className="scm-bl" title="More commit actions" aria-label="More commit actions" disabled={!canCommit}
            onMouseDown={(e) => {
              e.stopPropagation();
              showMenu([
                { label: "Commit & Push", onClick: () => doCommit(true) },
                { label: "Suggest Message", onClick: () => setMessage(scm.suggestedMessage("sidebar")) },
              ], e.currentTarget);
            }}>
            <Sym n="chevron.down" s={11} fb={<ChevronDown size={12} />} />
          </button>
        </div>
      </div>
      <div style={{ height: 0.5, background: "var(--hairline-strong)", flex: "none" }} />

      <div className="row" style={{ padding: "6px 12px", gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600 }} className="muted">CHANGES</span>
        <span className="faint" style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}>{g.changes.length}</span>
        <div className="spacer" />
        <button type="button" className="scm-link" style={{ fontSize: 10 }} disabled={!g.changes.length} onClick={() => scm.openReview()}>Review all</button>
      </div>
      <div style={{ flex: 1, overflow: "auto" }} role="list" aria-label="Changes">
        {g.changes.map((c) => <Row key={c.path} change={c} staged={g.staged.has(c.path)} />)}
      </div>
      {showConnect && <GitHubConnectSheet onClose={() => setShowConnect(false)} />}
    </div>
  );
}

function Row({ change, staged }: { change: Change; staged: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const ws = useWorkspace.getState;
  const open = () => ws().open({ kind: "diff", path: change.path });
  const menu = contextMenu(() => [
    { label: "Open File", onClick: () => ws().openFile(joinPath(ws().root, change.path)) },
    { label: "Open Changes", onClick: open },
    { label: "Add to Chat", onClick: () => peers.attach(joinPath(ws().root, change.path)) },
  ]);
  return (
    <div role="listitem" className="scm-row" data-path={change.path} onClick={open} onContextMenu={menu}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", fontSize: 12, background: staged ? "color-mix(in srgb, var(--done) 6%, transparent)" : undefined }}>
      <FileIcon name={change.path} isDir={false} open={false} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{base(change.path)}</div>
        {dir(change.path) && <div className="faint" style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dir(change.path)}</div>}
      </div>
      <div className="row" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
        {confirm ? (
          <>
            <button type="button" className="scm-bl" style={{ color: "var(--stop)", fontSize: 12 }} onClick={() => { setConfirm(false); scm.discard(change.path); }}>Discard</button>
            <button type="button" className="scm-bl" title="Keep the changes" aria-label="Keep the changes" onClick={() => setConfirm(false)}><Sym n="xmark" s={12} fb={<X size={12} />} /></button>
          </>
        ) : (
          <>
            <button type="button" className="scm-bl" title="Discard changes" aria-label="Discard changes" onClick={() => setConfirm(true)}><Sym n="arrow.uturn.backward" s={12} fb={<Undo2 size={12} />} /></button>
            <button type="button" className="scm-bl" title={staged ? "Unstage" : "Stage"} aria-label={staged ? "Unstage" : "Stage"} onClick={() => scm.toggleStage(change.path)}>{staged ? <Sym n="minus" s={12} fb={<Minus size={12} />} /> : <Sym n="plus" s={12} fb={<Plus size={12} />} />}</button>
            <StatusLetter status={change.status} />
          </>
        )}
      </div>
    </div>
  );
}
