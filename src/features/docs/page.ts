// The document page (DocumentPreview.swift: DocRender.page), run in a same-origin iframe:
// marked + mermaid + the offline draw.io viewer. The parent calls its functions directly
// (sparRender, sparExportHTML, sparDiagramImages, …); links are posted to the parent.

import markedUrl from "../../../node_modules/marked/lib/marked.umd.js?url";
import mermaidUrl from "mermaid/dist/mermaid.min.js?url";

export const PAGE_CSS = `
:root { --fg:#1f2328; --muted:#59636e; --bg:#ffffff; --subtle:#f6f8fa; --border:#d1d9e0; --accent:#4f46e5; color-scheme: light; }
html[data-theme=dark] { --fg:#e6edf3; --muted:#9198a1; --bg:transparent; --subtle:rgba(110,118,129,.12); --border:#3d444d; --accent:#a5b4fc; color-scheme: dark; }
html,body { margin:0; background:var(--bg); color:var(--fg); }
body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif; }
#doc { max-width: 820px; margin: 0 auto; padding: 32px 44px 80px; }
body.export #doc { padding: 0; max-width: none; }
h1,h2,h3,h4 { line-height:1.25; margin: 1.4em 0 .5em; }
h1 { font-size: 2em; border-bottom: 1px solid var(--border); padding-bottom: .3em; }
h2 { font-size: 1.45em; border-bottom: 1px solid var(--border); padding-bottom: .25em; }
a { color: var(--accent); }
code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--subtle); padding: .15em .35em; border-radius: 5px; }
pre { background: var(--subtle); padding: 14px 16px; border-radius: 8px; overflow:auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 0; padding: 0 1em; color: var(--muted); border-left: 3px solid var(--border); }
table { border-collapse: collapse; margin: 1em 0; display:block; overflow:auto; }
th, td { border: 1px solid var(--border); padding: 6px 12px; text-align:left; }
th { background: var(--subtle); }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
.diagram { margin: 1.2em 0; padding: 12px; border: 1px solid var(--border); border-radius: 10px; text-align:center; overflow:auto; background: var(--bg); }
.diagram img, .diagram svg { max-width: 100%; max-height: 560px; height: auto; }
.diagram img[src^="data:image/svg"] { width: auto; }
body.export .diagram { border: 0; padding: 0; page-break-inside: avoid; overflow: visible; }
body.export table { display: table; width: 100%; table-layout: auto; font-size: 11.5px; }
body.export th, body.export td { overflow-wrap: break-word; padding: 4px 7px; }
body.export tr { page-break-inside: avoid; }
.mxgraph { margin: 0 auto; }
.err { color:#d1242f; font: 12px ui-monospace, monospace; white-space: pre-wrap; text-align:left; }
li input[type=checkbox] { margin-right: .4em; }
@media print { #doc { padding: 0; } h1, h2, h3 { page-break-after: avoid; } }
`;

/** Letter pages with the Mac app's margins (48pt top/bottom, 54pt sides): 504pt ≈ 672 CSS px wide. */
export const PRINT_CSS = `
@page { size: 8.5in 11in; margin: 48pt 54pt; }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

const SCRIPT = String.raw`
let n = 0;
const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function sparRender(md, dark, exp) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.body.classList.toggle('export', !!exp);
  const el = document.getElementById('doc');
  el.innerHTML = marked.parse(md, { gfm: true });
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict',
                       htmlLabels: !exp, flowchart: { htmlLabels: !exp } });
  for (const c of [...el.querySelectorAll('pre > code.language-mermaid')]) {
    const d = document.createElement('div'); d.className = 'diagram';
    try { d.innerHTML = (await mermaid.render('mm' + (n++), c.textContent)).svg; }
    catch (e) { d.innerHTML = '<div class="err">' + esc(e.message || e) + '</div>'; }
    c.parentElement.replaceWith(d);
  }
  if (el.querySelector('.mxgraph') && window.GraphViewer) {
    for (const g of el.querySelectorAll('.mxgraph')) {
      const cfg = JSON.parse(g.getAttribute('data-mxgraph'));
      cfg.toolbar = exp ? '' : 'zoom layers lightbox'; cfg['dark-mode'] = dark ? 'dark' : 'light';
      g.setAttribute('data-mxgraph', JSON.stringify(cfg));
      // Lay the diagram out at its natural size first; it is shrunk to fit afterwards.
      g.style.width = '4000px'; g.style.maxWidth = 'none';
      g.parentElement.style.overflow = 'hidden';
    }
    GraphViewer.processElements();
    await new Promise(r => setTimeout(r, 600));
    for (const g of el.querySelectorAll('.mxgraph')) {
      const svg = g.querySelector('svg'); if (!svg) { g.style.width = ''; continue; }
      let w = 0; try { const b = svg.getBBox(); w = Math.ceil(b.x + b.width + 40); } catch (_) {}
      const avail = g.parentElement.clientWidth - 8;
      if (!w) { g.style.width = ''; continue; }
      g.style.width = w + 'px';
      if (w > avail && avail > 0) g.style.zoom = (avail / w).toFixed(3);
    }
  }
  return document.body.scrollHeight;
}

// ---- Export helpers --------------------------------------------------------------------

async function toDataURL(url) {
  const r = await fetch(url); const b = await r.blob();
  return await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(url); f.readAsDataURL(b); });
}

/** Inlines images the draw.io viewer references by URL, so the page stands alone. */
async function sparInlineImages() {
  for (const im of [...document.querySelectorAll('#doc svg image')]) {
    const href = im.getAttribute('href') || im.getAttribute('xlink:href');
    if (!href || href.startsWith('data:')) continue;
    try { const d = await toDataURL(new URL(href, document.baseURI).href); im.setAttribute('href', d); im.removeAttribute('xlink:href'); } catch (_) {}
  }
  for (const im of [...document.querySelectorAll('#doc img')]) {
    const src = im.getAttribute('src');
    if (!src || src.startsWith('data:')) continue;
    try { im.setAttribute('src', await toDataURL(new URL(src, document.baseURI).href)); } catch (_) {}
  }
}

/** The finished page, standing alone (for printing to PDF). */
function sparExportHTML(title, extraCss) {
  return '<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
    [...document.querySelectorAll('head style')].map(s => s.textContent).join('\n') + extraCss + '</style></head><body class="export"><div id="doc">' +
    document.getElementById('doc').innerHTML + '</div></body></html>';
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = src; });
}

/** SVG labels drawn as HTML (foreignObject) taint a canvas in WebKit: use their text fallback. */
function withoutForeignObjects(svg) {
  for (const sw of [...svg.querySelectorAll('switch')]) {
    const fo = sw.querySelector(':scope > foreignObject');
    if (!fo) continue;
    const alt = [...sw.children].find(c => c.tagName.toLowerCase() !== 'foreignobject');
    if (alt) sw.replaceWith(alt); else sw.remove();
  }
  for (const fo of [...svg.querySelectorAll('foreignObject')]) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', fo.getAttribute('x') || 0); t.setAttribute('y', (+fo.getAttribute('y') || 0) + 12);
    t.setAttribute('font-size', '12'); t.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
    t.textContent = fo.textContent.trim(); fo.replaceWith(t);
  }
  return svg;
}

async function rasterize(src, w, h) {
  const img = await loadImage(src);
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

function svgSource(svg, w, h, strip) {
  let clone = svg.cloneNode(true);
  if (strip) clone = withoutForeignObjects(clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', w); clone.setAttribute('height', h);
  clone.style.maxWidth = ''; clone.style.maxHeight = ''; clone.style.width = w + 'px'; clone.style.height = h + 'px'; clone.style.minWidth = ''; clone.style.minHeight = '';
  const text = new XMLSerializer().serializeToString(clone);
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
}

/** Each diagram as a PNG (Word can't draw SVG labels): [base64, width] per .diagram. */
async function sparDiagramImages() {
  const out = [];
  for (const d of [...document.querySelectorAll('#doc .diagram')]) {
    const r = d.getBoundingClientRect();
    try {
      const svg = d.querySelector('svg');
      const img = d.querySelector('img');
      let png;
      if (svg) {
        const b = svg.getBoundingClientRect();
        const g = svg.closest('.mxgraph');
        // draw.io: the SVG keeps its natural size and the container is zoomed to fit.
        const zoom = g ? (parseFloat(g.style.zoom) || 1) : 1;
        let nw = b.width, nh = b.height;
        if (g) { try { const bb = svg.getBBox(); nw = Math.ceil(bb.x + bb.width + 20); nh = Math.ceil(bb.y + bb.height + 20); } catch (_) {} }
        const w = nw * zoom, h = nh * zoom;
        try { png = await rasterize(svgSource(svg, nw, nh, false), w, h); }
        catch (_) { png = await rasterize(svgSource(svg, nw, nh, true), w, h); }
        out.push([png.split(',')[1], Math.round(w)]);
      } else if (img) {
        const b = img.getBoundingClientRect();
        png = img.src.startsWith('data:image/png') ? img.src : await rasterize(img.src, b.width, b.height);
        out.push([png.split(',')[1], Math.round(b.width)]);
      } else out.push(null);
    } catch (e) { out.push(null); }
  }
  return out;
}

function sparReplaceDiagrams(pngs) {
  [...document.querySelectorAll('#doc .diagram')].forEach((d, i) => {
    if (pngs[i]) d.innerHTML = '<img width="' + pngs[i][1] + '" src="data:image/png;base64,' + pngs[i][0] + '">';
  });
  return document.getElementById('doc').innerHTML;
}

document.addEventListener('click', e => {
  const a = e.target.closest('a'); if (!a) return;
  const href = a.getAttribute('href') || '';
  if (a.closest('.mxgraph') && !href) return;
  e.preventDefault(); parent.postMessage({ sparDocLink: href }, '*');
});
`;

/** The page's HTML, for an iframe's srcdoc. */
export function pageHTML(): string {
  const origin = location.origin;
  const drawio = origin + "/drawio";
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${origin}/">
<script>window.DRAWIO_BASE_URL = ${JSON.stringify(drawio)}; window.DRAWIO_LIGHTBOX_URL = window.DRAWIO_BASE_URL;</script>
<script src="${new URL(markedUrl, origin).href}"></script>
<script src="${new URL(mermaidUrl, origin).href}"></script>
<script src="${drawio}/js/viewer-static.min.js"></script>
<style id="spar-css">${PAGE_CSS}</style></head>
<body><div id="doc"></div><script>${SCRIPT}</script></body></html>`;
}

/** The functions the page exposes on its window. */
export interface DocPage extends Window {
  sparRender(md: string, dark: boolean, exp: boolean): Promise<number>;
  sparInlineImages(): Promise<void>;
  sparExportHTML(title: string, extraCss: string): string;
  sparDiagramImages(): Promise<([string, number] | null)[]>;
  sparReplaceDiagrams(pngs: ([string, number] | null)[]): string;
}

/** Waits for an iframe (just given its srcdoc) to load its scripts. */
export function whenLoaded(frame: HTMLIFrameElement): Promise<DocPage> {
  return new Promise((resolve) => {
    const done = () => {
      const w = frame.contentWindow as DocPage | null;
      if (w && typeof w.sparRender === "function" && w.document.readyState === "complete") resolve(w);
      else setTimeout(done, 50);
    };
    frame.addEventListener("load", done, { once: true });
  });
}
