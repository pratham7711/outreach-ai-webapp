"use client";
import React from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";

type SpendPoint = { date: string; spend: number; views: number };
type PlatformSlice = { platform: string; spend: number; views: number; postsCount: number };
type CampaignSpend = { campaignId: string; title: string; spend: number; budget: number; views: number; creatorsCount: number };

type Fmt = (n: number) => string;

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
    <ResponsiveContainer width="100%" height={240} minWidth={0}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#5B5BD6" stopOpacity={0.12} />
            <stop offset="95%" stopColor="#5B5BD6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#059669" stopOpacity={0.12} />
            <stop offset="95%" stopColor="#059669" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#E4E6F0" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: "#9097B4", fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="spend" tick={{ fill: "#9097B4", fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
        <YAxis yAxisId="views" orientation="right" tick={{ fill: "#9097B4", fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
        <Tooltip
          contentStyle={{
            background: "white", border: "1px solid #E4E6F0", borderRadius: 10,
            color: "#1C2048", boxShadow: "0 4px 24px rgba(0,0,0,0.06)", fontSize: 13, padding: "10px 14px",
          }}
          formatter={(value, name) => [
            name === "spend" ? formatCurrency(Number(value)) : formatNumber(Number(value)),
            name === "spend" ? "Spend" : "Views",
          ]}
        />
        <Area yAxisId="spend" type="monotone" dataKey="spend" stroke="#5B5BD6" strokeWidth={2.5} fill="url(#spendGradient)" dot={{ fill: "#5B5BD6", stroke: "#fff", strokeWidth: 2, r: 4 }} activeDot={{ fill: "#5B5BD6", stroke: "#fff", strokeWidth: 2, r: 6 }} />
        <Area yAxisId="views" type="monotone" dataKey="views" stroke="#059669" strokeWidth={2} fill="url(#viewsGradient)" dot={{ fill: "#059669", stroke: "#fff", strokeWidth: 2, r: 3 }} />
      </AreaChart>
    </ResponsiveContainer>
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
          innerRadius={50}
          outerRadius={80}
          dataKey="views"
          nameKey="platform"
        >
          {data.map((entry, i) => (
            <Cell key={entry.platform} fill={colors[i]} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => formatNumber(Number(v))} />
      </PieChart>
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
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#E4E6F0" horizontal={false} />
        <XAxis type="number" tick={{ fill: "#9097B4", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v)} />
        <YAxis dataKey="title" type="category" tick={{ fill: "#9097B4", fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
        <Tooltip formatter={(v) => formatCurrency(Number(v))} />
        <Bar dataKey="spend" fill="#5B5BD6" radius={[0, 4, 4, 0]} barSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
