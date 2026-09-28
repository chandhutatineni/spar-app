// Search across the project (SearchView.swift). `git grep` in repositories (fast, respects
// .gitignore), `grep -r` elsewhere. Compact in the sidebar, full page as a tab.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { File, Search } from "lucide-react";
import { basename, dirname, exec, joinPath } from "../../lib/api";
import { useWorkspace } from "../../state/workspace";
import { Spinner } from "../../ui";
import { SFSymbol } from "../../ui/icons";

export interface SearchHit { line: number; text: string }
export interface SearchGroup { file: string; hits: SearchHit[] }

export function buildSearchArgs(q: string, o: { isRepo: boolean; matchCase: boolean; wholeWord: boolean; regex: boolean; include: string }): [string, string[]] {
  const args = o.isRepo ? ["grep", "-n", "-I", "--no-color", "--untracked"]
    : ["-rnI", "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=.build", "--exclude-dir=dist"];
  if (!o.matchCase) args.push("-i");
  if (o.wholeWord) args.push("-w");
  args.push(o.regex ? "-E" : "-F", "-e", q);
  const inc = o.include.trim() ? o.include.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (o.isRepo) args.push("--", ...inc);
  else args.push(...inc.map((i) => `--include=${i}`), ".");
  return [o.isRepo ? "git" : "grep", args];
}

export function parseGrep(stdout: string): { groups: SearchGroup[]; total: number } {
  const grouped = new Map<string, SearchHit[]>();
  let total = 0;
  for (const line of stdout.split("\n").slice(0, 2000)) {
    const a = line.indexOf(":");
    if (a < 0) continue;
    const b = line.indexOf(":", a + 1);
    if (b < 0) continue;
    const n = Number(line.slice(a + 1, b));
    if (!Number.isInteger(n) || line.slice(a + 1, b) === "") continue;
    let file = line.slice(0, a);
    if (file.startsWith("./")) file = file.slice(2);
    if (!grouped.has(file)) grouped.set(file, []);
    grouped.get(file)!.push({ line: n, text: line.slice(b + 1, b + 301) });
    total++;
  }
  return { groups: [...grouped].map(([file, hits]) => ({ file, hits })), total };
}

export function SearchView({ compact = false }: { compact?: boolean }) {
  const root = useWorkspace((s) => s.root);
  const searchInclude = useWorkspace((s) => s.searchInclude);
  const [query, setQuery] = useState("");
  const [include, setInclude] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [results, setResults] = useState<SearchGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const state = useRef({ query, include, matchCase, regex, wholeWord });
  state.current = { query, include, matchCase, regex, wholeWord };

  const run = async (over: Partial<typeof state.current> = {}) => {
    const s = { ...state.current, ...over };
    const q = s.query;
    if (!q) { setResults([]); setTotal(0); return; }
    const my = ++seq.current;
    setSearching(true);
    const isRepo = (await exec.run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root }).catch(() => null))?.ok ?? false;
    const [tool, args] = buildSearchArgs(q, { isRepo, ...s });
    const out = await exec.run(tool, args, { cwd: root }).catch(() => null);
    if (my !== seq.current) return;
    const { groups, total } = parseGrep(out?.stdout ?? "");
    setResults(groups);
    setTotal(total);
    setSearching(false);
  };

  useEffect(() => {
    const ws = useWorkspace.getState();
    if (ws.searchInclude) { setInclude(ws.searchInclude); ws.set({ searchInclude: "" }); }
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!searchInclude) return;
    setInclude(searchInclude);
    useWorkspace.getState().set({ searchInclude: "" });
    void run({ include: searchInclude });
    inputRef.current?.focus();
  }, [searchInclude]);

  const summary = !query ? "" : results.length === 0 && !searching ? "No results"
    : `${total} result${total === 1 ? "" : "s"} in ${results.length} file${results.length === 1 ? "" : "s"}`;

  const toggle = (label: string, on: boolean, set: (v: boolean) => void, help: string, key: "matchCase" | "wholeWord" | "regex") => (
    <button type="button" title={help} aria-label={help} aria-pressed={on} onClick={() => { set(!on); void run({ [key]: !on }); }}
      className="mono" style={{ border: 0, fontSize: 11, fontWeight: 600, padding: "2px 5px", borderRadius: 4, background: on ? "var(--accent)" : "var(--subtle)", color: on ? "#fff" : "var(--text-2)" }}>
      {label}
    </button>
  );

  const highlighted = (text: string): ReactNode => {
    const t = text.trim();
    if (regex || !query) return t;
    const i = matchCase ? t.indexOf(query) : t.toLowerCase().indexOf(query.toLowerCase());
    if (i < 0) return t;
    return <>{t.slice(0, i)}<b style={{ color: "var(--accent)" }}>{t.slice(i, i + query.length)}</b>{t.slice(i + query.length)}</>;
  };

  const pad = compact ? 10 : 16;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, flex: 1 }} aria-label="Search">
      <div className="col" style={{ padding: pad, gap: 8 }}>
        <div className="row" style={{ padding: "7px 10px", borderRadius: 8, background: "var(--bg)", border: `1px solid ${focused ? "color-mix(in srgb, var(--accent) 50%, transparent)" : "var(--hairline)"}` }}>
          <span className="muted" style={{ display: "inline-flex" }}><SFSymbol name="magnifyingglass" size={13} fallback={<Search size={14} />} /></span>
          <input ref={inputRef} aria-label="Search in files" placeholder="Search in files" value={query}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()}
            style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontSize: 14, lineHeight: "17px", height: 17, padding: 0 }} />
          {toggle("Aa", matchCase, setMatchCase, "Match case", "matchCase")}
          {toggle("ab", wholeWord, setWholeWord, "Whole word", "wholeWord")}
          {toggle(".*", regex, setRegex, "Regular expression", "regex")}
        </div>
        <div className="row">
          <input className="text-field" aria-label="Files to include" placeholder="Files to include, e.g. *.swift or src/" value={include}
            onChange={(e) => setInclude(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()} style={{ fontSize: 10, height: 19, padding: "0 5px", borderRadius: 5 }} />
          {searching && <Spinner small />}
          <span style={{ fontSize: 10, color: "var(--text-2)", whiteSpace: "nowrap" }}>{summary}</span>
        </div>
      </div>
      <div style={{ height: 1, background: "var(--hairline-strong)", flex: "none" }} />
      <div className="col" style={{ flex: 1, overflow: "auto", padding: pad, gap: 10 }}>
        {results.map((g) => (
          <div key={g.file} className="col" style={{ gap: 2 }}>
            <div className="row" style={{ gap: 6, minWidth: 0 }} title={g.file}>
              <span className="muted" style={{ display: "inline-flex", flex: "none" }}><SFSymbol name="doc" size={13} fallback={<File size={12} />} /></span>
              <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{basename(g.file)}</span>
              <span className="faint" style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{g.file.includes("/") ? dirname(g.file) : ""}</span>
              <span style={{ fontSize: 10, fontVariantNumeric: "tabular-nums", padding: "0 5px", borderRadius: 999, background: "var(--subtle)", flex: "none" }}>{g.hits.length}</span>
            </div>
            {g.hits.map((h, i) => (
              <div key={i} role="button" className="search-hit" onClick={() => useWorkspace.getState().openFile(joinPath(root, g.file), h.line)}
                style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "2px 0", cursor: "default" }}>
                <span className="faint" style={{ width: 40, textAlign: "right", fontSize: 10, fontVariantNumeric: "tabular-nums", flex: "none" }}>{h.line}</span>
                <span className="mono" style={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{highlighted(h.text)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
