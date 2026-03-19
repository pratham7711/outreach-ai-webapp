"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, LayoutGrid, List as ListIcon } from "lucide-react";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
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
      {/* Header */}
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Creators</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>All creators in your roster</p>
        </div>
        <button style={{ background: "var(--cc-primary)", color: "white", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={15} /> Add Creator
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 12, background: "var(--cc-card)", border: "1px solid var(--cc-border)" }}>
          <Search size={16} style={{ color: "var(--cc-text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search creators..."
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 14, color: "var(--cc-text)" }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 10, padding: 4 }}>
          <button
            onClick={() => setView("grid")}
            style={{
              padding: "6px 8px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: view === "grid" ? "rgba(91,91,214,0.12)" : "transparent",
              color: view === "grid" ? "var(--cc-primary)" : "var(--cc-text-muted)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setView("table")}
            style={{
              padding: "6px 8px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: view === "table" ? "rgba(91,91,214,0.12)" : "transparent",
              color: view === "table" ? "var(--cc-primary)" : "var(--cc-text-muted)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <ListIcon size={16} />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="No creators found"
          description="Try adjusting your search or add your first creator."
          action={
            <button style={{ padding: "8px 16px", borderRadius: 8, background: "var(--cc-primary)", color: "white", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer" }}>
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
              <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--cc-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                    {creator.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, color: "var(--cc-text)", marginBottom: 2 }}>{creator.name}</p>
                    <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>@{creator.handle}</p>
                  </div>
                  <PlatformBadge platform={creator.platform} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14 }}>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginBottom: 2 }}>Followers</p>
                    <p style={{ fontWeight: 600, color: "var(--cc-text)" }}>{creator.followerCount ? formatNumber(creator.followerCount) : "—"}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginBottom: 2 }}>Avg Views</p>
                    <p style={{ fontWeight: 600, color: "var(--cc-text)" }}>{creator.engagementRate ? formatNumber(creator.engagementRate) : "—"}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginBottom: 2 }}>Rate</p>
                    <p style={{ fontWeight: 600, color: "var(--cc-text)" }}>{creator.rate ? `$${creator.rate}/post` : "—"}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginBottom: 2 }}>Campaigns</p>
                    <p style={{ fontWeight: 600, color: "var(--cc-text)" }}>{creator._count.activations}</p>
                  </div>
                </div>
                <button style={{ width: "100%", marginTop: 12, padding: "8px 0", borderRadius: 8, border: "1px solid var(--cc-border)", fontSize: 13, color: "var(--cc-text-muted)", background: "transparent", cursor: "pointer" }}>
                  Add to Campaign
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                {["Creator", "Platform", "Followers", "Avg Views", "Rate", "Campaigns"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-muted)", fontWeight: 600, padding: "10px 20px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--cc-border)" }}>
                  <td style={{ padding: "12px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--cc-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                        {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{c.name}</p>
                        <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{c.handle}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "12px 20px" }}><PlatformBadge platform={c.platform} /></td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c.followerCount ? formatNumber(c.followerCount) : "—"}</td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c.engagementRate ? formatNumber(c.engagementRate) : "—"}</td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c.rate ? `$${c.rate}` : "—"}</td>
                  <td style={{ padding: "12px 20px", fontSize: 14, color: "var(--cc-text-muted)" }}>{c._count.activations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
