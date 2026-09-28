// Small, colour-coded file-type icons (FileIcon in Explorer.swift): the same SF Symbol and
// colour per file type, at .font(.system(size: 11.5)) in a 16pt-wide frame.

import {
  Book, Box, Braces, Brush, ChevronsLeftRight, Container, Database, File, FileCode, FileText, Folder, FolderCog, FolderOpen,
  GitBranch, Image, Lock, RefreshCcw, Settings, SquareTerminal,
} from "lucide-react";
import type { ReactNode } from "react";
import { SFSymbol } from "../../ui/icons";
import "./editor.css";

const letter = (ch: string, color: string) => (
  <span style={{ width: 12, height: 12, borderRadius: 2.5, border: `1.3px solid ${color}`, color, fontSize: 7.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>{ch}</span>
);

const BLUE_FOLDER = "rgb(92,153,230)"; // Color(red: 0.36, green: 0.6, blue: 0.9)

/** [SF Symbol, colour, fallback icon off macOS]. */
export function fileIconStyle(name: string, isDir: boolean, open: boolean): [string, string, ReactNode] {
  const s = 12;
  if (isDir) {
    if (name === ".spar" || name === "spar") return ["arrow.triangle.2.circlepath", "var(--accent)", <RefreshCcw size={s} />];
    if (name === ".github") return ["folder.badge.gearshape", "var(--text-2)", <FolderCog size={s} />];
    return open ? ["folder", BLUE_FOLDER, <FolderOpen size={s} />] : ["folder.fill", BLUE_FOLDER, <Folder size={s} fill="currentColor" fillOpacity={0.85} />];
  }
  const lower = name.toLowerCase();
  if (["package.json", "cargo.toml", "pyproject.toml", "package.swift"].includes(lower)) return ["shippingbox", "var(--sys-brown)", <Box size={s} />];
  if (lower.startsWith("readme")) return ["book", "var(--sys-blue)", <Book size={s} />];
  if (lower === "dockerfile") return ["cube", "var(--sys-blue)", <Container size={s} />];
  if (lower.startsWith(".git")) return ["arrow.triangle.branch", "var(--sys-orange)", <GitBranch size={s} />];
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  switch (ext) {
    case "swift": return ["swift", "var(--sys-orange)", <FileCode size={s} />];
    case "ts": case "tsx": return ["t.square", "rgb(48,120,199)", letter("T", "rgb(48,120,199)")];
    case "js": case "jsx": case "mjs": case "cjs": return ["j.square", "rgb(217,179,26)", letter("J", "rgb(217,179,26)")];
    case "json": case "jsonl": return ["curlybraces", "var(--sys-yellow)", <Braces size={s} />];
    case "py": return ["p.square", "rgb(56,117,171)", letter("P", "rgb(56,117,171)")];
    case "rs": return ["r.square", "var(--sys-brown)", letter("R", "var(--sys-brown)")];
    case "go": return ["g.square", "var(--sys-cyan)", letter("G", "var(--sys-cyan)")];
    case "html": case "htm": return ["chevron.left.forwardslash.chevron.right", "var(--sys-orange)", <ChevronsLeftRight size={s} />];
    case "css": case "scss": case "less": return ["paintbrush", "var(--sys-purple)", <Brush size={s} />];
    case "md": case "mdc": case "markdown": return ["doc.richtext", "var(--text-2)", <FileText size={s} />];
    case "yaml": case "yml": case "toml": case "ini": return ["gearshape", "var(--text-2)", <Settings size={s} />];
    case "sh": case "bash": case "zsh": return ["terminal", "var(--sys-green)", <SquareTerminal size={s} />];
    case "png": case "jpg": case "jpeg": case "gif": case "svg": case "webp": case "ico": return ["photo", "var(--sys-pink)", <Image size={s} />];
    case "lock": return ["lock", "var(--text-2)", <Lock size={s} />];
    case "sql": return ["cylinder", "var(--sys-teal)", <Database size={s} />];
    default: return ["doc", "var(--text-2)", <File size={s} />];
  }
}

export function FileIcon({ name, isDir, open }: { name: string; isDir: boolean; open: boolean }) {
  const [symbol, color, fallback] = fileIconStyle(name, isDir, open);
  return (
    <span aria-hidden style={{ width: 16, flex: "none", display: "inline-flex", justifyContent: "center", alignItems: "center", color }}>
      <SFSymbol name={symbol} size={11.5} fallback={fallback} />
    </span>
  );
}
