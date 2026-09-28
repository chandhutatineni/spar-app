// Public surface of the terminal feature: terminals, run/test/build tasks, live preview.

import "./project"; // per-project wiring: tasks, preview, terminals follow the open project

export { TerminalPanel } from "./TerminalPanel";
export { RunMenu } from "./RunMenu";
export { PreviewView, sendToAgent, type PreviewViewProps } from "./PreviewView";
export { TerminalSettings } from "./TerminalSettings";

// Workspace actions (the Mac app's Workspace terminal API), for other features.
export {
  newTerminal, closeTerminal, toggleTerminal, interruptTerminal, runInTerminal, runTask,
  clearTerminal, restartTerminal, renameTerminal, focusTerminal, useTerminals,
} from "./terminals";
export { useDevTasks, devTasks } from "./project";
export { primaryTask, detectTasks, type DevTask, type TaskKind } from "./tasks";
export { preview, usePreview, previewAvailable, previewIsServer } from "./preview";
export {
  TEST_PILLARS, PILLAR_INFO, pillarInstruction, allPillarsInstruction, parseTestReport, testResults,
  taskCommands, hasUI, runLocally, type TestPillar, type PillarResult,
} from "./testing";
