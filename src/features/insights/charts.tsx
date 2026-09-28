// Small SVG charts for the AI Impact page (Swift Charts' BarMark / LineMark + PointMark by
// week). Stacked bars or lines per week, a recessive grid, a legend for two or more series,
// and a per-week hover tooltip.

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface ChartSeries { name: string; color: string; values: (number | null)[]; dashed?: boolean; points?: boolean }

type Pt = readonly [number, number];

/** A polyline, or a Catmull-Rom curve through the points (control points kept inside [lo, hi]). */
function linePath(pts: Pt[], smooth: boolean, lo = -Infinity, hi = Infinity): string {
  if (!pts.length) return "";
  if (!smooth || pts.length < 3) return "M" + pts.map((p) => `${p[0]},${p[1]}`).join(" L");
  const c = (v: number) => Math.min(hi, Math.max(lo, v));
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${c(p1[1] + (p2[1] - p0[1]) / 6)} ${p2[0] - (p3[0] - p1[0]) / 6},${c(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const svgId = (id: string) => "g" + id.replace(/[^a-zA-Z0-9_-]/g, "");

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el);
    setW(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** A 1-2-5 step giving about four gridlines. */
function niceStep(peak: number): number {
  const raw = peak > 0 ? peak / 4 : 0.25;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

const DAY = 86_400_000;
const toTime = (iso: string) => Date.parse(iso + "T00:00:00Z");

/** Weeks on a time axis: weeks with no data between the first and the last are filled in. */
function continuous(weeks: string[], series: ChartSeries[], fill: number | null): { weeks: string[]; series: ChartSeries[] } {
  const times = weeks.map(toTime);
  if (times.length < 2 || times.some(isNaN)) return { weeks, series };
  const start = Math.min(...times), end = Math.max(...times);
  const all: string[] = [];
  for (let t = start; t <= end; t += 7 * DAY) all.push(new Date(t).toISOString().slice(0, 10));
  const at = new Map(weeks.map((w, i) => [w, i]));
  return { weeks: all, series: series.map((s) => ({ ...s, values: all.map((w) => (at.has(w) ? s.values[at.get(w)!] : fill)) })) };
}

const shortDate = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return isNaN(+d) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
};

export function WeekChart({ kind, weeks: rawWeeks, series: rawSeries, height = 180, format = (v) => String(Math.round(v * 100) / 100), yFormat, empty,
  label = shortDate, tipTitle = (w) => `Week of ${shortDate(w)}`, refs = [], yMax, marker, smooth = false, legend }: {
  kind: "bar" | "line" | "linePoints" | "area";
  /** Week start dates (yyyy-MM-dd), or any labels (then they are not filled in). */
  weeks: string[];
  series: ChartSeries[];
  height?: number;
  format?: (v: number) => string;
  yFormat?: (v: number) => string;
  empty?: string;
  label?: (w: string) => string;
  tipTitle?: (w: string) => string;
  /** Dashed horizontal reference lines (a guideline, a baseline). */
  refs?: { value: number; label?: string; color?: string }[];
  yMax?: number;
  /** An x label to mark with a dashed vertical line. */
  marker?: string;
  smooth?: boolean;
  legend?: ReactNode;
}) {
  const [ref, width] = useWidth();
  const gid = svgId(useId());
  const { weeks, series } = continuous(rawWeeks, rawSeries, kind === "bar" ? 0 : null);
  const [hover, setHover] = useState<number | null>(null);
  const left = 40, right = 8, top = 8, bottom = 22;
  const plotW = Math.max(10, width - left - right), plotH = height - top - bottom;
  const n = weeks.length;
  const stacked = kind === "bar";
  const totals = weeks.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const peak = Math.max(stacked ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v != null))),
    ...refs.map((r) => r.value));
  const step = niceStep(yMax ?? peak);
  const max = yMax ?? Math.max(step, Math.ceil(peak / step) * step);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const band = n ? plotW / n : plotW;
  const cx = (i: number) => left + band * i + band / 2;
  const barW = Math.max(2, Math.min(28, band * 0.6));
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const yf = yFormat ?? format;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
  const hasData = n > 0 && series.some((s) => s.values.some((v) => v != null && v !== 0));

  return (
    <div className="ins-chart" ref={ref}>
      <div style={{ position: "relative" }}>
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(", ") + " per week"} onMouseLeave={() => setHover(null)}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke="var(--hairline)" />
              <text x={left - 6} y={y(t) + 3.5} textAnchor="end" className="ins-axis">{yf(t)}</text>
            </g>
          ))}
          {weeks.map((w, i) => i % labelEvery === 0 && (
            <text key={w} x={cx(i)} y={height - 6} textAnchor="middle" className="ins-axis">{label(w)}</text>
          ))}
          {refs.map((r) => (
            <g key={r.value + (r.label ?? "")}>
              <line x1={left} x2={left + plotW} y1={y(r.value)} y2={y(r.value)} stroke={r.color ?? "var(--text-3)"} strokeDasharray="4 4" />
              {r.label && <text x={left + plotW} y={y(r.value) - 4} textAnchor="end" className="ins-axis" style={{ fill: r.color ?? "var(--text-2)" }}>{r.label}</text>}
            </g>
          ))}
          {marker != null && weeks.indexOf(marker) >= 0 && (
            <line x1={cx(weeks.indexOf(marker))} x2={cx(weeks.indexOf(marker))} y1={top} y2={top + plotH} stroke="var(--text-3)" strokeDasharray="3 4" />
          )}
          {hover != null && <rect x={left + band * hover} y={top} width={band} height={plotH} fill="var(--hover)" />}
          {stacked && weeks.map((_, i) => {
            let acc = 0;
            const segs = series.map((s) => {
              const v = s.values[i] ?? 0;
              const y0 = y(acc), y1 = y(acc + v);
              acc += v;
              return { s, v, y0, y1 };
            }).filter((x) => x.v > 0);
            return segs.map(({ s, y0, y1 }, j) => {
              const top = j === segs.length - 1;
              const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
              const r = top ? Math.min(4, h / 2, barW / 2) : 0;
              const x = cx(i) - barW / 2, yy = y1;
              const d = `M${x},${yy + h} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${yy + h} Z`;
              return <path key={`${i}-${s.name}`} d={d} fill={s.color} />;
            });
          })}
          {!stacked && series.map((s, si) => {
            const pts = s.values.map((v, i) => (v == null ? null : [cx(i), y(v)] as const)).filter(Boolean) as Pt[];
            const d = linePath(pts, smooth || kind === "area", top, top + plotH);
            const dots = s.points ?? kind === "linePoints";
            return (
              <g key={s.name}>
                {kind === "area" && pts.length > 1 && (
                  <>
                    <defs>
                      <linearGradient id={`${gid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={s.color} stopOpacity={0.28} />
                        <stop offset="1" stopColor={s.color} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <path d={`${d} L${pts[pts.length - 1][0]},${top + plotH} L${pts[0][0]},${top + plotH} Z`} fill={`url(#${gid}-${si})`} />
                  </>
                )}
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} />
                {dots && pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3.5} fill={s.color} stroke="var(--card)" strokeWidth={1.5} />)}
              </g>
            );
          })}
          {weeks.map((_, i) => (
            <rect key={i} x={left + band * i} y={top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {!hasData && empty && <div className="ins-chart-empty">{empty}</div>}
        {hover != null && (
          <div className="ins-tip" style={{ left: Math.min(Math.max(0, cx(hover) - 70), width - 150), top: 0 }}>
            <div className="ins-tip-title">{tipTitle(weeks[hover])}</div>
            {series.map((s) => (
              <div key={s.name} className="row" style={{ gap: 6 }}>
                <i style={{ background: s.color }} />
                <span>{s.name}</span>
                <span className="spacer" />
                <b>{s.values[hover] == null ? "–" : format(s.values[hover]!)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      {legend ?? (series.length >= 2 && <Legend items={series.map((s) => ({ name: s.name, color: s.color }))} />)}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="ins-legend">
      {items.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
    </div>
  );
}

// ---- Small multiples in the exceeds.ai style -----------------------------------------

/** A trend line with a soft wash under it, scaled to its own range. */
export function Sparkline({ values, color = "var(--ins-ai)", height = 44, area = true, ends }: {
  values: (number | null)[]; color?: string; height?: number; area?: boolean; ends?: [string, string];
}) {
  const gid = svgId(useId());
  const W = 100, pad = 3;
  const known = values.map((v, i) => (v == null ? null : ([i, v] as const))).filter(Boolean) as Pt[];
  const lo = Math.min(...known.map((p) => p[1])), hi = Math.max(...known.map((p) => p[1]));
  const n = Math.max(1, values.length - 1);
  const pts: Pt[] = known.map(([i, v]) => [(i / n) * W, pad + (1 - (hi > lo ? (v - lo) / (hi - lo) : 0.5)) * (height - 2 * pad)]);
  const d = linePath(pts, true, 0, height);
  return (
    <div className="ins-spark" aria-hidden>
      {pts.length >= 2 ? (
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.24} />
              <stop offset="1" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {area && <path d={`${d} L${pts[pts.length - 1][0]},${height} L${pts[0][0]},${height} Z`} fill={`url(#${gid})`} />}
          <path d={d} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
      ) : <div style={{ height }} />}
      {ends && <div className="ins-spark-ends"><span>{ends[0]}</span><span>{ends[1]}</span></div>}
    </div>
  );
}

/** Mini columns; a column `alert` flags is drawn in the at-risk colour. */
export function MiniBars({ values, color = "var(--ins-ai-bar)", height = 52, alert, format }: {
  values: (number | null)[]; color?: string; height?: number; alert?: (v: number) => boolean; format?: (v: number) => string;
}) {
  const peak = Math.max(1e-9, ...values.map((v) => v ?? 0));
  return (
    <div className="ins-minibars" style={{ height }} aria-hidden>
      {values.map((v, i) => (
        <span key={i} title={v == null ? "–" : format ? format(v) : String(v)}
          style={{ height: `${Math.max(v ? 6 : 2, ((v ?? 0) / peak) * 100)}%`, background: v != null && alert?.(v) ? "var(--ins-risk)" : v ? color : "var(--subtle)" }} />
      ))}
    </div>
  );
}

/** A donut and its legend, each share right-aligned. */
export function Donut({ items, size = 168, thickness = 30, format = (v: number) => `${Math.round(v * 100)}%` }: {
  items: { label: string; value: number; color: string }[]; size?: number; thickness?: number; format?: (share: number) => string;
}) {
  const total = items.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="ins-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={items.map((x) => `${x.label} ${format(x.value / (total || 1))}`).join(", ")}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--subtle)" strokeWidth={thickness} />
        {total > 0 && items.map((x) => {
          const len = (x.value / total) * c;
          const el = (
            <circle key={x.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={x.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`}>
              <title>{`${x.label}: ${format(x.value / total)}`}</title>
            </circle>
          );
          acc += len;
          return el;
        })}
      </svg>
      <div className="ins-donut-legend">
        {items.map((x) => (
          <div key={x.label} className="row">
            <i style={{ background: x.color }} />
            <span className="ins-truncate">{x.label}</span>
            <span className="spacer" />
            <span className="ins-num">{format(x.value / (total || 1))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One cell per day. */
export function HeatStrip({ cells, ends }: { cells: { key: string; color: string; tip: string }[]; ends: string[] }) {
  return (
    <div>
      <div className="ins-heat">
        {cells.map((c) => <span key={c.key} style={{ background: c.color }} title={c.tip} />)}
      </div>
      <div className="ins-heat-axis">{ends.map((e) => <span key={e}>{e}</span>)}</div>
    </div>
  );
}

export interface TreeItem { label: string; value: number; color: string; text?: string; sub?: string }

/** A treemap: tiles sized by value, split in halves along the longer side. */
export function Treemap({ items, height = 220 }: { items: TreeItem[]; height?: number }) {
  const [ref, width] = useWidth();
  const sorted = items.filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const rects: { it: TreeItem; x: number; y: number; w: number; h: number }[] = [];
  const place = (xs: TreeItem[], x: number, y: number, w: number, h: number) => {
    if (!xs.length) return;
    if (xs.length === 1) { rects.push({ it: xs[0], x, y, w, h }); return; }
    const total = xs.reduce((s, t) => s + t.value, 0);
    let k = 0, acc = 0;
    while (k < xs.length - 1 && acc + xs[k].value <= total / 2) acc += xs[k++].value;
    if (k === 0) acc = xs[k++].value;
    const f = acc / total;
    if (w >= h) { place(xs.slice(0, k), x, y, w * f, h); place(xs.slice(k), x + w * f, y, w * (1 - f), h); }
    else { place(xs.slice(0, k), x, y, w, h * f); place(xs.slice(k), x, y + h * f, w, h * (1 - f)); }
  };
  place(sorted, 0, 0, width, height);
  return (
    <div ref={ref} className="ins-tree" style={{ height }}>
      {rects.map(({ it, x, y, w, h }) => (
        <div key={it.label} className="ins-tree-tile" title={`${it.label}${it.sub ? ` · ${it.sub}` : ""}`}
          style={{ left: x + 2, top: y + 2, width: Math.max(0, w - 4), height: Math.max(0, h - 4), background: it.color, color: it.text ?? "#fff" }}>
          {w > 70 && h > 26 && (
            <div className="row" style={{ gap: 6, alignItems: "baseline" }}>
              <b className="ins-truncate">{it.label}</b>
              <span className="spacer" />
              {w > 150 && it.sub && <span className="ins-tree-sub">{it.sub}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Horizontal stacked bars on a shared hour scale (a PR's life, stage by stage). */
export function StackedHBars({ rows, stages, format }: {
  rows: { label: string; values: (number | null)[] }[]; stages: { name: string; color: string }[]; format: (v: number) => string;
}) {
  const [ref, width] = useWidth();
  const left = 96, right = 16, barH = 30, gap = 22, top = 8;
  const plotW = Math.max(10, width - left - right);
  const peak = Math.max(0, ...rows.map((r) => r.values.reduce<number>((s, v) => s + (v ?? 0), 0)));
  const step = niceStep(peak);
  const max = Math.max(step, Math.ceil(peak / step) * step);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const height = top + rows.length * (barH + gap) + 12;
  const x = (v: number) => left + (v / max) * plotW;
  return (
    <div className="ins-chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={rows.map((r) => r.label).join(" and ")}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top} y2={height - 16} stroke="var(--hairline)" />
            <text x={x(t)} y={height - 3} textAnchor="middle" className="ins-axis">{format(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const yy = top + i * (barH + gap) + gap / 2;
          let acc = 0;
          const segs = r.values.map((v, j) => ({ v: v ?? 0, j })).filter((s) => s.v > 0);
          return (
            <g key={r.label}>
              <text x={left - 10} y={yy + barH / 2 + 4} textAnchor="end" className="ins-axis" style={{ fontSize: 11 }}>{r.label}</text>
              {segs.map(({ v, j }, k) => {
                const x0 = x(acc);
                acc += v;
                const w = x(acc) - x0;
                const first = k === 0, last = k === segs.length - 1, rad = Math.min(6, w / 2);
                return (
                  <path key={j} fill={stages[j].color}
                    d={`M${x0 + (first ? rad : 0)},${yy} H${x0 + w - (last ? rad : 0)} ${last ? `Q${x0 + w},${yy} ${x0 + w},${yy + rad} V${yy + barH - rad} Q${x0 + w},${yy + barH} ${x0 + w - rad},${yy + barH}` : `V${yy + barH}`} H${x0 + (first ? rad : 0)} ${first ? `Q${x0},${yy + barH} ${x0},${yy + barH - rad} V${yy + rad} Q${x0},${yy} ${x0 + rad},${yy}` : `V${yy}`} Z`}>
                    <title>{`${stages[j].name}: ${format(v)}`}</title>
                  </path>
                );
              })}
            </g>
          );
        })}
      </svg>
      <Legend items={stages} />
    </div>
  );
}

export interface Dot { key: string; x: number; y: number; size: number; color: string; label: string; tip: string }

/** A bubble scatter (x and y from 0, bubble area by size). */
export function Scatter({ dots, height = 240, xMax, xFormat, yFormat, xLabel, yLabel, legend }: {
  dots: Dot[]; height?: number; xMax?: number; xFormat: (v: number) => string; yFormat: (v: number) => string;
  xLabel: string; yLabel: string; legend?: { name: string; color: string }[];
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<Dot | null>(null);
  const left = 44, right = 16, top = 12, bottom = 34;
  const plotW = Math.max(10, width - left - right), plotH = height - top - bottom;
  const xs = niceStep(xMax ?? Math.max(0, ...dots.map((d) => d.x)));
  const xm = xMax ?? Math.max(xs, Math.ceil(Math.max(0, ...dots.map((d) => d.x)) / xs) * xs);
  const ys = niceStep(Math.max(0, ...dots.map((d) => d.y)));
  const ym = Math.max(ys, Math.ceil(Math.max(0, ...dots.map((d) => d.y)) / ys) * ys);
  const peak = Math.max(1, ...dots.map((d) => d.size));
  const X = (v: number) => left + (v / xm) * plotW, Y = (v: number) => top + plotH - (v / ym) * plotH;
  const R = (s: number) => 4 + Math.sqrt(s / peak) * 14;
  return (
    <div className="ins-chart" ref={ref}>
      <div style={{ position: "relative" }}>
        <svg width={width} height={height} role="img" aria-label={`${yLabel} against ${xLabel}`} onMouseLeave={() => setHover(null)}>
          {Array.from({ length: Math.round(ym / ys) + 1 }, (_, i) => i * ys).map((t) => (
            <g key={`y${t}`}>
              <line x1={left} x2={left + plotW} y1={Y(t)} y2={Y(t)} stroke="var(--hairline)" />
              <text x={left - 6} y={Y(t) + 3.5} textAnchor="end" className="ins-axis">{yFormat(t)}</text>
            </g>
          ))}
          {Array.from({ length: Math.round(xm / xs) + 1 }, (_, i) => i * xs).map((t) => (
            <text key={`x${t}`} x={X(t)} y={top + plotH + 14} textAnchor="middle" className="ins-axis">{xFormat(t)}</text>
          ))}
          <text x={left + plotW / 2} y={height - 3} textAnchor="middle" className="ins-axis">{xLabel}</text>
          <text transform={`translate(10 ${top + plotH / 2}) rotate(-90)`} textAnchor="middle" className="ins-axis">{yLabel}</text>
          {[...dots].sort((a, b) => b.size - a.size).map((d) => (
            <circle key={d.key} cx={X(d.x)} cy={Y(d.y)} r={R(d.size)} fill={d.color} fillOpacity={0.85} stroke="var(--card)" strokeWidth={1}
              onMouseEnter={() => setHover(d)} />
          ))}
        </svg>
        {hover && (
          <div className="ins-tip" style={{ left: Math.min(Math.max(0, X(hover.x) - 80), width - 170), top: Math.max(0, Y(hover.y) - R(hover.size) - 64) }}>
            <div className="ins-tip-title">{hover.label}</div>
            <span>{hover.tip}</span>
          </div>
        )}
      </div>
      {legend && <Legend items={legend} />}
    </div>
  );
}
