// MCP servers: what the agent can use now, and the MCP Registry to find more
// (a port of the Mac app's Views/MCPView.swift).

import { useEffect, useState, type CSSProperties } from "react";
import { Braces, Check, ChevronDown, Ellipsis, ExternalLink, Globe, Info, KeyRound, Package, Plus, RefreshCw, RefreshCcw, Search } from "lucide-react";
import { SFSymbol } from "../../ui/icons";
import { FormSwitch } from "./form";
import { app } from "../../lib/api";
import { allCommands, runCommand } from "../../lib/commands";
import { Button, MenuButton, Segmented, Sheet, Spinner, showMenu } from "../../ui";
import { useMCP } from "./store";
import { exportJSON as exportText, formatLines, launchLine, newServer, normalizeId, parseLines, type MCPKind, type MCPServer, type MCPStatus, type RegistryEntry } from "./mcpJson";

const SUGGESTIONS = ["database", "postgres", "browser", "docs", "slack", "figma", "aws", "sentry", "notion", "kubernetes"];

export interface MCPViewProps {
  /** The chat's current agent; a non-Claude agent gets a note that it has its own MCP config. */
  agent?: { title: string; family: string };
  /** "Apply to agent": restart the agent with these servers (default: the chat feature's `reload-agent-tools` command). */
  onApply?: () => void;
}

export function MCPView({ agent, onApply }: MCPViewProps) {
  const store = useMCP();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegistryEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState("");
  const [editing, setEditing] = useState<{ server: MCPServer; isNew: boolean; required?: string[] } | null>(null);
  const [jsonMode, setJsonMode] = useState<"edit" | "importing" | null>(null);

  useEffect(() => { store.load().catch(() => {}); }, []);

  const search = async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    try { setResults(await store.search(q)); } finally { setSearching(false); setSearched(q); }
  };

  const apply = () => {
    if (onApply) return onApply();
    if (allCommands().some(([id]) => id === "reload-agent-tools")) runCommand("reload-agent-tools");
  };

  const ready = store.servers.filter((s) => s.enabled && store.status[s.id]?.state === "ok").length;

  return (
    <div style={{ height: "100%", overflow: "auto" }} className="selectable">
      <div style={{ maxWidth: 940, margin: "0 auto", padding: 36, display: "flex", flexDirection: "column", gap: 26 }}>
        {/* Header */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>MCP servers</h1>
            <span className="spacer" />
            <Button icon={sym("arrow.clockwise", <RefreshCw size={13} />)} onClick={() => store.checkAll()}>Check all</Button>
            <Button icon={sym("plus", <Plus size={13} />)} onClick={() => setEditing({ server: newServer({ id: "", title: "", command: "npx", args: ["-y", ""] }), isNew: true })}>Add custom</Button>
            <MenuButton className="btn" items={() => [
              { label: "Edit all servers as JSON…", onClick: () => setJsonMode("edit") },
              { label: "Import JSON…", onClick: () => setJsonMode("importing") },
              "divider",
              { label: "Show the agent's config file", onClick: () => store.configPath && app.reveal(store.configPath) },
            ]}>
              {sym("curlybraces", <Braces size={13} />)} JSON {sym("chevron.down", <ChevronDown size={11} />, 9, "semibold")}
            </MenuButton>
            <Button kind="primary" icon={sym("arrow.triangle.2.circlepath", <RefreshCcw size={13} />)} title="Restart the agent with these servers; the conversation carries over" onClick={apply}>Apply to agent</Button>
          </div>
          <div style={{ fontSize: 15, color: "var(--text-2)" }}>
            Tools the SPAR and Claude Code agents can call. A server that fails its check is left out of the agent's configuration, so it never blocks a session.
          </div>
          {agent && agent.family !== "claude" && (
            <div className="row muted" style={{ fontSize: 12, gap: 6 }}>
              {sym("info.circle", <Info size={12} />, 12)} {agent.title} uses its own MCP configuration; these servers apply to SPAR and Claude Code.
            </div>
          )}
        </div>

        {/* Installed */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="headline">Installed · {ready} ready</div>
          <div className="card" style={{ padding: 0 }}>
            {store.servers.map((server, i) => (
              <div key={server.id} style={{ borderTop: i ? "0.5px solid var(--hairline)" : undefined }}>
                <ServerRow server={server} status={store.statusOf(server.id)} tools={store.tools[server.id] ?? []}
                  onToggle={(on) => store.setEnabled(server.id, on)}
                  onCheck={() => store.check(server.id)}
                  onEdit={() => setEditing({ server, isNew: false })}
                  onRemove={() => store.remove(server.id)} />
              </div>
            ))}
          </div>
        </div>

        {/* Registry */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="headline">Browse the MCP Registry</div>
          <div className="row" style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--field)" }}>
            <span className="muted" style={{ display: "inline-flex" }}>{sym("magnifyingglass", <Search size={13} />)}</span>
            <input aria-label="Search the MCP Registry" placeholder="Search servers, e.g. postgres, browser, slack" value={query}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search(query)}
              style={{ flex: 1, border: 0, outline: "none", background: "transparent", padding: 0, fontSize: 13, lineHeight: "16px" }} />
            {searching && <Spinner small />}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => { setQuery(s); search(s); }}
                style={{ border: 0, fontSize: 10, lineHeight: "13px", padding: "3px 8px", borderRadius: 999, background: "var(--subtle)", color: "var(--text)" }}>{s}</button>
            ))}
          </div>
          {results.length > 0 ? (
            <div className="card" style={{ padding: 0 }}>
              {results.map((entry, i) => {
                const added = store.servers.some((s) => s.source === entry.name);
                return (
                  <div key={entry.name} className="row" style={{ alignItems: "flex-start", gap: 12, padding: "10px 14px", borderTop: i ? "0.5px solid var(--hairline)" : undefined }}>
                    <span style={{ color: "var(--accent)", width: 20, flex: "none", display: "inline-flex", justifyContent: "center", paddingTop: 1 }}>{entry.server?.kind === "stdio" ? sym("shippingbox", <Package size={15} />) : sym("globe", <Globe size={15} />)}</span>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3, lineHeight: "13px" }}>
                      <span style={{ fontWeight: 600, fontSize: 12, lineHeight: "15px" }}>{entry.name}</span>
                      <span style={{ fontSize: 10, color: "var(--text-2)", ...clamp(2) }}>{entry.description}</span>
                      <div className="row" style={{ gap: 8, minWidth: 0 }}>
                        {entry.server && <span className="mono faint" style={{ fontSize: 10, ...clamp(1) }}>{launchLine(entry.server)}</span>}
                        {entry.requiredInputs.length > 0 && <span style={{ fontSize: 10, color: "var(--warn)", flex: "none" }}>Needs: {entry.requiredInputs.join(", ")}</span>}
                      </div>
                    </div>
                    {entry.repository && <button type="button" className="mcp-plain" title="Open the repository" aria-label="Open the repository" style={{ color: "var(--accent)" }} onClick={() => app.open(entry.repository!)}>{sym("arrow.up.right.square", <ExternalLink size={13} />, 11)}</button>}
                    {added ? (
                      <span className="row" style={{ gap: 4, fontSize: 10, color: "var(--done)" }}>{sym("checkmark", <Check size={11} />, 10)} Added</span>
                    ) : (
                      <Button size="small" disabled={!entry.server} title={entry.server ? "Add to your servers" : "No local package or remote endpoint is published"}
                        onClick={() => {
                          if (!entry.server) return;
                          if (entry.requiredInputs.length === 0) store.add(entry.server);
                          else setEditing({ server: entry.server, isNew: true, required: entry.requiredInputs });
                        }}>Add</Button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : query && !searching && searched === query ? (
            <div className="muted">No servers found for “{query}”.</div>
          ) : null}
        </div>
      </div>
      {editing && <MCPServerEditor {...editing} onClose={() => setEditing(null)} />}
      {jsonMode && <MCPJSONEditor mode={jsonMode} onClose={() => setJsonMode(null)} />}
    </div>
  );
}

/** An SF Symbol at the SwiftUI point size (body = 13) with its lucide fallback. */
const sym = (name: string, fallback: React.ReactNode, size = 13, weight = "regular") => <SFSymbol name={name} size={size} weight={weight} fallback={fallback} />;

const clamp = (lines: number): CSSProperties =>
  lines === 1 ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" };

function ServerRow({ server, status, tools, onToggle, onCheck, onEdit, onRemove }: {
  server: MCPServer; status: MCPStatus; tools: string[];
  onToggle: (on: boolean) => void; onCheck: () => void; onEdit: () => void; onRemove: () => void;
}) {
  const [showTools, setShowTools] = useState(false);
  useEffect(() => {
    if (!showTools) return;
    const close = () => setShowTools(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [showTools]);
  return (
    <div className="row" data-server={server.id} style={{ alignItems: "flex-start", gap: 12, padding: "10px 14px", opacity: server.enabled ? 1 : 0.55 }}>
      <span style={{ paddingTop: 5, width: 8, display: "inline-flex", justifyContent: "center", flex: "none" }}>
        {status.state === "checking" ? <Spinner small />
          : <span className="status-dot" style={{ width: 8, height: 8, background: status.state === "ok" ? "var(--done)" : status.state === "failed" ? "var(--stop)" : "var(--text-3)", opacity: status.state === "failed" ? 0.7 : status.state === "unknown" ? 0.6 : 1 }} />}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3, lineHeight: "13px" }}>
        <div className="row" style={{ gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 12, lineHeight: "15px" }}>{server.title}</span>
          <span className="mono faint" style={{ fontSize: 10 }}>{server.id}</span>
          {server.builtin && <span style={{ fontSize: 8.5, fontWeight: 700, color: "var(--text-2)", padding: "1px 4px", borderRadius: 999, background: "var(--subtle)" }}>DEFAULT</span>}
        </div>
        {server.summary && <span style={{ fontSize: 10, color: "var(--text-2)", ...clamp(2) }}>{server.summary}</span>}
        <span className="mono faint" style={{ fontSize: 10, ...clamp(1) }}>{launchLine(server)}</span>
        <div style={{ position: "relative", fontSize: 10 }}>
          {status.state === "ok" ? (
            <>
              <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowTools((v) => !v)}
                style={{ border: 0, background: "transparent", padding: 0, color: "var(--done)", fontSize: 10 }}>
                Ready · {status.tools} tool{status.tools === 1 ? "" : "s"}
              </button>
              {showTools && (
                <div className="menu mono" role="list" aria-label={`${server.title} tools`} onMouseDown={(e) => e.stopPropagation()}
                  style={{ position: "absolute", left: 0, top: 16, width: 280, maxHeight: 320, overflow: "auto", padding: 12, fontSize: 10, display: "flex", flexDirection: "column", gap: 3 }}>
                  {tools.map((t) => <span key={t} role="listitem">{t}</span>)}
                </div>
              )}
            </>
          ) : status.state === "failed" ? (
            <span style={{ color: "var(--stop)", ...clamp(2) }}>Not connected, ignored: {status.error}</span>
          ) : status.state === "checking" ? (
            <span className="muted">Checking…</span>
          ) : (
            <span className="faint">Not checked yet</span>
          )}
        </div>
      </div>
      <span style={{ paddingTop: 1, display: "inline-flex" }}><FormSwitch on={server.enabled} onChange={onToggle} label={`Use ${server.title}`} tinted /></span>
      <div>
        <button type="button" className="mcp-plain" title="More" aria-label="More" style={{ color: "var(--accent)" }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => showMenu([
            { label: "Check again", onClick: onCheck },
            { label: "Edit…", onClick: onEdit },
            ...(server.builtin ? [] : [{ label: "Remove", onClick: onRemove }]),
          ], e.currentTarget as HTMLElement)}>{sym("ellipsis", <Ellipsis size={15} />)}</button>
      </div>
    </div>
  );
}

/** Add or edit a server; asks for any keys or headers it requires. */
export function MCPServerEditor({ server: initial, isNew, required = [], onClose }: { server: MCPServer; isNew: boolean; required?: string[]; onClose: () => void }) {
  const store = useMCP();
  const [server, setServer] = useState<MCPServer>(initial);
  const [commandLine, setCommandLine] = useState(() => [initial.command ?? "", ...initial.args].join(" ").trim());
  const [envText, setEnvText] = useState(() => {
    const env = { ...initial.env };
    if (initial.kind === "stdio") for (const r of required) if (env[r] === undefined) env[r] = "";
    return formatLines(env, "=");
  });
  const [headerText, setHeaderText] = useState(() => {
    const h = { ...initial.headers };
    if (initial.kind !== "stdio") for (const r of required) if (h[r] === undefined) h[r] = "";
    return formatLines(h, ": ");
  });
  const upd = (p: Partial<MCPServer>) => setServer((s) => ({ ...s, ...p }));

  const commit = async () => {
    const s: MCPServer = { ...server, id: normalizeId(server.id) };
    if (!s.title) s.title = s.id;
    if (s.kind === "stdio") {
      const parts = commandLine.split(" ").filter(Boolean);
      s.command = parts[0];
      s.args = parts.slice(1);
      s.env = parseLines(envText, "=");
    } else {
      s.headers = parseLines(headerText, ":");
    }
    if (isNew) await store.add(s);
    else if (s.id !== initial.id) { await store.remove(initial.id); await store.add(s); }
    else await store.update(s);
    onClose();
  };

  const area = { height: 70, fontFamily: "var(--mono)", fontSize: 12 } as const;
  return (
    <Sheet onClose={onClose} width={560} label={isNew ? "Add MCP server" : `Edit ${server.title}`}>
      <div className="col" style={{ gap: 12 }}>
        <div className="sheet-title">{isNew ? "Add MCP server" : `Edit ${initial.title}`}</div>
        {server.summary && <div className="muted" style={{ fontSize: 12, ...clamp(3) }}>{server.summary}</div>}
        <div className="row">
          <input className="text-field" aria-label="Name" placeholder="Name (used as mcp__name__tool)" value={server.id} disabled={!isNew && server.builtin}
            onChange={(e) => upd({ id: e.target.value })} />
          <input className="text-field" aria-label="Display title" placeholder="Display title" value={server.title} onChange={(e) => upd({ title: e.target.value })} />
        </div>
        <Segmented<MCPKind> value={server.kind} onChange={(kind) => upd({ kind })} options={[
          { value: "stdio", label: "Local command (stdio)" },
          { value: "http", label: "Remote (HTTP)" },
          { value: "sse", label: "Remote (SSE)" },
        ]} />
        {server.kind === "stdio" ? (
          <>
            <input className="text-field mono" aria-label="Command" placeholder="Command, e.g. npx -y @scope/server" value={commandLine} onChange={(e) => setCommandLine(e.target.value)} />
            <span style={{ fontSize: 10, color: "var(--text-2)" }}>Environment (one KEY=value per line)</span>
            <textarea className="text-area" aria-label="Environment" style={area} value={envText} onChange={(e) => setEnvText(e.target.value)} />
          </>
        ) : (
          <>
            <input className="text-field mono" aria-label="URL" placeholder="URL" value={server.url ?? ""} onChange={(e) => upd({ url: e.target.value })} />
            <span style={{ fontSize: 10, color: "var(--text-2)" }}>Headers (one Name: value per line)</span>
            <textarea className="text-area" aria-label="Headers" style={area} value={headerText} onChange={(e) => setHeaderText(e.target.value)} />
          </>
        )}
        {required.length > 0 && (
          <div className="row" style={{ color: "var(--warn)", fontSize: 12, gap: 6 }}>{sym("key", <KeyRound size={12} />, 12)} Fill in: {required.join(", ")}</div>
        )}
        <div className="sheet-footer" style={{ marginTop: 0 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!server.id.trim()} onClick={commit}>{isNew ? "Add" : "Save"}</Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Edit every server as `{"mcpServers": {...}}`, or paste a snippet to import. */
export function MCPJSONEditor({ mode, onClose }: { mode: "edit" | "importing"; onClose: () => void }) {
  const store = useMCP();
  const [text, setText] = useState(() => mode === "edit"
    ? exportText(store.servers)
    : '{\n  "mcpServers": {\n    "example": { "command": "npx", "args": ["-y", "@scope/server"] }\n  }\n}');
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await store.importJSON(text, mode === "edit", name || "server");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Sheet onClose={onClose} width={680} label={mode === "edit" ? "MCP servers as JSON" : "Import MCP servers from JSON"}>
      <div className="col" style={{ gap: 12 }} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); } }}>
        <div className="sheet-title">{mode === "edit" ? "MCP servers as JSON" : "Import MCP servers from JSON"}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {mode === "edit"
            ? 'The standard mcpServers format most coding tools use. Add, change or remove entries; "disabled": true turns a server off.'
            : 'Paste a snippet from a server\'s README: a full {"mcpServers": {...}} block, a map of servers, or a single server\'s {"command": ...}.'}
        </div>
        {mode === "importing" && (
          <input className="text-field" aria-label="Server name" placeholder="Name, if the snippet is a single server" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <textarea className="text-area" aria-label="JSON" spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); setError(null); }}
          style={{ minHeight: 320, fontFamily: "var(--mono)", fontSize: 12, borderColor: error ? "var(--stop)" : undefined }} />
        {error && <div style={{ color: "var(--stop)", fontSize: 12 }}>{error}</div>}
        <div className="row">
          <span className="faint" style={{ fontSize: 10 }}>Stored in {store.storePath || "mcp.json"}; the agent reads mcp-servers.json.</span>
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" onClick={save}>{mode === "edit" ? "Save" : "Import"}</Button>
        </div>
      </div>
    </Sheet>
  );
}
