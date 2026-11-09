"use client";
import React from "react";
import { formatCompact } from "@/lib/format";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, ReferenceLine,
} from "recharts";
import { chartAxisTick, chartLegendProps, chartTooltipProps } from "@/components/charts/chartTheme";
import { ChartFrame } from "@/components/ds/ChartFrame";
import { nextPeriodBy, toChanges, toRunningTotals, type SeriesMode } from "@/lib/charts/seriesMode";
import { formatNumber, SERIES_COLORS } from "./shared";

type MonthlyTrend = { month: string; campaigns: number; active: number };
const axisTick = chartAxisTick;

export function MonthlyTrendArea({ data, mode = "daily" }: { data: MonthlyTrend[]; mode?: SeriesMode }) {
  /* Whole campaigns per month. A smoothed area between two months drew
     fractions of a campaign that never existed, so a month is a bar and the
     running total is a step that holds its value until the next month.
     The tooltip takes each series' own name ("Total", "Active"): the old
     formatter compared that name with the dataKey, never matched, and
     labelled both rows "Active". */
  if (mode !== "cumulative") {
    return (
      <ChartFrame minHeight={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="month" tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis tick={axisTick} allowDecimals={false} axisLine={false} tickLine={false} />
          <Tooltip {...chartTooltipProps} cursor={{ fill: "var(--cc-row-hover)" }} />
          <Legend {...chartLegendProps} />
          <Bar isAnimationActive={false} dataKey="campaigns" name="Total" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar isAnimationActive={false} dataKey="active" name="Active" fill="var(--chart-2)" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ChartFrame>
    );
  }
  /* Every month of the window is present (empty ones as 0), so a running sum
     from the first month is the count started since then. */
  const rows = toRunningTotals(data, ["campaigns", "active"]);
  return (
    <ChartFrame minHeight={200}>
      <AreaChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="analyticsGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="month" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis tick={axisTick} allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip {...chartTooltipProps} />
        <Legend {...chartLegendProps} />
        <Area
          isAnimationActive={false}
          type="stepAfter"
          dataKey="campaigns"
          name="Total"
          stroke="var(--chart-1)"
          fill="url(#analyticsGradient)"
          strokeWidth={2}
          dot={false}
        />
        <Area
          isAnimationActive={false}
          type="stepAfter"
          dataKey="active"
          name="Active"
          stroke="var(--chart-2)"
          fill="none"
          strokeWidth={2}
          strokeDasharray="4 2"
          dot={false}
        />
      </AreaChart>
    </ChartFrame>
  );
}

export function CampaignComparisonLine({
  series,
  selected,
  titleById,
  colorById,
  mode = "cumulative",
}: {
  series: Record<string, number | string>[];
  selected: string[];
  titleById: Record<string, string>;
  colorById: Record<string, string>;
  mode?: SeriesMode;
}) {
  /* Each campaign's value is its running view total on that day, so the
     daily figure is the change from the day before. */
  const rows: Record<string, number | string | null>[] =
    mode === "daily" ? toChanges(series, selected, nextPeriodBy((r) => String(r.date))) : series;
  return (
    <ChartFrame minHeight={200}>
      <LineChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatCompact(Number(v))}
        />
        <Tooltip
          {...chartTooltipProps}
          formatter={(v: any, name: any) => [
            v === null || v === undefined ? "—" : formatNumber(Number(v)),
            titleById[name] ?? name,
          ]}
        />
        <Legend {...chartLegendProps} formatter={(value: any) => chartLegendProps.formatter(titleById[value] ?? value)} />
        {mode === "daily" ? <ReferenceLine y={0} stroke="var(--chart-grid)" /> : null}
        {selected.map((id) => (
          <Line
            isAnimationActive={false}
            key={id}
            type="monotone"
            dataKey={id}
            stroke={colorById[id] ?? SERIES_COLORS[0]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}
