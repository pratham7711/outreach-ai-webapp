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
import type { ChartGranularity } from "@/lib/trackers/granularity";

export type SeriesPoint = { value: number; recordedAt: string };

/**
 * The two charts CreatorCore shows for an audio, in Recharts rather than its
 * Chart.js: a cumulative level, and the change between consecutive points.
 *
 * They are two views of one series and must be read together. The level answers
 * "how big is this sound"; the deltas answer "is it still moving", which the
 * level hides once the numbers get large -- on a sound at 876k uses, a day that
 * adds 337 is invisible on the area chart and obvious on the bars.
 */

const AXIS = { fontSize: 11, fill: "var(--cc-text-muted)" } as const;

function tickLabel(iso: string, granularity: ChartGranularity): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (granularity === "6hourly") {
    return d.toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });
  }
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric", timeZone: "UTC" });
}

function TooltipBox({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
  suffix: string;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  if (typeof v !== "number") return null;
  return (
    <div
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 12,
        color: "var(--cc-text)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ color: "var(--cc-text-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>
        {v >= 0 && suffix === "added" ? "+" : ""}
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
  const data = useMemo(
    () => series.map((p) => ({ t: tickLabel(p.recordedAt, granularity), value: p.value })),
    [series, granularity]
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
        <XAxis dataKey="t" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28} />
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
        <Tooltip content={<TooltipBox suffix={unit} />} />
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
  const data = useMemo(() => {
    const out: { t: string; delta: number }[] = [];
    for (let i = 1; i < series.length; i++) {
      out.push({
        t: tickLabel(series[i].recordedAt, granularity),
        delta: series[i].value - series[i - 1].value,
      });
    }
    return out;
  }, [series, granularity]);

  if (data.length === 0) return <ChartEmpty height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" vertical={false} />
        <XAxis dataKey="t" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28} />
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
        <Tooltip content={<TooltipBox suffix="added" />} />
        <Bar dataKey="delta" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.delta < 0 ? "var(--cc-danger)" : "var(--chart-1)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        color: "var(--cc-text-muted)",
      }}
    >
      Not enough readings to chart yet
    </div>
  );
}
