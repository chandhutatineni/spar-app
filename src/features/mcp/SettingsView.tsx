// The Settings window (index.html#settings): a port of SettingsView in the Mac app's
// SPARApp.swift — a SwiftUI Form with .formStyle(.grouped), 480pt wide (form.tsx/form.css).
// Preferences use the Mac app's @AppStorage key names; features that read them (editor,
// terminal, diagrams, Jira, chat) follow changes through usePref.

import { useEffect, useState } from "react";
import { DiagramSettings } from "../docs";
import { app, type AppInfo } from "../../lib/api";
import { call } from "../../lib/backend";
import { usePref } from "../../lib/prefs";
import { useEngine } from "../../engine/engine";
import { Spinner, StatusDot } from "../../ui";
import { GitHubConnectSheet, useGitHubUser } from "../scm";
import { disconnect } from "../scm/github";
import { AgentInfoSheet, CustomAgentSheet } from "../chat/Sheets";
import { CustomAgents, type CustomAgent } from "../chat/catalog";
import { JIRA_KEYS, useJiraServer } from "../insights/tracker";
import { TERMINAL_DEFAULTS } from "../terminal/terminals";
import { githubAccountChanged } from "./store";
import { FormButton, FormCaption, FormLink, FormPage, FormPicker, FormRow, FormSection, FormSegmented, FormStepper, FormTextField, FormToggle, FormValue } from "./form";

const isMac = navigator.platform.toLowerCase().includes("mac");

export const DIAGRAM_ENGINES = [
  { value: "pythonDiagrams", label: "Python diagrams" },
  { value: "drawio", label: "draw.io" },
  { value: "d2", label: "D2" },
  { value: "mermaid", label: "Mermaid" },
  { value: "c4PlantUML", label: "C4-PlantUML" },
];

const showMCP = () => call("mcp_show").catch(() => {});

export function SettingsView(_p: any) {
  const [appearance, setAppearance] = usePref<"light" | "dark" | "system">("appearance", "system");
  const [fontSize, setFontSize] = usePref("editorFontSize", 13);
  const [wordWrap, setWordWrap] = usePref("editorWordWrap", false);
  const [minimap, setMinimap] = usePref("editorMinimap", true);
  const [autoSave, setAutoSave] = usePref("editorAutoSave", false);
  const [formatOnSave, setFormatOnSave] = usePref("editorFormatOnSave", false);
  const [testLocally, setTestLocally] = usePref("testLocallyAfterBuild", true);
  const [continueAfterApproval, setContinueAfterApproval] = usePref("continueAfterApproval", true);

  useEffect(() => { document.title = "Settings"; }, []);

  return (
    <FormPage>
      <FormSection title="Appearance">
        <FormSegmented label="Theme" value={appearance} onChange={setAppearance} options={[
          { value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "Match System" },
        ]} />
      </FormSection>

      <FormSection title="Editor">
        <FormStepper label={`Font size: ${fontSize} pt`} value={fontSize} onChange={setFontSize} min={10} max={24} />
        <FormToggle label="Word wrap" on={wordWrap} onChange={setWordWrap} />
        <FormToggle label="Minimap" on={minimap} onChange={setMinimap} />
        <FormToggle label="Auto-save after a second of inactivity" on={autoSave} onChange={setAutoSave} />
        <FormToggle label="Format on save (for languages the editor can format)" on={formatOnSave} onChange={setFormatOnSave} />
      </FormSection>

      <FormSection title="Diagrams">
        <DiagramSettings />
      </FormSection>

      <TerminalSection />

      <FormSection title="Workflow">
        <FormToggle label="Continue automatically after I approve a step" on={continueAfterApproval} onChange={setContinueAfterApproval} />
        <FormToggle label="Run tests and the app locally when the build finishes" on={testLocally} onChange={setTestLocally} />
        <FormCaption>UI-first delivery (mock data, then integration) is set per project on the Develop page.</FormCaption>
      </FormSection>

      <JiraSection />
      <AccountsSection />
      <AgentsSections />
      <EngineSection />
    </FormPage>
  );
}

function TerminalSection() {
  const d = TERMINAL_DEFAULTS;
  const [size, setSize] = usePref("terminalFontSize", d.terminalFontSize);
  const [font, setFont] = usePref("terminalFontFamily", d.terminalFontFamily);
  const [shell, setShell] = usePref("terminalShell", d.terminalShell);
  const [cursor, setCursor] = usePref<"block" | "underline" | "bar">("terminalCursorStyle", d.terminalCursorStyle);
  const [blink, setBlink] = usePref("terminalCursorBlink", d.terminalCursorBlink);
  const [scrollback, setScrollback] = usePref("terminalScrollback", d.terminalScrollback);
  return (
    <FormSection title="Terminal">
      <FormStepper label={`Font size: ${Number(size).toFixed(1)} pt`} value={Number(size)} onChange={setSize} min={9} max={24} step={0.5} />
      <FormTextField label="Font family (empty = SF Mono)" value={font} onChange={setFont} />
      <FormTextField label="Shell (empty = your login shell)" value={shell} onChange={setShell}
        help="For example /bin/zsh, /bin/bash, /opt/homebrew/bin/fish. Applies to new terminals." />
      <FormPicker label="Cursor" value={cursor} onChange={setCursor} options={[
        { value: "block", label: "Block" }, { value: "bar", label: "Bar" }, { value: "underline", label: "Underline" },
      ]} />
      <FormToggle label="Blinking cursor" on={blink} onChange={setBlink} />
      <FormStepper label={`Scrollback: ${scrollback} lines`} value={Number(scrollback)} onChange={setScrollback} min={1000} max={100000} step={1000} />
    </FormSection>
  );
}

function JiraSection() {
  const [url, setURL] = usePref<string>(JIRA_KEYS.url, "");
  const [project, setProject] = usePref<string>(JIRA_KEYS.project, "");
  const [auto, setAuto] = usePref<boolean>(JIRA_KEYS.autoExport, true);
  const server = useJiraServer();
  return (
    <FormSection title="Jira">
      <FormTextField label="Site URL" value={url} onChange={setURL} prompt="https://your-team.atlassian.net" />
      <FormTextField label="Project key" value={project} onChange={setProject} prompt="PROJ" />
      <FormToggle label="Create the Jira issues when I approve the tasks" on={auto} onChange={setAuto} />
      {server ? (
        <FormCaption>Through the {server.title} MCP server: an Epic per iteration, a Story per user story, a Sub-task per task. Keys are kept in the iteration's issues.md and shown on each task.</FormCaption>
      ) : (
        <div className="gf-row">
          <span className="gf-caption inline">Add a Jira or Atlassian MCP server so the agent can create issues.</span>
          <FormLink style={{ fontSize: 10, flex: "none" }} onClick={showMCP}>Manage MCP servers…</FormLink>
          <span style={{ flex: 1 }} />
        </div>
      )}
    </FormSection>
  );
}

function AccountsSection() {
  const user = useGitHubUser();
  const [connecting, setConnecting] = useState(false);
  return (
    <FormSection title="Accounts">
      <FormRow label="GitHub">
        {user ? (
          <span className="row" style={{ gap: 8 }}>
            <span>{user.login}</span>
            <FormButton onClick={async () => { await disconnect().catch(() => {}); githubAccountChanged(); }}>Disconnect</FormButton>
          </span>
        ) : (
          <FormButton onClick={() => setConnecting(true)}>Connect…</FormButton>
        )}
      </FormRow>
      {connecting && <GitHubConnectSheet onClose={() => { setConnecting(false); githubAccountChanged(); }} />}
    </FormSection>
  );
}

function AgentsSections() {
  const [agents, setAgents] = useState<CustomAgent[]>(() => CustomAgents.load());
  const [info, setInfo] = useState(false);
  const [editing, setEditing] = useState<CustomAgent | "new" | null>(null);
  return (
    <>
      <FormSection title="Agents">
        <FormCaption>Choose the agent, model, reasoning effort and approval mode from the chat composer. Choices are remembered per agent.</FormCaption>
        <FormRow><FormLink onClick={() => setInfo(true)}>What's the difference between SPAR and Claude Code?</FormLink></FormRow>
        <FormRow><FormLink onClick={showMCP}>Manage MCP servers…</FormLink></FormRow>
      </FormSection>
      <FormSection title="Your own models">
        {agents.map((a) => (
          <FormRow key={a.id} top label={
            <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span>{a.title}</span>
              <span className="gf-caption inline" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.model} · {a.baseURL}</span>
            </span>
          }>
            <FormButton onClick={() => setEditing(a)}>Edit…</FormButton>
          </FormRow>
        ))}
        <FormRow><FormButton onClick={() => setEditing("new")}>Add an agent on your own model…</FormButton><span style={{ flex: 1 }} /></FormRow>
        <FormCaption>Run Qwen or any other model with Ollama, LM Studio or an OpenAI-compatible server, and use it like any other agent.</FormCaption>
      </FormSection>
      {info && <AgentInfoSheet onClose={() => setInfo(false)} />}
      {editing && <CustomAgentSheet editing={editing === "new" ? undefined : editing} onClose={() => { setEditing(null); setAgents(CustomAgents.load()); }} />}
    </>
  );
}

function EngineSection() {
  const { status, busy, error, refresh, restart } = useEngine();
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    refresh().catch(() => {});
    app.info().then(setInfo).catch(() => {});
    const t = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);
  const state = busy ? "running" : status?.ready ? "idle" : status?.missing.length ? "failed" : "offline";
  return (
    <FormSection title="Engine">
      <FormValue label="Agent engine">127.0.0.1:{status?.port ?? 47827}</FormValue>
      <FormRow label="Status">
        <span className="row" style={{ gap: 8, minWidth: 0 }}>
          {busy ? <Spinner small /> : <StatusDot status={state} />}
          <span className="gf-value" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {busy === "restarting" ? "Restarting…" : busy === "setup" ? "Setting up…" : busy === "starting" ? "Starting…" : status?.message ?? "…"}
          </span>
          <FormButton disabled={!!busy} onClick={() => restart()}>Restart</FormButton>
        </span>
      </FormRow>
      {error && <FormCaption><span style={{ color: "var(--stop)" }}>{error}</span></FormCaption>}
      <FormRow label="Logs">
        <FormButton disabled={!info} onClick={() => info && app.reveal(info.data_dir)}>{isMac ? "Show in Finder" : "Show in File Manager"}</FormButton>
      </FormRow>
    </FormSection>
  );
}
