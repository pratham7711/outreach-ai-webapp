"use client";
import { useState, useEffect } from "react";
import { Card, Badge, Skeleton, EmptyState, Avatar } from "@pratham7711/ui";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar,
} from "recharts";
import { Eye, ThumbsUp, DollarSign, TrendingUp, MessageCircle, BarChart2 } from "lucide-react";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

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

type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  followersCount: number;
  views: number;
  likes: number;
  posts: number;
  earnings: number;
};

type AnalyticsData = {
  kpis: KPIs;
  monthlyTrend: { month: string; campaigns: number; active: number }[];
  leaderboard: Creator[];
  platformBreakdown: { platform: string; views: number; posts: number }[];
};

const PLATFORM_COLORS: Record<string, string> = {
  TIKTOK: "#000000",
  INSTAGRAM: "#E4405F",
  YOUTUBE: "#FF0000",
  TWITTER: "#1DA1F2",
  SPOTIFY: "#1DB954",
};

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  color,
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

function SkeletonGrid() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
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

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (d && d.kpis) setData(d);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="cc-page-content"><SkeletonGrid /></div>;
  if (error || !data) return (
    <div className="cc-page-content">
      <EmptyState icon="📊" title="Failed to load analytics" description="Refresh the page to try again." />
    </div>
  );

  const { kpis, monthlyTrend, leaderboard, platformBreakdown } = data;

  return (
    <div className="cc-page-content">
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Analytics</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Org-wide performance across all campaigns and creators</p>
      </div>

      {/* KPI grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        <StatTile label="Total Views" value={formatNumber(kpis.totalViews)} sub={`${formatNumber(kpis.totalPosts)} posts`} icon={Eye} color="var(--cc-primary)" />
        <StatTile label="Total Likes" value={formatNumber(kpis.totalLikes)} icon={ThumbsUp} color="#E4405F" />
        <StatTile label="Total Comments" value={formatNumber(kpis.totalComments)} icon={MessageCircle} color="#F59E0B" />
        <StatTile label="Total Spend" value={formatCurrency(kpis.totalSpend)} sub={`${kpis.totalPayouts} payouts`} icon={DollarSign} color="#10B981" />
        <StatTile label="Avg Engagement Rate" value={kpis.avgEngagementRate.toFixed(1) + "%"} icon={TrendingUp} color="#8B5CF6" />
        <StatTile label="Avg CPM" value={kpis.avgCPM > 0 ? formatCurrency(kpis.avgCPM) : "—"} sub="per 1K views" icon={BarChart2} color="#06B6D4" />
      </div>

      {/* Monthly trend chart */}
      <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 20 }}>
          Campaigns Launched — Last 6 Months
        </span>
        {monthlyTrend.every((m) => m.campaigns === 0) ? (
          <EmptyState icon="📅" title="No campaign data" description="Launch campaigns to see monthly trends." />
        ) : (
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="analyticsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--cc-primary)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--cc-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
                <YAxis tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
                  formatter={(v: any, name: any) => [v, name === "campaigns" ? "Total" : "Active"]}
                />
                <Area type="monotone" dataKey="campaigns" stroke="var(--cc-primary)" fill="url(#analyticsGradient)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="active" stroke="#10B981" fill="none" strokeWidth={2} strokeDasharray="4 2" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24, marginBottom: 24 }}>
        {/* Creator leaderboard */}
        <Card variant="solid" noPadding>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Top Creators by Views</span>
          </div>
          {leaderboard.length === 0 ? (
            <div style={{ padding: 24 }}>
              <EmptyState icon="👤" title="No post data yet" description="Sync posts to see creator rankings." />
            </div>
          ) : (
            <div>
              {leaderboard.map((creator, i) => (
                <div
                  key={creator.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px 1fr 80px 80px",
                    gap: 12,
                    padding: "12px 24px",
                    alignItems: "center",
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: i < 3 ? "var(--cc-primary)" : "var(--cc-text-subtle)", textAlign: "center" }}>
                    {i + 1}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar name={creator.name} src={creator.avatarUrl ?? undefined} size="sm" />
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", lineHeight: 1.3 }}>{creator.name}</p>
                      <p style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>@{creator.handle}</p>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>{formatNumber(creator.views)}</p>
                    <p style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>views</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{creator.posts}</p>
                    <p style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>posts</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Platform breakdown */}
        <Card variant="outlined" style={{ padding: 24 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 20 }}>
            Views by Platform
          </span>
          {platformBreakdown.length === 0 ? (
            <EmptyState icon="📱" title="No data" />
          ) : (
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={platformBreakdown} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} tickFormatter={(v) => formatNumber(v)} />
                  <YAxis type="category" dataKey="platform" tick={{ fontSize: 11, fill: "var(--cc-text-muted)" }} width={70} />
                  <Tooltip
                    contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, fontSize: 13 }}
                    formatter={(v: any) => [formatNumber(Number(v)), "Views"]}
                  />
                  <Bar
                    dataKey="views"
                    radius={[0, 4, 4, 0]}
                    fill="var(--cc-primary)"
                    label={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {platformBreakdown.length > 0 && (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {platformBreakdown.map((p) => (
                <div key={p.platform} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: PLATFORM_COLORS[p.platform] ?? "var(--cc-primary)",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{p.platform}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text)" }}>{p.posts} posts</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
