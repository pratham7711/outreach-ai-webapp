"use client";
import React from "react";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar,
} from "recharts";
import { ChartFrame } from "@/components/ds";
import { formatNumber, SERIES_COLORS } from "./shared";

type MonthlyTrend = { month: string; campaigns: number; active: number };
type PlatformBreakdown = { platform: string; views: number; posts: number };

const axisTick = { fontSize: 12, fill: "var(--muted-foreground)" } as const;
const axisTickSm = { fontSize: 11, fill: "var(--muted-foreground)" } as const;

const chartTooltipStyle: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
  fontSize: 13,
};

export function MonthlyTrendArea({ data }: { data: MonthlyTrend[] }) {
  return (
    <ChartFrame minHeight={200}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="analyticsGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="month" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis tick={axisTick} allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v: any, name: any) => [v, name === "campaigns" ? "Total" : "Active"]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="campaigns"
          name="Total"
          stroke="var(--chart-1)"
          fill="url(#analyticsGradient)"
          strokeWidth={2}
          dot={false}
        />
        <Area
          type="monotone"
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

export function PlatformBreakdownBar({ data }: { data: PlatformBreakdown[] }) {
  return (
    <ChartFrame minHeight={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
        <XAxis
          type="number"
          tick={axisTickSm}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatNumber(v)}
        />
        <YAxis
          type="category"
          dataKey="platform"
          tick={axisTickSm}
          width={70}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v: any) => [formatNumber(Number(v)), "Views"]}
        />
        <Bar dataKey="views" radius={[0, 4, 4, 0]} fill="var(--chart-1)" />
      </BarChart>
    </ChartFrame>
  );
}

export function CampaignComparisonLine({
  series,
  selected,
  titleById,
  colorById,
}: {
  series: Record<string, number | string>[];
  selected: string[];
  titleById: Record<string, string>;
  colorById: Record<string, string>;
}) {
  return (
    <ChartFrame minHeight={200}>
      <LineChart data={series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="date" tick={axisTickSm} axisLine={false} tickLine={false} />
        <YAxis
          tick={axisTickSm}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatNumber(Number(v))}
        />
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v: any, name: any) => [formatNumber(Number(v)), titleById[name] ?? name]}
        />
        <Legend formatter={(value: any) => titleById[value] ?? value} wrapperStyle={{ fontSize: 12 }} />
        {selected.map((id) => (
          <Line
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
