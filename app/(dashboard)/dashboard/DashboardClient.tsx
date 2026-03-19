"use client";

import { StatCard, Badge, Card } from "@pratham7711/ui";
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

  const statItems = [
    { label: "Total Campaigns", value: String(props.campaignCount), trend: "up" as const, trendLabel: "+12% from last month" },
    { label: "Active Creators", value: String(props.creatorCount), trend: "up" as const, trendLabel: "+8% from last month" },
    { label: "Pending Payouts", value: formatCurrency(props.pendingPayouts), trend: "neutral" as const },
    { label: "Growth", value: "+24%", trend: "up" as const, trendLabel: "from last month" },
  ];

  return (
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)" }}>Dashboard</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>Welcome back. Here&apos;s what&apos;s happening.</p>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        {statItems.map((stat) => (
          <StatCard
            key={stat.label}
            value={stat.value}
            label={stat.label}
            trend={stat.trend}
            trendLabel={stat.trendLabel}
          />
        ))}
      </div>

      {/* Two column */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 24, marginBottom: 32 }}>
        {/* Recent Campaigns */}
        <Card variant="solid" noPadding>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>Recent Campaigns</span>
            <Link href="/campaigns" style={{ fontSize: 12, color: "var(--cc-primary)", display: "flex", alignItems: "center", gap: 4 }}>
              View all <ArrowUpRight size={12} />
            </Link>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                {["Name", "Status", "Budget", "Client"].map((h) => (
                  <th key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--cc-text-muted)", padding: "10px 20px", textAlign: "left", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentCampaigns.map((c) => (
                <tr
                  key={c.id}
                  style={{ borderTop: "1px solid var(--cc-border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "12px 20px" }}>
                    <Link href={`/campaigns/${c.id}`} style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>
                      {c.title}
                    </Link>
                  </td>
                  <td style={{ padding: "12px 20px" }}>
                    <Badge variant={STATUS_BADGE_VARIANT[c.status] ?? "neutral"} dot>
                      {c.status.replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c.budget ? formatCurrency(c.budget) : "—"}</td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c.client?.name ?? "—"}</td>
                </tr>
              ))}
              {recentCampaigns.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ fontSize: 14, color: "var(--cc-text-muted)", padding: "40px 0", textAlign: "center" }}>No campaigns yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {/* Activity Feed */}
        <Card variant="solid" noPadding>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>Activity Feed</span>
          </div>
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            {recentCampaigns.slice(0, 5).map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                  <Clock size={14} style={{ color: "var(--cc-primary)" }} />
                </div>
                <div>
                  <p style={{ fontSize: 14, color: "var(--cc-text)" }}>
                    <span style={{ fontWeight: 500 }}>{c.title}</span>{" "}
                    <span style={{ color: "var(--cc-text-muted)" }}>status updated to</span>{" "}
                    <span style={{ color: "var(--cc-primary)" }}>{c.status.replace(/_/g, " ")}</span>
                  </p>
                  <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 2 }}>Just now</p>
                </div>
              </div>
            ))}
            {recentCampaigns.length === 0 && (
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: "24px 0" }}>No recent activity</p>
            )}
          </div>
        </Card>
      </div>

      {/* Chart */}
      <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", display: "block", marginBottom: 20 }}>Monthly Campaign Spend</span>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height={200} minWidth={0}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--cc-primary)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="var(--cc-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E6F0" />
              <XAxis dataKey="month" tick={{ fill: "#9097B4", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#9097B4", fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
              <Tooltip
                contentStyle={{
                  background: "white",
                  border: "1px solid #E4E6F0",
                  borderRadius: 12,
                  color: "#1C2048",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
                }}
              />
              <Area
                type="monotone"
                dataKey="spend"
                stroke="var(--cc-primary)"
                strokeWidth={2}
                fill="url(#spendGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
