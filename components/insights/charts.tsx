"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { ChartFrame } from "@/components/ds/ChartFrame";
import { formatCount, formatDay } from "@/components/portal/app/ui";

/**
 * The two charts a creator's numbers need: a running total over time (followers
 * as our tracker read them) and a count per day (new followers, as Instagram
 * reports them). They are different quantities and never share an axis.
 *
 * Both draw in the theme's primary, ink-on-paper in the black-and-white themes,
 * and answer a hover or a tap with the day and its exact figure. The line draws
 * itself in once, on first paint, unless the reader asked for reduced motion.
 */

export type DayValue = { day: string; value: number };

const tick = { fontSize: 12, fill: "var(--cc-text-muted)" };

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true,
  );
}

/** Draws its chart only once the box has a width. Every account's dashboard
    stays mounted under My stats' tabs, hidden, and a chart measured inside a
    hidden panel is 0 wide; it draws when its tab is opened instead. */
function Measured({ height, children }: { height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* The observer reports the box once on observe, then on every resize. */
    const observer = new ResizeObserver(() => setWide(el.getBoundingClientRect().width > 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ minHeight: height, minWidth: 0 }}>
      {wide ? children : null}
    </div>
  );
}

const shortDay = (day: unknown) => {
  const d = new Date(`${String(day)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(day) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

function TipBox({ day, value }: { day: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: 10,
        padding: "8px 10px",
        boxShadow: "0 6px 20px -8px color-mix(in srgb, var(--cc-shadow-ink) 25%, transparent)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{day}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)", marginTop: 2 }}>{value}</div>
    </div>
  );
}

function tipContent(describe: (value: number) => string) {
  function Tip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
    const value = payload?.[0]?.value;
    if (!active || typeof value !== "number") return null;
    return <TipBox day={shortDay(label)} value={describe(value)} />;
  }
  return Tip;
}

const full = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** A running total: the follower count our tracker read each day. The axis
    starts near the lowest reading, not at zero, so a month's growth is visible
    rather than a flat line along the top. */
export function TotalAreaChart({
  points,
  label,
  unit,
  height = 220,
}: {
  points: DayValue[];
  label: string;
  /** "followers", "subscribers": what the tooltip calls one reading. */
  unit: string;
  height?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const fillId = `total-area-${useId().replace(/:/g, "")}`;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(1, Math.round((max - min) * 0.15));
  const Tip = tipContent((v) => `${full(v)} ${unit}`);
  return (
    <figure style={{ margin: 0 }} aria-label={label}>
      <Measured height={height}>
      <ChartFrame height={height}>
        <AreaChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--cc-primary)", stopOpacity: 0.16 }} />
              <stop offset="100%" style={{ stopColor: "var(--cc-primary)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--cc-border)" strokeDasharray="0" />
          <XAxis dataKey="day" tick={tick} tickLine={false} axisLine={false} tickFormatter={shortDay} minTickGap={36} />
          <YAxis
            tick={tick}
            tickLine={false}
            axisLine={false}
            width={44}
            domain={[Math.max(0, min - pad), max + pad]}
            allowDecimals={false}
            tickFormatter={(v) => formatCount(Number(v))}
          />
          <Tooltip content={Tip} cursor={{ stroke: "var(--cc-text-muted)", strokeWidth: 1, strokeDasharray: "3 3" }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--cc-primary)"
            strokeWidth={2}
            fill={`url(#${fillId})`}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--cc-card)", fill: "var(--cc-primary)" }}
            isAnimationActive={!reduced}
            animationDuration={700}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ChartFrame>
      </Measured>
    </figure>
  );
}

/** A count per day: Instagram's new followers, one bar each. A day it sent no
    figure for is not drawn as a zero bar; it is simply absent from the data. */
export function DailyBarChart({
  points,
  label,
  describe,
  height = 220,
}: {
  points: DayValue[];
  label: string;
  /** How the tooltip words one day's figure: "+142 new followers". */
  describe: (value: number) => string;
  height?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const Tip = tipContent(describe);
  return (
    <figure style={{ margin: 0 }} aria-label={label}>
      <Measured height={height}>
      <ChartFrame height={height}>
        <BarChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--cc-border)" />
          <XAxis dataKey="day" tick={tick} tickLine={false} axisLine={false} tickFormatter={shortDay} minTickGap={36} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={44} allowDecimals={false} tickFormatter={(v) => formatCount(Number(v))} />
          <Tooltip content={Tip} cursor={{ fill: "var(--cc-hover-bg)" }} />
          <Bar
            dataKey="value"
            fill="var(--cc-primary)"
            radius={[3, 3, 0, 0]}
            maxBarSize={18}
            isAnimationActive={!reduced}
            animationDuration={500}
            animationEasing="ease-out"
          />
        </BarChart>
      </ChartFrame>
      </Measured>
    </figure>
  );
}

/** "Sep 27 – Oct 25", for the line under a chart. */
export function spanLabel(points: DayValue[]): string {
  if (points.length === 0) return "";
  const first = formatDay(points[0].day);
  return points.length === 1 ? first : `${first} – ${formatDay(points[points.length - 1].day)}`;
}
