"use client";

import { motion } from "framer-motion";
import { StatusBadge } from "@/components/ui/StatusBadge";
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

const stats = (p: Props) => [
  { title: "Total Campaigns", value: String(p.campaignCount), icon: <Megaphone className="h-4 w-4" style={{ color: "var(--cc-primary)" }} />, trend: 12 },
  { title: "Active Creators", value: String(p.creatorCount), icon: <Users className="h-4 w-4" style={{ color: "var(--cc-primary)" }} />, trend: 8 },
  { title: "Pending Payouts", value: formatCurrency(p.pendingPayouts), icon: <Wallet className="h-4 w-4" style={{ color: "var(--cc-primary)" }} /> },
  { title: "Growth", value: "+24%", icon: <TrendingUp className="h-4 w-4" style={{ color: "var(--cc-primary)" }} />, trend: 24 },
];

export default function DashboardClient(props: Props) {
  const { recentCampaigns, chartData } = props;
  const statItems = stats(props);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)" }}>Dashboard</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>Welcome back. Here&apos;s what&apos;s happening.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" style={{ marginBottom: 32 }}>
        {statItems.map((stat, i) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20 }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>{stat.title}</p>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#F3F4F6" }}>
                  {stat.icon}
                </div>
              </div>
              <p style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>{stat.value}</p>
              {stat.trend && (
                <p style={{ fontSize: 12, color: "#22c55e", marginTop: 4 }}>+{stat.trend}% from last month</p>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Two column */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6" style={{ marginBottom: 32 }}>
        {/* Recent Campaigns */}
        <div className="lg:col-span-3" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
          <div className="flex items-center justify-between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>Recent Campaigns</span>
            <Link href="/campaigns" className="flex items-center gap-1" style={{ fontSize: 12, color: "var(--cc-primary)" }}>
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Name</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Status</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Budget</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Client</th>
              </tr>
            </thead>
            <tbody>
              {recentCampaigns.map((c) => (
                <tr
                  key={c.id}
                  className="transition-colors"
                  style={{ borderTop: "1px solid var(--cc-border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "12px 20px" }}>
                    <Link href={`/campaigns/${c.id}`} style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>
                      {c.title}
                    </Link>
                  </td>
                  <td style={{ padding: "12px 20px" }}><StatusBadge status={c.status} /></td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c.budget ? formatCurrency(c.budget) : "—"}</td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c.client?.name ?? "—"}</td>
                </tr>
              ))}
              {recentCampaigns.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center" style={{ fontSize: 14, color: "var(--cc-text-muted)", padding: "40px 0" }}>No campaigns yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Activity */}
        <div className="lg:col-span-2" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>Activity Feed</span>
          </div>
          <div style={{ padding: 20 }} className="space-y-4">
            {recentCampaigns.slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: "#F3F4F6" }}>
                  <Clock className="h-3.5 w-3.5" style={{ color: "var(--cc-primary)" }} />
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
        </div>
      </div>

      {/* Chart */}
      <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", display: "block", marginBottom: 20 }}>Monthly Campaign Spend</span>
        <div style={{ height: 300 }}>
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
