// A diagram source file (DiagramViews.swift: DiagramDocument): the code on the left, the
// rendered diagram on the right, re-rendered on every save. draw.io files open rendered, or
// in the full visual editor.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Box, Cloud, Layers, MessageSquareText, RefreshCw, Share, Share2, Workflow } from "lucide-react";
import { app, fs, dirname, relativePath } from "../../lib/api";
import { alert } from "../../lib/dialogs";
import { SFSymbol } from "../../ui/icons";
import { MenuButton } from "../../ui";
import { exportDocument, useExports } from "./exporting";
import "./docs.css";
import { listen } from "../../lib/backend";
import { useWorkspace } from "../../state/workspace";
import { Button, Segmented, Spinner } from "../../ui";
import { useIntegration } from "../editor/integration";
import { MonacoView } from "../editor/MonacoView";
import { ENGINE_INFO, type DiagramEngine } from "./engines";
import { renderDiagramFile } from "./render";
import { DrawioEditor, ImageFileView, MarkdownDoc, MermaidView, useDark } from "./views";

export const ENGINE_ICON: Record<DiagramEngine, typeof Cloud> = {
  pythonDiagrams: Cloud, drawio: Layers, d2: Share2, mermaid: Workflow, c4PlantUML: Box,
};

/** DiagramEngine.symbol in the Mac app. */
export const ENGINE_SYMBOL: Record<DiagramEngine, string> = {
  pythonDiagrams: "cloud", drawio: "square.on.circle", d2: "point.3.connected.trianglepath.dotted", mermaid: "flowchart", c4PlantUML: "square.stack.3d.up",
};

/** The engine's SF Symbol (lucide elsewhere). */
export const EngineIcon = ({ engine, size = 13 }: { engine: DiagramEngine; size?: number }) => {
  const Icon = ENGINE_ICON[engine];
  return <SFSymbol name={ENGINE_SYMBOL[engine]} size={size} fallback={<Icon size={size + 2} />} />;
};

/** A `.buttonStyle(.borderless)` `.controlSize(.small)` toolbar button: accent-tinted, no chrome. */
const Borderless = ({ children, onClick, title, disabled }: { children: React.ReactNode; onClick?: () => void; title?: string; disabled?: boolean }) => (
  <button type="button" className="doc-borderless" title={title} aria-label={title} disabled={disabled} onClick={onClick}>{children}</button>
);

/** Install progress from the backend (`docs:setup`), while something is installing. */
export function useSetupMessage(): string | null {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => listen<{ message: string; state: string }>("docs:setup", (p) => setMsg(p.state === "running" ? p.message : null)), []);
  return msg;
}

export function DiagramDocument({ path, engine, showSource = true }: { path: string; engine: DiagramEngine; showSource?: boolean }) {
  const root = useWorkspace((s) => s.root);
  const dirty = useWorkspace((s) => s.dirty.has(path));
  const version = useWorkspace((s) => s.fileTreeVersion);
  const dark = useDark();
  const chat = useIntegration();
  const setup = useSetupMessage();
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [mermaidSource, setMermaidSource] = useState("");
  const [drawioMode, setDrawioMode] = useState<"preview" | "visual" | "xml">("preview");
  const exporting = useExports((s) => !!s.busy[path]);
  const gen = useRef(0);
  const relative = relativePath(root, path);

  const render = async () => {
    if (engine === "mermaid") { setMermaidSource(await fs.readText(path).catch(() => "")); return; }
    if (engine === "drawio") return;
    const g = ++gen.current;
    setRendering(true);
    try {
      const r = await renderDiagramFile(path, dark);
      if (g !== gen.current) return;
      setImage(`data:${r.mime};base64,${r.data}`);
      setError(null);
    } catch (e) {
      if (g !== gen.current) return;
      setError(String((e as Error).message ?? e));
      setImage(null);
    } finally {
      if (g === gen.current) setRendering(false);
    }
  };

  useEffect(() => { void render(); }, [path, version, dark]);

  const runExport = async (format: string) => {
    try {
      const dest = await exportDocument(path, format);
      if (dest) await app.reveal(dest);
    } catch (e) {
      await alert("Export failed", String((e as Error).message ?? e));
    }
  };

  const saveAndRender = async () => {
    const ed = useWorkspace.getState().editor;
    if (ed?.isDirty(path)) await ed.save(path);
    setTimeout(() => void render(), 300);
  };

  const preview = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", display: "flex", background: "var(--subtle)" }}>
      {engine === "mermaid" ? <MermaidView code={mermaidSource} dark={dark} />
        : image ? <ImageFileView src={image} />
        : error ? (
          <div className="empty" data-testid="diagram-error">
            <span style={{ color: "var(--warn)", display: "inline-flex" }}><SFSymbol name="exclamationmark.triangle" size={17} fallback={<AlertTriangle size={22} />} /></span>
            <div className="headline">Couldn't render the diagram</div>
            <div className="mono" style={{ maxWidth: 420, fontSize: 10, color: "var(--text-2)", whiteSpace: "pre-wrap", userSelect: "text", fontFamily: "var(--mono)" }}>{error}</div>
            {setup && engine !== "d2" && <div style={{ fontSize: 10, color: "var(--text-2)" }}>Diagram tools are still installing; this renders once setup finishes.</div>}
            <Button disabled={!chat.sendToChat || chat.agentRunning || chat.hasSession === false}
              onClick={() => chat.sendToChat?.(`The diagram ${relative} fails to render:\n${error}\n\nFix the diagram source.`)}>
              Ask the agent to fix it
            </Button>
          </div>
        ) : (
          <div className="empty"><Spinner />{setup && <div className="caption">{setup}…</div>}</div>
        )}
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }} data-testid="diagram-document">
      <div className="row doc-toolbar" style={{ flex: "none", gap: 10, padding: "7px 14px", borderBottom: "1px solid var(--hairline)" }}>
        <span style={{ color: "var(--accent)", display: "inline-flex" }}><EngineIcon engine={engine} /></span>
        <span style={{ fontSize: 12, fontWeight: 600, flex: "none" }}>{ENGINE_INFO[engine].title}</span>
        <span className="mono" title={relative} style={{ fontSize: 10, color: "var(--text-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
          <bdi>{relative}</bdi>
        </span>
        {dirty && <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--warn)", flex: "none" }} />}
        <span className="spacer" />
        {(rendering || setup) && <span className="row" style={{ gap: 6, fontSize: 10, color: "var(--text-2)" }}><Spinner small />{setup ? `${setup}…` : null}</span>}
        {engine === "drawio" ? (
          <>
            {drawioMode === "preview" && (
              <>
                {exporting && <Spinner small />}
                <MenuButton className="doc-borderless" items={() => [
                  { label: "Export as PDF…", onClick: () => void runExport("pdf") },
                  { label: "Export as HTML…", onClick: () => void runExport("html") },
                ]}>{sym("square.and.arrow.up", <Share size={12} />)}Export</MenuButton>
              </>
            )}
            <Segmented value={drawioMode} onChange={setDrawioMode}
              options={[{ value: "preview", label: "Preview" }, { value: "visual", label: "Edit" }, { value: "xml", label: "XML" }]} />
          </>
        ) : (
          <>
            {engine !== "mermaid" && <Borderless title="Save and render" onClick={() => void saveAndRender()}>{sym("arrow.clockwise", <RefreshCw size={12} />)}Render</Borderless>}
            {engine !== "mermaid" && image && (
              <Borderless title="Save the image next to the source file" onClick={() => void runExport("image")}>{sym("square.and.arrow.up", <Share size={12} />)}Export</Borderless>
            )}
          </>
        )}
        {chat.attachToChat && (
          <Borderless title="Add to chat" onClick={() => chat.attachToChat?.({ kind: "file", path: relative })}>{sym("text.bubble", <MessageSquareText size={13} />, 12)}</Borderless>
        )}
      </div>
      {engine === "drawio" && drawioMode === "xml" ? (
        <SplitSource path={path}><MarkdownDoc path={`${dirname(path)}/.${path.split("/").pop()}.md`} text={`![](<${path}>)\n`} /></SplitSource>
      ) : engine === "drawio" ? (
        drawioMode === "preview"
          ? <MarkdownDoc path={`${dirname(path)}/.${path.split("/").pop()}.md`} text={`![](<${path}>)\n`} />
          : <DrawioEditor path={path} dark={dark} onSaved={() => useWorkspace.setState((s) => ({ fileTreeVersion: s.fileTreeVersion + 1 }))} />
      ) : showSource ? (
        <SplitSource path={path}>{preview}</SplitSource>
      ) : preview}
    </div>
  );
}

const sym = (name: string, fallback: React.ReactNode, size = 11) => <SFSymbol name={name} size={size} fallback={fallback} />;

function SplitSource({ path, children }: { path: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div style={{ width: Math.max(260, w * 0.42), flex: "none", display: "flex", flexDirection: "column", borderRight: "0.5px solid var(--hairline-strong)" }}>
        <MonacoView path={path} />
      </div>
      {children}
    </div>
  );
}
