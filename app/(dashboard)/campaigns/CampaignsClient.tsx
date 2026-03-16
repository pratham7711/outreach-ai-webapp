"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Button, Badge, StatCard, Card } from "@pratham7711/ui";
import { Plus, Search, Filter } from "lucide-react";

type Campaign = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  currency: string;
  client?: { name: string } | null;
  _count: { activations: number; posts: number };
};

const STATUS_BADGE: Record<string, "success" | "warning" | "accent" | "neutral"> = {
  IN_PROGRESS: "success",
  DRAFT: "neutral",
  COMPLETE: "accent",
  PENDING: "warning",
  CANCELLED: "neutral",
};

export default function CampaignsClient({ campaigns, stats }: {
  campaigns: Campaign[];
  stats: { total: number; active: number; creatorCount: number; totalBudget: number };
}) {
  const [search, setSearch] = useState("");
  const filtered = campaigns.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase()) ||
    (c.client?.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>Campaigns</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>
            Manage and track all your influencer campaigns
          </p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={16} />}>New Campaign</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard value={String(stats.total)} label="Total Campaigns" />
        <StatCard value={String(stats.active)} label="Active" />
        <StatCard value={String(stats.creatorCount)} label="Creators" />
        <StatCard value={`$${(stats.totalBudget / 1000).toFixed(0)}K`} label="Total Budget" />
      </div>

      <div className="flex gap-3 mb-6">
        <div
          className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl"
          style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)" }}
        >
          <Search size={16} style={{ color: "var(--cc-text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns..."
            style={{ background: "none", border: "none", outline: "none", color: "var(--cc-text)", fontSize: 14, flex: 1 }}
          />
        </div>
        <Button variant="ghost" iconLeft={<Filter size={15} />}>Filter</Button>
      </div>

      <div className="grid gap-4">
        {filtered.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card
              variant="glass"
              clickable
              className="p-5"
              style={{
                background: "var(--cc-surface)",
                border: "1px solid var(--cc-border)",
                borderRadius: 16,
              }}
            >
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 style={{ fontWeight: 800, fontSize: 16, color: "var(--cc-text)" }}>{c.title}</h3>
                    <Badge variant={STATUS_BADGE[c.status] ?? "neutral"} size="sm">{c.status.replace("_", " ")}</Badge>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                    {c.client?.name ?? "—"} · {c._count.activations} activations · {c._count.posts} posts
                  </p>
                </div>
                {c.budget && (
                  <div className="md:w-48">
                    <div className="flex justify-between text-xs mb-1" style={{ color: "var(--cc-text-muted)" }}>
                      <span>{c.currency}</span>
                      <span>${Number(c.budget).toLocaleString()}</span>
                    </div>
                  </div>
                )}
                <Button variant="ghost" size="sm">View →</Button>
              </div>
            </Card>
          </motion.div>
        ))}
        {filtered.length === 0 && (
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", textAlign: "center", padding: 40 }}>No campaigns found</p>
        )}
      </div>
    </div>
  );
}
