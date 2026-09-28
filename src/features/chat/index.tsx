// Public surface of the chat feature: agent chat, the SPAR loop (sidebar + phase page),
// agent picker/settings. Owned by the chat feature; MainView and Settings import these.

import { useState } from "react";
import { Button, Toggle } from "../../ui";
import { usePref } from "../../lib/prefs";
import { call } from "../../lib/backend";
import { useChat } from "../../state/chat";
import { CustomAgents, type CustomAgent } from "./catalog";
import { AgentInfoSheet, CustomAgentSheet } from "./Sheets";
import "./chat.css";

export { AgentPanel } from "./AgentPanel";
export { WorkSidebar } from "./WorkSidebar";
export { PhaseView } from "./PhaseView";
export { AgentInfoSheet } from "./Sheets";

// For other features: hand work to the agent, attach context, ⌘K edits, MCP reloads.
export {
  send as sendToAgent, attach as attachToChat, attachFiles as attachFilesToChat, focusComposer, startInlineEdit, acceptInlineEdit,
  rejectInlineEdit, reloadAgentTools, useChat, isRunning as agentIsRunning, refreshChanges, undoRestore, type ContextChip,
} from "../../state/chat";
export { useSpar, refreshSpar } from "../../state/spar";

/** Agent spend for this project, in the toolbar. */
export function ToolbarCost() {
  const cost = useChat((s) => s.cost);
  if (!(cost > 0)) return null;
  return <span className="muted mono" style={{ fontSize: 12.5 }} title="Agent spend for this project">{cost.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
}

/** Settings ▸ Workflow: the auto-continue preference the chat reads. */
export function WorkflowSettings() {
  const [on, setOn] = usePref<boolean>("continueAfterApproval", true);
  return <Toggle on={on} onChange={setOn} label="Continue automatically after I approve a step" />;
}

/** The Settings window's "Agents" and "Your own models" sections. */
export function AgentSettings() {
  const [agents, setAgents] = useState<CustomAgent[]>(CustomAgents.load());
  const [info, setInfo] = useState(false);
  const [editing, setEditing] = useState<CustomAgent | "new" | null>(null);
  const section = (title: string, children: React.ReactNode) => (
    <section className="col" style={{ gap: 8 }}>
      <div className="headline">{title}</div>
      <div className="card col" style={{ gap: 10 }}>{children}</div>
    </section>
  );
  return (
    <div className="col" style={{ gap: 18 }}>
      {section("Agents", <>
        <span className="caption">Choose the agent, model, reasoning effort and approval mode from the chat composer. Choices are remembered per agent.</span>
        <button className="chat-link" style={{ alignSelf: "flex-start" }} onClick={() => setInfo(true)}>What's the difference between SPAR and Claude Code?</button>
        <button className="chat-link" style={{ alignSelf: "flex-start" }} onClick={() => call("mcp_show").catch(() => {})}>Manage MCP servers…</button>
      </>)}
      {section("Your own models", <>
        {agents.map((a) => (
          <div key={a.id} className="row">
            <div className="col" style={{ gap: 1, flex: 1, minWidth: 0 }}>
              <span>{a.title}</span>
              <span className="caption" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.model} · {a.baseURL}</span>
            </div>
            <Button size="small" onClick={() => setEditing(a)}>Edit…</Button>
          </div>
        ))}
        <div><Button onClick={() => setEditing("new")}>Add an agent on your own model…</Button></div>
        <span className="caption">Run Qwen or any other model with Ollama, LM Studio or an OpenAI-compatible server, and use it like any other agent.</span>
      </>)}
      {info && <AgentInfoSheet onClose={() => setInfo(false)} />}
      {editing && <CustomAgentSheet editing={editing === "new" ? undefined : editing} onClose={() => { setEditing(null); setAgents(CustomAgents.load()); }} />}
    </div>
  );
}
