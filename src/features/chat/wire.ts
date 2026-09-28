// What the agent receives is always a single typed line (Workspace.singleLine in the Mac
// app). Claude Code treats multi-line input as a paste (content the user did not write) and
// won't act on it, so longer messages and attachments are written to disk and the line asks
// the agent to read them as the user's request.

import { app, basename, fs, joinPath } from "../../lib/api";

export const TYPED_LIMIT = 600;

/** The pure part: the line itself when the text can be typed, or null when it needs a file. */
export function singleLineText(text: string, attached: string): { inline: string | null } {
  // Slash commands must stay a single line.
  if (text.startsWith("/")) return { inline: text.replace(/\n/g, " ") + attached };
  if (!text.includes("\n") && text.length + attached.length < TYPED_LIMIT) return { inline: text + attached };
  return { inline: null };
}

const shortId = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, "").slice(0, 8).toUpperCase();

/** Where message files and attachment copies go: inside the project's .git folder (readable
 *  without a permission prompt, never committed), else the app's data folder. */
async function messageBase(root: string): Promise<string> {
  const git = await fs.stat(joinPath(root, ".git")).catch(() => null);
  if (git?.is_dir) return joinPath(root, ".git", "spar");
  return joinPath((await app.info()).data_dir, "messages");
}

export async function singleLine(text: string, attachments: string[], root: string): Promise<string> {
  const base = await messageBase(root);
  const id = shortId();
  const paths: string[] = [];
  if (attachments.length) {
    const dir = joinPath(base, "attachments", id);
    await fs.mkdir(dir).catch(() => {});
    for (const src of attachments) {
      const dest = joinPath(dir, basename(src));
      await fs.copy(src, dest).then(() => paths.push(dest)).catch(() => {});
    }
  }
  const attached = paths.length ? " Attached files (read them): " + paths.join(", ") + "." : "";
  const r = singleLineText(text, attached);
  if (r.inline != null) return r.inline;
  // Claude Code folds long input into "[Pasted text]", which the model reads as data rather
  // than a request, so anything long goes through a file.
  const dir = joinPath(base, "messages");
  await fs.mkdir(dir).catch(() => {});
  const file = joinPath(dir, `message-${id}.md`);
  let body = text;
  if (paths.length) body += "\n\nAttached files:\n" + paths.map((p) => `- ${p}`).join("\n");
  await fs.writeText(file, body);
  const preview = (text.split("\n")[0] ?? "").slice(0, 100);
  return `Please do what I ask in ${file} (my message was too long to type here; it starts "${preview}").`;
}
