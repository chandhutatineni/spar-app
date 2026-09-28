// The AI Impact screens in the exceeds.ai layout (docs/impact-research.md): metric cards
// with a status pill, one big number, a trend and a recommendation that asks the advisor;
// wide chart panels that end with a finding. Every figure comes from `spar impact report`.

import { Fragment, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, ChevronRight, GitPullRequestArrow, Info, Sparkles, TriangleAlert } from "lucide-react";
import { app as appApi } from "../../lib/api";
import { Button } from "../../ui";
import { Donut, HeatStrip, MiniBars, Scatter, Sparkline, StackedHBars, Treemap, WeekChart, type TreeItem } from "./charts";
import { compact, g, hours, money, num, pct, rate, runImpact, type Contributor, type Day, type ImpactReport } from "./impact";

export const C = {
  ai: "var(--ins-ai)", aiBar: "var(--ins-ai-bar)", ai2: "var(--ins-ai-2)", human: "var(--ins-human)", human2: "var(--ins-human-2)",
  amber: "var(--ins-amber)", gain: "var(--ins-gain)", loss: "var(--ins-loss)", grey: "var(--ins-even)",
};
const PALETTE = [C.ai, C.ai2, C.amber, C.human2, C.human, "var(--ins-slate)"];
const DARK_TEXT = new Set([C.human2, C.amber]);

/** Asks the advisor a question about the report. */
export type Ask = (question: string) => void;

// ---- Pieces ------------------------------------------------------------------------------

export type Level = "healthy" | "good" | "watch" | "risk";
const PILL: Record<Level, string> = { healthy: "Healthy", good: "Good", watch: "Watch", risk: "At risk" };

export const Pill = ({ level }: { level: Level }) => <span className={`ins-pill ins-pill-${level}`}>{PILL[level]}</span>;

function Scope({ text, tip }: { text: string; tip?: string }) {
  return (
    <div className="ins-scope">
      <span>{text}</span>
      {tip && <span className="ins-scope-tip" title={tip} aria-label={tip}><Info size={11} /></span>}
    </div>
  );
}

/** The footer strip: a sparkle, a one-line recommendation, a chevron. Opens the advisor. */
function Rec({ text, ask, question }: { text: string; ask: Ask; question: string }) {
  return (
    <button type="button" className="ins-rec" title="Ask the advisor about this" onClick={() => ask(question)}>
      <Sparkles size={14} className="ins-brand" />
      <span className="ins-rec-text ins-clamp2">{text}</span>
      <ChevronRight size={14} className="muted" />
    </button>
  );
}

/** A finding under a chart with an Ask AI button. */
function Finding({ text, ask, question }: { text: string; ask: Ask; question: string }) {
  return (
    <div className="ins-finding">
      <Sparkles size={14} className="ins-brand" />
      <span>{text}</span>
      <span className="spacer" />
      <button type="button" className="ins-askai" onClick={() => ask(question)}><Sparkles size={11} />Ask AI</button>
    </div>
  );
}

export function Metric({ title, level, scope, tip, value, chart, rec, children }: {
  title: string; level?: Level | null; scope: string; tip?: string; value: string; chart?: ReactNode;
  rec?: { text: string; ask: Ask; question: string }; children?: ReactNode;
}) {
  return (
    <section className="ins-mcard" aria-label={title}>
      <div className="ins-mcard-body">
        <div className="ins-mcard-head">
          <span className="ins-mcard-title">{title}</span>
          {level && <Pill level={level} />}
        </div>
        <Scope text={scope} tip={tip} />
        <div className="ins-mcard-main">
          <span className="ins-big">{value}</span>
          {chart && <div className="ins-mcard-chart">{chart}</div>}
        </div>
        {children}
      </div>
      {rec && <Rec {...rec} />}
    </section>
  );
}

export function Panel({ title, level, scope, tip, right, children, finding }: {
  title: string; level?: Level | null; scope?: string; tip?: string; right?: ReactNode; children: ReactNode;
  finding?: { text: string; ask: Ask; question: string } | null;
}) {
  return (
    <section className="ins-mcard" aria-label={title}>
      <div className="ins-mcard-body">
        <div className="ins-mcard-head">
          <span className="ins-mcard-title">{title}</span>
          {level && <Pill level={level} />}
          <span className="spacer" />
          {right}
        </div>
        {scope && <Scope text={scope} tip={tip} />}
        <div className="ins-panel-content">{children}</div>
      </div>
      {finding && <Finding {...finding} />}
    </section>
  );
}

function Tile({ eyebrow, value, caption, spark, color = C.ai, ends }: { eyebrow: string; value: string; caption: string; spark: (number | null)[]; color?: string; ends: [string, string] }) {
  return (
    <section className="ins-mcard ins-tile" aria-label={eyebrow}>
      <span className="ins-eyebrow">{eyebrow}</span>
      <span className="ins-big">{value}</span>
      <span className="ins-tile-caption">{caption}</span>
      <Sparkline values={spark} color={color} height={36} ends={ends} />
    </section>
  );
}

export const Cards = ({ min = 280, children }: { min?: number; children: ReactNode }) => (
  <div className="ins-cards" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>{children}</div>
);

const Section = ({ title, sub }: { title: string; sub: string }) => (
  <div className="ins-section"><div className="ins-serif">{title}</div><div className="ins-purpose">{sub}</div></div>
);

/** A table in the exceeds style: small caps header, hairline rows. */
export function Table({ head, rows, align }: { head: string[]; rows: ReactNode[][]; align?: ("l" | "r")[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ins-xtable">
        <thead><tr>{head.map((h, i) => <th key={h} style={{ textAlign: align?.[i] === "r" ? "right" : "left" }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ textAlign: align?.[j] === "r" ? "right" : "left" }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const Avatar = ({ name }: { name: string }) => {
  const initials = name.split(/[\s._@-]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("") || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return <span className="ins-avatar" style={{ background: `hsl(${h} 45% 55%)` }} aria-hidden>{initials}</span>;
};

const Trend = ({ t }: { t?: string }) =>
  t === "up" ? <span title="More commits in the last 28 days than the 28 before" style={{ color: C.ai }}><ArrowUpRight size={13} /></span>
    : t === "down" ? <span title="Fewer commits in the last 28 days than the 28 before" style={{ color: C.human }}><ArrowDownRight size={13} /></span>
      : <span title="About the same as the 28 days before" className="muted"><ArrowRight size={13} /></span>;

// ---- Figures and thresholds ------------------------------------------------------------

const ratio = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? a / b : null);
const x2 = (v: number | null | undefined) => (v == null ? "–" : `${v.toFixed(2).replace(/\.?0+$/, "")}x`);
const x1 = (v: number | null | undefined) => (v == null ? "–" : `${v.toFixed(1)}x`);

/** Exceeds' published guidance: adoption ≥ 40% is healthy, < 30% puts the ROI at risk. */
const adoptionLevel = (s: number | null): Level | null => (s == null ? null : s >= 0.4 ? "healthy" : s >= 0.3 ? "watch" : "risk");
/** Rework: under 1.2× the human rate is healthy, 2× and over is at risk. */
function reworkLevel(r: ImpactReport): Level | null {
  const ai = rate(r.quality.rework_rate, "ai"), hu = rate(r.quality.rework_rate, "human");
  if (ai == null) return null;
  if (hu) { const k = ai / hu; return k < 1.2 ? "healthy" : k < 2 ? "watch" : "risk"; }
  return ai < 0.15 ? "healthy" : ai < 0.3 ? "watch" : "risk";
}
const liftLevel = (m: number | null): Level | null => (m == null ? null : m >= 1.2 ? "healthy" : m >= 1 ? "watch" : "risk");

export const periodLabel = (r: ImpactReport) => (r.period.start ? `Since ${shortDay(r.period.start)}` : "All history");
const shortDay = (iso: string) => new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const tools = (r: ImpactReport) => Object.entries(r.adoption.tools).sort((a, b) => b[1] - a[1]);
const topHotspot = (r: ImpactReport) => r.quality.hotspots.find((h) => h.rework_lines > 0)?.area;

/** The headline banner: the single most important reading of the figures. */
export function headline(r: ImpactReport): { title: string; sub: string } {
  const aiCommits = r.adoption.commits.ai ?? 0;
  const m = r.lift.multiple;
  const q = reworkLevel(r);
  const ai = rate(r.quality.rework_rate, "ai"), hu = rate(r.quality.rework_rate, "human");
  const k = ratio(ai, hu);
  const spot = topHotspot(r);
  const users = `${r.adoption.ai_contributors} of ${r.adoption.contributors} contributors`;
  if (!aiCommits) return { title: "No AI-assisted work is visible yet", sub: "Commit with the tool's co-author trailer, or build through SPAR, so AI work is counted." };
  if (m != null && m >= 1.2 && (q === "risk" || q === "watch"))
    return { title: `AI lifts output ${x1(m)} but its code is reworked ${k != null ? `${k.toFixed(1)}× as often` : "more"} as human code`,
      sub: `Tighten acceptance criteria on AI tasks${spot ? ` in ${spot}` : ""} to keep the gain without the churn.` };
  if (m != null && m >= 1.2)
    return { title: `AI days deliver ${x1(m)} the output of human-only days, and the code holds up`,
      sub: `Spread the practice: ${users} use AI. Healthy adoption is 40% after three months.` };
  if (m != null && m < 1)
    return { title: `AI days are not yet out-producing human-only days (${x2(m)})`,
      sub: "Look at where AI sessions stall: task size, unclear specs and rework are the usual causes." };
  if (q === "risk") return { title: "AI code is being rewritten much more than human code", sub: `Review the tasks behind the hotspot${spot ? ` ${spot}` : ""}: unclear acceptance criteria are the usual cause.` };
  const a = r.attention[0];
  if (a) return { title: a.title, sub: a.next || a.detail };
  return { title: `${pct(r.output.ai_line_share)} of the code is AI-written`, sub: `${users} use AI; see where it pays off below.` };
}

// ---- AI Insights ---------------------------------------------------------------------------

export function AIInsights({ r, ask }: { r: ImpactReport; ask: Ask }) {
  const w = r.weekly;
  const weeks = w.map((x) => x.start);
  const ai = rate(r.quality.rework_rate, "ai"), hu = rate(r.quality.rework_rate, "human");
  const k = ratio(ai, hu);
  const ts = tools(r);
  const toolTotal = ts.reduce((s, [, v]) => s + v, 0);
  const lead = ts[0];
  const usage = r.adoption.contributors ? r.adoption.ai_contributors / r.adoption.contributors : null;
  const sz = r.sizes;
  const sizeLevel: Level | null = sz.ai.median == null ? null : sz.ai.median > sz.large_lines ? "risk"
    : sz.human.median && sz.ai.median > sz.human.median * 1.5 ? "watch" : "healthy";
  const cpd = r.lift.ai_commits_per_dev_day;
  const spot = topHotspot(r);
  const scopeP = periodLabel(r);
  return (
    <>
      <Cards>
        <Metric title="AI-Assisted Code Contribution" level={adoptionLevel(r.output.ai_line_share)} scope={scopeP}
          tip="Share of delivered code and test lines written in commits with AI evidence (trailers, SPAR sessions, the baseline). Lockfiles, generated and vendored files are excluded."
          value={pct(r.output.ai_line_share)}
          chart={<Sparkline values={w.map((x) => (x.lines_ai + x.lines_human ? x.lines_ai / (x.lines_ai + x.lines_human) : null))} />}
          rec={{ ask, text: lead ? `Compare contribution by tool: ${lead[0]} made ${lead[1]} of the ${toolTotal} AI commits. See which tools truly drive it.` : "Compare AI-written code by tool to see which tools drive contribution.",
            question: "Which AI tools drive the most AI-written code in this project, and is the contribution concentrated in a few people or areas?" }} />
        <Metric title="AI Productivity Lift" level={liftLevel(r.lift.multiple)} scope={scopeP} tip={r.lift.basis || undefined} value={x2(r.lift.multiple)}
          chart={<Sparkline values={w.map((x) => x.lift ?? null)} />}
          rec={{ ask, text: r.lift.lines_per_dev_day_ai != null ? `${num(r.lift.lines_per_dev_day_ai)} lines per person on AI days vs ${num(r.lift.lines_per_dev_day_human ?? 0)} on human-only days, over ${r.lift.ai_dev_days} AI developer-days.` : "Not enough AI and human developer-days to compare yet.",
            question: "Is the AI productivity lift real per person, or driven by a few heavy users? Use the per-contributor lift." }} />
        <Metric title="AI Code Quality" level={reworkLevel(r)} scope={`Lines standing after ${Math.trunc(r.quality.window_days)} days`}
          tip={`Durability: 1 − AI rework rate, where rework is ${r.quality.definition}. Healthy is AI rework under 1.2× the human rate.`}
          value={pct(ai == null ? null : 1 - ai)}
          chart={<Sparkline values={w.map((x) => (x.lines_ai > 0 ? 1 - x.rework_ai / x.lines_ai : null))} />}
          rec={{ ask, text: `AI rework ${pct(ai)} vs human ${pct(hu)}${k != null ? ` (${k.toFixed(1)}×; healthy is under 1.2×)` : ""}${spot ? `. Most is in ${spot}.` : "."}`,
            question: "Where and why is AI-written code being reworked, and what would reduce it?" }} />
      </Cards>
      <Cards min={420}>
        <Panel title="AI Usage Percentage" level={usage == null ? null : usage >= 0.4 ? "good" : usage >= 0.3 ? "watch" : "risk"} scope="% of active contributors using AI, per week"
          tip="Contributors with at least one AI commit that week ÷ everyone who committed that week."
          finding={{ ask, text: `${r.adoption.ai_contributors} of ${r.adoption.contributors} contributors used AI in the period. Coach the rest to keep adoption climbing week over week.`,
            question: "Who has not adopted AI yet, and what onboarding would help adoption climb week over week?" }}>
          <WeekChart kind="area" height={200} weeks={weeks} yMax={100} yFormat={(v) => `${v}`} format={(v) => `${Math.round(v)}%`}
            refs={[{ value: 40, label: "40% healthy", color: "var(--ins-healthy)" }]}
            series={[{ name: "Using AI", color: C.ai, values: w.map((x) => (x.contributors ? (x.ai_contributors / x.contributors) * 100 : null)) }]} />
        </Panel>
        <Panel title="AI Tools Breakdown" scope={`Share of AI commits · ${scopeP}`}
          tip="From the co-author trailers and tool signatures in each AI commit."
          finding={{ ask, text: lead && toolTotal && lead[1] / toolTotal > 0.7 ? `${lead[0]} carries ${Math.round((lead[1] / toolTotal) * 100)}% of AI commits: watch single-tool dependency and model changes.` : `AI work is spread over ${ts.length} tool${ts.length === 1 ? "" : "s"}. Keep the vendor mix deliberate and contain spend.`,
            question: "Evaluate this project's AI vendor mix: dependency on a single tool, spend, and resilience to model changes." }}>
          {ts.length ? <Donut items={ts.map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }))} /> : <span className="muted">No AI tool signatures in the period.</span>}
        </Panel>
        <Metric title="AI Commit Size" level={sizeLevel} scope="Median lines added per AI commit"
          tip={`${sz.basis}. Over ${sz.large_lines} lines counts as large.${sz.pr_ai_median != null ? ` Median AI pull request: ${num(sz.pr_ai_median)} lines.` : ""}`}
          value={sz.ai.median == null ? "–" : num(sz.ai.median)}
          chart={<MiniBars values={w.slice(-12).map((x) => x.median_commit_lines_ai ?? null)} alert={(v) => v > sz.large_lines} format={(v) => `${num(v)} lines`} />}
          rec={{ ask, text: `${pct(sz.ai.large_share)} of AI commits add over ${sz.large_lines} lines (human ${pct(sz.human.large_share)}). Large changes raise review burden; split them by task.`,
            question: "Where are AI commits over-generating code, and how should work be split so reviews stay small?" }} />
        <Metric title="AI Commits Per Dev Per Day" level={cpd == null ? null : cpd > 4 ? "watch" : "healthy"} scope="AI commits per AI-active developer-day"
          tip="Spiky AI commit counts usually mean context switching that disrupts flow and increases rework."
          value={cpd == null ? "–" : cpd.toFixed(1)}
          chart={<Sparkline color={C.amber} values={w.map((x) => (x.ai_dev_days ? x.commits_ai / x.ai_dev_days : null))} />}
          rec={{ ask, text: `${cpd?.toFixed(1) ?? "–"} AI commits on an AI-active day vs ${r.lift.commits_per_dev_day_human ?? "–"} on a human-only day. See where AI accelerates, or slows, delivery.`,
            question: "Compare AI and human commit patterns: where does AI accelerate delivery and where does it fragment it?" }} />
      </Cards>
      {r.attention.length > 0 && (
        <Panel title="What needs attention" scope="What matters, what needs attention, what to do next">
          {r.attention.map((n) => (
            <div key={n.title} className="ins-note">
              <span style={{ color: n.level === "warn" ? "var(--ins-watch)" : C.ai }}>{n.level === "warn" ? <TriangleAlert size={14} /> : <Info size={14} />}</span>
              <div>
                <div className="ins-note-title">{n.title}</div>
                <div className="muted">{n.detail}</div>
                {n.next && <div className="ins-caption muted selectable">{n.next}</div>}
              </div>
            </div>
          ))}
        </Panel>
      )}
      <div className="caption">
        Sources: {r.sources.git ? `git (${num(r.sources.commits)} commits)` : "no git"} · {num(r.sources.transcript_messages)} agent messages · {r.sources.app_turns} app turns · {r.sources.pull_requests ? "pull requests" : "no pull requests"}. Generated {r.generated_at.slice(0, 16).replace("T", " ")} UTC.
      </div>
    </>
  );
}

// ---- ROI -----------------------------------------------------------------------------------

function cumulative(xs: number[]): number[] {
  let s = 0;
  return xs.map((v) => (s += v));
}

function roiColor(d: Day): string {
  if (d.cost_usd <= 0) return d.value_usd > 0 ? "color-mix(in srgb, var(--ins-gain) 28%, var(--ins-cell))" : d.value_usd < 0 ? "color-mix(in srgb, var(--ins-loss) 60%, var(--ins-cell))" : "var(--ins-cell)";
  const x = d.roi ?? 0;
  if (x < 0.8) return `color-mix(in srgb, var(--ins-loss) ${x < 0 ? 100 : Math.round(45 + (0.8 - x) * 60)}%, var(--ins-cell))`;
  if (x <= 1.25) return "var(--ins-even)";
  return `color-mix(in srgb, var(--ins-gain) ${Math.round(35 + Math.min(1, Math.log10(x) / 1.3) * 65)}%, var(--ins-cell))`;
}

export function ROI({ r, ask, prices }: { r: ImpactReport; ask: Ask; prices: ReactNode }) {
  const cur = r.roi.currency;
  const d = r.daily;
  const n = d.length;
  const ends: [string, string] = [`${n}d ago`, "Today"];
  const engineers = Math.max(1, r.adoption.ai_contributors);
  const cv = cumulative(d.map((x) => x.value_usd)), cc = cumulative(d.map((x) => x.cost_usd));
  const mult = r.roi.multiple;
  const row = (label: string, value: string, basis: string) => (
    <Fragment key={label}>
      <span className="muted">{label}</span>
      <span className="ins-num" style={{ fontWeight: 500 }}>{value}</span>
      <span>{basis ? <span className={`ins-basis${basis === "assumed" ? " warn" : ""}`}>{basis}</span> : null}</span>
    </Fragment>
  );

  // Spend by feature: SPAR's features are the spec features its tasks belong to.
  const lph = r.roi.human_loc_per_hour.value, hourly = r.roi.rate_per_hour.value;
  const feats = new Map<string, { cost: number; lines: number; hours: number; tasks: number }>();
  for (const t of r.tasks) {
    const f = feats.get(t.feature || "Unassigned") ?? { cost: 0, lines: 0, hours: 0, tasks: 0 };
    f.cost += t.cost_usd; f.lines += t.lines_added; f.hours += t.hours; f.tasks += 1;
    feats.set(t.feature || "Unassigned", f);
  }
  const featRows = [...feats.entries()].map(([name, f]) => {
    const value = (lph > 0 ? f.lines / lph - f.hours : -f.hours) * hourly;
    return { name, ...f, value, roi: f.cost > 0 ? value / f.cost : null };
  }).sort((a, b) => b.cost - a.cost);
  const peakCost = Math.max(1e-9, ...featRows.map((f) => f.cost));
  const featColor = (x: number | null) => (x == null ? C.grey : x < 1 ? C.loss : x < 2 ? "color-mix(in srgb, var(--ins-gain) 55%, transparent)" : x < 4 ? "color-mix(in srgb, var(--ins-gain) 78%, transparent)" : C.gain);

  const models = Object.entries(r.spend.by_model).sort((a, b) => b[1].cost_usd - a[1].cost_usd);
  const tree: TreeItem[] = models.map(([k, m], i) => ({ label: k, value: m.cost_usd, sub: money(m.cost_usd, cur), color: PALETTE[i % PALETTE.length], text: DARK_TEXT.has(PALETTE[i % PALETTE.length]) ? "#1d1d1f" : "#fff" }));

  const people = [...r.contributors];
  const most = people.sort((a, b) => b.ai_lines_added - a.ai_lines_added)[0];
  const shareLead = r.contributors.filter((p) => p.commits >= 10).sort((a, b) => (b.ai_share ?? 0) - (a.ai_share ?? 0))[0];
  const liftLead = r.contributors.filter((p) => p.lift != null).sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0))[0];
  const gains = d.filter((x) => x.roi != null && x.roi > 1.25).length, losses = d.filter((x) => (x.roi != null && x.roi < 0.8) || (x.cost_usd <= 0 && x.value_usd < 0)).length;

  return (
    <>
      <Cards min={220}>
        <Tile eyebrow="Blended AI ROI" value={mult != null ? `${r.roi.multiple_is_upper_bound ? "≤ " : ""}${x1(mult)}` : "–"}
          caption={r.spend.cost_usd > 0 ? "Value ÷ spend, all priced models" : "No AI spend recorded"} ends={ends}
          spark={d.map((_, i) => (cc[i] > 0 ? cv[i] / cc[i] : null))} />
        <Tile eyebrow="Net AI value shipped" value={money(r.roi.net, cur)} caption={`Value ${money(r.roi.value, cur)} − spend ${money(r.spend.cost_usd, cur)}`} ends={ends} spark={cv} />
        <Tile eyebrow="Average engineer spend" value={money(r.spend.cost_usd / engineers, cur)} caption={`Across ${r.adoption.ai_contributors} engineers using AI`} ends={ends} spark={cc} color={C.amber} />
        <Tile eyebrow="Hours saved / engineer" value={(r.roi.hours_saved / engineers).toFixed(1)} caption={`${hours(r.roi.hours_saved)} saved in all`} ends={ends} spark={cumulative(d.map((x) => x.lines_ai))} />
      </Cards>
      <Panel title="Daily AI ROI" scope={`Last ${n} days · value shipped per $ spent`}
        tip="Each day: AI lines at human speed and rate, less the time spent with AI, divided by that day's AI spend. Days with no spend recorded show value only."
        right={<div className="ins-heat-legend"><div className="ins-heat-scale" /><div className="row"><span>Loss</span><span className="spacer" /><span>Break-even</span><span className="spacer" /><span>Gain</span></div></div>}
        finding={{ ask, text: `${gains} gain day${gains === 1 ? "" : "s"} and ${losses} loss day${losses === 1 ? "" : "s"} in the last ${n}.`, question: "What distinguishes the days where AI returned more than it cost from the days it lost money?" }}>
        <HeatStrip ends={[`${n} days ago`, `${Math.round((n * 2) / 3)}d`, `${Math.round(n / 3)}d`, "Today"]}
          cells={d.map((x) => ({ key: x.date, color: roiColor(x), tip: `${x.date}: value ${money(x.value_usd, cur)}, spend ${money(x.cost_usd, cur)}${x.roi != null ? `, ${x1(x.roi)}` : ""}` }))} />
      </Panel>
      <Panel title="Spend by Feature" scope={`Where AI dollars went · ${periodLabel(r)}`}
        tip="Per spec feature, from SPAR's measured task sessions: cost, lines, and ROI = (lines at human speed − session hours) × rate ÷ cost.">
        {featRows.length === 0 ? <span className="muted">No measured tasks yet. Each task built through SPAR records its cost and lines from now on.</span> : (
          <div className="ins-feat">
            <div className="ins-feat-row ins-feat-head"><span>Feature</span><span>Cost</span><span>Lines</span><span>ROI</span></div>
            {featRows.map((f) => (
              <div key={f.name} className="ins-feat-row">
                <div className="ins-feat-bar">
                  <div style={{ width: `${Math.max(4, (f.cost / peakCost) * 100)}%`, background: featColor(f.roi) }} />
                  <span><b>{f.name}</b><small>{f.tasks} task{f.tasks === 1 ? "" : "s"} · {hours(f.hours)}</small></span>
                </div>
                <span className="ins-num">{money(f.cost, cur)}</span>
                <span className="ins-num">{compact(f.lines)}</span>
                <span className="ins-num" style={{ color: f.roi == null ? undefined : f.roi < 1 ? "var(--ins-loss-text)" : C.gain, fontWeight: 600 }}>{f.roi == null ? "–" : `${f.roi >= 0 ? "+" : ""}${f.roi.toFixed(1)}x`}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Cards min={420}>
        <Panel title="Spend by Model" scope="Sized by spend · from the agent transcripts" tip="Spend from tools SPAR cannot see (Copilot, Cursor) is not included.">
          {tree.length ? <Treemap items={tree} /> : <span className="muted">No priced agent spend in the period.</span>}
          {models.length > 0 && (
            <Table head={["Model", "Messages", "Tokens", "Cost"]} align={["l", "r", "r", "r"]} rows={models.map(([k, m]) => [
              <span className="mono ins-caption">{k}</span>, <span className="ins-num">{num(m.messages)}</span>, <span className="ins-num">{compact(m.tokens)}</span>, <span className="ins-num">{money(m.cost_usd, cur)}</span>,
            ])} />
          )}
        </Panel>
        <Panel title="How the ROI is computed" scope="Every input and where it comes from">
          <div className="ins-roi">
            {row("AI-written lines", num(r.roi.ai_lines.value), r.roi.ai_lines.basis)}
            {row("Lines a person writes an hour", g(r.roi.human_loc_per_hour.value), r.roi.human_loc_per_hour.basis)}
            {row("Human-equivalent effort", hours(r.roi.human_equivalent_hours.value), r.roi.human_equivalent_hours.basis)}
            {row("Time spent with AI", hours(r.roi.ai_hours.value), `${hours(r.roi.ai_hours.measured)} measured + ${hours(r.roi.ai_hours.estimated)} estimated`)}
            {row("Extra rework", hours(r.roi.quality_cost_hours.value), r.roi.quality_cost_hours.basis)}
            {row("Hours saved", hours(r.roi.hours_saved), "")}
            {row("Hourly rate", money(r.roi.rate_per_hour.value, cur), r.roi.rate_per_hour.basis)}
            {row("AI spend", money(r.roi.spend.value, cur), r.roi.spend.value === 0 ? "none found" : r.roi.spend.complete ? "measured" : "incomplete: the multiple is an upper bound")}
          </div>
          <div className="mono ins-caption muted selectable">{r.roi.formula}</div>
        </Panel>
      </Cards>
      {prices}
      <Section title="Developer Impact" sub="Who is getting the most out of AI" />
      <Cards min={240}>
        <Leader label="Most AI lines" p={most} value={most ? `${compact(most.ai_lines_added)} lines` : ""} />
        <Leader label="Highest AI share" p={shareLead} value={shareLead ? pct(shareLead.ai_share) : ""} />
        <Leader label="Top productivity lift" p={liftLead} value={liftLead ? x2(liftLead.lift) : ""} />
      </Cards>
      <span className="caption">Spend is per machine, not per person, so cost per engineer is an average.</span>
    </>
  );
}

const Leader = ({ label, p, value }: { label: string; p?: Contributor; value: string }) => (
  <section className="ins-mcard ins-tile" aria-label={label}>
    <span className="ins-mcard-title">{label}</span>
    <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
      <span className="ins-big ins-truncate" style={{ fontSize: 26 }}>{p?.name ?? "–"}</span>
      <span className="spacer" />
      <span className="muted ins-num">{value}</span>
    </div>
  </section>
);

// ---- Agentic -----------------------------------------------------------------------------

export function Agentic({ r, ask }: { r: ImpactReport; ask: Ask }) {
  const recent = r.daily.slice(-14);
  const a = r.agent;
  const cur = r.roi.currency;
  const avg = (xs: number[]) => { const act = xs.filter((v) => v > 0); return act.length ? act.reduce((s, v) => s + v, 0) / act.length : 0; };
  const f = r.funnel;
  const entries = Object.entries(a.by_entrypoint);
  const eTotal = entries.reduce((s, [, v]) => s + v, 0);
  const models = Object.entries(a.models);
  const mPeak = Math.max(1, ...models.map(([, v]) => v));
  const step = (label: string, v: number | null, of: number, color = C.ai) => (
    <div key={label} className="ins-funnel-step">
      <div className="row"><span>{label}</span><span className="spacer" /><span className="ins-num">{v == null ? "needs pull requests" : `${compact(v)} · ${of ? Math.round((v / of) * 100) : 0}%`}</span></div>
      <div className="ins-meter"><div style={{ width: `${v == null || !of ? 0 : Math.max(2, (v / of) * 100)}%`, background: color }} /></div>
    </div>
  );
  const tile = (title: string, value: string, values: number[], sub?: string) => (
    <section className="ins-mcard ins-tile" aria-label={title}>
      <span className="ins-mcard-title">{title}</span>
      <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
        <span className="ins-big" style={{ fontSize: 30 }}>{value}</span>
        <span className="spacer" />
        <div style={{ width: 120 }}><MiniBars values={values} height={40} /></div>
      </div>
      {sub && <span className="ins-tile-caption">{sub}</span>}
    </section>
  );
  return (
    <>
      <div className="ins-subhead">{recent.length}-day summary · averages over active days</div>
      <Cards min={240}>
        {tile("Sessions / day", avg(recent.map((x) => x.sessions)).toFixed(1), recent.map((x) => x.sessions))}
        {tile("Agent messages / day", compact(avg(recent.map((x) => x.messages))), recent.map((x) => x.messages))}
        {tile("Files changed / day", compact(avg(recent.map((x) => x.files))), recent.map((x) => x.files))}
        {tile("Lines changed / day", compact(avg(recent.map((x) => x.lines_ai + x.lines_human))), recent.map((x) => x.lines_ai + x.lines_human),
          `+${compact(recent.reduce((s, x) => s + x.lines_ai + x.lines_human, 0))} / −${compact(recent.reduce((s, x) => s + x.lines_removed, 0))}`)}
        {tile("Tokens in / out per day", `${compact(avg(recent.map((x) => x.tokens_in)))} / ${compact(avg(recent.map((x) => x.tokens_out)))}`, recent.map((x) => x.tokens_in + x.tokens_out))}
        {tile("AI spend / day", money(avg(recent.map((x) => x.cost_usd)), cur), recent.map((x) => x.cost_usd))}
      </Cards>
      <Cards min={380}>
        <Panel title="Entry points" scope={`${num(a.messages)} agent messages · ${a.sessions} sessions · ${a.active_days} active days`} tip={a.basis}>
          {entries.length === 0 ? <span className="muted">No agent transcripts for this folder in the period.</span> : (
            <div className="ins-chips">
              {entries.map(([k, v], i) => <span key={k} className="ins-mode"><i style={{ background: PALETTE[i % PALETTE.length] }} />{k}<b>{Math.round((v / eTotal) * 100)}%</b></span>)}
            </div>
          )}
          {a.messages_per_active_day != null && <span className="caption">{a.messages_per_active_day} messages on an active day · {compact(a.tokens_in)} tokens in, {compact(a.tokens_out)} out.</span>}
        </Panel>
        <Panel title="Model usage" scope="Agent messages per model">
          {models.length === 0 ? <span className="muted">No model usage recorded.</span> : models.map(([k, v]) => (
            <div key={k} className="ins-barlist">
              <span className="mono ins-caption ins-truncate">{k}</span>
              <div className="ins-meter"><div style={{ width: `${(v / mPeak) * 100}%`, background: C.ai }} /></div>
              <span className="ins-num muted">{num(v)}</span>
            </div>
          ))}
        </Panel>
      </Cards>
      <Panel title="Where does AI work fall off?" scope="From AI lines committed to code that lasts and ships" tip={f.basis}
        finding={{ ask, text: `${f.ai_lines ? Math.round((f.ai_lines_standing / f.ai_lines) * 100) : 0}% of AI lines are still standing after ${Math.trunc(r.quality.window_days)} days; ${f.tasks_done} of ${f.tasks_begun} measured tasks finished, ${f.tasks_first_pass} on the first pass.`,
          question: "Where does AI work fall off between generation, commit, surviving rework and merge, and how do we close the gap?" }}>
        <div className="ins-funnel">
          {step("AI lines committed", f.ai_lines, f.ai_lines)}
          {step(`Still standing after ${Math.trunc(r.quality.window_days)} days`, f.ai_lines_standing, f.ai_lines)}
          {step("In merged pull requests", f.ai_lines_in_merged_prs, f.ai_lines)}
        </div>
        <div className="ins-funnel">
          {step("Tasks begun", f.tasks_begun, f.tasks_begun, C.ai2)}
          {step("Tasks done", f.tasks_done, f.tasks_begun, C.ai2)}
          {step("Done on the first pass", f.tasks_first_pass, f.tasks_begun, C.ai2)}
        </div>
      </Panel>
      <Tasks r={r} />
    </>
  );
}

function Tasks({ r }: { r: ImpactReport }) {
  const d = r.delivery;
  return (
    <>
      <Panel title="Measured tasks" scope={`${d.tasks_measured} measured · first pass ${pct(d.first_pass_rate)} · median ${hours(d.median_task_hours)} · ${d.unmeasured_tasks.length} ticked but unmeasured`}>
        {r.tasks.length === 0 ? <span className="muted">No measured tasks yet. Each build task records a session from now on.</span> : (
          <Table head={["Task", "Status", "Attempts", "Time", "Lines", "Commits", "Tokens", "Cost", "Issue"]} align={["l", "l", "r", "r", "r", "r", "r", "r", "l"]}
            rows={r.tasks.map((t) => [
              <span className="mono ins-caption">{t.feature ? `${t.feature} · ` : ""}{t.task}</span>,
              <span style={{ color: t.status === "done" ? "var(--ins-healthy)" : t.status === "open" ? C.ai : "var(--ins-watch)" }}>{t.status}</span>,
              <span className="ins-num">{t.attempts}</span>, <span className="ins-num">{hours(t.hours)}</span>,
              <span className="ins-num">+{t.lines_added} −{t.lines_removed}</span>, <span className="ins-num">{t.commits}</span>,
              <span className="ins-num">{compact(t.tokens)}</span>, <span className="ins-num">{money(t.cost_usd, r.roi.currency) + (t.cost_complete ? "" : "+")}</span>,
              <span>{t.issue ?? "–"}</span>,
            ])} />
        )}
      </Panel>
      {r.tickets.length > 0 && (
        <Panel title="Tickets" scope="Issue keys in task records and commit messages">
          <Table head={["Ticket", "Tasks", "Time", "Commits", "AI commits"]} align={["l", "l", "r", "r", "r"]} rows={r.tickets.map((t) => [
            <span className="mono ins-caption">{t.key}</span>, <span className="muted">{t.tasks.join(", ") || "–"}</span>, <span className="ins-num">{hours(t.hours)}</span>,
            <span className="ins-num">{t.commits}</span>, <span className="ins-num">{t.ai_commits}</span>,
          ])} />
        </Panel>
      )}
    </>
  );
}

// ---- Capacity ----------------------------------------------------------------------------

export function Capacity({ r, ask, fetchPRs, loading }: { r: ImpactReport; ask: Ask; fetchPRs: () => void; loading: boolean }) {
  const p = r.pull_requests;
  const pw = p.weekly ?? [];
  const lc = p.lifecycle;
  const cy = ratio(p.median_cycle_hours_human, p.median_cycle_hours_ai);
  const people = [...r.contributors].sort((a, b) => b.commits - a.commits).slice(0, 60);
  const trendColor = (t?: string) => (t === "up" ? C.ai : t === "down" ? C.human2 : C.ai2);
  const co = r.cohort.offsets;
  const late = co.filter((o) => o.week >= 4);
  const settle = late.length ? late.reduce((s, o) => s + o.index, 0) / late.length : null;
  const w = r.weekly;
  const aiShareOfCommits = w.length ? w[w.length - 1] : null;
  const fetchCard = (
    <Panel title="Pull request cycle time" scope="Needs merged pull requests from GitHub">
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="muted">{p.reason ?? "Not fetched."} Cycle time and the lifecycle breakdown come from merged pull requests (GitHub CLI).</span>
        <span className="spacer" />
        <Button size="small" icon={<GitPullRequestArrow size={12} />} disabled={loading} onClick={fetchPRs}>Fetch pull requests</Button>
      </div>
    </Panel>
  );
  return (
    <>
      {!p.available ? fetchCard : (
        <>
          <Panel title="AI-assisted vs human-only cycle time" scope="Weekly P50 cycle time, PR opened → merged"
            finding={{ ask, text: cy == null ? "Not enough merged pull requests on both sides to compare yet." : cy >= 1 ? `AI-assisted PRs close ~${cy.toFixed(1)}× faster (median ${hours(p.median_cycle_hours_ai)} vs ${hours(p.median_cycle_hours_human)}).` : `AI-assisted PRs take longer to merge (median ${hours(p.median_cycle_hours_ai)} vs ${hours(p.median_cycle_hours_human)}).`,
              question: "Why do AI-assisted pull requests close at the speed they do compared with human-only ones, and where is the time going?" }}>
            <WeekChart kind="linePoints" smooth height={200} weeks={pw.map((x) => x.start)} format={(v) => hours(v)} yFormat={(v) => `${Math.round(v)}h`}
              series={[{ name: "AI-assisted", color: C.ai, values: pw.map((x) => x.p50_cycle_hours_ai) }, { name: "Human-only", color: C.human, values: pw.map((x) => x.p50_cycle_hours_human) }]} />
          </Panel>
          {lc && (
            <Panel title="Lifecycle decomposition" scope="Median hours per stage, AI-assisted vs human-only PRs"
              finding={{ ask, text: lc.ai.coding_hours != null && lc.human.coding_hours ? `AI changes the build phase ${x1(ratio(lc.human.coding_hours, lc.ai.coding_hours))}; review takes ${hours(lc.ai.review_hours)} vs ${hours(lc.human.review_hours)}.` : `${lc.ai.prs} AI-assisted and ${lc.human.prs} human-only merged PRs.`,
                question: "Which stage of the pull request lifecycle (build, pickup, review) is the bottleneck for AI-assisted work?" }}>
              <StackedHBars format={(v) => `${Math.round(v)}h`} stages={[{ name: "Commit → PR open", color: C.human2 }, { name: "PR open → review", color: C.human }, { name: "Review → merge", color: C.aiBar }]}
                rows={[{ label: "Human-only", values: [lc.human.coding_hours, lc.human.pickup_hours, lc.human.review_hours] }, { label: "AI-assisted", values: [lc.ai.coding_hours, lc.ai.pickup_hours, lc.ai.review_hours] }]} />
            </Panel>
          )}
        </>
      )}
      <div className="ins-cards" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(300px, 1fr)" }}>
        <Panel title="AI adoption vs throughput" scope="Each dot is a contributor · bubble size = lines · colour = 28-day trend"
          finding={{ ask, text: adoptionFinding(people), question: "Does higher AI adoption correlate with throughput here? Who is a heavy AI user but underperforming, and why?" }}>
          <Scatter dots={people.map((q) => ({ key: q.email, x: (q.ai_share ?? 0) * 100, y: q.recent_commits ?? 0, size: q.lines_added, color: trendColor(q.trend), label: q.name,
            tip: `${pct(q.ai_share)} AI · ${q.recent_commits ?? 0} commits in 28 days (${q.prior_commits ?? 0} before) · ${compact(q.lines_added)} lines` }))}
            xMax={100} xFormat={(v) => `${v}%`} yFormat={(v) => `${v}`} xLabel="% of commits with AI assistance" yLabel="Commits, last 28 days"
            legend={[{ name: "Trending up", color: C.ai }, { name: "Flat", color: C.ai2 }, { name: "Trending down", color: C.human2 }]} />
        </Panel>
        <Panel title="Engineer scorecard" scope="Who is using AI most">
          <Table head={["Name", "AI", "Commits", "Rework"]} align={["l", "r", "r", "r"]} rows={[...r.contributors].sort((a, b) => b.ai_commits - a.ai_commits).slice(0, 8).map((q) => [
            <div className="row" style={{ gap: 8, minWidth: 0 }}><Avatar name={q.name} /><div style={{ minWidth: 0 }}><div className="ins-truncate" style={{ fontWeight: 500 }}>{q.name}</div><div className="ins-caption2 muted">{q.commits} commits · {compact(q.lines_added)} lines</div></div></div>,
            <span className="ins-num">{pct(q.ai_share)}</span>, <span className="ins-num">{q.ai_commits}</span>, <span className="ins-num">{pct(q.rework_rate)}</span>,
          ])} />
        </Panel>
      </div>
      <Panel title="Cohort durability" scope={`Commits indexed to each engineer's pre-AI baseline · 100% = baseline · ${r.cohort.engineers} engineers`} tip={r.cohort.basis}
        finding={co.length ? { ask, text: settle == null ? "Not enough weeks after the first AI commit to judge durability yet." : `From week 4 on, output settles at ${Math.round(settle * 100)}% of the pre-AI baseline.`,
          question: "Are the speed gains after adopting AI durable, or do they fade after the first weeks? Use the cohort durability figures." } : null}>
        {co.length ? (
          <WeekChart kind="linePoints" smooth height={200} weeks={co.map((o) => `${o.week > 0 ? "+" : ""}${o.week}W`)} marker="0W" label={(s) => s} tipTitle={(s) => `Week ${s} from the first AI commit`}
            refs={[{ value: 100, label: "Baseline" }]} format={(v) => `${Math.round(v)}%`} yFormat={(v) => `${v}%`}
            series={[{ name: "Median engineer", color: C.ai, values: co.map((o) => o.index * 100) }]} />
        ) : <span className="muted">Needs contributors with at least two weeks of commits before their first AI commit.</span>}
      </Panel>
      <Panel title="Throughput trend" scope="Weekly commits · AI-assisted vs human-only"
        finding={{ ask, text: aiShareOfCommits ? `Last week: ${aiShareOfCommits.commits_ai} AI-assisted and ${aiShareOfCommits.commits_human} human-only commits.` : "No commits in the period.", question: "How is total throughput trending, and what share of it is AI-assisted?" }}>
        <WeekChart kind="bar" height={180} weeks={w.map((x) => x.start)} empty="No commits in the period" format={(v) => num(v)}
          series={[{ name: "AI-assisted", color: C.aiBar, values: w.map((x) => x.commits_ai) }, { name: "Human-only", color: C.human2, values: w.map((x) => x.commits_human) }]} />
      </Panel>
      {p.available && (p.items ?? []).length > 0 && (
        <Panel title="Merged pull requests" scope={`${p.merged ?? 0} merged · ${p.ai_assisted ?? 0} AI-assisted · ${p.unreviewed ?? 0} unreviewed · ${p.reviews_per_pr?.toFixed(1) ?? "–"} reviews per PR`}>
          <Table head={["PR", "Title", "Author", "Cycle", "First review", "Reviews"]} align={["l", "l", "l", "r", "r", "r"]} rows={(p.items ?? []).slice(0, 50).map((pr) => [
            <span className="mono ins-caption muted">#{pr.number ?? 0}</span>,
            <span className="row" style={{ gap: 6 }}>{pr.url && /^https?:\/\//i.test(pr.url) ? <a href={pr.url} onClick={(e) => { e.preventDefault(); appApi.open(pr.url!); }}>{pr.title ?? ""}</a> : pr.title}{pr.ai && <span className="ins-basis">AI</span>}</span>,
            <span className="muted">{pr.author ?? "–"}</span>, <span className="ins-num">{hours(pr.cycle_hours)}</span>, <span className="ins-num">{hours(pr.first_review_hours)}</span>, <span className="ins-num">{pr.reviews}</span>,
          ])} />
        </Panel>
      )}
    </>
  );
}

function adoptionFinding(people: Contributor[]): string {
  const heavy = people.filter((p) => (p.ai_share ?? 0) >= 0.5);
  const light = people.filter((p) => (p.ai_share ?? 0) < 0.1);
  const avg = (xs: Contributor[]) => (xs.length ? xs.reduce((s, p) => s + (p.recent_commits ?? 0), 0) / xs.length : null);
  const h = avg(heavy), l = avg(light);
  const down = heavy.filter((p) => p.trend === "down").length;
  if (h == null || l == null) return "Too few heavy and light AI users to compare throughput.";
  return `Heavy AI users average ${h.toFixed(1)} commits in 28 days vs ${l.toFixed(1)} for light users${down ? `; ${down} heavy user${down === 1 ? " is" : "s are"} trending down` : ""}.`;
}

// ---- Quality -----------------------------------------------------------------------------

export function Quality({ r, ask }: { r: ImpactReport; ask: Ask }) {
  const w = r.weekly;
  const ai = rate(r.quality.rework_rate, "ai"), hu = rate(r.quality.rework_rate, "human");
  const k = ratio(ai, hu);
  const sz = r.sizes;
  return (
    <>
      <Cards>
        <Metric title="Rework, AI vs human" level={reworkLevel(r)} scope={`Within ${Math.trunc(r.quality.window_days)} days`} tip={`Rework: ${r.quality.definition}. Healthy is under 1.2× the human rate; about 2× is typical for AI code.`}
          value={k != null ? `${k.toFixed(2)}×` : pct(ai)} chart={<Sparkline values={w.map((x) => (x.lines_ai > 0 && x.lines_human > 0 && x.rework_human > 0 ? (x.rework_ai / x.lines_ai) / (x.rework_human / x.lines_human) : null))} color={C.human} />}
          rec={{ ask, text: `AI ${pct(ai)} of lines rewritten vs human ${pct(hu)}.`, question: "Why is AI code reworked at this rate compared with human code, and what would bring it under 1.2×?" }} />
        <Metric title="AI durability" level={reworkLevel(r)} scope="AI lines still standing" value={pct(ai == null ? null : 1 - ai)}
          chart={<Sparkline values={w.map((x) => (x.lines_ai > 0 ? 1 - x.rework_ai / x.lines_ai : null))} />}
          rec={{ ask, text: `${compact(r.funnel.ai_lines_standing)} of ${compact(r.funnel.ai_lines)} AI lines survived the rework window.`, question: "Which kinds of AI-written code survive and which get rewritten?" }} />
        <Metric title="Large AI commits" level={sz.ai.large_share == null ? null : sz.ai.large_share > 0.3 ? "risk" : sz.ai.large_share > 0.15 ? "watch" : "healthy"} scope={`Share of AI commits over ${sz.large_lines} lines`}
          value={pct(sz.ai.large_share)} chart={<MiniBars values={w.slice(-12).map((x) => x.median_commit_lines_ai ?? null)} alert={(v) => v > sz.large_lines} />}
          rec={{ ask, text: `P90 AI commit ${sz.ai.p90 != null ? num(sz.ai.p90) : "–"} lines vs human ${sz.human.p90 != null ? num(sz.human.p90) : "–"}.`, question: "Are large AI commits driving review burden and rework? How should they be split?" }} />
      </Cards>
      <Panel title="Rework rate trend" scope="AI vs human, by the week the line was written" tip={`Rework: ${r.quality.definition}.`}
        finding={{ ask, text: k == null ? "No human baseline in the period to compare against." : k < 1.2 ? `AI rework is within the 1.2× guideline (${k.toFixed(2)}×).` : `AI rework runs ${k.toFixed(1)}× the human rate, above the 1.2× guideline.`,
          question: "Is AI rework trending toward or away from the 1.2× human guideline, and which weeks stand out?" }}>
        <WeekChart kind="linePoints" smooth weeks={w.map((x) => x.start)} format={(v) => pct(v)} yFormat={(v) => `${Math.round(v * 100)}%`}
          series={[
            { name: "AI", color: C.ai, values: w.map((x) => (x.lines_ai > 0 ? x.rework_ai / x.lines_ai : null)) },
            { name: "Human", color: C.human, values: w.map((x) => (x.lines_human > 0 ? x.rework_human / x.lines_human : null)) },
            { name: "1.2× human guideline", color: "var(--text-3)", dashed: true, points: false, values: w.map((x) => (x.lines_human > 0 ? (x.rework_human / x.lines_human) * 1.2 : null)) },
          ]} />
      </Panel>
      <Panel title="Rework hotspots" scope="Where code is rewritten soonest after it is written">
        {r.quality.hotspots.length === 0 ? <span className="muted">No code changes in the period.</span> : (
          <Table head={["Area", "Lines", "AI share", "Commits", "Reworked", "Rework rate"]} align={["l", "r", "l", "r", "r", "r"]} rows={r.quality.hotspots.map((h) => {
            const lv: Level = (h.rework_rate ?? 0) > 0.3 ? "risk" : (h.rework_rate ?? 0) > 0.15 ? "watch" : "healthy";
            return [
              <span className="mono ins-caption">{h.area}</span>, <span className="ins-num">{compact(h.lines_added)}</span>,
              <div className="row" style={{ gap: 6 }}><div className="ins-meter" style={{ width: 70 }}><div style={{ width: `${(h.ai_share ?? 0) * 100}%`, background: C.ai }} /></div><span className="ins-num muted">{pct(h.ai_share)}</span></div>,
              <span className="ins-num">{h.commits}</span>, <span className="ins-num">{compact(h.rework_lines)}</span>,
              <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}><span className="ins-num">{pct(h.rework_rate)}</span><Pill level={lv} /></span>,
            ];
          })} />
        )}
      </Panel>
    </>
  );
}

// ---- Team --------------------------------------------------------------------------------

export function Team({ r, ask }: { r: ImpactReport; ask: Ask }) {
  const [all, setAll] = useState(false);
  const board = [...r.contributors].filter((p) => p.ai_commits > 0).sort((a, b) => b.ai_commits - a.ai_commits).slice(0, 10);
  const people = [...r.contributors].sort((a, b) => b.commits - a.commits);
  const shown = all ? people : people.slice(0, 12);
  return (
    <>
      <Cards min={420}>
        <Panel title="Active contributors per week" scope="Everyone who committed vs those using AI"
          finding={{ ask, text: `${r.adoption.ai_contributors} of ${r.adoption.contributors} contributors used AI in the period.`, question: "Summarise the team's weekly shipping momentum and AI adoption, and suggest next steps." }}>
          <WeekChart kind="area" height={180} weeks={r.weekly.map((w) => w.start)} format={(v) => num(v)}
            series={[{ name: "All", color: C.human, values: r.weekly.map((w) => w.contributors) }, { name: "Using AI", color: C.ai, values: r.weekly.map((w) => w.ai_contributors) }]} />
        </Panel>
        <Panel title="AI Adoption Board" scope="Ranked by AI commits in the period">
          {board.length === 0 ? <span className="muted">No AI commits in the period.</span> : board.map((p, i) => (
            <div key={p.email} className="ins-board-row">
              <span className="ins-rank">{i + 1}</span>
              <Avatar name={p.name} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="ins-truncate" style={{ fontWeight: 500 }}>{p.name}</div>
                <div className="ins-caption2 muted ins-truncate">{Object.keys(p.tools).join(" · ") || "tool unknown"}</div>
              </div>
              <Trend t={p.trend} />
              <span className="ins-num" style={{ width: 52, textAlign: "right", fontWeight: 600 }}>{pct(p.ai_share)}</span>
            </div>
          ))}
        </Panel>
      </Cards>
      <Section title="Profiles" sub="Auto-updated strengths and growth areas for every contributor" />
      <Cards min={300}>
        {shown.map((p) => (
          <section key={p.email} className="ins-mcard" aria-label={p.name}>
            <div className="ins-mcard-body">
              <div className="row" style={{ gap: 10 }}>
                <Avatar name={p.name} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="ins-mcard-title ins-truncate">{p.name}</div>
                  <div className="ins-caption2 muted">{p.commits} commits · {compact(p.lines_added)} lines · {p.active_days} active days</div>
                </div>
                <Trend t={p.trend} />
              </div>
              <div className="ins-stats">
                <div><span className="ins-stat">{x2(p.lift)}</span><span className="ins-caption2 muted">AI Lift</span></div>
                <div><span className="ins-stat">{pct(p.rework_rate == null ? null : 1 - p.rework_rate)}</span><span className="ins-caption2 muted">AI Quality</span></div>
                <div><span className="ins-stat">{pct(p.ai_share)}</span><span className="ins-caption2 muted">AI share</span></div>
              </div>
              {p.strengths.map((s) => <span key={s} className="row ins-caption" style={{ gap: 6, color: "var(--ins-healthy)", alignItems: "flex-start" }}><CheckCircle2 size={13} />{s}</span>)}
              {p.growth.map((s) => <span key={s} className="row ins-caption" style={{ gap: 6, color: "var(--ins-watch)", alignItems: "flex-start" }}><ArrowUpRight size={13} />{s}</span>)}
              {p.areas.length > 0 && <span className="ins-caption2 muted ins-clamp2">Areas: {p.areas.join(", ")}</span>}
            </div>
          </section>
        ))}
      </Cards>
      {people.length > 12 && <div><Button size="small" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${people.length}`}</Button></div>}
    </>
  );
}

// ---- Prices ------------------------------------------------------------------------------

export function Prices({ root, r, changed, note }: { root: string; r: ImpactReport; changed: () => void; note: (m: string) => void }) {
  const [input, setInput] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<Record<string, string>>({});
  const isNum = (s: string | undefined) => s != null && s.trim() !== "" && !isNaN(Number(s));
  const unpriced = Object.entries(r.spend.unpriced_tokens).sort((a, b) => b[1] - a[1]);
  if (!unpriced.length) return null;
  const setPrice = async (model: string) => {
    const i = input[model], o = output[model];
    if (!isNum(i) || !isNum(o)) return;
    const e = await runImpact(root, ["price", model, "--input", i!, "--output", o!]);
    if (e) note(e);
    changed();
  };
  return (
    <Panel title="Models without a price" level="watch" scope={`Not in the spend, so the ROI multiple is an upper bound · ${r.roi.currency} per million tokens`}>
      {unpriced.map(([model, tokens]) => (
        <div key={model} className="row" style={{ gap: 10 }}>
          <span className="mono ins-caption">{model}</span>
          <span className="muted">{num(tokens)} tokens</span>
          <span className="spacer" />
          <input className="text-field" style={{ width: 70 }} placeholder="Input" aria-label={`Input price for ${model}`} value={input[model] ?? ""} onChange={(e) => setInput({ ...input, [model]: e.target.value })} />
          <input className="text-field" style={{ width: 70 }} placeholder="Output" aria-label={`Output price for ${model}`} value={output[model] ?? ""} onChange={(e) => setOutput({ ...output, [model]: e.target.value })} />
          <Button size="small" disabled={!isNum(input[model]) || !isNum(output[model])} onClick={() => setPrice(model)}>Set price</Button>
        </div>
      ))}
    </Panel>
  );
}

