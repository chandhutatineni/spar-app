// Project rules (RulesView.swift): spar/rules/*.md, the instruction files agents read
// natively, and SPAR's governance.

import { useEffect, useState, type ReactNode } from "react";
import { FileText, ListChecks, Plus } from "lucide-react";
import { dirname, fs, joinPath } from "../../lib/api";
import { useWorkspace } from "../../state/workspace";
import { Button } from "../../ui";
import { SFSymbol } from "../../ui/icons";
import "./editor.css";
import { createRule, governanceFiles, instructionFiles, loadRules, ruleName, saveRule, type ProjectRule } from "./rules";

export function RulesView() {
  const root = useWorkspace((s) => s.root);
  const version = useWorkspace((s) => s.fileTreeVersion);
  const [rules, setRules] = useState<ProjectRule[]>([]);
  const [gov, setGov] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const reload = () => loadRules(root).then(setRules);

  useEffect(() => { void reload(); governanceFiles(root).then(setGov); }, [root, version]);

  const create = async () => {
    const path = await createRule(root, newName);
    if (!path) return;
    setNewName(""); setAdding(false);
    await reload();
    useWorkspace.getState().open({ kind: "file", path });
  };

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div className="col" style={{ gap: 26, padding: 40, maxWidth: 880, margin: "0 auto" }}>
        <div className="col" style={{ gap: 6 }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>Rules</div>
          <div className="muted" style={{ fontSize: 15 }}>
            Standards the agent follows in this project. "Always" rules go with every new chat; the rest apply when a file you mention or change matches their patterns.
          </div>
        </div>

        <Section title="Project rules" subtitle="spar/rules" hug={rules.length === 0 && !adding}>
          {rules.length === 0 && !adding && <div className="muted" style={{ padding: "4px 0" }}>No rules yet.</div>}
          {rules.map((r) => <RuleRow key={r.path} rule={r} onChange={reload} />)}
          {adding ? (
            <div className="row">
              <input autoFocus className="text-field" placeholder={'Rule name, e.g. "API error handling"'} value={newName}
                onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") { setAdding(false); setNewName(""); } }} />
              <Button onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>
              <Button kind="primary" disabled={!newName.trim()} onClick={() => void create()}>Create</Button>
            </div>
          ) : (
            <div><Button icon={<SFSymbol name="plus" size={12} fallback={<Plus size={13} />} />} onClick={() => setAdding(true)}>New rule</Button></div>
          )}
        </Section>

        <Section title="Agent instructions" subtitle="Read by the agents themselves">
          {instructionFiles.map((f) => <FileRow key={f} rel={f} version={version} />)}
        </Section>

        <Section title="SPAR governance" subtitle="Tenets, standards and references the pipeline enforces">
          {gov.map((f) => <FileRow key={f} rel={f} version={version} />)}
        </Section>
      </div>
    </div>
  );
}

// A SwiftUI card sizes to its content; rows with a Spacer make it full width. `hug` is the
// case with no such rows (the empty rules list).
function Section({ title, subtitle, children, hug }: { title: string; subtitle: string; children: ReactNode; hug?: boolean }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      <div>
        <div className="headline">{title}</div>
        <div style={{ fontSize: 10, color: "var(--text-2)", marginTop: 2 }}>{subtitle}</div>
      </div>
      <div className="card col" style={{ padding: 14, gap: 8, alignSelf: hug ? "flex-start" : undefined }}>{children}</div>
    </div>
  );
}

function FileRow({ rel, version }: { rel: string; version: number }) {
  const root = useWorkspace((s) => s.root);
  const path = joinPath(root, rel);
  const [exists, setExists] = useState<boolean | null>(null);
  useEffect(() => { fs.exists(path).then(setExists); }, [path, version]);
  const open = () => useWorkspace.getState().open({ kind: "file", path });
  return (
    <div className="row">
      <span className="muted" style={{ display: "inline-flex" }}><SFSymbol name="doc.text" size={13} fallback={<FileText size={13} />} /></span>
      <span className="mono" style={{ fontSize: 12 }}>{rel}</span>
      <span className="spacer" />
      {exists === true && <Button size="small" onClick={open}>Open</Button>}
      {exists === false && (
        <>
          <span className="faint" style={{ fontSize: 10 }}>Not created</span>
          {!rel.startsWith(".spar/") && !rel.startsWith("spar/") && (
            <Button size="small" onClick={async () => {
              await fs.mkdir(dirname(path)).catch(() => {});
              await fs.writeText(path, "# Instructions for coding agents\n\n");
              setExists(true);
              open();
            }}>Create</Button>
          )}
        </>
      )}
    </div>
  );
}

function RuleRow({ rule, onChange }: { rule: ProjectRule; onChange: () => void }) {
  const [globs, setGlobs] = useState(rule.globs.join(", "));
  useEffect(() => setGlobs(rule.globs.join(", ")), [rule.globs.join(",")]);
  const commitGlobs = async () => {
    const list = globs.split(",").map((g) => g.trim()).filter(Boolean);
    if (list.join(",") === rule.globs.join(",")) return;
    await saveRule({ ...rule, globs: list });
    onChange();
  };
  return (
    <div className="col" style={{ gap: 6, padding: "4px 0" }}>
      <div className="row" style={{ gap: 10 }}>
        <span style={{ display: "inline-flex", color: "var(--accent)" }}><SFSymbol name="checklist" size={13} fallback={<ListChecks size={15} />} /></span>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{ruleName(rule)}</span>
          {rule.description && <span style={{ fontSize: 10, color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rule.description}</span>}
        </div>
        <span className="spacer" />
        <label className="row" style={{ gap: 6 }}>
          <span>Always</span>
          <button type="button" role="switch" aria-checked={rule.alwaysApply} aria-label="Always" className={`switch ed-mini ${rule.alwaysApply ? "on" : ""}`}
            onClick={async () => { await saveRule({ ...rule, alwaysApply: !rule.alwaysApply }); onChange(); }} />
        </label>
        <Button size="small" onClick={() => useWorkspace.getState().open({ kind: "file", path: rule.path })}>Edit</Button>
      </div>
      {!rule.alwaysApply && (
        <div className="row" style={{ gap: 6, paddingLeft: 28 }}>
          <span style={{ fontSize: 10, color: "var(--text-2)", whiteSpace: "nowrap" }}>Applies to</span>
          <input className="text-field mono" style={{ fontSize: 10, height: 19, padding: "0 5px", borderRadius: 5 }} placeholder="e.g. src/api/**/*.ts, *.test.ts" aria-label={`Globs for ${ruleName(rule)}`}
            value={globs} onChange={(e) => setGlobs(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void commitGlobs()} onBlur={() => void commitGlobs()} />
        </div>
      )}
    </div>
  );
}
