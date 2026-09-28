// Pick an engine and a name; the file goes in docs/diagrams and opens (MainView.swift: NewDiagramSheet).

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { SFSymbol } from "../../ui/icons";
import { fs, joinPath } from "../../lib/api";
import { useWorkspace } from "../../state/workspace";
import { Button, Sheet } from "../../ui";
import { ENGINE_INFO, ENGINES, forArchitecture, forOther, slugify, template, type DiagramEngine } from "./engines";
import { EngineIcon } from "./DiagramDocument";


const Tag = ({ t }: { t: string }) => (
  <span style={{ fontSize: 8.5, fontWeight: 700, color: "var(--text-2)", padding: "1px 4px", background: "var(--subtle)", borderRadius: 999, letterSpacing: 0.2 }}>{t.toUpperCase()}</span>
);

export function NewDiagramSheet({ onClose }: { onClose: () => void }) {
  const [engine, setEngine] = useState<DiagramEngine>(forArchitecture());
  const [name, setName] = useState("architecture");
  const slug = slugify(name);
  const arch = forArchitecture(), other = forOther();

  const create = async () => {
    if (!slug) return;
    const root = useWorkspace.getState().root;
    const dir = joinPath(root, "docs/diagrams");
    await fs.mkdir(dir);
    const file = joinPath(dir, `${slug}.${ENGINE_INFO[engine].ext}`);
    if (!(await fs.exists(file))) await fs.writeText(file, template(engine, name));
    useWorkspace.setState((s) => ({ fileTreeVersion: s.fileTreeVersion + 1 }));
    useWorkspace.getState().openFile(file);
    onClose();
  };

  return (
    <Sheet onClose={onClose} width={520} label="New diagram">
      <div className="col" style={{ gap: 14 }}>
        <div className="sheet-title" style={{ marginBottom: 0 }}>New diagram</div>
        <>
          {ENGINES.map((e) => {
            return (
              <button key={e} type="button" role="radio" aria-checked={engine === e} onClick={() => setEngine(e)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, border: 0, borderRadius: 8, textAlign: "left", color: "inherit", background: engine === e ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent" }}>
                <span style={{ width: 22, display: "flex", justifyContent: "center", color: "var(--accent)" }}><EngineIcon engine={e} /></span>
                <span style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{ENGINE_INFO[e].title}</span>
                    {e === arch && <Tag t="architecture default" />}
                    {e === other && <Tag t="default" />}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-2)" }}>{ENGINE_INFO[e].detail}</span>
                </span>
                {engine === e && <span style={{ color: "var(--accent)", display: "inline-flex" }}><SFSymbol name="checkmark.circle.fill" size={13} fallback={<CheckCircle2 size={16} />} /></span>}
              </button>
            );
          })}
        </>
        <input className="text-field" aria-label="Name" placeholder="Name" value={name} autoFocus
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
        <div className="row">
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-2)" }}>docs/diagrams/{slug}.{ENGINE_INFO[engine].ext}</span>
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!slug} onClick={() => void create()}>Create</Button>
        </div>
      </div>
    </Sheet>
  );
}
