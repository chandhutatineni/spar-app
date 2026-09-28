// Sheets from the agent picker and Settings: SPAR vs Claude Code (AgentInfo.swift), GitHub
// Copilot setup (CopilotSetup.swift), IBM Bob's key (BobKeySheet.swift) and agents on your own
// models (CustomAgentSheet.swift).

import { useEffect, useState, type ReactNode } from "react";
import { Check, MessagesSquare, RefreshCcw, ListChecks, RotateCw, TriangleAlert } from "lucide-react";
import { Button, Sheet, Spinner } from "../../ui";
import { secrets } from "../../lib/api";
import { call } from "../../lib/backend";
import { useEngine } from "../../engine/engine";
import { AgentBadge, Markdown } from "./parts";
import { SFSymbol } from "../../ui/icons";
import { CustomAgents, PROVIDERS, SPAR_KIND, customKeychainKey, named, providerInfo, slug, type CustomAgent, type Provider } from "./catalog";

// ---- SPAR and Claude Code --------------------------------------------------------------

const ROWS: [string, string, string][] = [
  ["Engine", "The same Claude Code CLI: same tools, models, effort and approvals.", "The Claude Code CLI."],
  ["Who decides the next step", "SPAR, from the files on disk, the decision ledger and the check results. The agent can't skip steps.", "You. It does what you ask."],
  ["What you get", "Spec → plan → tasks → tested code → verification, kept in `spar/specs/<feature>/`.", "Code changes and answers."],
  ["Specialists", "SPAR subagents: specifier, clarifier, architect, task planner, task executor, critic, verifier, threat modeler and more.", "One general-purpose agent (it can still use subagents you add)."],
  ["Human review", "Three gates (spec, plan, checkpoint), written to a hash-chained ledger. An approval goes stale when the artifact changes.", "None built in; you review the diffs."],
  ["Governance", "Tenets, standards and references; deterministic checks; a traceability matrix from requirement to test.", "CLAUDE.md and project rules."],
  ["Best for", "Features that need agreement, an audit trail, or several people: anything you'd write a ticket for.", "Quick fixes, questions, exploring code, one-off scripts."],
];

export function AgentInfoSheet({ onClose }: { onClose: () => void }) {
  const claude = named("claude-native-ui");
  return (
    <Sheet onClose={onClose} width={740} label="SPAR and Claude Code">
      <div className="col chat-sheet" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <AgentBadge kind={SPAR_KIND} size={30} />
          <span className="muted">vs</span>
          <AgentBadge kind={claude} size={30} />
          <div className="col" style={{ gap: 0 }}>
            <span className="title2">SPAR and Claude Code</span>
            <span className="muted">Same engine. SPAR adds the process around it.</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 220px", gap: "10px 16px", fontSize: 12 }}>
          <span />
          <span className="headline" style={{ color: "var(--accent)" }}>SPAR</span>
          <span className="headline" style={{ color: claude.tint }}>Claude Code</span>
          <div className="hr" style={{ gridColumn: "1 / 4", margin: 0 }} />
          {ROWS.map(([a, b, c]) => (
            <div key={a} style={{ display: "contents" }}>
              <span style={{ fontWeight: 600 }}>{a}</span>
              <Markdown text={b} />
              <div className="muted"><Markdown text={c} /></div>
            </div>
          ))}
        </div>
        <div className="col muted" style={{ gap: 6, fontSize: 12 }}>
          <span className="row" style={{ gap: 6 }}><SFSymbol name="bubble.left.and.bubble.right" size={12} fallback={<MessagesSquare size={13} />} /> Each agent has its own conversation. Switching doesn't share context.</span>
          <span className="row" style={{ gap: 6 }}><SFSymbol name="arrow.triangle.2.circlepath" size={12} fallback={<RefreshCcw size={13} />} /> Continue, Refine and the approvals always use SPAR, so a side chat with Claude Code never disturbs the pipeline.</span>
          <span className="row" style={{ gap: 6 }}><SFSymbol name="checklist.checked" size={12} fallback={<ListChecks size={13} />} /> Changes from either agent show up in Review, Source Control and the Explorer the same way.</span>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}><Button kind="primary" autoFocus onClick={onClose}>Done</Button></div>
      </div>
    </Sheet>
  );
}

// ---- GitHub Copilot --------------------------------------------------------------------

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
      <span style={{ width: 24, height: 24, borderRadius: 12, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: done ? "var(--done)" : "var(--subtle)", color: done ? "#fff" : "var(--text-2)", fontSize: 11, fontWeight: 700 }}>
        {done ? <SFSymbol name="checkmark" size={11} weight="bold" fallback={<Check size={12} strokeWidth={3} />} /> : n}
      </span>
      <div className="col" style={{ gap: 8, flex: 1, minWidth: 0 }}>
        <span className="headline">{title}</span>
        {children}
      </div>
    </div>
  );
}

/** Three steps to use GitHub Copilot: install the engine's Copilot support, give it a
 *  GitHub token, restart the engine. */
export function CopilotSetup({ onClose }: { onClose: () => void }) {
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState("");
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  const [account, setAccount] = useState(false);
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    call<boolean>("engine_copilot_installed").then(setInstalled).catch(() => {});
    Promise.all([secrets.get("github-copilot"), secrets.get("github-token")]).then(([c, g]) => { setSaved(!!c || !!g); setAccount(!c && !!g); }).catch(() => {});
  }, []);
  const install = async () => {
    setInstalling(true);
    const r = await call<{ ok: boolean; log: string }>("engine_copilot_install").catch((e) => ({ ok: false, log: String(e) }));
    setInstalling(false);
    setInstalled(await call<boolean>("engine_copilot_installed").catch(() => false));
    setLog(r.ok ? "Installed." : r.log.split("\n").slice(-4).join("\n"));
  };
  return (
    <Sheet onClose={onClose} width={520} label="Set up GitHub Copilot">
      <div className="col chat-sheet" style={{ gap: 18 }}>
        <div className="row" style={{ gap: 12 }}>
          <AgentBadge kind={named("copilot")} size={36} />
          <div className="col" style={{ gap: 2 }}>
            <span className="title2">Set up GitHub Copilot</span>
            <span className="muted">Runs through SPAR's agent engine.</span>
          </div>
        </div>
        <Step n={1} title="Install Copilot support" done={installed}>
          <span className="muted" style={{ fontSize: 12 }}>Adds GitHub Copilot support to the agent engine (about 90 MB, includes the Copilot CLI).</span>
          {installing ? <span className="row muted" style={{ gap: 6 }}><Spinner small /> Installing…</span> : !installed && <div><Button onClick={install}>Install</Button></div>}
          {log && <pre className="mono muted selectable" style={{ fontSize: 11.5, margin: 0, whiteSpace: "pre-wrap" }}>{log}</pre>}
        </Step>
        <Step n={2} title={account ? "Use your GitHub account" : "Add a GitHub token"} done={saved}>
          {account && <span className="muted" style={{ fontSize: 12 }}>Copilot will use the token of your connected GitHub account. It needs the “Copilot Requests” permission; paste a different token below only if it doesn't have it.</span>}
          <span className="muted" style={{ fontSize: 12 }}>A fine-grained personal access token with the “Copilot Requests” permission, or the output of <code>gh auth token</code>. Classic ghp_ tokens are not accepted. It is stored privately on this computer.</span>
          <div className="row">
            <input className="text-field" type="password" placeholder={saved ? "Token saved — paste a new one to replace it" : "github_pat_…"} value={token} onChange={(e) => setToken(e.target.value)} />
            <Button disabled={!token.trim()} onClick={async () => { await secrets.set("github-copilot", token.trim()); setToken(""); setSaved(true); setAccount(false); }}>Save</Button>
          </div>
        </Step>
        <Step n={3} title="Restart the engine" done={false}>
          <span className="muted" style={{ fontSize: 12 }}>Loads Copilot support and the token. Open chats reconnect on their own.</span>
          <div>
            <Button kind="primary" disabled={!installed || !saved || restarting} onClick={async () => { setRestarting(true); await useEngine.getState().restart(); setRestarting(false); onClose(); }}>
              {restarting ? <Spinner small /> : "Restart and finish"}
            </Button>
          </div>
        </Step>
        <div className="row" style={{ justifyContent: "flex-end" }}><Button onClick={onClose}>Close</Button></div>
      </div>
    </Sheet>
  );
}

// ---- IBM Bob ---------------------------------------------------------------------------

/** IBM Bob authenticates with an API key, kept privately and handed to `bob` as BOB_API_KEY. */
export function BobKeySheet({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { secrets.get("bob-api-key").then((k) => setSaved(!!k)).catch(() => {}); }, []);
  return (
    <Sheet onClose={onClose} width={480} label="IBM Bob API key">
      <div className="col chat-sheet" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 10 }}>
          <AgentBadge kind={named("bob")} size={32} />
          <div className="col" style={{ gap: 0 }}>
            <span className="title2">IBM Bob API key</span>
            <span className="muted">Used by IBM Bob and SPAR · IBM Bob.</span>
          </div>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Paste the API key from your IBM Bob account. It's stored privately on this computer and passed to the bob CLI as BOB_API_KEY. If you signed in with <code>bob</code> in a terminal, you may not need one.</span>
        <input className="text-field" type="password" autoFocus placeholder={saved ? "A key is saved; paste a new one to replace it" : "Bob API key"} value={key} onChange={(e) => setKey(e.target.value)} />
        <div className="row">
          {saved && <Button kind="danger" onClick={async () => { await secrets.set("bob-api-key", null); onClose(); }}>Remove key</Button>}
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!key.trim()} onClick={async () => { await secrets.set("bob-api-key", key.trim()); onClose(); }}>Save</Button>
        </div>
      </div>
    </Sheet>
  );
}

// ---- Agents on your own models ---------------------------------------------------------

const HINT: Record<Provider, string> = {
  ollama: "Couldn't reach Ollama. Start it (ollama serve) and pull a model: ollama pull qwen2.5-coder:14b",
  lmstudio: "Couldn't reach LM Studio. Load a model and start the server (Developer tab, or lms server start).",
  openai: "Couldn't list models at this URL. Check the address (it usually ends in /v1) and the API key, or type the model id.",
};

/** Adds an agent that runs on a model you host. It gets file and shell tools and works in
 *  both spec-driven and vibe mode. The engine loads agents at start, so it restarts. */
export function CustomAgentSheet({ onClose, editing }: { onClose: () => void; editing?: CustomAgent }) {
  const [provider, setProvider] = useState<Provider>(editing?.provider ?? "ollama");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [baseURL, setBaseURL] = useState(editing?.baseURL ?? providerInfo("ollama").defaultURL);
  const [model, setModel] = useState(editing?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [probing, setProbing] = useState(false);
  const [probeFailed, setProbeFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const probe = async (url = baseURL, key = apiKey) => {
    setProbing(true);
    const found: string[] = await call<string[]>("engine_probe_models", { base_url: url, api_key: key }).catch(() => [] as string[]);
    setProbing(false);
    setModels(found);
    setProbeFailed(!found.length);
    if (found.length && !found.includes(model)) setModel(found.find((m) => m.toLowerCase().includes("qwen")) ?? found[0]);
  };
  useEffect(() => {
    (async () => {
      let key = "";
      if (editing) { key = (await secrets.get(customKeychainKey(editing)).catch(() => null)) ?? ""; setApiKey(key); }
      probe(baseURL, key);
    })();
  }, []);

  const defaultTitle = model.split(":")[0] || "Local model";
  const restartAndClose = async () => {
    setSaving(true);
    await useEngine.getState().restart();
    setSaving(false);
    onClose();
  };
  const save = async () => {
    setSaving(true);
    const name = title.trim() || defaultTitle;
    let id = editing?.id ?? slug(name);
    if (!editing && CustomAgents.load().some((a) => a.id === id)) id += `-${100 + Math.floor(Math.random() * 900)}`;
    await CustomAgents.upsert({ id: id || "agent", title: name, provider, baseURL: baseURL.trim(), model: model.trim() }, provider === "openai" ? apiKey : "");
    await restartAndClose();
  };

  return (
    <Sheet onClose={onClose} width={540} label="Add an agent on your own model">
      <div className="col chat-sheet" style={{ gap: 16 }}>
        <div className="col" style={{ gap: 4 }}>
          <span className="title2" style={{ fontWeight: 700 }}>{editing ? `Edit ${editing.title}` : "Add an agent on your own model"}</span>
          <span className="muted">Run Qwen, Llama, DeepSeek, Granite or any other model locally or on your own server. SPAR gives it file and shell tools, and it follows the same spec-driven workflow as the other agents.</span>
        </div>
        <div className="card col" style={{ gap: 10 }}>
          <label className="row"><span style={{ width: 150 }}>Runs on</span>
            <select className="text-field" value={provider} onChange={(e) => {
              const p = e.target.value as Provider;
              const url = !baseURL || baseURL === providerInfo(provider).defaultURL ? providerInfo(p).defaultURL : baseURL;
              setProvider(p); setBaseURL(url); probe(url);
            }}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label className="row"><span style={{ width: 150 }}>Server URL</span>
            <input className="text-field" value={baseURL} placeholder={providerInfo(provider).defaultURL} onChange={(e) => setBaseURL(e.target.value)} onKeyDown={(e) => e.key === "Enter" && probe()} />
          </label>
          {provider === "openai" && (
            <label className="row"><span style={{ width: 150 }}>API key (optional)</span>
              <input className="text-field" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </label>
          )}
          <label className="row"><span style={{ width: 150 }}>Model</span>
            {models.length ? (
              <select className="text-field" value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option key={m}>{m}</option>)}</select>
            ) : (
              <input className="text-field" value={model} placeholder={provider === "ollama" ? "qwen2.5-coder:14b" : "model id"} onChange={(e) => setModel(e.target.value)} />
            )}
            <button className="icon-btn" title="Load the models this server has" onClick={() => probe()}>{probing ? <Spinner small /> : <SFSymbol name="arrow.clockwise" size={13} fallback={<RotateCw size={13} />} />}</button>
          </label>
          <label className="row"><span style={{ width: 150 }}>Name in the agent picker</span>
            <input className="text-field" value={title} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>
        {probeFailed && <span className="row" style={{ gap: 6, color: "var(--warn)", fontSize: 12, alignItems: "flex-start" }}><SFSymbol name="exclamationmark.triangle" size={12} style={{ flex: "none", marginTop: 1 }} fallback={<TriangleAlert size={14} style={{ flex: "none" }} />} />{HINT[provider]}</span>}
        <span className="t-caption muted">Tip: pick a model trained for tool use (for example qwen2.5-coder or qwen3). Small models often ignore tools.</span>
        <div className="row">
          {editing && <Button kind="danger" onClick={async () => { await CustomAgents.remove(editing); await restartAndClose(); }}>Remove</Button>}
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!model.trim() || !baseURL || saving} onClick={save}>{saving ? <Spinner small /> : editing ? "Save" : "Add agent"}</Button>
        </div>
      </div>
    </Sheet>
  );
}
