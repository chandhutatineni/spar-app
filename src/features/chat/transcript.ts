// Folds engine session items and stream events into a readable transcript (a port of the
// Mac app's Transcript.swift). Pure: no I/O, so it is unit-tested (transcript.test.ts).

export const QUESTION_FENCE = "```spar-questions";

/** SPAR's next step, shown in the conversation so the workflow reads as one thread. */
export interface StepCard {
  action: string;
  title: string;
  reason: string;
  stage: string;
  gate: string | null;
  command: string | null;
  resolved?: boolean;
}
export const stepKey = (c: StepCard) => [c.action, c.command ?? "", c.gate ?? "", c.stage].join("|");

export type ApprovalState = "pending" | "allowed" | "denied";

export type EntryKind =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; summary: string; output: string | null; failed: boolean }
  | { type: "approval"; message: string; preview: string | null; sessionId: string | null; state: ApprovalState }
  | { type: "note"; text: string }
  | { type: "step"; card: StepCard }
  | { type: "milestone"; from: string; to: string };

export interface Entry { id: string; kind: EntryKind }

type JSON = Record<string, any>;

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).toUpperCase();
const isAssistant = (e: Entry, text: string) => e.kind.type === "assistant" && e.kind.text === text;

function parseJSON(s: string): JSON | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

const HIDDEN = new Set(["ToolSearch", "TodoWrite", "ListAgents", "TaskStop", "TaskGet",
  "TaskOutput", "Monitor", "SlashCommand", "Skill", "KillShell", "BashOutput",
  "read_bash", "stop_bash", "write_bash", "list_bash", "report_intent"]);

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? "";

export class Transcript {
  entries: Entry[] = [];
  private seen = new Set<string>();
  private toolIndex = new Map<string, string>(); // call id → entry id
  private liveAssistant: string | null = null;    // entry id of the reply being typed
  private echoes: string[] = [];
  /** Subagents the agent started in the background that haven't reported back. */
  backgroundAgents = 0;
  backgroundSince: number | null = null;
  /** Injectable clock, for tests. */
  now: () => number = () => Date.now();

  private indexOf(id: string | null) { return id == null ? -1 : this.entries.findIndex((e) => e.id === id); }
  private setKind(i: number, kind: EntryKind) { this.entries[i] = { ...this.entries[i], kind }; }
  private push(e: Entry) { this.entries.push(e); }

  echoUser(text: string): string {
    this.resolveSteps();
    this.echoes.push(text);
    const id = `echo-${uuid()}`;
    this.push({ id, kind: { type: "user", text } });
    return id;
  }

  /** A message the app sends on the person's behalf (a workflow step). It isn't shown as
   *  something they said: the server's copy is swallowed and a short status line stands in. */
  echoHidden(wire: string, status: string | null) {
    this.resolveSteps();
    this.echoes.push(wire);
    if (status) this.push({ id: `note-${uuid()}`, kind: { type: "note", text: status } });
  }

  /** A displayed echo whose server copy is swallowed by the hidden one instead. */
  forgetEcho(text: string) {
    const i = this.echoes.lastIndexOf(text);
    if (i >= 0) this.echoes.splice(i, 1);
  }

  note(text: string) {
    // Snapshots are re-applied on reconnect; don't repeat the same notice.
    if (this.entries.some((e) => e.kind.type === "note" && e.kind.text === text)) return;
    this.push({ id: `note-${uuid()}`, kind: { type: "note", text } });
  }

  /** Whether the agent's last reply is a question form (```spar-questions). */
  get lastReplyHasForm(): boolean {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const k = this.entries[i].kind;
      if (k.type === "assistant") return k.text.includes(QUESTION_FENCE);
      if (k.type === "user") return false;
    }
    return false;
  }

  /** Whether the agent's last reply asks the person something (ends on a question). */
  get lastReplyAsks(): boolean {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const k = this.entries[i].kind;
      if (k.type === "assistant") {
        const tail = k.text.trim().slice(-400);
        return tail.endsWith("?") || tail.includes("?\n") || tail.toLowerCase().includes("use your recommendations");
      }
      if (k.type === "user") return false;
    }
    return false;
  }

  /** Background work counts for at most 15 minutes, so a lost notice can't wedge the chat. */
  get waitingOnBackground(): boolean {
    if (this.backgroundAgents <= 0 || this.backgroundSince == null) return false;
    return this.now() - this.backgroundSince < 900_000;
  }

  /** Adds a step card unless the same step is already the latest one; older step cards are
   *  marked resolved so only the current one is actionable. */
  step(card: StepCard) {
    const key = stepKey(card);
    let i = -1;
    for (let j = this.entries.length - 1; j >= 0; j--) {
      const k = this.entries[j].kind;
      if (k.type === "step" && !k.card.resolved && stepKey(k.card) === key) { i = j; break; }
    }
    if (i >= 0) {
      // The live step always sits at the end of the conversation.
      if (i === this.entries.length - 1) return;
      const [existing] = this.entries.splice(i, 1);
      this.push(existing);
      return;
    }
    this.resolveSteps();
    this.push({ id: `step-${uuid()}`, kind: { type: "step", card: { ...card, resolved: false } } });
  }

  resolveSteps() {
    this.entries.forEach((e, i) => {
      if (e.kind.type === "step" && !e.kind.card.resolved) this.setKind(i, { type: "step", card: { ...e.kind.card, resolved: true } });
    });
  }

  /** For agents that stream whole messages and tool calls (IBM Bob). */
  assistant(text: string) {
    this.push({ id: `a-${uuid()}`, kind: { type: "assistant", text } });
  }

  tool(name: string, summary: string) {
    this.push({ id: `t-${uuid()}`, kind: { type: "tool", name, summary: summary.slice(0, 160), output: "", failed: false } });
  }

  milestone(from: string, to: string) {
    this.push({ id: `milestone-${uuid()}`, kind: { type: "milestone", from, to } });
  }

  get hasOpenStep() {
    return this.entries.some((e) => e.kind.type === "step" && !e.kind.card.resolved);
  }

  delta(messageId: string, text: string) {
    const i = this.indexOf(this.liveAssistant);
    const k = i >= 0 ? this.entries[i].kind : null;
    if (k && k.type === "assistant") {
      const joined = k.text + text;
      this.setKind(i, { type: "assistant", text: joined });
      // A re-stream of a reply that's already on screen (Copilot does this): drop the copy.
      const t = joined.trim();
      if (t.length > 40) {
        const from = Math.max(0, this.entries.length - 12);
        for (let j = from; j < this.entries.length; j++) {
          if (j !== i && isAssistant(this.entries[j], t)) {
            this.entries.splice(i, 1);
            this.liveAssistant = null;
            return;
          }
        }
      }
    } else {
      const id = `live-${messageId}`;
      this.push({ id, kind: { type: "assistant", text } });
      this.liveAssistant = id;
    }
  }

  /** For a message SPAR sent on the person's behalf: the part they wrote (a brief, feedback),
   *  or "" when there is nothing of theirs in it. null for an ordinary message. */
  static workflowDisplay(text: string): string | null {
    const t = text.trim();
    const theirWords = (command: string, args: string) => {
      const a = args.trim();
      // A bare feature id ("001-todo-list") is bookkeeping, not something they said.
      if (!a || /^\d{3}-[a-z0-9-]+$/.test(a)) return "";
      const rest = a.replace(/^\d{3}-[a-z0-9-]+\s+/, "");
      return ["init", "adopt", "fix", "explore", "design", "build", "deliver", "reconcile", "sync"].includes(command) ? rest : "";
    };
    if (t.startsWith("/spar.")) {
      const body = t.slice("/spar.".length);
      const command = body.split(" ")[0];
      return theirWords(command, body.slice(command.length));
    }
    if (t.startsWith("Run SPAR's `")) {
      const after = t.slice("Run SPAR's `".length);
      const command = after.slice(0, after.indexOf("`") >= 0 ? after.indexOf("`") : after.length);
      const r = t.indexOf(" command with: ");
      if (r >= 0) {
        const start = r + " command with: ".length;
        const end = t.indexOf(". Follow ~/.claude", start);
        if (end >= 0) return theirWords(command, t.slice(start, end));
      }
      return "";
    }
    if (t.startsWith("Run SPAR's ") && t.includes("~/.claude/spar-steps/")) return "";
    if (t.startsWith("Please do what I ask in ")) {
      const r = t.indexOf('it starts "');
      if (r >= 0) return t.slice(r + 'it starts "'.length).split('").').join("…");
    }
    return null;
  }

  /** Drops the "(Context: …)" the composer appends for the agent. */
  static withoutContext(text: string) {
    return text.replace(/\s*\(Context: [^)]*\)\.?\s*$/, "");
  }

  static isHarnessNote(text: string) {
    const t = text.trim();
    return ["<task-notification>", "<system-reminder>", "<command-name>", "<command-message>",
      "<local-command-stdout>", "<local-command-caveat>", "Caveat: The messages below"].some((p) => t.startsWith(p));
  }

  /** Ingests one conversation item (`message`, `function_call`, `function_call_output`, `slash_command`). */
  ingest(raw: JSON) {
    // Snapshot items nest their fields under `data`; stream items do not.
    const item: JSON = { ...raw };
    if (raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) {
      for (const [k, v] of Object.entries(raw.data)) if (item[k] === undefined || k === "content" || k === "role") item[k] = v;
    }
    const id = item.id;
    if (typeof id !== "string" || this.seen.has(id)) return;
    this.seen.add(id);
    switch (item.type) {
      case "message": {
        // Agents (Copilot especially) pad replies with blank lines; they read as gaps.
        const text = Transcript.text(item).trim();
        const role = item.role;
        if (!text) {
          const li = this.indexOf(this.liveAssistant);
          if (li >= 0 && role !== "user") { this.entries.splice(li, 1); this.liveAssistant = null; }
          return;
        }
        // Claude's answer to one of the harness's own notes, not to the person.
        if (role !== "user" && text === "No response requested.") {
          const li = this.indexOf(this.liveAssistant);
          if (li >= 0) { this.entries.splice(li, 1); this.liveAssistant = null; }
          return;
        }
        if (role !== "user") {
          let dup = -1;
          for (let j = this.entries.length - 1; j >= Math.max(0, this.entries.length - 12); j--) if (isAssistant(this.entries[j], text)) { dup = j; break; }
          if (dup >= 0) {
            // The same reply twice (the live-typed copy and the final one): keep one.
            const li = this.indexOf(this.liveAssistant);
            if (li >= 0 && li !== dup) this.entries.splice(li, 1);
            this.liveAssistant = null;
            return;
          }
        }
        if (role === "user") {
          const ei = this.echoes.indexOf(text);
          if (ei >= 0) { this.echoes.splice(ei, 1); return; }
          // Claude Code's own bookkeeping (background-agent notices, reminders) arrives as
          // user turns; it isn't something the person said.
          if (Transcript.isHarnessNote(text)) {
            if (text.includes("<task-notification>")) {
              this.backgroundAgents = Math.max(0, this.backgroundAgents - 1);
              if (this.backgroundAgents === 0) this.backgroundSince = null;
            }
            return;
          }
          // SPAR's own instructions to the agent show as the person's words (their brief),
          // or not at all: reloading a chat must not bring the machinery back.
          const shown = Transcript.workflowDisplay(text);
          if (shown != null) {
            if (shown) this.push({ id, kind: { type: "user", text: shown } });
            return;
          }
          this.push({ id, kind: { type: "user", text: Transcript.withoutContext(text) } });
        } else {
          const li = this.indexOf(this.liveAssistant);
          if (li >= 0) {
            this.setKind(li, { type: "assistant", text });
            this.liveAssistant = null;
          } else {
            this.push({ id, kind: { type: "assistant", text } });
          }
        }
        return;
      }
      case "slash_command": {
        // Claude Code's copy of a /spar.* command: only the person's own words are worth showing.
        const name: string = item.name ?? "";
        const args = String(item.arguments ?? "").trim();
        if (name.startsWith("spar.")) {
          const shown = Transcript.workflowDisplay(`/${name} ${args}`);
          if (shown && !this.echoes.includes(shown)) this.push({ id, kind: { type: "user", text: shown } });
        }
        return;
      }
      case "function_call": {
        const name: string = item.name ?? "tool";
        const rawArgs: string = typeof item.arguments === "string" ? item.arguments : "";
        if (Transcript.isPlumbing(name, rawArgs)) {
          // Still count background agents below, but never show SPAR's bookkeeping.
          if (!["Agent", "Task", "task"].includes(name)) return;
        }
        if (["Agent", "Task"].includes(name) && (rawArgs.includes('"run_in_background":true') || rawArgs.includes('"run_in_background": true'))) {
          this.backgroundAgents += 1;
          if (this.backgroundSince == null) this.backgroundSince = this.now();
        }
        if (HIDDEN.has(name)) return;
        this.liveAssistant = null;
        const callId: string = item.call_id ?? id;
        const args = parseJSON(rawArgs) ?? {};
        const [label, summary] = Transcript.describe(name, args);
        // Copilot sends some actions twice and finishes only one: share the row that's still open.
        for (let j = this.entries.length - 1; j >= Math.max(0, this.entries.length - 6); j--) {
          const k = this.entries[j].kind;
          if (k.type === "tool" && k.output == null && k.name === label && k.summary === summary) {
            this.toolIndex.set(callId, this.entries[j].id);
            return;
          }
        }
        // The same action repeated back to back (Copilot logs each edit of a file) is one row.
        const last = this.entries.length - 1;
        const lk = last >= 0 ? this.entries[last].kind : null;
        if (lk && lk.type === "tool" && lk.name === label && (lk.summary === summary || lk.summary.startsWith(summary + " ×"))) {
          const n = (parseInt(lk.summary.split(" ×").pop() ?? "", 10) || 1) + 1;
          this.setKind(last, { type: "tool", name: lk.name, summary: `${summary} ×${n}`, output: null, failed: lk.failed });
          this.toolIndex.set(callId, this.entries[last].id);
          return;
        }
        this.resolveSteps();
        this.push({ id, kind: { type: "tool", name: label, summary, output: null, failed: false } });
        this.toolIndex.set(callId, id);
        return;
      }
      case "function_call_output": {
        const callId = item.call_id;
        const entryId = typeof callId === "string" ? this.toolIndex.get(callId) : undefined;
        const i = this.indexOf(entryId ?? null);
        if (i < 0) return;
        const k = this.entries[i].kind;
        if (k.type !== "tool") return;
        const output = Transcript.outputText(item.output);
        const failed = item.status === "failed" || item.is_error === true;
        this.setKind(i, { type: "tool", name: k.name, summary: k.summary, output, failed });
        return;
      }
    }
  }

  approval(id: string, message: string, preview: string | null, sessionId: string | null) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.liveAssistant = null;
    this.push({ id, kind: { type: "approval", message, preview, sessionId, state: "pending" } });
  }

  /** When a turn is over, nothing is still running: tools whose result never arrived are done. */
  settleTools() {
    this.entries.forEach((e, i) => {
      if (e.kind.type === "tool" && e.kind.output == null) this.setKind(i, { ...e.kind, output: "" });
    });
  }

  /** Drops an entry (an approval the app answered by itself). */
  remove(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  /** SPAR's own read-only bookkeeping: safe to approve without asking. Never a gate decision.
   *  One command only — a read-only `spar` subcommand, or reading SPAR's playbooks — optionally
   *  piped into text filters. Anything chained, substituted or redirected to a file asks. */
  static isSafeBookkeeping(command: string): boolean {
    let c = command.trim();
    // A leading `cd <dir> &&` is harmless and common.
    c = c.replace(/^cd [^;&|`$()<>]+&&\s*/, "");
    for (const harmless of ["2>&1", "2>/dev/null", ">/dev/null"]) c = c.split(harmless).join("");
    if (c.includes("\n") || /(;|&&|\|\||`|\$\(|>|<)/.test(c)) return false;
    const parts = c.split("|").map((p) => p.trim());
    const first = parts[0];
    if (!first) return false;
    const filters = /^(head|tail|grep|wc|sort|uniq|cut|jq|sed -n)\b/;
    if (!parts.slice(1).every((p) => filters.test(p))) return false;
    if (/^spar (next|check|template|status|--version|mvp list|checks|init)\b/.test(first)) return true;
    // Diagrams from a description: writes only a .drawio file (the CLI refuses anything else).
    if (/^spar drawio (sequence|er|flow) /.test(first) && first.includes(".drawio")) return true;
    if (/^spar gate [A-Za-z0-9._-]+( --json)?$/.test(first)) return true;
    const playbooks = [".claude/spar-steps/", ".claude/commands/spar.", ".claude/agents/spar-", ".claude/spar-templates/"];
    return /^(cat|head|tail|sed -n|ls|wc|grep)\b/.test(first) && playbooks.some((p) => first.includes(p));
  }

  resolveApproval(id: string, allowed: boolean) {
    const i = this.indexOf(id);
    if (i < 0) return;
    const k = this.entries[i].kind;
    if (k.type !== "approval" || k.state !== "pending") return;
    this.setKind(i, { ...k, state: allowed ? "allowed" : "denied" });
  }

  get pendingApprovals(): Entry[] {
    return this.entries.filter((e) => e.kind.type === "approval" && e.kind.state === "pending");
  }

  // ---- Presentation helpers ------------------------------------------------------------

  /** SPAR's own bookkeeping: asking `spar next`, running checks, reading its playbooks.
   *  The person sees the work (files, tests, reviews), not the machinery. */
  static isPlumbing(name: string, rawArgs: string): boolean {
    const args = parseJSON(rawArgs) ?? {};
    const playbooks = [".claude/spar-steps", ".claude/commands/spar.", ".claude/agents/spar-", "spar-templates", "/tmp/claude-"];
    switch (name) {
      case "Bash": case "bash": case "shell": case "sys_os_shell": {
        const cmd = String(args.command ?? args.fullCommandText ?? args.cmd ?? "").trim();
        const stripped = cmd.replace(/^(cd [^;&]+(&&|;)\s*)+/, "");
        if (stripped.startsWith("spar ") || stripped.startsWith("spar\t")) return true;
        return playbooks.some((p) => cmd.includes(p)) && !cmd.includes("npm ") && !cmd.includes("test");
      }
      case "Read": case "Glob": case "Grep": case "view": case "sys_os_read": {
        const path = String(args.file_path ?? args.path ?? args.pattern ?? "");
        return playbooks.some((p) => path.includes(p));
      }
      default:
        // The MCP forms of `spar next`, the checks and templates are the same machinery.
        return ["mcp__spar__spar_template", "mcp__spar__spar_status", "mcp__spar__spar_next", "mcp__spar__spar_check"].some((p) => name.startsWith(p));
    }
  }

  static text(item: JSON): string {
    const parts: JSON[] = Array.isArray(item.content) ? item.content : [];
    return parts.map((p) => p?.text).filter((t): t is string => typeof t === "string").join("\n").trim();
  }

  static outputText(raw: unknown): string {
    if (typeof raw === "string") {
      // MCP results arrive as a JSON array of content blocks.
      if (raw.startsWith("[")) {
        try {
          const blocks = JSON.parse(raw);
          if (Array.isArray(blocks)) {
            const texts = blocks.map((b) => b?.text).filter((t) => typeof t === "string");
            if (texts.length) return texts.join("\n");
          }
        } catch { /* plain text */ }
      }
      return raw;
    }
    if (Array.isArray(raw)) return raw.map((b) => b?.text).filter((t) => typeof t === "string").join("\n");
    return raw == null ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
  }

  private static file(args: JSON) {
    return basename(String(args.file_path ?? args.path ?? args.notebook_path ?? ""));
  }

  /** What a SPAR agent is doing, in the person's words. */
  static agentRole(who: string): string {
    return ({
      "tenets-author": "Drafting the engineering principles", roadmapper: "Shaping the roadmap", specifier: "Writing the spec",
      clarifier: "Collecting open questions", critic: "Reviewing", architect: "Designing", researcher: "Researching",
      "tenets-gate": "Checking against the engineering principles", "task-planner": "Planning the tasks",
      analyzer: "Cross-checking spec, plan and tasks", diagrammer: "Drawing the diagrams",
      "architecture-writer": "Writing the architecture document", "threat-modeler": "Threat modelling",
      "task-executor": "Building", "controls-reviewer": "Reviewing against controls", verifier: "Testing end to end",
      releaser: "Shipping", adopter: "Mapping the codebase", converger: "Finding gaps between spec and code",
      syncer: "Updating the specs", "context-mapper": "Gathering organisation context", retrospective: "Writing the retrospective",
    } as Record<string, string>)[who] ?? `Working (${who})`;
  }

  static describe(name: string, args: JSON): [string, string] {
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    switch (name) {
      case "Read": return ["Read", Transcript.file(args)];
      case "Write": return ["Wrote", Transcript.file(args)];
      case "Edit": case "MultiEdit": return ["Edited", Transcript.file(args)];
      case "Glob": return ["Searched files", s(args.pattern)];
      case "Grep": return ["Searched", s(args.pattern)];
      case "Bash": case "bash": case "shell": case "powershell": {
        // What the command is for reads better than the command itself, when the agent says.
        const cmd = s(args.command ?? args.fullCommandText).split("\n")[0];
        const why = s(args.description);
        return why ? ["Ran", `${why} — ${cmd}`] : ["Ran", cmd];
      }
      case "view": case "sys_os_read": return ["Read", Transcript.file(args)];
      case "sys_os_write": return ["Wrote", Transcript.file(args)];
      case "sys_os_edit": return ["Edited", Transcript.file(args)];
      case "sys_os_shell": return ["Ran", s(args.command ?? args.cmd).split("\n")[0]];
      case "sys_os_list": case "sys_os_glob": case "sys_os_grep": return ["Searched", s(args.pattern ?? args.path)];
      case "create": return ["Wrote", Transcript.file(args)];
      case "edit": case "str_replace": case "str_replace_editor": case "insert": return ["Edited", Transcript.file(args)];
      case "glob": case "grep": case "rg": return ["Searched", s(args.pattern ?? args.query)];
      case "Task": case "Agent": case "task": {
        const who = (s(args.subagent_type) || "agent").replace(/spar-/g, "");
        return [Transcript.agentRole(who), s(args.description)];
      }
      case "Skill": case "SlashCommand": return ["Ran", s(args.skill ?? args.command)];
      case "WebFetch": return ["Fetched", s(args.url)];
      case "WebSearch": return ["Searched the web", s(args.query)];
      default:
        if (name.startsWith("mcp__")) {
          const parts = name.split("_").filter(Boolean);
          const server = parts.length > 1 ? parts[1] : "mcp";
          const tool = name.split("__").pop() ?? name;
          const pretty = tool.replace(/spar_/g, "").replace(/_/g, " ");
          return [server === "spar" ? `SPAR · ${pretty}` : `${server} · ${pretty}`, s(args.path ?? args.feature ?? args.name)];
        }
        return [name, ""];
    }
  }
}
