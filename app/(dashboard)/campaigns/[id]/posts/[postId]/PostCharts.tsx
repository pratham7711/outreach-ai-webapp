"use client";
import React from "react";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { MetricHint } from "@/components/ds";
import { formatCompact, formatFull } from "@/lib/format";

type PerformancePoint = { date: string; views: number; likes: number; comments: number };
type TrackingPoint = { ts: string; views: number; engagement: number };

const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" } as const;

const chartTooltipStyle: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--popover-foreground)",
  fontSize: 13,
  padding: "8px 12px",
};

function PanelHeading({
  title,
  what,
  label,
}: {
  title: string;
  what: string;
  label: string;
}) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <span className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {title}
      </span>
      <MetricHint label={label} what={what} />
    </div>
  );
}

export function PerformanceOverTimeArea({ data }: { data: PerformancePoint[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <PanelHeading
          title="Views"
          label="Views"
          what="How many times this post was watched, at each recorded date."
        />
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="postViewsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(v) => formatCompact(Number(v))}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value) => [formatFull(Number(value)), "Views"]}
            />
            <Area
              type="monotone"
              dataKey="views"
              name="Views"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#postViewsGradient)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div>
        <PanelHeading
          title="Likes and comments"
          label="Likes and comments"
          what="Direct interactions with this post. Shown on their own scale because views are far larger."
        />
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(v) => formatCompact(Number(v))}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value, name) => [formatFull(Number(value)), String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area
              type="monotone"
              dataKey="likes"
              name="Likes"
              stroke="var(--chart-2)"
              fill="var(--chart-2)"
              fillOpacity={0.12}
              strokeWidth={2}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="comments"
              name="Comments"
              stroke="var(--chart-3)"
              fill="var(--chart-3)"
              fillOpacity={0.12}
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function TrackingLine({ data }: { data: TrackingPoint[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <PanelHeading
          title="Views"
          label="Views"
          what="Views recorded at each tracking snapshot."
        />
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="ts" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(v) => formatCompact(Number(v))}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value) => [formatFull(Number(value)), "Views"]}
            />
            <Line
              type="monotone"
              dataKey="views"
              name="Views"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <PanelHeading
          title="Engagement"
          label="Engagement"
          what="How much interaction this post had accumulated at each snapshot. Kept on its own scale so it is not flattened by the views figures."
        />
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="ts" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(v) => formatCompact(Number(v))}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value) => [formatFull(Number(value)), "Engagement"]}
            />
            <Line
              type="monotone"
              dataKey="engagement"
              name="Engagement"
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
