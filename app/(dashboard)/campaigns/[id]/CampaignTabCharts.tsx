"use client";
import React from "react";
import {
  PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { ChartFrame } from "@/components/ds";

type PieDatum = { name?: string; value: number; fill?: string };
type BarDatum = { name: string; views: number; likes: number };

const axisTick = { fontSize: 12, fill: "var(--muted-foreground)" } as const;

const chartTooltipStyle: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
  fontSize: 13,
};

export function PlatformViewsPie({
  data,
  formatNumber,
}: {
  data: PieDatum[];
  formatNumber: (n: number) => string;
}) {
  return (
    <ChartFrame minHeight={200}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" nameKey="name" paddingAngle={2} label={false} stroke="var(--cc-card)" strokeWidth={2}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v: any, name: any) => [`${formatNumber(Number(v ?? 0))} views`, String(name)]}
        />
        <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 12 }} formatter={(value: any) => <span style={{ color: "var(--cc-text-muted)" }}>{value}</span>} />
      </PieChart>
    </ChartFrame>
  );
}

export function CreatorPerformanceBar({
  data,
  formatNumber,
}: {
  data: BarDatum[];
  formatNumber: (n: number) => string;
}) {
  return (
    <ChartFrame minHeight={200}>
      <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis
          yAxisId="views"
          tick={{ ...axisTick, fill: "var(--chart-1)" }}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v) => formatNumber(v)}
        />
        <YAxis
          yAxisId="likes"
          orientation="right"
          tick={{ ...axisTick, fill: "var(--chart-3)" }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v) => formatNumber(v)}
        />
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v: any, name: any) => [formatNumber(Number(v ?? 0)), String(name)]}
        />
        <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="views" dataKey="views" name="Views" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
        <Bar yAxisId="likes" dataKey="likes" name="Likes" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}

export function BudgetBreakdownPie({
  data,
  formatCurrency,
  currency,
}: {
  data: PieDatum[];
  formatCurrency: (n: number, currency?: string) => string;
  currency: string;
}) {
  return (
    <ChartFrame minHeight={200}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value" paddingAngle={2}>
          <Cell fill="var(--cc-primary)" />
          <Cell fill="var(--cc-bg)" />
        </Pie>
        <Tooltip formatter={(v: any) => formatCurrency(Number(v ?? 0), currency)} contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12 }} />
      </PieChart>
    </ChartFrame>
  );
}
