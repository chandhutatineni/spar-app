// Just enough Markdown for SPAR's artifacts: lines outside comments, tables, ids, code spans.
// A port of `TraceText` in the Mac app's Backend/Trace.swift.

export interface Table {
  /** Lowercased, without bold/code marks. */
  header: string[];
  rows: { line: number; cells: string[] }[];
}

/** Trimmed lines with 1-based numbers, skipping `<!-- … -->` guidance. */
export function lines(text: string): [number, string][] {
  const out: [number, string][] = [];
  let inComment = false;
  text.split("\n").forEach((raw, i) => {
    let line = raw;
    if (inComment) {
      const end = line.indexOf("-->");
      if (end < 0) return;
      line = line.slice(end + 3);
      inComment = false;
    }
    for (;;) {
      const start = line.indexOf("<!--");
      if (start < 0) break;
      const end = line.indexOf("-->", start + 4);
      if (end >= 0) line = line.slice(0, start) + line.slice(end + 3);
      else { line = line.slice(0, start); inComment = true; break; }
    }
    const t = line.trim();
    if (t) out.push([i + 1, t]);
  });
  return out;
}

export function cells(line: string): string[] | null {
  if (!line.startsWith("|")) return null;
  let body = line.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((c) => c.trim());
}

/**
 * The first table (in the `## ` section whose title starts with `section`, when given)
 * whose header passes `header`.
 */
export function table(text: string, section: string | null, header: (h: string[]) => boolean): Table | null {
  let inSection = section == null;
  let head: string[] | null = null;
  const rows: { line: number; cells: string[] }[] = [];
  for (const [n, line] of lines(text)) {
    if (line.startsWith("## ") && section != null) {
      if (head) break;
      inSection = line.slice(3).trim().toLowerCase().startsWith(section);
      continue;
    }
    if (!inSection) continue;
    const c = cells(line);
    if (!c) {
      if (head) break;
      continue;
    }
    if (head) {
      if (c.every((x) => x === "" || [...x].every((ch) => "-: ".includes(ch)))) continue;
      rows.push({ line: n, cells: c });
    } else {
      const h = c.map((x) => plain(x).toLowerCase());
      if (header(h)) head = h;
    }
  }
  return head ? { header: head, rows } : null;
}

/** The first capture group (or the whole match) of `pattern` in `s`. */
export function match(pattern: RegExp, s: string): string | null {
  const m = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(s);
  if (!m) return null;
  return m.length > 1 ? m[1] ?? null : m[0];
}

/** Every distinct first group (or whole match) of `pattern` in `s`, in order. */
export function all(pattern: RegExp, s: string): string[] {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  const out: string[] = [];
  for (const m of s.matchAll(re)) {
    const v = m.length > 1 ? m[1] : m[0];
    if (v != null && !out.includes(v)) out.push(v);
  }
  return out;
}

/** `code spans` in a line. */
export function code(s: string): string[] {
  return all(/`([^`]+)`/, s).map((x) => x.trim()).filter((x) => x && !x.includes("{{"));
}

/** A cell's values: its code spans, else its comma-separated parts, without dashes or placeholders. */
export function values(cell: string): string[] {
  if (cell.includes("{{")) return [];
  if (cell.includes("`")) return code(cell);
  return cell.replace(/<br>/g, ",").split(/[,;]/).map(plain)
    .filter((v) => v && !["—", "–", "-", "n/a"].includes(v) && !v.toLowerCase().startsWith("none"));
}

/** Without bold, italics and code marks. */
export function plain(s: string): string {
  return s.replace(/\*\*/g, "").replace(/`/g, "").replace(/(^|\s)_([^_]+)_/g, "$1$2").trim();
}

const LEAD = " ·:—–-.";
export function trimLead(s: string): string {
  let a = 0, b = s.length;
  while (a < b && LEAD.includes(s[a])) a++;
  while (b > a && LEAD.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

/** The file part of `path:symbol` or `path::test name`. */
export function fileOf(ref: string): string {
  const s = ref.split("::")[0];
  const colon = s.lastIndexOf(":");
  if (colon < 0 || s.slice(colon + 1).includes("/")) return s;
  return s.slice(0, colon);
}

export const lastComponent = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
export const deletingLastComponent = (p: string) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
