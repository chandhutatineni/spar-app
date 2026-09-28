// Diagram-as-code engines the app renders (Backend/Diagrams.swift: DiagramEngine).

import { fs, joinPath } from "../../lib/api";
import { prefs } from "../../lib/prefs";

export type DiagramEngine = "pythonDiagrams" | "drawio" | "d2" | "mermaid" | "c4PlantUML";

export const ENGINES: DiagramEngine[] = ["pythonDiagrams", "drawio", "d2", "mermaid", "c4PlantUML"];

export const ENGINE_INFO: Record<DiagramEngine, { title: string; detail: string; ext: string; configName: string }> = {
  pythonDiagrams: { title: "Python diagrams", detail: "Architecture as Python code with official AWS, Azure, GCP and Kubernetes icons.", ext: "py", configName: "python-diagrams" },
  drawio: { title: "draw.io", detail: "Pixel-precise diagrams with cloud shape libraries; edit visually, stored as .drawio.", ext: "drawio", configName: "drawio" },
  d2: { title: "D2", detail: "Modern declarative diagrams with ELK layout, themes and nested containers.", ext: "d2", configName: "d2" },
  mermaid: { title: "Mermaid", detail: "Flowcharts, sequence, class, state and ER diagrams in plain text.", ext: "mmd", configName: "mermaid" },
  c4PlantUML: { title: "C4-PlantUML", detail: "The C4 model (context, container, component) in PlantUML.", ext: "puml", configName: "c4-plantuml" },
};

/** Which engine a file is written for, if any. `.py` needs its text (a `diagrams` import). */
export function detectEngine(path: string, text?: string): DiagramEngine | null {
  const l = path.toLowerCase();
  if (l.endsWith(".drawio") || l.endsWith(".drawio.svg") || l.endsWith(".drawio.png") || l.endsWith(".dio")) return "drawio";
  if (l.endsWith(".d2")) return "d2";
  if (l.endsWith(".mmd") || l.endsWith(".mermaid")) return "mermaid";
  if ([".puml", ".plantuml", ".iuml", ".wsd"].some((e) => l.endsWith(e))) return "c4PlantUML";
  if (l.endsWith(".py")) {
    const t = text ?? pyCache.get(path);
    if (t === undefined) return null;
    return typeof t === "boolean" ? (t ? "pythonDiagrams" : null) : isDiagramsScript(t) ? "pythonDiagrams" : null;
  }
  return null;
}

const isDiagramsScript = (t: string) => t.includes("from diagrams") || t.includes("import diagrams");
const pyCache = new Map<string, boolean>();

/** detectEngine that reads a `.py` file when needed (and remembers the answer for canPreview). */
export async function detectEngineAsync(path: string): Promise<DiagramEngine | null> {
  if (path.toLowerCase().endsWith(".py")) {
    const text = await fs.readText(path).catch(() => "");
    pyCache.set(path, isDiagramsScript(text));
  }
  return detectEngine(path);
}

/** Chosen in Settings › Diagrams (same keys as the Mac app). */
export const forArchitecture = (): DiagramEngine => valid(prefs.get<string>("diagramArchitecture", "pythonDiagrams"), "pythonDiagrams");
export const forOther = (): DiagramEngine => valid(prefs.get<string>("diagramOther", "drawio"), "drawio");
const valid = (v: string, d: DiagramEngine): DiagramEngine => (ENGINES.includes(v as DiagramEngine) ? (v as DiagramEngine) : d);

const SPAR_MARKERS = ["specs", "tenets.md", "standards.md", "manifest.json", "decisions.jsonl", "briefs"];

/** Spar.dir: `spar/`, or the legacy `.spar/`. */
async function sparDir(root: string): Promise<string> {
  for (const m of SPAR_MARKERS) if (await fs.exists(joinPath(root, "spar", m))) return joinPath(root, "spar");
  return (await fs.exists(joinPath(root, ".spar"))) ? joinPath(root, ".spar") : joinPath(root, "spar");
}

/** Records the chosen tools in the project's spar/config.json, which SPAR's diagram playbook
 *  reads. Only SPAR projects, and only when it changes. */
export async function syncConfig(root: string) {
  if (!root) return;
  const dir = await sparDir(root);
  let isWorkspace = false;
  for (const m of SPAR_MARKERS) if (await fs.exists(joinPath(dir, m))) { isWorkspace = true; break; }
  if (!isWorkspace) return;
  const file = joinPath(dir, "config.json");
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(await fs.readText(file)); } catch { /* missing or unreadable: start fresh */ }
  if (typeof config !== "object" || config === null || Array.isArray(config)) config = {};
  const wanted = { architecture: ENGINE_INFO[forArchitecture()].configName, other: ENGINE_INFO[forOther()].configName };
  const cur = config.diagrams as Record<string, string> | undefined;
  if (cur && Object.keys(cur).length === 2 && cur.architecture === wanted.architecture && cur.other === wanted.other) return;
  config.diagrams = wanted;
  await fs.writeText(file, JSON.stringify(sortKeys(config), null, 2) + "\n");
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

export function template(engine: DiagramEngine, name: string): string {
  switch (engine) {
    case "pythonDiagrams":
      return `from diagrams import Cluster, Diagram
from diagrams.aws.compute import ECS
from diagrams.aws.database import RDS
from diagrams.aws.network import ELB

with Diagram("${name}", show=False, outformat="png"):
    lb = ELB("load balancer")
    with Cluster("Services"):
        services = [ECS("api"), ECS("worker")]
    lb >> services >> RDS("database")`;
    case "drawio":
      return `<mxfile host="SPAR"><diagram name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;
    case "d2":
      return `direction: right
user: User {shape: person}
app: App
db: Database {shape: cylinder}
user -> app: uses
app -> db: reads and writes`;
    case "mermaid":
      return `flowchart LR
  user([User]) --> app[App]
  app --> db[(Database)]`;
    case "c4PlantUML":
      return `@startuml
!include <C4/C4_Container>
title ${name}
Person(user, "User")
System_Boundary(sys, "System") {
  Container(app, "App", "Web", "Serves the UI")
  ContainerDb(db, "Database", "PostgreSQL", "Stores data")
}
Rel(user, app, "Uses")
Rel(app, db, "Reads and writes")
@enduml`;
  }
}

/** The file name for a diagram name (NewDiagramSheet.slug). */
export const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
