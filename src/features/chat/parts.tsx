// Small shared pieces of the chat views: icons by name, the agent badge, markdown for
// messages (MarkdownView.swift, compact), phase glyphs and the loop ring.

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Marked } from "marked";
import { app as appApi } from "../../lib/api";
import { useWorkspace } from "../../state/workspace";
import {
  Asterisk, Code, UserCheck, Sparkle, Braces, Bird, Moon, SquareUser, Wind, Users, Cpu, RefreshCcw, Hand, ShieldCheck, Zap,
  Infinity as InfinityIcon, MessageSquare, ClipboardList, Bug, ScanSearch, Layers, Hammer, Package, Check, Box, Globe, BadgeCheck,
  type LucideIcon,
} from "lucide-react";
import { SFSymbol } from "../../ui/icons";
import type { AgentKind } from "./catalog";
import { PHASE, type Lifecycle } from "./sparcli";

const ICONS: Record<string, LucideIcon> = {
  Asterisk, Code, UserCheck, Sparkle, Braces, Bird, Moon, SquareUser, Wind, Users, Cpu, RefreshCcw, Hand, ShieldCheck, Zap,
  Infinity: InfinityIcon, MessageSquare, ClipboardList, Bug, ScanSearch, Layers, Hammer, Package, Check, Box, Globe, BadgeCheck,
};

export function Icon({ name, size = 14, style, className }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  const I = ICONS[name];
  if (I) return <I size={size} style={style} className={className} />;
  return <span style={{ fontWeight: 800, fontSize: size * 0.9, lineHeight: 1, ...style }} className={className}>{name.slice(0, 1)}</span>;
}

/** The Mac app's SF Symbol for each icon name the chat catalog uses (agents, modes,
 *  interactions, phases). Letters stand for a lettered circle, as in AgentCatalog.swift. */
export const SF_NAME: Record<string, string> = {
  Asterisk: "asterisk", Code: "chevron.left.forwardslash.chevron.right", UserCheck: "person.badge.shield.checkmark", Sparkle: "sparkle",
  Braces: "curlybraces", Bird: "bird", Moon: "moon", SquareUser: "person.crop.square", Wind: "wind", Users: "person.3", Cpu: "cpu",
  RefreshCcw: "arrow.triangle.2.circlepath", Hand: "hand.raised", ShieldCheck: "checkmark.shield", Zap: "bolt.fill", Infinity: "infinity",
  MessageSquare: "bubble.left", ClipboardList: "list.bullet.clipboard", Bug: "ladybug", ScanSearch: "sparkle.magnifyingglass",
  Layers: "square.on.square.dashed", Hammer: "hammer", Package: "shippingbox", Check: "checkmark", Globe: "globe", BadgeCheck: "checkmark.seal",
  Q: "q.circle", P: "p.circle", B: "b.circle.fill",
};

/** An icon by catalog name drawn as the Mac app's SF Symbol at a point size (SwiftUI
 *  `.font(.system(size: pt, weight:))`), with the lucide icon as the fallback. */
export function Sym({ name, pt, weight = "regular", style, className }: { name: string; pt: number; weight?: string; style?: CSSProperties; className?: string }) {
  const sf = SF_NAME[name] ?? (name.includes(".") ? name : undefined);
  const fb = <Icon name={name} size={Math.round(pt * 1.2)} style={style} className={className} />;
  return sf ? <SFSymbol name={sf} size={pt} weight={weight} style={style} className={className} fallback={fb} /> : fb;
}

/** AgentBadge in AgentPanel.swift: the agent's symbol, bold, white, on its tint's gradient. */
export function AgentBadge({ kind, size = 18 }: { kind: AgentKind; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: size * 0.28, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(180deg, color-mix(in srgb, ${kind.tint} 96%, white), color-mix(in srgb, ${kind.tint} 85%, black))`, color: "#fff" }}>
      <Sym name={kind.icon} pt={Math.round(size * 0.5 * 2) / 2} weight="bold" />
    </span>
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    // Raw HTML in a reply is shown as text, never rendered.
    html: (token: { text: string }) => esc(token.text),
    link(token: { href: string; text: string }) {
      const safe = /^(https?:|mailto:|#|\/|\.)/i.test(token.href) || !/^[a-z]+:/i.test(token.href);
      return safe ? `<a href="${esc(token.href)}" data-href="${esc(token.href)}">${esc(token.text)}</a>` : esc(token.text);
    },
  } as any,
});

/** Agent replies as markdown. Links open outside the app; raw HTML is escaped. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => {
    try { return md.parse(text, { async: false }) as string; } catch { return esc(text); }
  }, [text]);
  return (
    <div className={`chat-md selectable ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute("data-href") ?? "";
        if (/^(https?:|mailto:)/i.test(href)) appApi.open(href).catch(() => {});
        else if (href && !href.startsWith("#")) {
          const root = useWorkspace.getState().root;
          useWorkspace.getState().openFile(href.startsWith("/") ? href : `${root}/${href.replace(/^\.\//, "")}`);
        }
      }} />
  );
}

/** SwiftUI `Color.primary.opacity(a)` (--text is the label colour at 85%). */
export const prim = (a: number) => `color-mix(in srgb, var(--text) ${Math.min(100, (a / 0.85) * 100).toFixed(1)}%, transparent)`;

/** PhaseGlyph in PhaseView.swift: the phase symbol (or a checkmark) at size × 0.42, semibold. */
export function PhaseGlyph({ phase, state, size = 28 }: { phase: Lifecycle; state: string; size?: number }) {
  const tint = PHASE[phase].tint;
  const todo = state === "todo";
  return (
    <span style={{ width: size, height: size, borderRadius: size * 0.3, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: todo ? prim(0.04) : `linear-gradient(135deg, ${tint}, color-mix(in srgb, ${tint} 75%, transparent))`, color: todo ? "var(--text-2)" : "#fff" }}>
      <Sym name={state === "done" ? "Check" : PHASE[phase].icon} pt={Math.round(size * 0.42 * 2) / 2} weight="semibold" />
    </span>
  );
}

/** Four arcs, one per phase, coloured by state: a compact picture of the loop. */
export function LoopRing({ states, size = 18, lineWidth = 2.5 }: { states: string[]; size?: number; lineWidth?: number }) {
  // SwiftUI strokes the circle's own edge (half the line outside the frame), so r = size / 2.
  const r = size / 2;
  const c = size / 2;
  const phases: Lifecycle[] = ["discover", "design", "develop", "deliver"];
  const arc = (i: number) => {
    const a0 = (i * 0.25 + 0.025) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) * 0.25 - 0.025) * 2 * Math.PI - Math.PI / 2;
    return `M ${c + r * Math.cos(a0)} ${c + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${c + r * Math.cos(a1)} ${c + r * Math.sin(a1)}`;
  };
  return (
    <svg width={size} height={size} style={{ flex: "none", overflow: "visible" }} aria-hidden>
      {phases.map((p, i) => {
        const st = states[i] ?? "todo";
        const color = st === "done" ? PHASE[p].tint : st === "current" ? `color-mix(in srgb, ${PHASE[p].tint} 45%, transparent)` : prim(0.144);
        return <path key={p} d={arc(i)} fill="none" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" />;
      })}
    </svg>
  );
}

/** A small rounded card. */
export function Card({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return <div className={`card ${className ?? ""}`} style={{ padding: 14, ...style }}>{children}</div>;
}

export function Caps({ children, color }: { children: ReactNode; color?: string }) {
  return <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: color ?? "var(--text-3)", textTransform: "uppercase" }}>{children}</span>;
}

export const relTime = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
};
