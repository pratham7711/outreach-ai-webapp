"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Card, StatCard, Badge, EmptyState, Skeleton, Avatar } from "@pratham7711/ui";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Eye, Heart, Percent, DollarSign, Target, TrendingUp } from "lucide-react";

type Kpis = {
  views: number;
  engagements: number;
  engagementRate: number | null;
  spend: number;
  cpm: number | null;
  cpe: number | null;
  emv: number;
};

type TimeSeriesPoint = { date: string; TIKTOK: number; INSTAGRAM: number; YOUTUBE: number };
type PlatformSplit = { platform: string; views: number; posts: number };
type LeaderboardRow = {
  creatorId: string;
  name: string;
  avatarUrl: string | null;
  posts: number;
  views: number;
  engagements: number;
  engagementRate: number | null;
  emv: number;
};

type PerformanceData = {
  currency: string;
  spendSource: "PAID_PAYOUTS" | "BUDGET";
  kpis: Kpis;
  timeSeries: TimeSeriesPoint[];
  platformSplit: PlatformSplit[];
  leaderboard: LeaderboardRow[];
};

const PLATFORM_COLORS: Record<string, string> = {
  TIKTOK: "#000000",
  INSTAGRAM: "#E4405F",
  YOUTUBE: "#FF0000",
  TWITTER: "#1DA1F2",
};

const SERIES = [
  { key: "TIKTOK", color: PLATFORM_COLORS.TIKTOK },
  { key: "INSTAGRAM", color: PLATFORM_COLORS.INSTAGRAM },
  { key: "YOUTUBE", color: PLATFORM_COLORS.YOUTUBE },
] as const;

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return String(num);
}

function formatCurrency(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function LoadingState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
        {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height="88px" borderRadius="12px" />)}
      </div>
      <Skeleton width="100%" height="320px" borderRadius="12px" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 24 }}>
        <Skeleton width="100%" height="300px" borderRadius="12px" />
        <Skeleton width="100%" height="300px" borderRadius="12px" />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card variant="outlined" style={{ padding: 32 }}>
      <EmptyState
        icon="⚠️"
        title="Couldn't load performance"
        description="Something went wrong while fetching campaign performance."
        action={
          <button
            onClick={onRetry}
            style={{
              background: "var(--cc-primary)", color: "white", border: "none",
              borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            Retry
          </button>
        }
      />
    </Card>
  );
}

export default function PerformanceTab({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/performance`);
      if (!res.ok) throw new Error("request failed");
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState onRetry={load} />;

  const { kpis, timeSeries, platformSplit, leaderboard, currency, spendSource } = data;

  if (kpis.views === 0 && leaderboard.length === 0 && timeSeries.length === 0) {
    return (
      <Card variant="outlined" style={{ padding: 32 }}>
        <EmptyState
          icon="📊"
          title="No posts yet — add posts to see performance"
          description="Once creators publish content for this campaign, performance metrics will appear here."
        />
      </Card>
    );
  }

  const engRateDisplay = kpis.engagementRate !== null ? (kpis.engagementRate * 100).toFixed(2) + "%" : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
        <StatCard value={formatNumber(kpis.views)} label="Views" icon={<Eye size={16} />} />
        <StatCard value={formatNumber(kpis.engagements)} label="Engagements" icon={<Heart size={16} />} />
        <StatCard value={engRateDisplay} label="Eng. Rate" icon={<Percent size={16} />} />
        <StatCard
          value={formatCurrency(kpis.spend, currency)}
          label={spendSource === "PAID_PAYOUTS" ? "Spend (paid)" : "Spend (budget)"}
          icon={<DollarSign size={16} />}
        />
        <StatCard
          value={`${kpis.cpm !== null ? formatCurrency(kpis.cpm, currency) : "—"} / ${kpis.cpe !== null ? formatCurrency(kpis.cpe, currency) : "—"}`}
          label="CPM / CPE"
          icon={<Target size={16} />}
        />
        <StatCard value={formatCurrency(kpis.emv, currency)} label="EMV" icon={<TrendingUp size={16} />} />
      </div>

      <Card variant="outlined" style={{ padding: 24 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
          Views Over Time by Platform
        </span>
        {timeSeries.length > 0 ? (
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  {SERIES.map((s) => (
                    <linearGradient key={s.key} id={`perfGrad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
                <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
                <YAxis tickFormatter={(v) => formatNumber(Number(v))} tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
                <Tooltip
                  labelFormatter={(l) => formatDate(String(l))}
                  formatter={(v: any) => formatNumber(Number(v ?? 0))}
                  contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {SERIES.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stackId="views"
                    stroke={s.color}
                    fill={`url(#perfGrad-${s.key})`}
                    strokeWidth={2}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState icon="📈" title="No time-series data" description="Views over time will appear as posts accumulate metrics." />
        )}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 24 }}>
        <Card variant="outlined" style={{ padding: 24 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>
            Platform Split
          </span>
          {platformSplit.length > 0 ? (
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={platformSplit}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    dataKey="views"
                    nameKey="platform"
                    paddingAngle={2}
                    label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {platformSplit.map((entry) => (
                      <Cell key={entry.platform} fill={PLATFORM_COLORS[entry.platform] ?? "var(--cc-primary)"} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: any, _n: any, item: any) => [`${formatNumber(Number(v ?? 0))} views · ${(item?.payload as PlatformSplit)?.posts ?? 0} posts`, (item?.payload as PlatformSplit)?.platform ?? ""]}
                    contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon="🥧" title="No platform data" />
          )}
        </Card>

        <Card variant="solid" noPadding>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Top Creators</span>
          </div>
          {leaderboard.length > 0 ? (
            <div>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 70px 90px 80px 90px",
                gap: 12, padding: "10px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
              }}>
                {["Creator", "Posts", "Views", "Eng.", "EMV"].map((h) => (
                  <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
                ))}
              </div>
              {leaderboard.map((row, i) => (
                <div
                  key={row.creatorId}
                  style={{
                    display: "grid", gridTemplateColumns: "1fr 70px 90px 80px 90px", gap: 12,
                    padding: "12px 24px", alignItems: "center",
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <Avatar name={row.name} src={row.avatarUrl ?? undefined} size="sm" />
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                  </div>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{row.posts}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(row.views)}</span>
                  <Badge variant="neutral" size="sm">{row.engagementRate !== null ? (row.engagementRate * 100).toFixed(1) + "%" : "—"}</Badge>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-primary)" }}>{formatCurrency(row.emv, currency)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 24 }}>
              <EmptyState icon="🏆" title="No creators yet" />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
