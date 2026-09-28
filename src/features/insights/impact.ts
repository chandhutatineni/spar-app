// `spar impact report --json`: AI adoption, output, rework, delivery, spend and ROI for the
// project. Every figure is computed by the CLI; the app only shows it. A port of
// Backend/Impact.swift. Field names stay as the CLI writes them (snake_case).

import { spar } from "../../lib/api";

export interface Baseline { mode: string; since?: string | null; recorded_at?: string | null; by?: string | null; note?: string | null }
export interface Period { start?: string | null; end: string }
export interface Sources {
  git: boolean; commits: number; commits_in_period: number; sessions: number;
  transcript_messages: number; app_turns: number; pull_requests: boolean;
}
export interface Adoption {
  commits: Record<string, number>; ai_share: number | null; contributors: number; ai_contributors: number;
  tools: Record<string, number>; declared_commits?: number | null;
}
export interface Output {
  lines_added: Record<string, number>; lines_removed: Record<string, number>; ai_line_share: number | null;
  by_category: Record<string, Record<string, number>>; note: string;
}
export interface Hotspot { area: string; lines_added: number; ai_share: number | null; commits: number; rework_lines: number; rework_rate: number | null }
export interface Quality {
  window_days: number; rework_lines: Record<string, number>; rework_rate: Record<string, number | null>;
  hotspots: Hotspot[]; definition: string;
}
export interface Delivery {
  sessions: number; open_sessions: number; tasks_measured: number; tasks_done: number;
  first_pass_rate: number | null; median_task_hours: number | null; measured_hours: number;
  tasks_ticked: number; unmeasured_tasks: string[];
}
export interface TaskRow {
  feature?: string | null; task: string; attempts: number; status: string;
  first_start?: string | null; last_end?: string | null; lines_added: number; lines_removed: number;
  commits: number; tokens: number; cost_usd: number; cost_complete: boolean;
  agents: string[]; issue?: string | null; hours: number;
}
export interface ModelSpend { messages: number; input: number; output: number; cache_read: number; cache_write: number; tokens: number; cost_usd: number; basis: string[] }
export interface Spend {
  tokens: number; cost_usd: number; priced_usd: number; reported_usd: number;
  unpriced_tokens: Record<string, number>; complete: boolean; by_model: Record<string, ModelSpend>;
}
export interface Figure { value: number; basis: string }
export interface Hours { value: number; measured?: number | null; estimated?: number | null; basis: string }
export interface QualityCost { value: number; excess_rework_lines: number; basis: string }
export interface SpendFigure { value: number; complete: boolean }
export interface ROI {
  currency: string; rate_per_hour: Figure; human_loc_per_hour: Figure; ai_lines: Figure;
  ai_hours: Hours; human_equivalent_hours: Figure; quality_cost_hours: QualityCost;
  hours_saved: number; value: number; spend: SpendFigure; net: number;
  multiple: number | null; multiple_is_upper_bound: boolean; formula: string;
}
export interface Week {
  week: string; start: string; commits_ai: number; commits_human: number;
  lines_ai: number; lines_human: number; rework_ai: number; rework_human: number;
  contributors: number; ai_contributors: number; sessions: number; tasks_done: number;
  session_hours: number; tokens: number; cost_usd: number;
  ai_dev_days?: number; human_dev_days?: number; lift?: number | null;
  median_commit_lines_ai?: number | null; median_commit_lines_human?: number | null;
}
export interface Contributor {
  name: string; email: string; commits: number; ai_commits: number; ai_share: number | null;
  lines_added: number; ai_lines_added: number; test_lines_added: number; rework_lines: number;
  rework_rate: number | null; active_days: number; areas: string[]; tools: Record<string, number>;
  first?: string | null; last?: string | null; estimated_hours: number;
  strengths: string[]; growth: string[];
  recent_commits?: number; prior_commits?: number; trend?: "up" | "flat" | "down"; lift?: number | null;
}
export interface PullRequest {
  number?: number | null; title?: string | null; author?: string | null; ai: boolean;
  cycle_hours?: number | null; first_review_hours?: number | null; reviews: number; additions?: number | null; url?: string | null;
  created_at?: string | null; merged_at?: string | null; coding_hours?: number | null; review_to_merge_hours?: number | null;
}
export interface PRWeek { week: string; start: string; merged_ai: number; merged_human: number; p50_cycle_hours_ai: number | null; p50_cycle_hours_human: number | null }
export interface PRStages { prs: number; coding_hours: number | null; pickup_hours: number | null; review_hours: number | null; cycle_hours: number | null }
export interface PullRequests {
  available: boolean; reason?: string | null; fetched_at?: string | null; merged?: number | null; ai_assisted?: number | null;
  median_cycle_hours_ai?: number | null; median_cycle_hours_human?: number | null; median_first_review_hours?: number | null;
  reviews_per_pr?: number | null; unreviewed?: number | null; items?: PullRequest[] | null;
  weekly?: PRWeek[]; lifecycle?: { ai: PRStages; human: PRStages; stages: string[] };
}
export interface Lift {
  lines_per_dev_day_ai: number | null; lines_per_dev_day_human: number | null; multiple: number | null;
  commits_per_dev_day_ai: number | null; commits_per_dev_day_human: number | null;
  ai_dev_days: number; human_dev_days: number; ai_commits_per_dev_day: number | null;
  by_contributor: Record<string, number | null>; basis: string;
}
export interface SizeStats { commits: number; median: number | null; p90: number | null; mean: number | null; large_share: number | null }
export interface Sizes { ai: SizeStats; human: SizeStats; large_lines: number; pr_ai_median: number | null; pr_human_median: number | null; basis: string }
export interface Day {
  date: string; commits_ai: number; commits_human: number; lines_ai: number; lines_human: number; lines_removed: number;
  files: number; contributors: number; ai_contributors: number; messages: number; sessions: number;
  tokens_in: number; tokens_out: number; session_hours: number; cost_usd: number; value_usd: number; roi: number | null;
}
export interface Agent {
  messages: number; sessions: number; active_days: number; tokens_in: number; tokens_out: number;
  by_entrypoint: Record<string, number>; models: Record<string, number>; messages_per_active_day: number | null; basis: string;
}
export interface Funnel {
  ai_lines: number; ai_lines_standing: number; ai_lines_in_merged_prs: number | null;
  tasks_begun: number; tasks_done: number; tasks_first_pass: number; session_lines: number; basis: string;
}
export interface Cohort { engineers: number; offsets: { week: number; index: number; n: number }[]; basis: string }
export interface Ticket { key: string; tasks: string[]; hours: number; commits: number; ai_commits: number }
export interface Note { level: string; title: string; detail: string; next: string }
export interface Commit {
  sha: string; at: string; author: string; email: string;
  /** "ai" | "human" | "bot" | "untracked" (the Swift model's `kind`). */
  class: string; basis: string; tool?: string | null; task?: string | null;
  added: number; removed: number; subject: string;
}

export interface ImpactReport {
  project: string;
  generated_at: string;
  baseline: Baseline | null;
  period: Period;
  sources: Sources;
  adoption: Adoption;
  output: Output;
  quality: Quality;
  delivery: Delivery;
  tasks: TaskRow[];
  spend: Spend;
  roi: ROI;
  weekly: Week[];
  contributors: Contributor[];
  pull_requests: PullRequests;
  tickets: Ticket[];
  attention: Note[];
  commits: Commit[];
  lift: Lift;
  sizes: Sizes;
  daily: Day[];
  agent: Agent;
  funnel: Funnel;
  cohort: Cohort;
}

const EMPTY_SIZE: SizeStats = { commits: 0, median: null, p90: null, mean: null, large_share: null };

const REQUIRED: (keyof ImpactReport)[] = ["project", "generated_at", "period", "sources", "adoption", "output", "quality", "delivery",
  "tasks", "spend", "roi", "weekly", "contributors", "pull_requests", "tickets", "attention", "commits"];

/** Decodes the CLI's JSON; throws with a readable message when a part is missing. */
export function decodeReport(stdout: string): ImpactReport {
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error("no JSON in the output");
  const r = JSON.parse(stdout.slice(start));
  const missing = REQUIRED.filter((k) => r[k] === undefined);
  if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
  r.baseline ??= null;
  // Reports from a CLI older than 0.3.5 lack the insights blocks; the page shows them empty.
  r.lift ??= { lines_per_dev_day_ai: null, lines_per_dev_day_human: null, multiple: null, commits_per_dev_day_ai: null, commits_per_dev_day_human: null,
    ai_dev_days: 0, human_dev_days: 0, ai_commits_per_dev_day: null, by_contributor: {}, basis: "" };
  r.sizes ??= { ai: EMPTY_SIZE, human: EMPTY_SIZE, large_lines: 400, pr_ai_median: null, pr_human_median: null, basis: "" };
  r.daily ??= [];
  r.agent ??= { messages: 0, sessions: 0, active_days: 0, tokens_in: 0, tokens_out: 0, by_entrypoint: {}, models: {}, messages_per_active_day: null, basis: "" };
  r.funnel ??= { ai_lines: 0, ai_lines_standing: 0, ai_lines_in_merged_prs: null, tasks_begun: 0, tasks_done: 0, tasks_first_pass: 0, session_lines: 0, basis: "" };
  r.cohort ??= { engineers: 0, offsets: [], basis: "" };
  return r as ImpactReport;
}

export type ImpactResult = { ok: true; report: ImpactReport } | { ok: false; message: string };

/** Runs the CLI. `prs` also fetches merged pull requests with gh first. */
export async function loadImpact(root: string, prs = false): Promise<ImpactResult> {
  const args = ["impact", "report", "--json"];
  if (prs) args.push("--prs");
  const out = await spar(root, args, { timeoutMs: 180_000 }).catch((e) => ({ ok: false, status: -1, stdout: "", stderr: String(e) }));
  if (!out.ok) return { ok: false, message: out.stderr.trim() ? out.stderr : `spar impact failed (exit ${out.status})` };
  try {
    return { ok: true, report: decodeReport(out.stdout) };
  } catch (e) {
    return { ok: false, message: `The impact report could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** `spar impact <args>` for settings, prices and the baseline. Returns an error message or null. */
export async function runImpact(root: string, args: string[]): Promise<string | null> {
  const out = await spar(root, ["impact", ...args], { timeoutMs: 180_000 }).catch((e) => ({ ok: false, status: -1, stdout: "", stderr: String(e) }));
  if (out.ok) return null;
  const msg = (out.stderr + out.stdout).trim();
  return msg || `spar impact ${args[0] ?? ""} failed`;
}

export const pct = (x: number | null | undefined) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);

export function money(x: number, currency = "USD"): string {
  const digits = Math.abs(x) < 10 ? 2 : 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(x);
  } catch {
    return x.toFixed(2);
  }
}

export const num = (n: number) => Math.round(n).toLocaleString();
/** 14.2k, 1.3M. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return a < 10 && a % 1 ? n.toFixed(1) : Math.round(n).toLocaleString();
}
export const hours = (h: number | null | undefined) => (h == null ? "–" : `${h.toFixed(1)} h`);
/** `String(format: "%g")`. */
export const g = (v: number) => String(Number(v.toPrecision(6)));

export const rate = (r: Record<string, number | null>, k: string) => r[k] ?? null;

/** The report for the agent: the headline figures and what needs attention, as plain text. */
export function advisorBrief(r: ImpactReport): string {
  let s = `AI impact for ${r.project}, ${r.period.start?.slice(0, 10) ?? "start"} to ${r.period.end.slice(0, 10)}.\n`;
  s += `Commits: ${r.adoption.commits.ai ?? 0} AI, ${r.adoption.commits.human ?? 0} human. `;
  s += `Lines: ${r.output.lines_added.ai ?? 0} AI, ${r.output.lines_added.human ?? 0} human.\n`;
  s += `Rework within ${Math.trunc(r.quality.window_days)} days: AI ${pct(rate(r.quality.rework_rate, "ai"))}, human ${pct(rate(r.quality.rework_rate, "human"))}.\n`;
  s += `Spend ${money(r.spend.cost_usd, r.roi.currency)}${r.spend.complete ? "" : " (incomplete)"}; ROI value ${money(r.roi.value, r.roi.currency)}, multiple ${r.roi.multiple != null ? `${r.roi.multiple.toFixed(1)}x` : "n/a"}.\n`;
  if (r.lift.multiple != null) s += `Productivity lift: ${r.lift.multiple}x (${r.lift.lines_per_dev_day_ai} vs ${r.lift.lines_per_dev_day_human} lines per person-day, AI days vs human-only days); ${r.lift.ai_commits_per_dev_day ?? "n/a"} AI commits per AI-active day.\n`;
  if (r.sizes.ai.median != null) s += `Commit size: AI median ${r.sizes.ai.median} lines (P90 ${r.sizes.ai.p90}), human median ${r.sizes.human.median}; ${pct(r.sizes.ai.large_share)} of AI commits over ${r.sizes.large_lines} lines.\n`;
  s += `Contributors: ${r.adoption.ai_contributors} of ${r.adoption.contributors} use AI. Tools: ${Object.entries(r.adoption.tools).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.\n`;
  if (r.agent.messages) s += `Agent: ${r.agent.messages} messages in ${r.agent.sessions} sessions over ${r.agent.active_days} days.\n`;
  if (r.cohort.offsets.length) s += `Cohort (${r.cohort.engineers} engineers, index vs pre-AI baseline by week): ${r.cohort.offsets.map((o) => `${o.week}:${o.index}`).join(" ")}.\n`;
  if (r.pull_requests.available) s += `Pull requests: ${r.pull_requests.merged} merged, ${r.pull_requests.ai_assisted} AI-assisted; median cycle AI ${hours(r.pull_requests.median_cycle_hours_ai)}, human ${hours(r.pull_requests.median_cycle_hours_human)}.\n`;
  for (const h of r.quality.hotspots.slice(0, 5)) s += `Hotspot ${h.area}: ${h.lines_added} lines, rework ${pct(h.rework_rate)}.\n`;
  for (const n of r.attention) s += `Attention: ${n.title} — ${n.detail}\n`;
  return s;
}

/** yyyy-MM-dd for a local date. */
export const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
