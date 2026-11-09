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
  return (
    <ChartFrame height={300}>
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
