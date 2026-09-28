// The Source Control page (SourceControlView.swift): branch, remote, pull/push, publish to
// GitHub, pull requests, commit, and the review of every change. History and remotes are
// extra tabs next to the review.

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, CloudUpload, GitBranch, GitPullRequest, Link, Plus, UserCheck, UserPlus, Wand2, ArrowRight, RotateCw, Trash2 } from "lucide-react";
import { Button, IconButton, Segmented, Sheet, Spinner, showMenu, type MenuEntry } from "../../ui";
import { app } from "../../lib/api";
import { usePref } from "../../lib/prefs";
import { confirm, promptText } from "../../lib/dialogs";
import { useWorkspace } from "../../state/workspace";
import { git, type Commit } from "./api";
import { Busy, StateLine, Sym } from "./common";
import { GitHubConnectSheet } from "./GitHubConnect";
import { useGitHubUser } from "./github";
import { ReviewView } from "./ReviewView";
import * as peers from "./peers";
import * as scm from "./store";

export function SourceControlView(_p: any) {
  const g = scm.useScm();
  const [sheet, setSheet] = useState<"connect" | "publish" | "pr" | null>(null);
  const [tab, setTab] = usePref<"changes" | "history" | "remotes">("sourceControlTab", "changes");
  useEffect(() => { scm.refresh(); }, []);
  useEffect(() => {
    const h = (e: Event) => setSheet((e as CustomEvent).detail);
    window.addEventListener("scm:sheet", h);
    return () => window.removeEventListener("scm:sheet", h);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }} aria-label="Source control">
      {g.isRepo === null ? <div className="empty"><Spinner /></div> : g.isRepo ? (
        <>
          <Header onSheet={setSheet} />
          <Hairline />
          <CommitBox onPublish={() => setSheet("publish")} />
          <Hairline />
          <div className="row" style={{ padding: "6px 20px", flex: "none" }}>
            <Segmented value={tab} onChange={setTab} options={[{ value: "changes", label: `Changes${g.changes.length ? ` (${g.changes.length})` : ""}` }, { value: "history", label: "History" }, { value: "remotes", label: "Remotes" }]} />
          </div>
          <Hairline />
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {tab === "changes" && <ReviewView embedded />}
            {tab === "history" && <History />}
            {tab === "remotes" && <Remotes />}
          </div>
        </>
      ) : <NotARepo />}
      {sheet === "connect" && <GitHubConnectSheet onClose={() => setSheet(null)} />}
      {sheet === "publish" && <PublishSheet onClose={() => setSheet(null)} />}
      {sheet === "pr" && <PullRequestSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

const Hairline = () => <div style={{ height: 0.5, background: "var(--hairline-strong)", flex: "none" }} />;

function NotARepo() {
  return (
    <div className="empty" style={{ gap: 14 }}>
      <span style={{ color: "var(--accent)", display: "inline-flex" }}><Sym n="arrow.triangle.branch" s={34} w="light" fb={<GitBranch size={34} strokeWidth={1.2} />} /></span>
      <div style={{ fontSize: 15, fontWeight: 600 }}>This project isn't a Git repository yet</div>
      <div className="muted">Create one to track changes, review the agent's edits, and push to GitHub.</div>
      <Button kind="primary" icon={<Sym n="plus" s={13} fb={<Plus size={13} />} />} onClick={scm.initialize}>Initialize repository</Button>
    </div>
  );
}

function Header({ onSheet }: { onSheet: (s: "connect" | "publish" | "pr") => void }) {
  const g = scm.useScm();
  const user = useGitHubUser();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const gh = scm.github();
  const busy = !!g.busy;

  const make = () => {
    const n = name.trim().replace(/ /g, "-");
    if (!n) return;
    setCreating(false);
    setName("");
    scm.createBranch(n);
  };
  const branchMenu = (): MenuEntry[] => [
    { section: "Switch branch" },
    ...g.branches.map((b) => ({ label: b, checked: b === g.branch, disabled: b === g.branch, onClick: () => scm.switchBranch(b) })),
    "divider",
    { label: "New branch…", onClick: () => setCreating(true) },
  ];

  return (
    <div className="col" style={{ gap: 10, padding: "12px 20px", flex: "none" }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="scm-menu" disabled={busy} style={{ fontSize: 12, fontWeight: 600 }} aria-label="Branch"
          onMouseDown={(e) => { e.stopPropagation(); showMenu(branchMenu(), e.currentTarget); }}>
          <Sym n="arrow.triangle.branch" s={12} fb={<GitBranch size={14} />} />{g.branch ?? "detached"}
          <span className="muted" style={{ display: "inline-flex" }}><Sym n="chevron.down" s={8} w="semibold" fb={<ChevronDown size={10} />} /></span>
        </button>
        {gh ? (
          <button type="button" className="scm-link" style={{ fontSize: 12 }} disabled={busy} onClick={() => app.open(`https://github.com/${gh.owner}/${gh.repo}`)}><Sym n="link" s={12} fb={<Link size={12} />} />{gh.owner}/{gh.repo}</button>
        ) : g.remoteUrl ? (
          <span className="mono muted" style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{g.remoteUrl}</span>
        ) : <span className="muted" style={{ fontSize: 12 }}>No remote</span>}
        <div className="spacer" />
        <Busy label={g.busy} />
        {g.remoteUrl ? (
          <>
            <Button icon={<Sym n="arrow.down" s={13} fb={<ArrowDown size={13} />} />} disabled={busy} onClick={scm.pull}>{g.behind > 0 ? `Pull ${g.behind}` : "Pull"}</Button>
            <Button kind="primary" icon={<Sym n="arrow.up" s={13} fb={<ArrowUp size={13} />} />} disabled={busy} onClick={scm.push}>{g.upstream == null ? "Push branch" : g.ahead > 0 ? `Push ${g.ahead}` : "Push"}</Button>
            {gh && <Button icon={<Sym n="arrow.triangle.pull" s={13} fb={<GitPullRequest size={13} />} />} disabled={busy || !user} onClick={() => onSheet("pr")}>Pull request</Button>}
          </>
        ) : (
          <Button kind="primary" icon={<Sym n="icloud.and.arrow.up" s={13} fb={<CloudUpload size={13} />} />} disabled={busy} onClick={() => onSheet(user ? "publish" : "connect")}>Publish to GitHub</Button>
        )}
      </div>
      <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
        {user ? (
          <span className="row muted" style={{ gap: 4, flex: "none", fontSize: 10 }}><Sym n="person.crop.circle.badge.checkmark" s={10} fb={<UserCheck size={12} />} />GitHub: {user.login}</span>
        ) : (
          <button type="button" className="scm-link" style={{ fontSize: 10, flex: "none" }} onClick={() => onSheet("connect")}><Sym n="person.crop.circle.badge.plus" s={10} fb={<UserPlus size={12} />} />Connect GitHub</button>
        )}
        <StateLine error={g.lastError} info={g.lastInfo} icons />
      </div>
      {creating && (
        <div className="row" style={{ gap: 6 }}>
          <input className="text-field" autoFocus placeholder="New branch name" value={name} aria-label="New branch name" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") make(); if (e.key === "Escape") setCreating(false); }} style={{ height: 22 }} />
          <Button size="small" onClick={() => setCreating(false)}>Cancel</Button>
          <Button size="small" kind="primary" disabled={!name.trim()} onClick={make}>Create</Button>
        </div>
      )}
    </div>
  );
}

function CommitBox({ onPublish }: { onPublish: () => void }) {
  const g = scm.useScm();
  const [message, setMessage] = useState("");
  const disabled = !message.trim() || g.changes.length === 0 || !!g.busy;
  const commit = async (push: boolean) => {
    if (await scm.commit(message)) {
      setMessage("");
      if (push) {
        if (!scm.useScm.getState().remoteUrl) onPublish(); else await scm.push();
      }
      await scm.loadReview();
    }
  };
  return (
    <div className="row" style={{ gap: 10, padding: "10px 20px", alignItems: "flex-start", flex: "none" }}>
      <textarea className="text-area" placeholder="Commit message" aria-label="Commit message" value={message} rows={Math.min(4, Math.max(1, message.split("\n").length))} style={{ resize: "none", padding: "4px 7px", lineHeight: "16px", minHeight: 26 }}
        onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !disabled) { e.preventDefault(); commit(false); } }} />
      <Button title="Suggest a message from the feature and the changed files" style={{ padding: "0 8px" }} onClick={() => setMessage(scm.suggestedMessage("page"))}><span aria-label="Suggest a message" style={{ display: "inline-flex" }}><Sym n="wand.and.stars" s={13} fb={<Wand2 size={14} />} /></span></Button>
      <Button disabled={disabled} onClick={() => commit(false)}>Commit</Button>
      <Button kind="primary" disabled={disabled} onClick={() => commit(true)}>Commit &amp; Push</Button>
    </div>
  );
}

function PublishSheet({ onClose }: { onClose: () => void }) {
  const g = scm.useScm();
  const user = useGitHubUser();
  const [name, setName] = useState(() => useWorkspace.getState().name);
  const [isPrivate, setPrivate] = useState(true);
  const [description, setDescription] = useState("");
  const [orgs, setOrgs] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  useEffect(() => { scm.organizations().then(setOrgs); }, []);
  return (
    <Sheet onClose={onClose} width={460} label="Publish to GitHub">
      <div className="col" style={{ gap: 14 }}>
        <div className="title2">Publish to GitHub</div>
        <div className="muted">Creates a repository under {owner || user?.login || "your account"} and pushes this project to it.</div>
        <div className="row">
          <span>Owner</span>
          <select className="text-field" aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{user?.login ?? "Your account"}</option>
            {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {orgs.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No organizations found. If you signed in with a token, give it access to the organization (fine-grained: set the organization as its resource owner; classic: add the read:org scope and authorize SSO).</div>}
        <input className="text-field" placeholder="Repository name" aria-label="Repository name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="text-field" placeholder="Description (optional)" aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="row"><span>Visibility</span><Segmented value={isPrivate ? "private" : "public"} onChange={(v) => setPrivate(v === "private")} options={[{ value: "private", label: "Private" }, { value: "public", label: "Public" }]} /></div>
        {g.lastError && <div style={{ color: "var(--stop)" }}>{g.lastError}</div>}
        <div className="sheet-footer" style={{ marginTop: 0 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!name.trim() || !!g.busy} onClick={async () => {
            const url = await scm.publish(name.trim(), isPrivate, description, owner || null);
            if (url) { app.open(url); onClose(); }
          }}>{g.busy ? <Spinner small /> : "Publish"}</Button>
        </div>
      </div>
    </Sheet>
  );
}

function PullRequestSheet({ onClose }: { onClose: () => void }) {
  const g = scm.useScm();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState("main");
  useEffect(() => {
    scm.defaultBranch().then(setBase);
    peers.ready().then(() => {
      const f = peers.feature();
      if (f) {
        const t = peers.featureTitle(f);
        setTitle(t);
        // SPAR already knows what this change is for: link the spec.
        setBody(`Implements **${t}**.\n\nSpec: \`spar/specs/${f}/spec.md\`\nPlan: \`spar/specs/${f}/plan.md\`\n\nBuilt with SPAR.`);
      }
    });
  }, []);
  return (
    <Sheet onClose={onClose} width={560} label="Open a pull request">
      <div className="col" style={{ gap: 12 }}>
        <div className="title2">Open a pull request</div>
        <div className="row" style={{ fontSize: 12 }}>
          <Sym n="arrow.triangle.branch" s={12} fb={<GitBranch size={13} />} /><span>{g.branch ?? ""}</span><span className="muted" style={{ display: "inline-flex" }}><Sym n="arrow.right" s={12} fb={<ArrowRight size={13} />} /></span>
          <input className="text-field" style={{ width: 140 }} placeholder="base" aria-label="Base branch" value={base} onChange={(e) => setBase(e.target.value)} />
        </div>
        <input className="text-field" placeholder="Title" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="text-area" style={{ height: 160 }} aria-label="Description" value={body} onChange={(e) => setBody(e.target.value)} />
        {g.lastError && <div style={{ color: "var(--stop)" }}>{g.lastError}</div>}
        <div className="sheet-footer" style={{ marginTop: 0 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!title.trim() || !!g.busy} onClick={async () => {
            const url = await scm.createPullRequest(title, body, base);
            if (url) { app.open(url); onClose(); }
          }}>{g.busy ? <Spinner small /> : "Open pull request"}</Button>
        </div>
      </div>
    </Sheet>
  );
}

// ---- History and remotes (additions next to the review) -----------------------------------

function History() {
  const root = useWorkspace((s) => s.root);
  const head = scm.useScm((s) => `${s.branch}|${s.ahead}|${s.behind}|${s.hasHead}`);
  const [log, setLog] = useState<Commit[] | null>(null);
  const [open, setOpen] = useState<{ hash: string; text: string } | null>(null);
  useEffect(() => { git.log(root, 200).then(setLog).catch(() => setLog([])); }, [root, head]);
  if (!log) return <div className="empty"><Spinner /></div>;
  if (!log.length) return <div className="empty"><span className="muted">No commits yet.</span></div>;
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }} role="list" aria-label="History">
      {log.map((c) => (
        <div key={c.hash} role="listitem" className="scm-row scm-hist" style={{ padding: "6px 20px", display: "flex", flexDirection: "column", gap: 2 }}
          onClick={async () => setOpen(open?.hash === c.hash ? null : { hash: c.hash, text: await git.show(root, c.hash) })}>
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            <span className="mono caption" style={{ color: "var(--accent)", flex: "none" }}>{c.short}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{c.subject}</span>
            {c.refs && c.refs.split(", ").filter(Boolean).map((r) => <span key={r} className="pill pill-accent" style={{ flex: "none" }}>{r.replace("HEAD -> ", "")}</span>)}
          </div>
          <div className="caption">{c.author} · {new Date(c.date).toLocaleString()}</div>
          {open?.hash === c.hash && (
            <pre className="selectable mono" onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, background: "var(--code-bg)", padding: 10, borderRadius: 6, overflow: "auto", maxHeight: 420, margin: "6px 0 0" }}>
              {open.text.split("\n").map((l, i) => <div key={i} style={{ color: l.startsWith("+") && !l.startsWith("+++") ? "var(--done)" : l.startsWith("-") && !l.startsWith("---") ? "var(--stop)" : l.startsWith("@@") ? "var(--accent)" : undefined }}>{l || " "}</div>)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function Remotes() {
  const root = useWorkspace((s) => s.root);
  const remoteUrl = scm.useScm((s) => s.remoteUrl);
  const [list, setList] = useState<{ name: string; url: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => git.remotes(root).then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [root, remoteUrl]);
  const run = async (args: string[]) => {
    const r = await git.run(root, args);
    setError(r.ok ? null : r.stderr.trim());
    await load();
    scm.refresh();
  };
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "12px 20px" }} className="col" aria-label="Remotes">
      <div className="row">
        <span className="headline">Remotes</span>
        <div className="spacer" />
        <IconButton icon={<RotateCw size={13} />} title="Fetch all remotes" onClick={async () => {
          const r = await git.remote(root, ["fetch", "--all", "--prune"]);
          setError(r.ok ? null : r.error ?? r.stderr);
          scm.refresh();
        }} />
        <Button size="small" icon={<Plus size={12} />} onClick={async () => {
          const name = await promptText("Add a remote", "Name", list?.length ? "" : "origin", "origin");
          if (!name?.trim()) return;
          const url = await promptText("Add a remote", `URL for ${name.trim()}`, "", "https://github.com/owner/repo.git");
          if (url?.trim()) run(["remote", "add", name.trim(), url.trim()]);
        }}>Add remote</Button>
      </div>
      {error && <div className="caption selectable" style={{ color: "var(--stop)", whiteSpace: "pre-wrap" }}>{error}</div>}
      {list && !list.length && <div className="muted">No remotes. Add one, or publish to GitHub.</div>}
      {list?.map((r) => (
        <div key={r.name} className="row card" style={{ padding: "8px 12px" }}>
          <span className="headline">{r.name}</span>
          <span className="mono caption selectable" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{r.url}</span>
          <Button size="small" onClick={async () => {
            const url = await promptText(`Change the URL of ${r.name}`, undefined, r.url);
            if (url?.trim() && url.trim() !== r.url) run(["remote", "set-url", r.name, url.trim()]);
          }}>Edit</Button>
          <IconButton size={22} icon={<Trash2 size={12} />} title={`Remove ${r.name}`} onClick={async () => {
            if (await confirm(`Remove the remote “${r.name}”?`, "The repository it points to is not changed.", "Remove", true)) run(["remote", "remove", r.name]);
          }} />
        </div>
      ))}
    </div>
  );
}
