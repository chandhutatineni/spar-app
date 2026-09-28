// Pure MCP logic from the Mac app's Backend/MCP.swift: the server model, the standard
// {"mcpServers": {...}} JSON (export / import), and MCP Registry results → servers.

export type MCPKind = "stdio" | "http" | "sse";

/** Same shape as the Mac app's MCPServer (and src-tauri/src/mcp.rs `Server`). */
export interface MCPServer {
  id: string;                 // the name the agent sees (mcp__<id>__tool)
  title: string;
  summary: string;
  kind: MCPKind;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers: Record<string, string>;
  enabled: boolean;
  builtin: boolean;
  source?: string;            // registry name, when added from the registry
  usesGitHubToken: boolean;   // Authorization comes from the connected GitHub account
}

export type MCPStatus =
  | { state: "unknown" }
  | { state: "checking" }
  | { state: "ok"; tools: number }
  | { state: "failed"; error: string };

export function newServer(p: Partial<MCPServer> & { id: string }): MCPServer {
  return { title: p.id, summary: "", kind: "stdio", args: [], env: {}, headers: {}, enabled: true, builtin: false, usesGitHubToken: false, ...p };
}

export function launchLine(s: MCPServer): string {
  return s.kind === "stdio" ? [s.command ?? "", ...s.args].join(" ") : s.url ?? "";
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

/** Every server as `{"mcpServers": {...}}`, the format Claude, Cursor and VS Code use. */
export function exportJSON(servers: MCPServer[]): string {
  const entries: Record<string, unknown> = {};
  for (const s of servers) {
    const e: Record<string, unknown> = {};
    if (s.kind === "stdio") {
      e.command = s.command ?? "";
      e.args = s.args;
      if (Object.keys(s.env).length) e.env = sortKeys(s.env);
    } else {
      e.type = s.kind;
      e.url = s.url ?? "";
      if (Object.keys(s.headers).length) e.headers = sortKeys(s.headers);
    }
    if (!s.enabled) e.disabled = true;
    entries[s.id] = sortKeys(e);
  }
  return JSON.stringify({ mcpServers: sortKeys(entries) }, null, 2);
}

export class JSONError extends Error {}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const strMap = (v: unknown): Record<string, string> =>
  isObj(v) && Object.values(v).every((x) => typeof x === "string") ? { ...(v as Record<string, string>) } : {};
const strList = (v: unknown): string[] => (Array.isArray(v) && v.every((x) => typeof x === "string") ? [...v] : []);

/**
 * Parses `{"mcpServers": {...}}`, a bare `{"name": {...}}` map, or one server
 * `{"command": ...}` (named `name`). With `replace`, the result becomes the whole list
 * (built-in servers left out are disabled, not deleted); otherwise it is merged in.
 * Returns the new list and how many servers were read.
 */
export function importJSON(text: string, replace: boolean, current: MCPServer[], name = "server"): { servers: MCPServer[]; count: number } {
  let root: unknown;
  try { root = JSON.parse(text); } catch { throw new JSONError("That isn't valid JSON."); }
  if (!isObj(root)) throw new JSONError("That isn't valid JSON.");
  let map: Record<string, unknown>;
  if (isObj(root.mcpServers)) map = root.mcpServers;
  else if (isObj(root.servers)) map = root.servers;
  else if (root.command !== undefined || root.url !== undefined) map = { [name]: root };
  else map = root;
  const parsed: MCPServer[] = [];
  for (const [id, value] of Object.entries(map)) {
    if (!isObj(value)) continue;
    const existing = current.find((s) => s.id === id);
    const s: MCPServer = existing ? { ...existing } : newServer({ id });
    if (typeof value.url === "string") {
      s.kind = value.type === "sse" ? "sse" : "http";
      s.url = value.url;
      s.headers = strMap(value.headers);
      s.command = undefined;
      s.args = [];
    } else if (typeof value.command === "string") {
      s.kind = "stdio";
      s.command = value.command;
      s.args = strList(value.args);
      s.env = strMap(value.env);
      s.url = undefined;
    } else {
      throw new JSONError(`“${id}” needs a command or a url.`);
    }
    s.enabled = !(value.disabled === true);
    parsed.push(s);
  }
  if (!parsed.length) throw new JSONError("No servers found in the JSON.");
  let servers: MCPServer[];
  if (replace) {
    servers = [...parsed];
    for (const b of current) if (b.builtin && !parsed.some((p) => p.id === b.id)) servers.push({ ...b, enabled: false });
  } else {
    servers = [...current];
    for (const s of parsed) {
      const i = servers.findIndex((x) => x.id === s.id);
      if (i >= 0) servers[i] = s; else servers.push(s);
    }
  }
  return { servers, count: parsed.length };
}

/** Add a server under a unique id (`name`, `name-2`, …). */
export function uniqueId(servers: MCPServer[], base: string): string {
  let id = base, n = 2;
  while (servers.some((s) => s.id === id)) id = `${base}-${n++}`;
  return id;
}

/** What the server editor does with the id someone typed. */
export const normalizeId = (id: string) => id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");

/** "KEY=value" lines → map (the editor's environment box). */
export function parseLines(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(sep);
    if (i < 0) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export const formatLines = (m: Record<string, string>, sep: "=" | ": ") =>
  Object.keys(m).sort().map((k) => `${k}${sep}${m[k]}`).join("\n");

// ---- MCP Registry ------------------------------------------------------------------------

export interface RegistryEntry {
  name: string;
  description: string;
  repository?: string;
  server?: MCPServer;         // undefined when there is no way to run it locally
  requiredInputs: string[];   // env vars or headers the user must fill in
}

const capitalized = (s: string) => s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

export function makeServer(name: string, description: string, s: Record<string, any>): { server?: MCPServer; required: string[] } {
  const short = name.split("/").pop() || name;
  const id = short.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const title = capitalized(short.split("-mcp").join("").split("mcp-").join("").split("-").join(" "));
  // Prefer a local package, then a remote endpoint.
  for (const pkg of Array.isArray(s.packages) ? s.packages : []) {
    const ident = pkg?.identifier;
    if (typeof ident !== "string") continue;
    const transport = pkg?.transport?.type ?? "stdio";
    if (transport !== "stdio") continue;
    const envVars: any[] = Array.isArray(pkg.environmentVariables) ? pkg.environmentVariables : [];
    const required = envVars.filter((v) => v?.isRequired === true).map((v) => v?.name).filter((n): n is string => typeof n === "string");
    const env: Record<string, string> = {};
    for (const v of envVars) if (typeof v?.name === "string" && typeof v?.default === "string") env[v.name] = v.default;
    const base = { id, title, summary: description, kind: "stdio" as const, env, source: name };
    let server: MCPServer | undefined;
    switch (pkg.registryType) {
      case "npm": server = newServer({ ...base, command: "npx", args: ["-y", ident] }); break;
      case "pypi": server = newServer({ ...base, command: "uvx", args: [ident] }); break;
      case "oci": server = newServer({ ...base, command: "docker", args: ["run", "-i", "--rm", ...required.flatMap((r) => ["-e", r]), ident] }); break;
    }
    if (server) return { server, required };
  }
  for (const remote of Array.isArray(s.remotes) ? s.remotes : []) {
    if (typeof remote?.url !== "string") continue;
    const headers: any[] = Array.isArray(remote.headers) ? remote.headers : [];
    const required = headers.map((h) => h?.name).filter((n): n is string => typeof n === "string");
    return { server: newServer({ id, title, summary: description, kind: remote.type === "sse" ? "sse" : "http", url: remote.url, source: name }), required };
  }
  return { required: [] };
}

/** The registry's `/v0/servers` response → entries (one per server name). */
export function parseRegistry(json: unknown): RegistryEntry[] {
  if (!isObj(json) || !Array.isArray(json.servers)) return [];
  const seen = new Set<string>();
  const out: RegistryEntry[] = [];
  for (const item of json.servers) {
    const s = isObj(item?.server) ? item.server : item;
    if (!isObj(s) || typeof s.name !== "string" || seen.has(s.name)) continue;
    seen.add(s.name);
    const description = typeof s.description === "string" ? s.description : "";
    const repository = typeof s.repository?.url === "string" ? s.repository.url : undefined;
    const { server, required } = makeServer(s.name, description, s);
    out.push({ name: s.name, description, repository, server, requiredInputs: required });
  }
  return out;
}
