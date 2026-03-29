"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
import { Button, Card, EmptyState, Input, Avatar, Badge, Skeleton, StatCard } from "@pratham7711/ui";
import Link from "next/link";
import { toast } from "sonner";

const PLATFORMS = ["All", "TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"];
const SORT_OPTIONS = [
  { value: "followers", label: "Most Followers" },
  { value: "engagement", label: "Highest Engagement" },
  { value: "name", label: "Name A-Z" },
];

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  followersCount: number;
  averageViews: number;
  bio: string | null;
  avatarUrl: string | null;
  _count: { activations: number; posts: number };
};

export default function DiscoveryPage() {
  const [platform, setPlatform] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("followers");
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const fetchCreators = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (platform !== "All") params.set("platform", platform);
    params.set("sort", sort);
    params.set("limit", "30");

    fetch(`/api/discovery?${params}`)
      .then(r => r.json())
      .then(data => {
        setCreators(data.creators ?? []);
        setTotal(data.pagination?.total ?? 0);
      })
      .finally(() => setLoading(false));
  }, [search, platform, sort]);

  useEffect(() => {
    const timer = setTimeout(fetchCreators, 300);
    return () => clearTimeout(timer);
  }, [fetchCreators]);

  return (
    <div className="cc-page-content">
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Discovery</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          Find and connect with creators · {total} total
        </p>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or handle..."
          iconLeft={<Search size={16} />}
        />
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              style={{
                padding: "6px 14px", borderRadius: 20, fontSize: 13,
                fontWeight: platform === p ? 600 : 400, cursor: "pointer",
                border: `1px solid ${platform === p ? "var(--cc-primary)" : "var(--cc-border)"}`,
                background: platform === p ? "var(--cc-primary)" : "var(--cc-card)",
                color: platform === p ? "white" : "var(--cc-text-muted)",
                transition: "all 0.15s",
              }}
            >
              {p === "All" ? "All" : p.charAt(0) + p.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto" }}>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{
              padding: "7px 12px", borderRadius: 8, fontSize: 13,
              border: "1px solid var(--cc-border)", background: "var(--cc-card)",
              color: "var(--cc-text)", outline: "none",
            }}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} height="220px" borderRadius="12px" />
          ))}
        </div>
      ) : creators.length === 0 ? (
        <EmptyState icon="🔍" title="No creators found" description="Try adjusting your search or filters" />
      ) : (
        <div className="cc-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {creators.map((c) => (
            <Card key={c.id} variant="outlined" style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <Avatar name={c.name} size="md" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>{c.name}</div>
                  <div style={{ fontSize: 13, color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{c.handle}</div>
                </div>
                <Badge variant="neutral" style={{ fontSize: 10 }}>{c.platform}</Badge>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>{formatNumber(c.followersCount)}</div>
                  <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Followers</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>{formatNumber(c.averageViews)}</div>
                  <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Avg Views</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>{c._count.activations}</div>
                  <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Campaigns</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Link href={`/creators/${c.id}`} style={{ flex: 1, textDecoration: "none" }}>
                  <Button variant="secondary" fullWidth size="sm">View Profile</Button>
                </Link>
                <Button variant="primary" size="sm" iconLeft={<Plus size={14} />}>Add</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
