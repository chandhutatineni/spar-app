// Per-project wiring (the terminal parts of the Mac app's Workspace init/close/refresh):
// detect tasks and the preview when a project opens, refresh them when files change, and
// stop the preview and every terminal when it closes.

import { create } from "zustand";
import { app as appApi } from "../../lib/api";
import { onFilesChanged, onProjectClose, onProjectOpen, useApp } from "../../state/app";
import { detectTasks, diskProbe, primaryTask, type DevTask, type TaskKind } from "./tasks";
import { preview } from "./preview";
import { closeAllTerminals, runTask, toggleTerminal } from "./terminals";

export const useDevTasks = create<{ tasks: DevTask[] }>(() => ({ tasks: [] }));
export const devTasks = () => useDevTasks.getState().tasks;

let current = "";
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

async function refreshTasks(root: string) {
  const tasks = await detectTasks(diskProbe(root)).catch(() => [] as DevTask[]);
  if (root === current) useDevTasks.setState({ tasks });
}

function opened(root: string) {
  current = root;
  useDevTasks.setState({ tasks: [] });
  refreshTasks(root);
  preview.open(root);
  // Development aids, as in the Mac app: SPAR_TERMINAL opens the terminal, SPAR_RUN=<run|test|build> runs a task.
  appApi.info().then(async (info) => {
    if (root !== current) return;
    if (info.env.SPAR_TERMINAL) toggleTerminal();
    const kind = info.env.SPAR_RUN as TaskKind | undefined;
    if (kind && ["run", "test", "build", "other"].includes(kind)) {
      const t = primaryTask(await detectTasks(diskProbe(root)), kind);
      if (t) setTimeout(() => root === current && runTask(t), 2000);
    }
  }).catch(() => {});
}

onProjectOpen(opened);
onProjectClose(() => {
  current = "";
  clearTimeout(refreshTimer);
  preview.open("");
  closeAllTerminals();
  useDevTasks.setState({ tasks: [] });
});

// Local edits (the agent's or the person's) refresh the tasks and the preview.
onFilesChanged(() => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (!current) return;
    refreshTasks(current);
    preview.filesChanged();
  }, 350);
});

// Loaded after the project opened (hot reload): catch up.
const open = useApp.getState().project;
if (open && !current) opened(open);
