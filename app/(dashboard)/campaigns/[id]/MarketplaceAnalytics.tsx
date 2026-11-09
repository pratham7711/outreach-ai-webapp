"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Card, EmptyState } from "@pratham7711/ui";
import { Button, MetricTile, SectionCard, Skeleton, StatusBadge } from "@/components/ds";
import { chartAxisTick, chartTooltipProps } from "@/components/charts/chartTheme";
import { AlertTriangle, Users } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar,
} from "recharts";
import { ChartFrame } from "@/components/ds/ChartFrame";
import { SeriesModeToggle } from "@/components/charts/SeriesModeToggle";
import { fillUtcDays, toRunningTotals, type SeriesMode } from "@/lib/charts/seriesMode";
import { formatFull } from "@/lib/format";
import { SHOW_MONEY } from "@/lib/moneyUi";

type Analytics = {
  visibility: "PRIVATE" | "GLOBAL" | "INVITE_ONLY";
  joinsOverTime: { date: string; joins: number; cumulative: number }[];
  submissionsByStatus: { status: string; count: number }[];
  budget: {
    accruedMajor: number;
    capMajor: number | null;
    fraction: number | null;
    capReached: boolean;
  };
  projectedExhaustionDate: string | null;
  totals: { joins: number; submissions: number };
};

function formatNumber(num: number): string {
  return formatFull(num);
}

function formatCurrency(n: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function MarketplaceAnalytics({
  campaignId,
  currency = "USD",
}: {
  campaignId: string;
  currency?: string;
}) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [joinsMode, setJoinsMode] = useState<SeriesMode>("cumulative");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/marketplace-analytics`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("failed");
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Card variant="outlined">
        <Skeleton width={180} height={18} />
        <div style={{ marginTop: 16 }}>
          <Skeleton width="100%" height={240} radius="var(--cc-r-card)" />
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card variant="outlined">
        <EmptyState
          icon={<AlertTriangle size={32} color="var(--cc-text-subtle)" />}
          title="Couldn't load marketplace analytics"
          description="Something went wrong while fetching marketplace analytics."
          action={
            <Button variant="primary" size="sm" onClick={load}>
              Retry
            </Button>
          }
        />
      </Card>
    );
  }

  const { budget } = data;
  const pct = budget.fraction != null ? Math.round(budget.fraction * 100) : null;
  /* The server lists only days that had a join. A day without one is a day on
     which nobody joined, so both views get every day: 0 bars, and a flat line. */
  const joinDays = toRunningTotals(
    fillUtcDays(data.joinsOverTime, (r) => r.date, (date) => ({ date, joins: 0, cumulative: 0 })).map((r) => ({
      ...r,
      cumulative: r.joins,
    })),
    ["cumulative"],
  );
  const eta = data.projectedExhaustionDate
    // UTC named, so the server render and the browser's cannot disagree. See lib/format.
    ? new Date(data.projectedExhaustionDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null;
  const accruedText = formatCurrency(budget.accruedMajor, currency);
  const capText = budget.capMajor != null ? formatCurrency(budget.capMajor, currency) : "\u2014";
  /* One figure size for the row, set by its longest value. */
  const tileFit = Math.max(
    formatNumber(data.totals.joins).length,
    formatNumber(data.totals.submissions).length,
    SHOW_MONEY ? Math.max(accruedText.length, capText.length) : 0,
  );
  const joinsToggle =
    data.joinsOverTime.length > 0 ? (
      <SeriesModeToggle label="Creators joined" value={joinsMode} onChange={setJoinsMode} />
    ) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header stat tiles */}
      <div className="cc-tiles-balanced">
        <MetricTile fitTo={tileFit} label="Creators joined" value={formatNumber(data.totals.joins)} />
        <MetricTile fitTo={tileFit} label="Submissions" value={formatNumber(data.totals.submissions)} />
        {SHOW_MONEY && (
          <>
            <MetricTile fitTo={tileFit} label="Accrued" value={accruedText} />
            <MetricTile fitTo={tileFit} label="Budget cap" value={capText} />
          </>
        )}
      </div>

      <div className="mkt-an-split">
        {/* Joins over time chart */}
        <SectionCard
          title={joinsMode === "daily" ? "Creators joined per day" : "Creators joined over time"}
          action={joinsToggle}
        >
          {data.joinsOverTime.length > 0 && joinsMode === "daily" ? (
            <ChartFrame height={240}>
              <BarChart data={joinDays}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatDate} tick={chartAxisTick} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={chartAxisTick} axisLine={false} tickLine={false} />
                <Tooltip
                  {...chartTooltipProps}
                  labelFormatter={(l) => formatDate(String(l))}
                  formatter={(v: unknown) => [formatNumber(Number(v ?? 0)), "Joined"]}
                />
                <Bar isAnimationActive={false} dataKey="joins" name="Joined" fill="var(--cc-primary)" radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ChartFrame>
          ) : data.joinsOverTime.length > 0 ? (
            <ChartFrame height={240}>
              <AreaChart data={joinDays}>
                <defs>
                  <linearGradient id="mktJoins" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--cc-primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--cc-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatDate} tick={chartAxisTick} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={chartAxisTick} axisLine={false} tickLine={false} />
                <Tooltip
                  {...chartTooltipProps}
                  labelFormatter={(l) => formatDate(String(l))}
                  formatter={(v: unknown, name: unknown) => [formatNumber(Number(v ?? 0)), String(name)]}
                />
                <Area isAnimationActive={false} type="monotone" dataKey="cumulative" name="Total joined" stroke="var(--cc-primary)" strokeWidth={2} fill="url(#mktJoins)" />
              </AreaChart>
            </ChartFrame>
          ) : (
            <EmptyState icon={<Users size={32} color="var(--cc-text-subtle)" />} title="No joins yet" description="Creator joins will appear here once they enroll." />
          )}
        </SectionCard>

        {/* Right column: submissions by status + budget bar */}
        <SectionCard title="Submissions by status">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {data.submissionsByStatus.map((s) => {
              return (
                <div key={s.status} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <StatusBadge status={s.status} />
                  <span style={{ fontSize: "var(--cc-t-15)", fontWeight: 700, color: "var(--cc-text)" }}>{formatNumber(s.count)}</span>
                </div>
              );
            })}
          </div>

          <span style={{ fontWeight: 700, fontSize: "var(--cc-t-13)", color: "var(--cc-text)", display: "block", marginBottom: 8 }}>
            Budget accrued vs cap
          </span>
          {pct != null ? (
            <>
              <div style={{ height: 10, borderRadius: 6, background: "var(--cc-border)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: budget.capReached ? "var(--status-critical)" : "var(--cc-primary)", borderRadius: 6 }} />
              </div>
              <div style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginTop: 6 }}>
                {pct}% of pool {budget.capReached ? "— cap reached" : "claimed"}
              </div>
            </>
          ) : (
            <div style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>No budget cap set.</div>
          )}

          <div style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginTop: 16 }}>
            Projected exhaustion:{" "}
            <span style={{ fontWeight: 700, color: "var(--cc-text)" }}>{eta ?? "—"}</span>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

