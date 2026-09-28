// The web views behind previews (DocumentPreview.swift / DiagramViews.swift): the rendered
// markdown page, HTML files (decks, mockups), images, Mermaid, draw.io's editor, PDFs.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fs, dirname, joinPath } from "../../lib/api";
import { useWorkspace } from "../../state/workspace";
import { Spinner } from "../../ui";
import { pageHTML, whenLoaded, type DocPage } from "./page";
import { prepare, imageMime } from "./render";

/** Whether the app is showing its dark appearance. */
export function useDark(): boolean {
  const get = () => {
    const t = document.documentElement.dataset.theme;
    return t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  };
  const [dark, setDark] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const up = () => setDark(get());
    mq.addEventListener("change", up);
    const mo = new MutationObserver(up);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { mq.removeEventListener("change", up); mo.disconnect(); };
  }, []);
  return dark;
}

const fill: CSSProperties = { flex: 1, minHeight: 0, width: "100%", height: "100%", border: 0, display: "block", background: "transparent" };

/** A rendered Markdown document (MarkdownDocView). `text` overrides the file's contents. */
export function MarkdownDoc({ path, text, onLink }: { path: string; text?: string; onLink?: (href: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<DocPage | null>(null);
  const [busy, setBusy] = useState(false);
  const dark = useDark();
  const version = useWorkspace((s) => s.fileTreeVersion);
  const reloadToken = useWorkspace((s) => s.reloadToken);
  const gen = useRef(0);
  const last = useRef<string | null>(null);
  const linkRef = useRef(onLink);
  linkRef.current = onLink;

  useEffect(() => {
    const f = frame.current!;
    const loaded = whenLoaded(f);
    f.srcdoc = pageHTML();
    let off = false;
    loaded.then((p) => !off && setPage(p));
    const msg = (e: MessageEvent) => {
      if (e.source === f.contentWindow && e.data && typeof e.data.sparDocLink === "string") linkRef.current?.(e.data.sparDocLink);
    };
    window.addEventListener("message", msg);
    return () => { off = true; window.removeEventListener("message", msg); };
  }, []);

  useEffect(() => {
    if (!page) return;
    const g = ++gen.current;
    let slow: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const src = text ?? (await fs.readText(path).catch(() => ""));
      const key = `${dark}\n${src}`;
      if (key === last.current) return; // unchanged on disk: keep the page (and its scroll)
      slow = setTimeout(() => g === gen.current && setBusy(true), 300);
      const md = await prepare(src, dirname(path));
      if (g !== gen.current) return;
      await page.sparRender(md, dark, false);
      last.current = key;
    })().finally(() => { clearTimeout(slow); if (g === gen.current) setBusy(false); });
  }, [page, path, text, dark, version, reloadToken]);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
      <iframe ref={frame} title="Document preview" data-testid="doc-frame" style={fill} />
      {busy && (
        <div className="row caption" style={{ position: "absolute", top: 10, right: 14, background: "var(--card)", padding: "4px 10px", borderRadius: 999, boxShadow: "var(--shadow)" }}>
          <Spinner small /> Rendering diagrams…
        </div>
      )}
    </div>
  );
}

/** An HTML file (a slide deck, a mockup) shown as a web page, reloaded when it changes.
 *  Local files it references are inlined; its scripts run sandboxed from the app. */
export function HTMLFileView({ path }: { path: string }) {
  const [doc, setDoc] = useState<string | null>(null);
  const version = useWorkspace((s) => s.fileTreeVersion);
  const reloadToken = useWorkspace((s) => s.reloadToken);
  const last = useRef<string | null>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      const html = await fs.readText(path).catch(() => "");
      if (html === last.current) return;
      const out = await inlineLocal(html, dirname(path));
      if (off) return;
      last.current = html;
      setDoc(out);
    })();
    return () => { off = true; };
  }, [path, version, reloadToken]);
  if (doc == null) return <div className="empty"><Spinner /></div>;
  return <iframe title="HTML preview" data-testid="html-frame" sandbox="allow-scripts allow-popups allow-forms allow-modals" srcDoc={doc} style={{ ...fill, background: "#fff" }} />;
}

const isLocalRef = (r: string | null): r is string => !!r && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(r);

async function inlineLocal(html: string, base: string): Promise<string> {
  const d = new DOMParser().parseFromString(html, "text/html");
  const abs = (r: string) => (r.startsWith("/") ? r : joinPath(base, decodeURIComponent(r.split(/[?#]/)[0])));
  for (const el of [...d.querySelectorAll("img[src], source[src], video[src], audio[src], image[href]")]) {
    const attr = el.hasAttribute("src") ? "src" : "href";
    const r = el.getAttribute(attr);
    if (!isLocalRef(r)) continue;
    const file = abs(r);
    try { el.setAttribute(attr, `data:${imageMime(file) ?? "application/octet-stream"};base64,${await fs.readBase64(file)}`); } catch { /* missing */ }
  }
  for (const el of [...d.querySelectorAll('link[rel~="stylesheet"][href]')]) {
    const r = el.getAttribute("href");
    if (!isLocalRef(r)) continue;
    try { const s = d.createElement("style"); s.textContent = await fs.readText(abs(r)); el.replaceWith(s); } catch { /* missing */ }
  }
  for (const el of [...d.querySelectorAll("script[src]")]) {
    const r = el.getAttribute("src");
    if (!isLocalRef(r)) continue;
    try { el.removeAttribute("src"); el.textContent = await fs.readText(abs(r)); } catch { /* missing */ }
  }
  return "<!doctype html>\n" + d.documentElement.outerHTML;
}

/** An SVG or PNG, fitted; click for actual size. */
export function ImageFileView({ src, alt = "" }: { src: string; alt?: string }) {
  const [actual, setActual] = useState(false);
  return (
    <div data-testid="image-view" style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", alignItems: actual ? "flex-start" : "center", justifyContent: actual ? "flex-start" : "center", padding: 16 }}
      onClick={() => setActual(!actual)} title={actual ? "Fit to the window" : "Actual size"}>
      <img src={src} alt={alt} draggable={false}
        style={actual ? { maxWidth: "none" } : { maxWidth: "100%", maxHeight: "100%", width: src.startsWith("data:image/svg") ? "100%" : undefined, height: src.startsWith("data:image/svg") ? "100%" : undefined, objectFit: "contain" }} />
    </div>
  );
}

/** An image file on disk. */
export function ImageFile({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const version = useWorkspace((s) => s.fileTreeVersion);
  useEffect(() => {
    let off = false;
    fs.readBase64(path).then((b) => !off && setSrc(`data:${imageMime(path) ?? "image/png"};base64,${b}`)).catch(() => !off && setSrc(""));
    return () => { off = true; };
  }, [path, version]);
  if (src == null) return <div className="empty"><Spinner /></div>;
  if (!src) return <div className="empty">Couldn't read the image</div>;
  return <ImageFileView src={src} />;
}

/** A PDF, in the web view's own viewer. */
export function PdfView({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const version = useWorkspace((s) => s.fileTreeVersion);
  useEffect(() => {
    let u: string | null = null;
    let off = false;
    fs.readBase64(path).then((b) => {
      if (off) return;
      const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      u = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setUrl(u);
    });
    return () => { off = true; if (u) URL.revokeObjectURL(u); };
  }, [path, version]);
  if (!url) return <div className="empty"><Spinner /></div>;
  return <iframe title="PDF" src={url} style={fill} />;
}

let mermaidSeq = 0;

/** Renders Mermaid source with the bundled mermaid.js. */
export function MermaidView({ code, dark, onHeight }: { code: string; dark: boolean; onHeight?: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict" });
      let html: string;
      try { html = (await mermaid.render("spar-mm" + mermaidSeq++, code)).svg; }
      catch (e) { html = `<div class="err" style="color:#c33;font:12px var(--mono);white-space:pre-wrap;padding:12px">${String((e as Error).message ?? e).replace(/</g, "&lt;")}</div>`; }
      if (off || !ref.current) return;
      ref.current.innerHTML = html;
      onHeight?.(ref.current.scrollHeight);
    })();
    return () => { off = true; };
  }, [code, dark]);
  return <div ref={ref} data-testid="mermaid-view" style={{ display: "flex", justifyContent: "center", padding: 12, overflow: "auto", width: "100%" }} />;
}

/** The draw.io editor (bundled, offline) editing a .drawio file in place. */
export function DrawioEditor({ path, dark, onSaved }: { path: string; dark: boolean; onSaved?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  useEffect(() => {
    const f = frame.current!;
    const lower = path.toLowerCase();
    const isSVG = lower.endsWith(".svg"), isPNG = lower.endsWith(".png");
    const send = (o: object) => f.contentWindow?.postMessage(JSON.stringify(o), "*");
    const onMsg = async (e: MessageEvent) => {
      if (e.source !== f.contentWindow || typeof e.data !== "string") return;
      let msg: { event?: string; xml?: string; data?: string };
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.event) {
        case "init": {
          // A .drawio.svg / .drawio.png keeps its diagram inside the image; draw.io reads both.
          const xml = isPNG ? `data:image/png;base64,${await fs.readBase64(path).catch(() => "")}` : await fs.readText(path).catch(() => "");
          send({ action: "load", xml, autosave: 1, saveAndExit: "0", title: path.split("/").pop() });
          break;
        }
        case "save": case "autosave":
          if (isSVG || isPNG) send({ action: "export", format: isSVG ? "xmlsvg" : "xmlpng", spinKey: "saving" });
          else if (typeof msg.xml === "string") {
            await fs.writeText(path, msg.xml);
            if (msg.event === "save") send({ action: "status", message: "Saved", modified: false });
            saved.current?.();
          }
          break;
        case "export": {
          const data = msg.data ?? "";
          const comma = data.indexOf(",");
          if (comma < 0) break;
          const payload = data.slice(comma + 1);
          const b64 = data.slice(0, comma).includes(";base64");
          if (isPNG) await fs.writeBase64(path, b64 ? payload : btoa(payload));
          else await fs.writeText(path, b64 ? new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))) : decodeURIComponent(payload));
          saved.current?.();
          break;
        }
      }
    };
    window.addEventListener("message", onMsg);
    f.src = `/drawio/index.html?embed=1&proto=json&spin=1&offline=1&stealth=1&libraries=1&noExitBtn=1&saveAndExit=0&ui=kennedy&dark=${dark ? 1 : 0}`;
    return () => window.removeEventListener("message", onMsg);
  }, [path, dark]);
  return <iframe ref={frame} title="draw.io editor" data-testid="drawio-editor" style={fill} />;
}
