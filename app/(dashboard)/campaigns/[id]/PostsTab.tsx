"use client";

import React from "react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, Badge, Button, Input, Modal, EmptyState, Skeleton, Avatar } from "@pratham7711/ui";
import { Dropdown, StatusTabs, Pagination } from "@/components/ds";
import { Grid3X3, List, Plus, Check, X, Eye, Heart, MessageCircle, TrendingUp, BarChart3, ArrowUp, ArrowDown, ArrowUpDown, Flag, Video, AlertTriangle, RefreshCw, Image as ImageIcon } from "lucide-react";
import { CreatorSelect } from "@/components/CreatorSelect";
import Link from "next/link";
import { computePostEmv, computeEngagementRate } from "@/lib/metrics";
import { formatCompact, formatCompactCurrency, stripAt, formatDateAbs, timeAgo } from "@/lib/format";
import type { ComplianceFlag } from "@/lib/compliance/postCompliance";
import PostMedia from "@/components/PostMedia";
import { imgSrc } from "@/lib/postMedia";
import { metricValue, engagementRateValue, summarizePostMetrics } from "@/lib/metricDisplay";

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
  downloadsCount: number;
  engagementRate: number;
  status: string;
  fetchState: string | null; // LIVE / UNAVAILABLE / ERROR — is the post still up
  rejectionReason: string | null;
  lastSyncedAt: string | null;
  authorProfilePic: string | null;
  createdAt?: string;
  hasOpenFraudFlag?: boolean;
  complianceFlags?: ComplianceFlag[];
  creator: { id: string; name: string; handle: string; avatarUrl: string | null };
  snapshots?: SnapshotLite[];
};


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

// Whether the post is still live on the platform, independent of approval.
// CreatorCore surfaces this prominently (Unavailable = removed at source), and
// a large share of imported posts are dead, so hiding it would misrepresent them.
const FETCH_STATE_LABEL: Record<string, string> = {
  UNAVAILABLE: "Unavailable",
  ERROR: "Fetch error",
};
const FETCH_STATE_BADGE: Record<string, "danger" | "warning"> = {
  UNAVAILABLE: "danger",
  ERROR: "warning",
};

const COMPLIANCE_LABEL: Record<string, string> = {
  POSTED_AFTER_DEADLINE: "Late",
  SYNC_DEAD_LETTERED: "Unreachable",
  SYNC_FAILING: "Sync failing",
};

const PLATFORM_BADGE: Record<string, "accent" | "success" | "warning" | "danger" | "neutral"> = {
  TIKTOK: "neutral",
  INSTAGRAM: "danger",
  YOUTUBE: "warning",
  TWITTER: "accent",
};

type SortKey =
  | "posted"
  | "views"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "downloads"
  | "engRate"
  | "emv"
  | "delta";
type SortDir = "asc" | "desc";

function formatNumber(num: number): string {
  return formatCompact(num);
}

function formatMoney(num: number): string {
  return formatCompactCurrency(num);
}

// Never-synced is a fact worth stating; timeAgo's "Recently" fallback would
// claim the opposite.
function formatSince(iso: string | null): string {
  return iso ? timeAgo(iso) : "Never";
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

/**
 * A refresh either changed numbers or it did not, and the difference is the
 * whole point of pressing the button. "measured" is the only count that means
 * new data landed; the rest explain why nothing moved.
 */
function summariseRefresh(r: {
  total?: number; measured?: number; noMetrics?: number;
  unfetchable?: number; failed?: number; remaining?: number;
}): string {
  const total = r.total ?? 0;
  if (total === 0) return "No posts to refresh yet.";
  const parts = [`${r.measured ?? 0} of ${total} post${total === 1 ? "" : "s"} updated`];
  const empty = (r.noMetrics ?? 0) + (r.unfetchable ?? 0);
  if (empty > 0) parts.push(`${empty} returned no metrics`);
  if (r.failed) parts.push(`${r.failed} failed`);
  if (r.remaining) parts.push(`${r.remaining} left for the next run`);
  return `${parts.join(", ")}.`;
}

function postEmv(post: PostData): number | null {
  // EMV is a function of the counters, so it inherits their provenance. With
  // nothing measured it is not $0, it is unknown -- and $0 next to a real
  // creator reads as "this post earned nothing", which is a claim.
  if (metricValue(post.viewsCount, post.lastSyncedAt) === null) return null;
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

/* Keyed rather than positional: the engagement columns are dropped whenever no
   post in the campaign has been fetched, and a fixed template would leave their
   tracks behind as dead space. */
const COL_WIDTHS = {
  creator: "minmax(240px, 1.6fr)",
  platform: "92px",
  posted: "88px",
  views: "82px",
  likes: "78px",
  comments: "88px",
  shares: "82px",
  saves: "78px",
  downloads: "96px",
  engRate: "84px",
  emv: "88px",
  delta: "148px",
  status: "104px",
  lastSynced: "140px",
  actions: "140px",
} as const;

const COL_GAP = 12;

function gridTemplate(cols: readonly (keyof typeof COL_WIDTHS)[]) {
  const widths = cols.map((c) => COL_WIDTHS[c]);
  // The creator column is the flexible one; everything else is a fixed px track.
  const fixed = widths
    .filter((w) => w.endsWith("px") && !w.startsWith("minmax"))
    .reduce((sum, w) => sum + parseInt(w, 10), 0);
  return {
    gridTemplateColumns: widths.join(" "),
    minWidth: fixed + 240 + COL_GAP * (cols.length - 1),
  };
}

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
  onRefreshed,
}: {
  campaignId: string;
  postApprovalMode: string | null;
  marketplace?: MarketplaceCtx | null;
  /** Refreshing the posts moves the campaign's own totals, so the page reloads them too. */
  onRefreshed?: () => void;
}) {
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [mediaTypeFilter, setMediaTypeFilter] = useState("ALL");
  const [minViews, setMinViews] = useState("");
  const [creatorSearch, setCreatorSearch] = useState("");
  const [postedFrom, setPostedFrom] = useState("");
  const [postedTo, setPostedTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("posted");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const [showAddPost, setShowAddPost] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addForm, setAddForm] = useState({ postUrl: "", creatorId: "", mediaType: "" });
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  /** What the last refresh actually managed to fetch. Not an error -- a receipt. */
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

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
  useEffect(() => { setPage(1); }, [statusFilter, platformFilter, mediaTypeFilter, minViews, creatorSearch, postedFrom, postedTo, sortKey, sortDir]);

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
    setRefreshNote(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/posts/${postId}/sync`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefreshNote(body.error ?? "Could not refresh that post.");
        return;
      }
      // A 200 that measured nothing looks exactly like a 200 that did, so say it.
      if (body.metricsFound === false) {
        setRefreshNote("That post returned no metrics \u2014 the platform answered without counts.");
      }
      fetchPosts();
    } finally {
      setSyncingId(null);
    }
  };

  // One request, server-side: refreshes every post on the campaign and the
  // campaign's tracked sound in the same run. It used to fan out one fetch per
  // post from here and discard every response, so a campaign whose platform was
  // unreachable refreshed nothing and said nothing.
  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    setRefreshNote(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/refresh`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefreshNote(body.error ?? "Refresh failed.");
        return;
      }
      setRefreshNote(summariseRefresh(body));
      fetchPosts();
      onRefreshed?.();
    } finally {
      setRefreshingAll(false);
    }
  };

  const openAddPost = () => {
    setShowAddPost(true);
  };

  const filteredSorted = useMemo(() => {
    const minV = parseInt(minViews, 10);
    const search = creatorSearch.trim().toLowerCase();
    // Inclusive on both ends: "to" is the end of that day, not midnight at its start.
    const fromMs = postedFrom ? new Date(`${postedFrom}T00:00:00`).getTime() : null;
    const toMs = postedTo ? new Date(`${postedTo}T23:59:59.999`).getTime() : null;
    const rows = posts.filter((p) => {
      if (Number.isFinite(minV) && p.viewsCount < minV) return false;
      if (search) {
        const hay = `${p.creator.name} ${p.creator.handle}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      if (fromMs !== null || toMs !== null) {
        const posted = new Date(p.postedAt).getTime();
        if (!Number.isFinite(posted)) return false;
        if (fromMs !== null && posted < fromMs) return false;
        if (toMs !== null && posted > toMs) return false;
      }
      return true;
    });

    const valueOf = (p: PostData): number => {
      switch (sortKey) {
        case "posted": return new Date(p.postedAt).getTime() || 0;
        case "views": return p.viewsCount;
        case "likes": return p.likesCount;
        case "comments": return p.commentsCount;
        case "shares": return p.sharesCount;
        case "saves": return p.savesCount;
        case "downloads": return p.downloadsCount;
        case "engRate": return engRatePct(p) ?? -1;
        case "emv": return postEmv(p) ?? 0;   // unknown sorts to the bottom
        case "delta": return deltaViews(p) ?? Number.NEGATIVE_INFINITY;
        default: return 0;
      }
    };

    const sorted = [...rows].sort((a, b) => {
      const diff = valueOf(a) - valueOf(b);
      return sortDir === "asc" ? diff : -diff;
    });
    return sorted;
  }, [posts, minViews, creatorSearch, postedFrom, postedTo, sortKey, sortDir]);

  const anyDelta = useMemo(() => posts.some((p) => (p.snapshots?.length ?? 0) >= 2), [posts]);
  /* Imported posts carried view counts only, so likes, comments and engagement
     rate are unknown for all but the ones we fetched ourselves. A column none of
     these posts can fill is not shown at all. */
  const anyLikes = useMemo(
    () => posts.some((p) => metricValue(p.likesCount, p.lastSyncedAt) !== null),
    [posts]
  );
  const anyComments = useMemo(
    () => posts.some((p) => metricValue(p.commentsCount, p.lastSyncedAt) !== null),
    [posts]
  );
  const anyShares = useMemo(
    () => posts.some((p) => metricValue(p.sharesCount, p.lastSyncedAt) !== null),
    [posts]
  );
  const anySaves = useMemo(
    () => posts.some((p) => metricValue(p.savesCount, p.lastSyncedAt) !== null),
    [posts]
  );
  const anyDownloads = useMemo(
    () => posts.some((p) => metricValue(p.downloadsCount, p.lastSyncedAt) !== null),
    [posts]
  );
  const anyEngRate = useMemo(
    () =>
      posts.some(
        (p) =>
          engagementRateValue(p.likesCount, p.commentsCount, p.viewsCount, p.lastSyncedAt) !== null
      ),
    [posts]
  );
  const listCols = useMemo(
    () =>
      [
        "creator",
        "platform",
        "posted",
        "views",
        ...(anyLikes ? (["likes"] as const) : []),
        ...(anyComments ? (["comments"] as const) : []),
        ...(anyShares ? (["shares"] as const) : []),
        ...(anySaves ? (["saves"] as const) : []),
        ...(anyDownloads ? (["downloads"] as const) : []),
        ...(anyEngRate ? (["engRate"] as const) : []),
        "emv",
        ...(anyDelta ? (["delta"] as const) : []),
        "status",
        "lastSynced",
        "actions",
      ] as const,
    [anyLikes, anyComments, anyShares, anySaves, anyDownloads, anyEngRate, anyDelta]
  );
  const listGrid = useMemo(() => gridTemplate(listCols), [listCols]);

  /* Over the filtered set, so the row answers for what is on screen. */
  const kpis = useMemo(() => summarizePostMetrics(filteredSorted), [filteredSorted]);

  const kpiChips: { label: string; value: string }[] = useMemo(() => {
    const chips: { label: string; value: string }[] = [
      { label: "Total Posts", value: kpis.posts.toLocaleString() },
      { label: "Total Views", value: formatNumber(kpis.views) },
    ];
    const pct = (v: number | null) => (v === null ? null : `${v.toFixed(2)}%`);
    const add = (label: string, value: string | null) => {
      if (value !== null) chips.push({ label, value });
    };
    add("Avg. Post Eng Rate", pct(kpis.avgPostRate));
    add("Avg. Campaign Eng Rate", pct(kpis.campaignRate));
    add("Total Engagement", kpis.engagement === null ? null : formatNumber(kpis.engagement));
    add("Total Likes", kpis.likes === null ? null : formatNumber(kpis.likes));
    add("Total Comments", kpis.comments === null ? null : formatNumber(kpis.comments));
    add("Total Shares", kpis.shares === null ? null : formatNumber(kpis.shares));
    add("Total Saves", kpis.saves === null ? null : formatNumber(kpis.saves));
    return chips;
  }, [kpis]);

  const accruedMinor = useMemo(() => {
    if (!marketplace) return 0;
    return posts
      .filter((p) => p.status === "APPROVED")
      .reduce((sum, p) => sum + earnedMinorForPost(p.viewsCount, p.platform, marketplace.ratePerThousand), 0);
  }, [posts, marketplace]);

  // Campaign roll-up, derived from the synced posts — nothing here is stored or
  // typed in, so it can never disagree with the per-post numbers below it.
  const totals = useMemo(() => {
    const views = posts.reduce((s, p) => s + p.viewsCount, 0);
    const likes = posts.reduce((s, p) => s + p.likesCount, 0);
    const comments = posts.reduce((s, p) => s + p.commentsCount, 0);
    const shares = posts.reduce((s, p) => s + (p.sharesCount ?? 0), 0);
    const engagement = likes + comments + shares;
    const perPost = posts.map((p) => engRatePct(p)).filter((r): r is number => r !== null);
    return {
      posts: posts.length,
      views,
      likes,
      comments,
      engagement,
      // Average of each post's rate — what a creator-level report quotes.
      avgPostEng: perPost.length ? perPost.reduce((s, r) => s + r, 0) / perPost.length : null,
      // Campaign-wide rate — total engagement over total views.
      campaignEng: views > 0 ? (engagement / views) * 100 : null,
    };
  }, [posts]);

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
      {!error && posts.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {kpiChips.map((chip) => (
            <div
              key={chip.label}
              style={{
                background: "var(--cc-primary)",
                color: "white",
                borderRadius: 8,
                padding: "8px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                minWidth: 104,
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.85 }}>{chip.label}</span>
              <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{chip.value}</span>
            </div>
          ))}
        </div>
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
          <input
            type="date"
            value={postedFrom}
            max={postedTo || undefined}
            onChange={(e) => setPostedFrom(e.target.value)}
            aria-label="Posted on or after"
            style={{ ...selectStyle, width: 140 }}
          />
          <input
            type="date"
            value={postedTo}
            min={postedFrom || undefined}
            onChange={(e) => setPostedTo(e.target.value)}
            aria-label="Posted on or before"
            style={{ ...selectStyle, width: 140 }}
          />
          <Dropdown
            ariaLabel="Filter by platform"
            align="left"
            minWidth={150}
            value={platformFilter}
            onChange={setPlatformFilter}
            options={PLATFORM_FILTERS.map((p) => ({ value: p, label: p === "ALL" ? "All Platforms" : p }))}
          />
          <Dropdown
            ariaLabel="Filter by media type"
            align="left"
            minWidth={140}
            value={mediaTypeFilter}
            onChange={setMediaTypeFilter}
            options={MEDIA_TYPE_FILTERS.map((m) => ({ value: m, label: m === "ALL" ? "All Types" : m }))}
          />

          <div style={{ display: "flex", border: "1px solid var(--cc-border)", borderRadius: 8, overflow: "hidden" }}>
            <button onClick={() => setViewMode("list")} aria-label="List view" aria-pressed={viewMode === "list"} style={{ padding: "6px 10px", background: viewMode === "list" ? "var(--cc-bg)" : "var(--cc-card)", border: "none", cursor: "pointer" }}>
              <List size={16} color={viewMode === "list" ? "var(--cc-primary)" : "var(--cc-text-muted)"} />
            </button>
            <button onClick={() => setViewMode("grid")} aria-label="Grid view" aria-pressed={viewMode === "grid"} style={{ padding: "6px 10px", background: viewMode === "grid" ? "var(--cc-bg)" : "var(--cc-card)", border: "none", cursor: "pointer" }}>
              <Grid3X3 size={16} color={viewMode === "grid" ? "var(--cc-primary)" : "var(--cc-text-muted)"} />
            </button>
          </div>

          <Button variant="secondary" onClick={handleRefreshAll} loading={refreshingAll} disabled={posts.length === 0}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <RefreshCw size={14} /> Refresh Data
            </span>
          </Button>

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

      {refreshNote && (
        <Card variant="outlined" style={{ padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{refreshNote}</span>
            <button
              onClick={() => setRefreshNote(null)}
              aria-label="Dismiss refresh summary"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", display: "flex" }}
            >
              <X size={14} />
            </button>
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
              display: "grid", ...listGrid,
              gap: COL_GAP, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)", alignItems: "center",
            }}>
              <PlainHeader label="Creator" />
              <PlainHeader label="Platform" />
              <SortHeader label="Posted" sk="posted" />
              <SortHeader label="Views" sk="views" align="right" />
              {anyLikes && <SortHeader label="Likes" sk="likes" align="right" />}
              {anyComments && <SortHeader label="Comments" sk="comments" align="right" />}
              {anyShares && <SortHeader label="Shares" sk="shares" align="right" />}
              {anySaves && <SortHeader label="Saves" sk="saves" align="right" />}
              {anyDownloads && <SortHeader label="Downloads" sk="downloads" align="right" />}
              {anyEngRate && <SortHeader label="Eng %" sk="engRate" align="right" />}
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
              // A 0 we never fetched is unknown, not zero -- see lib/metricDisplay.
              const views = metricValue(post.viewsCount, post.lastSyncedAt);
              const likes = metricValue(post.likesCount, post.lastSyncedAt);
              const comments = metricValue(post.commentsCount, post.lastSyncedAt);
              const shares = metricValue(post.sharesCount, post.lastSyncedAt);
              const saves = metricValue(post.savesCount, post.lastSyncedAt);
              const downloads = metricValue(post.downloadsCount, post.lastSyncedAt);
              const erShown =
                likes === null && comments === null
                  ? null
                  : engagementRateValue(post.likesCount, post.commentsCount, post.viewsCount, post.lastSyncedAt) ?? er;
              return (
                <div
                  key={post.id}
                  style={{
                    display: "grid",
                    ...listGrid,
                    gap: COL_GAP, padding: "14px 24px", alignItems: "center",
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <PostMedia
                      platform={post.platform}
                      platformPostId={post.platformPostId}
                      postUrl={post.postUrl}
                      thumbnailUrl={post.thumbnailUrl}
                      caption={post.caption}
                    />
                    <Link prefetch={false} href={`/campaigns/${campaignId}/posts/${post.id}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", minWidth: 0 }}>
                      <Avatar
                        name={post.creator.name}
                        size="sm"
                        src={imgSrc(post.authorProfilePic, 64) ?? imgSrc(post.creator.avatarUrl, 64) ?? undefined}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div title={post.creator.name} style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.creator.name}</div>
                        <div title={`@${stripAt(post.creator.handle)}`} style={{ fontSize: 12, color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{stripAt(post.creator.handle)}</div>
                      </div>
                    </Link>
                  </div>
                  <Badge variant={PLATFORM_BADGE[post.platform] ?? "neutral"} style={{ fontSize: 11 }}>{post.platform}</Badge>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatDateAbs(post.postedAt)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", textAlign: "right" }}>
                    {views === null ? "" : formatNumber(views)}
                  </span>
                  {anyLikes && (
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)", textAlign: "right" }}>
                      {likes === null ? "" : formatNumber(likes)}
                    </span>
                  )}
                  {anyComments && (
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)", textAlign: "right" }}>
                      {comments === null ? "" : formatNumber(comments)}
                    </span>
                  )}
                  {anyShares && (
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)", textAlign: "right" }}>
                      {shares === null ? "" : formatNumber(shares)}
                    </span>
                  )}
                  {anySaves && (
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)", textAlign: "right" }}>
                      {saves === null ? "" : formatNumber(saves)}
                    </span>
                  )}
                  {anyDownloads && (
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)", textAlign: "right" }}>
                      {downloads === null ? "" : formatNumber(downloads)}
                    </span>
                  )}
                  {anyEngRate && (
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-primary)", textAlign: "right" }}>
                      {erShown === null ? "" : `${erShown.toFixed(1)}%`}
                    </span>
                  )}
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", textAlign: "right" }}>
                    {emv === null ? "" : formatMoney(emv)}
                  </span>
                  {anyDelta && (
                    <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", color: dv === null ? "var(--cc-text-subtle)" : dv >= 0 ? "var(--cc-success)" : "var(--cc-danger)" }}>
                      {dv === null ? "" : `${dv >= 0 ? "+" : ""}${formatNumber(dv)}`}
                    </span>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                    <Badge variant={STATUS_BADGE[post.status] ?? "neutral"}>{post.status.replace(/_/g, " ")}</Badge>
                    {post.fetchState && FETCH_STATE_LABEL[post.fetchState] && (
                      <Badge variant={FETCH_STATE_BADGE[post.fetchState]} style={{ fontSize: 10 }}>
                        {FETCH_STATE_LABEL[post.fetchState]}
                      </Badge>
                    )}
                    {post.hasOpenFraudFlag && <Badge variant="danger" style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={14} color="var(--cc-danger)" /> Flagged</Badge>}
                    {(post.complianceFlags ?? []).map((f) => (
                      <Badge key={f.code} variant={f.severity === "error" ? "danger" : "warning"} title={f.message} style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle size={12} color={f.severity === "error" ? "var(--cc-danger)" : "var(--cc-warning)"} /> {COMPLIANCE_LABEL[f.code]}
                      </Badge>
                    ))}
                    {marketplace && post.status === "PENDING_REVIEW" && !post.hasOpenFraudFlag && (
                      <span style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
                        auto in {timeRemaining(post.createdAt, marketplace.autoApproveHours)}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{formatSince(post.lastSyncedAt)}</span>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 18 }}>
            {pageRows.map((post) => {
              const emv = postEmv(post);
              const cardViews = metricValue(post.viewsCount, post.lastSyncedAt);
              const cardLikes = metricValue(post.likesCount, post.lastSyncedAt);
              const cardComments = metricValue(post.commentsCount, post.lastSyncedAt);
              const cardEngRate =
                cardLikes === null && cardComments === null
                  ? null
                  : engagementRateValue(
                      post.likesCount,
                      post.commentsCount,
                      post.viewsCount,
                      post.lastSyncedAt
                    ) ?? engRatePct(post);
              return (
                <Link
                  key={post.id}
                  href={`/campaigns/${campaignId}/posts/${post.id}`}
                  style={{
                    position: "relative",
                    display: "block",
                    aspectRatio: "9 / 16",
                    borderRadius: 20,
                    overflow: "hidden",
                    textDecoration: "none",
                    border: "1px solid var(--cc-border)",
                    background: post.thumbnailUrl
                      ? `url(${post.thumbnailUrl}) center/cover no-repeat`
                      : "var(--cc-bg)",
                  }}
                >
                  {!post.thumbnailUrl && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--cc-text-subtle)" }}>
                      <ImageIcon size={40} aria-hidden="true" />
                    </div>
                  )}
                  <span style={{ position: "absolute", top: 10, left: 10, padding: "3px 9px", borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "white", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, backdropFilter: "blur(4px)" }}>
                    {post.platform}
                  </span>
                  <span style={{ position: "absolute", top: 10, right: 10 }}>
                    <Badge variant={STATUS_BADGE[post.status] ?? "neutral"} style={{ fontSize: 9 }}>
                      {post.status.replace(/_/g, " ")}
                    </Badge>
                  </span>

                  {/* Metrics read out over the frame itself \u2014 display only, never editable. */}
                  <div
                    style={{
                      position: "absolute",
                      insetInline: 0,
                      bottom: 0,
                      padding: "48px 14px 10px",
                      // Fades in over the frame, then goes fully solid behind the
                      // counts \u2014 the same treatment CreatorCore uses, so numbers
                      // never fight the artwork.
                      background:
                        "linear-gradient(to bottom, rgba(28,32,72,0) 0%, rgba(28,32,72,0.72) 30%, var(--cc-text) 48%, var(--cc-text) 100%)",
                      color: "white",
                    }}
                  >
                    <div title={post.creator.name} style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {post.creator.handle || post.creator.name}
                    </div>
                    {/* Four rows, as the reference card has: shares, saves and
                        downloads have their own columns in the table view and only
                        add three "0" lines here. A counter that was never fetched
                        sits at 0 in the column, and printed here it would read as a
                        measured zero, so only measured values get a row. */}
{(() => {
                      const rows = [
                        cardViews !== null && { key: "views", icon: <Eye size={13} aria-hidden="true" />, text: `${formatNumber(cardViews)} views` },
                        cardLikes !== null && { key: "likes", icon: <Heart size={13} aria-hidden="true" />, text: `${formatNumber(cardLikes)} likes` },
                        cardComments !== null && { key: "comments", icon: <MessageCircle size={13} aria-hidden="true" />, text: `${formatNumber(cardComments)} comments` },
                        cardEngRate !== null && { key: "eng", icon: <TrendingUp size={13} aria-hidden="true" />, text: `${cardEngRate.toFixed(1)}% eng. rate` },
                      ].filter(Boolean) as { key: string; icon: React.ReactNode; text: string }[];
                      // Nothing measured at all: say so once. Four zeroes claim
                      // this post was watched by nobody, which we never checked.
                      if (rows.length === 0) {
                        return (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "rgba(255,255,255,0.72)" }}>
                            <Eye size={13} aria-hidden="true" />Not synced yet
                          </div>
                        );
                      }
                      return rows.map((row) => (
                        <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 2 }}>
                          {row.icon}{row.text}
                        </div>
                      ));
                    })()}
                    <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,0.22)", display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5, color: "rgba(255,255,255,0.78)" }}>
                      <span>EMV {emv === null ? "\u2014" : formatMoney(emv)}</span>
                      <span>{formatSince(post.lastSyncedAt)}</span>
                    </div>
                  </div>
                </Link>
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
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Creator</label>
              <CreatorSelect
                value={addForm.creatorId}
                onChange={(id) => setAddForm((f) => ({ ...f, creatorId: id }))}
              />
            </div>
            <div>
              <label htmlFor="add-post-mediatype" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Media Type</label>
              <Dropdown
                ariaLabel="Media Type"
                align="left"
                fullWidth
                value={addForm.mediaType}
                onChange={(v) => setAddForm((f) => ({ ...f, mediaType: v }))}
                options={[
                  { value: "", label: "Auto-detect" },
                  { value: "REEL", label: "Reel" },
                  { value: "STORY", label: "Story" },
                  { value: "POST", label: "Post" },
                  { value: "SHORT", label: "Short" },
                  { value: "VIDEO", label: "Video" },
                ]}
              />
            </div>
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
