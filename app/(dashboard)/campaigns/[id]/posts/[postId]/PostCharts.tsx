"use client";
import React from "react";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

type PerformancePoint = { date: string; views: number; likes: number; comments: number };
type TrackingPoint = { ts: string; views: number; engagement: number };

export function PerformanceOverTimeArea({ data }: { data: PerformancePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
        <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
        <YAxis tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
        <Tooltip
          contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 8, fontSize: 13 }}
        />
        <Area type="monotone" dataKey="views" name="Views" stroke="#5B5BD6" fill="#5B5BD6" fillOpacity={0.1} />
        <Area type="monotone" dataKey="likes" name="Likes" stroke="#EC4899" fill="#EC4899" fillOpacity={0.1} />
        <Area type="monotone" dataKey="comments" name="Comments" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.1} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function TrackingLine({ data }: { data: TrackingPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
        <XAxis dataKey="ts" tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} />
        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} />
        <Tooltip contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 8, fontSize: 13 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line yAxisId="left" type="monotone" dataKey="views" name="Views" stroke="#5B5BD6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        <Line yAxisId="right" type="monotone" dataKey="engagement" name="Engagement" stroke="#EC4899" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
