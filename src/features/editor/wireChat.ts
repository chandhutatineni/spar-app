// Feeds the editor integration from the chat feature's stores (agent, session, SPAR state).

import { agentIsRunning, attachToChat, focusComposer, sendToAgent, useChat, useSpar } from "../chat";
import { selectPhase, startNextIteration, currentPhase } from "../../state/spar";
import { resolve } from "../chat/catalog";
import { provideEditorIntegration, type ContextChip } from "./integration";

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "001-record-note-and-see-today" → "Record note and see today" */
export function featureTitle(id: string) {
  const words = id.split("-");
  if (words.length && /^\d+$/.test(words[0])) words.shift();
  return titleCase(words.join(" "));
}

/** The next step in plain words (Spar.actionTitle). */
export function actionTitle(n: { action: string; command?: string | null; gate?: string | null }): string {
  const run: Record<string, string> = {
    tenets: "Propose the engineering principles", fix: "Rework the fix", adopt: "Map the existing codebase", context: "Gather organisation context",
    specify: "Write the spec", clarify: "Resolve open questions", roadmap: "Shape the roadmap", plan: "Design the solution",
    tasks: "Break the plan into tasks", analyze: "Cross-check the artifacts", build: "Build the next tasks", verify: "Testing end to end", release: "Shipping",
  };
  const gate: Record<string, string> = {
    "approve-tenets": "Review the engineering principles", "approve-fix": "Review the fix", "approve-release": "Ready to ship",
    "approve-spec": "Review the spec", "approve-plan": "Review the plan", checkpoint: "Review the checkpoint",
  };
  switch (n.action) {
    case "run": return run[n.command ?? ""] ?? titleCase(n.command ?? "");
    case "check": return "Run the checks";
    case "fix": return "Fix what the checks found";
    case "gate": return gate[n.gate ?? ""] ?? "Your review";
    case "prompt": return n.command === "init" ? "What do you want to build?" : "What should we build?";
    case "select": return "Choose what to build first";
    case "setup": return "Set this up to continue";
    case "blocked": return "Blocked";
    case "done": return "Delivered";
    default: return titleCase(n.action);
  }
}

const toChatChip = (c: ContextChip) =>
  c.kind === "selection" ? { kind: "selection" as const, path: c.path, from: c.lines[0], to: c.lines[1], text: c.text } : c;

function sync() {
  const c = useChat.getState(), s = useSpar.getState();
  const agent = resolve(c.baseAgent, c.specDriven);
  provideEditorIntegration({
    sendToChat: (text) => sendToAgent(text),
    attachToChat: (chip) => attachToChat(toChatChip(chip)),
    focusComposer: () => { focusComposer(); },
    agentRunning: agentIsRunning(c),
    hasSession: !!c.sessionId,
    agentTitle: agent.title,
    runsSpar: !!agent.runsSpar,
    phase: { title: titleCase(s.phase) },
    sparSummary: {
      title: s.feature ? `Building: ${featureTitle(s.feature)}` : "Build something with SPAR",
      detail: s.next ? `${actionTitle(s.next)}: ${s.next.reason}` : "Describe an idea; SPAR turns it into a spec, a plan, tested code and a verified delivery.",
      hasFeature: !!s.feature,
    },
    startNextIteration: () => { startNextIteration(); },
    openWorkflow: () => { selectPhase(currentPhase() ?? "discover"); },
  });
}

sync();
useChat.subscribe(sync);
useSpar.subscribe(sync);
