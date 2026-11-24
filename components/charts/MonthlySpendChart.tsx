"use client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip,
} from "recharts";
// The deep path, not the ds barrel: MonthlySpendChart.test.tsx mocks recharts and
// would otherwise pull @pratham7711/ui and every other primitive in with it.
import { ChartFrame } from "@/components/ds/ChartFrame";
import { chartAxisTick, chartTooltipProps } from "@/components/charts/chartTheme";

export default function MonthlySpendChart({ data }: { data: { month: string; spend: number }[] }) {
  const total = data.reduce((a, d) => a + d.spend, 0);
  const summary = data.length
    ? `${data.length} months, ${data[0].month} to ${data[data.length - 1].month}. Total spend $${total.toLocaleString()}.`
    : undefined;
  return (
    <ChartFrame height={300} label="Monthly spend" summary={summary}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="month" tick={chartAxisTick} axisLine={false} tickLine={false} />
        <YAxis tick={chartAxisTick} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
        <Tooltip
          formatter={(v) => [`$${Number(v ?? 0).toLocaleString()}`, "Spend"]}
          {...chartTooltipProps}
        />
        <Bar isAnimationActive={false} dataKey="spend" name="Spend" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}
