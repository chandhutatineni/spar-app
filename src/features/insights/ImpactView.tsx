// AI impact and ROI for the project, from `spar impact report --json`, laid out the way
// exceeds.ai lays out its product (docs/impact-research.md): a serif page title and purpose
// line, a headline insight with Dive deeper, metric cards with status pills and a
// recommendation that asks the advisor, and wide chart panels that end with a finding.

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { BarChart3, CalendarDays, GitPullRequestArrow, RefreshCw, Share, Sparkles } from "lucide-react";
import { app as appApi, joinPath } from "../../lib/api";
import { useChat, isRunning, send } from "../../state/chat";
import { useWorkspace } from "../../state/workspace";
import { Button, MenuButton, Segmented, Spinner } from "../../ui";
import { advisorBrief, day, g, loadImpact, runImpact, type Figure, type ImpactReport } from "./impact";
import { AIInsights, Agentic, Capacity, headline, periodLabel, Prices, Quality, ROI, Team } from "./impactSections";
import { Unavailable } from "./TraceView";
import "./insights.css";

type Tab = "AI Insights" | "ROI" | "Agentic" | "Capacity" | "Quality" | "Team" | "Commits" | "Settings";
const TABS: Tab[] = ["AI Insights", "ROI", "Agentic", "Capacity", "Quality", "Team", "Commits", "Settings"];
const PURPOSE: Record<Tab, string> = {
  "AI Insights": "Track AI-driven metrics across this repository to measure development impact",
  ROI: "Convert AI spend, time saved and shipped value into a single ROI you can defend to finance",
  Agentic: "How the agents work here: sessions, messages, tokens, models, and where AI work falls off",
  Capacity: "Where the hours go, AI-assisted vs human-only, and whether the gains last",
  Quality: "AI writes code fast. Is it writing it well? AI vs human rework, and the hotspots",
  Team: "Adoption, momentum and a profile for every contributor",
  Commits: "Every commit and why it was classified that way",
  Settings: "The assumptions behind the ROI and where measuring starts",
};
/** Older tab names still accepted by SPAR_IMPACT_TAB. */
const ALIAS: Record<string, Tab> = { overview: "AI Insights", adoption: "AI Insights", insights: "AI Insights", delivery: "Agentic", spend: "ROI" };

const note = (msg: string) => useChat.getState().note(msg);

export function ImpactView(_p: { [k: string]: unknown } = {}) {
  const root = useWorkspace((s) => s.root);
  const reloadToken = useWorkspace((s) => s.reloadToken);
  const running = useChat((s) => isRunning(s));
  const [report, setReport] = useState<ImpactReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("AI Insights");
  const reportRef = useRef<ImpactReport | null>(null);
  reportRef.current = report;

  // SPAR_IMPACT_TAB=<tab title> opens a tab at launch (a development aid, like SPAR_OPEN).
  useEffect(() => {
    appApi.info().then((i) => {
      const t = i.env.SPAR_IMPACT_TAB?.toLowerCase();
      const found = t && (TABS.find((x) => x.toLowerCase() === t) ?? ALIAS[t]);
      if (found) setTab(found);
    }).catch(() => {});
  }, []);

  const reload = async (prs = false) => {
    if (!root) return;
    setLoading(true);
    const r = await loadImpact(root, prs);
    setLoading(false);
    if (r.ok) { setReport(r.report); setError(null); }
    else if (!reportRef.current) setError(r.message);
    else note(r.message);
  };
  useEffect(() => { reload(); }, [root, reloadToken]);

  const exportAs = async (format: string) => {
    const path = joinPath(root, `spar/impact/report.${format}`);
    const e = await runImpact(root, ["report", "--format", format, "--out", path]);
    if (e) note(e); else appApi.reveal(path).catch(() => {});
  };

  const askAdvisor = (r: ImpactReport) => {
    send("Here is this project's AI impact report. Act as an engineering-effectiveness advisor: say what is working, "
      + "where AI work is being reworked or is slow, and the three changes that would most improve outcomes. "
      + "Ground each point in the figures; do not change any files.\n\n" + advisorBrief(r),
      "Ask the advisor about the AI impact report");
  };
  const ask = (question: string) => {
    const r = reportRef.current;
    if (!r || isRunning(useChat.getState())) return;
    send(`${question} Act as an engineering-effectiveness advisor for this project: explain why, then say what to do next. `
      + "Ground each point in the figures below; do not change any files.\n\n" + advisorBrief(r), question);
  };

  const changed = () => { reload(); };
  const head = report ? headline(report) : null;

  return (
    <div className="ins-page ins-x">
      <div className="ins-xheader">
        <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div className="ins-serif ins-title">AI Impact</div>
            <div className="ins-purpose">{PURPOSE[tab]}</div>
          </div>
          <div className="spacer" />
          {loading && <Spinner small />}
          {report && <span className="ins-filter" title={periodLine(report)}><CalendarDays size={13} />{periodLabel(report)}</span>}
          <Button size="small" icon={<GitPullRequestArrow size={12} />} disabled={loading} title="Fetch merged pull requests with the GitHub CLI (gh) for cycle and review times" onClick={() => reload(true)}>Pull requests</Button>
          <MenuButton className="btn btn-small" title="Export" items={[
            { label: "Markdown report", onClick: () => exportAs("md") },
            { label: "Commits as CSV", onClick: () => exportAs("csv") },
            { label: "JSON", onClick: () => exportAs("json") },
          ]}><Share size={12} />Export</MenuButton>
          <button type="button" className="icon-btn" title="Recompute from git and the transcripts" aria-label="Recompute from git and the transcripts" onClick={() => reload()}><RefreshCw size={13} /></button>
        </div>
        <nav className="ins-tabs" role="tablist" aria-label="AI Impact sections">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
      </div>
      {report ? (
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          <div className="ins-xbody">
            {report.baseline == null && <StartMeasuring root={root} done={changed} />}
            {head && tab !== "Commits" && tab !== "Settings" && (
              <section className="ins-banner" aria-label="Headline insight">
                <span className="ins-banner-icon"><Sparkles size={16} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="ins-banner-title">{head.title}</div>
                  <div className="ins-banner-sub">{head.sub}</div>
                </div>
                <button type="button" className="ins-dive" disabled={running} title="Send these figures to the agent for recommendations" onClick={() => askAdvisor(report)}>Dive Deeper<Sparkles size={13} /></button>
              </section>
            )}
            {tab === "AI Insights" && <AIInsights r={report} ask={ask} />}
            {tab === "ROI" && <ROI r={report} ask={ask} prices={<Prices root={root} r={report} changed={changed} note={note} />} />}
            {tab === "Agentic" && <Agentic r={report} ask={ask} />}
            {tab === "Capacity" && <Capacity r={report} ask={ask} loading={loading} fetchPRs={() => reload(true)} />}
            {tab === "Quality" && <Quality r={report} ask={ask} />}
            {tab === "Team" && <Team r={report} ask={ask} />}
            {tab === "Commits" && <Commits r={report} />}
            {tab === "Settings" && <Settings root={root} r={report} changed={changed} />}
          </div>
        </div>
      ) : error ? (
        <Unavailable title="The impact report is unavailable" icon={<BarChart3 size={30} />} detail={error} />
      ) : (
        <div className="empty"><Spinner /><span>Reading git history and agent transcripts…</span></div>
      )}
    </div>
  );
}

function periodLine(r: ImpactReport): string {
  const mode = ({ "ai-assisted-fully": "built with AI from the first commit", since: "measured from a chosen date", "from-now": "measured from when tracking started" } as Record<string, string>)[r.baseline?.mode ?? ""] ?? "no baseline yet";
  return `${r.period.start?.slice(0, 10) ?? "–"} → ${r.period.end.slice(0, 10)} · ${mode} · ${r.sources.commits_in_period} commits · ${r.sources.sessions} sessions`;
}

// ---- Pieces --------------------------------------------------------------------------

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ins-mcard" aria-label={title}>
      <div className="ins-mcard-body">
        <div className="ins-mcard-title">{title}</div>
        {children}
      </div>
    </section>
  );
}

function Basis({ text }: { text: string }) {
  return <span className={`ins-basis${text === "assumed" ? " warn" : ""}`}>{text}</span>;
}

/** A table in the SwiftUI Grid's style: a semibold caption header, callout rows. */
function Grid({ head, rows, gap = 16 }: { head: string[]; rows: ReactNode[][]; gap?: number }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ins-table" style={{ borderSpacing: `${gap}px 6px`, margin: `-6px -${gap}px` }}>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ---- Onboarding ----------------------------------------------------------------------

function StartMeasuring({ root, done }: { root: string; done: () => void }) {
  const [since, setSince] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return day(d); });
  const [busy, setBusy] = useState(false);
  const run = async (args: string[]) => {
    setBusy(true);
    const e = await runImpact(root, args);
    if (e) note(e);
    setBusy(false);
    done();
  };
  return (
    <Card title="Where should measuring start?">
      <div className="ins-callout muted">Nothing is recorded yet, so commits are classified by evidence alone. Tell SPAR how this project was built.</div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <Button disabled={busy} title="Every commit so far counts as AI-assisted; the whole git history is analysed" onClick={() => run(["backfill", "--ai-assisted-fully"])}>Built entirely with AI</Button>
        <Button disabled={busy} title="Only work from now on is measured; earlier commits are classified by evidence" onClick={() => run(["backfill"])}>Start measuring now</Button>
        <span style={{ width: 0.5, height: 18, background: "var(--hairline-strong)" }} />
        <label className="row" style={{ gap: 6 }}>From <input type="date" className="text-field" style={{ width: 140 }} disabled={busy} value={since} onChange={(e) => setSince(e.target.value)} /></label>
        <Button disabled={busy || !since} onClick={() => run(["backfill", "--since", since])}>Measure from this date</Button>
        {busy && <Spinner small />}
      </div>
    </Card>
  );
}

// ---- Commits -------------------------------------------------------------------------

function Commits({ r }: { r: ImpactReport }) {
  const [filter, setFilter] = useState("all");
  const rows = r.commits.filter((c) => filter === "all" || c.class === filter);
  return (
    <Card title="Every commit and why it was classified that way">
      <div style={{ maxWidth: 480 }}>
        <Segmented value={filter} onChange={setFilter} options={[
          { value: "all", label: "All" }, { value: "ai", label: "AI" }, { value: "human", label: "Human" }, { value: "bot", label: "Bot" }, { value: "untracked", label: "Before the period" },
        ]} />
      </div>
      <Grid gap={14} head={["Commit", "Date", "Author", "Class", "Why", "Lines", "Subject"]} rows={rows.slice(0, 500).map((c) => [
        <span className="mono ins-caption selectable">{c.sha.slice(0, 8)}</span>,
        <span className="ins-num">{c.at.slice(0, 10)}</span>,
        <span className="ins-truncate" style={{ display: "inline-block", maxWidth: 160 }}>{c.author}</span>,
        <span style={{ color: c.class === "ai" ? "var(--accent)" : "var(--text-2)" }}>{c.class}</span>,
        <span className="muted ins-truncate" style={{ display: "inline-block", maxWidth: 220 }}>{c.tool ? `${c.basis} · ${c.tool}` : c.basis}</span>,
        <span className="ins-num">+{c.added} −{c.removed}</span>,
        <span className="ins-truncate" style={{ display: "inline-block", maxWidth: 360 }}>{c.subject}</span>,
      ])} />
      {rows.length > 500 && <span className="caption">Showing the latest 500 of {rows.length}. Export CSV for all of them.</span>}
    </Card>
  );
}

// ---- Settings ------------------------------------------------------------------------

function Settings({ root, r, changed }: { root: string; r: ImpactReport; changed: () => void }) {
  const [rateV, setRate] = useState("");
  const [loc, setLoc] = useState("");
  const [windowV, setWindow] = useState("");
  const [since, setSince] = useState(() => day(new Date()));
  const isNum = (s: string) => s.trim() !== "" && !isNaN(Number(s));
  const run = async (args: string[]) => {
    const e = await runImpact(root, args);
    if (e) note(e);
    changed();
  };
  const set = (key: string, value: string) => run(["config", key, value]);
  const field = (label: string, value: string, setV: (v: string) => void, key: string, current: Figure) => (
    <Fragment key={key}>
      <span>{label}</span>
      <input className="text-field" style={{ width: 90 }} aria-label={label} value={value} onChange={(e) => setV(e.target.value)} />
      <Button disabled={!isNum(value)} onClick={() => set(key, value)}>Save</Button>
      <span className="row" style={{ gap: 6 }}><span className="caption">currently {g(current.value)}</span><Basis text={current.basis} /></span>
    </Fragment>
  );
  const b = r.baseline;
  return (
    <>
      <Card title="Assumptions">
        <div className="ins-settings-grid">
          {field(`Loaded hourly cost of an engineer (${r.roi.currency})`, rateV, setRate, "rate_per_hour", r.roi.rate_per_hour)}
          {field("Delivered lines a person writes an hour", loc, setLoc, "human_loc_per_hour", r.roi.human_loc_per_hour)}
          <span>Rework window (days)</span>
          <input className="text-field" style={{ width: 90 }} aria-label="Rework window (days)" value={windowV} onChange={(e) => setWindow(e.target.value)} />
          <Button disabled={!isNum(windowV)} onClick={() => set("rework_window_days", windowV)}>Save</Button>
          <span className="caption">currently {Math.trunc(r.quality.window_days)}</span>
        </div>
        <span className="caption">Lines an hour is derived from this repository's own human commits when there are enough of them; otherwise it is an assumption you should set.</span>
      </Card>
      <Card title="Baseline">
        {b && <span>{b.mode} since {b.since?.slice(0, 10) ?? "–"}, recorded {b.recorded_at?.slice(0, 10) ?? "–"}{b.by ? ` by ${b.by}` : ""}</span>}
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <Button onClick={() => run(["backfill", "--ai-assisted-fully"])}>Built entirely with AI</Button>
          <Button onClick={() => run(["backfill"])}>Start measuring now</Button>
          <label className="row" style={{ gap: 6 }}>From <input type="date" className="text-field" style={{ width: 140 }} value={since} onChange={(e) => setSince(e.target.value)} /></label>
          <Button disabled={!since} onClick={() => run(["backfill", "--since", since])}>Measure from this date</Button>
        </div>
      </Card>
    </>
  );
}
