// Project rules (Rules.swift): `spar/rules/*.md` with front matter (description, globs,
// alwaysApply), the instruction files agents read natively, and SPAR's governance.
// The chat feature uses loadRules/ruleApplies to pass relevant rules with a message.

import { basename, dirname, exec, fs, joinPath } from "../../lib/api";
import { sparDirName } from "./sparPaths";

export interface ProjectRule {
  path: string;
  description: string;
  globs: string[];
  alwaysApply: boolean;
}

export const ruleName = (r: ProjectRule) => basename(r.path).replace(/\.[^.]+$/, "");

/** Whether a rule is relevant to any of the given workspace-relative paths. */
export const ruleApplies = (r: ProjectRule, files: string[]) =>
  r.alwaysApply || files.some((f) => r.globs.some((g) => matchGlob(g, f)));

export async function rulesDir(root: string) {
  return joinPath(root, await sparDirName(root), "rules");
}

/** The older rules folder other tools used; still honoured, and migrated on request. */
export const legacyRulesDir = (root: string) => joinPath(root, ".cursor/rules");

export async function loadRules(root: string): Promise<ProjectRule[]> {
  const out: ProjectRule[] = [];
  for (const d of [await rulesDir(root), legacyRulesDir(root)]) {
    let names: string[] = [];
    try { names = (await fs.list(d)).filter((e) => !e.is_dir).map((e) => e.name); } catch { continue; }
    for (const name of names.filter((n) => n.endsWith(".mdc") || n.endsWith(".md")).sort()) {
      const path = joinPath(d, name);
      try { out.push(parseRule(path, await fs.readText(path))); } catch { /* unreadable */ }
    }
  }
  return out;
}

const unquote = (s: string, chars: string) => {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
};

export function parseRule(path: string, text: string): ProjectRule {
  const rule: ProjectRule = { path, description: "", globs: [], alwaysApply: false };
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return rule;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return rule;
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === "description") rule.description = unquote(value, "\"'");
    else if (key === "globs") rule.globs = unquote(value, "[]").split(",").map((g) => unquote(g, " \"'")).filter(Boolean);
    else if (key === "alwaysApply") rule.alwaysApply = value.toLowerCase() === "true";
  }
  return rule;
}

/** The file text with a rule's front matter rewritten, keeping its body. */
export function withFrontMatter(rule: ProjectRule, text: string): string {
  let lines = text.split("\n");
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end >= 0) lines = lines.slice(end + 1);
  }
  const front = ["---", `description: ${rule.description}`, `globs: ${rule.globs.join(", ")}`, `alwaysApply: ${rule.alwaysApply}`, "---"];
  return [...front, ...lines].join("\n");
}

export async function saveRule(rule: ProjectRule) {
  let text = "";
  try { text = await fs.readText(rule.path); } catch { /* new */ }
  await fs.writeText(rule.path, withFrontMatter(rule, text));
}

export const ruleSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export async function createRule(root: string, name: string): Promise<string | null> {
  const slug = ruleSlug(name);
  if (!slug) return null;
  const dir = await rulesDir(root);
  await fs.mkdir(dir);
  const path = joinPath(dir, `${slug}.md`);
  if (await fs.exists(path)) return path;
  const body = `---\ndescription: ${name}\nglobs:\nalwaysApply: false\n---\n\n# ${name}\n\n- Write the rule as short, checkable statements.`;
  await fs.writeText(path, body);
  return path;
}

/** Instruction files agents read on their own. */
export const instructionFiles = ["CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md"];

export async function governanceFiles(root: string) {
  const d = await sparDirName(root);
  return [`${d}/tenets.md`, `${d}/standards.md`, `${d}/references.md`];
}

/** Moves rules from the old folder into spar/rules (git mv when tracked), dropping it if empty. */
export async function migrateLegacyRules(root: string) {
  const legacy = legacyRulesDir(root);
  if (!(await fs.exists(legacy))) return;
  const dest = await rulesDir(root);
  await fs.mkdir(dest);
  for (const e of await fs.list(legacy)) {
    const to = joinPath(dest, e.name.replace(/\.mdc$/, ".md"));
    if (await fs.exists(to)) continue;
    const r = await exec.run("git", ["mv", e.path, to], { cwd: root }).catch(() => null);
    if (!r?.ok) await fs.rename(e.path, to).catch(() => {});
  }
  for (const folder of [legacy, dirname(legacy)]) {
    const items = await fs.list(folder).catch(() => null);
    if (items && items.length === 0) await fs.remove(folder).catch(() => {});
  }
}

/** Minimal glob matching: `*` within a segment, `**` across segments, `?` one character. */
export function matchGlob(glob: string, path: string): boolean {
  let re = "";
  for (let i = 0; i < glob.length; ) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") { re += "(.*/)?"; i += 3; } else { re += ".*"; i += 2; }
        continue;
      }
      re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if ("\\.^$|()[]{}+".includes(c)) re += "\\" + c;
    else re += c;
    i++;
  }
  if (!glob.includes("/")) re = "(.*/)?" + re;
  return new RegExp(`^${re}$`).test(path);
}
