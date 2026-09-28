import { describe, expect, it } from "vitest";
import { exportJSON, importJSON, makeServer, newServer, parseLines, parseRegistry, normalizeId, launchLine } from "./mcpJson";

const builtin = newServer({ id: "context7", title: "Context7", summary: "docs", command: "npx", args: ["-y", "@upstash/context7-mcp"], builtin: true });
const gh = newServer({ id: "github", title: "GitHub", kind: "http", url: "https://api.githubcopilot.com/mcp/", builtin: true, usesGitHubToken: true });

describe("export", () => {
  it("writes the standard mcpServers format", () => {
    const off = newServer({ id: "x", command: "uvx", args: ["a"], env: { B: "2", A: "1" }, enabled: false });
    const j = JSON.parse(exportJSON([builtin, gh, off]));
    expect(j.mcpServers.context7).toEqual({ args: ["-y", "@upstash/context7-mcp"], command: "npx" });
    expect(j.mcpServers.github).toEqual({ type: "http", url: "https://api.githubcopilot.com/mcp/" });
    expect(j.mcpServers.x).toEqual({ args: ["a"], command: "uvx", disabled: true, env: { A: "1", B: "2" } });
    expect(Object.keys(JSON.parse(exportJSON([gh, builtin])).mcpServers)).toEqual(["context7", "github"]);
  });
});

describe("import", () => {
  it("accepts a full block, a bare map, and a single server", () => {
    expect(importJSON('{"mcpServers":{"a":{"command":"npx","args":["-y","a"]}}}', false, [builtin]).servers.map((s) => s.id)).toEqual(["context7", "a"]);
    expect(importJSON('{"b":{"url":"https://x/mcp","type":"sse"}}', false, []).servers[0]).toMatchObject({ id: "b", kind: "sse", url: "https://x/mcp" });
    expect(importJSON('{"command":"uvx","args":["mcp-server-fetch"]}', false, [], "fetch2").servers[0]).toMatchObject({ id: "fetch2", command: "uvx" });
  });
  it("keeps titles of existing servers and applies disabled", () => {
    const r = importJSON('{"mcpServers":{"context7":{"command":"npx","args":["x"],"disabled":true}}}', false, [builtin]);
    expect(r.servers[0]).toMatchObject({ title: "Context7", builtin: true, enabled: false, args: ["x"] });
  });
  it("replace disables built-ins left out instead of deleting them", () => {
    const r = importJSON('{"mcpServers":{"mine":{"command":"node","args":["s.js"]}}}', true, [builtin, gh, newServer({ id: "old", command: "x" })]);
    expect(r.servers.map((s) => [s.id, s.enabled])).toEqual([["mine", true], ["context7", false], ["github", false]]);
  });
  it("reports errors like the Mac app", () => {
    expect(() => importJSON("nope", false, [])).toThrow("That isn't valid JSON.");
    expect(() => importJSON('{"mcpServers":{}}', false, [])).toThrow("No servers found in the JSON.");
    expect(() => importJSON('{"a":{"args":[]}}', false, [])).toThrow("“a” needs a command or a url.");
  });
});

describe("registry", () => {
  it("prefers a local package and lists required inputs", () => {
    const { server, required } = makeServer("io.github.acme/postgres-mcp", "PG", {
      packages: [{ registryType: "npm", identifier: "@acme/pg-mcp", transport: { type: "stdio" }, environmentVariables: [{ name: "PG_URL", isRequired: true }, { name: "MODE", default: "ro" }] }],
      remotes: [{ type: "streamable-http", url: "https://x" }],
    });
    expect(server).toMatchObject({ id: "postgres-mcp", title: "Postgres", command: "npx", args: ["-y", "@acme/pg-mcp"], env: { MODE: "ro" }, source: "io.github.acme/postgres-mcp" });
    expect(required).toEqual(["PG_URL"]);
  });
  it("oci passes required env to docker; remotes as a fallback", () => {
    expect(makeServer("a/b", "", { packages: [{ registryType: "oci", identifier: "img", environmentVariables: [{ name: "K", isRequired: true }] }] }).server?.args).toEqual(["run", "-i", "--rm", "-e", "K", "img"]);
    const r = makeServer("a/mcp-remote-thing", "", { remotes: [{ type: "sse", url: "https://r", headers: [{ name: "Authorization" }] }] });
    expect(r.server).toMatchObject({ kind: "sse", url: "https://r", title: "Remote Thing" });
    expect(r.required).toEqual(["Authorization"]);
    expect(makeServer("a/c", "", {}).server).toBeUndefined();
  });
  it("parses the response and drops duplicate names", () => {
    const e = parseRegistry({ servers: [{ server: { name: "a/x", description: "d", repository: { url: "https://github.com/a/x" }, packages: [{ registryType: "pypi", identifier: "x-mcp" }] } }, { server: { name: "a/x" } }] });
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ name: "a/x", repository: "https://github.com/a/x" });
    expect(launchLine(e[0].server!)).toBe("uvx x-mcp");
    expect(parseRegistry(null)).toEqual([]);
  });
});

it("editor helpers", () => {
  expect(parseLines("A=1\n bad \nB = x=y\n=z", "=")).toEqual({ A: "1", B: "x=y" });
  expect(parseLines("Authorization: Bearer t", ":")).toEqual({ Authorization: "Bearer t" });
  expect(normalizeId("My Server!")).toBe("my-server-");
});
