// Backend pseudo-terminals (src-tauri/src/pty.rs).

import { call, listen } from "../../lib/backend";

export interface PtyOpen { id: string; cwd: string; shell?: string; cols: number; rows: number; env?: Record<string, string> }

export const pty = {
  open: (o: PtyOpen) => call<{ shell: string }>("pty_open", { ...o }),
  write: (id: string, data: string) => call<void>("pty_write", { id, data }),
  resize: (id: string, cols: number, rows: number) => call<void>("pty_resize", { id, cols, rows }),
  close: (id: string) => call<void>("pty_close", { id }),
  list: () => call<string[]>("pty_list"),
  onData: (h: (p: { id: string; data: string }) => void) => listen("pty:data", h),
  onExit: (h: (p: { id: string; code: number }) => void) => listen("pty:exit", h),
};

/** Static-page preview server (src-tauri/src/preview.rs). */
export const previewServe = (root: string) => call<{ url: string }>("preview_serve", { root });
