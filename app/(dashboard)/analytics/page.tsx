"use client";
import React, { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Button, Card, Skeleton, EmptyState } from "@pratham7711/ui";
import { Eye, ThumbsUp, DollarSign, TrendingUp, MessageCircle, BarChart2, BarChart3, Calendar, Smartphone } from "lucide-react";
import CampaignComparison from "./CampaignComparison";
import CreatorLeaderboard, { LeaderboardCreator } from "./CreatorLeaderboard";
import { formatNumber, formatCurrency, RANGE_PRESETS, PLATFORM_FILTERS, rangeToFrom } from "./shared";

const MonthlyTrendArea = dynamic(() => import("./AnalyticsCharts").then((m) => m.MonthlyTrendArea), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="100%" borderRadius="8px" />,
});

const PlatformBreakdownBar = dynamic(() => import("./AnalyticsCharts").then((m) => m.PlatformBreakdownBar), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="100%" borderRadius="8px" />,
});

type KPIs = {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalSpend: number;
  avgEngagementRate: number;
  avgCPM: number;
  totalPosts: number;
  totalPayouts: number;
};

type CampaignOption = { id: string; title: string; status: string };

type AnalyticsData = {
  kpis: KPIs;
  monthlyTrend: { month: string; campaigns: number; active: number }[];
  leaderboard: LeaderboardCreator[];
  platformBreakdown: { platform: string; views: number; posts: number }[];
  campaigns: CampaignOption[];
};

import { platformColor } from "./shared";

function StatTile({
  label, value, sub, icon: Icon, color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card variant="outlined" style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "var(--cc-text-muted)", fontWeight: 500 }}>{label}</span>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={15} color={color} />
        </div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

function FilterBar({
  range, platform, onRange, onPlatform,
}: {
  range: string;
  platform: string;
  onRange: (v: string) => void;
  onPlatform: (v: string) => void;
}) {
  const pillGroup = (
    options: { key: string; label: string }[],
    active: string,
    onChange: (v: string) => void,
  ) => (
    <div style={{ display: "inline-flex", background: "var(--cc-bg)", border: "1px solid var(--cc-border)", borderRadius: 8, padding: 4, gap: 4 }}>
      {options.map((o) => {
        const isActive = o.key === active;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            style={{
              border: "none",
              cursor: "pointer",
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 600,
              background: isActive ? "var(--cc-primary)" : "transparent",
              color: isActive ? "#fff" : "var(--cc-text-muted)",
              transition: "background 0.12s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginBottom: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--cc-text-subtle)", textTransform: "uppercase", letterSpacing: 0.4 }}>Date range</span>
        {pillGroup(RANGE_PRESETS, range, onRange)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--cc-text-subtle)", textTransform: "uppercase", letterSpacing: 0.4 }}>Platform</span>
        {pillGroup(PLATFORM_FILTERS, platform, onPlatform)}
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Skeleton height="60px" borderRadius="12px" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height="96px" borderRadius="12px" />)}
      </div>
      <Skeleton height="280px" borderRadius="12px" />
      <Skeleton height="320px" borderRadius="12px" />
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [range, setRange] = useState("30d");
  const [platform, setPlatform] = useState("ALL");

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    const from = rangeToFrom(range);
    if (from) params.set("from", from);
    if (platform !== "ALL") params.set("platform", platform);
    const qs = params.toString();
    fetch(`/api/analytics${qs ? `?${qs}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (d && d.kpis) setData(d);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [range, platform]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="rsp-page page-enter">
      <style>{`.an-chart{height:220px}@media(min-width:768px){.an-chart{height:300px}}`}</style>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Analytics</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Org-wide performance across all campaigns and creators</p>
      </div>

      <FilterBar range={range} platform={platform} onRange={setRange} onPlatform={setPlatform} />

      {loading ? (
        <SkeletonGrid />
      ) : error || !data ? (
        <EmptyState
          icon={<BarChart3 size={32} color="var(--cc-text-subtle)" />}
          title="Failed to load analytics"
          description="Adjust your filters or refresh to try again."
          action={<Button variant="secondary" onClick={load}>Retry</Button>}
        />
      ) : (
        <>
          <div className="rsp-grid-tiles" style={{ marginBottom: 24 }}>
            <StatTile label="Total Views" value={formatNumber(data.kpis.totalViews)} sub={`${formatNumber(data.kpis.totalPosts)} posts`} icon={Eye} color="var(--cc-primary)" />
            <StatTile label="Total Likes" value={formatNumber(data.kpis.totalLikes)} icon={ThumbsUp} color="#E4405F" />
            <StatTile label="Total Comments" value={formatNumber(data.kpis.totalComments)} icon={MessageCircle} color="#F59E0B" />
            <StatTile label="Total Spend" value={formatCurrency(data.kpis.totalSpend)} sub={`${data.kpis.totalPayouts} payouts`} icon={DollarSign} color="#10B981" />
            <StatTile label="Avg Engagement Rate" value={data.kpis.avgEngagementRate.toFixed(1) + "%"} icon={TrendingUp} color="#8B5CF6" />
            <StatTile label="Avg CPM" value={data.kpis.avgCPM > 0 ? formatCurrency(data.kpis.avgCPM) : "—"} sub="per 1K views" icon={BarChart2} color="#06B6D4" />
          </div>

          <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 20 }}>
              Campaigns Launched — Last 6 Months
            </span>
            {data.monthlyTrend.every((m) => m.campaigns === 0) ? (
              <EmptyState icon={<Calendar size={32} color="var(--cc-text-subtle)" />} title="No campaign data" description="Launch campaigns to see monthly trends." />
            ) : (
              <div className="an-chart">
                <MonthlyTrendArea data={data.monthlyTrend} />
              </div>
            )}
          </Card>

          <CampaignComparison campaigns={data.campaigns} range={range} platform={platform} />

          <div className="rsp-split" style={{ gap: 24, marginBottom: 24 }}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <CreatorLeaderboard creators={data.leaderboard} />
            </div>

            <Card variant="outlined" style={{ padding: 24, flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 20 }}>
                Views by Platform
              </span>
              {data.platformBreakdown.length === 0 ? (
                <EmptyState icon={<Smartphone size={32} color="var(--cc-text-subtle)" />} title="No data" />
              ) : (
                <div style={{ height: 200 }}>
                  <PlatformBreakdownBar data={data.platformBreakdown} />
                </div>
              )}
              {data.platformBreakdown.length > 0 && (
                <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.platformBreakdown.map((p) => (
                    <div key={p.platform} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: platformColor(p.platform), flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{p.platform}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text)" }}>{p.posts} posts</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
