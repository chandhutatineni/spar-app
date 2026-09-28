# exceeds.ai: what the product measures, why, and how it draws it

Research for the SPAR AI Impact page redesign, done 2026-09-27. Sources: the live site
(https://www.exceeds.ai/, https://www.exceeds.ai/ink), the product images it publishes
(`/images/dash-*.png`, `/images/report-preview.png`), and the Exceeds blog
(https://blog.exceeds.ai/). Screenshots, taken with a private headless Chromium, are in
`/Users/chandhu/aegis/.playwright-mcp/exceeds-*.png`:

| File | What it shows |
|---|---|
| `exceeds-home.png` | the whole landing page |
| `exceeds-hero-ai-insights.png` | the AI Insights dashboard (the landing page's interactive product mock, unclipped) |
| `exceeds-hero-roi.png` | the ROI dashboard: Summary and Developer Impact |
| `exceeds-hero-agentic-insights.png` | Agentic Insights: an engineer's agent profile |
| `exceeds-hero-capacity.png` | Capacity Overview: cycle time, lifecycle, cohorts, throughput |
| `exceeds-img-dash-ai-visibility.png` | an individual's profile card with AI Lift, AI Quality, AI Score |
| `exceeds-img-dash-quality.png` | a trend chart with P50/P75/P90 industry benchmark lines |
| `exceeds-img-dash-team-pulse.png` | PRs merged per developer, AI adoption leaderboard |
| `exceeds-img-dash-prompt-to-pr.png` | the prompt-to-PR token funnel |
| `exceeds-img-dash-advisor.png` | the Exceeds Assistant (advisor) panel |
| `exceeds-img-report-preview.png` | the exportable "AI Impact Report" |
| `exceeds-ink.png` | the Ink add-on page (funnel, model mix, live totals, spend by feature) |

Exceeds does not publish its formulas or the thresholds behind its status pills
(https://blog.exceeds.ai/prove-ai-improves-developer-productivity/ gives results, not
methods). Where a definition below says "stated", it is quoted from their material;
where it says "inferred", it is read off the dashboards.

## 1. Information architecture

A left sidebar with three groups (home-page mock, `exceeds-hero-*.png`):

- **Dashboards**: Team Dashboard (custom).
- **Insights**: AI Insights · ROI · Agentic Insights · General Metrics · Capacity Overview · Assistant.
- **Team**: My Activity · Teams (people).

Every screen has the same header: a serif page title, a one-line purpose ("Track
AI-driven metrics and insights across your repositories to measure development
impact"), and two filters on the right: **time range** ("Last 30 days", "Last 90 days",
"Last 4 Sprints") and **team** ("All teams"). ROI has sub-tabs: Summary · Developer
Impact · How AI Is Used · Features · Activity.

The home page sells the same structure as "four metric layers"
(https://blog.exceeds.ai/measure-code-level-ai-roi/): **Adoption** (AI % of diffs, tool
mix) → **Productivity** (cycle time, throughput) → **Quality** (defects, incidents,
maintainability) → **Efficiency** (rework, review iterations, debt), and on top of them
**ROI** and **coaching** ("What matters, what needs attention, what to do next").

### The card pattern (every metric)

Every metric is a white card, radius ~12px, hairline border, with:

1. **Title + status pill** — HEALTHY / GOOD (green `#009966`, white caps), WATCH
   (orange `#e17100`), AT RISK (red `#ff2056`). The pill is a label, so the state is
   never colour alone.
2. **Scope caption** with an ⓘ tooltip: "Last 30 days", "% of active AI users",
   "Avg loc of AI-written PRs".
3. **One big number** (~40px, semibold, proportional figures) with a **sparkline**
   (teal line + 10% teal area wash) or mini bars to its right.
4. **A footer strip** (slightly grey) with a sparkle icon, a one-line
   **recommendation** and a chevron to drill down: "Identify teams that need extra
   onboarding or coaching to keep AI adoption climbing week over week."

Above the cards a **headline insight banner**: "AI Integration boosts productivity but
risks code quality and team efficiency — Optimize AI tool diversity and training…" with
a **Dive Deeper** button that opens the assistant. Capacity charts end with a
one-sentence finding and an **Ask AI** button ("AI-assisted PRs close ~3× faster — gap is
widening").

### Colour language (sampled from the screenshots)

| Role | Colour |
|---|---|
| AI / AI-assisted series, sparklines, bars | teal `#009689` (lines), `#00786f` (bars) |
| Second AI series (Claude Code in the donut, "Flat") | dark teal `#0b4f4a` |
| Human-only (cycle time line, lifecycle) | coral `#d16c52` |
| Human-only (throughput stacked bars) | yellow `#ffd230` |
| Third/fourth categories (Codex, OpenCode) | amber `#fe9a00`, yellow `#ffd230` |
| Gain / positive ROI | green `#059669` → pale `#8bcab5` by magnitude |
| Loss / negative ROI | salmon `#dc9582` |
| Brand accent (sparkle icons, eyebrow text) | terracotta `#c65a3a` |
| Surfaces | warm off-white page `#f8f7f4`, white cards |

AI is always teal. Human is warm (coral or yellow): the pair teal-vs-warm is the
consistent contrast even though the exact warm hue varies between charts.

## 2. Screen by screen, metric by metric

### 2.1 AI Insights (`exceeds-hero-ai-insights.png`)

| Metric | Definition | Why it matters (their words) | Visual |
|---|---|---|---|
| **AI-Assisted Code Contribution** 82.0% HEALTHY | share of code (lines/diffs) that is AI-generated, "multi-signal detection analyzing code patterns, commit messages, and optional telemetry" (stated, https://blog.exceeds.ai/metrics-ai-coding-tools-impact/) | "Compare AI-generated code across vendors to understand which tools truly drive contribution." Baseline adoption visibility; "one mid-market customer found 58% of commits were AI-generated". | KPI + teal sparkline |
| **AI Productivity Lift** 1.44x WATCH | output of AI-assisted work relative to non-AI work; "throughput, cycle time, and engagement deltas correlated with AI commit percentage" (stated, https://blog.exceeds.ai/enterprise-ai-adoption-metrics-2025/); benchmark "18% team productivity lift", daily AI users merge "2.3 PRs per week, 60% more than non-users at 1.4" | "Benchmark productivity gains across Cursor, Claude, Gemini, and GPT to guide tooling strategy." | KPI (×) + sparkline |
| **AI Code Quality** 76.0% HEALTHY | quality score of AI code: rework, review iterations, merge success (inferred; the "AI Adoption Trust Score" combines "merge rate, rework, iterations, test pass rate, and incidents", >75/100 is healthy, https://blog.exceeds.ai/best-ai-pr-quality-metrics/) | "Analyze quality differences across AI tools to refine vendor selection and coding standards." | KPI % + sparkline |
| **AI Usage Percentage** GOOD | % of active engineers who used AI that week | "Identify teams that need extra onboarding or coaching to keep AI adoption climbing week over week." Healthy: "40% utilization after three months… below 30% signals ROI risk". | smooth area line, 0–100 y-axis, weeks on x |
| **AI Tools Breakdown** | share of AI-assisted work by tool: Cursor 52%, Claude Code 22%, Codex 14%, OpenCode 12% | "Evaluate your vendor mix to avoid single-tool dependency, contain spend, and keep your team resilient to model changes." "Average developer now uses 2–4 AI-powered tools." | donut + legend with % right-aligned |
| **AI PR Size** 612 AT RISK | average LOC of AI-written PRs | "Assess AI-generated PR sizes by tool to determine where over-generation may be occurring." "Median PR batch size roughly doubled between Q1 2025 and Q1 2026"; large changes raise review burden and incident risk. | KPI + mini column chart, the latest (worst) column in red |
| **AI Commits Per Dev Per Day** 1.4 WATCH | AI commits ÷ AI-active developer-days | "Compare commit patterns across tools and teams to identify where AI accelerates, or slows, delivery." Spiky AI commits "indicated context switching that disrupted flow and increased rework". | KPI + amber area sparkline |

### 2.2 ROI (`exceeds-hero-roi.png`)

Purpose line: "Convert AI tool spend, time saved, and shipped value into a single ROI you
can defend to finance." Formula (stated, https://blog.exceeds.ai/measure-code-level-ai-roi/):
**(AI Productivity Lift × Developer Output × Hourly Rate) – AI Tool Costs**; the home page
headline: "$125K AI spend → $235K return. 1.88x ROI after quality costs."

| Metric | Definition | Visual |
|---|---|---|
| **Blended AI ROI** 3.8x | value ÷ spend "across all models and tools" | tile: caps label, big value, caption, 90-day teal area sparkline with "90d ago … Today" |
| **Net AI value shipped** $248K | value linked to AI sessions, net of spend | same tile |
| **Average engineer spend** $182 | spend ÷ engineers ("active time with AI tools") | same tile, amber sparkline (spend is the cost colour) |
| **Hours saved / engineer** 11.6 | hours saved ÷ engineers | same tile |
| **Daily AI ROI** | one cell per day for 90 days, value per $ spent; diverging colour: salmon = loss, grey = break-even, green = gain; legend "Loss · Break-even · Gain" | calendar strip (heat cells) |
| **Spend by Feature** | per feature category: cost, LOC, ROI; bar length = cost, bar colour = ROI (green shades for gain, salmon for loss) | horizontal bars with the name inside, table columns COST · LOC · ROI to the right, ROI signed and coloured |
| **ROI by Tool** "sized by spend" | ROI and spend per AI tool | treemap; tile colour = ROI (green gain, salmon loss) |
| **ROI by Team** top 6 | ROI per team, engineer count | bar list: name, meter bar, ROI, "12 engineers" |
| **Developer Impact** | Top leverage (lines per $), Highest spend, Most AI lines merged | three leader tiles |
| **Cost vs Output** | x = spend, y = AI lines, bubble size = session count, one bubble per engineer, labelled | bubble scatter |

### 2.3 Agentic Insights (`exceeds-hero-agentic-insights.png`)

A People table (name … spend) opens an engineer drawer with tabs **Profile · Agent
Sessions**. "7-Day Summary" tiles, each a number + 7 mini daily bars: **Sessions per
day**, **Agent interactions / day**, **Files changed / day**, **LOC changed / day**
(+3,625 / −1,184), **Mode breakdown** (Ask 14% · Agent 76% · Plan 6% · Edit 4%, chips with
coloured dots), **Tokens in / out per day**. Then **Commits** (36; 25,377 accepted lines
across 2 repos) split **by tool** (CLAUDE-CODE 35 commits · 24,473 accepted lines;
CURSOR 1 commit) and **Model usage (7d)** (295 tagged turns). Rationale (Ink page,
https://www.exceeds.ai/ink): "Spend per agent — model, mode, and session", "Which models
are eating spend?", "Where does AI work fall off?" (funnel GENERATED 100% → COMMITTED 71%
→ OPENED IN PR 47% → MERGED 42%).

### 2.4 Capacity Overview (`exceeds-hero-capacity.png`)

"See where each team is spending its hours and where bandwidth is opening up next
sprint." Each chart ends with a finding + **Ask AI**.

| Chart | Definition | Visual |
|---|---|---|
| **AI-assisted vs human-only cycle time** | weekly P50 PR cycle time, two lines | line + points; AI teal, human coral; axis "Time" 0–16h, x "Sprints" |
| **Lifecycle decomposition** | median hours per stage for AI vs human PRs: Prompt→commit, Commit→PR open, PR open→review, Review→merge | two horizontal stacked bars, four stage colours (yellow, dark teal, coral, teal) |
| **AI adoption vs throughput** | one dot per engineer: x = % of PRs with AI, y = PRs merged this cycle, size = LOC, colour = trend (up teal, flat dark teal, down yellow) | bubble scatter |
| **Engineer scorecard** | per engineer: PRs, cycle, wait; "13 commits · 18,356 lines" | table with avatar |
| **Cohort durability** | throughput indexed to each engineer's pre-AI baseline (100%), x = weeks relative to first AI-assisted PR, one line per adoption cohort | multi-line chart with a dashed 100% baseline and a dashed 0W marker |
| **Throughput trend** | weekly merged PRs, AI-assisted vs human-only | stacked columns, AI teal bottom, human yellow top |

Rationale: PR cycle time delta ("cycle time dropped from 6.1 to 5.3 days (13%) after
Copilot rollout", https://blog.exceeds.ai/metrics-ai-coding-tools-impact/); "Even when
engineers code three times faster, organizations see only about 2–5% more output"
(https://blog.exceeds.ai/enterprise-ai-adoption-metrics-2025/), hence decomposing where
the time goes.

### 2.5 Quality & risk (home page, `exceeds-img-dash-quality.png`)

"AI writes code fast. Is it writing it well? Compare AI-assisted vs. manual code quality
in real time. Spot rework hotspots by team and repo before they compound." The image alt
text: "AI vs manual code quality dashboard with rework rate trend and a hotspot score
table by team and repo". Benchmarks are drawn as **P50 / P75 / P90 horizontal lines**
("performance percentiles across 1,000 engineering teams") with a hover card naming the
source and period.

| Metric | Definition and threshold (stated) |
|---|---|
| **Rework rate, AI vs human** | "% of AI-touched PRs needing follow-on edits within 30 days versus human-only"; healthy **< 1.2× human baseline**; "AI typically runs at roughly 2x human rework"; "code churn has doubled for AI-generated code, with developers rewriting or deleting code within two weeks" (https://blog.exceeds.ai/best-ai-pr-quality-metrics/, https://blog.exceeds.ai/metrics-ai-coding-tools-impact/) |
| **Review iterations** | review cycles before merge, healthy < 2.5 |
| **Test coverage differential** | AI code coverage > 85% of human coverage |
| **Merge success rate** | > 92% |
| **Incident rate, 30–90 days** | < 1.1× human baseline |
| **Semantic review depth** | review thoroughness score vs P50/P75/P90 |

### 2.6 Team: profiles and leaderboards

- **Individual profile** (`exceeds-img-dash-ai-visibility.png`): avatar with rank badge,
  "13 commits · 18,356 lines", **AI Lift** 1.89x, **AI Quality** 90%, **AI Score** 93%;
  their AI Usage % line; "Auto-updated strengths, growth areas, and coaching for every
  engineer."
- **AI Adoption Board** (`exceeds-img-dash-team-pulse.png`): ranked list for a week,
  name, tools used ("Claude code · Copilot"), AI %.
- **PRs merged per developer**: weekly teal columns, HEALTHY.
- **Weekly team pulse** (alt text): "shipping momentum, collaboration, and PR review
  insights plus suggested next steps".

### 2.7 Advisor (`exceeds-img-dash-advisor.png`)

"An assistant doesn't just flag issues. It explains them. When a metric needs attention,
get the why and the what-to-do-next. Answers grounded in your team's actual commit data
and ticketing activity." Reached from Dive Deeper / Ask AI on every chart.

### 2.8 Report (`exceeds-img-report-preview.png`)

"Engineering AI Impact Report": three rated tiles (AI Adoption Rate HIGH, AI
Productivity Lift OK, AI Code Quality BAD), then "Manager Questions Answered" — "What's a
good company AI adoption rate?" 91.4% "↑7.5% above peers · Top 25% of companies" with a
recommendation footer.

## 3. Mapping to SPAR (one project, git + SPAR's own records)

SPAR measures one repository from its git history (commits, AI trailers, `git blame`
rework), SPAR sessions (`spar impact begin/end`), Claude Code transcripts (tokens,
priced cost), the SPAR app's measured turn cost, and optionally merged PRs via `gh`.
It has no teams, no ticket system beyond Jira keys, no per-engineer spend (transcripts
live on one machine), no incidents, no coverage, and no cross-company benchmarks.

| Exceeds metric | SPAR | How |
|---|---|---|
| AI-Assisted Code Contribution | **available** | `output.ai_line_share`; weekly series from `weekly.lines_ai/lines_human` |
| AI Productivity Lift | **CLI extended** | new `lift`: delivered lines per active developer-day on days with AI commits ÷ on human-only days; plus commits per day. Same repo, same people, so it is a like-for-like ratio |
| AI Code Quality | **available (derived)** | durability = 1 − AI rework rate within the window; compared with human durability |
| AI Usage Percentage | **available** | `weekly.ai_contributors / contributors` |
| AI Tools Breakdown | **available** | `adoption.tools` (commit trailers per tool) |
| AI PR Size | **CLI extended** | new `sizes`: median and P90 lines per AI and human commit, weekly; PR additions when PRs are fetched |
| AI Commits Per Dev Per Day | **CLI extended** | `lift.ai_commits_per_dev_day` |
| Status pills | **UI** | thresholds from Exceeds' published guidance (rework < 1.2× human healthy, ≥ 2× at risk; adoption ≥ 40% healthy, < 30% at risk; lines per AI commit > 400 at risk) |
| Recommendation footers, headline banner | **UI** | rule-based from the figures and `attention`; "Dive deeper" asks the advisor |
| Blended ROI, net value, hours saved | **available** | `roi.*` |
| Average engineer spend, hours saved / engineer | **available (derived)** | ÷ `adoption.ai_contributors` |
| Daily AI ROI heat strip | **CLI extended** | new `daily` series (last 90 days): AI lines, value, spend; cell = value ÷ spend, diverging loss/break-even/gain |
| Spend by Feature | **available (derived)** | SPAR features = spec features; tasks carry feature, cost, lines; ROI per feature = task lines at human speed × rate ÷ cost |
| ROI by Tool (treemap by spend) | **partial** | spend is known per model (`spend.by_model`), not per git tool; shown as a spend-by-model treemap. ROI per tool is not possible: Cursor/Copilot spend is invisible to SPAR |
| ROI by Team | **not possible** | no teams in one repo; replaced by per-contributor output |
| Cost vs Output per engineer | **not possible as drawn** | spend is per machine, not per person; replaced by AI adoption vs output per contributor |
| Agentic: sessions/interactions/tokens per day, model usage | **CLI extended** | new `agent` block from the transcripts ledger: per day messages, sessions, tokens in/out; by model; by entry point (CLI, SPAR app, IDE) as the "mode" breakdown |
| Files / LOC changed per day | **CLI extended** | `daily.files`, `daily.lines_added/removed` |
| Prompt→PR funnel | **CLI extended** | new `funnel`: AI lines committed → still standing after the rework window; tasks begun → done → done first pass |
| AI vs human cycle time (weekly P50) | **CLI extended, needs PRs** | PR rows gain `created_at`, `merged_at`; weekly medians in `pull_requests.weekly` |
| Lifecycle decomposition | **CLI extended, needs PRs** | per PR: first commit → PR open (`coding_hours`), open → first review, first review → merge; medians AI vs human in `pull_requests.lifecycle` |
| AI adoption vs throughput scatter | **CLI extended** | contributors gain `recent_commits` / `prior_commits` (last 28 days vs the 28 before) and `trend` |
| Engineer scorecard, adoption board | **available** | `contributors` |
| Cohort durability | **CLI extended** | new `cohort`: each contributor's weekly delivered lines indexed to their own pre-AI weekly mean, by week relative to their first AI commit (−4…+12), mean across contributors with n |
| Throughput trend | **available** | weekly commits AI/human; merged PRs when fetched |
| Rework trend AI vs human, hotspots | **available** | `weekly.rework_*`, `quality.hotspots` |
| Benchmark lines P50/P75/P90 | **not possible** | no cross-company data; replaced by the human baseline and the 1.2× guideline line |
| Review iterations, merge rate, coverage, incidents, security | **not possible / partial** | reviews per PR only with PRs; no CI, coverage or incident data in git |
| Individual profile: AI Lift, AI Quality, strengths, growth | **available + extended** | `contributors[]` plus per-person lift from `lift.by_contributor` |
| Advisor | **available** | "Ask the advisor" sends `advisorBrief` to the agent |
| Report export | **available** | `spar impact report --format md/csv/json` |
