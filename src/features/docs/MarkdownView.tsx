// A small block-level Markdown renderer (MarkdownView.swift): enough for SPAR artifacts and
// agent replies (headings, lists, checkboxes, tables, quotes, code, ```mermaid) with inline
// styling. Raw HTML is shown as text, never run.

import { useState } from "react";
import { CheckSquare, Square } from "lucide-react";
import { SFSymbol } from "../../ui/icons";
import { Marked } from "marked";
import { MermaidView, useDark } from "./views";

import { parseBlocks, type MDBlock } from "./markdownBlocks";

export { parseBlocks };

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const inlineMd = new Marked({ gfm: true, breaks: false, renderer: { html: ({ text }) => esc(text) } });

function Inline({ text, style }: { text: string; style?: React.CSSProperties }) {
  return <span className="md-inline" style={style} dangerouslySetInnerHTML={{ __html: inlineMd.parseInline(text) as string }} />;
}

const HEADING = [26, 20, 16];

export function MarkdownView({ text, compact = false }: { text: string; compact?: boolean }) {
  const blocks = parseBlocks(text);
  return (
    <div className="md-view" style={{ display: "flex", flexDirection: "column", gap: compact ? 7 : 12, width: "100%", userSelect: "text", lineHeight: 1.2 }}>
      {blocks.map((b, i) => <Block key={i} block={b} compact={compact} />)}
    </div>
  );
}

function Block({ block: b, compact }: { block: MDBlock; compact: boolean }) {
  switch (b.kind) {
    case "heading":
      return <div role="heading" aria-level={b.level} style={{ fontSize: compact ? 13 : HEADING[b.level - 1] ?? 13, fontWeight: compact || b.level > 1 ? 600 : 700, paddingTop: compact ? 2 : b.level <= 2 ? 10 : 4 }}><Inline text={b.text} /></div>;
    case "paragraph":
      return <div><Inline text={b.text} /></div>;
    case "list":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: compact ? 3 : 5 }}>
          {b.items.map((it, i) => (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, paddingLeft: it.indent * 16 }}>
              <span style={{ flex: "none", color: "var(--text-2)", fontVariantNumeric: "tabular-nums", alignSelf: it.checked != null ? "center" : undefined }}>
                {it.checked != null ? (it.checked
                  ? <span style={{ color: "var(--done)", display: "inline-flex" }}><SFSymbol name="checkmark.square.fill" size={12} fallback={<CheckSquare size={13} />} /></span>
                  : <SFSymbol name="square" size={12} fallback={<Square size={13} />} />) : it.number != null ? `${it.number}.` : "•"}
              </span>
              <Inline text={it.text} style={it.checked ? { textDecoration: "line-through", color: "var(--text-2)" } : undefined} />
            </div>
          ))}
        </div>
      );
    case "code":
      if (b.lang === "mermaid" && !compact) return <MermaidBlock code={b.text} />;
      return <pre style={{ margin: 0, padding: 12, background: "var(--subtle)", borderRadius: 8, overflowX: "auto", font: "11.5px/1.45 var(--mono)" }}>{b.text}</pre>;
    case "quote":
      return (
        <div style={{ display: "flex", gap: 10 }}>
          <span style={{ width: 3, borderRadius: 1, background: "var(--accent)", opacity: 0.5, flex: "none" }} />
          <Inline text={b.text} style={{ color: "var(--text-2)" }} />
        </div>
      );
    case "rule":
      return <hr className="hr" style={{ margin: "4px 0" }} />;
    case "table": {
      const cols = Math.max(1, ...b.rows.map((r) => r.length));
      return (
        <div style={{ background: "color-mix(in srgb, var(--subtle) 60%, transparent)", borderRadius: 8, overflowX: "auto" }}>
          {b.rows.map((row, r) => (
            <div key={r} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(80px, 1fr))`, columnGap: 14, padding: "7px 12px", fontSize: 12, fontWeight: r === 0 ? 600 : 400,
              borderBottom: r < b.rows.length - 1 ? `1px solid ${r === 0 ? "var(--hairline-strong)" : "var(--hairline)"}` : undefined }}>
              {Array.from({ length: cols }, (_, c) => <div key={c} style={{ minWidth: 0 }}><Inline text={row[c] ?? ""} /></div>)}
            </div>
          ))}
        </div>
      );
    }
  }
}

/** A ```mermaid block rendered as a diagram, sized to its content. */
function MermaidBlock({ code }: { code: string }) {
  const dark = useDark();
  const [h, setH] = useState(240);
  return (
    <div style={{ minHeight: Math.min(Math.max(h, 80), 1400), background: "color-mix(in srgb, var(--subtle) 50%, transparent)", borderRadius: 8, display: "flex" }}>
      <MermaidView code={code} dark={dark} onHeight={setH} />
    </div>
  );
}
