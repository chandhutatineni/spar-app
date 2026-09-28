// MDBlock.parse (MarkdownView.swift): the block structure of a Markdown text.

export interface MDItem { text: string; checked: boolean | null; number: number | null; indent: number }
export type MDBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: MDItem[] }
  | { kind: "code"; text: string; lang: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; rows: string[][] };

export function parseBlocks(text: string): MDBlock[] {
  const blocks: MDBlock[] = [];
  let lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  // Skip YAML front matter.
  if (lines[0]?.trim() === "---") {
    const end = lines.slice(1).findIndex((l) => l.trim() === "---");
    if (end >= 0) lines = lines.slice(end + 2);
  }
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i++];
    const line = raw.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      flush();
      const code: string[] = [];
      while (i < lines.length) {
        const next = lines[i++];
        if (next.trim().startsWith(line.slice(0, 3))) break;
        code.push(next);
      }
      blocks.push({ kind: "code", text: code.join("\n"), lang: line.slice(3).trim().toLowerCase() });
    } else if (!line) {
      flush();
    } else if (line.startsWith("<!--")) {
      flush();
      let comment = line;
      while (!comment.includes("-->") && i < lines.length) comment = lines[i++];
    } else if (headingLevel(line)) {
      flush();
      blocks.push({ kind: "heading", level: headingLevel(line)!, text: line.replace(/^#+/, "").trim() });
    } else if (line === "---" || line === "***" || line === "___") {
      flush();
      blocks.push({ kind: "rule" });
    } else if (line.startsWith("|")) {
      flush();
      const rows = [cells(line)];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = cells(lines[i++]);
        if (!row.every((c) => [...c].every((ch) => "-: ".includes(ch)))) rows.push(row);
      }
      blocks.push({ kind: "table", rows });
    } else if (line.startsWith(">")) {
      flush();
      const quote = [line.slice(1).trim()];
      while (i < lines.length && lines[i].trim().startsWith(">")) quote.push(lines[i++].trim().slice(1).trim());
      blocks.push({ kind: "quote", text: quote.join(" ") });
    } else if (listItem(raw)) {
      flush();
      const items = [listItem(raw)!];
      while (i < lines.length) {
        const next = lines[i];
        const more = listItem(next);
        if (more) { items.push(more); i++; }
        else if (next.startsWith("  ") && next.trim()) { items[items.length - 1] = { ...items[items.length - 1], text: items[items.length - 1].text + " " + next.trim() }; i++; }
        else break;
      }
      blocks.push({ kind: "list", items });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

function headingLevel(line: string): number | null {
  const hashes = line.match(/^#*/)![0].length;
  return hashes >= 1 && hashes <= 6 && line[hashes] === " " ? hashes : null;
}

function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function listItem(raw: string): MDItem | null {
  const indent = Math.floor((raw.match(/^ */)![0].length) / 2);
  const line = raw.trim();
  let rest: string;
  let number: number | null = null;
  if (/^[-*+] /.test(line)) rest = line.slice(2);
  else {
    const m = line.match(/^(\d+)[.)] /);
    if (!m) return null;
    number = parseInt(m[1], 10);
    rest = line.slice(m[0].length);
  }
  let checked: boolean | null = null;
  if (rest.startsWith("[ ] ")) { checked = false; rest = rest.slice(4); }
  else if (rest.startsWith("[x] ") || rest.startsWith("[X] ")) { checked = true; rest = rest.slice(4); }
  return { text: rest, checked, number, indent };
}

