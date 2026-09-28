// The Mac app's Model/Testing.swift: the four pillars of testing a feature must pass before
// it is delivered, the test report the agent keeps, and running the tests locally.
//
// The chat feature owns sending to the agent and the current feature; it calls these with
// them (e.g. `send(pillarInstruction("unit", feature, taskCommands()))`).

import { fs } from "../../lib/api";
import { useWorkspace } from "../../state/workspace";
import { primaryTask } from "./tasks";
import { devTasks } from "./project";
import { preview, previewAvailable, previewIsServer, usePreview } from "./preview";
import { runTask } from "./terminals";

export type TestPillar = "unit" | "integration" | "e2e" | "acceptance";
export const TEST_PILLARS: TestPillar[] = ["unit", "integration", "e2e", "acceptance"];

export const PILLAR_INFO: Record<TestPillar, { title: string; detail: string; icon: string }> = {
  unit: { title: "Unit", detail: "Every requirement has fast, isolated tests of the code that implements it.", icon: "Box" },
  integration: { title: "Integration", detail: "The real pieces work together: APIs, storage, services, the file system.", icon: "Layers" },
  e2e: { title: "End-to-end", detail: "The app runs locally and a real browser (Playwright) walks each user flow from the spec.", icon: "Compass" },
  acceptance: { title: "Acceptance", detail: "SPAR verifies each acceptance criterion and builds the requirement → test traceability matrix.", icon: "BadgeCheck" },
};

export interface TaskCommands { testCommand?: string; runCommand?: string; hasUI: boolean }

/** The project's own test and run commands, and whether it has a UI to preview. */
export function taskCommands(): TaskCommands {
  const tasks = devTasks();
  return { testCommand: primaryTask(tasks, "test")?.command, runCommand: primaryTask(tasks, "run")?.command, hasUI: hasUI() };
}

/** Whether the project has a UI (the live preview found one). */
export const hasUI = () => previewAvailable();

/** What the agent is asked to do for a pillar. */
export function pillarInstruction(pillar: TestPillar, f: string, { testCommand, runCommand, hasUI }: TaskCommands): string {
  const title = PILLAR_INFO[pillar].title;
  const report = `Then update spar/specs/${f}/test-report.md: keep a table \`| Pillar | Result | Details |\` and set the ${title} row's Result to PASS or FAIL with a one-line summary.`;
  switch (pillar) {
    case "unit":
      return `Testing pillar 1 of 4, unit tests for ${f}: make sure every requirement in the spec has unit tests, write the missing ones, run them${testCommand ? ` with \`${testCommand}\`` : ""}, and fix failures. ${report}`;
    case "integration":
      return `Testing pillar 2 of 4, integration tests for ${f}: write and run tests that exercise the real components together (for example API and storage, CLI and file system, service calls) rather than mocks, and fix failures. ${report}`;
    case "e2e":
      if (hasUI) {
        return `Testing pillar 3 of 4, end-to-end for ${f}: start the app locally${runCommand ? ` (\`${runCommand}\`)` : ""}, then use the Playwright MCP browser tools to walk through every acceptance scenario in the spec as a user would, checking what the page shows. Save screenshots to spar/specs/${f}/e2e/ and fix what fails. ${report}`;
      }
      return `Testing pillar 3 of 4, end-to-end for ${f}: run the program locally the way a user would${runCommand ? ` (\`${runCommand}\`)` : ""} and walk through every acceptance scenario in the spec, checking the real output. Fix what fails. ${report}`;
    case "acceptance":
      return `/spar.build ${f} Afterwards, testing pillar 4 of 4: set the Acceptance row in spar/specs/${f}/test-report.md to PASS only if every acceptance criterion is met, otherwise FAIL with what is missing.`;
  }
}

/** All four pillars in one message, in order. */
export function allPillarsInstruction(f: string, c: TaskCommands): string {
  const steps = TEST_PILLARS.filter((p) => p !== "acceptance").map((p) => "- " + pillarInstruction(p, f, c));
  return `Test ${f} before delivery, in this order, stopping to fix failures as you go:\n` + steps.join("\n")
    + `\n- Finally run the acceptance check: /spar.build ${f}, and set the Acceptance row in spar/specs/${f}/test-report.md.`;
}

export type PillarState = "notRun" | "pass" | "fail";
export interface PillarResult { state: PillarState; detail: string }

/** Reads the `| Pillar | Result | Details |` table the agent maintains. */
export function parseTestReport(text: string): Partial<Record<TestPillar, PillarResult>> {
  const out: Partial<Record<TestPillar, PillarResult>> = {};
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").filter((c) => c.length).map((c) => c.trim());
    if (cells.length < 2) continue;
    const name = cells[0].toLowerCase();
    const pillar: TestPillar | null = name.startsWith("unit") ? "unit" : name.startsWith("integration") ? "integration"
      : name.startsWith("end") || name.startsWith("e2e") ? "e2e" : name.startsWith("accept") ? "acceptance" : null;
    if (!pillar) continue;
    const result = cells[1].toUpperCase();
    out[pillar] = { state: result.includes("PASS") ? "pass" : result.includes("FAIL") ? "fail" : "notRun", detail: cells.length > 2 ? cells[2] : "" };
  }
  return out;
}

/** The SPAR folder of a project (`spar/`, or the legacy `.spar/`). */
export async function sparDir(root: string): Promise<string> {
  for (const m of ["specs", "tenets.md", "standards.md", "manifest.json", "decisions.jsonl", "briefs"]) {
    if (await fs.exists(`${root}/spar/${m}`).catch(() => false)) return `${root}/spar`;
  }
  if (await fs.exists(`${root}/.spar`).catch(() => false)) return `${root}/.spar`;
  return `${root}/spar`;
}

export async function testResults(root: string, feature: string | null | undefined): Promise<Partial<Record<TestPillar, PillarResult>>> {
  if (!feature) return {};
  const text = await fs.readText(`${await sparDir(root)}/specs/${feature}/test-report.md`).catch(() => null);
  return text == null ? {} : parseTestReport(text);
}

/** Runs the project's own tests and starts the app, locally and without the agent. Returns
 *  the note the chat shows ("Running … locally."), if a test task ran. */
export function runLocally(): string | null {
  let note: string | null = null;
  const test = primaryTask(devTasks(), "test");
  if (test) {
    runTask(test);
    note = `Running ${test.command} locally.`;
  }
  if (previewIsServer() && usePreview.getState().state === "idle") preview.start();
  if (previewAvailable()) useWorkspace.getState().open({ kind: "preview" });
  return note;
}
