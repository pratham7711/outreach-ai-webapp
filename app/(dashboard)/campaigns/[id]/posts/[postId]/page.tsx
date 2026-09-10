"use client";

import React from "react";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Badge, Skeleton, Tag, EmptyState } from "@pratham7711/ui";
import { PAGE_TITLE_STYLE, Button } from "@/components/ds";
import { ArrowLeft, ExternalLink, RefreshCw, Eye, Heart, MessageCircle, Share2, Download, Bookmark, TrendingUp, Flag, Lock, Activity, ShieldAlert, Shield, Play } from "lucide-react";
import dynamic from "next/dynamic";
import { computeEngagementRate } from "@/lib/metrics";
import { metricValue } from "@/lib/metricDisplay";
import { isPostRemoved, removedNote } from "@/lib/postRemoval";
import RemovedPostOverlay from "@/components/posts/RemovedPostOverlay";
import { imgSrc, embedSrcFor } from "@/lib/postMedia";
import { stripAt, formatDateAbs, formatDateTimeAbs, formatFull, fitFigureSize } from "@/lib/format";
import { loadCharts } from "@/components/charts/lazyCharts";
import { readCadenceLabel, DEFAULT_POST_TRACKING } from "@/lib/trackers/granularity";

const PerformanceOverTimeArea = dynamic(() => loadCharts().then((m) => m.PerformanceOverTimeArea), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="300px" borderRadius="8px" />,
});

const TrackingLine = dynamic(() => loadCharts().then((m) => m.TrackingLine), {
  ssr: false,
  loading: () => <Skeleton width="100%" height="280px" borderRadius="8px" />,
});

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
  /* Both already arrive on the wire — the GET returns the whole Post row — they
     were just never named here, so the header could not tell a live post from
     one the platform has stopped serving. */
  fetchState: string | null;
  platformMetrics?: unknown;
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

type BotSignal = {
  type: "VIEW_SPIKE" | "LOW_ENGAGEMENT" | "BOT_PATTERN";
  severity: "LOW" | "MEDIUM" | "HIGH";
  detail: string;
  at: string;
};

type TimeseriesSnapshot = {
  id: string;
  recordedAt: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  engagementRate: number;
};

type Timeseries = {
  trackingEnabled: boolean;
  trackingStartedAt: string | null;
  trackingTtlDays: number | null;
  trackingExpiresAt: string | null;
  hoursRemaining: number | null;
  readCadence: string;
  chartGranularity: string;
  rawSnapshotCount: number;
  snapshots: TimeseriesSnapshot[];
  botSignals: BotSignal[];
};

/* The product rule, mirrored from lib/trackers/granularity.ts. A post tracker
   always expires -- there is no unbounded option -- and the bound is what buys
   the unlimited number of them. */
const TTL_CHOICES = [1, 3, 7, 14, 30] as const;
const DEFAULT_TTL_CHOICE = 30;

function formatRemaining(hours: number | null): string {
  if (hours === null || hours <= 0) return "finished";
  if (hours < 48) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

const SIGNAL_LABEL: Record<BotSignal["type"], string> = {
  VIEW_SPIKE: "View spike",
  LOW_ENGAGEMENT: "Low engagement",
  BOT_PATTERN: "Bot pattern",
};

const SEVERITY_STYLE: Record<BotSignal["severity"], { bg: string; color: string }> = {
  HIGH: { bg: "#FEE2E2", color: "#DC2626" },
  MEDIUM: { bg: "#FEF3C7", color: "#D97706" },
  LOW: { bg: "#EEF2FF", color: "#4F46E5" },
};

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

/** A metric-card figure that shrinks to fit rather than running off the card. */
function FigureValue({ text, color = "var(--cc-text)" }: { text: string; color?: string }) {
  return (
    <span
      title={text}
      style={{
        fontSize: fitFigureSize(text, 24),
        fontWeight: 700,
        color,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        display: "block",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {text}
    </span>
  );
}

function formatNumber(num: number): string {
  return formatFull(num);
}

const BASE_METRIC_CARDS = [
  { key: "viewsCount", label: "Views", icon: Eye, color: "#5B5BD6" },
  { key: "likesCount", label: "Likes", icon: Heart, color: "#EC4899" },
  { key: "commentsCount", label: "Comments", icon: MessageCircle, color: "#F59E0B" },
  { key: "sharesCount", label: "Shares", icon: Share2, color: "var(--cc-success)" },
] as const;

export default function PostDetailPage() {
  const params = useParams<{ id: string; postId: string }>();
  const router = useRouter();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  /** Set when a sync came back without counts, so the click is not a silent no-op. */
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [timeseries, setTimeseries] = useState<Timeseries | null>(null);
  const [trackToggling, setTrackToggling] = useState(false);
  const [ttlDays, setTtlDays] = useState<number>(DEFAULT_TTL_CHOICE);

  const fetchTimeseries = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${params.id}/posts/${params.postId}/timeseries`);
      if (res.ok) setTimeseries(await res.json());
    } catch {
      // non-blocking: the tracking panel simply shows no data
    }
  }, [params.id, params.postId]);

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
  useEffect(() => { fetchTimeseries(); }, [fetchTimeseries]);

  const handleToggleTracking = async () => {
    const enable = !(timeseries?.trackingEnabled ?? false);
    setTrackToggling(true);
    setTimeseries((prev) =>
      prev
        ? { ...prev, trackingEnabled: enable, trackingStartedAt: enable ? new Date().toISOString() : null }
        : prev
    );
    try {
      const res = await fetch(`/api/campaigns/${params.id}/posts/${params.postId}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* ttlDays only on the way in. Untracking clears the window rather than
           shortening it, so sending one would be meaningless. */
        body: JSON.stringify(enable ? { enabled: true, ttlDays: ttlDays } : { enabled: false }),
      });
      if (res.ok) {
        await fetchTimeseries();
      } else {
        setTimeseries((prev) =>
          prev
            ? { ...prev, trackingEnabled: !enable, trackingStartedAt: !enable ? new Date().toISOString() : null }
            : prev
        );
      }
    } catch {
      setTimeseries((prev) =>
        prev
          ? { ...prev, trackingEnabled: !enable, trackingStartedAt: !enable ? new Date().toISOString() : null }
          : prev
      );
    } finally {
      setTrackToggling(false);
    }
  };

  const handleFlagFromSignal = async (signal: BotSignal) => {
    setFlagging(true);
    try {
      const res = await fetch(`/api/campaigns/${params.id}/posts/${params.postId}/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagType: signal.type, severity: signal.severity, note: signal.detail }),
      });
      if (res.ok) setFlagged(true);
    } finally {
      setFlagging(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await fetch(`/api/campaigns/${params.id}/posts/${params.postId}/sync`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncNote(body.error ?? "Could not sync this post.");
        return;
      }
      setPost(body);
      // A 200 that measured nothing is indistinguishable from one that did,
      // unless it says so.
      if (body.metricsFound === false) {
        setSyncNote("Synced, but the platform answered without any counts \u2014 nothing changed.");
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

  const embedSrc = embedSrcFor(post.platform, post.platformPostId, post.postUrl);
  // Not the raw CDN URL: TikTok's thumbnail hosts are blocked on some networks.
  const thumb = imgSrc(post.thumbnailUrl, 240, 160);

  const engRate =
    metricValue(post.likesCount, post.lastSyncedAt) === null &&
    metricValue(post.commentsCount, post.lastSyncedAt) === null
      ? null
      : computeEngagementRate({
          views: post.viewsCount,
          likes: post.likesCount,
          comments: post.commentsCount,
          shares: post.sharesCount,
          saves: post.savesCount,
        });
  const allMetricCards = [...BASE_METRIC_CARDS] as { key: string; label: string; icon: typeof Eye; color: string }[];
  if (post.platform === "INSTAGRAM") {
    allMetricCards.push({ key: "savesCount", label: "Saves", icon: Bookmark, color: "#8B5CF6" });
  }
  if (post.platform === "YOUTUBE") {
    allMetricCards.push({ key: "downloadsCount", label: "Downloads", icon: Download, color: "#6366F1" });
  }
  /* Views came across in the import; every other counter defaults to 0 for a
     post we never fetched, so its card would state a figure nobody measured.
     See lib/metricDisplay. */
  const metricCards = allMetricCards.filter(
    ({ key }) =>
      key === "viewsCount" ||
      metricValue((post as unknown as Record<string, number>)[key], post.lastSyncedAt) !== null
  );

  const chartData = post.snapshots.map((s) => ({
    // UTC named, so the axis labels a snapshot with the same day the server
    // rendered it under, and with the day the series is bucketed by.
    date: new Date(s.recordedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    views: s.viewsCount,
    likes: s.likesCount,
    comments: s.commentsCount,
  }));

  const trackingEnabled = timeseries?.trackingEnabled ?? false;
  const botSignals = timeseries?.botSignals ?? [];
  const trackingSeries = (timeseries?.snapshots ?? []).map((s) => ({
    ts: new Date(s.recordedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" }),
    views: s.viewsCount,
    engagement: s.likesCount + s.commentsCount,
  }));

  return (
    <div className="rsp-page" style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.back()}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", fontSize: 14, padding: 0, marginBottom: 16 }}
        >
          <ArrowLeft size={16} /> Back to Posts
        </button>

        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          {thumb && (
            embedSrc ? (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                aria-label="Play post"
                style={{ position: "relative", width: 120, height: 80, borderRadius: 10, overflow: "hidden", flexShrink: 0, border: "1px solid var(--cc-border)", padding: 0, cursor: "pointer", background: "none" }}
              >
                <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}>
                  <Play size={22} color="#ffffff" fill="#ffffff" />
                </span>
              </button>
            ) : (
              <div style={{ width: 120, height: 80, borderRadius: 10, overflow: "hidden", flexShrink: 0, border: "1px solid var(--cc-border)" }}>
                <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            )
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
              <h1 style={{ ...PAGE_TITLE_STYLE, margin: 0, minWidth: 0, overflowWrap: "anywhere" }}>
                {post.caption?.slice(0, 80) ?? "Untitled Post"}
              </h1>
              <Badge variant={STATUS_BADGE[post.status] ?? "neutral"}>{post.status.replace(/_/g, " ")}</Badge>
              {/* Beside the status rather than over the 120x80 thumbnail: the
                  pill is wider than the image. Every metric card below stays
                  put — they are the post's last real numbers. */}
              {isPostRemoved(post) && <RemovedPostOverlay variant="inline" note={removedNote(post)} />}
            </div>
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
              by <strong>{post.creator.name}</strong> (@{stripAt(post.creator.handle)}) · {post.platform} · Posted {formatDateAbs(post.postedAt)}
            </p>
            {post.lastSyncedAt ? (
              <p style={{ fontSize: 12, color: "var(--cc-text-subtle)", margin: "4px 0 0" }}>
                Last synced: {formatDateTimeAbs(post.lastSyncedAt)}
              </p>
            ) : (
              <p style={{ fontSize: 12, color: "var(--cc-text-subtle)", margin: "4px 0 0" }}>
                Never synced \u2014 the counts below are unknown, not zero.
              </p>
            )}
            {syncNote && (
              <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "4px 0 0" }}>{syncNote}</p>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
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

      {playing && embedSrc && (
        <Card variant="solid" style={{ padding: 0, marginBottom: 24, overflow: "hidden" }}>
          <div style={{ position: "relative", width: "100%", maxWidth: 620, margin: "0 auto", aspectRatio: post.platform === "YOUTUBE" ? "16 / 9" : "9 / 16" }}>
            <iframe
              src={embedSrc}
              title={post.caption ?? "Post"}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
            />
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginBottom: 24 }}>
        {metricCards.map(({ key, label, icon: Icon, color }) => (
          <Card key={key} variant="outlined" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Icon size={16} color={color} />
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
            </div>
            <FigureValue text={formatNumber((post as any)[key] ?? 0)} />
          </Card>
        ))}
        {engRate !== null && (
          <Card variant="outlined" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <TrendingUp size={16} color="#5B5BD6" />
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Engagement</span>
            </div>
            <span style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-primary)" }}>
              {`${(engRate * 100).toFixed(2)}%`}
            </span>
          </Card>
        )}
      </div>

      {chartData.length > 1 && (
        <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 16, marginTop: 0 }}>Performance Over Time</h3>
          <PerformanceOverTimeArea data={chartData} />
        </Card>
      )}

      <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: trackingSeries.length > 1 ? 20 : 0 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Activity size={18} color="var(--cc-primary)" />
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>Tracking</h3>
            </div>
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
              {trackingEnabled
                ? `Tracking on — read ${readCadenceLabel(timeseries?.readCadence ?? DEFAULT_POST_TRACKING.readCadence)}, ${formatRemaining(timeseries?.hoursRemaining ?? null)}.`
                : "Tracking off. Meta and IG only return lifetime totals, so enable tracking to record a real time series."}
            </p>
            {trackingEnabled && timeseries?.trackingExpiresAt && (
              <p style={{ fontSize: 12, color: "var(--cc-text-subtle)", margin: "4px 0 0" }}>
                Stops on {new Date(timeseries.trackingExpiresAt).toLocaleDateString()} and seals
                its final numbers. Tracked posts are unlimited because each one expires.
              </p>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {!trackingEnabled && (
              /* Every post tracker carries an expiry, so this is a required
                 choice presented as a default rather than an optional extra —
                 there is no "forever" entry to pick. */
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--cc-text-muted)" }}>
                <span>Track for</span>
                <select
                  value={ttlDays}
                  onChange={(e) => setTtlDays(Number(e.target.value))}
                  disabled={trackToggling}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--cc-border)",
                    background: "var(--cc-surface)",
                    color: "var(--cc-text)",
                    fontSize: 13,
                  }}
                >
                  {TTL_CHOICES.map((d) => (
                    <option key={d} value={d}>
                      {d} day{d === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button variant={trackingEnabled ? "secondary" : "primary"} onClick={handleToggleTracking} loading={trackToggling}>
              {trackingEnabled ? "Untrack" : "Track"}
            </Button>
          </div>
        </div>

        {trackingSeries.length > 1 && (
          <TrackingLine data={trackingSeries} />
        )}
        {trackingSeries.length <= 1 && trackingEnabled && (
          <p style={{ fontSize: 13, color: "var(--cc-text-subtle)", margin: "12px 0 0" }}>
            Collecting snapshots. The time series appears once at least two have been recorded.
          </p>
        )}

        <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--cc-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <ShieldAlert size={16} color={botSignals.length > 0 ? "#DC2626" : "var(--cc-text-muted)"} />
            <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>Bot Signals</h4>
          </div>
          {botSignals.length === 0 ? (
            <EmptyState
              icon={<Shield size={32} color="var(--cc-text-subtle)" />}
              title="No bot signals detected"
              description="Botted-view heuristics run over this post's snapshot history. Flags will appear here if suspicious growth is detected."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {botSignals.map((s, i) => {
                const sev = SEVERITY_STYLE[s.severity];
                return (
                  <div key={`${s.type}-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 12, borderRadius: 8, border: "1px solid var(--cc-border)", background: "var(--cc-bg)" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "3px 8px", borderRadius: 6, background: sev.bg, color: sev.color, flexShrink: 0 }}>
                      {s.severity}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{SIGNAL_LABEL[s.type]}</div>
                      <div style={{ fontSize: 13, color: "var(--cc-text-muted)", marginTop: 2 }}>{s.detail}</div>
                      <div style={{ fontSize: 11, color: "var(--cc-text-subtle)", marginTop: 4 }}>Detected {formatDateTimeAbs(s.at)}</div>
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>
                  These signals are advisory. Flagging a post routes it into the existing fraud review queue.
                </p>
                <Button variant="secondary" onClick={() => handleFlagFromSignal(botSignals[0])} loading={flagging} disabled={flagged}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, color: flagged ? "#DC2626" : undefined }}>
                    <Flag size={14} /> {flagged ? "Flagged" : "Flag post"}
                  </span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

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
              <span style={{ fontSize: 13, color: "var(--cc-text)" }}>{formatDateTimeAbs(s.recordedAt)}</span>
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
                  <span />
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
