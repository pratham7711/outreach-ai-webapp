"use client";

import React from "react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, Badge, Button, Input, Modal, EmptyState, Skeleton, Avatar } from "@pratham7711/ui";
import { StatusTabs, Pagination } from "@/components/ds";
import { Grid3X3, List, Plus, Check, X, Eye, Heart, MessageCircle, TrendingUp, BarChart3, ArrowUp, ArrowDown, ArrowUpDown, Flag, Video, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { computePostEmv, computeEngagementRate } from "@/lib/metrics";
import { formatCompact, formatCompactCurrency, stripAt, formatDateAbs } from "@/lib/format";

type SnapshotLite = { id: string; viewsCount: number; recordedAt: string };

type PostData = {
  id: string;
  platform: string;
  platformPostId: string;
  postUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  mediaType: string | null;
  postedAt: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  engagementRate: number;
  status: string;
  rejectionReason: string | null;
  lastSyncedAt: string | null;
  createdAt?: string;
  hasOpenFraudFlag?: boolean;
  creator: { id: string; name: string; handle: string; avatarUrl: string | null };
  snapshots?: SnapshotLite[];
};

type Creator = { id: string; name: string; handle: string };

type MarketplacePlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "TWITTER";

type MarketplaceCtx = {
  currency: string;
  ratePerThousand: Partial<Record<MarketplacePlatform, number>> | null;
  budgetCapMinor: number | null;
  autoApproveHours: number;
  submissionDeadline: string | null;
};

const STATUS_TABS = [
  { key: "ALL", label: "All", bg: "#F3F4F6", color: "#374151" },
  { key: "PENDING_REVIEW", label: "Pending Review", bg: "#FEF3C7", color: "#D97706" },
  { key: "APPROVED", label: "Approved", bg: "#D1FAE5", color: "#059669" },
  { key: "REJECTED", label: "Rejected", bg: "#FEE2E2", color: "#DC2626" },
];

const PLATFORM_FILTERS = ["ALL", "TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;
const MEDIA_TYPE_FILTERS = ["ALL", "REEL", "STORY", "POST", "SHORT"] as const;
const PAGE_SIZE = 25;

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

const PLATFORM_BADGE: Record<string, "accent" | "success" | "warning" | "danger" | "neutral"> = {
  TIKTOK: "neutral",
  INSTAGRAM: "danger",
  YOUTUBE: "warning",
  TWITTER: "accent",
};

type SortKey = "posted" | "views" | "likes" | "comments" | "engRate" | "emv" | "delta";
type SortDir = "asc" | "desc";

function formatNumber(num: number): string {
  return formatCompact(num);
}

function formatMoney(num: number): string {
  return formatCompactCurrency(num);
}

function formatSince(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function engRatePct(post: PostData): number | null {
  const r = computeEngagementRate({
    views: post.viewsCount,
    likes: post.likesCount,
    comments: post.commentsCount,
    shares: post.sharesCount,
    saves: post.savesCount,
  });
  return r === null ? null : r * 100;
}

function postEmv(post: PostData): number {
  return computePostEmv({
    platform: post.platform,
    views: post.viewsCount,
    likes: post.likesCount,
    comments: post.commentsCount,
    shares: post.sharesCount,
    saves: post.savesCount,
  });
}

function deltaViews(post: PostData): number | null {
  const snaps = post.snapshots;
  if (!snaps || snaps.length < 2) return null;
  const previous = snaps[1];
  if (typeof previous.viewsCount !== "number") return null;
  return post.viewsCount - previous.viewsCount;
}

const GRID_COLS = "1.6fr 96px 88px 84px 84px 88px 90px 90px 96px 140px 90px 150px";

function earnedMinorForPost(
  views: number,
  platform: string,
  rates: Partial<Record<MarketplacePlatform, number>> | null
): number {
  if (!rates) return 0;
  const rate = rates[platform as MarketplacePlatform];
  if (!rate || views <= 0) return 0;
  return Math.floor((views / 1000) * rate);
}

function formatMinor(minor: number, currency: string): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(major);
  } catch {
    return `${currency} ${major.toFixed(0)}`;
  }
}

function timeRemaining(createdAt: string | undefined, autoApproveHours: number): string {
  if (!createdAt) return "—";
  const dueMs = new Date(createdAt).getTime() + autoApproveHours * 3600_000;
  const diff = dueMs - Date.now();
  if (diff <= 0) return "Due now";
  const hrs = Math.floor(diff / 3600_000);
  if (hrs >= 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  if (hrs >= 1) return `${hrs}h`;
  return `${Math.max(1, Math.floor(diff / 60_000))}m`;
}

export default function PostsTab({
  campaignId,
  postApprovalMode,
  marketplace = null,
}: {
  campaignId: string;
  postApprovalMode: string | null;
  marketplace?: MarketplaceCtx | null;
}) {
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [mediaTypeFilter, setMediaTypeFilter] = useState("ALL");
  const [minViews, setMinViews] = useState("");
  const [creatorSearch, setCreatorSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("posted");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const [showAddPost, setShowAddPost] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addForm, setAddForm] = useState({ postUrl: "", creatorId: "", mediaType: "" });
  const [creators, setCreators] = useState<Creator[]>([]);
  const [metricsPost, setMetricsPost] = useState<PostData | null>(null);
  const [metricsForm, setMetricsForm] = useState({ viewsCount: 0, likesCount: 0, commentsCount: 0, sharesCount: 0, savesCount: 0 });
  const [metricsSubmitting, setMetricsSubmitting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (platformFilter !== "ALL") params.set("platform", platformFilter);
    if (mediaTypeFilter !== "ALL") params.set("mediaType", mediaTypeFilter);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/posts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPosts(Array.isArray(data.posts) ? data.posts : []);
      } else {
        setError("Could not load posts. Please try again.");
      }
    } catch {
      setError("Could not load posts. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [campaignId, statusFilter, platformFilter, mediaTypeFilter]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);
  useEffect(() => { setPage(1); }, [statusFilter, platformFilter, mediaTypeFilter, minViews, creatorSearch, sortKey, sortDir]);

  const handleAddPost = async () => {
    if (!addForm.postUrl || !addForm.creatorId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postUrl: addForm.postUrl,
          creatorId: addForm.creatorId,
          mediaType: addForm.mediaType || null,
        }),
      });
      if (res.ok) {
        setShowAddPost(false);
        setAddForm({ postUrl: "", creatorId: "", mediaType: "" });
        fetchPosts();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (postId: string) => {
    await fetch(`/api/campaigns/${campaignId}/posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    fetchPosts();
  };

  const handleReject = async () => {
    if (!showRejectModal) return;
    await fetch(`/api/campaigns/${campaignId}/posts/${showRejectModal}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "REJECTED", rejectionReason: rejectionReason || null }),
    });
    setShowRejectModal(null);
    setRejectionReason("");
    fetchPosts();
  };

  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const handleFlagSuspicious = async (postId: string) => {
    setFlaggingId(postId);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/posts/${postId}/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) fetchPosts();
    } finally {
      setFlaggingId(null);
    }
  };

  const handleSyncNow = async (postId: string) => {
    setSyncingId(postId);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/posts/${postId}/sync`, { method: "POST" });
      if (res.ok) fetchPosts();
    } finally {
      setSyncingId(null);
    }
  };

  const openMetrics = (post: PostData) => {
    setMetricsPost(post);
    setMetricsForm({
      viewsCount: post.viewsCount,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      sharesCount: post.sharesCount ?? 0,
      savesCount: post.savesCount ?? 0,
    });
  };

  const handleUpdateMetrics = async () => {
    if (!metricsPost) return;
    setMetricsSubmitting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/posts/${metricsPost.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metricsForm),
      });
      if (res.ok) {
        setMetricsPost(null);
        fetchPosts();
      }
    } finally {
      setMetricsSubmitting(false);
    }
  };

  const openAddPost = async () => {
    setShowAddPost(true);
    if (creators.length === 0) {
      const res = await fetch("/api/creators");
      if (res.ok) {
        const data = await res.json();
        setCreators((data.creators ?? data).map((c: any) => ({ id: c.id, name: c.name, handle: c.handle })));
      }
    }
  };

  const filteredSorted = useMemo(() => {
    const minV = parseInt(minViews, 10);
    const search = creatorSearch.trim().toLowerCase();
    const rows = posts.filter((p) => {
      if (Number.isFinite(minV) && p.viewsCount < minV) return false;
      if (search) {
        const hay = `${p.creator.name} ${p.creator.handle}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const valueOf = (p: PostData): number => {
      switch (sortKey) {
        case "posted": return new Date(p.postedAt).getTime() || 0;
        case "views": return p.viewsCount;
        case "likes": return p.likesCount;
        case "comments": return p.commentsCount;
        case "engRate": return engRatePct(p) ?? -1;
        case "emv": return postEmv(p);
        case "delta": return deltaViews(p) ?? Number.NEGATIVE_INFINITY;
        default: return 0;
      }
    };

    const sorted = [...rows].sort((a, b) => {
      const diff = valueOf(a) - valueOf(b);
      return sortDir === "asc" ? diff : -diff;
    });
    return sorted;
  }, [posts, minViews, creatorSearch, sortKey, sortDir]);

  const anyDelta = useMemo(() => posts.some((p) => (p.snapshots?.length ?? 0) >= 2), [posts]);

  const accruedMinor = useMemo(() => {
    if (!marketplace) return 0;
    return posts
      .filter((p) => p.status === "APPROVED")
      .reduce((sum, p) => sum + earnedMinorForPost(p.viewsCount, p.platform, marketplace.ratePerThousand), 0);
  }, [posts, marketplace]);

  const pendingCount = useMemo(() => posts.filter((p) => p.status === "PENDING_REVIEW").length, [posts]);
  const capMinor = marketplace?.budgetCapMinor ?? null;
  const capFraction = capMinor && capMinor > 0 ? Math.min(1, accruedMinor / capMinor) : null;
  const capReached = capMinor != null && capMinor > 0 && accruedMinor >= capMinor;
  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => filteredSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredSorted, page]
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton width="100%" height="48px" borderRadius="8px" />
        <Skeleton width="100%" height="200px" borderRadius="12px" />
      </div>
    );
  }

  const selectStyle = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--cc-border)",
    fontSize: 13,
    color: "var(--cc-text)",
    background: "var(--cc-card)",
    outline: "none",
  };

  const SortHeader = ({ label, sk, align = "left" }: { label: string; sk: SortKey; align?: "left" | "right" }) => {
    const active = sortKey === sk;
    return (
      <button
        type="button"
        onClick={() => toggleSort(sk)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          justifyContent: align === "right" ? "flex-end" : "flex-start",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: active ? "var(--cc-primary)" : "var(--cc-text-subtle)",
        }}
      >
        {label}
        {active ? (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} />}
      </button>
    );
  };

  const PlainHeader = ({ label }: { label: string }) => (
    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{label}</span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{".posts-min-views { display: none; } @media (min-width: 768px) { .posts-min-views { display: block; } }"}</style>
      {marketplace && (
        <Card variant="outlined" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: capMinor ? 12 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>Marketplace budget</span>
              {capReached && <Badge variant="danger" style={{ fontSize: 11 }}>Cap reached</Badge>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                {pendingCount} pending &middot; auto-approve in {marketplace.autoApproveHours}h
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>
                {formatMinor(accruedMinor, marketplace.currency)}
                {capMinor != null && capMinor > 0 && (
                  <span style={{ color: "var(--cc-text-muted)", fontWeight: 500 }}> / {formatMinor(capMinor, marketplace.currency)}</span>
                )}
              </span>
            </div>
          </div>
          {capMinor != null && capMinor > 0 && capFraction != null && (
            <div style={{ height: 8, borderRadius: 999, background: "var(--cc-bg)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.round(capFraction * 100)}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: capReached ? "var(--cc-danger)" : "var(--cc-primary)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          )}
        </Card>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StatusTabs
            variant="pill"
            ariaLabel="Filter posts by status"
            tabs={STATUS_TABS}
            active={statusFilter}
            onChange={setStatusFilter}
          />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="search"
            value={creatorSearch}
            onChange={(e) => setCreatorSearch(e.target.value)}
            placeholder="Search creator..."
            aria-label="Search creator"
            style={{ ...selectStyle, flexGrow: 1, minWidth: 140, width: "auto" }}
          />
          <input
            type="number"
            min={0}
            value={minViews}
            onChange={(e) => setMinViews(e.target.value)}
            placeholder="Min views"
            aria-label="Minimum views filter"
            className="posts-min-views"
            style={{ ...selectStyle, width: 110 }}
          />
          <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} aria-label="Filter by platform" style={selectStyle}>
            {PLATFORM_FILTERS.map((p) => <option key={p} value={p}>{p === "ALL" ? "All Platforms" : p}</option>)}
          </select>
          <select value={mediaTypeFilter} onChange={(e) => setMediaTypeFilter(e.target.value)} aria-label="Filter by media type" style={selectStyle}>
            {MEDIA_TYPE_FILTERS.map((m) => <option key={m} value={m}>{m === "ALL" ? "All Types" : m}</option>)}
          </select>

          <div style={{ display: "flex", border: "1px solid var(--cc-border)", borderRadius: 8, overflow: "hidden" }}>
            <button onClick={() => setViewMode("list")} aria-label="List view" aria-pressed={viewMode === "list"} style={{ padding: "6px 10px", background: viewMode === "list" ? "var(--cc-bg)" : "var(--cc-card)", border: "none", cursor: "pointer" }}>
              <List size={16} color={viewMode === "list" ? "var(--cc-primary)" : "var(--cc-text-muted)"} />
            </button>
            <button onClick={() => setViewMode("grid")} aria-label="Grid view" aria-pressed={viewMode === "grid"} style={{ padding: "6px 10px", background: viewMode === "grid" ? "var(--cc-bg)" : "var(--cc-card)", border: "none", cursor: "pointer" }}>
              <Grid3X3 size={16} color={viewMode === "grid" ? "var(--cc-primary)" : "var(--cc-text-muted)"} />
            </button>
          </div>

          <Button variant="primary" onClick={openAddPost}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Plus size={14} /> Add Post
            </span>
          </Button>
        </div>
      </div>

      {error && (
        <Card variant="outlined" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{error}</span>
            <Button variant="secondary" onClick={fetchPosts}>Retry</Button>
          </div>
        </Card>
      )}

      {!error && filteredSorted.length === 0 ? (
        <EmptyState
          icon={<Video size={32} color="var(--cc-text-subtle)" />}
          title={posts.length === 0 ? "No posts yet" : "No posts match your filters"}
          description={posts.length === 0 ? "Submit post URLs to track performance and manage approvals." : "Adjust the filters or search to see more posts."}
        />
      ) : !error && viewMode === "list" ? (
        <>
          <Card variant="solid" noPadding style={{ overflowX: "auto", maxWidth: "100%" }}>
            <div style={{
              display: "grid", gridTemplateColumns: GRID_COLS, minWidth: 1200,
              gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)", alignItems: "center",
            }}>
              <PlainHeader label="Creator" />
              <PlainHeader label="Platform" />
              <SortHeader label="Posted" sk="posted" />
              <SortHeader label="Views" sk="views" align="right" />
              <SortHeader label="Likes" sk="likes" align="right" />
              <SortHeader label="Comments" sk="comments" align="right" />
              <SortHeader label="Eng %" sk="engRate" align="right" />
              <SortHeader label="EMV" sk="emv" align="right" />
              {anyDelta && <SortHeader label="Δ Views" sk="delta" align="right" />}
              <PlainHeader label="Status" />
              <PlainHeader label="Last Synced" />
              <PlainHeader label="Actions" />
            </div>
            {pageRows.map((post, i) => {
              const er = engRatePct(post);
              const emv = postEmv(post);
              const dv = deltaViews(post);
              return (
                <div
                  key={post.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID_COLS, minWidth: 1200,
                    gap: 12, padding: "14px 24px", alignItems: "center",
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  }}
                >
                  <Link href={`/campaigns/${campaignId}/posts/${post.id}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", minWidth: 0 }}>
                    <Avatar name={post.creator.name} size="sm" src={post.creator.avatarUrl ?? undefined} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.creator.name}</div>
                      <div style={{ fontSize: 12, color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{stripAt(post.creator.handle)}</div>
                    </div>
                  </Link>
                  <Badge variant={PLATFORM_BADGE[post.platform] ?? "neutral"} style={{ fontSize: 11 }}>{post.platform}</Badge>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatDateAbs(post.postedAt)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", textAlign: "right" }}>{formatNumber(post.viewsCount)}</span>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)", textAlign: "right" }}>{formatNumber(post.likesCount)}</span>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)", textAlign: "right" }}>{formatNumber(post.commentsCount)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-primary)", textAlign: "right" }}>{er === null ? "—" : `${er.toFixed(1)}%`}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", textAlign: "right" }}>{formatMoney(emv)}</span>
                  {anyDelta && (
                    <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", color: dv === null ? "var(--cc-text-subtle)" : dv >= 0 ? "var(--cc-success)" : "var(--cc-danger)" }}>
                      {dv === null ? "—" : `${dv >= 0 ? "+" : ""}${formatNumber(dv)}`}
                    </span>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                    <Badge variant={STATUS_BADGE[post.status] ?? "neutral"}>{post.status.replace(/_/g, " ")}</Badge>
                    {post.hasOpenFraudFlag && <Badge variant="danger" style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={14} color="var(--cc-danger)" /> Flagged</Badge>}
                    {marketplace && post.status === "PENDING_REVIEW" && !post.hasOpenFraudFlag && (
                      <span style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
                        auto in {timeRemaining(post.createdAt, marketplace.autoApproveHours)}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{formatSince(post.lastSyncedAt)}</span>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <button onClick={() => openMetrics(post)} aria-label="Update metrics" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-primary)", background: "var(--cc-card)", color: "var(--cc-primary)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 2 }}>
                      <BarChart3 size={12} />
                    </button>
                    <button onClick={() => handleSyncNow(post.id)} disabled={syncingId === post.id} aria-label="Sync post metrics now" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-border)", background: "var(--cc-card)", color: "var(--cc-text-muted)", cursor: syncingId === post.id ? "wait" : "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 2, opacity: syncingId === post.id ? 0.6 : 1 }}>
                      <TrendingUp size={12} />
                    </button>
                    {(postApprovalMode === "MANUAL" || marketplace) && post.status === "PENDING_REVIEW" && (
                      <>
                        <button onClick={() => handleApprove(post.id)} aria-label="Approve post" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-success)", background: "color-mix(in srgb, var(--cc-success) 14%, transparent)", color: "var(--cc-success)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 2 }}>
                          <Check size={12} />
                        </button>
                        <button onClick={() => setShowRejectModal(post.id)} aria-label="Reject post" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-danger)", background: "color-mix(in srgb, var(--cc-danger) 14%, transparent)", color: "var(--cc-danger)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 2 }}>
                          <X size={12} />
                        </button>
                      </>
                    )}
                    {marketplace && !post.hasOpenFraudFlag && post.status !== "REJECTED" && (
                      <button onClick={() => handleFlagSuspicious(post.id)} disabled={flaggingId === post.id} aria-label="Flag post as suspicious" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-warning)", background: "color-mix(in srgb, var(--cc-warning) 14%, transparent)", color: "var(--cc-warning)", cursor: flaggingId === post.id ? "wait" : "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 2, opacity: flaggingId === post.id ? 0.6 : 1 }}>
                        <Flag size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
          {filteredSorted.length > PAGE_SIZE && (
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              total={filteredSorted.length}
              pageSize={PAGE_SIZE}
            />
          )}
        </>
      ) : !error ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {pageRows.map((post) => {
              const er = engRatePct(post);
              const emv = postEmv(post);
              return (
                <Card key={post.id} variant="outlined" style={{ padding: 0, overflow: "hidden" }}>
                  {post.thumbnailUrl && (
                    <div style={{ width: "100%", height: 160, background: `url(${post.thumbnailUrl}) center/cover`, borderBottom: "1px solid var(--cc-border)" }} />
                  )}
                  <div style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8, gap: 8 }}>
                      <Link href={`/campaigns/${campaignId}/posts/${post.id}`} style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", minWidth: 0 }}>
                        <Avatar name={post.creator.name} size="sm" src={post.creator.avatarUrl ?? undefined} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.creator.name}</div>
                          <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{post.platform}</div>
                        </div>
                      </Link>
                      <Badge variant={STATUS_BADGE[post.status] ?? "neutral"} style={{ fontSize: 10 }}>{post.status.replace(/_/g, " ")}</Badge>
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--cc-text-muted)", flexWrap: "wrap" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Eye size={12} />{formatNumber(post.viewsCount)}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Heart size={12} />{formatNumber(post.likesCount)}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }}><MessageCircle size={12} />{formatNumber(post.commentsCount)}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }}><TrendingUp size={12} />{er === null ? "—" : `${er.toFixed(1)}%`}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 8 }}>EMV <strong style={{ color: "var(--cc-text)" }}>{formatMoney(emv)}</strong></div>
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <Button variant="secondary" onClick={() => openMetrics(post)} style={{ flex: 1, fontSize: 12 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><BarChart3 size={12} /> Metrics</span>
                      </Button>
                      {postApprovalMode === "MANUAL" && post.status === "PENDING_REVIEW" && (
                        <>
                          <Button variant="primary" onClick={() => handleApprove(post.id)} style={{ flex: 1, fontSize: 12 }}>Approve</Button>
                          <Button variant="secondary" onClick={() => setShowRejectModal(post.id)} style={{ flex: 1, fontSize: 12 }}>Reject</Button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          {filteredSorted.length > PAGE_SIZE && (
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              total={filteredSorted.length}
              pageSize={PAGE_SIZE}
            />
          )}
        </>
      ) : null}

      {showAddPost && (
        <Modal open={true} onClose={() => setShowAddPost(false)} title="Add Post" size="md" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setShowAddPost(false)}>Cancel</Button>
            <Button variant="primary" loading={submitting} onClick={handleAddPost} disabled={!addForm.postUrl || !addForm.creatorId}>Submit Post</Button>
          </div>
        }>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Input label="Post URL" value={addForm.postUrl} onChange={(e) => setAddForm((f) => ({ ...f, postUrl: e.target.value }))} placeholder="https://youtube.com/watch?v=..." required />
            <div>
              <label htmlFor="add-post-creator" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Creator</label>
              <select id="add-post-creator" value={addForm.creatorId} onChange={(e) => setAddForm((f) => ({ ...f, creatorId: e.target.value }))} style={{ ...selectStyle, width: "100%" }}>
                <option value="">Select creator...</option>
                {creators.map((c) => <option key={c.id} value={c.id}>{c.name} (@{stripAt(c.handle)})</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="add-post-mediatype" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Media Type</label>
              <select id="add-post-mediatype" value={addForm.mediaType} onChange={(e) => setAddForm((f) => ({ ...f, mediaType: e.target.value }))} style={{ ...selectStyle, width: "100%" }}>
                <option value="">Auto-detect</option>
                <option value="REEL">Reel</option>
                <option value="STORY">Story</option>
                <option value="POST">Post</option>
                <option value="SHORT">Short</option>
                <option value="VIDEO">Video</option>
              </select>
            </div>
          </div>
        </Modal>
      )}

      {metricsPost && (
        <Modal open={true} onClose={() => setMetricsPost(null)} title="Update Metrics" size="md" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setMetricsPost(null)}>Cancel</Button>
            <Button variant="primary" loading={metricsSubmitting} onClick={handleUpdateMetrics}>Save Metrics</Button>
          </div>
        }>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
              Manually update metrics for <strong>{metricsPost.caption?.slice(0, 40) ?? "this post"}</strong>
            </p>
            {(["viewsCount", "likesCount", "commentsCount", "sharesCount", "savesCount"] as const).map((field) => (
              <Input
                key={field}
                label={field.replace("Count", "").replace(/([A-Z])/g, " $1").trim()}
                type="number"
                value={String(metricsForm[field])}
                onChange={(e) => setMetricsForm((f) => ({ ...f, [field]: parseInt(e.target.value) || 0 }))}
              />
            ))}
          </div>
        </Modal>
      )}

      {showRejectModal && (
        <Modal open={true} onClose={() => { setShowRejectModal(null); setRejectionReason(""); }} title="Reject Post" size="sm" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => { setShowRejectModal(null); setRejectionReason(""); }}>Cancel</Button>
            <Button variant="primary" onClick={handleReject} style={{ background: "#DC2626" }}>Reject Post</Button>
          </div>
        }>
          <div>
            <label htmlFor="reject-reason" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Reason (optional)</label>
            <textarea
              id="reject-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Why is this post being rejected?"
              rows={3}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", outline: "none", resize: "vertical" }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
