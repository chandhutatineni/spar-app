// Connects a GitHub account: "Sign in with GitHub" in the browser (a one-time code), the
// GitHub CLI's existing login, or a fine-grained personal access token.

import { useEffect, useState } from "react";
import { UserCheck, Globe, ExternalLink, CheckCircle2, ChevronRight } from "lucide-react";
import { Button, Sheet, Spinner } from "../../ui";
import { app } from "../../lib/api";
import { githubApi } from "./api";
import { connect, disconnect, newTokenURL, useBrowserLogin, useGitHubUser } from "./github";

export function GitHubConnect({ onDone = () => {}, onCancel }: { onDone?: () => void; onCancel?: () => void }) {
  const user = useGitHubUser();
  const login = useBrowserLogin();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [cliLogin, setCliLogin] = useState(false);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => { githubApi.hasCliLogin().then(setCliLogin).catch(() => {}); }, []);
  useEffect(() => { if (login.state.phase === "done") onDone(); }, [login.state.phase]);

  const run = async (work: () => Promise<unknown>) => {
    setChecking(true);
    setError(null);
    try { await work(); onDone(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    setChecking(false);
  };

  const s = login.state;
  return (
    <div className="col" style={{ gap: 16 }} aria-label="Connect GitHub">
      <div className="row" style={{ gap: 10 }}>
        <UserCheck size={30} color="var(--accent)" />
        <div>
          <div className="title2">Connect GitHub</div>
          <div className="muted">Push, publish repositories and open pull requests from the app.</div>
        </div>
      </div>

      <div className="col" style={{ gap: 10 }}>
        {(s.phase === "idle" || s.phase === "failed") && (
          <>
            <Button kind="primary" size="large" icon={<Globe size={15} />} style={{ width: "100%" }} onClick={() => { setError(null); login.start(); }}>Sign in with GitHub</Button>
            <div className="caption">Opens github.com in your browser. Approve SPAR there and you're connected.</div>
            {cliLogin && <a href="#" className="caption" onClick={(e) => { e.preventDefault(); run(() => githubApi.useCliLogin().then((u) => connect_(u))); }}>Use the account you're signed in to with the GitHub CLI</a>}
            {s.phase === "failed" && <div style={{ color: "var(--stop)" }}>{s.message}</div>}
          </>
        )}
        {s.phase === "preparing" && <div className="row"><Spinner small /><span className="muted">Opening GitHub…</span></div>}
        {s.phase === "waiting" && (
          <div className="card col" style={{ padding: 14, gap: 8 }}>
            <div>Enter this code on GitHub, then click Authorize:</div>
            <div className="row" style={{ gap: 12 }}>
              <span className="mono selectable" style={{ fontSize: 28, fontWeight: 600 }}>{s.code}</span>
              <Button onClick={() => navigator.clipboard?.writeText(s.code)}>Copy</Button>
              <Button onClick={() => app.open(s.url)}>Open GitHub</Button>
            </div>
            <div className="row caption"><Spinner small />Waiting for you to authorize in the browser… (the code is on your clipboard)</div>
          </div>
        )}
        {s.phase === "finishing" && <div className="row"><Spinner small /><span className="muted">Finishing sign-in…</span></div>}
        {s.phase === "done" && <div className="row" style={{ color: "var(--done)" }}><CheckCircle2 size={14} />Connected</div>}
      </div>

      <div>
        <button type="button" className="btn btn-plain" style={{ padding: 0 }} onClick={() => setShowToken(!showToken)} aria-expanded={showToken}>
          <ChevronRight size={13} style={{ transform: showToken ? "rotate(90deg)" : undefined, transition: "transform .15s" }} />
          Use a personal access token instead
        </button>
        {showToken && (
          <div className="col" style={{ gap: 10, marginTop: 8, paddingLeft: 18 }}>
            <div className="muted">Create a fine-grained token with <b>Contents</b> and <b>Pull requests</b> read and write (plus <b>Administration</b> to publish new repositories, and <b>Copilot Requests</b> to use it for GitHub Copilot).</div>
            <a href="#" className="row" style={{ gap: 4 }} onClick={(e) => { e.preventDefault(); app.open(newTokenURL); }}><ExternalLink size={12} />Create a token on GitHub</a>
            <input className="text-field" type="password" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && token.trim() && run(() => connect(token))} aria-label="Personal access token" />
            <div className="caption">Stored privately on this computer. Your own git credentials are tried first; the token is only used when they don't work.</div>
          </div>
        )}
      </div>

      {error && <div style={{ color: "var(--stop)" }}>{error}</div>}
      <div className="row">
        {user && <Button kind="danger" onClick={async () => { await disconnect(); onDone(); }}>Disconnect</Button>}
        <div className="spacer" />
        <Button onClick={() => { login.cancel(); (onCancel ?? onDone)(); }}>Cancel</Button>
        {showToken && (
          <Button kind="primary" disabled={!token.trim() || checking} onClick={() => run(() => connect(token))}>
            {checking ? <Spinner small /> : "Connect"}
          </Button>
        )}
      </div>
    </div>
  );
}

// The CLI login was verified and stored by the backend; remember the account here too.
async function connect_(u: { login: string; name?: string | null; id: number }) {
  const { prefs } = await import("../../lib/prefs");
  prefs.set("githubUser", { login: u.login, name: u.name ?? null, id: u.id });
}

/** GitHubConnect in a sheet (status bar, source control). */
export function GitHubConnectSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose} width={520} label="Connect GitHub">
      <GitHubConnect onDone={onClose} />
    </Sheet>
  );
}
