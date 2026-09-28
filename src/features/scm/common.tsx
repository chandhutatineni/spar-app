import type { CSSProperties, ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Spinner } from "../../ui";
import { SFSymbol } from "../../ui/icons";

/** An SF Symbol as the Swift view names it; `fb` is drawn off macOS. `size` is the SwiftUI
 *  point size of the symbol (its `.font` size). */
export const Sym = ({ n, s = 13, w = "regular", fb = null, style }: { n: string; s?: number; w?: string; fb?: ReactNode; style?: CSSProperties }) =>
  <SFSymbol name={n} size={s} weight={w} fallback={fb} style={style} />;

export const statusLetter = (s: string) => (s === "created" ? "A" : s === "deleted" ? "D" : "M");
export const statusColor = (s: string) => (s === "created" ? "var(--done)" : s === "deleted" ? "var(--stop)" : "var(--warn)");

export function StatusLetter({ status, size = 10 }: { status: string; size?: number }) {
  return <span className="mono" style={{ fontSize: size, fontWeight: 700, color: statusColor(status), width: 12, textAlign: "center", flex: "none" }}>{statusLetter(status)}</span>;
}

export function ErrorText({ children, lines = 3 }: { children: ReactNode; lines?: number }) {
  return (
    <div className="selectable scm-clamp" style={{ fontSize: 10, color: "var(--stop)", WebkitLineClamp: lines, display: "-webkit-box", WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" }}>
      {children}
    </div>
  );
}

export function StateLine({ error, info, icons }: { error: string | null; info: string | null; icons?: boolean }) {
  if (error) return (
    <div className="row" style={{ gap: 5, alignItems: "flex-start", minWidth: 0 }}>
      {icons && <span style={{ color: "var(--stop)", display: "inline-flex", flex: "none", marginTop: 1 }}><Sym n="exclamationmark.triangle.fill" s={10} fb={<AlertTriangle size={12} />} /></span>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
  if (info) return (
    <div className="row" style={{ gap: 5, fontSize: 10, color: "var(--done)", minWidth: 0 }}>
      {icons && <Sym n="checkmark.circle.fill" s={10} fb={<CheckCircle2 size={12} />} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{info}</span>
    </div>
  );
  return null;
}

export const Busy = ({ label }: { label: string | null }) => (label ? <span className="row muted" style={{ gap: 6, fontSize: 12 }}><Spinner small />{label}…</span> : null);

export const dir = (p: string) => p.split("/").slice(0, -1).join("/");
export const base = (p: string) => p.split("/").pop() ?? p;
