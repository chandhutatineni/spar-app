import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  const g = globalThis as any;
  const mem = new Map<string, string>();
  g.window ??= { addEventListener() {} };
  g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) };
  return {
    mcp: { servers: [] as any[], status: {} as Record<string, any>, loaded: true },
    spar: { feature: "001-x" as string | null, gates: {} as Record<string, any>, root: "/p" },
    chat: { status: "idle", sessionId: "s1" as string | null },
    family: "claude",
    sent: [] as string[],
  };
});
vi.mock("../mcp/store", () => ({ useMCP: Object.assign(() => null, { getState: () => store.mcp }) }));
vi.mock("../../state/spar", () => ({ useSpar: Object.assign(() => null, { getState: () => store.spar }) }));
vi.mock("../../state/app", () => ({ onFilesChanged: () => () => {} }));
vi.mock("../../state/chat", () => ({
  useChat: Object.assign(() => null, { getState: () => store.chat }),
  agentOf: () => ({ family: store.family }),
  isRunning: (s: any) => s.status === "running",
  send: (t: string) => store.sent.push(t),
}));
vi.mock("../chat/sparcli", () => ({ Spar: { featureTitle: (id: string) => id.replace(/^\d+-/, "").replace(/-/g, " "), dir: async () => "/p/spar" } }));

import { afterApproval, exportRequest, jiraBlocker, jiraSettings, server, site } from "./tracker";

const jira = { id: "atlassian", title: "Atlassian", enabled: true, args: [], env: { JIRA_URL: "acme.atlassian.net/" }, headers: {}, kind: "stdio", summary: "", builtin: false, usesGitHubToken: false };

describe("Tracker", () => {
  it("finds an enabled Jira server that didn't fail", () => {
    store.mcp.servers = [{ ...jira, id: "github", title: "GitHub", env: {} }, jira];
    expect(server()?.id).toBe("atlassian");
    store.mcp.status = { atlassian: { state: "failed", error: "x" } };
    expect(server()).toBeNull();
    store.mcp.status = {};
    store.mcp.servers = [{ ...jira, enabled: false }];
    expect(server()).toBeNull();
    store.mcp.servers = [{ ...jira, id: "tickets", title: "Tickets", command: "npx", args: ["mcp-jira"] }];
    expect(server()?.id).toBe("tickets");
  });
  it("takes the site from Settings, else JIRA_URL", () => {
    store.mcp.servers = [jira];
    expect(site()).toBe("https://acme.atlassian.net");
    jiraSettings.setURL("https://team.atlassian.net/");
    expect(site()).toBe("https://team.atlassian.net");
    jiraSettings.setURL("javascript:alert(1)");
    expect(site()).toBeNull();
    jiraSettings.setURL("");
  });
  it("blocks until everything is ready, then exports after approving the tasks", () => {
    store.mcp.servers = [jira];
    expect(jiraBlocker()).toBe("Approve the plan and tasks first");
    store.spar.gates = { "approve-plan": { approved: true } };
    store.chat.status = "running";
    expect(jiraBlocker()).toBe("Wait for the agent to finish its turn");
    store.chat.status = "idle";
    store.family = "codex";
    expect(jiraBlocker()).toMatch(/Claude Code/);
    store.family = "claude";
    expect(jiraBlocker()).toBeNull();
    expect(afterApproval("approve-spec", true)).toBe(false);
    jiraSettings.setAutoExport(false);
    expect(afterApproval("approve-plan", true)).toBe(false);
    jiraSettings.setAutoExport(true);
    expect(afterApproval("approve-plan", true)).toBe(true);
    expect(store.sent[0]).toContain("The tracker is Jira at https://acme.atlassian.net, the project the site's Jira MCP server defaults to");
    jiraSettings.setProject(" proj ");
    expect(exportRequest("001-x", jira, "https://a.net")).toContain("project PROJ, reached through the `atlassian` MCP server (its mcp__atlassian__* tools)");
  });
});
