"use client";
import React from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { MetricHint } from "@/components/ds";
import { formatCompact, formatFull } from "@/lib/format";
import { bucketChanges, type SeriesMode } from "@/lib/charts/seriesMode";

type PerformancePoint = { t: number; date: string; views: number; likes: number | null; comments: number | null };
type TrackingPoint = { t: number; ts: string; views: number; engagement: number | null };

/**
 * Time-scaled x-axis over each point's epoch ms. A categorical axis spaced
 * readings evenly, so an hourly burst and a week's silence were the same width
 * and several readings on one day sat under one repeated date.
 */
const timeAxis = {
  dataKey: "t",
  type: "number",
  scale: "time",
  domain: ["dataMin", "dataMax"],
  tickFormatter: (t: number) =>
    new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  minTickGap: 24,
} as const;

const utcInstant = (t: unknown) =>
  `${new Date(Number(t)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`;

const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" } as const;

const chartTooltipStyle: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--popover-foreground)",
  fontSize: "var(--cc-t-13)",
  padding: "8px 12px",
};

function PanelHeading({
  title,
  what,
  label,
}: {
  title: string;
  what: string;
  label: string;
}) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <span className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {title}
      </span>
      <MetricHint label={label} what={what} />
    </div>
  );
}

/** "Oct 3", "Oct 3, 6 AM" at 6-hourly, "Week of Oct 3" at weekly: a bucket by its start. */
function bucketLabel(bucketHours: number) {
  return (t: unknown) => {
    const d = new Date(Number(t));
    const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    if (bucketHours >= 24 * 7) return `Week of ${day}`;
    if (bucketHours < 24) return `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" })} UTC`;
    return `${day} UTC`;
  };
}

function signed(v: unknown): string {
  if (v === null || v === undefined) return "No reading the period before";
  const n = Number(v);
  return `${n > 0 ? "+" : ""}${formatFull(n)}`;
}

/**
 * What each period added, as bars on one slot per period. A period whose
 * neighbour has no reading has no bar, and says so in its tooltip.
 */
function ChangeBars({
  data,
  series,
  height,
  bucketHours,
}: {
  data: Array<{ t: number } & Record<string, number | null>>;
  series: { key: string; name: string; color: string }[];
  height: number;
  bucketHours: number;
}) {
  if (!data.some((row) => series.some((s) => row[s.key] !== null))) {
    return (
      <p className="text-xs text-muted-foreground" style={{ height, display: "flex", alignItems: "center", justifyContent: "center", margin: 0 }}>
        Needs readings in two periods in a row to show a change.
      </p>
    );
  }
  const label = bucketLabel(bucketHours);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
          minTickGap={24}
          tick={axisTick}
          axisLine={false}
          tickLine={false}
        />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => formatCompact(Number(v))} />
        <ReferenceLine y={0} stroke="var(--chart-grid)" />
        <Tooltip contentStyle={chartTooltipStyle} labelFormatter={label} formatter={(value, name) => [signed(value), String(name)]} />
        {series.length > 1 ? <Legend itemSorter={null} wrapperStyle={{ fontSize: "var(--cc-t-12)" }} /> : null}
        {series.map((s) => (
          <Bar key={s.key} isAnimationActive={false} dataKey={s.key} name={s.name} fill={s.color} radius={[2, 2, 0, 0]} maxBarSize={24} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PerformanceOverTimeArea({ data, mode = "cumulative" }: { data: PerformancePoint[]; mode?: SeriesMode }) {
  if (mode === "daily") {
    /* Readings land at any time of day; each day is its last reading, and the
       day's figure is the change from the day before's. */
    const days = bucketChanges(data, (p) => p.t, ["views", "likes", "comments"], 24);
    return (
      <div className="flex flex-col gap-3">
        <div>
          <PanelHeading title="Views gained per day" label="Views gained per day" what="How many views this post gained each day: the last reading of the day minus the last reading of the day before." />
          <ChangeBars data={days} series={[{ key: "views", name: "Views", color: "var(--chart-1)" }]} height={140} bucketHours={24} />
        </div>
        <div>
          <PanelHeading title="Likes and comments added per day" label="Likes and comments added per day" what="Likes and comments this post gained each day, from the same daily readings as views." />
          <ChangeBars
            data={days}
            series={[
              { key: "likes", name: "Likes", color: "var(--chart-2)" },
              { key: "comments", name: "Comments", color: "var(--chart-3)" },
            ]}
            height={140}
            bucketHours={24}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <PanelHeading
          title="Views"
          label="Views"
          what="How many times this post was watched, at each recorded date."
        />
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="postViewsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis {...timeAxis} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(v) => formatCompact(Number(v))}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelFormatter={utcInstant}
              formatter={(value) => [formatFull(Number(value)), "Views"]}
            />
            <Area
              isAnimationActive={false}
              type="monotone"
              dataKey="views"
              name="Views"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#postViewsGradient)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div>
        <PanelHeading
          title="Likes and comments"
          label="Likes and comments"
          what="Direct interactions with this post. Shown on their own scale because views are far larger."
        />
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis {...timeAxis} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(v) => formatCompact(Number(v))}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelFormatter={utcInstant}
              formatter={(value, name) => [formatFull(Number(value)), String(name)]}
            />
            <Legend itemSorter={null} wrapperStyle={{ fontSize: "var(--cc-t-12)"}} />
            <Area
              isAnimationActive={false}
              type="monotone"
              dataKey="likes"
              name="Likes"
              stroke="var(--chart-2)"
              fill="var(--chart-2)"
              fillOpacity={0.12}
              strokeWidth={2}
              dot={false}
            />
            <Area
              isAnimationActive={false}
              type="monotone"
              dataKey="comments"
              name="Comments"
              stroke="var(--chart-3)"
              fill="var(--chart-3)"
              fillOpacity={0.12}
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function TrackingLine({
  data,
  mode = "cumulative",
  bucketHours = 24,
}: {
  data: TrackingPoint[];
  mode?: SeriesMode;
  bucketHours?: number;
}) {
  if (mode === "daily") {
    const buckets = bucketChanges(data, (p) => p.t, ["views", "engagement"], bucketHours);
    return (
      <div className="flex flex-col gap-3">
        <div>
          <PanelHeading title="Views gained" label="Views gained" what="Views gained in each chart period, between one snapshot and the one before." />
          <ChangeBars data={buckets} series={[{ key: "views", name: "Views", color: "var(--chart-1)" }]} height={130} bucketHours={bucketHours} />
        </div>
        <div>
          <PanelHeading title="Engagement added" label="Engagement added" what="Likes and comments added in each chart period." />
          <ChangeBars data={buckets} series={[{ key: "engagement", name: "Engagement", color: "var(--chart-2)" }]} height={130} bucketHours={bucketHours} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <PanelHeading
          title="Views"
          label="Views"
          what="Views recorded at each tracking snapshot."
        />
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis {...timeAxis} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(v) => formatCompact(Number(v))}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelFormatter={utcInstant}
              formatter={(value) => [formatFull(Number(value)), "Views"]}
            />
            <Line
              isAnimationActive={false}
              type="monotone"
              dataKey="views"
              name="Views"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <PanelHeading
          title="Engagement"
          label="Engagement"
          what="How much interaction this post had accumulated at each snapshot. Kept on its own scale so it is not flattened by the views figures."
        />
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis {...timeAxis} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(v) => formatCompact(Number(v))}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelFormatter={utcInstant}
              formatter={(value) => [formatFull(Number(value)), "Engagement"]}
            />
            <Line
              isAnimationActive={false}
              type="monotone"
              dataKey="engagement"
              name="Engagement"
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
