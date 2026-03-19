"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, LayoutGrid, List as ListIcon } from "lucide-react";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  followerCount: number | null;
  engagementRate: number | null;
  rate: number | null;
  _count: { activations: number };
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function CreatorsClient({ creators }: { creators: Creator[] }) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "table">("grid");

  const filtered = creators.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.handle.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title="Creators"
        description="All creators in your roster"
        actions={
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[var(--color-primary)] to-purple-500 text-white text-sm font-medium hover:opacity-90 transition-opacity shadow-lg shadow-[var(--color-primary)]/25">
            <Plus className="h-4 w-4" />
            Add Creator
          </button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#111118] border border-[#2A2A3A] focus-within:border-[var(--color-primary)]/50 transition-colors">
          <Search className="h-4 w-4 text-[#555577]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search creators..."
            className="bg-transparent border-none outline-none text-sm text-[#F0F0FF] placeholder:text-[#555577] flex-1"
          />
        </div>
        <div className="flex items-center gap-1 bg-[#111118] border border-[#2A2A3A] rounded-lg p-1">
          <button
            onClick={() => setView("grid")}
            className={`p-1.5 rounded ${view === "grid" ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]" : "text-[#555577] hover:text-[#8888AA]"} transition-colors`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView("table")}
            className={`p-1.5 rounded ${view === "table" ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]" : "text-[#555577] hover:text-[#8888AA]"} transition-colors`}
          >
            <ListIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="No creators found"
          description="Try adjusting your search or add your first creator."
          action={
            <button className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-hover)] transition-colors">
              Add Creator
            </button>
          }
        />
      ) : view === "grid" ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((creator, i) => (
            <motion.div
              key={creator.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <div className="bg-[#111118] border border-[#2A2A3A] rounded-xl p-4 hover:border-[var(--color-primary)]/30 transition-all hover:shadow-[0_4px_24px_rgba(99,102,241,0.08)]">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {creator.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#F0F0FF]">{creator.name}</p>
                    <p className="text-sm text-[#8888AA]">@{creator.handle}</p>
                  </div>
                  <PlatformBadge platform={creator.platform} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-[#555577] text-xs">Followers</p>
                    <p className="font-semibold text-[#F0F0FF]">{creator.followerCount ? formatNumber(creator.followerCount) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-[#555577] text-xs">Avg Views</p>
                    <p className="font-semibold text-[#F0F0FF]">{creator.engagementRate ? formatNumber(creator.engagementRate) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-[#555577] text-xs">Rate</p>
                    <p className="font-semibold text-[#F0F0FF]">{creator.rate ? `$${creator.rate}/post` : "—"}</p>
                  </div>
                  <div>
                    <p className="text-[#555577] text-xs">Campaigns</p>
                    <p className="font-semibold text-[#F0F0FF]">{creator._count.activations}</p>
                  </div>
                </div>
                <button className="w-full mt-3 py-2 rounded-lg border border-[#2A2A3A] text-sm text-[#8888AA] hover:bg-white/5 hover:text-[#F0F0FF] transition-colors">
                  Add to Campaign
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-[#111118] border border-[#2A2A3A] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[#0D0D14]">
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Creator</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Platform</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Followers</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Avg Views</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Rate</th>
                <th className="text-left text-[10px] uppercase tracking-wider text-[#8888AA] font-medium px-5 py-3">Campaigns</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-[#1E1E2C] hover:bg-[#1A1A24] transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-purple-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                        {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#F0F0FF]">{c.name}</p>
                        <p className="text-xs text-[#555577]">@{c.handle}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5"><PlatformBadge platform={c.platform} /></td>
                  <td className="px-5 py-3.5 text-sm text-[#8888AA]">{c.followerCount ? formatNumber(c.followerCount) : "—"}</td>
                  <td className="px-5 py-3.5 text-sm text-[#8888AA]">{c.engagementRate ? formatNumber(c.engagementRate) : "—"}</td>
                  <td className="px-5 py-3.5 text-sm text-[#8888AA]">{c.rate ? `$${c.rate}` : "—"}</td>
                  <td className="px-5 py-3.5 text-sm text-[#8888AA]">{c._count.activations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
