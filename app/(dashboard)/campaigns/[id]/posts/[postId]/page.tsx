"use client";

import React from "react";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@pratham7711/ui";
import {
  Button,
  MoreMenu,
  PageHeader,
  MetricTile,
  SectionCard,
  DataTable,
  NoResults,
  Dropdown,
  LoadError,
  Skeleton,
  type DataTableColumn,
  type StatusTone,
} from "@/components/ds";
import { TileGridSkeleton } from "@/components/ui/PageSkeleton";
import { enumLabel } from "@/lib/ui/enumLabel";
import { Banner } from "@/components/ds/Banner";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { ShareModal } from "@/app/(dashboard)/campaigns/ShareModal";
import { ExternalLink, RefreshCw, Eye, Heart, MessageCircle, Share2, Download, Bookmark, TrendingUp, Flag, Lock, Activity, ShieldAlert, Shield, Play, Users, History } from "lucide-react";
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
import { stripAt, formatDateAbs, formatDateTimeAbs, formatFull, platformLabel } from "@/lib/format";
import { MIN_SNAPSHOTS } from "@/lib/fraud/botSignals";
import { loadCharts } from "@/components/charts/lazyCharts";
import { readCadenceLabel, DEFAULT_POST_TRACKING } from "@/lib/trackers/granularity";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { useCampaignNav } from "@/components/providers/CampaignNavProvider";
import { useConfirm } from "@/components/ds/ConfirmDialog";
import { removeConfirmText, removePostsSummary, removePostsUndoHint, restorePostsSummary } from "@/lib/posts/bulkActions";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { RotateCcw } from "lucide-react";
import { SeriesModeToggle } from "@/components/charts/SeriesModeToggle";
import type { SeriesMode } from "@/lib/charts/seriesMode";
import { CHART_BUCKET_HOURS, CHART_GRANULARITIES, type ChartGranularity } from "@/lib/trackers/granularity";

const TRACK_PERIOD_LABEL: Record<ChartGranularity, string> = { "6hourly": "Per 6h", daily: "Daily", weekly: "Weekly" };

const PerformanceOverTimeArea = dynamic(() => loadCharts().then((m) => m.PerformanceOverTimeArea), {
  ssr: false,
  loading: () => <Skeleton width="100%" height={300} />,
});

const TrackingLine = dynamic(() => loadCharts().then((m) => m.TrackingLine), {
  ssr: false,
  loading: () => <Skeleton width="100%" height={280} />,
});

type PostDetail = {
  id: string;
  platform: string;
  platformPostId: string;
  postUrl: string;
  thumbnailUrl: string | null;
  /** Our own copy of the picture (lib/posts/thumbnailStore), when there is one. */
  storedThumbnail?: string | null;
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
  /** Set when the post was removed from this campaign (a soft remove). */
  removedAt?: string | null;
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
  if (source === "campaign") return `Read ${cadence} while live`;
  if (source === "new-post") return `First 30 days · read ${cadence}, ${remaining}`;
  if (source === "final-read") return "One final reading left";
  return `Read ${cadence}, ${remaining}`;
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

const SEVERITY_TONE: Record<BotSignal["severity"], StatusTone> = {
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "info",
};

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
  { key: "viewsCount", field: "views", label: "Views", icon: Eye },
  { key: "likesCount", field: "likes", label: "Likes", icon: Heart },
  { key: "commentsCount", field: "comments", label: "Comments", icon: MessageCircle },
  { key: "sharesCount", field: "shares", label: "Shares", icon: Share2 },
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
  const [shareOpen, setShareOpen] = useState(false);
  const [timeseries, setTimeseries] = useState<Timeseries | null>(null);
  const [perfMode, setPerfMode] = useState<SeriesMode>("cumulative");
  const [trackMode, setTrackMode] = useState<SeriesMode>("cumulative");
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
        setSyncNote(body.message ?? body.error ?? "Could not sync this post.");
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

  /* Remove from campaign (walkthrough F2): the same confirmed DELETE the Posts
     tab's menu and bulk bar use, then back to the campaign's posts. The remove
     is soft, so the toast's Undo restores the post and comes back here. */
  const confirm = useConfirm();
  const [removing, setRemoving] = useState(false);
  const handleRemove = async () => {
    if (
      !(await confirm({
        verb: "remove",
        subject: post ? `${post.creator.name || `@${stripAt(post.creator.handle)}`}'s ${platformLabel(post.platform)} post` : "this post",
        /* A soft remove: keep the sentence about getting it back rather than
           the default "can't be undone". */
        description: removeConfirmText(1).description,
        confirmLabel: "Remove post",
        tone: "danger",
      }))
    )
      return;
    setRemoving(true);
    setSyncNote(null);
    try {
      const res = await fetch(`/api/campaigns/${params.id}/posts`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds: [params.postId] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncNote(body.error ?? "Could not remove this post.");
        return;
      }
      toast.success(removePostsSummary(1), {
        description: removePostsUndoHint(1),
        duration: 10_000,
        action: { label: "Undo", onClick: () => void handleRestore(true, railCounts) },
      });
      router.push(`/campaigns/${params.id}?section=posts`);
    } catch {
      setSyncNote("Could not remove this post.");
    } finally {
      setRemoving(false);
    }
  };

  /* Put a removed post back: the toast's Undo (which has already left this
     page, so it navigates back) or the Restore button a removed post shows.
     The rail's counts are the campaign page's, which is not mounted to
     recount: an Undo puts back the counts from just before the remove, and a
     Restore here adds this one post back. */
  const [restoring, setRestoring] = useState(false);
  const handleRestore = async (fromUndo = false, countsBeforeRemove = railCounts) => {
    setRestoring(true);
    setSyncNote(null);
    try {
      const res = await fetch(`/api/campaigns/${params.id}/posts/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds: [params.postId] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = body.message ?? body.error ?? "Could not restore this post.";
        if (fromUndo) toast.error(message);
        else setSyncNote(message);
        return;
      }
      toast.success(restorePostsSummary(1));
      if (fromUndo) {
        publishRail({ title: railTitle, counts: countsBeforeRemove });
        router.push(`/campaigns/${params.id}/posts/${params.postId}`);
      } else {
        if (typeof railCounts.posts === "number") publishRail({ title: railTitle, counts: { ...railCounts, posts: railCounts.posts + 1 } });
        await fetchPost();
      }
    } catch {
      if (fromUndo) toast.error("Could not restore this post.");
      else setSyncNote("Could not restore this post.");
    } finally {
      setRestoring(false);
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
    /* Shaped like the page: header band, the tile row, then a chart card. */
    return (
      <div className="rsp-page" aria-busy="true">
        <div className="cc-postpage-body">
          <Skeleton width={320} height={32} />
          <TileGridSkeleton count={5} />
          <Skeleton width="100%" height={300} radius="var(--cc-r-card)" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rsp-page">
        <LoadError title="This post didn't load" description={error} onRetry={fetchPost} />
        <div style={{ marginTop: 16 }}>
          <Button variant="secondary" onClick={() => router.back()}>Go back</Button>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="rsp-page">
        <NoResults
          title="Post not found"
          description="It may have been deleted, or the link is from another workspace."
        />
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Button variant="secondary" onClick={() => router.back()}>Go back</Button>
        </div>
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
  const thumb = imgSrc(post.storedThumbnail ?? postThumbnailUrl(post), 240, 160);

  /* postEngagementPercent, the one per-post rate: the same number the Posts
     tab card and list, Performance, the share link and the exports print. As a
     fraction here because the tile and the table below multiply by 100. */
  const engRatePct = postEngagementPercent(post);
  const engRate = engRatePct === null ? null : engRatePct / 100;
  const allMetricCards = [...BASE_METRIC_CARDS] as { key: string; field: MetricField; label: string; icon: typeof Eye }[];
  if (post.platform === "INSTAGRAM") {
    allMetricCards.push({ key: "savesCount", field: "saves", label: "Saves", icon: Bookmark });
    /* Reach is the counter instagram_manage_insights uniquely unlocks — no
       other permission, and no unauthorised read, yields it. It had no card
       because it had no value: assemblePostMetrics parsed reach off the
       insights edge and then dropped it before the write, so the column was 0
       on all 18,676 rows. The parser and the writer both had tests; the
       whitelist between them did not.

       Gated on the measured-field list rather than on the number, because the
       legacy zeroes carry a lastSyncedAt from a TikTok-era sync and would
       otherwise read as a measured "reached nobody". */
    allMetricCards.push({ key: "reachCount", field: "reach", label: "Reach", icon: Users });
  }
  if (post.platform === "YOUTUBE") {
    allMetricCards.push({ key: "downloadsCount", field: "downloads", label: "Downloads", icon: Download });
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
  const snapshotRate = (s: Snapshot): string => {
    const views = snapshotMetric(s.viewsCount, s.platformMetrics, "views");
    const likes = snapshotMetric(s.likesCount, s.platformMetrics, "likes");
    const r = views === null || likes === null ? null : computeEngagementRate({
      views,
      likes,
      comments: snapshotMetric(s.commentsCount, s.platformMetrics, "comments"),
      shares: snapshotMetric(s.sharesCount, s.platformMetrics, "shares"),
      saves: s.savesCount,
    });
    return r === null ? "\u2014" : `${(r * 100).toFixed(2)}%`;
  };
  const snapshotColumns: DataTableColumn<Snapshot>[] = [
    { key: "recorded", header: "Recorded", minWidth: 176, render: (s) => formatDateTimeAbs(s.recordedAt) },
    { key: "views", header: "Views", width: 112, align: "right", render: (s) => snapshotCell(s.viewsCount, s.platformMetrics, "views") },
    { key: "likes", header: "Likes", width: 96, align: "right", render: (s) => snapshotCell(s.likesCount, s.platformMetrics, "likes") },
    { key: "comments", header: "Comments", width: 120, align: "right", render: (s) => snapshotCell(s.commentsCount, s.platformMetrics, "comments") },
    /* A YouTube (or non-connected Instagram) reading's 0 shares is a count
       the platform never published -- see sharesPublished. */
    {
      key: "shares", header: "Shares", width: 100, align: "right",
      render: (s) => ((s.sharesCount ?? 0) <= 0 && !sharesPublished(post.platform, s.platformMetrics) ? "\u2014" : snapshotCell(s.sharesCount, s.platformMetrics, "shares")),
    },
    ...(snapshotSaves
      ? [{ key: "saves", header: "Saves", width: 92, align: "right" as const, render: (s: Snapshot) => formatNumber(s.savesCount ?? 0) }]
      : []),
    ...(engRate !== null
      ? [{ key: "eng", header: "Eng %", width: 92, align: "right" as const, render: (s: Snapshot) => snapshotRate(s) }]
      : []),
    { key: "source", header: "Source", width: 128, render: (s) => <StatusBadge tone="neutral">{enumLabel(s.syncSource ?? "system")}</StatusBadge> },
    ...(snapshotSealed
      ? [{
          key: "sealed", header: "Sealed", width: 112,
          render: (s: Snapshot) =>
            s.isFinalSnapshot ? (
              <StatusBadge tone="success">
                <Lock size={12} aria-hidden="true" /> Sealed
              </StatusBadge>
            ) : null,
        }]
      : []),
  ];
  /* "—" with its reason under it for a counter nobody read, never a 0; a
     hidden or deleted post keeps its last real figures. */
  const metricTiles = metricCards.map(({ key, field, label, icon }) => {
    const raw = (post as unknown as Record<string, number>)[key];
    /* Saves and reach on a post with no measured-field list are the column
       default, not a reading: positive or unknown, never 0. */
    const value: MetricValue =
      UNWRITTEN_CARDS.has(key) && measuredFields(post.platformMetrics) === null
        ? (unwrittenMetricValue(raw) ?? unknownMetric(`The platform did not report ${field} for this post.`))
        : postCounterValue(raw, post, field);
    if (metaPost && META_INSIGHT_CARDS.has(key) && isUnknownMetric(value)) {
      return { key, label, icon, value: META_UNAVAILABLE, footer: META_CONNECTED_NOTE as React.ReactNode };
    }
    /* Only a views figure the latest read did not return says when it was
       read; every other figure is from the read dated above the tiles. */
    const footer: React.ReactNode = isUnknownMetric(value)
      ? metricReason(value)
      : field === "views" && viewsNote
        ? <span title={viewsNote.title}>{viewsNote.sentence}</span>
        : undefined;
    return { key, label, icon, value: metricText(value, formatNumber), footer };
  });
  /* One figure size for the whole row: the longest number decides it. A word
     ("Not available") is not a figure and does not shrink the others. */
  const tileFit = metricTiles.reduce((n, t) => (/\d/.test(t.value) ? Math.max(n, t.value.length) : n), 0);

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
  const trackingGranularity: ChartGranularity = (CHART_GRANULARITIES as readonly string[]).includes(timeseries?.chartGranularity ?? "")
    ? (timeseries?.chartGranularity as ChartGranularity)
    : "daily";
  const trackingSeries = (timeseries?.snapshots ?? []).map((s) => ({
    t: new Date(s.recordedAt).getTime(),
    // UTC, like the chart above; this was the viewer's zone with no zone named.
    ts: `${new Date(s.recordedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", timeZone: "UTC" })} UTC`,
    views: s.viewsCount,
    engagement: s.likesCount === null && s.commentsCount === null ? null : (s.likesCount ?? 0) + (s.commentsCount ?? 0),
  }));

  return (
    <div className="rsp-page">
      {/* One main action (View post), one labelled secondary (Sync now, or
          Restore while the post is removed), then the menu with Remove last
          under its rule. The page runs the content column's full width, as
          every other page does; a 1200px cap stopped the header band short
          of the top bar's right edge on a wide screen. Back is a link to the campaign's Posts section,
          not history.back(): a deep-linked visitor's history is another
          site. */}
      <PageHeader
        title={post.caption?.slice(0, 80) ?? "Untitled Post"}
        back={{ href: `/campaigns/${params.id}?section=posts`, label: "Posts" }}
        leading={
          thumb ? (
            embedSrc ? (
              <button type="button" className="cc-page-thumb" data-shape="wide" onClick={() => setPlaying(true)} aria-label="Play post">
                <img src={thumb} alt="" />
                <span className="cc-page-thumb-play" aria-hidden="true">
                  <Play size={14} color="var(--cc-overlay-ink-text)" fill="var(--cc-overlay-ink-text)" />
                </span>
              </button>
            ) : (
              <div className="cc-page-thumb" data-shape="wide">
                <img src={thumb} alt="" />
              </div>
            )
          ) : undefined
        }
        badges={
          <>
            <StatusBadge status={post.status} dot />
            {/* Beside the status: every metric card below stays put -- they
                are the post's last real numbers. */}
            <PostStatusChip status={status} showLive />
          </>
        }
        meta={
          <>
            <span className="cc-page-meta-line">
              <CreatorAvatar id={post.creator.id} name={post.creator.name} size="sm" />
              <span>
                by <strong>{post.creator.name}</strong>
                {stripAt(post.creator.handle) ? ` (@${stripAt(post.creator.handle)})` : ""}
              </span>
            </span>
            <span>{platformLabel(post.platform)}</span>
            <span>Posted {formatDateAbs(post.postedAt)}</span>
          </>
        }
        actions={
          <>
            {post.removedAt ? (
              <Button variant="secondary" iconLeft={<RotateCcw size={16} />} onClick={() => void handleRestore()} loading={restoring}>
                Restore to campaign
              </Button>
            ) : (
              <Button variant="secondary" iconLeft={<RefreshCw size={16} />} onClick={handleSync} loading={syncing}>
                Sync now
              </Button>
            )}
            <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn-primary ui-btn-md" data-cc-slot="primary">
              <ExternalLink size={16} aria-hidden="true" />
              View post
            </a>
            <MoreMenu
              label="More post actions"
              items={[
                /* The campaign's, not the post's: the share link is the
                   campaign report. */
                { label: "Share campaign", icon: <Share2 size={16} />, onClick: () => setShareOpen(true) },
                {
                  label: flagged ? "Flagged as suspicious" : "Flag as suspicious",
                  icon: <Flag size={16} />,
                  onClick: () => void handleFlag(),
                  disabled: flagged || flagging,
                },
                ...(post.removedAt
                  ? []
                  : [{ label: "Remove post", icon: <Trash2 size={16} />, danger: true, onClick: () => void handleRemove(), disabled: removing }]),
              ]}
            />
          </>
        }
      />
      {shareOpen && (
        <ShareModal campaignId={params.id} campaignTitle={post.campaignTitle} onClose={() => setShareOpen(false)} />
      )}

      {post.removedAt && (
        <Banner tone="warning" style={{ marginBottom: 24 }}>
          Removed from this campaign on {formatDateTimeAbs(post.removedAt)}. It doesn&apos;t count toward the campaign&apos;s totals and isn&apos;t synced until you restore it.
        </Banner>
      )}

      {/* How fresh the figures below are, right above them. */}
      <div style={{ marginBottom: 12 }}>
        {post.lastSyncedAt ? (
          <p style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)", margin: 0 }}>
            Last synced: {formatDateTimeAbs(post.lastSyncedAt)}
            <AgeLabel at={post.lastSyncedAt} field="post" ctx={postAgeContext({ postedAt: post.postedAt, trackingEnabled: timeseries?.trackingEnabled, trackingExpiresAt: timeseries?.trackingExpiresAt }, status)} source={measured.source} />
          </p>
        ) : measured.at ? (
          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)", margin: 0 }}>
            Not read by us yet. The figures below were imported, as of {formatDateTimeAbs(measured.at)}.{" "}
            <AgeLabel at={measured.at} field="post" ctx={postAgeContext({ postedAt: post.postedAt, trackingEnabled: timeseries?.trackingEnabled, trackingExpiresAt: timeseries?.trackingExpiresAt }, status)} source={measured.source} />
          </p>
        ) : [post.viewsCount, post.likesCount, post.commentsCount, post.sharesCount, post.savesCount].some((n) => (n ?? 0) > 0) ? (
          /* Figures on file that no read of ours produced and no import
             dated: say where they came from, as the creator page does
             ("Unverified · not read by us yet"), rather than "never synced"
             above real counts. */
          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)", margin: 0 }}>
            Imported figures · not read by us yet · {TIME_NOT_RECORDED}
          </p>
        ) : (
          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)", margin: 0 }}>
            Not read by us yet — the counts below are unknown, not zero.
          </p>
        )}
        {syncNote && (
          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "4px 0 0" }}>{syncNote}</p>
        )}
      </div>

      <div className="cc-postpage-body">
      {playing && embedSrc && (
        <Card variant="solid" noPadding style={{ overflow: "hidden" }}>
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

      {/* The shared tile: one inset, one label size, one figure size across the
          row (fitTo), muted icons. A counter nobody read shows "—" and says
          why under it, rather than only in a tooltip. */}
      <div className="cc-tiles-balanced">
        {metricTiles.map((t) => (
          <MetricTile key={t.key} label={t.label} icon={t.icon} value={t.value} footer={t.footer} fitTo={tileFit} />
        ))}
        {engRate !== null && (
          <MetricTile
            label="Engagement rate"
            icon={TrendingUp}
            what="How actively people responded to this post rather than scrolling past."
            how="Likes plus comments plus shares plus saves, divided by views."
            value={`${(engRate * 100).toFixed(2)}%`}
            fitTo={tileFit}
          />
        )}
      </div>

      {/* Facebook only. Instagram comment bodies need
          instagram_business_manage_comments, which this app has not requested,
          and TikTok publishes no comments API — so the panel is absent rather
          than present-and-broken on those platforms. */}
      {post.platform === "FACEBOOK" && (
        <SectionCard
          icon={MessageCircle}
          title="Comments on this post"
          description="Read live from the creator's Facebook Page when you ask for them. Comments are shown here and never saved; reload and they are read again."
          action={
            <Button variant="secondary" size="sm" onClick={loadComments} loading={commentsLoading}>
              {commentsLoading ? "Reading…" : comments ? "Read again" : "Show comments"}
            </Button>
          }
        >
          {commentsError && (
            <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-danger)", margin: 0 }}>{commentsError}</p>
          )}
          {!comments && !commentsError && (
            <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>Nothing read yet.</p>
          )}

          {comments && (
            <div>
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
        </SectionCard>
      )}

      {chartData.length > 1 && (
        <SectionCard
          className={trackingSeries.length > 1 ? "cc-phone-hide" : undefined}
          icon={TrendingUp}
          title="Performance over time"
          action={<SeriesModeToggle label="Performance over time" value={perfMode} onChange={setPerfMode} />}
        >
          <PerformanceOverTimeArea data={chartData} mode={perfMode} />
        </SectionCard>
      )}

      <SectionCard
        icon={Activity}
        title="Tracking"
        description={
          trackingEnabled
            ? trackingSummary(
                timeseries?.trackingSource ?? null,
                readCadenceLabel(timeseries?.readCadence ?? DEFAULT_POST_TRACKING.readCadence),
                formatRemaining(timeseries?.hoursRemaining ?? null),
              )
            : /* Named for this post's own platform: every platform we read
                 answers with today's lifetime totals only. */
              `Tracking off. ${platformLabel(post.platform) || "The platform"} only reports a post's lifetime totals, not their history, so turn tracking on to record how they change over time.`
        }
        action={
          <div className="cc-postpage-track">
            {!trackingEnabled && (
              /* Every post tracker carries an expiry, so this is a required
                 choice presented as a default; there is no "forever". */
              <>
                <span className="cc-postpage-track-label">Track for</span>
                <Dropdown
                  ariaLabel="Tracking window"
                  size="sm"
                  align="right"
                  minWidth={104}
                  value={String(ttlDays)}
                  onChange={(v) => setTtlDays(Number(v))}
                  disabled={trackToggling}
                  options={TTL_CHOICES.map((d) => ({ value: String(d), label: `${d} day${d === 1 ? "" : "s"}` }))}
                />
              </>
            )}
            <Button
              variant={trackingEnabled ? "secondary" : "primary"}
              size="sm"
              onClick={handleToggleTracking}
              loading={trackToggling}
              disabled={Boolean(post.removedAt)}
            >
              {trackingEnabled ? "Untrack" : "Track"}
            </Button>
          </div>
        }
      >
        <div className="cc-postpage-stack">
        {trackingEnabled && timeseries?.trackingExpiresAt && (timeseries.trackingSource ?? "tracker") === "tracker" && (
          <p className="cc-postpage-note">
            Stops on {formatDateAbs(timeseries.trackingExpiresAt)} and seals
            its final numbers. Tracked posts are unlimited because each one expires.
          </p>
        )}

        {trackingSeries.length > 1 && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <SeriesModeToggle
                label="Tracking chart"
                value={trackMode}
                onChange={setTrackMode}
                periodLabel={TRACK_PERIOD_LABEL[trackingGranularity]}
              />
            </div>
            <TrackingLine data={trackingSeries} mode={trackMode} bucketHours={CHART_BUCKET_HOURS[trackingGranularity]} />
          </div>
        )}
        {trackingSeries.length <= 1 && trackingEnabled && (
          <p className="cc-postpage-note">
            Collecting snapshots. The time series appears once at least two have been recorded.
          </p>
        )}
        {trackingSeries.length <= 1 && !trackingEnabled && (timeseries?.snapshots?.length ?? 0) < MIN_SNAPSHOTS && (
          <p className="cc-postpage-note">No tracking history for this post.</p>
        )}

        {/* The heuristics need MIN_SNAPSHOTS readings and return nothing below
            that, so "No bot signals detected" on a post with one reading claimed
            a check that never ran. The section waits until it has. */}
        {(timeseries?.snapshots?.length ?? 0) >= MIN_SNAPSHOTS && (
        <div className="cc-postpage-signals">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <ShieldAlert size={16} aria-hidden="true" color={botSignals.length > 0 ? "var(--cc-danger-fg)" : "var(--cc-text-muted)"} />
            <h3 style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", margin: 0 }}>Bot signals</h3>
          </div>
          {botSignals.length === 0 ? (
            <NoResults
              icon={<Shield size={32} strokeWidth={1.75} />}
              title="No bot signals detected"
              description={null}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {botSignals.map((s, i) => (
                <div key={`${s.type}-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 12, borderRadius: "var(--cc-r-control)", border: "1px solid var(--cc-border)", background: "var(--cc-bg)" }}>
                  <StatusBadge tone={SEVERITY_TONE[s.severity]}>{enumLabel(s.severity)}</StatusBadge>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{SIGNAL_LABEL[s.type]}</div>
                    <div style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", marginTop: 2 }}>{s.detail}</div>
                    <div style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-subtle)", marginTop: 4 }}>Detected {formatDateTimeAbs(s.at)}</div>
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: 0 }}>
                  These signals are advisory. Flagging a post routes it into the existing fraud review queue.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Flag size={16} />}
                  onClick={() => handleFlagFromSignal(botSignals[0])}
                  loading={flagging}
                  disabled={flagged}
                >
                  {flagged ? "Flagged" : "Flag post"}
                </Button>
              </div>
            </div>
          )}
        </div>
        )}
        </div>
      </SectionCard>

      {/* While tracking is on, the Tracking card already says snapshots are
          being collected, so an empty table under it would say it twice. */}
      {(post.snapshots.length > 0 || !trackingEnabled) && (
        <SectionCard icon={History} title="Metric snapshots" padded={false}>
          <DataTable
            bare
            caption="Metric snapshots"
            columns={snapshotColumns}
            rows={post.snapshots}
            rowKey={(s) => s.id}
            empty={
              <NoResults
                icon={<Activity size={32} strokeWidth={1.75} />}
                title="No metric snapshots yet"
                description="Sync this post to start recording its history."
              />
            }
          />
        </SectionCard>
      )}
      </div>
    </div>
  );
}
