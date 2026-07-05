"use client";
import React from "react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

type PieDatum = { name?: string; value: number; fill?: string };
type BarDatum = { name: string; views: number; likes: number };

export function PlatformViewsPie({
  data,
  formatNumber,
}: {
  data: PieDatum[];
  formatNumber: (n: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={2} label={({ name, percent }: any) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip formatter={(v: any) => formatNumber(Number(v ?? 0))} contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12 }} />
      </PieChart>
    </ResponsiveContainer>
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
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
        <YAxis tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} tickFormatter={(v) => formatNumber(v)} />
        <Tooltip formatter={(v: any) => formatNumber(Number(v ?? 0))} contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12 }} />
        <Bar dataKey="views" fill="var(--cc-primary)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="likes" fill="#10B981" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
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
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value" paddingAngle={2}>
          <Cell fill="var(--cc-primary)" />
          <Cell fill="var(--cc-bg)" />
        </Pie>
        <Tooltip formatter={(v: any) => formatCurrency(Number(v ?? 0), currency)} contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
