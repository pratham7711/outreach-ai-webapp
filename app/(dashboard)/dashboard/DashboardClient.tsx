"use client";

import { Card, Badge, StatCard } from "@pratham7711/ui";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
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
} from "lucide-react";

function formatCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

type Campaign = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  client?: { name: string } | null;
};

type Props = {
  campaignCount: number;
  creatorCount: number;
  pendingPayouts: number;
  recentCampaigns: Campaign[];
  chartData: { month: string; spend: number }[];
};

const STATUS_BADGE_VARIANT: Record<string, "warning" | "accent" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  IN_PROGRESS: "accent",
  COMPLETE: "success",
  CANCELLED: "danger",
  DRAFT: "neutral",
};

export default function DashboardClient(props: Props) {
  const { recentCampaigns, chartData } = props;

  return (
    <div className="cc-page-content">
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em" }}>
          Dashboard
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>
          Welcome back. Here&apos;s what&apos;s happening.
        </p>
      </div>

      {/* Stat Cards — using @pratham7711/ui StatCard with icons */}
      <div className="cc-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" style={{ gap: 20, marginBottom: 32 }}>
        <StatCard
          value={String(props.campaignCount)}
          label="Total Campaigns"
          trend={12}
          trendLabel="+12% from last month"
          icon={<Megaphone size={20} style={{ color: "#5B5BD6" }} />}
        />
        <StatCard
          value={String(props.creatorCount)}
          label="Active Creators"
          trend={8}
          trendLabel="+8% from last month"
          icon={<Users size={20} style={{ color: "#059669" }} />}
        />
        <StatCard
          value={formatCurrency(props.pendingPayouts)}
          label="Pending Payouts"
          icon={<Wallet size={20} style={{ color: "#D97706" }} />}
        />
        <StatCard
          value="+24%"
          label="Growth"
          trend={24}
          trendLabel="from last month"
          icon={<TrendingUp size={20} style={{ color: "#7C3AED" }} />}
        />
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5" style={{ gap: 24, marginBottom: 32 }}>
        {/* Recent Campaigns */}
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
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  padding: "14px 4px",
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

      {/* Chart */}
      <Card variant="solid" style={{ padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BarChart3 size={16} style={{ color: "#5B5BD6" }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", letterSpacing: "-0.01em" }}>
              Monthly Campaign Spend
            </span>
          </div>
        </div>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height={240} minWidth={0}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#5B5BD6" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#5B5BD6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E6F0" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#9097B4", fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#9097B4", fontSize: 12, fontWeight: 500 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
              <Tooltip
                contentStyle={{
                  background: "white",
                  border: "1px solid #E4E6F0",
                  borderRadius: 10,
                  color: "#1C2048",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
                  fontSize: 13,
                  padding: "10px 14px",
                }}
              />
              <Area
                type="monotone"
                dataKey="spend"
                stroke="#5B5BD6"
                strokeWidth={2.5}
                fill="url(#spendGradient)"
                dot={{ fill: "#5B5BD6", stroke: "#fff", strokeWidth: 2, r: 4 }}
                activeDot={{ fill: "#5B5BD6", stroke: "#fff", strokeWidth: 2, r: 6 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
