"use client";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompact } from "@/lib/format";
import { CHART_BUCKET_HOURS, type ChartGranularity } from "@/lib/trackers/granularity";

/** `rounded`: the platform's "74K" rather than a count (lib/sounds/precision). */
export type SeriesPoint = { value: number; recordedAt: string; rounded?: boolean };

/**
 * The two charts shown for an audio, in Recharts rather than its
 * Chart.js: a cumulative level, and the change between consecutive points.
 *
 * They are two views of one series and must be read together. The level answers
 * "how big is this sound"; the deltas answer "is it still moving", which the
 * level hides once the numbers get large -- on a sound at 876k uses, a day that
 * adds 337 is invisible on the area chart and obvious on the bars.
 */

const AXIS = { fontSize: "var(--cc-t-11)", fill: "var(--cc-text-muted)" } as const;

function tickLabel(iso: string | number, granularity: ChartGranularity): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (granularity === "6hourly") {
    return d.toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });
  }
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric", timeZone: "UTC" });
}

/** A tooltip names the reading's instant in UTC, the zone the axis is drawn in. */
function instantLabel(label: string | number | undefined, granularity: ChartGranularity): string {
  if (label === undefined) return "";
  const d = new Date(label);
  if (Number.isNaN(d.getTime())) return String(label);
  return `${d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(granularity === "6hourly" ? { hour: "numeric" } : {}),
    timeZone: "UTC",
  })} UTC`;
}

function TooltipBox({
  active,
  payload,
  label,
  suffix,
  granularity,
}: {
  active?: boolean;
  payload?: { value?: number; payload?: { rounded?: boolean } }[];
  label?: string | number;
  suffix: string;
  granularity: ChartGranularity;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  if (typeof v !== "number") return null;
  const approx = payload[0]?.payload?.rounded ? "≈" : "";
  return (
    <div
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: "var(--cc-t-12)",
        color: "var(--cc-text)",
        boxShadow: "0 2px 8px color-mix(in srgb, var(--cc-shadow-ink) 8%, transparent)",
      }}
    >
      <div style={{ color: "var(--cc-text-muted)", marginBottom: 2 }}>{instantLabel(label, granularity)}</div>
      <div style={{ fontWeight: "var(--cc-fw-strong)"}}>
        {v >= 0 && suffix === "added" ? "+" : ""}
        {approx}
        {v.toLocaleString()} {suffix}
      </div>
    </div>
  );
}

export function AudioUsesChart({
  series,
  granularity,
  height = 240,
  /* What the values ARE. The chart is shared: the audio modal plots a sound's
     uses, the creator modal plots a creator's followers, and the tooltip said
     "uses" on both — so a creator's follower count read "1.2M uses". */
  unit = "uses",
}: {
  series: SeriesPoint[];
  granularity: ChartGranularity;
  height?: number;
  unit?: string;
}) {
  /* Epoch ms on a time-scaled axis rather than a label per point on a
     categorical one, which spaced points evenly: a week without a reading was
     drawn as wide as an hour between two. */
  const data = useMemo(
    () =>
      series
        .map((p) => ({ t: new Date(p.recordedAt).getTime(), value: p.value, rounded: p.rounded ?? false }))
        .filter((p) => Number.isFinite(p.t)),
    [series]
  );

  if (data.length === 0) return <ChartEmpty height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="soundUsesGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(t: number) => tickLabel(t, granularity)}
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
        />
        {/* Not anchored at zero: a sound sitting at 876k would otherwise draw a
            flat line across the top and hide every movement in it. */}
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={54}
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v: number) => formatCompact(v)}
        />
        <Tooltip content={<TooltipBox suffix={unit} granularity={granularity} />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#soundUsesGrad)"
          isAnimationActive={false}
          /* No interpolation past the last reading: a line that keeps going
             after the reader stopped is the same lie as a stale "+0". */
          connectNulls={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function VelocityChart({
  series,
  granularity,
  height = 240,
}: {
  series: SeriesPoint[];
  granularity: ChartGranularity;
  height?: number;
}) {
  // Deltas between consecutive points. The first point has no predecessor and is
  // dropped rather than shown as its own full value -- treating a sound's whole
  // history as "added today" is how a 46-use sound once reported "+100".
  //
  // One slot per bucket, every bucket, so the bars are to scale: a delta across
  // a run of empty buckets used to be one bar the width of one bucket, carrying
  // several buckets' growth. It is now no bar at all, and the empty buckets
  // show as the gap they are. No bar either where an end is a rounded figure:
  // the difference between "74K" and "74.1K" is the rounding.
  const data = useMemo(() => velocityBars(series, granularity), [series, granularity]);

  if (!data.some((d) => d.delta !== null)) return <ChartEmpty height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={(t: number) => tickLabel(t, granularity)}
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={54}
          tickFormatter={(v: number) => formatCompact(v)}
        />
        {/* Zero is drawn because negative bars are real: creators delete videos,
            and usesCount is a current inventory rather than a running total. */}
        <ReferenceLine y={0} stroke="var(--cc-border-strong, var(--cc-border))" />
        <Tooltip content={<TooltipBox suffix="added" granularity={granularity} />} />
        <Bar dataKey="delta" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={(d.delta ?? 0) < 0 ? "var(--cc-danger)" : "var(--chart-1)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Past this many buckets the slots are not filled -- a cap, not a case. */
const MAX_BAR_SLOTS = 2_000;

/**
 * One bar slot per chart bucket from the first point to the last; `delta` is
 * the change from the previous bucket's point, or null when that bucket was
 * empty or either end is a rounded figure. Exported for its test.
 */
export function velocityBars(
  series: readonly SeriesPoint[],
  granularity: ChartGranularity,
): { t: number; delta: number | null }[] {
  const bucketMs = CHART_BUCKET_HOURS[granularity] * 60 * 60 * 1000;
  const points = series
    .map((p) => ({ t: new Date(p.recordedAt).getTime(), value: p.value, rounded: p.rounded ?? false }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) return [];

  const byBucket = new Map<number, (typeof points)[number]>();
  for (const p of points) byBucket.set(Math.floor(p.t / bucketMs), p);
  const first = Math.floor(points[0].t / bucketMs);
  const last = Math.floor(points[points.length - 1].t / bucketMs);
  const keys =
    last - first <= MAX_BAR_SLOTS
      ? Array.from({ length: last - first + 1 }, (_, i) => first + i)
      : [...byBucket.keys()].sort((a, b) => a - b);

  const out: { t: number; delta: number | null }[] = [];
  for (let i = 1; i < keys.length; i++) {
    const cur = byBucket.get(keys[i]);
    const prev = byBucket.get(keys[i - 1]);
    const delta =
      cur && prev && keys[i] - keys[i - 1] === 1 && !cur.rounded && !prev.rounded ? cur.value - prev.value : null;
    out.push({ t: cur?.t ?? keys[i] * bucketMs, delta });
  }
  return out;
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "var(--cc-t-13)",
        color: "var(--cc-text-muted)",
      }}
    >
      Not enough readings to chart yet
    </div>
  );
}
