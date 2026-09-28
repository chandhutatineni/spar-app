// Public surface of the docs feature: markdown/diagram/HTML/PDF/image previews, export,
// new diagram, the diagram settings and the markdown renderer for agent replies.

import { useEffect, useState } from "react";
import { app, fs, dirname, joinPath } from "../../lib/api";
import { call } from "../../lib/backend";
import { prefs, usePref } from "../../lib/prefs";
import { onProjectOpen, useApp } from "../../state/app";
import { useWorkspace } from "../../state/workspace";
import { Spinner } from "../../ui";
import { FormBlock, FormCaption, FormPicker } from "../mcp/form";
import { SetupPanel, StepRow } from "../mcp/setup";
import { detectEngine, detectEngineAsync, ENGINE_INFO, ENGINES, syncConfig, type DiagramEngine } from "./engines";
import { DiagramDocument, useSetupMessage } from "./DiagramDocument";
import { exportDocument as runExport, exportFormats as formatsFor, isHTML, isMarkdown, useExports } from "./exporting";
import { imageMime } from "./render";
import { HTMLFileView, ImageFile, MarkdownDoc, PdfView } from "./views";

export { NewDiagramSheet } from "./NewDiagramSheet";
export { MarkdownView } from "./MarkdownView";
export { MermaidView } from "./views";
export { detectEngine, detectEngineAsync, syncConfig, ENGINE_INFO, type DiagramEngine } from "./engines";
export { exportMarkdown, isDeck } from "./exporting";

const isPDF = (p: string) => /\.pdf$/i.test(p);
const isImage = (p: string) => !!imageMime(p) && detectEngine(p) === null;

/** Whether the docs feature renders this file (markdown, diagrams, HTML, PDF, images…).
 *  A `.py` file is a diagram when it imports `diagrams`: pass its text, or call
 *  detectEngineAsync(path) once (the answer is remembered). */
export function canPreview(path: string, text?: string): boolean {
  return isMarkdown(path) || isHTML(path) || isPDF(path) || isImage(path) || detectEngine(path, text) !== null;
}

/** A rendered preview of a file (used by the editor for its Preview mode). Diagram sources
 *  show their code beside the rendering, as in the Mac app (`showSource={false}`: only the rendering). */
export function DocumentView({ path, showSource = true }: { path: string; showSource?: boolean }) {
  const [engine, setEngine] = useState<DiagramEngine | null>(() => detectEngine(path));
  useEffect(() => {
    setEngine(detectEngine(path));
    if (path.toLowerCase().endsWith(".py")) detectEngineAsync(path).then(setEngine);
  }, [path]);
  const busy = useExports((s) => s.busy[path]);

  let body: React.ReactNode;
  if (engine) body = <DiagramDocument path={path} engine={engine} showSource={showSource} />;
  else if (isMarkdown(path)) body = <MarkdownDoc path={path} onLink={(href) => void openLink(path, href)} />;
  else if (isHTML(path)) body = <HTMLFileView path={path} />;
  else if (isPDF(path)) body = <PdfView path={path} />;
  else if (isImage(path)) body = <ImageFile path={path} />;
  else body = <div className="empty">No preview for this file</div>;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }} data-testid="document-view">
      {body}
      {busy && (
        <div className="row caption" style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", background: "var(--card)", padding: "6px 12px", borderRadius: 8, boxShadow: "var(--shadow)" }}>
          <Spinner small /> {busy}
        </div>
      )}
    </div>
  );
}

/** A link clicked in a rendered document: web links in the browser, local files in a tab. */
async function openLink(docPath: string, link: string) {
  if (!link) return;
  if (link.includes("://") || link.startsWith("mailto:")) { await app.open(link); return; }
  if (link.startsWith("#")) return;
  let rel = link.split("#")[0];
  try { rel = decodeURIComponent(rel); } catch { /* as written */ }
  const parts: string[] = [];
  for (const p of (rel.startsWith("/") ? rel : joinPath(dirname(docPath), rel)).split("/")) {
    if (p === "..") parts.pop(); else if (p !== ".") parts.push(p);
  }
  const target = parts.join("/");
  if (await fs.exists(target)) useWorkspace.getState().openFile(target);
}

/** Export a document (markdown → pdf/docx/html, HTML deck → pptx, drawio → pdf/html,
 *  d2/puml/py → image next to the source). Asks where to save; returns the file written,
 *  null when cancelled; throws with the reason on failure. */
export async function exportDocument(path: string, format: string): Promise<string | null> {
  return runExport(path, format);
}

/** Export formats offered for a file (empty when none). */
export function exportFormats(path: string): { format: string; label: string }[] {
  return formatsFor(path);
}

/** One line telling the agent which engines to use (DiagramEngine.conventions). */
export function diagramConventions(): string {
  const a = ENGINE_INFO[prefs.get<DiagramEngine>("diagramArchitecture", "pythonDiagrams")] ?? ENGINE_INFO.pythonDiagrams;
  const o = ENGINE_INFO[prefs.get<DiagramEngine>("diagramOther", "drawio")] ?? ENGINE_INFO.drawio;
  return `diagrams: architecture diagrams use ${a.title} (.${a.ext}), all other diagrams use ${o.title} (.${o.ext}); put them in docs/diagrams/ (or spar/specs/<feature>/diagrams/ in SPAR's design phase) and embed them in markdown with an image link like ![Architecture](diagrams/architecture.${a.ext}); the app renders .py (diagrams), .drawio, .d2, .mmd and .puml files, so write only the source and don't install or run tools; never hand-write draw.io XML — describe it and run \`spar drawio sequence|er|flow '<json>' -o <file>.drawio\` (sequence: participants, messages with from/to/label/reply, notes; er: entities with fields, relations with many; flow: nodes with id/label/shape/group, edges), which lays it out correctly`;
}

export const SLIDES_CONVENTIONS = `slides: when asked for slides or a presentation, write one self-contained HTML deck at docs/slides/<name>.html: 16:9, one <section class="slide"> per slide with an <h1>/<h2> title, short <ul>/<ol> bullets, <p>, <table> or <img> (relative paths or data URIs), speaker notes in <aside class="notes">, inline CSS and arrow-key navigation, no external assets; the app previews it and exports it to PowerPoint (.pptx), so don't create .pptx files yourself`;

// The project's spar/config.json follows the chosen engines: on open and when they change.
onProjectOpen((root) => void syncConfig(root).catch(() => {}));
{
  let last = `${prefs.get("diagramArchitecture", "")}|${prefs.get("diagramOther", "")}`;
  prefs.subscribe(() => {
    const now = `${prefs.get("diagramArchitecture", "")}|${prefs.get("diagramOther", "")}`;
    if (now === last) return;
    last = now;
    const root = useApp.getState().project;
    if (root) void syncConfig(root).catch(() => {});
  });
}

interface Tools { d2: boolean; plantuml: boolean; dot: boolean; python: boolean; pandoc: boolean; browser: string | null }

/** Settings › Diagrams: the two engine pickers, the caption and RuntimeStatus (setup steps,
 *  plus any diagram tool that is still missing), as rows of the grouped Settings form. */
export function DiagramSettings() {
  const [arch, setArch] = usePref<string>("diagramArchitecture", "pythonDiagrams");
  const [other, setOther] = usePref<string>("diagramOther", "drawio");
  const [tools, setTools] = useState<Tools | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setup = useSetupMessage();
  const refresh = () => call<Tools>("docs_tools").then(setTools).catch(() => {});
  useEffect(() => { refresh(); }, []);
  const options = ENGINES.map((e) => ({ value: e, label: ENGINE_INFO[e].title }));
  const missing = tools ? [
    !tools.d2 && "D2",
    !(tools.python && tools.dot) && "Python diagrams (Python libraries and Graphviz)",
    !tools.plantuml && "PlantUML",
    !tools.pandoc && "pandoc (Word export)",
    !tools.browser && "PDF export needs Chrome, Edge, Chromium or Brave",
  ].filter((x): x is string => !!x) : [];
  const repairTools = async () => {
    setRepairing(true); setError(null);
    try { await call("docs_ensure", { what: "all" }); } catch (e) { setError(String((e as Error).message ?? e)); }
    setRepairing(false); refresh();
  };
  return (
    <>
      <FormPicker label="Architecture diagrams" value={arch} onChange={setArch} options={options} />
      <FormPicker label="Other diagrams" value={other} onChange={setOther} options={options} />
      <FormCaption>The agent writes new diagrams with these. Every engine renders in the app (Python diagrams, draw.io, D2, Mermaid, C4-PlantUML); tools that aren't on this computer are installed the first time they're needed.</FormCaption>
      <FormBlock>
        <SetupPanel showRepair={!repairing} onRepair={() => void repairTools()} extra={<>
          {missing.map((t) => <StepRow key={t} state={repairing ? "running" : "pending"} title={t} />)}
          {setup && <StepRow state="running" title={`${setup}…`} />}
          {error && <div style={{ fontSize: 10, color: "var(--stop)", whiteSpace: "pre-wrap" }}>{error}</div>}
        </>} />
      </FormBlock>
    </>
  );
}
