"use client";
import React from "react";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar,
} from "recharts";
import { formatNumber, SERIES_COLORS } from "./shared";

type MonthlyTrend = { month: string; campaigns: number; active: number };
type PlatformBreakdown = { platform: string; views: number; posts: number };

export function MonthlyTrendArea({ data }: { data: MonthlyTrend[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="analyticsGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--cc-primary)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--cc-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
        <YAxis tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
          formatter={(v: any, name: any) => [v, name === "campaigns" ? "Total" : "Active"]}
        />
        <Area type="monotone" dataKey="campaigns" stroke="var(--cc-primary)" fill="url(#analyticsGradient)" strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="active" stroke="#10B981" fill="none" strokeWidth={2} strokeDasharray="4 2" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function PlatformBreakdownBar({ data }: { data: PlatformBreakdown[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} tickFormatter={(v) => formatNumber(v)} />
        <YAxis type="category" dataKey="platform" tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} width={70} />
        <Tooltip
          contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
          formatter={(v: any) => [formatNumber(Number(v)), "Views"]}
        />
        <Bar dataKey="views" radius={[0, 4, 4, 0]} fill="var(--cc-primary)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CampaignComparisonLine({
  series,
  selected,
  titleById,
}: {
  series: Record<string, number | string>[];
  selected: string[];
  titleById: Record<string, string>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} />
        <YAxis tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} tickFormatter={(v) => formatNumber(Number(v))} />
        <Tooltip
          contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
          formatter={(v: any, name: any) => [formatNumber(Number(v)), titleById[name] ?? name]}
        />
        <Legend formatter={(value: any) => titleById[value] ?? value} wrapperStyle={{ fontSize: 12 }} />
        {selected.map((id, i) => (
          <Line
            key={id}
            type="monotone"
            dataKey={id}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
