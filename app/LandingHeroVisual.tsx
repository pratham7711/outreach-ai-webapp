"use client";

import { useEffect, useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "framer-motion";
import { formatCompact, formatFull } from "@/lib/format";

type Platform = "tiktok" | "instagram" | "youtube";
type Filter = "all" | Platform;

const PLATFORMS: { key: Platform; label: string; tone: string; color: string; posts: number; engagements: number }[] = [
  { key: "tiktok", label: "TikTok", tone: "lp-tone-blue", color: "var(--cc-landing-tiktok)", posts: 8, engagements: 96000 },
  { key: "instagram", label: "Instagram", tone: "lp-tone-pink", color: "var(--cc-landing-instagram)", posts: 5, engagements: 38400 },
  { key: "youtube", label: "YouTube", tone: "lp-tone-orange", color: "var(--cc-landing-youtube)", posts: 2, engagements: 15600 },
];

const VIEWS: Record<Platform, number[]> = {
  tiktok: [20000, 60000, 130000, 220000, 330000, 450000, 560000, 670000, 770000, 860000, 950000, 1040000, 1120000, 1160000, 1200000],
  instagram: [10000, 30000, 60000, 100000, 140000, 190000, 230000, 270000, 310000, 350000, 390000, 420000, 450000, 465000, 480000],
  youtube: [0, 10000, 20000, 40000, 60000, 80000, 100000, 130000, 150000, 180000, 200000, 220000, 240000, 250000, 260000],
};

const DATA = VIEWS.tiktok.map((_, i) => ({
  day: i + 1,
  tiktok: VIEWS.tiktok[i],
  instagram: VIEWS.instagram[i],
  youtube: VIEWS.youtube[i],
}));

const DAYS = DATA.length;
const TICKS_WIDE = DATA.filter((d) => d.day % 2 === 1).map((d) => d.day);
const TICKS_NARROW = [1, 8, 15];
const AXIS = { fontSize: 12, fill: "var(--cc-landing-muted)" } as const;

function lastViews(key: Platform): number {
  return VIEWS[key][VIEWS[key].length - 1];
}

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

export function LandingHeroVisual() {
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState<Filter>("all");
  const gradientBase = useId().replace(/:/g, "");
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 479px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const shown = filter === "all" ? PLATFORMS : PLATFORMS.filter((p) => p.key === filter);
  const views = shown.reduce((sum, p) => sum + lastViews(p.key), 0);
  const engagements = shown.reduce((sum, p) => sum + p.engagements, 0);
  const posts = shown.reduce((sum, p) => sum + p.posts, 0);

  const summary = `Views to date over ${DAYS} days on ${posts} posts: ${shown
    .map((p) => `${p.label} ${formatFull(lastViews(p.key))}`)
    .join(", ")}.`;

  const options: { key: Filter; label: string; tone: string }[] = [
    { key: "all", label: "All platforms", tone: "lp-tone-violet" },
    ...PLATFORMS.map((p) => ({ key: p.key, label: p.label, tone: p.tone })),
  ];

  return (
    <figure className="lp-card lp-card-elevated lp-rise lp-rise-3">
      <div className="lp-card-head lp-card-head-spaced">
        <div style={{ minWidth: 0 }}>
          <p className="lp-kpi-label">Campaign · Summer single launch</p>
          <p className="lp-h3">Views across every tracked post</p>
        </div>
        <span className="lp-demo-badge">Demo data</span>
      </div>

      <div className="lp-seg lp-seg-quad" role="group" aria-label="Show platform">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className={`lp-seg-btn ${o.tone}`}
            aria-pressed={filter === o.key}
            onClick={() => setFilter(o.key)}
          >
            {o.key !== "all" && <span className="lp-dot" aria-hidden />}
            {o.label}
          </button>
        ))}
      </div>

      <dl className="lp-kpis">
        <div>
          <dt className="lp-kpi-label">Views</dt>
          <dd className="lp-kpi-value">{formatFull(views)}</dd>
        </div>
        <div>
          <dt className="lp-kpi-label">Engagements</dt>
          <dd className="lp-kpi-value">{formatFull(engagements)}</dd>
        </div>
        <div>
          <dt className="lp-kpi-label">Posts tracked</dt>
          <dd className="lp-kpi-value">{posts}</dd>
        </div>
      </dl>

      <div className="lp-chart">
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
      </div>

      <figcaption className="lp-caption" aria-live="polite">
        Demo data, invented for this preview. {summary}
      </figcaption>
    </figure>
  );
}
