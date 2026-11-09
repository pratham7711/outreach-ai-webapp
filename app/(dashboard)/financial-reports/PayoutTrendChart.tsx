"use client";
import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { ChartFrame } from "@/components/ds/ChartFrame";
import { chartAxisTick, chartLegendProps, chartTooltipProps } from "@/components/charts/chartTheme";

type MonthlyTrend = { month: string; paid: number; pending: number };

/* In the report's currency. The axis and the tooltip printed "$" whatever the
   report was in, so a rupee report read as dollars. */
const money = (currency: string, compact: boolean) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    ...(compact ? { notation: "compact" as const } : {}),
  });

export default function PayoutTrendChart({ data, currency = "USD" }: { data: MonthlyTrend[]; currency?: string }) {
  const axis = money(currency, true);
  const full = money(currency, false);
  return (
    <ChartFrame minHeight={200}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="month" tick={chartAxisTick} axisLine={false} tickLine={false} />
        <YAxis
          tick={chartAxisTick}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => axis.format(Number(v))}
        />
        <Tooltip {...chartTooltipProps} formatter={(value, name) => [full.format(Number(value)), name]} />
        <Legend {...chartLegendProps} />
        <Bar isAnimationActive={false} dataKey="paid" name="Paid" fill="var(--status-good)" radius={[4, 4, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="pending" name="Pending" fill="var(--status-warning)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}
