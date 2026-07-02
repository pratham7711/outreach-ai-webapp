"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { Button, Card, EmptyState, Input, Avatar, Badge, Skeleton, StatCard } from "@pratham7711/ui";
import { Pagination } from "@/components/ds";
import Link from "next/link";
import { toast } from "sonner";

const PLATFORMS = ["All", "TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"];
const SORT_OPTIONS = [
  { value: "followers", label: "Most Followers" },
  { value: "engagement", label: "Highest Engagement" },
  { value: "name", label: "Name A-Z" },
];
const NICHE_OPTIONS = [
  "MUSIC", "FASHION", "TECH", "FITNESS", "BEAUTY", "FOOD",
  "TRAVEL", "GAMING", "COMEDY", "EDUCATION", "LIFESTYLE", "SPORTS",
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

type CreatorList = {
  id: string;
  name: string;
};

export default function DiscoveryPage() {
  const [platform, setPlatform] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("followers");
  const [creators, setCreators] = useState<Creator[]>([]);
  const [lists, setLists] = useState<CreatorList[]>([]);
  const [loading, setLoading] = useState(true);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedCreator, setSelectedCreator] = useState<Creator | null>(null);
  const [selectedListId, setSelectedListId] = useState("");
  const [adding, setAdding] = useState(false);

  // Advanced filter state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedNiches, setSelectedNiches] = useState<string[]>([]);
  const [minFollowers, setMinFollowers] = useState("");
  const [maxFollowers, setMaxFollowers] = useState("");
  const [minRate, setMinRate] = useState("");
  const [maxRate, setMaxRate] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const activeCount =
    selectedNiches.length +
    (minFollowers ? 1 : 0) +
    (maxFollowers ? 1 : 0) +
    (minRate ? 1 : 0) +
    (maxRate ? 1 : 0);

  const fetchCreators = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (platform !== "All") params.set("platform", platform);
    params.set("sort", sort);
    params.set("limit", "30");
    params.set("page", String(page));
    if (selectedNiches.length > 0) params.set("niches", selectedNiches.join(","));
    if (minFollowers) params.set("minFollowers", minFollowers);
    if (maxFollowers) params.set("maxFollowers", maxFollowers);
    if (minRate) params.set("minRate", minRate);
    if (maxRate) params.set("maxRate", maxRate);

    const r = await fetch(`/api/discovery?${params}`);
    if (r.status === 403) { setFeatureDisabled(true); setLoading(false); return; }
    const data = await r.json();
    setCreators(data.creators ?? []);
    setTotal(data.pagination?.total ?? 0);
    setTotalPages(data.pagination?.totalPages ?? 1);
    setLoading(false);
  }, [search, platform, sort, page, selectedNiches, minFollowers, maxFollowers, minRate, maxRate]);

  // Reset page to 1 when filters change (but not when page itself changes)
  useEffect(() => {
    setPage(1);
  }, [search, platform, sort, selectedNiches, minFollowers, maxFollowers, minRate, maxRate]);

  const fetchLists = useCallback(() => {
    fetch("/api/lists")
      .then((r) => r.json())
      .then((data) => {
        setLists(data.lists ?? []);
      })
      .catch(() => {
        setLists([]);
      });
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchCreators, 300);
    return () => clearTimeout(timer);
  }, [fetchCreators]);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  function toggleNiche(niche: string) {
    setSelectedNiches((prev) =>
      prev.includes(niche) ? prev.filter((n) => n !== niche) : [...prev, niche]
    );
  }

  function clearAdvanced() {
    setSelectedNiches([]);
    setMinFollowers("");
    setMaxFollowers("");
    setMinRate("");
    setMaxRate("");
  }

  async function handleAddToList() {
    if (!selectedCreator || !selectedListId || adding) return;

    setAdding(true);
    try {
      const res = await fetch(`/api/lists/${selectedListId}/creators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorId: selectedCreator.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Failed to add creator to list");
        return;
      }

      toast.success(`${selectedCreator.name} added to list`);
      setSelectedCreator(null);
      setSelectedListId("");
    } finally {
      setAdding(false);
    }
  }

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

      {/* Filters Row */}
      <div style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
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

        {/* Filter toggle button */}
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 500,
            cursor: "pointer",
            border: `1px solid ${showAdvanced || activeCount > 0 ? "var(--cc-primary)" : "var(--cc-border)"}`,
            background: showAdvanced || activeCount > 0 ? "var(--cc-primary)" : "var(--cc-card)",
            color: showAdvanced || activeCount > 0 ? "white" : "var(--cc-text-muted)",
            transition: "all 0.15s",
          }}
        >
          <SlidersHorizontal size={14} />
          Filters
          {activeCount > 0 && (
            <span style={{
              background: "white", color: "var(--cc-primary)",
              borderRadius: 10, fontSize: 11, fontWeight: 700,
              padding: "1px 6px", lineHeight: "16px",
            }}>
              {activeCount}
            </span>
          )}
        </button>

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

      {/* Advanced Filters Panel */}
      {showAdvanced && (
        <div style={{
          background: "var(--cc-card)", border: "1px solid var(--cc-border)",
          borderRadius: 12, padding: "16px 20px", marginBottom: 12,
        }}>
          {/* Niches */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 8 }}>Niches</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {NICHE_OPTIONS.map((niche) => {
                const active = selectedNiches.includes(niche);
                return (
                  <button
                    key={niche}
                    onClick={() => toggleNiche(niche)}
                    style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 12,
                      fontWeight: active ? 600 : 400, cursor: "pointer",
                      background: active ? "var(--cc-primary)" : "var(--cc-card)",
                      color: active ? "white" : "var(--cc-text-muted)",
                      border: `1.5px solid ${active ? "var(--cc-primary)" : "var(--cc-border)"}`,
                      transition: "all 0.15s",
                    }}
                  >
                    {niche.charAt(0) + niche.slice(1).toLowerCase()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Range filters */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            {/* Followers range */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 8 }}>Followers</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Input
                  type="number"
                  placeholder="Min"
                  value={minFollowers}
                  onChange={(e) => setMinFollowers(e.target.value)}
                  style={{ width: 100 }}
                />
                <span style={{ color: "var(--cc-text-muted)", fontSize: 14 }}>–</span>
                <Input
                  type="number"
                  placeholder="Max"
                  value={maxFollowers}
                  onChange={(e) => setMaxFollowers(e.target.value)}
                  style={{ width: 100 }}
                />
              </div>
            </div>

            {/* Rate range */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 8 }}>Rate ($/post)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Input
                  type="number"
                  placeholder="Min"
                  value={minRate}
                  onChange={(e) => setMinRate(e.target.value)}
                  style={{ width: 100 }}
                />
                <span style={{ color: "var(--cc-text-muted)", fontSize: 14 }}>–</span>
                <Input
                  type="number"
                  placeholder="Max"
                  value={maxRate}
                  onChange={(e) => setMaxRate(e.target.value)}
                  style={{ width: 100 }}
                />
              </div>
            </div>
          </div>

          <Button variant="secondary" size="sm" onClick={clearAdvanced}>
            Clear All
          </Button>
        </div>
      )}

      {/* Active filter chips */}
      {activeCount > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {selectedNiches.map((niche) => (
            <span
              key={niche}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: "var(--cc-primary)", color: "white",
                borderRadius: 20, fontSize: 12, fontWeight: 500,
                padding: "4px 10px",
              }}
            >
              {niche.charAt(0) + niche.slice(1).toLowerCase()}
              <button
                onClick={() => toggleNiche(niche)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "white", padding: 0, display: "flex", alignItems: "center" }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {minFollowers && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--cc-primary)", color: "white", borderRadius: 20, fontSize: 12, fontWeight: 500, padding: "4px 10px" }}>
              Min followers: {minFollowers}
              <button onClick={() => setMinFollowers("")} style={{ background: "none", border: "none", cursor: "pointer", color: "white", padding: 0, display: "flex", alignItems: "center" }}>
                <X size={12} />
              </button>
            </span>
          )}
          {maxFollowers && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--cc-primary)", color: "white", borderRadius: 20, fontSize: 12, fontWeight: 500, padding: "4px 10px" }}>
              Max followers: {maxFollowers}
              <button onClick={() => setMaxFollowers("")} style={{ background: "none", border: "none", cursor: "pointer", color: "white", padding: 0, display: "flex", alignItems: "center" }}>
                <X size={12} />
              </button>
            </span>
          )}
          {minRate && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--cc-primary)", color: "white", borderRadius: 20, fontSize: 12, fontWeight: 500, padding: "4px 10px" }}>
              Min rate: ${minRate}
              <button onClick={() => setMinRate("")} style={{ background: "none", border: "none", cursor: "pointer", color: "white", padding: 0, display: "flex", alignItems: "center" }}>
                <X size={12} />
              </button>
            </span>
          )}
          {maxRate && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--cc-primary)", color: "white", borderRadius: 20, fontSize: 12, fontWeight: 500, padding: "4px 10px" }}>
              Max rate: ${maxRate}
              <button onClick={() => setMaxRate("")} style={{ background: "none", border: "none", cursor: "pointer", color: "white", padding: 0, display: "flex", alignItems: "center" }}>
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} height="220px" borderRadius="12px" />
          ))}
        </div>
      ) : featureDisabled ? (
        <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24 }}>
          <EmptyState
            icon="🔒"
            title="Creator Discovery is disabled"
            description="Enable the Creator Discovery feature in Billing to search and discover new creators."
            action={
              <Link
                href="/settings/billing"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "10px 16px", borderRadius: 10, background: "var(--cc-primary)", color: "white", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
              >
                Open Billing
              </Link>
            }
          />
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
                <Button
                  variant="primary"
                  size="sm"
                  iconLeft={<Plus size={14} />}
                  onClick={() => {
                    if (lists.length === 0) {
                      toast.error("Create a list first before adding creators");
                      return;
                    }
                    setSelectedCreator(c);
                    setSelectedListId(lists[0]?.id ?? "");
                  }}
                >
                  Add
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          style={{ justifyContent: "center", marginTop: 24 }}
        />
      )}

      {selectedCreator && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 20,
          }}
          onClick={() => {
            if (adding) return;
            setSelectedCreator(null);
            setSelectedListId("");
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 420,
              maxWidth: "100%",
              borderRadius: 16,
              background: "var(--cc-card)",
              border: "1px solid var(--cc-border)",
              boxShadow: "0 24px 64px rgba(15, 23, 42, 0.18)",
              padding: 24,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", marginBottom: 8 }}>
              Add to List
            </h2>
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 18 }}>
              Choose which list should include <strong style={{ color: "var(--cc-text)" }}>{selectedCreator.name}</strong>.
            </p>

            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--cc-text)",
                marginBottom: 8,
              }}
            >
              List
            </label>
            <select
              value={selectedListId}
              onChange={(e) => setSelectedListId(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--cc-border)",
                background: "var(--cc-card)",
                color: "var(--cc-text)",
                fontSize: 14,
                marginBottom: 20,
                outline: "none",
              }}
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedCreator(null);
                  setSelectedListId("");
                }}
                disabled={adding}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={handleAddToList} loading={adding} disabled={!selectedListId}>
                Add to List
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
