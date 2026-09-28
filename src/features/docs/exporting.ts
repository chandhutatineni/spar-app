// Exports (DocController.export, Slides.exportPPTX, DiagramDocument's image export).
// Documents render light-themed in an offscreen page 672px wide (a Letter page's printable
// width with the Mac app's margins), so what fits the layout fits the page.

import { create } from "zustand";
import { call } from "../../lib/backend";
import { basename, dirname, fs, saveDialog } from "../../lib/api";
import { pageHTML, PRINT_CSS, whenLoaded, type DocPage } from "./page";
import { prepare, renderDiagramFile } from "./render";
import { detectEngine } from "./engines";

export type ExportFormat = "pdf" | "docx" | "html" | "pptx" | "image";

const TITLES: Record<ExportFormat, string> = { pdf: "PDF", docx: "Word (.docx)", html: "HTML", pptx: "PowerPoint (.pptx)", image: "Image" };

interface ExportState {
  /** Path being exported → progress message. */
  busy: Record<string, string>;
  set(p: Partial<Omit<ExportState, "set">>): void;
}

export const useExports = create<ExportState>((set) => ({ busy: {}, set: (p) => set(p) }));

const setBusy = (path: string, msg: string | null) => {
  const busy = { ...useExports.getState().busy };
  if (msg) busy[path] = msg; else delete busy[path];
  useExports.getState().set({ busy });
};
export const isMarkdown = (p: string) => /\.(md|markdown)$/i.test(p);
export const isHTML = (p: string) => /\.html?$/i.test(p);

/** Slides.isDeck: an HTML file under slides/ or with <section>s. */
export async function isDeck(path: string): Promise<boolean> {
  if (!isHTML(path)) return false;
  if (path.toLowerCase().includes("/slides/")) return true;
  return (await fs.readText(path).catch(() => "")).includes("<section");
}

export function exportFormats(path: string): { format: ExportFormat; label: string }[] {
  const f = (format: ExportFormat) => ({ format, label: TITLES[format] });
  if (isMarkdown(path)) return [f("pdf"), f("docx"), f("html")];
  if (isHTML(path)) return [f("pptx")];
  const engine = detectEngine(path);
  if (engine === "drawio") return [f("pdf"), f("html")];
  if (engine === "d2" || engine === "c4PlantUML" || engine === "pythonDiagrams") return [{ format: "image", label: "Image (next to the source)" }];
  return [];
}

const stem = (p: string) => basename(p).replace(/\.drawio\.(svg|png)$/i, "").replace(/\.[^.]+$/, "");

/** Asks where to save and exports. Returns where it went (null: cancelled); throws with
 *  the reason when it fails. The caller shows the file (the editor reveals it). */
export async function exportDocument(path: string, format: string): Promise<string | null> {
  const fmt = format as ExportFormat;
  try {
    if (fmt === "image") return await exportImage(path);
    const ext = fmt === "docx" ? "docx" : fmt;
    const dest = await saveDialog(`${dirname(path)}/${stem(path)}.${ext}`, [{ name: TITLES[fmt], extensions: [ext] }]);
    if (!dest) return null;
    if (fmt === "pptx") {
      setBusy(path, "Exporting to PowerPoint…");
      await call<string>("docs_pptx", { path, dest });
    } else {
      setBusy(path, `Exporting as ${TITLES[fmt]}…`);
      await exportMarkdown(path, fmt as "pdf" | "docx" | "html", dest);
    }
    return dest;
  } catch (e) {
    throw new Error(String((e as Error).message ?? e));
  } finally {
    setBusy(path, null);
  }
}

/** The markdown a file exports as: itself, or a one-line document embedding a .drawio. */
async function sourceMarkdown(path: string): Promise<string> {
  if (detectEngine(path) === "drawio") return `![](<${path}>)\n`;
  return fs.readText(path);
}

/** Renders the document light-themed offscreen and writes it out. */
export async function exportMarkdown(path: string, format: "pdf" | "docx" | "html", dest: string) {
  const md = await prepare(await sourceMarkdown(path), dirname(path));
  const job = await OffscreenDoc.open();
  try {
    await job.load(md);
    const title = stem(path);
    if (format === "pdf") {
      await job.page.sparInlineImages();
      await call("docs_pdf", { html: job.page.sparExportHTML(title, PRINT_CSS), dest });
    } else {
      await job.page.sparInlineImages();
      const body = job.page.sparReplaceDiagrams(await job.page.sparDiagramImages());
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
      if (format === "html") await fs.writeText(dest, html);
      else await call("docs_docx", { html, dest });
    }
  } finally {
    job.close();
  }
}

/** A hidden, full-height page, so printing and snapshots see the whole document. */
class OffscreenDoc {
  static readonly width = 672;
  private constructor(readonly frame: HTMLIFrameElement, readonly page: DocPage) {}

  static async open(): Promise<OffscreenDoc> {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, { position: "fixed", left: "-20000px", top: "0", width: `${this.width}px`, height: "1000px", border: "0", visibility: "hidden" });
    const loaded = whenLoaded(frame);
    frame.srcdoc = pageHTML();
    document.body.appendChild(frame);
    return new OffscreenDoc(frame, await loaded);
  }

  async load(md: string) {
    const h = await this.page.sparRender(md, false, true);
    this.frame.style.height = `${Math.min(h + 40, 60000)}px`;
    await new Promise((r) => setTimeout(r, 400));
  }

  close() {
    this.frame.remove();
  }
}

/** Renders a diagram and copies the image next to its source (arch.py → arch.png). */
async function exportImage(path: string): Promise<string | null> {
  setBusy(path, "Rendering…");
  const img = await renderDiagramFile(path, false);
  const ext = img.file.split(".").pop() ?? "png";
  const dest = path.replace(/\.[^./\\]+$/, "") + "." + ext;
  await fs.writeBase64(dest, img.data);
  return dest;
}
