// DocRender.prepare: replaces diagrams the page can't draw on its own with rendered images,
// and inlines local images, so the page (and every export) is self-contained.

import { call } from "../../lib/backend";
import { fs, joinPath } from "../../lib/api";

export interface RenderedImage { file: string; mime: string; data: string }

/** A diagram file rendered by the backend (d2, PlantUML, Python diagrams). */
export const renderDiagramFile = (path: string, dark: boolean) => call<RenderedImage>("docs_render_diagram", { path, dark });
const renderSource = (source: string, ext: string, path?: string) => call<RenderedImage>("docs_render_diagram", { source, ext, path });

export async function prepare(markdown: string, baseDir: string): Promise<string> {
  const out: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++];
    const t = line.trim();
    if (t.startsWith("```") || t.startsWith("~~~")) {
      const fence = t.slice(0, 3);
      const lang = t.slice(3).trim().toLowerCase();
      const body: string[] = [];
      while (i < lines.length) {
        const next = lines[i++];
        if (next.trim().startsWith(fence)) break;
        body.push(next);
      }
      const code = body.join("\n");
      const ext = fencedEngine(lang, code);
      if (ext) out.push(await diagramHTML(code, ext));
      else out.push(line, ...body, fence);
      continue;
    }
    out.push(await inlineImages(line, baseDir));
  }
  return out.join("\n");
}

function fencedEngine(lang: string, code: string): string | null {
  switch (lang) {
    case "d2": return "d2";
    case "plantuml": case "puml": case "c4": case "c4plantuml": return "puml";
    case "python": case "py": return code.includes("from diagrams") || code.includes("import diagrams") ? "py" : null;
    case "drawio": return "drawio";
    case "xml": return code.includes("<mxfile") || code.includes("<mxGraphModel") ? "drawio" : null;
    default: return null;
  }
}

const IMAGE = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g;

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
  bmp: "image/bmp", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff", avif: "image/avif", heic: "image/heic",
};
export const imageMime = (path: string) => MIME[extOf(path)];
const extOf = (p: string) => (p.split(/[\\/]/).pop() ?? "").split(".").slice(1).pop()?.toLowerCase() ?? "";
const isAbsolute = (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);

function resolve(baseDir: string, ref: string): string {
  let r = ref;
  try { r = decodeURIComponent(ref); } catch { /* keep as written */ }
  if (isAbsolute(r)) return r;
  const parts = joinPath(baseDir, r).split("/");
  const outp: string[] = [];
  for (const p of parts) {
    if (p === "..") outp.pop();
    else if (p !== ".") outp.push(p);
  }
  return outp.join("/");
}

async function inlineImages(line: string, baseDir: string): Promise<string> {
  const matches = [...line.matchAll(IMAGE)];
  if (!matches.length) return line;
  let result = line;
  for (const m of matches.reverse()) {
    const alt = m[1];
    const ref = m[2] ?? m[3];
    if (ref.includes("://") || ref.startsWith("data:")) continue;
    const file = resolve(baseDir, ref);
    if (!(await fs.exists(file))) continue;
    const lower = (file.split("/").pop() ?? "").toLowerCase();
    const ext = extOf(file);
    let html: string | null = null;
    if (lower.endsWith(".drawio.svg") || lower.endsWith(".drawio.png")) {
      html = await imgTag(file, alt);
    } else if (["d2", "puml", "plantuml", "iuml", "wsd", "py", "drawio", "dio"].includes(ext)) {
      const e = ext === "dio" ? "drawio" : ext;
      html = await diagramHTML(await fs.readText(file).catch(() => ""), e, file);
    } else if (ext === "mmd" || ext === "mermaid") {
      html = "\n```mermaid\n" + (await fs.readText(file).catch(() => "")) + "\n```\n";
    } else if (MIME[ext]) {
      html = await imgTag(file, alt);
    }
    if (html != null) result = result.slice(0, m.index!) + html + result.slice(m.index! + m[0].length);
  }
  return result;
}

async function imgTag(file: string, alt: string): Promise<string | null> {
  try {
    const data = await fs.readBase64(file);
    return `<img alt="${alt.replace(/"/g, "&quot;")}" src="data:${MIME[extOf(file)] ?? "image/png"};base64,${data}">`;
  } catch {
    return null;
  }
}

/** A diagram as HTML: draw.io goes to the viewer; the rest render to an image. */
async function diagramHTML(source: string, ext: string, path?: string): Promise<string> {
  if (ext === "drawio") {
    const json = JSON.stringify({ xml: source, nav: true, resize: true, highlight: "#4f46e5" });
    const attr = json.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    return `\n<div class="diagram"><div class="mxgraph" data-mxgraph="${attr}"></div></div>\n`;
  }
  try {
    // Scripts that import local modules need their own folder; everything else renders from a scratch copy.
    const r = await renderSource(source, ext, ext === "py" ? path : undefined);
    return `\n<div class="diagram"><img src="data:${r.mime};base64,${r.data}"></div>\n`;
  } catch (e) {
    const msg = String((e as Error).message ?? e).replace(/</g, "&lt;");
    return `\n<div class="diagram"><div class="err">Couldn't render this diagram: ${msg}</div></div>\n`;
  }
}
