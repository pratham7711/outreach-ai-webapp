"use client";
import React from "react";
import { formatCompact } from "@/lib/format";
import {
  PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { ChartFrame } from "@/components/ds/ChartFrame";
import { chartAxisTick, chartLegendProps, chartTooltipProps } from "@/components/charts/chartTheme";
import { platformLabel } from "@/lib/platforms/registry";

type PieDatum = { name?: string; value: number; fill?: string };
/** Null where none of the creator's posts measured that counter: no bar, not a 0. */
type BarDatum = { name: string; views: number | null; likes: number | null };

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
        <Pie isAnimationActive={false} data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" nameKey="name" paddingAngle={2} label={false} stroke="var(--cc-card)" strokeWidth={data.length > 1 ? 2 : 0}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip
          {...chartTooltipProps}
          formatter={(v: unknown, name: unknown) => [`${formatNumber(Number(v ?? 0))} views`, platformLabel(String(name))]}
        />
        {/* 40, not 24: recharts pins the legend wrapper to this height and lays
            its items out as inline-blocks that never wrap. Three platform names
            need 271px and the wrapper is 259px at a 768px window, so the row
            either ran outside the wrapper or -- once the stylesheet let it wrap
            -- ran 14px below it. 40px is the room the second line needs; the
            legend is still one line wherever it fits. MEASURED 2026-09-15. */}
        <Legend {...chartLegendProps} itemSorter={null} verticalAlign="bottom" height={40} />
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
        <XAxis dataKey="name" tick={chartAxisTick} axisLine={false} tickLine={false} />
        <YAxis
          yAxisId="views"
          tick={{ ...chartAxisTick, fill: "var(--chart-1)" }}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v) => formatCompact(Number(v))}
        />
        <YAxis
          yAxisId="likes"
          orientation="right"
          tick={{ ...chartAxisTick, fill: "var(--chart-3)" }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v) => formatCompact(Number(v))}
        />
        <Tooltip
          {...chartTooltipProps}
          formatter={(v: unknown, name: unknown) => [v == null ? "—" : formatNumber(Number(v)), String(name)]}
        />
        {/* Formatted like the pie chart's legend above. Left to itself recharts
            paints each label in its series colour, so "Likes" rendered in the
            green of its own bar -- 2.62:1 on the light ground. A series colour
            is chosen to read as a bar, not as 12px text; the swatch beside the
            label already carries it. */}
        <Legend {...chartLegendProps} itemSorter={null} verticalAlign="top" height={24} />
        <Bar isAnimationActive={false} yAxisId="views" dataKey="views" name="Views" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
        <Bar isAnimationActive={false} yAxisId="likes" dataKey="likes" name="Likes" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
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
        <Pie isAnimationActive={false} data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value" paddingAngle={2}>
          <Cell fill="var(--cc-primary)" />
          {/* The "remaining" arc used --cc-bg, the page background, which sits
              on a --cc-card surface: the page's off-white on a white card is not
              a visible arc. --ui-bg-3 is the neutral one step past the card
              in all three themes. */}
          <Cell fill="var(--ui-bg-3)" />
        </Pie>
        <Tooltip {...chartTooltipProps} formatter={(v: unknown) => formatCurrency(Number(v ?? 0), currency)} />
      </PieChart>
    </ChartFrame>
  );
}
