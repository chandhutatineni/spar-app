// The issue tracker: Jira, reached through an MCP server the agent can use. The keys the agent
// creates are kept in `specs/<feature>/issues.md`, not in tasks.md, so recording them doesn't
// reopen the approved design. A port of `Tracker` in Backend/Trace.swift, plus the Workspace's
// Jira part (jiraBlocker, exportToJira, the export after "approve tasks").

import { useEffect } from "react";
import { create } from "zustand";
import { app, fs } from "../../lib/api";
import { prefs, usePref } from "../../lib/prefs";
import { onFilesChanged } from "../../state/app";
import { useSpar } from "../../state/spar";
import { agentOf, isRunning, send, useChat } from "../../state/chat";
import { Spar } from "../chat/sparcli";
import { useMCP } from "../mcp/store";
import type { MCPServer } from "../mcp/mcpJson";
import { browse as browseWith, isWeb, parseIssues as parseWith, trackerPath, trimChars, type TrackerIssue } from "./issues";

/** The Settings keys (the Mac app's @AppStorage names). */
export const JIRA_KEYS = { url: "jiraURL", project: "jiraProject", autoExport: "jiraAutoExport" } as const;

export const jiraSettings = {
  url: () => prefs.get<string>(JIRA_KEYS.url, ""),
  project: () => prefs.get<string>(JIRA_KEYS.project, ""),
  autoExport: () => prefs.get<boolean>(JIRA_KEYS.autoExport, true),
  setURL: (v: string) => prefs.set(JIRA_KEYS.url, v),
  setProject: (v: string) => prefs.set(JIRA_KEYS.project, v),
  setAutoExport: (v: boolean) => prefs.set(JIRA_KEYS.autoExport, v),
};

export { trackerPath, isWeb, type TrackerIssue } from "./issues";
export const browse = (key: string, saved = jiraSettings.url()) => browseWith(key, saved);
export const parseIssues = (text: string, feature: string, saved = jiraSettings.url()) => parseWith(text, feature, saved);

export async function loadIssues(root: string, feature: string) {
  const text = await fs.readText(trackerPath(await Spar.dir(root), feature)).catch(() => null);
  return text == null ? {} : parseIssues(text, feature);
}

/** An enabled Jira or Atlassian MCP server whose check didn't fail. */
export function server(s = useMCP.getState()): MCPServer | null {
  return s.servers.find((x) => {
    if (!x.enabled) return false;
    if ((s.status[x.id]?.state ?? "unknown") === "failed") return false;
    const text = [x.id, x.title, x.source ?? "", x.url ?? "", x.command ?? "", ...x.args].join(" ").toLowerCase();
    return text.includes("jira") || text.includes("atlassian");
  }) ?? null;
}

/** The Jira site, e.g. https://acme.atlassian.net: from Settings, else the MCP server's JIRA_URL. */
export function site(): string | null {
  const saved = jiraSettings.url().trim();
  const raw = saved || (server()?.env?.JIRA_URL ?? "");
  if (!raw) return null;
  const full = raw.includes("://") ? raw : "https://" + raw;
  try {
    const u = new URL(full);
    if (!isWeb(full) || !u.host) return null;
  } catch { return null; }
  return trimChars(full, "/");
}

export const projectKey = () => jiraSettings.project().trim().toUpperCase();

export function openIssue(issue: TrackerIssue) {
  if (issue.url && isWeb(issue.url)) app.open(issue.url).catch(() => {});
}

/** Asks the agent to create (or update) the epic, stories and tasks, and record their keys. */
export function exportRequest(feature: string, srv: Pick<MCPServer, "id">, siteURL: string): string {
  const dir = `spar/specs/${feature}`;
  const key = projectKey();
  const project = key ? `project ${key}` : "the project the site's Jira MCP server defaults to (ask me once if there is none)";
  return `Run SPAR's issues step for ${feature}: follow ~/.claude/spar-steps/issues.md, with these specifics. `
    + `The tracker is Jira at ${siteURL}, ${project}, reached through the \`${srv.id}\` MCP server (its mcp__${srv.id}__* tools). `
    + `Create or update one Epic for the feature ("${Spar.featureTitle(feature)}"); one Story per user story in ${dir}/spec.md `
    + `(US1, US2…; summary is the story title, description is the story and its acceptance criteria), in the Epic; and one `
    + `Sub-task per task in ${dir}/tasks.md under its story (summary "T001 · <title>", description from its What, Context and `
    + `Implementation, plus a Definition of Done from its Acceptance). Tasks tagged US0 belong to no story: make them Tasks in the Epic. `
    + `It must be idempotent: read ${dir}/issues.md first and update the issues it lists instead of creating new ones. `
    + `Record every key in ${dir}/issues.md as one table \`| Item | Type | Key | URL |\`, a row for the Epic (Item ${feature}), `
    + `each story (Item US1…) and each task (Item T001…), with URL ${siteURL}/browse/<KEY>. Write nothing into tasks.md: it is `
    + `approved, and editing it would reopen the approval. Leave issues unassigned; never transition or close one. `
    + `Reply with one line: how many issues you created and how many you updated.`;
}

/** Why the tasks can't go to Jira right now, or null when they can. */
export function jiraBlocker(): string | null {
  const sp = useSpar.getState();
  const chat = useChat.getState();
  if (!sp.feature) return "No iteration yet";
  if (!server()) return "Add a Jira or Atlassian MCP server first";
  if (!site()) return "Set your Jira site URL in Settings";
  if (agentOf(chat).family !== "claude") return "Jira export runs through Claude Code: the app's MCP servers reach Claude-based agents";
  if (sp.gates["approve-plan"]?.approved !== true) return "Approve the plan and tasks first";
  if (!chat.sessionId) return "The agent isn't connected yet";
  if (isRunning(chat)) return "Wait for the agent to finish its turn";
  return null;
}

/** Asks the agent to create or update the epic, stories and tasks in Jira and record their keys. */
export function exportToJira(): boolean {
  const f = useSpar.getState().feature;
  const srv = server(), s = site();
  if (jiraBlocker() != null || !f || !srv || !s) return false;
  send(exportRequest(f, srv, s), "Creating the Jira issues…");
  return true;
}

/**
 * For the chat's gate decision: approved tasks go to Jira first when it's set up (the build
 * carries on when that turn ends). Returns true when the export was sent, so the caller skips
 * "continue after approval".
 */
export function afterApproval(gate: string, approve: boolean): boolean {
  if (!approve || gate !== "approve-plan" || !jiraSettings.autoExport() || jiraBlocker() != null) return false;
  return exportToJira();
}

// ---- Live state for views ------------------------------------------------------------

interface IssuesStore { key: string; issues: Record<string, TrackerIssue> }
export const useIssuesStore = create<IssuesStore>(() => ({ key: "", issues: {} }));

let watching: (() => void) | null = null;
async function refreshIssues() {
  const { root, feature } = useSpar.getState();
  const key = `${root}#${feature ?? ""}`;
  const issues = root && feature ? await loadIssues(root, feature) : {};
  const { root: r2, feature: f2 } = useSpar.getState();
  if (`${r2}#${f2 ?? ""}` === key) useIssuesStore.setState({ key, issues });
}

/**
 * The selected feature's tracker keys (the Mac app's `ws.issues`), kept fresh when issues.md
 * changes. Also makes sure the MCP store is loaded so `server()` sees the servers.
 */
export function useIssues(): Record<string, TrackerIssue> {
  const root = useSpar((s) => s.root);
  const feature = useSpar((s) => s.feature);
  const reload = useSpar((s) => s.version);
  const url = usePref<string>(JIRA_KEYS.url, "")[0];
  useEffect(() => {
    if (!useMCP.getState().loaded) useMCP.getState().load().catch(() => {});
    if (!watching) watching = onFilesChanged((paths) => { if (paths.some((p) => p.endsWith("/issues.md"))) refreshIssues(); });
  }, []);
  useEffect(() => { refreshIssues(); }, [root, feature, reload, url]);
  return useIssuesStore((s) => s.issues);
}

/** Re-renders on everything `jiraBlocker()` reads, and returns it. */
export function useJiraBlocker(): string | null {
  useMCP((s) => s.servers); useMCP((s) => s.status);
  usePref<string>(JIRA_KEYS.url, "");
  useChat((s) => s.status); useChat((s) => s.sessionId); useChat((s) => s.baseAgent); useChat((s) => s.specDriven);
  useSpar((s) => s.gates); useSpar((s) => s.feature);
  return jiraBlocker();
}

/** Re-renders when the MCP servers change, and returns the Jira one. */
export function useJiraServer(): MCPServer | null {
  const servers = useMCP((s) => s.servers);
  const status = useMCP((s) => s.status);
  const loaded = useMCP((s) => s.loaded);
  useEffect(() => { if (!loaded) useMCP.getState().load().catch(() => {}); }, [loaded]);
  return server({ ...useMCP.getState(), servers, status });
}
