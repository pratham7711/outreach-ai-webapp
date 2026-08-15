"use client";
import React from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, LabelList, ReferenceLine,
} from "recharts";
import { MetricHint } from "@/components/ds";
import { cpm } from "@/lib/metrics";

type SpendPoint = { date: string; spend: number; views: number };
type PlatformSlice = { platform: string; spend: number; views: number; postsCount: number };
type CampaignSpend = { campaignId: string; title: string; spend: number; budget: number; views: number; creatorsCount: number };

type Fmt = (n: number) => string;

const chartTooltipStyle: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--popover-foreground)",
  boxShadow: "var(--ui-shadow-md)",
  fontSize: 13,
  padding: "10px 14px",
};

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12, fontWeight: 500 } as const;

function PanelHeading({ title, metric }: { title: string; metric: "monthlySpend" | "views" }) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <span className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {title}
      </span>
      <MetricHint metric={metric} />
    </div>
  );
}

export function SpendOverTimeArea({
  data,
  formatNumber,
  formatCurrency,
}: {
  data: SpendPoint[];
  formatNumber: Fmt;
  formatCurrency: Fmt;
}) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col">
        <PanelHeading title="Spend" metric="monthlySpend" />
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis
                tick={axisTick}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={(v) => formatCurrency(Number(v))}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value) => [formatCurrency(Number(value)), "Spend"]}
              />
              <Area
                type="monotone"
                dataKey="spend"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#spendGradient)"
                dot={false}
                activeDot={{ fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2, r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <PanelHeading title="Views" metric="views" />
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-3)" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="var(--chart-3)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis
                tick={axisTick}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={(v) => formatNumber(Number(v))}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value) => [formatNumber(Number(value)), "Views"]}
              />
              <Area
                type="monotone"
                dataKey="views"
                stroke="var(--chart-3)"
                strokeWidth={2}
                fill="url(#viewsGradient)"
                dot={false}
                activeDot={{ fill: "var(--chart-3)", stroke: "var(--card)", strokeWidth: 2, r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export function PlatformBreakdownPie({
  data,
  colors,
  formatNumber,
}: {
  data: PlatformSlice[];
  colors: string[];
  formatNumber: Fmt;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={52}
          outerRadius={80}
          paddingAngle={2}
          dataKey="views"
          nameKey="platform"
          stroke="var(--card)"
          strokeWidth={2}
        >
          {data.map((entry, i) => (
            <Cell key={entry.platform} fill={colors[i]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v, name) => [`${formatNumber(Number(v))} views`, String(name)]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/**
 * Cost per thousand views over time — the one chart that reads spend and reach
 * against each other instead of side by side. Periods with no views are dropped
 * rather than plotted as zero, which would read as "free reach".
 */
export function CpmTrendLine({
  data,
  formatCurrency,
}: {
  data: SpendPoint[];
  formatCurrency: Fmt;
}) {
  const points = data
    .map((d) => ({ date: d.date, cpm: cpm(d.spend, d.views) }))
    .filter((d): d is { date: string; cpm: number } => d.cpm !== null);

  if (points.length < 2) {
    return (
      <div className="flex h-[200px] items-center justify-center text-center text-sm text-muted-foreground">
        Not enough periods with both spend and views to chart efficiency yet.
      </div>
    );
  }

  const best = Math.min(...points.map((p) => p.cpm));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="cpmFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(Number(v))} width={64} />
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v) => [formatCurrency(Number(v)), "CPM"]}
        />
        <ReferenceLine
          y={best}
          stroke="var(--chart-2)"
          strokeDasharray="4 4"
          label={{
            value: `best ${formatCurrency(best)}`,
            position: "insideTopRight",
            fill: "var(--muted-foreground)",
            fontSize: 11,
            fontWeight: 600,
          }}
        />
        <Area type="monotone" dataKey="cpm" stroke="var(--chart-3)" strokeWidth={2} fill="url(#cpmFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SpendByCampaignBar({
  data,
  formatCurrency,
}: {
  data: CampaignSpend[];
  formatCurrency: Fmt;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(Number(v))} />
        <YAxis dataKey="title" type="category" tick={axisTick} axisLine={false} tickLine={false} width={104} />
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v) => [formatCurrency(Number(v)), "Spend"]}
        />
        <Bar dataKey="spend" fill="var(--chart-1)" radius={[0, 4, 4, 0]} barSize={18}>
          <LabelList
            dataKey="spend"
            position="right"
            formatter={(v: React.ReactNode) => formatCurrency(Number(v))}
            style={{ fill: "var(--muted-foreground)", fontSize: 11, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
