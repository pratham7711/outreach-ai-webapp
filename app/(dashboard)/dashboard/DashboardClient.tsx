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
  { title: "Total Campaigns", value: String(p.campaignCount), icon: <Megaphone className="h-4 w-4 text-[var(--color-primary)]" />, trend: 12 },
  { title: "Active Creators", value: String(p.creatorCount), icon: <Users className="h-4 w-4 text-[var(--color-primary)]" />, trend: 8 },
  { title: "Pending Payouts", value: formatCurrency(p.pendingPayouts), icon: <Wallet className="h-4 w-4 text-[var(--color-primary)]" /> },
  { title: "Growth", value: "+24%", icon: <TrendingUp className="h-4 w-4 text-[var(--color-primary)]" />, trend: 24 },
];

export default function DashboardClient(props: Props) {
  const { recentCampaigns, chartData } = props;
  const statItems = stats(props);

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#F0F0FF]">Dashboard</h1>
        <p className="text-sm text-[#8888AA] mt-1">Welcome back. Here&apos;s what&apos;s happening.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statItems.map((stat, i) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <div className="bg-[#111118] border border-[#2A2A3A] rounded-xl p-5 hover:border-[var(--color-primary)]/30 transition-colors">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-[#8888AA]">{stat.title}</p>
                <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center">
                  {stat.icon}
                </div>
              </div>
              <p className="text-2xl font-bold text-[#F0F0FF]">{stat.value}</p>
              {stat.trend && (
                <p className="text-xs text-emerald-400 mt-1">+{stat.trend}% from last month</p>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Two column */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
        {/* Recent Campaigns */}
        <div className="lg:col-span-3 bg-[#111118] border border-[#2A2A3A] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E1E2C]">
            <span className="text-sm font-semibold text-[#F0F0FF]">Recent Campaigns</span>
            <Link href="/campaigns" className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1">
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-[#0D0D14]">
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Name</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Status</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Budget</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Client</th>
              </tr>
            </thead>
            <tbody>
              {recentCampaigns.map((c) => (
                <tr key={c.id} className="border-t border-[#1E1E2C] hover:bg-[#1A1A24] transition-colors">
                  <td className="px-5 py-3">
                    <Link href={`/campaigns/${c.id}`} className="text-sm font-medium text-[#F0F0FF] hover:text-[var(--color-primary)]">
                      {c.title}
                    </Link>
                  </td>
                  <td className="px-5 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-5 py-3 text-sm text-[#8888AA]">{c.budget ? formatCurrency(c.budget) : "—"}</td>
                  <td className="px-5 py-3 text-sm text-[#8888AA]">{c.client?.name ?? "—"}</td>
                </tr>
              ))}
              {recentCampaigns.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-sm text-[#555577] py-10">No campaigns yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Activity */}
        <div className="lg:col-span-2 bg-[#111118] border border-[#2A2A3A] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1E1E2C]">
            <span className="text-sm font-semibold text-[#F0F0FF]">Activity Feed</span>
          </div>
          <div className="p-5 space-y-4">
            {recentCampaigns.slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Clock className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                </div>
                <div>
                  <p className="text-sm text-[#F0F0FF]">
                    <span className="font-medium">{c.title}</span>{" "}
                    <span className="text-[#8888AA]">status updated to</span>{" "}
                    <span className="text-[var(--color-primary)]">{c.status.replace(/_/g, " ")}</span>
                  </p>
                  <p className="text-xs text-[#555577] mt-0.5">Just now</p>
                </div>
              </div>
            ))}
            {recentCampaigns.length === 0 && (
              <p className="text-sm text-[#555577] text-center py-6">No recent activity</p>
            )}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-[#111118] border border-[#2A2A3A] rounded-xl p-6">
        <span className="text-sm font-semibold text-[#F0F0FF] block mb-5">Monthly Campaign Spend</span>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2C" />
              <XAxis dataKey="month" tick={{ fill: "#8888AA", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#8888AA", fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
              <Tooltip
                contentStyle={{
                  background: "#1A1A24",
                  border: "1px solid #2A2A3A",
                  borderRadius: 12,
                  color: "#F0F0FF",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
                }}
              />
              <Area
                type="monotone"
                dataKey="spend"
                stroke="var(--color-primary)"
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
