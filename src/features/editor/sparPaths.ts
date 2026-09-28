// SPAR folder helpers the editor needs (from Spar.swift).

import { fs, joinPath } from "../../lib/api";

const MARKERS = ["specs", "tenets.md", "standards.md", "manifest.json", "decisions.jsonl", "briefs"];

/** "spar" (visible, current) or ".spar" (older projects). */
export async function sparDirName(root: string): Promise<string> {
  for (const m of MARKERS) if (await fs.exists(joinPath(root, "spar", m))) return "spar";
  if (await fs.exists(joinPath(root, ".spar"))) return ".spar";
  return "spar";
}

export const isLegacy = async (root: string) => (await sparDirName(root)) === ".spar";

/** Whether a path lies inside a SPAR specs folder (either name). */
export const isArtifactPath = (path: string) => path.includes("/spar/specs/") || path.includes("/.spar/specs/");

export function artifactTitle(file: string): string {
  const t: Record<string, string> = {
    "spec.md": "Spec", "plan.md": "Plan", "research.md": "Research", "data-model.md": "Data model", "tasks.md": "Tasks",
    "build-log.md": "Build log", "verification.md": "Verification", "test-report.md": "Test report", "case.md": "Brief",
    "architecture.md": "Architecture",
  };
  return t[file] ?? file;
}
