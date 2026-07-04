"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, StatCard, Skeleton, Button } from "@pratham7711/ui";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import Link from "next/link";
import {
  Megaphone,
  Users,
  Wallet,
  TrendingUp,
  ArrowUpRight,
  Clock,
  BarChart3,
  Download,
  Calendar,
  Eye,
  DollarSign,
  Activity,
  Rocket,
  CreditCard,
  ArrowRight,
} from "lucide-react";

function formatCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

type Campaign = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  client?: { name: string } | null;
};

type FinancialData = {
  summary: {
    totalSpend: number;
    totalBudget: number;
    budgetUtilization: number;
    activeCampaigns: number;
    totalCreators: number;
    avgCampaignSpend: number;
    pendingPayouts: number;
    totalDeposits: number;
    releasedDeposits: number;
  };
  spendOverTime: { date: string; spend: number; views: number }[];
  spendByCampaign: { campaignId: string; title: string; spend: number; budget: number; views: number; creatorsCount: number }[];
  platformBreakdown: { platform: string; spend: number; views: number; postsCount: number }[];
  creatorPerformance: { creatorId: string; name: string; handle: string; totalPaid: number; activationCount: number; views: number; avgEngagement: number }[];
  topPosts: { id: string; postUrl: string; platform: string; viewsCount: number; likesCount: number; engagementRate: number; creatorName: string | null; campaignTitle: string | null }[];
};

const PLATFORM_COLORS: Record<string, string> = {
  TIKTOK: "#00F2EA",
  YOUTUBE: "#FF0000",
  INSTAGRAM: "#E4405F",
  TWITTER: "#1DA1F2",
  FACEBOOK: "#1877F2",
};

const PIE_COLORS = ["#5B5BD6", "#059669", "#D97706", "#DC2626", "#7C3AED", "#1DA1F2"];

const DATE_PRESETS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
];

const STATUS_BADGE_VARIANT: Record<string, "warning" | "accent" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  IN_PROGRESS: "accent",
  COMPLETE: "success",
  CANCELLED: "danger",
  DRAFT: "neutral",
};

type Props = {
  campaignCount: number;
  creatorCount: number;
  pendingPayouts: number;
  recentCampaigns: Campaign[];
  chartData: { month: string; spend: number }[];
  dashboardWidgets: string[] | null;
};

const DEFAULT_WIDGETS = [
  "kpi_grid",
  "views_over_time",
  "platform_breakdown",
  "top_posts",
  "financial_summary",
  "creator_performance",
];

export default function DashboardClient(props: Props) {
  const { recentCampaigns } = props;
  const widgets = props.dashboardWidgets ?? DEFAULT_WIDGETS;
  const isNewOrg = props.campaignCount === 0 && props.creatorCount === 0;

  const [financials, setFinancials] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDays, setActiveDays] = useState(180);
  const [granularity, setGranularity] = useState<"daily" | "weekly" | "monthly">("monthly");

  const fetchFinancials = useCallback(async () => {
    setLoading(true);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - activeDays);
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      granularity,
    });
    try {
      const res = await fetch(`/api/dashboard/financials?${params}`);
      if (res.ok) {
        const data = await res.json();
        setFinancials(data);
      }
    } finally {
      setLoading(false);
    }
  }, [activeDays, granularity]);

  useEffect(() => { fetchFinancials(); }, [fetchFinancials]);

  const handleExport = (type: string) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - activeDays);
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      type,
    });
    window.open(`/api/dashboard/financials/export?${params}`, "_blank");
  };

  const s = financials?.summary;

  return (
    <div className="cc-page-content rsp-page">
      {/* Header with date range */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em" }}>
            Dashboard
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>
            Welcome back. Here&apos;s what&apos;s happening.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Date presets */}
          <div style={{ display: "flex", gap: 4, background: "var(--cc-bg)", borderRadius: 10, padding: 3, flexWrap: "wrap" }}>
            {DATE_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => setActiveDays(p.days)}
                style={{
                  padding: "6px 12px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: activeDays === p.days ? "var(--cc-card)" : "transparent",
                  color: activeDays === p.days ? "var(--cc-primary)" : "var(--cc-text-muted)",
                  boxShadow: activeDays === p.days ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Granularity toggle */}
          <select
            value={granularity}
            onChange={e => setGranularity(e.target.value as "daily" | "weekly" | "monthly")}
            style={{
              padding: "6px 10px", borderRadius: 8, border: "1px solid var(--cc-border)",
              fontSize: 12, fontWeight: 600, color: "var(--cc-text)", background: "var(--cc-card)", cursor: "pointer",
            }}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          {/* Export dropdown */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => handleExport("payouts")}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8,
                border: "1.5px solid var(--cc-primary)", background: "transparent",
                color: "var(--cc-primary)", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Getting started — only for a brand-new org with no data yet */}
      {isNewOrg && (
        <Card variant="solid" style={{ padding: 32, marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Rocket size={20} style={{ color: "var(--cc-primary)" }} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.01em" }}>
              Welcome to outreach ai
            </h2>
          </div>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24, maxWidth: 560, lineHeight: 1.6 }}>
            Your workspace is ready. Set up your first campaign and add the creators you work with to
            start tracking activations, posts, and payouts. Here are a few things to get you going.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 16 }}>
            <Link href="/campaigns" style={{ textDecoration: "none" }}>
              <Card variant="outlined" style={{ padding: 20, height: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Megaphone size={16} style={{ color: "#5B5BD6" }} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>Create your first campaign</div>
                <p style={{ fontSize: 13, color: "var(--cc-text-muted)", lineHeight: 1.5, flex: 1 }}>
                  Launch a brief and start assigning creators to your campaign.
                </p>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, color: "var(--cc-primary)" }}>
                  Go to campaigns <ArrowRight size={14} />
                </span>
              </Card>
            </Link>

            <Link href="/creators" style={{ textDecoration: "none" }}>
              <Card variant="outlined" style={{ padding: 20, height: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "#F3E8FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Users size={16} style={{ color: "#7C3AED" }} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>Add creators</div>
                <p style={{ fontSize: 13, color: "var(--cc-text-muted)", lineHeight: 1.5, flex: 1 }}>
                  Build your roster of influencers with handles, platforms, and rates.
                </p>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, color: "var(--cc-primary)" }}>
                  Go to creators <ArrowRight size={14} />
                </span>
              </Card>
            </Link>

            <Link href="/settings" style={{ textDecoration: "none" }}>
              <Card variant="outlined" style={{ padding: 20, height: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "#D1FAE5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <CreditCard size={16} style={{ color: "#059669" }} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>Connect billing later</div>
                <p style={{ fontSize: 13, color: "var(--cc-text-muted)", lineHeight: 1.5, flex: 1 }}>
                  You can set up payouts and billing when you are ready to pay creators.
                </p>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)" }}>
                  Open settings <ArrowRight size={14} />
                </span>
              </Card>
            </Link>
          </div>
          <div style={{ marginTop: 24 }}>
            <Link href="/campaigns" style={{ textDecoration: "none" }}>
              <Button variant="primary" iconLeft={<Megaphone size={15} />}>
                Create your first campaign
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {/* KPI Grid — enhanced with financial data */}
      {widgets.includes("kpi_grid") && (
        <div className="cc-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" style={{ gap: 20, marginBottom: 32 }}>
          <StatCard
            value={s ? formatCurrency(s.totalSpend) : String(props.campaignCount)}
            label="Total Spend"
            trend={s ? Math.round(s.budgetUtilization) : undefined}
            trendLabel={s ? `${s.budgetUtilization.toFixed(1)}% of budget` : undefined}
            icon={<DollarSign size={20} style={{ color: "#5B5BD6" }} />}
          />
          <StatCard
            value={s ? String(s.activeCampaigns) : String(props.campaignCount)}
            label="Active Campaigns"
            icon={<Megaphone size={20} style={{ color: "#059669" }} />}
          />
          <StatCard
            value={s ? formatCurrency(s.pendingPayouts) : formatCurrency(props.pendingPayouts)}
            label="Pending Payouts"
            icon={<Wallet size={20} style={{ color: "#D97706" }} />}
          />
          <StatCard
            value={s ? String(s.totalCreators) : String(props.creatorCount)}
            label="Paid Creators"
            icon={<Users size={20} style={{ color: "#7C3AED" }} />}
          />
        </div>
      )}

      {/* Financial Summary Cards */}
      {widgets.includes("financial_summary") && s && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" style={{ gap: 16, marginBottom: 32 }}>
          <Card variant="outlined" style={{ padding: 20 }}>
            <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 4, fontWeight: 600 }}>Total Budget</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--cc-text)" }}>{formatCurrency(s.totalBudget)}</div>
          </Card>
          <Card variant="outlined" style={{ padding: 20 }}>
            <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 4, fontWeight: 600 }}>Avg Campaign Spend</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--cc-text)" }}>{formatCurrency(s.avgCampaignSpend)}</div>
          </Card>
          <Card variant="outlined" style={{ padding: 20 }}>
            <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 4, fontWeight: 600 }}>Total Deposits</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--cc-text)" }}>{formatCurrency(s.totalDeposits)}</div>
          </Card>
          <Card variant="outlined" style={{ padding: 20 }}>
            <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 4, fontWeight: 600 }}>Released Deposits</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--cc-text)" }}>{formatCurrency(s.releasedDeposits)}</div>
          </Card>
        </div>
      )}

      {/* Two column: Recent Campaigns + Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-5" style={{ gap: 24, marginBottom: 32 }}>
        <Card variant="solid" noPadding className="lg:col-span-3 overflow-x-auto">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid var(--cc-border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Megaphone size={16} style={{ color: "#5B5BD6" }} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>Recent Campaigns</span>
            </div>
            <Link href="/campaigns" style={{ fontSize: 13, color: "var(--cc-primary)", display: "flex", alignItems: "center", gap: 4, fontWeight: 500, textDecoration: "none" }}>
              View all <ArrowUpRight size={14} />
            </Link>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--cc-hover-bg)" }}>
                {["Name", "Status", "Budget", "Client"].map((h) => (
                  <th key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--cc-text-subtle)", padding: "10px 24px", textAlign: "left", letterSpacing: "0.06em" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentCampaigns.map((c) => (
                <tr key={c.id} className="cc-table-row" style={{ borderTop: "1px solid var(--cc-border)" }}>
                  <td style={{ padding: "14px 24px" }}>
                    <Link href={`/campaigns/${c.id}`} style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", textDecoration: "none" }}>
                      {c.title}
                    </Link>
                  </td>
                  <td style={{ padding: "14px 24px" }}>
                    <Badge variant={STATUS_BADGE_VARIANT[c.status] ?? "neutral"} dot>
                      {c.status.replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 500, color: "var(--cc-text-muted)" }}>
                    {c.budget ? formatCurrency(c.budget) : "—"}
                  </td>
                  <td style={{ padding: "14px 24px", fontSize: 14, color: "var(--cc-text-muted)" }}>
                    {c.client?.name ?? "—"}
                  </td>
                </tr>
              ))}
              {recentCampaigns.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ fontSize: 14, color: "var(--cc-text-muted)", padding: "48px 0", textAlign: "center" }}>
                    No campaigns yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {/* Activity Feed */}
        <Card variant="solid" noPadding className="lg:col-span-2">
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--cc-border)", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#F3E8FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Clock size={16} style={{ color: "#7C3AED" }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>Activity Feed</span>
          </div>
          <div style={{ padding: 20, display: "flex", flexDirection: "column" }}>
            {recentCampaigns.slice(0, 5).map((c, i) => (
              <div
                key={c.id}
                className="cc-slide-up"
                style={{
                  display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 4px",
                  borderBottom: i < Math.min(recentCampaigns.length, 5) - 1 ? "1px solid var(--cc-border)" : "none",
                  animationDelay: `${i * 60}ms`,
                }}
              >
                <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--cc-hover-bg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Clock size={15} style={{ color: "var(--cc-primary)" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, color: "var(--cc-text)", lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600 }}>{c.title}</span>{" "}
                    <span style={{ color: "var(--cc-text-muted)" }}>status updated to</span>{" "}
                    <Badge variant={STATUS_BADGE_VARIANT[c.status] ?? "neutral"} size="sm">
                      {c.status.replace(/_/g, " ")}
                    </Badge>
                  </p>
                  <p style={{ fontSize: 12, color: "var(--cc-text-subtle)", marginTop: 3 }}>Just now</p>
                </div>
              </div>
            ))}
            {recentCampaigns.length === 0 && (
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: "32px 0" }}>
                No recent activity
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Spend Over Time Chart */}
      {widgets.includes("views_over_time") && (
        <Card variant="solid" style={{ padding: 28, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <BarChart3 size={16} style={{ color: "#5B5BD6" }} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", letterSpacing: "-0.01em" }}>
                Spend & Views Over Time
              </span>
            </div>
          </div>
          {loading ? (
            <Skeleton width="100%" height="240px" borderRadius="8px" />
          ) : (
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height={240} minWidth={0}>
                <AreaChart data={financials?.spendOverTime ?? props.chartData.map(d => ({ date: d.month, spend: d.spend, views: 0 }))}>
                  <defs>
                    <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#5B5BD6" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#5B5BD6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E6F0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#9097B4", fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="spend" tick={{ fill: "#9097B4", fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                  <YAxis yAxisId="views" orientation="right" tick={{ fill: "#9097B4", fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                  <Tooltip
                    contentStyle={{
                      background: "white", border: "1px solid #E4E6F0", borderRadius: 10,
                      color: "#1C2048", boxShadow: "0 4px 24px rgba(0,0,0,0.06)", fontSize: 13, padding: "10px 14px",
                    }}
                    formatter={(value, name) => [
                      name === "spend" ? formatCurrency(Number(value)) : formatNumber(Number(value)),
                      name === "spend" ? "Spend" : "Views",
                    ]}
                  />
                  <Area yAxisId="spend" type="monotone" dataKey="spend" stroke="#5B5BD6" strokeWidth={2.5} fill="url(#spendGradient)" dot={{ fill: "#5B5BD6", stroke: "#fff", strokeWidth: 2, r: 4 }} activeDot={{ fill: "#5B5BD6", stroke: "#fff", strokeWidth: 2, r: 6 }} />
                  <Area yAxisId="views" type="monotone" dataKey="views" stroke="#059669" strokeWidth={2} fill="url(#viewsGradient)" dot={{ fill: "#059669", stroke: "#fff", strokeWidth: 2, r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      )}

      {/* Platform Breakdown + Campaign Spend + Top Posts */}
      <div className="grid grid-cols-1 lg:grid-cols-3" style={{ gap: 24, marginBottom: 24 }}>
        {/* Platform Breakdown — Pie Chart */}
        {widgets.includes("platform_breakdown") && (
          <Card variant="solid" style={{ padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Activity size={16} style={{ color: "var(--cc-primary)" }} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>Platform Breakdown</span>
            </div>
            {loading ? (
              <Skeleton width="100%" height="200px" borderRadius="8px" />
            ) : financials?.platformBreakdown && financials.platformBreakdown.length > 0 ? (
              <>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={financials.platformBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        dataKey="views"
                        nameKey="platform"
                      >
                        {financials.platformBreakdown.map((entry, i) => (
                          <Cell key={entry.platform} fill={PLATFORM_COLORS[entry.platform] ?? PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => formatNumber(Number(v))} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {financials.platformBreakdown.map((p, i) => (
                    <div key={p.platform} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: PLATFORM_COLORS[p.platform] ?? PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span style={{ color: "var(--cc-text)", fontWeight: 600 }}>{p.platform}</span>
                      </span>
                      <span style={{ color: "var(--cc-text-muted)" }}>{formatNumber(p.views)} views · {p.postsCount} posts</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: "40px 0" }}>No platform data yet</p>
            )}
          </Card>
        )}

        {/* Campaign Spend — Bar Chart */}
        {widgets.includes("financial_summary") && (
          <Card variant="solid" style={{ padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#FEF3C7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <DollarSign size={16} style={{ color: "#D97706" }} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>Spend by Campaign</span>
            </div>
            {loading ? (
              <Skeleton width="100%" height="200px" borderRadius="8px" />
            ) : financials?.spendByCampaign && financials.spendByCampaign.length > 0 ? (
              <>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={financials.spendByCampaign.slice(0, 5)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#E4E6F0" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "#9097B4", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v)} />
                      <YAxis dataKey="title" type="category" tick={{ fill: "#9097B4", fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
                      <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                      <Bar dataKey="spend" fill="#5B5BD6" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 8 }}>
                  Top {Math.min(5, financials.spendByCampaign.length)} campaigns by spend
                </div>
              </>
            ) : (
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: "40px 0" }}>No campaign spend data</p>
            )}
          </Card>
        )}

        {/* Top Posts */}
        {widgets.includes("top_posts") && (
          <Card variant="solid" style={{ padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#D1FAE5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Eye size={16} style={{ color: "#059669" }} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>Top Posts</span>
            </div>
            {loading ? (
              <Skeleton width="100%" height="200px" borderRadius="8px" />
            ) : financials?.topPosts && financials.topPosts.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {financials.topPosts.map((post, i) => (
                  <div key={post.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < financials.topPosts.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {post.creatorName ?? "Unknown"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
                        {post.campaignTitle} · <Badge variant="neutral" size="sm">{post.platform}</Badge>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>{formatNumber(post.viewsCount)}</div>
                      <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>{post.engagementRate.toFixed(1)}% eng</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: "40px 0" }}>No posts yet</p>
            )}
          </Card>
        )}
      </div>

      {/* Creator Performance Table */}
      {widgets.includes("creator_performance") && (
        <Card variant="solid" noPadding style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid var(--cc-border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#F3E8FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <TrendingUp size={16} style={{ color: "#7C3AED" }} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>Creator Performance</span>
            </div>
            <button
              onClick={() => handleExport("creators")}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--cc-border)", background: "transparent", color: "var(--cc-text-muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              <Download size={12} /> Export
            </button>
          </div>
          {loading ? (
            <div style={{ padding: 24 }}>
              <Skeleton width="100%" height="160px" borderRadius="8px" />
            </div>
          ) : financials?.creatorPerformance && financials.creatorPerformance.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--cc-hover-bg)" }}>
                    {["Creator", "Total Paid", "Activations", "Views", "Avg Engagement"].map(h => (
                      <th key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--cc-text-subtle)", padding: "10px 24px", textAlign: "left", letterSpacing: "0.06em" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {financials.creatorPerformance.map(c => (
                    <tr key={c.creatorId} className="cc-table-row" style={{ borderTop: "1px solid var(--cc-border)" }}>
                      <td style={{ padding: "14px 24px" }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{c.handle}</div>
                      </td>
                      <td style={{ padding: "14px 24px", fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                        {formatCurrency(c.totalPaid)}
                      </td>
                      <td style={{ padding: "14px 24px", fontSize: 14, color: "var(--cc-text-muted)" }}>
                        {c.activationCount}
                      </td>
                      <td style={{ padding: "14px 24px", fontSize: 14, color: "var(--cc-text-muted)" }}>
                        {formatNumber(c.views)}
                      </td>
                      <td style={{ padding: "14px 24px", fontSize: 14, color: "var(--cc-text-muted)" }}>
                        {c.avgEngagement}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: "48px 0" }}>
              No creator performance data yet
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
