"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Badge, Button, Skeleton } from "@pratham7711/ui";
import { ArrowLeft, ExternalLink, RefreshCw, Eye, Heart, MessageCircle, Share2, Download, Bookmark } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

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
  engagementRate: number;
  syncSource: string | null;
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

const METRIC_CARDS = [
  { key: "viewsCount", label: "Views", icon: Eye, color: "#5B5BD6" },
  { key: "likesCount", label: "Likes", icon: Heart, color: "#EC4899" },
  { key: "commentsCount", label: "Comments", icon: MessageCircle, color: "#F59E0B" },
  { key: "sharesCount", label: "Shares", icon: Share2, color: "#10B981" },
  { key: "downloadsCount", label: "Downloads", icon: Download, color: "#6366F1" },
  { key: "savesCount", label: "Saves", icon: Bookmark, color: "#8B5CF6" },
] as const;

export default function PostDetailPage() {
  const params = useParams<{ id: string; postId: string }>();
  const router = useRouter();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchPost = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${params.id}/posts/${params.postId}`);
    if (res.ok) setPost(await res.json());
    setLoading(false);
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

  if (!post) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <p style={{ color: "var(--cc-text-muted)" }}>Post not found.</p>
        <Button variant="secondary" onClick={() => router.back()}>Go Back</Button>
      </div>
    );
  }

  const chartData = post.snapshots.map((s) => ({
    date: new Date(s.recordedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    views: s.viewsCount,
    likes: s.likesCount,
    comments: s.commentsCount,
  }));

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
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
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
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
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
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

      {/* Metric Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        {METRIC_CARDS.map(({ key, label, icon: Icon, color }) => (
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
            <span style={{ fontSize: 12, color: "var(--cc-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Engagement</span>
          </div>
          <span style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-primary)" }}>
            {post.engagementRate.toFixed(2)}%
          </span>
        </Card>
      </div>

      {/* Historical Chart */}
      {chartData.length > 1 && (
        <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 16, marginTop: 0 }}>Performance Over Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--cc-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
              <YAxis tick={{ fontSize: 12, fill: "var(--cc-text-muted)" }} />
              <Tooltip
                contentStyle={{ background: "white", border: "1px solid var(--cc-border)", borderRadius: 8, fontSize: 13 }}
              />
              <Area type="monotone" dataKey="views" name="Views" stroke="#5B5BD6" fill="#5B5BD6" fillOpacity={0.1} />
              <Area type="monotone" dataKey="likes" name="Likes" stroke="#EC4899" fill="#EC4899" fillOpacity={0.1} />
              <Area type="monotone" dataKey="comments" name="Comments" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.1} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Snapshot History */}
      {post.snapshots.length > 0 && (
        <Card variant="solid" noPadding>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>Metric Snapshots</h3>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 90px 80px 80px 90px 100px",
            gap: 12, padding: "10px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
          }}>
            {["Date", "Views", "Likes", "Comments", "Eng %", "Source"].map(h => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
            ))}
          </div>
          {post.snapshots.map((s, i) => (
            <div
              key={s.id}
              style={{
                display: "grid", gridTemplateColumns: "1fr 90px 80px 80px 90px 100px",
                gap: 12, padding: "12px 24px", alignItems: "center",
                borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
              }}
            >
              <span style={{ fontSize: 13, color: "var(--cc-text)" }}>{new Date(s.recordedAt).toLocaleString()}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatNumber(s.viewsCount)}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(s.likesCount)}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatNumber(s.commentsCount)}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-primary)" }}>{s.engagementRate.toFixed(1)}%</span>
              <Badge variant="neutral" style={{ fontSize: 11 }}>{s.syncSource ?? "system"}</Badge>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
