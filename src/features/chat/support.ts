// Small backends the chat needs: project rules for the composer (Rules.swift's load/parse/
// match), file checkpoints before every message (Checkpoints.swift), and IBM Bob's headless
// runner (Bob.swift).

import { exec, fs, joinPath, secrets } from "../../lib/api";
import { listen } from "../../lib/backend";
import { prefs } from "../../lib/prefs";

// ---- Rules ------------------------------------------------------------------------------

export interface ProjectRule { path: string; description: string; globs: string[]; alwaysApply: boolean }

export function parseRule(path: string, text: string): ProjectRule {
  const rule: ProjectRule = { path, description: "", globs: [], alwaysApply: false };
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return rule;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return rule;
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === "description") rule.description = value.replace(/^["']|["']$/g, "");
    else if (key === "globs") rule.globs = value.replace(/^\[|\]$/g, "").split(",").map((g) => g.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else if (key === "alwaysApply") rule.alwaysApply = value.toLowerCase() === "true";
  }
  return rule;
}

/** Minimal glob matching: `*` within a segment, `**` across segments, `?` one character. */
export function globMatch(glob: string, path: string): boolean {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") { re += "(.*/)?"; i += 2; } else { re += ".*"; i += 1; }
        continue;
      }
      re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if ("\\.^$|()[]{}+".includes(c)) re += "\\" + c;
    else re += c;
  }
  if (!glob.includes("/")) re = "(.*/)?" + re;
  return new RegExp(`^${re}$`).test(path);
}

export const ruleApplies = (r: ProjectRule, files: string[]) => r.alwaysApply || files.some((f) => r.globs.some((g) => globMatch(g, f)));

export async function loadRules(root: string, sparDir: string): Promise<ProjectRule[]> {
  const out: ProjectRule[] = [];
  for (const d of [joinPath(sparDir, "rules"), joinPath(root, ".cursor/rules")]) {
    const names = (await fs.list(d).catch(() => [])).map((e) => e.name).filter((n) => n.endsWith(".md") || n.endsWith(".mdc")).sort();
    for (const n of names) {
      const path = joinPath(d, n);
      const text = await fs.readText(path).catch(() => null);
      if (text != null) out.push(parseRule(path, text));
    }
  }
  return out;
}

// ---- Checkpoints ------------------------------------------------------------------------
// File snapshots before every message (Checkpoints.swift). The source control feature owns
// the shadow repository (its review reads the same checkpoints), so this delegates to it.

import { checkpoints as scmCheckpoints } from "../scm/api";

export class Checkpoints {
  constructor(readonly root: string) {}
  /** Snapshots the work tree and returns the checkpoint id. */
  create(label: string): Promise<string | null> {
    return scmCheckpoints.create(this.root, label.slice(0, 200) || "checkpoint").catch(() => null);
  }
  /** Files that differ between a checkpoint and the current work tree. */
  changedFiles(since: string): Promise<string[]> {
    return scmCheckpoints.changedFiles(this.root, since).catch(() => []);
  }
}

// ---- IBM Bob ----------------------------------------------------------------------------
// One `bob run` per message, streamed as JSON lines (`message`, `tool_call`, `result`). The
// task id from each result resumes the conversation on the next message.

export class BobRunner {
  readonly key: string;
  private procId: string | null = null;
  private buffer = "";
  private offOut: (() => void) | null = null;
  private offExit: (() => void) | null = null;

  constructor(readonly root: string, agent: string) {
    this.key = `bobTask:${root}:${agent}`;
  }

  get taskId(): string | null { return prefs.get<string | null>(this.key, null); }
  set taskId(v: string | null) { prefs.set(this.key, v); }
  get isRunning() { return this.procId != null; }

  async run(prompt: string, onEvent: (e: any) => void, onExit: (code: number, err: string) => void) {
    if (!(await exec.which("bob").catch(() => null))) { onExit(127, "The bob CLI is not installed."); return; }
    const args = ["run", "-f", "stream-json", "--workspace", this.root, "--trust", "--log-level", "silent"];
    const task = this.taskId;
    if (task) args.push("--resume", task);
    args.push(prompt); // positional and last, so it is never read as a flag value
    const env: Record<string, string> = {};
    const key = await secrets.get("bob-api-key").catch(() => null);
    if (key) env.BOB_API_KEY = key;
    const id = `bob-${Date.now()}`;
    this.procId = id;
    this.buffer = "";
    let errText = "";
    this.offOut = listen<{ id: string; stream: string; data: string }>("proc:output", (p) => {
      if (p.id !== id) return;
      if (p.stream === "stderr") { errText += p.data; return; }
      this.buffer += p.data;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        try {
          const obj = JSON.parse(line);
          if (obj?.type === "result" && typeof obj?.stats?.task_id === "string") this.taskId = obj.stats.task_id;
          onEvent(obj);
        } catch { /* not a JSON line */ }
      }
    });
    this.offExit = listen<{ id: string; status: number | null }>("proc:exit", (p) => {
      if (p.id !== id) return;
      this.cleanup();
      onExit(p.status ?? 1, errText);
    });
    try {
      await exec.spawn(id, "bob", args, { cwd: this.root, env });
    } catch (e) {
      this.cleanup();
      onExit(126, String(e));
    }
  }

  private cleanup() {
    this.offOut?.(); this.offExit?.();
    this.offOut = this.offExit = null;
    this.procId = null;
  }

  stop() {
    if (this.procId) exec.kill(this.procId).catch(() => {});
  }

  reset() { this.taskId = null; }
}
