"use client";

import { useId, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { Trend } from "@/lib/portal/statsMath";
import { trendChange } from "@/lib/portal/statsMath";
import type { InstagramInsightsBody } from "@/lib/portal/instagramInsightsRead";
import { TotalAreaChart, spanLabel } from "@/components/insights/charts";
import { NewFollowersChart, hasNewFollowerSeries } from "@/components/insights/instagramSections";
import { NUM, Panel, Toggle, formatPercent, muted } from "@/components/insights/parts";
import { SourceLabel, formatDay, platformLabel } from "@/components/portal/app/ui";

export const TRACKER_SOURCE = "From your public profile · read by our tracker";

type View = "total" | "daily";

const full = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** "+1,204 (2.6%) in the last 30 days", or "since Oct 2" when the readings start later. */
function ChangeLine({ trend }: { trend: Trend }) {
  const c = trendChange(trend.points, 30);
  if (!c) return null;
  const up = c.change >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span style={{ ...NUM, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--cc-text)" }}>
      <Icon size={16} aria-hidden="true" style={{ color: up ? "var(--cc-success)" : "var(--cc-danger)" }} />
      <strong style={{ fontWeight: 700 }}>
        {up ? "+" : "−"}
        {full(Math.abs(c.change))}
      </strong>
      {c.pct !== null && <span>({formatPercent(Math.abs(c.pct))})</span>}
      <span style={{ color: "var(--cc-text-muted)" }}>{c.wholeWindow ? "in the last 30 days" : `since ${formatDay(c.since)}`}</span>
    </span>
  );
}

/**
 * How the account's audience has moved: the follower total as our tracker
 * read it, and -- for Instagram -- the new followers Instagram counted each
 * day. Two quantities, two charts, one shown at a time; never one axis. Each
 * is offered only when its readings exist, and the panel is left out when
 * neither does.
 */
export default function GrowthPanel({
  trend,
  instagram,
  unit,
  title,
}: {
  trend: Trend | null;
  instagram: InstagramInsightsBody | null;
  unit: string;
  /** Names the profile when the chart stands apart from its account's dashboard. */
  title?: string;
}) {
  const id = useId();
  const hasTotal = Boolean(trend && trend.points.length > 0);
  const hasDaily = hasNewFollowerSeries(instagram);
  const [view, setView] = useState<View>(hasTotal ? "total" : "daily");
  if (!hasTotal && !hasDaily) return null;
  const current: View = view === "total" && !hasTotal ? "daily" : view === "daily" && !hasDaily ? "total" : view;
  const points = trend?.points ?? [];
  const last = points[points.length - 1];

  return (
    <Panel labelledBy={id}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px 16px", flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h3 id={id} style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
            {title ?? (current === "total" ? `${unit[0].toUpperCase()}${unit.slice(1)} over time` : "New followers per day")}
          </h3>
          {current === "total" && last && (
            <div style={{ display: "flex", alignItems: "baseline", gap: "4px 14px", flexWrap: "wrap", marginTop: 6 }}>
              <span style={{ ...NUM, fontSize: 28, fontWeight: 700, color: "var(--cc-text)", lineHeight: 1.1 }}>{full(last.followers)}</span>
              {trend && <ChangeLine trend={trend} />}
            </div>
          )}
        </div>
        {hasTotal && hasDaily && (
          <Toggle
            label="Growth view"
            value={current}
            onChange={setView}
            options={[
              { value: "total", label: "Total" },
              { value: "daily", label: "New per day" },
            ]}
          />
        )}
      </div>

      {current === "total" && trend ? (
        <>
          {points.length > 1 ? (
            <TotalAreaChart points={points.map((p) => ({ day: p.day, value: p.followers }))} unit={unit} label={`${unit} on ${platformLabel(trend.platform)}, ${spanLabel(points.map((p) => ({ day: p.day, value: p.followers })))}`} />
          ) : (
            <p style={muted}>One reading so far, on {formatDay(points[0].day)}. The line starts with the next.</p>
          )}
          <SourceLabel>{TRACKER_SOURCE}</SourceLabel>
        </>
      ) : (
        instagram && (
          <>
            <NewFollowersChart data={instagram} />
            <SourceLabel>From Instagram · insights</SourceLabel>
          </>
        )
      )}
    </Panel>
  );
}
