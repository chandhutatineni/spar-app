// ▶ Run (the Mac app's Views/RunMenu.swift): the project's main task on click, every
// detected task in the menu. Tasks run in the integrated terminal so their output stays
// visible. Also registers the Run menu's commands (⌘R, ⌘U, ⇧⌘B, Stop).

import { ChevronDown, Hammer, Play, Square, SquareTerminal, DiamondPlus } from "lucide-react";
import type { ReactNode } from "react";
import { SFSymbol } from "../../ui/icons";
import { useCommand } from "../../lib/commands";
import { showMenu, type MenuEntry } from "../../ui";
import { useDevTasks } from "./project";
import { primaryTask, type DevTask, type TaskKind } from "./tasks";
import { clearTerminal, interruptTerminal, newTerminal, runTask, toggleTerminal } from "./terminals";

const KIND_TITLE: Record<TaskKind, string> = { run: "Run", test: "Test", build: "Build", other: "Other" };

export function taskIcon(kind: TaskKind, size = 13): ReactNode {
  // DevTask.symbol in Backend/Tasks.swift.
  switch (kind) {
    case "run": return <SFSymbol name="play.fill" size={size} fallback={<Play size={size} fill="currentColor" />} />;
    case "test": return <SFSymbol name="checkmark.diamond" size={size} fallback={<DiamondPlus size={size} />} />;
    case "build": return <SFSymbol name="hammer" size={size} fallback={<Hammer size={size} />} />;
    default: return <SFSymbol name="terminal" size={size} fallback={<SquareTerminal size={size} />} />;
  }
}

export function runMenuItems(tasks: DevTask[]): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (!tasks.length) items.push({ label: "No tasks found. Add scripts to package.json, a Makefile, Cargo.toml, Package.swift or go.mod.", disabled: true });
  for (const kind of ["run", "test", "build", "other"] as TaskKind[]) {
    const group = tasks.filter((t) => t.kind === kind);
    if (!group.length) continue;
    items.push({ section: KIND_TITLE[kind] });
    for (const t of group) items.push({ label: t.name, icon: taskIcon(t.kind), onClick: () => runTask(t) });
  }
  items.push("divider");
  items.push({ label: "Stop running task", icon: <SFSymbol name="stop.fill" size={13} fallback={<Square size={12} fill="currentColor" />} />, onClick: interruptTerminal });
  items.push({ label: "Show terminal", icon: <SFSymbol name="terminal" size={13} fallback={<SquareTerminal size={13} />} />, onClick: toggleTerminal });
  return items;
}

export function RunMenu(_p: Record<string, unknown> = {}) {
  const tasks = useDevTasks((s) => s.tasks);
  const run = primaryTask(tasks, "run");
  useRunCommands();
  const help = run ? `Run ${run.command} (⌘R)` : "Run";
  return (
    <div className="row" style={{ gap: 0, flex: "none" }} data-testid="run-menu">
      <button type="button" className="btn btn-plain" title={help} aria-label={help}
        style={{ paddingRight: 6, borderTopRightRadius: 0, borderBottomRightRadius: 0, maxWidth: 220 }}
        onClick={() => (run ? runTask(run) : toggleTerminal())}>
        <Play size={12} fill="currentColor" />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{run?.name ?? "Run"}</span>
      </button>
      <button type="button" className="btn btn-plain" title="Tasks" aria-label="Tasks"
        style={{ padding: "0 5px", borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
        onMouseDown={(e) => { e.stopPropagation(); showMenu(runMenuItems(useDevTasks.getState().tasks), e.currentTarget.previousElementSibling as HTMLElement ?? e.currentTarget); }}>
        <ChevronDown size={12} className="muted" />
      </button>
    </div>
  );
}

/** The Run menu (and palette) commands. */
function useRunCommands() {
  const primary = (k: TaskKind) => primaryTask(useDevTasks.getState().tasks, k);
  useCommand("run-run", { title: "Run", group: "Run", shortcut: "⌘R", enabled: () => !!primary("run"), run: () => { const t = primary("run"); if (t) runTask(t); } });
  useCommand("run-test", { title: "Test", group: "Run", shortcut: "⌘U", enabled: () => !!primary("test"), run: () => { const t = primary("test"); if (t) runTask(t); } });
  useCommand("run-build", { title: "Build", group: "Run", shortcut: "⇧⌘B", enabled: () => !!primary("build"), run: () => { const t = primary("build"); if (t) runTask(t); } });
  useCommand("run-stop", { title: "Stop Running Task", group: "Run", shortcut: "⇧⌘C", run: interruptTerminal });
  useCommand("terminal-new", { title: "New Terminal", group: "View", run: () => newTerminal() });
  useCommand("terminal-clear", { title: "Clear Terminal", group: "View", run: () => clearTerminal() });
}
