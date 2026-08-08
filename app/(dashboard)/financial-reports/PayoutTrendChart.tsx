"use client";
import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type MonthlyTrend = { month: string; paid: number; pending: number };

const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" } as const;

export default function PayoutTrendChart({ data }: { data: MonthlyTrend[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="month" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          formatter={(value) => [`$${Number(value).toLocaleString()}`]}
          contentStyle={{
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            borderRadius: 10,
            border: "1px solid var(--border)",
            fontSize: 13,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="paid" name="Paid" fill="var(--status-good)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="pending" name="Pending" fill="var(--status-warning)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
