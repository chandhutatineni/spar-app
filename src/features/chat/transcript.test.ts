import { describe, expect, it, vi } from "vitest";

// prefs.ts (via the catalog) expects a browser.
vi.hoisted(() => {
  const g = globalThis as any;
  g.window ??= { addEventListener() {} };
  g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
});
import { Transcript } from "./transcript";
import { parseQuestions } from "./questions";
import { Spar, parseTestReport } from "./sparcli";
import { singleLineText } from "./wire";
import { prettyModel, launchArgs, named, resolve, BUILT_IN } from "./catalog";

describe("isHarnessNote", () => {
  it("recognises Claude Code's own bookkeeping turns", () => {
    expect(Transcript.isHarnessNote("<task-notification>done</task-notification>")).toBe(true);
    expect(Transcript.isHarnessNote("  <system-reminder>x")).toBe(true);
    expect(Transcript.isHarnessNote("<command-name>/spar.init</command-name>")).toBe(true);
    expect(Transcript.isHarnessNote("Caveat: The messages below were generated")).toBe(true);
  });
  it("leaves what the person wrote alone", () => {
    expect(Transcript.isHarnessNote("Please add a <system-reminder> tag")).toBe(false);
    expect(Transcript.isHarnessNote("Build a todo app")).toBe(false);
  });
});

describe("workflowDisplay", () => {
  it("shows the brief of an init, not the command", () => {
    expect(Transcript.workflowDisplay("/spar.init A todo list for teams")).toBe("A todo list for teams");
  });
  it("hides a bare feature id", () => {
    expect(Transcript.workflowDisplay("/spar.design 001-todo-list")).toBe("");
  });
  it("keeps feedback after the feature id", () => {
    expect(Transcript.workflowDisplay("/spar.explore 001-todo-list make it multi-user")).toBe("make it multi-user");
  });
  it("hides commands that carry no words of theirs", () => {
    expect(Transcript.workflowDisplay("/spar.tenets anything")).toBe("");
  });
  it("reads the portable form other agents get", () => {
    const t = "Run SPAR's `explore` command with: 002-x add search. Follow ~/.claude/commands/spar.explore.md and the loop";
    expect(Transcript.workflowDisplay(t)).toBe("add search");
    expect(Transcript.workflowDisplay("Run SPAR's `build` command. Follow ~/.claude/commands/spar.build.md")).toBe("");
    expect(Transcript.workflowDisplay(Spar.stepRequest("retro", "001-a"))).toBe("");
  });
  it("shows the start of a message sent through a file", () => {
    const t = 'Please do what I ask in /x/.git/spar/messages/message-1.md (my message was too long to type here; it starts "Build a CRM").';
    expect(Transcript.workflowDisplay(t)).toBe("Build a CRM…");
  });
  it("returns null for an ordinary message", () => {
    expect(Transcript.workflowDisplay("hello there")).toBeNull();
  });
});

describe("isPlumbing", () => {
  it("hides spar CLI calls, even after cd", () => {
    expect(Transcript.isPlumbing("Bash", JSON.stringify({ command: "spar next 001-a --json" }))).toBe(true);
    expect(Transcript.isPlumbing("Bash", JSON.stringify({ command: "cd /p && spar check --feature a" }))).toBe(true);
  });
  it("hides reading playbooks", () => {
    expect(Transcript.isPlumbing("Read", JSON.stringify({ file_path: "/Users/x/.claude/spar-steps/plan.md" }))).toBe(true);
    expect(Transcript.isPlumbing("Bash", JSON.stringify({ command: "cat ~/.claude/commands/spar.init.md" }))).toBe(true);
    expect(Transcript.isPlumbing("mcp__spar__spar_template", "{}")).toBe(true);
    expect(Transcript.isPlumbing("mcp__spar__spar_next", "{}")).toBe(true);
    expect(Transcript.isPlumbing("mcp__spar__spar_check", "{}")).toBe(true);
  });
  it("shows real work", () => {
    expect(Transcript.isPlumbing("Bash", JSON.stringify({ command: "npm test" }))).toBe(false);
    expect(Transcript.isPlumbing("Read", JSON.stringify({ file_path: "/p/src/app.ts" }))).toBe(false);
    expect(Transcript.isPlumbing("mcp__spar__spar_write", "{}")).toBe(false);
  });
});

describe("isSafeBookkeeping", () => {
  it("approves read-only spar commands and playbook reads", () => {
    expect(Transcript.isSafeBookkeeping("spar next 001-a --json")).toBe(true);
    expect(Transcript.isSafeBookkeeping("cd /p && spar check --feature a --json 2>&1 | head -50")).toBe(true);
    expect(Transcript.isSafeBookkeeping("spar gate 001-a --json")).toBe(true);
    expect(Transcript.isSafeBookkeeping("cat ~/.claude/spar-steps/plan.md")).toBe(true);
    expect(Transcript.isSafeBookkeeping("spar drawio flow '{}' -o docs/diagrams/x.drawio")).toBe(true);
  });
  it("never approves a gate decision", () => {
    expect(Transcript.isSafeBookkeeping("spar gate approve 001-a approve-spec")).toBe(false);
    expect(Transcript.isSafeBookkeeping("spar mvp select mvp-1")).toBe(false);
  });
  it("asks for anything chained, substituted or redirected", () => {
    expect(Transcript.isSafeBookkeeping("spar next && rm -rf /")).toBe(false);
    expect(Transcript.isSafeBookkeeping("spar next; ls")).toBe(false);
    expect(Transcript.isSafeBookkeeping("spar next > out.txt")).toBe(false);
    expect(Transcript.isSafeBookkeeping("spar next $(whoami)")).toBe(false);
    expect(Transcript.isSafeBookkeeping("spar next | sh")).toBe(false);
    expect(Transcript.isSafeBookkeeping("cat /etc/passwd")).toBe(false);
    expect(Transcript.isSafeBookkeeping("spar next\nrm x")).toBe(false);
  });
});

describe("ingest", () => {
  const msg = (id: string, role: string, text: string) => ({ id, type: "message", data: { role, content: [{ type: "text", text }] } });

  it("swallows the server copy of an echoed message and of hidden workflow sends", () => {
    const t = new Transcript();
    t.echoUser("hello");
    t.echoHidden("/spar.init build x", "Setting the project up…");
    t.ingest(msg("1", "user", "hello"));
    t.ingest(msg("2", "user", "/spar.init build x"));
    expect(t.entries.map((e) => e.kind.type)).toEqual(["user", "note"]);
  });

  it("does not bring workflow machinery back when a chat is reloaded", () => {
    const t = new Transcript();
    t.ingest(msg("1", "user", "/spar.design 001-a"));
    t.ingest(msg("2", "user", "/spar.init A CRM for plumbers"));
    t.ingest(msg("3", "user", "<system-reminder>ignore</system-reminder>"));
    t.ingest(msg("4", "user", "fix it (Context: file src/a.ts.)"));
    expect(t.entries.map((e) => (e.kind as any).text)).toEqual(["A CRM for plumbers", "fix it"]);
  });

  it("keeps one copy of a reply that was typed live and then arrived whole", () => {
    const t = new Transcript();
    t.delta("m", "Hello ");
    t.delta("m", "world");
    t.ingest(msg("m", "assistant", "Hello world"));
    t.ingest(msg("m2", "assistant", "Hello world"));
    expect(t.entries.length).toBe(1);
    expect(t.entries[0].kind).toEqual({ type: "assistant", text: "Hello world" });
  });

  it("hides the reply to a harness note", () => {
    const t = new Transcript();
    t.ingest(msg("1", "assistant", "No response requested."));
    expect(t.entries.length).toBe(0);
  });

  it("hides plumbing tool calls and collapses repeats", () => {
    const t = new Transcript();
    t.ingest({ id: "a", type: "function_call", name: "Bash", call_id: "c1", arguments: JSON.stringify({ command: "spar next --json" }) });
    t.ingest({ id: "b", type: "function_call", name: "Edit", call_id: "c2", arguments: JSON.stringify({ file_path: "/p/a.ts" }) });
    t.ingest({ id: "b2", type: "function_call_output", call_id: "c2", output: "ok" });
    t.ingest({ id: "c", type: "function_call", name: "Edit", call_id: "c3", arguments: JSON.stringify({ file_path: "/p/a.ts" }) });
    expect(t.entries.length).toBe(1);
    expect(t.entries[0].kind).toMatchObject({ type: "tool", name: "Edited", summary: "a.ts ×2" });
  });

  it("counts background agents until they report back", () => {
    const t = new Transcript();
    t.ingest({ id: "a", type: "function_call", name: "Task", call_id: "c1", arguments: JSON.stringify({ subagent_type: "spar-critic", description: "Review", run_in_background: true }) });
    expect(t.waitingOnBackground).toBe(true);
    expect(t.entries[0].kind).toMatchObject({ name: "Reviewing", summary: "Review" });
    t.ingest(msg("n", "user", "<task-notification>done</task-notification>"));
    expect(t.waitingOnBackground).toBe(false);
  });

  it("keeps only the latest step card live, at the end", () => {
    const t = new Transcript();
    const card = { action: "run", title: "Continue", reason: "", stage: "brief", gate: null, command: "specify" };
    t.step(card);
    t.note("x");
    t.step(card);
    expect(t.entries.map((e) => e.kind.type)).toEqual(["note", "step"]);
    t.step({ ...card, action: "gate", gate: "approve-spec" });
    expect(t.entries.filter((e) => e.kind.type === "step" && !e.kind.card.resolved).length).toBe(1);
    expect(t.hasOpenStep).toBe(true);
  });

  it("tracks approvals", () => {
    const t = new Transcript();
    t.approval("e1", "Claude wants to run a command", "npm i", null);
    expect(t.pendingApprovals.length).toBe(1);
    t.resolveApproval("e1", true);
    expect(t.pendingApprovals.length).toBe(0);
    expect(t.entries[0].kind).toMatchObject({ state: "allowed" });
  });

  it("knows when the last reply asks or carries a form", () => {
    const t = new Transcript();
    t.assistant("Which database should we use?");
    expect(t.lastReplyAsks).toBe(true);
    t.assistant('Some text\n```spar-questions\n[{"id":"a","question":"Q?","options":["x"]}]\n```');
    expect(t.lastReplyHasForm).toBe(true);
    t.echoUser("answer");
    expect(t.lastReplyAsks).toBe(false);
  });
});

describe("question forms", () => {
  it("parses plain-string and object options, and a wrapped list", () => {
    const q = parseQuestions('Intro\n```spar-questions\n[{"id":"auth","question":"How?","options":[{"label":"Email","detail":"simplest"},{"label":"Google"}],"recommended":0},{"question":"Size?","options":["S","M"]}]\n```\nAfter');
    expect(q?.before).toBe("Intro");
    expect(q?.after).toBe("After");
    expect(q?.questions.length).toBe(2);
    expect(q?.questions[1].id).toBe("Size?");
    expect(q?.questions[1].options[0]).toEqual({ label: "S", detail: null });
    expect(parseQuestions('```spar-questions\n{"questions":[{"question":"A?","options":["x"]}]}\n```')?.questions.length).toBe(1);
    expect(parseQuestions("no form")).toBeNull();
  });
});

describe("the SPAR CLI helpers", () => {
  it("parses tasks.md into groups", () => {
    const g = Spar.parseTasks("## Phase 1: Setup\n### T001 [US1] Create the project\n- [x] T001\n### T002 Add tests\n## Traceability\n- [ ] T001 x");
    expect(g).toEqual([{ id: "Phase 1: Setup", tasks: [{ id: "T001", title: "Create the project", done: true }, { id: "T002", title: "Add tests", done: false }] }]);
  });
  it("reads the task lines the CLI reads, not checklist mentions", () => {
    const g = Spar.parseTasks("## Build\n* [x] **T001** Bold task\n- [x] tests for T002 pass\n- [ ] T002 Other");
    expect(g[0].tasks).toEqual([{ id: "T001", title: "Bold task", done: true }, { id: "T002", title: "Other", done: false }]);
  });
  it("titles features and actions", () => {
    expect(Spar.featureTitle("001-record-note-and-see-today")).toBe("Record note and see today");
    expect(Spar.actionTitle({ action: "gate", gate: "approve-spec", stage: "brief", reason: "", stages: [] })).toBe("Review the spec");
  });
  it("reads the test report", () => {
    const r = parseTestReport("| Pillar | Result | Details |\n|---|---|---|\n| Unit | PASS | 12 tests |\n| End-to-end | FAIL | login |");
    expect(r.unit).toEqual({ state: "pass", detail: "12 tests" });
    expect(r.e2e?.state).toBe("fail");
  });
});

describe("what the agent receives", () => {
  it("keeps short messages on one line and moves long ones to a file", () => {
    expect(singleLineText("hello", "")).toEqual({ inline: "hello" });
    expect(singleLineText("a\nb", "")).toEqual({ inline: null });
    expect(singleLineText("x".repeat(600), "")).toEqual({ inline: null });
    expect(singleLineText("/spar.init a\nb", "")).toEqual({ inline: "/spar.init a b" });
  });
});

describe("the catalog", () => {
  it("names spec-driven variants", () => {
    expect(resolve(BUILT_IN[0], true).name).toBe("spar");
    expect(named("spar-codex-native-ui").family).toBe("codex");
    expect(named("spar-codex-native-ui").runsSpar).toBe(true);
  });
  it("gives Claude Code its launch flags", () => {
    const a = launchArgs(named("claude-native-ui"), "default", "/x/mcp.json");
    expect(a.slice(0, 4)).toEqual(["--mcp-config", "/x/mcp.json", "--permission-mode", "default"]);
    expect(a).toContain("AskUserQuestion");
    expect(launchArgs(named("codex-native-ui"), "ask", null)).toEqual([]);
  });
  it("prettifies model ids", () => {
    expect(prettyModel("claude-opus-5-5[1m]")).toBe("Opus 5.5 · 1M");
    expect(prettyModel("gpt-5")).toBe("gpt-5");
  });
});
