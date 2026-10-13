"use client";

import React from "react";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Badge, Skeleton, Tag, EmptyState } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { ArrowLeft, ExternalLink, RefreshCw, Eye, Heart, MessageCircle, Share2, Download, Bookmark, TrendingUp, Flag, Lock, Activity, ShieldAlert, Shield, Play, Users } from "lucide-react";
import dynamic from "next/dynamic";
import { computeEngagementRate } from "@/lib/metrics";
import {
  META_CONNECTED_NOTE,
  META_UNAVAILABLE,
  fieldMetricValue,
  isMetaPlatform,
  measuredFields,
  postEngagementPercent,
  sharesPublished,
  unwrittenMetricValue,
  readableSnapshots,
  snapshotMetric,
  type MetricField,
} from "@/lib/metricDisplay";
import { postAgeContext, postMeasuredAt, postStatus } from "@/lib/posts/postStatus";
import { TIME_NOT_RECORDED } from "@/lib/dataAge";
import { viewsAsOf, viewsReadAt } from "@/lib/posts/fieldFreshness";
import PostStatusChip from "@/components/posts/PostStatusChip";
import { AgeLabel } from "@/components/ds/AgeLabel";
import { isUnknownMetric, metricReason, metricText, postCounterValue, unknownMetric, type MetricValue } from "@/lib/creators/metricValue";
import { imgSrc, embedSrcFor, postThumbnailUrl } from "@/lib/postMedia";
import { stripAt, formatDateAbs, formatDateTimeAbs, formatFull, fitFigureSize } from "@/lib/format";
import { MIN_SNAPSHOTS } from "@/lib/fraud/botSignals";
import { loadCharts } from "@/components/charts/lazyCharts";
import { readCadenceLabel, DEFAULT_POST_TRACKING } from "@/lib/trackers/granularity";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { useCampaignNav } from "@/components/providers/CampaignNavProvider";
import { CampaignShareButton } from "@/components/campaigns/CampaignShareButton";

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
  /** CreatorCore's last refresh, for an imported post we have not read. */
  lastFreshAt?: string | null;
  creator: { id: string; name: string; handle: string; avatarUrl: string | null; platform: string };
  snapshots: Snapshot[];
  /** Sent by GET only, for the rail's heading. */
  campaignTitle?: string;
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
  /** Which counters this reading measured (lib/metricDisplay snapshotMetric). */
  platformMetrics?: unknown;
};

type LiveComments = {
  /** Every top-level comment, from Facebook's own summary. */
  total: number | null;
  preview: {
    id: string;
    message: string;
    authorName: string | null;
    createdAt: string | null;
    likeCount: number | null;
  }[];
  pageName: string | null;
  readAt: string;
  /** Always false. Sent by the route so the screen can state it. */
  stored: boolean;
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
  /** null until a reading measured it. */
  likesCount: number | null;
  commentsCount: number | null;
  sharesCount: number | null;
  engagementRate: number;
};

type Timeseries = {
  /** Whether the cron reads this post at all -- with a tracker or without. */
  trackingEnabled: boolean;
  /** Why: "tracker", "campaign", "new-post" or "final-read". */
  trackingSource?: string | null;
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

/* Three of the four reasons a post is read are automatic, and the panel has to
   say which, or a post read because its campaign is running looks like one
   somebody switched on -- and Untrack on it reads as undoing nothing. */
function trackingSummary(source: string | null, cadence: string, remaining: string): string {
  if (source === "campaign") return `Tracking on — read ${cadence} while this campaign is live.`;
  if (source === "new-post") return `Tracking automatically for its first 30 days — read ${cadence}, ${remaining}.`;
  if (source === "final-read") return "Older than 180 days — one more reading, then its numbers are kept as final.";
  return `Tracking on — read ${cadence}, ${remaining}.`;
}

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
  HIGH: { bg: "var(--cc-danger-bg)", color: "var(--cc-danger-fg)" },
  MEDIUM: { bg: "var(--cc-warning-bg)", color: "var(--cc-warning-fg)" },
  LOW: { bg: "var(--cc-accent-bg)", color: "var(--cc-accent-fg)" },
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

/** One snapshot counter, or "—" when that reading did not measure it. */
function snapshotCell(value: number | null | undefined, platformMetrics: unknown, field: MetricField): string {
  const v = snapshotMetric(value, platformMetrics, field);
  return v === null ? "—" : formatFull(v);
}

const UNWRITTEN_CARDS = new Set(["savesCount", "reachCount", "downloadsCount"]);

/** Meta's insight counters. On an Instagram or Facebook post these cards stay
    on screen when Meta withheld the figure, saying so, rather than vanishing:
    a reviewer has to see where reach and saves would be. */
const META_INSIGHT_CARDS = new Set(["viewsCount", "reachCount", "savesCount"]);

const BASE_METRIC_CARDS = [
  { key: "viewsCount", field: "views", label: "Views", icon: Eye, color: "var(--cc-primary)" },
  { key: "likesCount", field: "likes", label: "Likes", icon: Heart, color: "var(--chart-5)" },
  { key: "commentsCount", field: "comments", label: "Comments", icon: MessageCircle, color: "var(--chart-4)" },
  { key: "sharesCount", field: "shares", label: "Shares", icon: Share2, color: "var(--cc-success)" },
] as const;

export default function PostDetailPage() {
  const params = useParams<{ id: string; postId: string }>();
  const router = useRouter();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  /* Comments are fetched on request, never with the page. Opening a post must
     not read the words of people who commented on it; someone has to ask. */
  const [comments, setComments] = useState<LiveComments | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  /** Set when a sync came back without counts, so the click is not a silent no-op. */
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [timeseries, setTimeseries] = useState<Timeseries | null>(null);
  const [trackToggling, setTrackToggling] = useState(false);
  const [ttlDays, setTtlDays] = useState<number>(DEFAULT_TTL_CHOICE);

  /* Head the rail with this campaign's title. Opened from the campaign the
     rail already has it; opened by its own link it had only "Campaign". The
     counts are passed through untouched, since this page does not know them. */
  const { title: railTitle, counts: railCounts, publish: publishRail } = useCampaignNav();
  const campaignTitle = post?.campaignTitle;
  useEffect(() => {
    if (campaignTitle && railTitle !== campaignTitle) publishRail({ title: campaignTitle, counts: railCounts });
  }, [campaignTitle, railTitle, railCounts, publishRail]);

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

  const status = postStatus(post);
  const measured = postMeasuredAt(post);
  /* A views figure the latest read did not return carries its own date. */
  const viewsNote = viewsAsOf({
    viewsCount: post.viewsCount,
    platformMetrics: post.platformMetrics,
    viewsReadAt: viewsReadAt(post.platformMetrics, post.snapshots),
  });

  /* Held in component state for as long as the screen is open and never sent
     anywhere else. There is no column for a comment body and no cache in front
     of the route — see app/api/campaigns/[id]/posts/[postId]/comments. */
  const loadComments = async () => {
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const res = await fetch(`/api/campaigns/${params.id}/posts/${params.postId}/comments`);
      const body = await res.json();
      if (!res.ok) {
        setCommentsError(body?.reason || "Could not read comments for this post.");
        setComments(null);
        return;
      }
      setComments(body as LiveComments);
    } catch {
      setCommentsError("Could not reach Facebook. Try again in a moment.");
      setComments(null);
    } finally {
      setCommentsLoading(false);
    }
  };

  const embedSrc = embedSrcFor(post.platform, post.platformPostId, post.postUrl);
  // Not the raw CDN URL: TikTok's thumbnail hosts are blocked on some networks.
  const thumb = imgSrc(postThumbnailUrl(post), 240, 160);

  /* postEngagementPercent, the one per-post rate: the same number the Posts
     tab card and list, Performance, the share link and the exports print. As a
     fraction here because the tile and the table below multiply by 100. */
  const engRatePct = postEngagementPercent(post);
  const engRate = engRatePct === null ? null : engRatePct / 100;
  const allMetricCards = [...BASE_METRIC_CARDS] as { key: string; field: MetricField; label: string; icon: typeof Eye; color: string }[];
  if (post.platform === "INSTAGRAM") {
    allMetricCards.push({ key: "savesCount", field: "saves", label: "Saves", icon: Bookmark, color: "var(--chart-2)" });
    /* Reach is the counter instagram_manage_insights uniquely unlocks — no
       other permission, and no unauthorised read, yields it. It had no card
       because it had no value: assemblePostMetrics parsed reach off the
       insights edge and then dropped it before the write, so the column was 0
       on all 18,676 rows. The parser and the writer both had tests; the
       whitelist between them did not.

       Gated on the measured-field list rather than on the number, because the
       legacy zeroes carry a lastSyncedAt from a TikTok-era sync and would
       otherwise read as a measured "reached nobody". */
    allMetricCards.push({ key: "reachCount", field: "reach", label: "Reach", icon: Users, color: "var(--cc-info)" });
  }
  if (post.platform === "YOUTUBE") {
    allMetricCards.push({ key: "downloadsCount", field: "downloads", label: "Downloads", icon: Download, color: "var(--chart-2)" });
  }
  /* Views came across in the import; every other counter defaults to 0 for a
     post we never fetched, so its card would state a figure nobody measured.

     fieldMetricValue, not metricValue: one lastSyncedAt cannot describe a row
     whose likes were fetched and whose reach was not, and every Instagram post
     synced before the reach fix is exactly that row. See lib/metricDisplay. */
  const metaPost = isMetaPlatform(post.platform);
  const metricCards = allMetricCards.filter(
    ({ key, field }) =>
      key === "viewsCount" ||
      (metaPost && META_INSIGHT_CARDS.has(key)) ||
      /* No reader stores saves, reach or downloads for a post we do not own,
         and the legacy rows carry a lastSyncedAt that reads their 0 as
         measured -- the tiles printed "Saves 0" and "Reach 0" on public posts.
         The list view's gate: a positive value or nothing. */
      (UNWRITTEN_CARDS.has(key)
        ? unwrittenMetricValue((post as unknown as Record<string, number>)[key]) !== null
        : fieldMetricValue(
        (post as unknown as Record<string, number>)[key],
        post.lastSyncedAt,
        post.platformMetrics,
        field,
      ) !== null)
  );

  /* The snapshot table's columns, each offered only when some row fills it.
     Saves had no reader for public posts, Sealed is set by nothing on most
     campaigns, and the stored per-snapshot engagementRate is 0 on almost every
     row -- the column read 0.0% under a header tile saying 8.60%. The rate is
     worked out from each row's own counts instead, with the header's rule for
     when there is a rate at all. */
  const snapshotSaves = post.snapshots.some((s) => unwrittenMetricValue(s.savesCount) !== null);
  const snapshotSealed = post.snapshots.some((s) => s.isFinalSnapshot);
  const snapshotCols = [
    { key: "recorded", label: "Recorded", width: "1.4fr", min: 160 },
    { key: "views", label: "Views", width: "90px", min: 90 },
    { key: "likes", label: "Likes", width: "80px", min: 80 },
    { key: "comments", label: "Comments", width: "90px", min: 90 },
    { key: "shares", label: "Shares", width: "80px", min: 80 },
    ...(snapshotSaves ? [{ key: "saves", label: "Saves", width: "80px", min: 80 }] : []),
    ...(engRate !== null ? [{ key: "eng", label: "Eng %", width: "90px", min: 90 }] : []),
    { key: "source", label: "Source", width: "110px", min: 110 },
    ...(snapshotSealed ? [{ key: "sealed", label: "Sealed", width: "90px", min: 90 }] : []),
  ];
  const snapshotGrid = snapshotCols.map((c) => c.width).join(" ");
  const snapshotMinWidth = snapshotCols.reduce((sum, c) => sum + c.min + 12, 48);

  /* Oldest first: the route sends the newest 50 newest-first for the table
     below, and charting them in that order ran the time axis backwards. Only
     readings that measured views are plotted (lib/metricDisplay
     readableSnapshots), so a partial read is not drawn as a fall to 0. */
  const chartData = readableSnapshots([...post.snapshots].reverse()).map((s) => ({
    // The reading's instant, for a time-scaled axis: readings are not evenly
    // spaced, and several a day each drew under the same date label.
    t: new Date(s.recordedAt).getTime(),
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
    t: new Date(s.recordedAt).getTime(),
    // UTC, like the chart above; this was the viewer's zone with no zone named.
    ts: `${new Date(s.recordedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", timeZone: "UTC" })} UTC`,
    views: s.viewsCount,
    engagement: s.likesCount === null && s.commentsCount === null ? null : (s.likesCount ?? 0) + (s.commentsCount ?? 0),
  }));

  return (
    <div className="rsp-page" style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.back()}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", fontSize: "var(--cc-t-14)", padding: 0, marginBottom: 16 }}
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
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--cc-media-ink) 35%, transparent)" }}>
                  <Play size={22} color="var(--cc-overlay-ink-text)" fill="var(--cc-overlay-ink-text)" />
                </span>
              </button>
            ) : (
              <div style={{ width: 120, height: 80, borderRadius: 10, overflow: "hidden", flexShrink: 0, border: "1px solid var(--cc-border)" }}>
                <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            )
          )}
          <div className="cc-post-headtext">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
              <h1 className="cc-page-title" data-mb="0" data-wrap="anywhere">
                {post.caption?.slice(0, 80) ?? "Untitled Post"}
              </h1>
              <Badge variant={STATUS_BADGE[post.status] ?? "neutral"}>{post.status.replace(/_/g, " ")}</Badge>
              {/* Beside the status rather than over the 120x80 thumbnail: the
                  pill is wider than the image. Every metric card below stays
                  put — they are the post's last real numbers. */}
              <PostStatusChip status={status} showLive />
            </div>
            <p style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>
              <CreatorAvatar id={post.creator.id} name={post.creator.name} size="sm" />
              by <strong>{post.creator.name}</strong>{stripAt(post.creator.handle) ? ` (@${stripAt(post.creator.handle)})` : ""} · {post.platform} · Posted {formatDateAbs(post.postedAt)}
            </p>
            {post.lastSyncedAt ? (
              <p style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)", margin: "4px 0 0" }}>
                Last synced: {formatDateTimeAbs(post.lastSyncedAt)}
                <AgeLabel at={post.lastSyncedAt} field="post" ctx={postAgeContext({ postedAt: post.postedAt, trackingEnabled: timeseries?.trackingEnabled, trackingExpiresAt: timeseries?.trackingExpiresAt }, status)} source={measured.source} />
              </p>
            ) : measured.at ? (
              <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)", margin: "4px 0 0" }}>
                Not read by us yet. The figures below are the CreatorCore import&apos;s, as of {formatDateTimeAbs(measured.at)}.{" "}
                <AgeLabel at={measured.at} field="post" ctx={postAgeContext({ postedAt: post.postedAt, trackingEnabled: timeseries?.trackingEnabled, trackingExpiresAt: timeseries?.trackingExpiresAt }, status)} source={measured.source} />
              </p>
            ) : [post.viewsCount, post.likesCount, post.commentsCount, post.sharesCount, post.savesCount].some((n) => (n ?? 0) > 0) ? (
              /* Figures on file that no read of ours produced and no import
                 dated: say where they came from, as the creator page does
                 ("Unverified · not read by us yet"), rather than "never synced"
                 above real counts. */
              <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)", margin: "4px 0 0" }}>
                Imported figures · not read by us yet · {TIME_NOT_RECORDED}
              </p>
            ) : (
              <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)", margin: "4px 0 0" }}>
                Not read by us yet — the counts below are unknown, not zero.
              </p>
            )}
            {syncNote && (
              <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "4px 0 0" }}>{syncNote}</p>
            )}
          </div>
          <div className="cc-post-actions">
            {/* The campaign's, not the post's: the share link is the campaign
                report. First, as in the campaign header on every section. */}
            <CampaignShareButton campaignId={params.id} campaignTitle={post.campaignTitle} />
            <Button variant="secondary" onClick={handleFlag} loading={flagging} disabled={flagged}>
              <span style={{ display: "flex", alignItems: "center", gap: 4, color: flagged ? "var(--cc-danger-fg)" : undefined }}>
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

      <div className="cc-tiles-balanced" style={{ marginBottom: 24 }}>
        {metricCards.map(({ key, field, label, icon: Icon, color }) => (
          <Card key={key} variant="outlined" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Icon size={16} color={color} />
              <span className="cc-microlabel">{label}</span>
            </div>
            {/* "—" with its reason for a counter nobody read, never a 0;
                a hidden or deleted post keeps its last real figures. */}
            {(() => {
              const raw = (post as unknown as Record<string, number>)[key];
              /* Saves and reach on a post with no measured-field list are the
                 column default, not a reading: positive or unknown, never 0. */
              const value: MetricValue =
                UNWRITTEN_CARDS.has(key) && measuredFields(post.platformMetrics) === null
                  ? (unwrittenMetricValue(raw) ?? unknownMetric(`The platform did not report ${field} for this post.`))
                  : postCounterValue(raw, post, field);
              if (metaPost && META_INSIGHT_CARDS.has(key) && isUnknownMetric(value)) {
                return (
                  <span title={META_CONNECTED_NOTE}>
                    <span style={{ display: "block", fontSize: "var(--cc-t-14)", fontWeight: 600, lineHeight: "30px", color: "var(--cc-text-muted)" }}>
                      {META_UNAVAILABLE}
                    </span>
                    <span style={{ display: "block", marginTop: 4, fontSize: "var(--cc-t-11)", lineHeight: 1.3, color: "var(--cc-text-muted)" }}>
                      {META_CONNECTED_NOTE}
                    </span>
                  </span>
                );
              }
              return (
                <>
                  <span title={metricReason(value)}>
                    <FigureValue text={metricText(value, formatNumber)} />
                  </span>
                  {/* Only a views figure that the latest read did not return
                      says when it was read. Every other figure is from the read
                      the header already dates, and repeating its "Stale · 10d
                      ago" under each tile said the same thing four times. */}
                  {field === "views" && viewsNote ? (
                    <span
                      title={viewsNote.title}
                      style={{ display: "block", marginTop: 4, fontSize: "var(--cc-t-11)", lineHeight: 1.3, color: "var(--cc-text-muted)" }}
                    >
                      {viewsNote.sentence}
                    </span>
                  ) : null}
                </>
              );
            })()}
          </Card>
        ))}
        {engRate !== null && (
          <Card variant="outlined" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <TrendingUp size={16} color="var(--cc-primary)" />
              <span className="cc-microlabel">Engagement</span>
            </div>
            <span style={{ fontSize: "var(--cc-t-24)", fontWeight: 700, color: "var(--cc-primary)" }}>
              {`${(engRate * 100).toFixed(2)}%`}
            </span>
          </Card>
        )}
      </div>

      {/* Facebook only. Instagram comment bodies need
          instagram_business_manage_comments, which this app has not requested,
          and TikTok publishes no comments API — so the panel is absent rather
          than present-and-broken on those platforms. */}
      {post.platform === "FACEBOOK" && (
        <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <MessageCircle size={18} color="var(--cc-primary)" />
                <h3 style={{ fontSize: "var(--cc-t-16)", fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>Comments on this post</h3>
              </div>
              <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0, maxWidth: "60ch" }}>
                Read live from the creator&rsquo;s Facebook Page when you ask for them.
                Comments are shown here and never saved — reload and they are read again.
              </p>
            </div>
            <Button variant="secondary" onClick={loadComments} loading={commentsLoading}>
              {commentsLoading ? "Reading…" : comments ? "Read again" : "Show comments"}
            </Button>
          </div>

          {commentsError && (
            <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-danger)", margin: "16px 0 0" }}>{commentsError}</p>
          )}

          {comments && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: "var(--cc-t-24)", fontWeight: 700, color: "var(--cc-text)" }}>
                  {comments.total === null ? "—" : formatNumber(comments.total)}
                </span>
                <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
                  {comments.total === 1 ? "top-level comment" : "top-level comments"}
                  {comments.pageName ? ` on ${comments.pageName}` : ""}
                </span>
              </div>

              {comments.preview.length === 0 ? (
                <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>
                  {comments.total === 0
                    ? "Nobody has commented on this post yet."
                    : "Facebook returned the count but no comment bodies — the Page may restrict who can read them."}
                </p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                  {comments.preview.map((c) => (
                    <li key={c.id} style={{ borderLeft: "2px solid var(--cc-border)", paddingLeft: 12 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>
                          {/* Facebook omits the commenter for anyone who has not
                              authorised this app, which is most people. */}
                          {c.authorName ?? "Facebook user"}
                        </span>
                        {c.createdAt && (
                          <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)" }}>
                            {new Date(c.createdAt).toLocaleString()}
                          </span>
                        )}
                        {c.likeCount !== null && c.likeCount > 0 && (
                          <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)" }}>
                            {formatNumber(c.likeCount)} {c.likeCount === 1 ? "like" : "likes"}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text)", margin: "2px 0 0", whiteSpace: "pre-wrap" }}>
                        {c.message || <span style={{ color: "var(--cc-text-subtle)" }}>(no text — a photo or sticker)</span>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)", margin: "16px 0 0" }}>
                {comments.preview.length > 0 && comments.total !== null && comments.total > comments.preview.length
                  ? `Showing the ${comments.preview.length} most recent of ${formatNumber(comments.total)}. `
                  : ""}
                Read at {new Date(comments.readAt).toLocaleTimeString()}
                {comments.stored ? "" : " · not stored"}
              </p>
            </div>
          )}
        </Card>
      )}

      {chartData.length > 1 && (
        <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: "var(--cc-t-16)", fontWeight: 700, color: "var(--cc-text)", marginBottom: 16, marginTop: 0 }}>Performance Over Time</h3>
          <PerformanceOverTimeArea data={chartData} />
        </Card>
      )}

      <Card variant="outlined" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: trackingSeries.length > 1 ? 20 : 0 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Activity size={18} color="var(--cc-primary)" />
              <h3 style={{ fontSize: "var(--cc-t-16)", fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>Tracking</h3>
            </div>
            <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>
              {trackingEnabled
                ? trackingSummary(
                    timeseries?.trackingSource ?? null,
                    readCadenceLabel(timeseries?.readCadence ?? DEFAULT_POST_TRACKING.readCadence),
                    formatRemaining(timeseries?.hoursRemaining ?? null),
                  )
                : "Tracking off. Meta and IG only return lifetime totals, so enable tracking to record a real time series."}
            </p>
            {trackingEnabled && timeseries?.trackingExpiresAt && (timeseries.trackingSource ?? "tracker") === "tracker" && (
              <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)", margin: "4px 0 0" }}>
                Stops on {formatDateAbs(timeseries.trackingExpiresAt)} and seals
                its final numbers. Tracked posts are unlimited because each one expires.
              </p>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {!trackingEnabled && (
              /* Every post tracker carries an expiry, so this is a required
                 choice presented as a default rather than an optional extra —
                 there is no "forever" entry to pick. */
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
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
                    fontSize: "var(--cc-t-13)",
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
          <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-subtle)", margin: "12px 0 0" }}>
            Collecting snapshots. The time series appears once at least two have been recorded.
          </p>
        )}

        {/* The heuristics need MIN_SNAPSHOTS readings and return nothing below
            that, so "No bot signals detected" on a post with one reading claimed
            a check that never ran. The section waits until it has. */}
        {(timeseries?.snapshots?.length ?? 0) >= MIN_SNAPSHOTS && (
        <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--cc-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <ShieldAlert size={16} color={botSignals.length > 0 ? "var(--cc-danger-fg)" : "var(--cc-text-muted)"} />
            <h4 style={{ fontSize: "var(--cc-t-14)", fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>Bot Signals</h4>
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
                      <div style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{SIGNAL_LABEL[s.type]}</div>
                      <div style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", marginTop: 2 }}>{s.detail}</div>
                      <div style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-subtle)", marginTop: 4 }}>Detected {formatDateTimeAbs(s.at)}</div>
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: 0 }}>
                  These signals are advisory. Flagging a post routes it into the existing fraud review queue.
                </p>
                <Button variant="secondary" onClick={() => handleFlagFromSignal(botSignals[0])} loading={flagging} disabled={flagged}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, color: flagged ? "var(--cc-danger-fg)" : undefined }}>
                    <Flag size={14} /> {flagged ? "Flagged" : "Flag post"}
                  </span>
                </Button>
              </div>
            </div>
          )}
        </div>
        )}
      </Card>

      {post.snapshots.length > 0 ? (
        <Card variant="solid" noPadding style={{ overflowX: "auto" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
            <h3 style={{ fontSize: "var(--cc-t-16)", fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>Metric Snapshots</h3>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: snapshotGrid, minWidth: snapshotMinWidth,
            gap: 12, padding: "10px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
          }}>
            {snapshotCols.map(c => (
              <span key={c.key} className="cc-microlabel">{c.label}</span>
            ))}
          </div>
          {post.snapshots.map((s, i) => (
            <div
              key={s.id}
              style={{
                display: "grid", gridTemplateColumns: snapshotGrid, minWidth: snapshotMinWidth,
                gap: 12, padding: "12px 24px", alignItems: "center",
                borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
              }}
            >
              <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text)" }}>{formatDateTimeAbs(s.recordedAt)}</span>
              <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{snapshotCell(s.viewsCount, s.platformMetrics, "views")}</span>
              <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{snapshotCell(s.likesCount, s.platformMetrics, "likes")}</span>
              <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{snapshotCell(s.commentsCount, s.platformMetrics, "comments")}</span>
              {/* A YouTube (or non-connected Instagram) reading's 0 shares is a
                  count the platform never published -- see sharesPublished. */}
              <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{(s.sharesCount ?? 0) <= 0 && !sharesPublished(post.platform, s.platformMetrics) ? "\u2014" : snapshotCell(s.sharesCount, s.platformMetrics, "shares")}</span>
              {snapshotSaves && (
                <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{formatNumber(s.savesCount ?? 0)}</span>
              )}
              {engRate !== null && (
                <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-primary)" }}>
                  {(() => {
                    const views = snapshotMetric(s.viewsCount, s.platformMetrics, "views");
                    const likes = snapshotMetric(s.likesCount, s.platformMetrics, "likes");
                    const r = views === null || likes === null ? null : computeEngagementRate({
                      views,
                      likes,
                      comments: snapshotMetric(s.commentsCount, s.platformMetrics, "comments"),
                      shares: snapshotMetric(s.sharesCount, s.platformMetrics, "shares"),
                      saves: s.savesCount,
                    });
                    return r === null ? "—" : `${(r * 100).toFixed(2)}%`;
                  })()}
                </span>
              )}
              <Badge variant="neutral" style={{ fontSize: "var(--cc-t-11)"}}>{s.syncSource ?? "system"}</Badge>
              {snapshotSealed && (
                <span>
                  {s.isFinalSnapshot ? (
                    <Tag variant="success" outlined>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Lock size={10} /> Sealed</span>
                    </Tag>
                  ) : (
                    <span />
                  )}
                </span>
              )}
            </div>
          ))}
        </Card>
      ) : trackingEnabled ? null : (
        /* While tracking is on, the Tracking card above already says snapshots
           are being collected; a second card saying "No metric snapshots yet"
           under it was the same empty state twice. */
        <Card variant="outlined" style={{ padding: 32, textAlign: "center" }}>
          <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)", margin: 0 }}>No metric snapshots yet. Sync this post to start tracking history.</p>
        </Card>
      )}
    </div>
  );
}
