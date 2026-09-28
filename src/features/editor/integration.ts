// What the editor needs from other features (chat, terminal, scm), without importing
// their internals. Each feature fills in what it has with `provideEditorIntegration({...})`
// (exported from the editor's index); anything missing falls back to a sensible default.
//
//   chat:     sendToChat, attachToChat, focusComposer, agentRunning, hasSession, agentTitle,
//             runsSpar, phase ({title}), feature/next summary, startNextIteration, openWorkflow
//   terminal: newTerminal(cwd,title), primaryRunTask
//   scm:      branch

import { create } from "zustand";

export type ContextChip =
  | { kind: "file"; path: string }        // workspace-relative
  | { kind: "folder"; path: string }      // workspace-relative
  | { kind: "selection"; path: string; lines: [number, number]; text: string };

export interface EditorIntegration {
  /** Send a message to the agent as the person (inline ⌘K edits). */
  sendToChat?: (text: string) => void;
  /** Attach context to the composer (Add to Chat, ⌘L). */
  attachToChat?: (chip: ContextChip) => void;
  focusComposer?: () => void;
  agentRunning?: boolean;
  hasSession?: boolean;
  agentTitle?: string;
  /** Whether the selected agent runs the SPAR workflow. */
  runsSpar?: boolean;
  /** The selected phase (the phase tab's title and lucide icon name). */
  phase?: { title: string; icon?: string };
  /** One-line SPAR status for the Welcome tab card. */
  sparSummary?: { title: string; detail: string; hasFeature: boolean };
  startNextIteration?: () => void;
  openWorkflow?: () => void;
  /** Open a terminal in a folder. */
  newTerminal?: (cwd: string, title: string) => void;
  /** The primary Run task, if any (Welcome tab's Run button). */
  primaryRunTask?: { name: string; run: () => void } | null;
  branch?: string | null;
  /** Git status by workspace-relative path ("created" | "modified" | "deleted"). */
  changes?: { path: string; status: string }[];
}

export const useIntegration = create<EditorIntegration>(() => ({}));

export function provideEditorIntegration(p: Partial<EditorIntegration>) {
  useIntegration.setState(p);
}
