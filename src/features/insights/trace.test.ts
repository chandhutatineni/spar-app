import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as any;
  g.window ??= { addEventListener() {} };
  g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
});
import { Kind, buildTrace, list, node, orphans, uncovered, untested } from "./trace";
import { parseIssues } from "./issues";
import * as T from "./traceText";
import { decodeReport, money, pct } from "./impact";

const SPEC = `# Spec
## User stories
### US1 · Register and log in — priority P1
**Satisfies.** R1 — the brief's first need, R2
<!-- guidance
spanning lines -->
- **US1-AC1** — **Given** a visitor **when** they register **then** they are logged in
- **US1-AC2** — login shows the role
### US2 · Publish a job — priority P2
**Satisfies.** none — new in this spec
## Non-Functional Requirements
| ID | Requirement | Threat |
| --- | --- | --- |
| NFR-S1 | **Authentication.** Passwords are hashed | T-001 |
`;

const TASKS = `# Tasks
## Phase 1
### T001 [US0] Create the layout
- **Files.** \`package.json\`, \`backend/src/index.ts\`
### T002 [P] [US1] Build login
- **Files.** \`backend/src/auth.ts\`
### T003 [US2] Publish endpoint
- **Files.** \`frontend/src/Publish.tsx\`
## Progress
- [x] T001
- [x] T002
- [ ] T003
## Traceability
| PRD | Spec item | Task(s) | Code | Test |
| --- | --- | --- | --- | --- |
| M1 | US1 — register and log in | T002 | — | \`backend/tests/auth.test.ts\` |
| M1 | US1-AC1 — register | T002 | \`backend/src/auth.ts:register\` | \`backend/tests/auth.test.ts::registers\` |
| — | NFR-S1 | T002 | — | — |
| {{x}} | {{placeholder}} | | | |
`;

const VERIFY = `## Traceability matrix
| Spec item | Task | Code | Test | Result |
|---|---|---|---|---|
| US1-AC1 | T002 | \`backend/src/auth.ts:register\` | \`backend/tests/auth.test.ts::registers\` | pass |
| US1-AC2 | T002 | — | \`frontend/src/Login.test.tsx\` | FAIL (timeout) |
`;

const PLAN = `## Structure
| Service | Directory | Port |
| --- | --- | --- |
| API | \`backend/\` | 3000 |
| Web | frontend | 5173 |
`;

const ISSUES = `# Issues
| Item | Type | Key | URL |
| --- | --- | --- | --- |
| 001-x | Epic | PROJ-1 | https://acme.atlassian.net/browse/PROJ-1 |
| US1 | Story | PROJ-2 | javascript:alert(1) |
| T002 | Sub-task | [PROJ-3](https://acme.atlassian.net/browse/PROJ-3) | |
| note | x | PROJ-9 | |
`;

const ROADMAP = `# Roadmap\n| ID | Need |\n|---|---|\n| R1 | People can sign up |\n- **R2** — People can log back in\n`;

function build() {
  return buildTrace({
    root: "/p", feature: "001-x", specPath: "/p/spar/specs/001-x/spec.md", tasksPath: "/p/spar/specs/001-x/tasks.md",
    spec: SPEC, tasks: TASKS, verification: VERIFY, plan: PLAN, issues: ISSUES, jiraURL: "",
    sources: [["/p/spar/roadmap.md", ROADMAP]], exists: (f) => f === "backend/src/auth.ts",
  });
}

describe("TraceText", () => {
  it("skips comments and parses tables", () => {
    expect(T.lines("a\n<!-- x\ny -->b\n c <!-- z --> d")).toEqual([[1, "a"], [3, "b"], [4, "c  d"]]);
    expect(T.values("`a`, `b`")).toEqual(["a", "b"]);
    expect(T.values("—")).toEqual([]);
    expect(T.values("none — new")).toEqual([]);
    expect(T.fileOf("src/a.ts:fn")).toBe("src/a.ts");
    expect(T.fileOf("src/a.test.ts::does x")).toBe("src/a.test.ts");
    expect(T.fileOf("http://x/y")).toBe("http://x/y");
    expect(T.trimLead(" · Register — ")).toBe("Register");
    expect(T.plain("**a** _b_ `c`")).toBe("a b c");
  });
});

describe("buildTrace", () => {
  const t = build();
  it("reads stories, criteria and NFRs", () => {
    const spec = list(t, Kind.spec).map((n) => n.key);
    expect(spec).toEqual(expect.arrayContaining(["US1", "US1-AC1", "US1-AC2", "US2", "NFR-S1"]));
    expect(node(t, Kind.spec, "US1")?.title).toBe("Register and log in");
    expect(node(t, Kind.spec, "US1-AC1")?.parent).toBe("US1");
    expect(node(t, Kind.spec, "NFR-S1")?.title).toBe("Authentication. Passwords are hashed");
  });
  it("reads tasks, done state and files", () => {
    expect(list(t, Kind.task).map((n) => [n.key, n.state, n.title])).toEqual([
      ["T002", "done", "Build login"], ["T003", "open", "Publish endpoint"], ["T001", "done", "Create the layout"],
    ]);
    expect(t.taskPaths.T001).toEqual(["package.json", "backend/src/index.ts"]);
  });
  it("merges verification and implies rows from story tags", () => {
    const ac1 = t.rows.find((r) => r.spec === "US1-AC1")!;
    expect(ac1.result).toBe("pass");
    expect(ac1.requirements).toEqual(["M1", "R1", "R2"]);
    const ac2 = t.rows.find((r) => r.spec === "US1-AC2")!;
    expect(ac2.result).toBe("fail");
    const us2 = t.rows.find((r) => r.spec === "US2")!;
    expect(us2.implied).toBe(true);
    expect(us2.tasks).toEqual(["T003"]);
    expect(t.rows.some((r) => r.spec.includes("{{"))).toBe(false);
  });
  it("describes requirements and links files", () => {
    expect(node(t, Kind.requirement, "R1")?.title).toBe("People can sign up");
    expect(node(t, Kind.requirement, "R2")?.title).toBe("People can log back in");
    expect(node(t, Kind.code, "backend/src/auth.ts:register")?.path).toBe("/p/backend/src/auth.ts");
    expect(node(t, Kind.test, "backend/tests/auth.test.ts::registers")?.path).toBeNull();
    expect(node(t, Kind.test, "backend/tests/auth.test.ts::registers")?.state).toBe("pass");
    expect(node(t, Kind.spec, "US1")?.state).toBe("fail");
    expect(node(t, Kind.spec, "US2")?.state).toBe("open");
  });
  it("finds gaps", () => {
    expect(uncovered(t).map((n) => n.key)).toEqual([]);
    expect(orphans(t).map((n) => n.key)).toEqual(["T001"]);
    expect(untested(t).map((r) => r.spec)).toEqual(["NFR-S1"]);
  });
  it("groups work by service", () => {
    expect(t.services.map((s) => [s.id, s.directory, s.tasks])).toEqual([
      ["API", "backend", ["T002", "T001"]], ["Web", "frontend", ["T003"]],
    ]);
    expect(t.services[0].code).toEqual(["backend/src/auth.ts:register"]);
  });
  it("orders spec items by the rows, stories before their criteria", () => {
    expect(list(t, Kind.spec).slice(0, 3).map((n) => n.key)).toEqual(["US1", "US1-AC1", "NFR-S1"]);
  });
});

describe("issues.md", () => {
  it("keys epic, stories and tasks; only web links", () => {
    const i = parseIssues(ISSUES, "001-x", "acme.atlassian.net/");
    expect(Object.keys(i).sort()).toEqual(["T002", "US1", "epic"]);
    expect(i.epic.url).toBe("https://acme.atlassian.net/browse/PROJ-1");
    expect(i.US1.url).toBe("https://acme.atlassian.net/browse/PROJ-2");
    expect(i.T002).toMatchObject({ key: "PROJ-3", url: "https://acme.atlassian.net/browse/PROJ-3" });
    expect(parseIssues(ISSUES, "001-x", "").US1.url).toBeNull();
  });
});

describe("impact", () => {
  it("formats and decodes", () => {
    expect(pct(0.7143)).toBe("71.4%");
    expect(pct(null)).toBe("–");
    expect(money(0, "USD")).toMatch(/0\.00/);
    expect(() => decodeReport("{}")).toThrow(/missing/);
  });
});
