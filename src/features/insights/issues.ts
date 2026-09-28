// Tracker keys in `specs/<feature>/issues.md` (pure parsing; the Mac app's Tracker.issues).

import { joinPath } from "../../lib/api";
import * as T from "./traceText";

export function trimChars(s: string, chars: string) {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

/** An issue in the tracker for the feature (its epic), a user story or a task, from `issues.md`. */
export interface TrackerIssue {
  item: string;   // "epic", "US1", "T001"
  type: string;
  key: string;
  url: string | null;
}

export const trackerPath = (sparDir: string, feature: string) => joinPath(sparDir, "specs", feature, "issues.md");

/** Only web links open from a file the agent wrote. */
export function isWeb(url: string): boolean {
  try { return ["https:", "http:"].includes(new URL(url).protocol.toLowerCase()); } catch { return false; }
}

export function browse(key: string, saved: string): string | null {
  const s = trimChars(saved, "/ ");
  if (!s) return null;
  const url = (s.includes("://") ? s : "https://" + s) + "/browse/" + key;
  return isWeb(url) ? url : null;
}

/** Keyed by "epic", "US1", "T001". */
export function parseIssues(text: string, feature: string, saved: string): Record<string, TrackerIssue> {
  const table = T.table(text, null, (h) => h.some((x) => x.startsWith("key")));
  if (!table) return {};
  const keyC = table.header.findIndex((x) => x.startsWith("key"));
  const typeI = table.header.findIndex((x) => x.startsWith("type"));
  const urlI = table.header.findIndex((x) => x.startsWith("url") || x.startsWith("link"));
  const out: Record<string, TrackerIssue> = {};
  for (const { cells } of table.rows) {
    if (cells.length <= keyC) continue;
    const key = T.match(/\b([A-Z][A-Z0-9_]+-\d+)\b/, cells[keyC]);
    if (!key) continue;
    const item = T.plain(cells[0] ?? "");
    const type = typeI >= 0 && typeI < cells.length ? T.plain(cells[typeI]) : "";
    let id: string;
    if (type.toLowerCase() === "epic" || item.toLowerCase() === "epic" || item === feature) id = "epic";
    else {
      const m = T.match(/^(US\d+|T\d{3,})\b/, item.toUpperCase());
      if (!m) continue;
      id = m;
    }
    const urlCell = urlI >= 0 && urlI < cells.length ? cells[urlI] : "";
    const written = [urlCell, cells[keyC]].map((c) => T.match(/(https?:\/\/[^\s)>|]+)/, c)).find(Boolean) ?? null;
    const url = written && isWeb(written) ? written : browse(key, saved);
    out[id] = { item: id, type, key, url };
  }
  return out;
}

