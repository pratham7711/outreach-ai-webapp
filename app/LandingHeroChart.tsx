"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, formatFull } from "@/lib/format";
import { AXIS, DATA, PLATFORMS, TICKS_NARROW, TICKS_WIDE, type Filter, type Platform } from "./landingHeroData";

/* The hero's chart on its own, so app/page.tsx can load it after first paint:
   recharts was ~85 KB gzipped of the landing page's first load. Everything the
   chart says in words -- the KPIs and the caption -- stays in LandingHeroVisual
   and is server-rendered as before. */

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const rows = PLATFORMS.filter((p) => payload.some((e) => e.dataKey === p.key));
  const value = (key: Platform) => payload.find((e) => e.dataKey === key)?.value ?? 0;
  const total = rows.reduce((sum, p) => sum + value(p.key), 0);
  return (
    <div className="lp-tooltip">
      <p className="lp-tooltip-title">Day {label} · views to date</p>
      {rows.map((p) => (
        <div key={p.key} className={`lp-tooltip-row ${p.tone}`}>
          <span>
            <span className="lp-dot" aria-hidden />
            {p.label}
          </span>
          <strong>{formatFull(value(p.key))}</strong>
        </div>
      ))}
      {rows.length > 1 && (
        <div className="lp-tooltip-row">
          <span>Total</span>
          <strong>{formatFull(total)}</strong>
        </div>
      )}
    </div>
  );
}

export default function LandingHeroChart({
  shown,
  filter,
  narrow,
  reduced,
  summary,
  gradientBase,
}: {
  shown: typeof PLATFORMS;
  filter: Filter;
  narrow: boolean;
  reduced: boolean | null;
  summary: string;
  gradientBase: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 232 }}>
      <AreaChart
        data={DATA}
        margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
        title={`Demo data. ${summary}`}
      >
        <defs>
          {PLATFORMS.map((p) => (
            <linearGradient key={p.key} id={`${gradientBase}-${p.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={p.color} stopOpacity={0.42} />
              <stop offset="100%" stopColor={p.color} stopOpacity={0.04} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 4" stroke="var(--cc-border)" vertical={false} />
        <XAxis
          dataKey="day"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          ticks={narrow ? TICKS_NARROW : TICKS_WIDE}
          interval={0}
          tickFormatter={(d: number) => `Day ${d}`}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v: number) => formatCompact(v)}
        />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ stroke: "var(--cc-text-subtle)", strokeDasharray: "3 3" }}
        />
        {shown.map((p) => (
          <Area
            key={p.key}
            type="monotone"
            dataKey={p.key}
            name={p.label}
            stackId={filter === "all" ? "views" : undefined}
            stroke={p.color}
            strokeWidth={2.25}
            strokeDasharray="none"
            fill={`url(#${gradientBase}-${p.key})`}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--cc-card)" }}
            isAnimationActive={!reduced}
            animationDuration={700}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
