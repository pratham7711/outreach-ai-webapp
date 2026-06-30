"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button, Input, Modal, EmptyState, Skeleton } from "@pratham7711/ui";
import { Grid3X3, List, Plus, Check, X, Eye, Heart, MessageCircle, TrendingUp, BarChart3, ExternalLink } from "lucide-react";
import Link from "next/link";

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
  engagementRate: number;
  status: string;
  rejectionReason: string | null;
  creator: { id: string; name: string; handle: string; avatarUrl: string | null };
};

type Creator = { id: string; name: string; handle: string };

const STATUS_TABS = [
  { key: "ALL", label: "All", bg: "#F3F4F6", color: "#374151" },
  { key: "PENDING_REVIEW", label: "Pending Review", bg: "#FEF3C7", color: "#D97706" },
  { key: "APPROVED", label: "Approved", bg: "#D1FAE5", color: "#059669" },
  { key: "REJECTED", label: "Rejected", bg: "#FEE2E2", color: "#DC2626" },
];

const PLATFORM_FILTERS = ["ALL", "TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;
const MEDIA_TYPE_FILTERS = ["ALL", "REEL", "STORY", "POST", "SHORT"] as const;

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

export default function PostsTab({ campaignId, postApprovalMode }: { campaignId: string; postApprovalMode: string | null }) {
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [mediaTypeFilter, setMediaTypeFilter] = useState("ALL");
  const [showAddPost, setShowAddPost] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addForm, setAddForm] = useState({ postUrl: "", creatorId: "", mediaType: "" });
  const [creators, setCreators] = useState<Creator[]>([]);
  const [metricsPost, setMetricsPost] = useState<PostData | null>(null);
  const [metricsForm, setMetricsForm] = useState({ viewsCount: 0, likesCount: 0, commentsCount: 0, sharesCount: 0, savesCount: 0 });
  const [metricsSubmitting, setMetricsSubmitting] = useState(false);

  const fetchPosts = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (platformFilter !== "ALL") params.set("platform", platformFilter);
    if (mediaTypeFilter !== "ALL") params.set("mediaType", mediaTypeFilter);

    const res = await fetch(`/api/campaigns/${campaignId}/posts?${params}`);
    if (res.ok) {
      const data = await res.json();
      setPosts(data.posts);
    }
    setLoading(false);
  }, [campaignId, statusFilter, platformFilter, mediaTypeFilter]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

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

  const openMetrics = (post: PostData) => {
    setMetricsPost(post);
    setMetricsForm({
      viewsCount: post.viewsCount,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      sharesCount: 0,
      savesCount: 0,
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
    background: "white",
    outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Status tabs */}
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                border: "none",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                background: statusFilter === tab.key ? tab.bg : "transparent",
                color: statusFilter === tab.key ? tab.color : "var(--cc-text-muted)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} style={selectStyle}>
            {PLATFORM_FILTERS.map((p) => <option key={p} value={p}>{p === "ALL" ? "All Platforms" : p}</option>)}
          </select>
          <select value={mediaTypeFilter} onChange={(e) => setMediaTypeFilter(e.target.value)} style={selectStyle}>
            {MEDIA_TYPE_FILTERS.map((m) => <option key={m} value={m}>{m === "ALL" ? "All Types" : m}</option>)}
          </select>

          {/* View toggle */}
          <div style={{ display: "flex", border: "1px solid var(--cc-border)", borderRadius: 8, overflow: "hidden" }}>
            <button onClick={() => setViewMode("list")} style={{ padding: "6px 10px", background: viewMode === "list" ? "var(--cc-bg)" : "white", border: "none", cursor: "pointer" }}>
              <List size={16} color={viewMode === "list" ? "var(--cc-primary)" : "var(--cc-text-muted)"} />
            </button>
            <button onClick={() => setViewMode("grid")} style={{ padding: "6px 10px", background: viewMode === "grid" ? "var(--cc-bg)" : "white", border: "none", cursor: "pointer" }}>
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

      {/* Posts */}
      {posts.length === 0 ? (
        <EmptyState icon="📹" title="No posts yet" description="Submit post URLs to track performance and manage approvals." />
      ) : viewMode === "list" ? (
        <Card variant="solid" noPadding>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 100px 90px 80px 80px 80px 90px 140px",
            gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
          }}>
            {["Post", "Platform", "Views", "Likes", "Comments", "Eng %", "Status", "Actions"].map(h => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
            ))}
          </div>
          {posts.map((post, i) => (
            <div
              key={post.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 100px 90px 80px 80px 80px 90px 140px",
                gap: 12, padding: "14px 24px", alignItems: "center",
                borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
              }}
            >
              <div>
                <Link href={`/campaigns/${campaignId}/posts/${post.id}`} style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", textDecoration: "none" }}>
                  {post.caption?.slice(0, 50) ?? "Untitled"}
                </Link>
                <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>by {post.creator.name} · {new Date(post.postedAt).toLocaleDateString()}</p>
              </div>
              <Badge variant="neutral" style={{ fontSize: 11 }}>{post.platform}</Badge>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(post.viewsCount)}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(post.likesCount)}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(post.commentsCount)}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-primary)" }}>{post.engagementRate.toFixed(1)}%</span>
              <Badge variant={STATUS_BADGE[post.status] ?? "neutral"}>{post.status.replace(/_/g, " ")}</Badge>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => openMetrics(post)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-primary)", background: "white", color: "var(--cc-primary)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 2 }}>
                  <BarChart3 size={12} /> Metrics
                </button>
                {postApprovalMode === "MANUAL" && post.status === "PENDING_REVIEW" && (
                  <>
                    <button onClick={() => handleApprove(post.id)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #059669", background: "#D1FAE5", color: "#059669", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 2 }}>
                      <Check size={12} />
                    </button>
                    <button onClick={() => setShowRejectModal(post.id)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #DC2626", background: "#FEE2E2", color: "#DC2626", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 2 }}>
                      <X size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      ) : (
        /* Grid view */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {posts.map((post) => (
            <Card key={post.id} variant="outlined" style={{ padding: 0, overflow: "hidden" }}>
              {post.thumbnailUrl && (
                <div style={{ width: "100%", height: 160, background: `url(${post.thumbnailUrl}) center/cover`, borderBottom: "1px solid var(--cc-border)" }} />
              )}
              <div style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
                  <div>
                    <a href={post.postUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", textDecoration: "none" }}>
                      {post.caption?.slice(0, 40) ?? "Untitled"}
                    </a>
                    <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{post.creator.name}</p>
                  </div>
                  <Badge variant={STATUS_BADGE[post.status] ?? "neutral"} style={{ fontSize: 10 }}>{post.status.replace(/_/g, " ")}</Badge>
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--cc-text-muted)" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Eye size={12} />{formatNumber(post.viewsCount)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Heart size={12} />{formatNumber(post.likesCount)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}><MessageCircle size={12} />{formatNumber(post.commentsCount)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}><TrendingUp size={12} />{post.engagementRate.toFixed(1)}%</span>
                </div>
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
          ))}
        </div>
      )}

      {/* Add Post Modal */}
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
              <select value={addForm.creatorId} onChange={(e) => setAddForm((f) => ({ ...f, creatorId: e.target.value }))} style={{ ...selectStyle, width: "100%" }}>
                <option value="">Select creator...</option>
                {creators.map((c) => <option key={c.id} value={c.id}>{c.name} (@{c.handle})</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Media Type</label>
              <select value={addForm.mediaType} onChange={(e) => setAddForm((f) => ({ ...f, mediaType: e.target.value }))} style={{ ...selectStyle, width: "100%" }}>
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

      {/* Update Metrics Modal */}
      {metricsPost && (
        <Modal open={true} onClose={() => setMetricsPost(null)} title="Update Metrics" size="md" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setMetricsPost(null)}>Cancel</Button>
            <Button variant="primary" loading={metricsSubmitting} onClick={handleUpdateMetrics}>Save Metrics</Button>
          </div>
        }>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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

      {/* Reject Modal */}
      {showRejectModal && (
        <Modal open={true} onClose={() => { setShowRejectModal(null); setRejectionReason(""); }} title="Reject Post" size="sm" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => { setShowRejectModal(null); setRejectionReason(""); }}>Cancel</Button>
            <Button variant="primary" onClick={handleReject} style={{ background: "#DC2626" }}>Reject Post</Button>
          </div>
        }>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Reason (optional)</label>
            <textarea
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
