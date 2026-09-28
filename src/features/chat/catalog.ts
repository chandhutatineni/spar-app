// What the composer can offer for each agent: its models, reasoning levels and permission
// modes (a port of the Mac app's AgentCatalog.swift and CustomAgents.swift). The engine runs
// the agents; it does not enumerate models for native CLIs, so the lists live here.

import { prefs } from "../../lib/prefs";
import { exec, secrets } from "../../lib/api";

export interface Model { id: string | null; title: string; detail: string }
export interface Mode { id: string; title: string; detail: string; icon: string }
export type Family = "claude" | "codex" | "copilot" | "bob" | "other";

export interface AgentKind {
  /** Engine agent name */
  name: string;
  title: string;
  subtitle: string;
  /** lucide icon name, or a single letter drawn in the badge */
  icon: string;
  tint: string;
  family: Family;
  runsSpar?: boolean;
}

export const ACCENT = "#5c57f2";

// ---- Conventions the agents get in their prompts ---------------------------------------

type DiagramEngine = "pythonDiagrams" | "drawio" | "d2" | "mermaid" | "c4PlantUML";
const DIAGRAM: Record<DiagramEngine, { title: string; ext: string }> = {
  pythonDiagrams: { title: "Python diagrams", ext: "py" },
  drawio: { title: "draw.io", ext: "drawio" },
  d2: { title: "D2", ext: "d2" },
  mermaid: { title: "Mermaid", ext: "mmd" },
  c4PlantUML: { title: "C4-PlantUML", ext: "puml" },
};

/** DiagramEngine.conventions: which diagram tools to write, from the Settings choice. */
export function diagramConventions(): string {
  const arch = DIAGRAM[prefs.get<DiagramEngine>("diagramArchitecture", "pythonDiagrams")] ?? DIAGRAM.pythonDiagrams;
  const other = DIAGRAM[prefs.get<DiagramEngine>("diagramOther", "drawio")] ?? DIAGRAM.drawio;
  return `diagrams: architecture diagrams use ${arch.title} (.${arch.ext}), all other diagrams use ${other.title} (.${other.ext}); put them in docs/diagrams/ (or spar/specs/<feature>/diagrams/ in SPAR's design phase) and embed them in markdown with an image link like ![Architecture](diagrams/architecture.${arch.ext}); the app renders .py (diagrams), .drawio, .d2, .mmd and .puml files, so write only the source and don't install or run tools; never hand-write draw.io XML — describe it and run \`spar drawio sequence|er|flow '<json>' -o <file>.drawio\` (sequence: participants, messages with from/to/label/reply, notes; er: entities with fields, relations with many; flow: nodes with id/label/shape/group, edges), which lays it out correctly`;
}

export const SLIDES_CONVENTIONS = `slides: when asked for slides or a presentation, write one self-contained HTML deck at docs/slides/<name>.html: 16:9, one <section class="slide"> per slide with an <h1>/<h2> title, short <ul>/<ol> bullets, <p>, <table> or <img> (relative paths or data URIs), speaker notes in <aside class="notes">, inline CSS and arrow-key navigation, no external assets; the app previews it and exports it to PowerPoint (.pptx), so don't create .pptx files yourself`;

export const QUESTION_BLOCK_HELP = `a fenced \`\`\`spar-questions block holding a JSON list, one object per question: {"id": "auth", "question": "How do people sign in?", "options": [{"label": "Email and password", "detail": "simplest"}, {"label": "Google sign-in"}], "recommended": 0} (add "multi": true when several can be picked); the app shows it as a form with the options, room for their own answer, and a Submit — then stop and wait`;

/** How to write diagrams and slides so the app can render and export them. */
export function appConventions(): string {
  return "You are working inside the SPAR desktop app. " + diagramConventions() + ". " + SLIDES_CONVENTIONS + ". "
    + `When you need the person to decide something, ask every question at once as ${QUESTION_BLOCK_HELP}.`;
}

/** Agents other than Claude Code have no SPAR slash commands; they run the same playbooks
 *  through the `spar` CLI and the markdown in ~/.claude. */
export const PORTABLE_SPAR_PROMPT = `You run the SPAR spec-driven workflow in this project: Discover (brief and spec), Design (plan and tasks),
Develop (build), Deliver (verify). The deterministic rules live in the \`spar\` CLI; use it through the shell:
\`spar next <feature> --json\` names exactly one next action, \`spar check --feature <feature> --scope <scope> --json\`
runs the checks, \`spar template <name>\` prints an artifact template, \`spar gate <feature> --json\` shows approvals.
SPAR's playbooks are markdown files: the commands are ~/.claude/commands/spar.<command>.md (init, explore,
design, build, deliver, adopt, fix, reconcile, sync), they share the loop in ~/.claude/spar-steps/phase-loop.md,
and each step is ~/.claude/spar-steps/<step>.md. Templates come from \`spar template <name>\`: never search
the disk for SPAR files, everything is at those paths. Read playbooks with your file viewer, one at a time,
only when you reach the step that needs them. When a playbook delegates to a spar-* agent, read
~/.claude/agents/<agent>.md and do that part yourself. Artifacts go in spar/specs/<feature>/.
Never approve a human gate yourself (spar gate approve is the person's decision); stop, say what to review, and
point to the Approve / Request changes buttons the SPAR app shows under your message.
Ask questions only as a fenced \`\`\`spar-questions JSON block (see the app conventions), never as prose.
Never call work done without running the tests and the app locally.
While building, tick each task in tasks.md (\`- [x] T###\`) the moment it passes, one at a time, never in a batch
at the end: the SPAR app shows build progress live from those ticks.
Bracket every task for the impact report: run \`spar impact begin T### --feature <feature> --agent <your name>\`
before starting it and \`spar impact end T### --feature <feature>\` right after ticking it (\`--status failed\`
if you have to stop). Commits for a task carry the trailer \`SPAR-Task: <feature>/T###\`.
You are inside the SPAR desktop app: talk in product terms and never mention spar commands, slash commands,
step or playbook names, or paths under ~/.claude to the person; the app handles approvals with buttons.`;

// ---- Custom agents on your own models --------------------------------------------------

export type Provider = "ollama" | "lmstudio" | "openai";
export const PROVIDERS: { id: Provider; title: string; defaultURL: string }[] = [
  { id: "ollama", title: "Ollama", defaultURL: "http://localhost:11434/v1" },
  { id: "lmstudio", title: "LM Studio", defaultURL: "http://localhost:1234/v1" },
  { id: "openai", title: "OpenAI-compatible (vLLM, llama.cpp, a gateway…)", defaultURL: "http://localhost:8000/v1" },
];
export const providerInfo = (p: Provider) => PROVIDERS.find((x) => x.id === p) ?? PROVIDERS[0];

export interface CustomAgent { id: string; title: string; provider: Provider; baseURL: string; model: string }

export const customAgentName = (a: CustomAgent) => `custom-${a.id}`;
export const customKeychainKey = (a: CustomAgent) => `custom-agent-${a.id}`;
/** The env var that carries the API key to the engine, so it isn't written to disk. */
export const customKeyEnv = (a: CustomAgent) => "SPAR_CUSTOM_KEY_" + a.id.toUpperCase().replace(/-/g, "_");

export function slug(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "-").split("-").filter(Boolean).join("-");
}

export const CustomAgents = {
  load(): CustomAgent[] {
    return prefs.get<CustomAgent[]>("customAgents", []);
  },
  save(list: CustomAgent[]) {
    prefs.set("customAgents", list);
  },
  async upsert(agent: CustomAgent, apiKey: string) {
    const list = CustomAgents.load().filter((a) => a.id !== agent.id);
    list.push(agent);
    CustomAgents.save(list);
    await secrets.set(customKeychainKey(agent), apiKey ? apiKey : null);
  },
  async remove(agent: CustomAgent) {
    CustomAgents.save(CustomAgents.load().filter((a) => a.id !== agent.id));
    await secrets.set(customKeychainKey(agent), null);
  },
  isCustom(agentName: string) {
    const base = agentName.startsWith("spar-") ? agentName.slice(5) : agentName;
    return base.startsWith("custom-");
  },
  /** API keys for the engine's environment (local servers accept any value). */
  async environment(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const a of CustomAgents.load()) {
      const k = await secrets.get(customKeychainKey(a)).catch(() => null);
      out[customKeyEnv(a)] = k && k.length ? k : "local";
    }
    return out;
  },
};

// ---- The catalog -----------------------------------------------------------------------

export const BUILT_IN: AgentKind[] = [
  { name: "claude-native-ui", title: "Claude Code", subtitle: "Anthropic's coding agent", icon: "Asterisk", tint: "#d97857", family: "claude" },
  { name: "codex-native-ui", title: "Codex", subtitle: "OpenAI's coding agent", icon: "Code", tint: "#333338", family: "codex" },
  { name: "copilot", title: "GitHub Copilot", subtitle: "GitHub's coding agent", icon: "UserCheck", tint: "#212429", family: "copilot" },
  { name: "grok", title: "Grok", subtitle: "xAI's coding agent", icon: "Sparkle", tint: "#1a1a1a", family: "other" },
  { name: "opencode-native-ui", title: "OpenCode", subtitle: "Open-source coding agent", icon: "Braces", tint: "#4d4d59", family: "other" },
  { name: "goose-native-ui", title: "Goose", subtitle: "Block's open agent", icon: "Bird", tint: "#8e8e93", family: "other" },
  { name: "qwen-native-ui", title: "Qwen Code", subtitle: "Alibaba's coding agent", icon: "Q", tint: "#af52de", family: "other" },
  { name: "kimi-native-ui", title: "Kimi Code", subtitle: "Moonshot's coding agent", icon: "Moon", tint: "#5856d6", family: "other" },
  { name: "devin-native-ui", title: "Devin", subtitle: "Cognition's agent", icon: "SquareUser", tint: "#30b0c7", family: "other" },
  { name: "hermes-native-ui", title: "Hermes", subtitle: "Nous Research agent", icon: "Wind", tint: "#00c7be", family: "other" },
  { name: "pi-native-ui", title: "Pi", subtitle: "Minimal coding agent", icon: "P", tint: "#a2845e", family: "other" },
  { name: "bob", title: "IBM Bob", subtitle: "IBM's coding agent", icon: "B", tint: "#0f61fd", family: "bob" },
  { name: "polly", title: "Polly", subtitle: "Splits a goal across several agents", icon: "Users", tint: "#ff9500", family: "other" },
];

/** Engine harnesses that get a spec-driven variant bundle. */
export const VARIANT_HARNESSES: { agent: string; harness: string }[] = [
  { agent: "copilot", harness: "copilot" }, { agent: "grok", harness: "grok" }, { agent: "codex-native-ui", harness: "codex-native" },
  { agent: "opencode-native-ui", harness: "opencode-native" },
  { agent: "goose-native-ui", harness: "goose-native" }, { agent: "qwen-native-ui", harness: "qwen-native" }, { agent: "kimi-native-ui", harness: "kimi-native" },
  { agent: "devin-native-ui", harness: "devin-native" }, { agent: "hermes-native-ui", harness: "hermes-native" }, { agent: "pi-native-ui", harness: "pi-native" },
];

/** The CLI each harness drives, so availability doesn't wait on the host's report. */
export const HARNESS_BINARIES: Record<string, string> = {
  "claude-native": "claude", "codex-native": "codex", grok: "grok", "opencode-native": "opencode",
  "goose-native": "goose", "qwen-native": "qwen", "kimi-native": "kimi", "devin-native": "devin",
  "hermes-native": "hermes", "pi-native": "pi",
};

export const CLAUDE_VIBE_AGENT = "spar-claude-vibe";

/** Built-in agents plus the ones you added on your own models. */
export function allAgents(): AgentKind[] {
  return [
    ...BUILT_IN,
    ...CustomAgents.load().map((a): AgentKind => ({
      name: customAgentName(a), title: a.title,
      subtitle: `${a.model} · ${a.provider === "openai" ? "custom endpoint" : providerInfo(a.provider).title}`,
      icon: "Cpu", tint: "#34c759", family: "other",
    })),
  ];
}

export const isCustom = (k: AgentKind) => k.name.startsWith("custom-") || k.name.startsWith("spar-custom-");

/** Spec-driven work runs the SPAR variant of the chosen agent. */
export function variantName(base: AgentKind) {
  return base.name === "claude-native-ui" ? "spar" : "spar-" + base.name;
}

export function resolve(base: AgentKind, specDriven: boolean): AgentKind {
  if (!specDriven) return base;
  return { ...base, name: variantName(base), runsSpar: true };
}

export function named(name: string): AgentKind {
  const all = allAgents();
  const claude = all.find((k) => k.name === "claude-native-ui")!;
  if (name === "spar") return resolve(claude, true);
  if (name.startsWith("spar-")) {
    const base = all.find((k) => k.name === name.slice(5));
    if (base) return resolve(base, true);
  }
  return all.find((k) => k.name === name) ?? claude;
}

/** For badges that stand for the SPAR workflow itself. */
export const SPAR_KIND: AgentKind = { name: "spar", title: "SPAR", subtitle: "Spec-driven development", icon: "RefreshCcw", tint: ACCENT, family: "claude", runsSpar: true };

/** The base agent of a (possibly spec-driven) agent name. */
export function baseOf(kind: AgentKind): AgentKind {
  if (!kind.runsSpar) return kind;
  return named(kind.name === "spar" ? "claude-native-ui" : kind.name.slice(5));
}

// ---- Copilot's models (CopilotModels.swift) ---------------------------------------------
// The models your Copilot plan offers, asked of the Copilot SDK that the engine's `copilot`
// extra installs. null until the first successful fetch; a short built-in list until then.

let copilotModelList: Model[] | null = null;

const COPILOT_SCRIPT = `import asyncio, json, os
from copilot import CopilotClient
async def main():
    token = next((os.environ[v] for v in ("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN") if os.environ.get(v)), None)
    c = CopilotClient(github_token=token, log_level="error")
    await c.start()
    try:
        out = []
        for m in await c.list_models():
            state = m.policy.state if m.policy else "enabled"
            mult = m.billing.multiplier if m.billing else None
            out.append({"id": m.id, "name": m.name, "state": state, "multiplier": mult})
        print(json.dumps(out))
    finally:
        await c.stop()
asyncio.run(main())
`;

export async function refreshCopilotModels() {
  // The Python inside the engine's tool environment, where the Copilot SDK lives.
  const out = await exec.run("sh", ["-c", 'd=$(dirname "$(readlink -f "$(command -v omnigent)")") && [ -x "$d/python" ] && exec "$d/python" -c "$1"', "_", COPILOT_SCRIPT],
    { cwd: "/tmp", timeoutMs: 60_000 }).catch(() => null);
  if (!out?.ok) return;
  let items: any[];
  try { items = JSON.parse(out.stdout.trim().split("\n").pop() ?? ""); } catch { return; }
  const list: Model[] = (Array.isArray(items) ? items : []).filter((m) => typeof m?.id === "string" && m.state !== "disabled").map((m) => {
    let detail = "Via Copilot";
    if (typeof m.multiplier === "number") detail += m.multiplier === 0 ? " · included" : ` · ${m.multiplier}×`;
    if (m.state === "unconfigured") detail += " · enable in GitHub settings";
    return { id: m.id, title: typeof m.name === "string" ? m.name : m.id, detail };
  });
  if (list.length) copilotModelList = list;
}

export function models(k: AgentKind): Model[] {
  switch (k.family) {
    case "claude":
      return [
        { id: null, title: "Default", detail: "Claude Code's configured model" },
        { id: "opus", title: "Opus 5.5", detail: "Most capable" },
        { id: "opus[1m]", title: "Opus 5.5 · 1M", detail: "1M-token context" },
        { id: "sonnet", title: "Sonnet 5", detail: "Fast and capable" },
        { id: "haiku", title: "Haiku 4.5", detail: "Fastest, lowest cost" },
      ];
    case "copilot":
      return [
        { id: null, title: "Auto", detail: "Copilot picks the model" },
        ...(copilotModelList ?? [
          { id: "claude-sonnet-4.5", title: "Claude Sonnet 4.5", detail: "Via Copilot" },
          { id: "claude-haiku-4.5", title: "Claude Haiku 4.5", detail: "Via Copilot" },
          { id: "gpt-5", title: "GPT-5", detail: "Via Copilot" },
          { id: "gpt-5-mini", title: "GPT-5 mini", detail: "Via Copilot" },
        ]),
      ];
    default:
      return [{ id: null, title: "Default", detail: isCustom(k) ? "The model this agent was set up with" : "The agent's configured model" }];
  }
}

export function efforts(k: AgentKind): string[] {
  if (isCustom(k)) return [];
  switch (k.family) {
    case "claude": return ["low", "medium", "high", "xhigh", "max"];
    case "codex": return ["minimal", "low", "medium", "high"];
    case "bob": return [];
    default: return ["low", "medium", "high"];
  }
}

export function modes(k: AgentKind): Mode[] {
  switch (k.family) {
    case "claude":
      return [
        { id: "default", title: "Ask before edits", detail: "Approve every edit and command", icon: "Hand" },
        { id: "acceptEdits", title: "Auto-accept edits", detail: "Edits apply; commands still ask", icon: "ShieldCheck" },
        { id: "bypassPermissions", title: "Full auto", detail: "No approvals at all. Use with care.", icon: "Zap" },
      ];
    case "bob":
      return [];
    default:
      // The app answers these agents' approval cards itself when told to.
      return [
        { id: "ask", title: "Ask before commands", detail: "Approve each command and edit", icon: "Hand" },
        { id: "auto", title: "Allow all commands", detail: "No approvals in this project. Use with care.", icon: "Zap" },
      ];
  }
}

/** Whether the app approves this agent's requests without asking. */
export const autoApproves = (k: AgentKind, mode: string | null | undefined) => k.family !== "claude" && mode === "auto";

export const defaultMode = (k: AgentKind): string | null => (k.family === "claude" ? "acceptEdits" : modes(k)[0]?.id ?? null);

/** Claude Code flags for a session of this agent. `mcpConfig` is the MCP servers file, when it exists. */
export function launchArgs(k: AgentKind, mode: string | null | undefined, mcpConfig: string | null): string[] {
  if (k.family !== "claude") return [];
  const allowed = [
    "Read", "Glob", "Grep", "Task", "TodoWrite", "Skill", "ToolSearch",
    "mcp__spar", "mcp__spar-gateway", "mcp__codegraph",
    "Bash(spar:*)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(ls:*)",
  ];
  // --mcp-config takes several values, so it goes first and the next flag ends it.
  // AskUserQuestion opens a picker inside Claude Code's own terminal, which the app can't
  // answer, so questions come to the chat instead.
  return [
    ...(mcpConfig ? ["--mcp-config", mcpConfig] : []),
    "--permission-mode", mode ?? "acceptEdits", "--allowedTools", allowed.join(","),
    "--disallowedTools", "AskUserQuestion",
  ];
}

export function effortTitle(e: string | null | undefined): string {
  if (e == null) return "Auto effort";
  if (e === "xhigh") return "Extra high";
  return e.charAt(0).toUpperCase() + e.slice(1);
}

/** "claude-opus-5-5[1m]" → "Opus 5.5 · 1M"; other ids are shown as they are. */
export function prettyModel(id: string): string {
  let name = id.replace(/claude-/g, "");
  const long = name.endsWith("[1m]");
  name = name.replace("[1m]", "");
  const parts = name.split("-").filter(Boolean);
  const family = parts[0];
  if (!family || !["opus", "sonnet", "haiku"].includes(family)) return id;
  const version = parts.slice(1).filter((p) => p.length <= 2).join(".");
  return `${family.charAt(0).toUpperCase() + family.slice(1)}${version ? " " + version : ""}${long ? " · 1M" : ""}`;
}

// ---- Remembered choices per agent ------------------------------------------------------

export interface AgentPrefs { model: string | null; effort: string | null; mode: string | null; interaction: string | null }

export const AgentPrefsStore = {
  load(agent: string): AgentPrefs {
    const p = prefs.get<Partial<AgentPrefs> | null>(`agentPrefs:${agent}`, null);
    if (!p) return { model: null, effort: null, mode: defaultMode(named(agent)), interaction: null };
    return { model: p.model ?? null, effort: p.effort ?? null, mode: p.mode ?? null, interaction: p.interaction ?? null };
  },
  save(agent: string, p: AgentPrefs) {
    prefs.set(`agentPrefs:${agent}`, p);
  },
};

// ---- Availability ----------------------------------------------------------------------

export type Availability = "ready" | "notInstalled" | "needsSetup";
export const availabilityLabel = (a: Availability) => (a === "notInstalled" ? "Not installed" : a === "needsSetup" ? "Needs setup" : "");

// ---- Interaction modes (Agent / Ask / Plan / Debug) ------------------------------------

export type Interaction = "agent" | "ask" | "plan" | "debug";
export const INTERACTIONS: { id: Interaction; title: string; detail: string; icon: string; readOnly: boolean; prefix: string | null }[] = [
  { id: "agent", title: "Agent", detail: "Edits code and runs commands", icon: "Infinity", readOnly: false, prefix: null },
  { id: "ask", title: "Ask", detail: "Answers questions; changes nothing", icon: "MessageSquare", readOnly: true, prefix: "[Ask mode: answer the question; do not modify any files.]" },
  { id: "plan", title: "Plan", detail: "Writes a plan for approval before any code", icon: "ClipboardList", readOnly: true, prefix: null },
  { id: "debug", title: "Debug", detail: "Finds the root cause from errors and logs, then fixes it", icon: "Bug", readOnly: false, prefix: "[Debug mode: find the root cause from the errors and logs, fix it, and say how you verified the fix.]" },
];
export const interactionInfo = (i: Interaction) => INTERACTIONS.find((x) => x.id === i) ?? INTERACTIONS[0];
