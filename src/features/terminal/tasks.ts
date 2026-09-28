// The Mac app's DevTasks (Backend/Tasks.swift): runnable project tasks found in the usual
// places, so developers can run and test without typing commands: package.json scripts,
// Makefile targets, Cargo, SwiftPM, Go, Python, SPAR checks.

import { fs } from "../../lib/api";

export type TaskKind = "run" | "test" | "build" | "other";

export interface DevTask {
  name: string;
  command: string;
  kind: TaskKind;
  source: string;
  id: string;
}

const task = (name: string, command: string, kind: TaskKind, source: string): DevTask => ({ name, command, kind, source, id: `${source}:${name}` });

/** What the detector needs to know about a project (so it can be tested without disk). */
export interface ProjectProbe {
  exists(rel: string): Promise<boolean>;
  read(rel: string): Promise<string | null>;
}

export function diskProbe(root: string): ProjectProbe {
  const abs = (rel: string) => (rel ? `${root}/${rel}` : root);
  return {
    exists: (rel) => fs.exists(abs(rel)).catch(() => false),
    read: (rel) => fs.readText(abs(rel)).catch(() => null),
  };
}

export function scriptKind(name: string): TaskKind {
  return ["dev", "start", "serve", "preview"].includes(name) ? "run" : name.startsWith("test") ? "test" : name.startsWith("build") ? "build" : "other";
}

export function makeTargets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_.-]+):(?!=)/);
    if (!m || m[1].startsWith(".")) continue;
    out.push(m[1]);
  }
  return out;
}

export async function detectTasks(p: ProjectProbe): Promise<DevTask[]> {
  const tasks: DevTask[] = [];

  // package.json scripts, at the root or in a web folder.
  for (const dir of ["", "web", "frontend", "app", "client"]) {
    const base = (f: string) => (dir ? `${dir}/${f}` : f);
    const text = await p.read(base("package.json"));
    if (text == null) continue;
    let scripts: Record<string, unknown> | undefined;
    try {
      const j = JSON.parse(text);
      scripts = j && typeof j.scripts === "object" && !Array.isArray(j.scripts) ? j.scripts : undefined;
    } catch { continue; }
    if (!scripts) continue;
    const pm = (await p.exists(base("pnpm-lock.yaml"))) ? "pnpm"
      : (await p.exists(base("yarn.lock"))) ? "yarn"
      : (await p.exists(base("bun.lockb"))) ? "bun" : "npm";
    const prefix = dir ? `cd ${dir} && ` : "";
    for (const name of Object.keys(scripts).filter((k) => typeof scripts![k] === "string").sort()) {
      tasks.push(task(dir ? `${dir}: ${name}` : name, `${prefix}${pm} run ${name}`, scriptKind(name), "package.json"));
    }
  }

  // Makefile targets (simple "name:" lines).
  const make = await p.read("Makefile");
  if (make != null) {
    for (const name of makeTargets(make)) {
      const kind: TaskKind = name === "run" || name === "dev" || name === "serve" ? "run"
        : name.startsWith("test") ? "test" : name === "build" || name === "all" ? "build" : "other";
      tasks.push(task(`make ${name}`, `make ${name}`, kind, "Makefile"));
    }
  }

  if (await p.exists("Cargo.toml")) {
    tasks.push(task("cargo run", "cargo run", "run", "Cargo"), task("cargo test", "cargo test", "test", "Cargo"), task("cargo build", "cargo build", "build", "Cargo"));
  }
  if (await p.exists("Package.swift")) {
    tasks.push(task("swift run", "swift run", "run", "SwiftPM"), task("swift test", "swift test", "test", "SwiftPM"), task("swift build", "swift build", "build", "SwiftPM"));
  }
  if (await p.exists("go.mod")) {
    tasks.push(task("go run .", "go run .", "run", "Go"), task("go test ./...", "go test ./...", "test", "Go"), task("go build ./...", "go build ./...", "build", "Go"));
  }
  if ((await p.exists("pyproject.toml")) || (await p.exists("pytest.ini")) || (await p.exists("setup.py")) || (await p.exists("tests"))) {
    const runner = (await p.exists("uv.lock")) ? "uv run pytest" : "python3 -m pytest";
    tasks.push(task("pytest", runner, "test", "Python"));
  }
  if ((await p.exists("spar/checks.yaml")) || (await p.exists(".spar")) || (await p.exists("spar/specs")) || (await p.exists("spar/tenets.md"))) {
    tasks.push(task("SPAR checks", "spar check --scope project", "test", "SPAR"));
  }
  return tasks;
}

/** The task ▶ Run, ⌘U and ⇧⌘B start: the conventional name, else the first of its kind. */
export function primaryTask(tasks: DevTask[], kind: TaskKind): DevTask | undefined {
  const preferred = kind === "run" ? ["dev", "start"] : kind === "test" ? ["test"] : ["build"];
  return tasks.find((t) => t.kind === kind && preferred.some((p) => t.name.endsWith(p))) ?? tasks.find((t) => t.kind === kind);
}
