// Project file list for quick open and the explorer filter (Workspace.fileIndex),
// cached for 20 seconds and dropped when files change.

import { fs } from "../../lib/api";

const cache = new Map<string, { at: number; files: Promise<string[]> }>();

export function fileIndex(root: string): Promise<string[]> {
  const c = cache.get(root);
  if (c && Date.now() - c.at < 20_000) return c.files;
  const files = fs.walk(root, 20_000, false).catch(() => [] as string[]);
  cache.set(root, { at: Date.now(), files });
  return files;
}

export function invalidateFileIndex(root?: string) {
  if (root) cache.delete(root); else cache.clear();
}
