"use client";
import { motion } from "framer-motion";
import { StatCard, Card } from "@pratham7711/ui";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

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

export default function DashboardClient({ campaignCount, creatorCount, pendingPayouts, recentCampaigns, chartData }: Props) {
  const statusColor = (s: string) =>
    s === "IN_PROGRESS" ? "#22c55e" : s === "DRAFT" ? "var(--cc-text-subtle)" : "#3b82f6";

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Dashboard</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>Welcome back. Here&apos;s what&apos;s happening.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard value={String(campaignCount)} label="Total Campaigns" />
        <StatCard value={String(creatorCount)} label="Total Creators" />
        <StatCard value={`$${(pendingPayouts / 1000).toFixed(1)}K`} label="Pending Payouts" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
        {/* Recent Campaigns */}
        <Card variant="glass" className="lg:col-span-3 p-6" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
          <div className="flex items-center justify-between mb-5">
            <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)" }}>Recent Campaigns</span>
            <Link href="/campaigns" style={{ fontSize: 12, color: "#3b82f6", fontWeight: 600 }}>
              View all <ArrowUpRight className="h-3 w-3 inline" />
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {recentCampaigns.map(c => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center gap-4 rounded-xl px-4 py-3 transition-colors" style={{ cursor: "pointer" }}>
                <div className="w-2 h-2 rounded-full" style={{ background: statusColor(c.status) }} />
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{c.title}</div>
                  <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{c.client?.name ?? "—"}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(c.status), textTransform: "uppercase" }}>{c.status.replace("_", " ")}</span>
                {c.budget && <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text-muted)" }}>${(c.budget / 1000).toFixed(0)}K</span>}
              </Link>
            ))}
            {recentCampaigns.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--cc-text-muted)", textAlign: "center", padding: 20 }}>No campaigns yet</p>
            )}
          </div>
        </Card>

        {/* Placeholder for activity — could be wired later */}
        <Card variant="glass" className="lg:col-span-2 p-6" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 16 }}>Activity Feed</span>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>Activity tracking coming soon.</p>
        </Card>
      </div>

      {/* Chart */}
      <Card variant="glass" className="p-6" style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 16 }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)", display: "block", marginBottom: 20 }}>Monthly Spend</span>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
              <XAxis dataKey="month" tick={{ fill: "var(--cc-text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--cc-text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
              <Tooltip contentStyle={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)", borderRadius: 12, color: "var(--cc-text)" }} />
              <Bar dataKey="spend" fill="#2563EB" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
