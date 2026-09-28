// The diff page for Doc kind "diff" (DiffView in EditorArea.swift): HEAD against the
// working tree in a git repository, else the agent session's own before/after, as one
// unified list of lines (Swift's own Myers line diff, see linediff.ts).

import { useEffect, useMemo, useState } from "react";
import { Button, Spinner } from "../../ui";
import { useWorkspace } from "../../state/workspace";
import { joinPath } from "../../lib/api";
import { engine } from "../../engine/client";
import { onFilesChanged } from "../../state/app";
import { git } from "./api";
import { lineDiff, type DiffLine } from "./linediff";
import * as peers from "./peers";

async function versions(root: string, path: string): Promise<{ before: string; after: string } | null> {
  if ((await git.changes(root).catch(() => null)) != null) {
    const v = await git.versions(root, path);
    return { before: v.before ?? "", after: v.after ?? "" };
  }
  await peers.ready();
  const id = peers.sessionId();
  if (!id) return null;
  const v = await engine.diff(id, path).catch(() => null);
  return v ? { before: v.before ?? "", after: v.after ?? "" } : null;
}

const color = (k: string) => (k === "+" ? "var(--done)" : k === "-" ? "var(--stop)" : "var(--text-2)");
const tint = (k: string) => (k === "+" ? "color-mix(in srgb, var(--done) 10%, transparent)" : k === "-" ? "color-mix(in srgb, var(--stop) 10%, transparent)" : undefined);

/** Diff of a workspace-relative path. */
export function DiffView({ path }: { path: string }) {
  const root = useWorkspace((s) => s.root);
  const [lines, setLines] = useState<DiffLine[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => onFilesChanged((paths) => { if (paths.some((p) => p.endsWith("/" + path) || p === path || p.includes("/.git"))) setVersion((v) => v + 1); }), [path]);
  useEffect(() => {
    let cancelled = false;
    versions(root, path).catch(() => null).then((v) => { if (!cancelled) setLines(v ? lineDiff(v.before, v.after) : []); });
    return () => { cancelled = true; };
  }, [root, path, version]);

  const counts = useMemo(() => ({
    added: lines?.filter((l) => l.kind === "+").length ?? 0,
    removed: lines?.filter((l) => l.kind === "-").length ?? 0,
  }), [lines]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, flex: 1, background: "var(--bg)" }} aria-label={`Changes in ${path}`}>
      <div className="row" style={{ gap: 8, padding: "7px 16px", flex: "none" }}>
        <span className="mono muted" style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{path}</span>
        <div className="spacer" />
        <span className="mono" style={{ fontSize: 10, color: "var(--done)" }} data-testid="diff-added">+{counts.added}</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--stop)" }} data-testid="diff-removed">−{counts.removed}</span>
        <Button size="small" onClick={() => useWorkspace.getState().openFile(joinPath(root, path))}>Open file</Button>
      </div>
      <div style={{ height: 0.5, background: "var(--hairline-strong)", flex: "none" }} />
      {lines == null ? (
        <div className="empty"><Spinner /></div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div className="selectable mono" style={{ padding: "10px 0", minWidth: "100%", width: "max-content", fontSize: 11.5, lineHeight: "14px" }} data-testid="diff-lines">
            {lines.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "1px 14px", background: tint(l.kind), whiteSpace: "pre" }}>
                <span style={{ width: 12, flex: "none", color: color(l.kind) }}>{l.kind}</span>
                <span>{l.text || " "}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
