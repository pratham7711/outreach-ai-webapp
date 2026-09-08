"use client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip,
} from "recharts";
// The deep path, not the ds barrel: MonthlySpendChart.test.tsx mocks recharts and
// would otherwise pull @pratham7711/ui and every other primitive in with it.
import { ChartFrame } from "@/components/ds/ChartFrame";

export default function MonthlySpendChart({ data }: { data: { month: string; spend: number }[] }) {
  return (
    <ChartFrame height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
        <Tooltip
          formatter={(v) => [`$${Number(v ?? 0).toLocaleString()}`, "Spend"]}
          contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--popover-foreground)", fontSize: 13 }}
        />
        <Bar dataKey="spend" name="Spend" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}
