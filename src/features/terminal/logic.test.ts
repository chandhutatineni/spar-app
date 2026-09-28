import { describe, expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ fs: {}, exec: {} }));
vi.mock("../../lib/backend", () => ({ listen: () => () => {}, call: async () => ({}) }));
vi.mock("./terminals", () => ({ runTask: () => {} }));
vi.mock("./project", () => ({ devTasks: () => [] }));
vi.mock("../../state/workspace", () => ({ useWorkspace: { getState: () => ({}) } }));
import { detectTasks, makeTargets, primaryTask, type ProjectProbe } from "./tasks";
import { detectPreview, findLocalURL } from "./preview";
import { parseTestReport, pillarInstruction } from "./testing";

const probe = (files: Record<string, string>): ProjectProbe & { has: (t: string) => Promise<boolean> } => ({
  exists: async (r) => r in files || Object.keys(files).some((f) => f.startsWith(r + "/")),
  read: async (r) => files[r] ?? null,
  has: async () => true,
});

describe("DevTasks", () => {
  it("finds package.json scripts, Makefile, Python", async () => {
    const t = await detectTasks(probe({
      "package.json": JSON.stringify({ scripts: { dev: "vite", test: "vitest", build: "tsc", lint: "x" } }),
      "yarn.lock": "", Makefile: "all: x\n.PHONY: all\ntest-unit:\nFOO:=1\n", "tests/test_a.py": "",
    }));
    expect(t.map((x) => x.command)).toEqual(["yarn run build", "yarn run dev", "yarn run lint", "yarn run test", "make all", "make test-unit", "python3 -m pytest"]);
    expect(primaryTask(t, "run")?.name).toBe("dev");
    expect(primaryTask(t, "test")?.name).toBe("test");
    expect(primaryTask(t, "build")?.name).toBe("build");
  });
  it("web folders get a cd prefix", async () => {
    const t = await detectTasks(probe({ "web/package.json": JSON.stringify({ scripts: { start: "x" } }) }));
    expect(t[0]).toMatchObject({ name: "web: start", command: "cd web && npm run start", kind: "run" });
  });
  it("make targets", () => expect(makeTargets("a:\nb := 1\nc:=2\n.x:\n")).toEqual(["a"]));
});

describe("Preview", () => {
  it("detects dev servers then static pages", async () => {
    expect(await detectPreview("/p", probe({ "package.json": JSON.stringify({ scripts: { start: "node s" } }) })))
      .toEqual({ kind: "devServer", command: ["npm", "run", "start"], cwd: "/p", needsInstall: true });
    expect(await detectPreview("/p", probe({ "public/index.html": "" }))).toEqual({ kind: "staticPage", page: "/p/public/index.html" });
    expect(await detectPreview("/p", probe({}))).toEqual({ kind: "none" });
  });
  it("finds the local URL", () => {
    expect(findLocalURL("  \x1b[32m➜\x1b[0m  Local:   http://localhost:5173/\n")).toBe("http://localhost:5173/");
    expect(findLocalURL("listening on http://0.0.0.0:3000.")).toBe("http://localhost:3000");
    expect(findLocalURL("nothing")).toBeNull();
  });
});

describe("Testing", () => {
  it("parses the report table", () => {
    const r = parseTestReport("| Pillar | Result | Details |\n|---|---|---|\n| Unit | PASS | 12 tests |\n| End-to-end | FAIL | login |\n| Acceptance | | |\n");
    expect(r.unit).toEqual({ state: "pass", detail: "12 tests" });
    expect(r.e2e?.state).toBe("fail");
    expect(r.acceptance?.state).toBe("notRun");
  });
  it("builds instructions", () => {
    expect(pillarInstruction("unit", "f1", { testCommand: "npm test", hasUI: false })).toContain("run them with `npm test`");
    expect(pillarInstruction("acceptance", "f1", { hasUI: true })).toMatch(/^\/spar\.build f1/);
  });
});
