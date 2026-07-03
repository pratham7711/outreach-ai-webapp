"use client";

import React from "react";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Badge, Button, Skeleton, Tag } from "@pratham7711/ui";
import { ArrowLeft, ExternalLink, RefreshCw, Eye, Heart, MessageCircle, Share2, Download, Bookmark, DollarSign, TrendingUp, Flag, Lock } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { computePostEmv, computeEngagementRate } from "@/lib/metrics";

type PostDetail = {
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
  downloadsCount: number;
  savesCount: number;
  reachCount: number;
  engagementRate: number;
  status: string;
  lastSyncedAt: string | null;
  creator: { id: string; name: string; handle: string; avatarUrl: string | null; platform: string };
  snapshots: Snapshot[];
};

type Snapshot = {
  id: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  engagementRate: number;
  syncSource: string | null;
  isFinalSnapshot: boolean;
  recordedAt: string;
};

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

function formatMoney(num: number): string {
  return "$" + num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const BASE_METRIC_CARDS = [
  { key: "viewsCount", label: "Views", icon: Eye, color: "#5B5BD6" },
  { key: "likesCount", label: "Likes", icon: Heart, color: "#EC4899" },
  { key: "commentsCount", label: "Comments", icon: MessageCircle, color: "#F59E0B" },
  { key: "sharesCount", label: "Shares", icon: Share2, color: "#10B981" },
] as const;

export default function PostDetailPage() {
  const params = useParams<{ id: string; postId: string }>();
  const router = useRouter();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState(false);

  const fetchPost = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${params.id}/posts/${params.postId}`);
      if (res.ok) {
        setPost(await res.json());
      } else if (res.status === 404) {
        setPost(null);
      } else {
        setError("Could not load this post. Please try again.");
      }
    } catch {
      setError("Could not load this post. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [params.id, params.postId]);

  useEffect(() => { fetchPost(); }, [fetchPost]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/campaigns/${params.id}/posts/${params.postId}/sync`, { method: "POST" });
      if (res.ok) {
        setPost(await res.json());
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleFlag = async () => {
    setFlagging(true);
    try {
      const res = await fetch(`/api/campaigns/${params.id}/posts/${params.postId}/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagType: "BOT_PATTERN", severity: "MEDIUM" }),
      });
      if (res.ok) setFlagged(true);
    } finally {
      setFlagging(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 32, maxWidth: 1200, margin: "0 auto" }}>
        <Skeleton width="200px" height="32px" borderRadius="8px" />
        <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {[1, 2, 3].map(i => <Skeleton key={i} width="100%" height="100px" borderRadius="12px" />)}
        </div>
        <div style={{ marginTop: 24 }}>
          <Skeleton width="100%" height="300px" borderRadius="12px" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <p style={{ color: "var(--cc-text-muted)", marginBottom: 12 }}>{error}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <Button variant="secondary" onClick={() => router.back()}>Go Back</Button>
          <Button variant="primary" onClick={fetchPost}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <p style={{ color: "var(--cc-text-muted)" }}>Post not found.</p>
        <Button variant="secondary" onClick={() => router.back()}>Go Back</Button>
      </div>
    );
  }

  const engRate = computeEngagementRate({
    views: post.viewsCount,
    likes: post.likesCount,
    comments: post.commentsCount,
    shares: post.sharesCount,
    saves: post.savesCount,
  });
  const emv = computePostEmv({
    platform: post.platform,
    views: post.viewsCount,
    likes: post.likesCount,
    comments: post.commentsCount,
    shares: post.sharesCount,
    saves: post.savesCount,
  });

  const metricCards = [...BASE_METRIC_CARDS] as { key: string; label: string; icon: typeof Eye; color: string }[];
  if (post.platform === "INSTAGRAM") {
    metricCards.push({ key: "savesCount", label: "Saves", icon: Bookmark, color: "#8B5CF6" });
  }
  if (post.platform === "YOUTUBE") {
    metricCards.push({ key: "downloadsCount", label: "Downloads", icon: Download, color: "#6366F1" });
  }

  const chartData = post.snapshots.map((s) => ({
    date: new Date(s.recordedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    views: s.viewsCount,
    likes: s.likesCount,
    comments: s.commentsCount,
  }));

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.back()}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", fontSize: 14, padding: 0, marginBottom: 16 }}
        >
          <ArrowLeft size={16} /> Back to Posts
        </button>

        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          {post.thumbnailUrl && (
            <div style={{ width: 120, height: 80, borderRadius: 10, overflow: "hidden", flexShrink: 0, border: "1px solid var(--cc-border)" }}>
              <img src={post.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
                {post.caption?.slice(0, 80) ?? "Untitled Post"}
              </h1>
              <Badge variant={STATUS_BADGE[post.status] ?? "neutral"}>{post.status.replace(/_/g, " ")}</Badge>
            </div>
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
              by <strong>{post.creator.name}</strong> (@{post.creator.handle}) · {post.platform} · Posted {new Date(post.postedAt).toLocaleDateString()}
            </p>
            {post.lastSyncedAt && (
              <p style={{ fontSize: 12, color: "var(--cc-text-subtle)", margin: "4px 0 0" }}>
                Last synced: {new Date(post.lastSyncedAt).toLocaleString()}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={handleFlag} loading={flagging} disabled={flagged}>
              <span style={{ display: "flex", alignItems: "center", gap: 4, color: flagged ? "#DC2626" : undefined }}>
                <Flag size={14} /> {flagged ? "Flagged" : "Flag Suspicious"}
              </span>
            </Button>
            <Button variant="secondary" onClick={handleSync} loading={syncing}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><RefreshCw size={14} /> Sync Now</span>
            </Button>
            <a href={post.postUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
              <Button variant="primary">
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><ExternalLink size={14} /> View Post</span>
              </Button>
            </a>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        {metricCards.map(({ key, label, icon: Icon, color }) => (
          <Card key={key} variant="outlined" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Icon size={16} color={color} />
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
            </div>
            <span style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>
              {formatNumber((post as any)[key] ?? 0)}
            </span>
          </Card>
        ))}
        <Card variant="outlined" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <TrendingUp size={16} color="#5B5BD6" />
            <span style={{ fontSize: 12, color: "var(--cc-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Engagement</span>
          </div>
          <span style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-primary)" }}>
            {engRate === null ? "—" : `${(engRate * 100).toFixed(2)}%`}
          </span>
        </Card>
        <Card variant="outlined" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <DollarSign size={16} color="#059669" />
            <span style={{ fontSize: 12, color: "var(--cc-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>EMV</span>
          </div>
          <span style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>
            {formatMoney(emv)}
          </span>
        </Card>
      </div>

      {chartData.length > 1 && (
        <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 16, marginTop: 0 }}>Performance Over Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
              <YAxis tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
              <Tooltip
                contentStyle={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 8, fontSize: 13 }}
              />
              <Area type="monotone" dataKey="views" name="Views" stroke="#5B5BD6" fill="#5B5BD6" fillOpacity={0.1} />
              <Area type="monotone" dataKey="likes" name="Likes" stroke="#EC4899" fill="#EC4899" fillOpacity={0.1} />
              <Area type="monotone" dataKey="comments" name="Comments" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.1} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {post.snapshots.length > 0 ? (
        <Card variant="solid" noPadding style={{ overflowX: "auto" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>Metric Snapshots</h3>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "1.4fr 90px 80px 90px 80px 80px 90px 110px 90px", minWidth: 900,
            gap: 12, padding: "10px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
          }}>
            {["Recorded", "Views", "Likes", "Comments", "Shares", "Saves", "Eng %", "Source", "Sealed"].map(h => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
            ))}
          </div>
          {post.snapshots.map((s, i) => (
            <div
              key={s.id}
              style={{
                display: "grid", gridTemplateColumns: "1.4fr 90px 80px 90px 80px 80px 90px 110px 90px", minWidth: 900,
                gap: 12, padding: "12px 24px", alignItems: "center",
                borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
              }}
            >
              <span style={{ fontSize: 13, color: "var(--cc-text)" }}>{new Date(s.recordedAt).toLocaleString()}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(s.viewsCount)}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(s.likesCount)}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(s.commentsCount)}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(s.sharesCount ?? 0)}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(s.savesCount ?? 0)}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-primary)" }}>{(s.engagementRate ?? 0).toFixed(1)}%</span>
              <Badge variant="neutral" style={{ fontSize: 11 }}>{s.syncSource ?? "system"}</Badge>
              <span>
                {s.isFinalSnapshot ? (
                  <Tag variant="success" outlined>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Lock size={10} /> Sealed</span>
                  </Tag>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--cc-text-subtle)" }}>—</span>
                )}
              </span>
            </div>
          ))}
        </Card>
      ) : (
        <Card variant="outlined" style={{ padding: 32, textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>No metric snapshots yet. Sync this post to start tracking history.</p>
        </Card>
      )}
    </div>
  );
}
