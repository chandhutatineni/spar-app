// The Settings window's "Jira" section (SPARApp.swift SettingsView): site URL, project key,
// "Create the Jira issues when I approve the tasks", and which MCP server carries it.
// Rendered inside the Settings form's section card.

import { call } from "../../lib/backend";
import { usePref } from "../../lib/prefs";
import { Toggle } from "../../ui";
import { JIRA_KEYS, useJiraServer } from "./tracker";

const rowStyle = { minHeight: 34, padding: "5px 0", borderBottom: "0.5px solid var(--hairline)", justifyContent: "space-between", gap: 12 } as const;

export function JiraSettings() {
  const [url, setURL] = usePref<string>(JIRA_KEYS.url, "");
  const [project, setProject] = usePref<string>(JIRA_KEYS.project, "");
  const [auto, setAuto] = usePref<boolean>(JIRA_KEYS.autoExport, true);
  const server = useJiraServer();
  return (
    <>
      <label className="row settings-row" style={rowStyle}>
        <span style={{ flex: "none" }}>Site URL</span>
        <input className="text-field" style={{ maxWidth: 260 }} placeholder="https://your-team.atlassian.net" value={url} onChange={(e) => setURL(e.target.value)} spellCheck={false} />
      </label>
      <label className="row settings-row" style={rowStyle}>
        <span style={{ flex: "none" }}>Project key</span>
        <input className="text-field" style={{ maxWidth: 260 }} placeholder="PROJ" value={project} onChange={(e) => setProject(e.target.value)} spellCheck={false} />
      </label>
      <div className="row settings-row" style={rowStyle}>
        <Toggle label="Create the Jira issues when I approve the tasks" on={auto} onChange={setAuto} />
      </div>
      {server ? (
        <div className="caption" style={{ padding: "6px 0" }}>
          Through the {server.title} MCP server: an Epic per iteration, a Story per user story, a Sub-task per task. Keys are kept in the iteration's issues.md and shown on each task.
        </div>
      ) : (
        <div className="row caption" style={{ padding: "6px 0", gap: 6, flexWrap: "wrap" }}>
          <span>Add a Jira or Atlassian MCP server so the agent can create issues.</span>
          <button type="button" className="btn btn-plain" style={{ color: "var(--accent)", padding: 0, height: "auto", fontSize: 11.5 }} onClick={() => call("mcp_show").catch(() => {})}>Manage MCP servers…</button>
        </div>
      )}
    </>
  );
}
