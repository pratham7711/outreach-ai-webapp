"use client";
import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type MonthlyTrend = { month: string; paid: number; pending: number };

export default function PayoutTrendChart({ data }: { data: MonthlyTrend[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} />
        <YAxis tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
        <Tooltip
          formatter={(value) => [`$${Number(value).toLocaleString()}`]}
          contentStyle={{ borderRadius: 8, border: "1px solid var(--cc-border)", fontSize: 13 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="paid" name="Paid" fill="#059669" radius={[4, 4, 0, 0]} />
        <Bar dataKey="pending" name="Pending" fill="#F59E0B" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
