// App commands: what the native menu, keyboard shortcuts and the command palette run.
// Menu items send their id (see src-tauri/src/appx.rs); features register handlers:
//
//   useCommand("run-test", { title: "Run: Test", run: () => runPrimary("test") });
//
// The command palette lists every registered command that has a title.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { listen } from "./backend";

export interface Command {
  title?: string;
  /** Group label in the palette ("File", "View", "Agent", …) */
  group?: string;
  shortcut?: string;
  enabled?: () => boolean;
  run: () => void;
}

const commands = new Map<string, Command>();
const subs = new Set<() => void>();
let version = 0;

export function registerCommand(id: string, c: Command) {
  commands.set(id, c);
  version++;
  subs.forEach((s) => s());
  return () => {
    if (commands.get(id) === c) {
      commands.delete(id);
      version++;
      subs.forEach((s) => s());
    }
  };
}

export function runCommand(id: string) {
  const c = commands.get(id);
  if (c && (c.enabled?.() ?? true)) c.run();
}

export function allCommands(): [string, Command][] {
  return [...commands.entries()];
}

export function useCommands() {
  useSyncExternalStore((s) => (subs.add(s), () => subs.delete(s)), () => version);
  return allCommands();
}

/** Registers a command for the lifetime of a component (latest closure wins). */
export function useCommand(id: string, c: Command) {
  const ref = useRef(c);
  ref.current = c;
  useEffect(
    () => registerCommand(id, {
      get title() { return ref.current.title; },
      get group() { return ref.current.group; },
      get shortcut() { return ref.current.shortcut; },
      enabled: () => ref.current.enabled?.() ?? true,
      run: () => ref.current.run(),
    }),
    [id],
  );
}

let menuHooked = false;
/** Routes native menu clicks to commands (once per window). */
export function hookMenu() {
  if (menuHooked) return;
  menuHooked = true;
  listen<{ id: string }>("menu", ({ id }) => runCommand(id));
}
