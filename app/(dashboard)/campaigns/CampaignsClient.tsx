"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, LayoutGrid, List as ListIcon, MoreHorizontal } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import Link from "next/link";

type Campaign = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  currency: string;
  client?: { name: string } | null;
  _count: { activations: number; posts: number };
};

function formatCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function CampaignsClient({ campaigns, stats }: {
  campaigns: Campaign[];
  stats: { total: number; active: number; creatorCount: number; totalBudget: number };
}) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "grid">("table");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filtered = campaigns.filter((c) => {
    const matchesSearch = c.title.toLowerCase().includes(search.toLowerCase()) ||
      (c.client?.name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statCards = [
    { title: "Total Campaigns", value: String(stats.total) },
    { title: "Active", value: String(stats.active) },
    { title: "Creators", value: String(stats.creatorCount) },
    { title: "Total Budget", value: formatCurrency(stats.totalBudget) },
  ];

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Manage and track all your influencer campaigns"
        actions={
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[var(--color-primary)] to-purple-500 text-white text-sm font-medium hover:opacity-90 transition-opacity shadow-lg shadow-[var(--color-primary)]/25">
            <Plus className="h-4 w-4" />
            New Campaign
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {statCards.map((s, i) => (
          <motion.div key={s.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
            <div className="bg-[#111118] border border-[#2A2A3A] rounded-xl p-4 hover:border-[var(--color-primary)]/30 transition-colors">
              <p className="text-xs text-[#8888AA] mb-1">{s.title}</p>
              <p className="text-xl font-bold text-[#F0F0FF]">{s.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#111118] border border-[#2A2A3A] focus-within:border-[var(--color-primary)]/50 transition-colors">
          <Search className="h-4 w-4 text-[#555577]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns..."
            className="bg-transparent border-none outline-none text-sm text-[#F0F0FF] placeholder:text-[#555577] flex-1"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-[#111118] border border-[#2A2A3A] text-sm text-[#8888AA] outline-none"
        >
          <option value="ALL">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETE">Complete</option>
          <option value="PENDING">Pending</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <div className="flex items-center gap-1 bg-[#111118] border border-[#2A2A3A] rounded-lg p-1">
          <button
            onClick={() => setView("table")}
            className={`p-1.5 rounded ${view === "table" ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]" : "text-[#555577] hover:text-[#8888AA]"} transition-colors`}
          >
            <ListIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView("grid")}
            className={`p-1.5 rounded ${view === "grid" ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]" : "text-[#555577] hover:text-[#8888AA]"} transition-colors`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="No campaigns found"
          description="Try adjusting your search or filters, or create your first campaign."
          action={
            <button className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-hover)] transition-colors">
              Create Campaign
            </button>
          }
        />
      ) : view === "table" ? (
        <div className="bg-[#111118] border border-[#2A2A3A] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[#0D0D14]">
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Name</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Status</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Client</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Budget</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Activations</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Posts</th>
                <th className="text-right text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <motion.tr
                  key={c.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-t border-[#1E1E2C] hover:bg-[#1A1A24] transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <Link href={`/campaigns/${c.id}`} className="text-sm font-medium text-[#F0F0FF] hover:text-[var(--color-primary)]">
                      {c.title}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5"><StatusBadge status={c.status} /></td>
                  <td className="px-5 py-3.5 text-sm text-[#8888AA]">{c.client?.name ?? "—"}</td>
                  <td className="px-5 py-3.5 text-sm text-[#8888AA]">{c.budget ? `${c.currency} ${formatCurrency(c.budget)}` : "—"}</td>
                  <td className="px-5 py-3.5 text-sm text-[#8888AA]">{c._count.activations}</td>
                  <td className="px-5 py-3.5 text-sm text-[#8888AA]">{c._count.posts}</td>
                  <td className="px-5 py-3.5 text-right">
                    <button className="p-1 rounded text-[#555577] hover:text-[#8888AA] hover:bg-white/5 transition-colors">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Link href={`/campaigns/${c.id}`}>
                <div className="bg-[#111118] border border-[#2A2A3A] rounded-xl overflow-hidden hover:border-[var(--color-primary)]/30 transition-all hover:shadow-[0_4px_24px_rgba(99,102,241,0.08)] group">
                  {/* Gradient thumbnail placeholder */}
                  <div className="h-24 bg-gradient-to-br from-[var(--color-primary)]/20 via-purple-500/10 to-transparent" />
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-[#F0F0FF] group-hover:text-[var(--color-primary)] transition-colors">{c.title}</h3>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="text-xs text-[#8888AA] mb-3">{c.client?.name ?? "No client"}</p>
                    <div className="flex items-center justify-between text-xs text-[#555577]">
                      <span>{c._count.activations} activations</span>
                      <span className="font-medium text-[#8888AA]">{c.budget ? formatCurrency(c.budget) : "—"}</span>
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
