"use client";

import React from "react";
import Link from "next/link";
import { useState, useEffect, useMemo, useCallback, useDeferredValue, useRef } from "react";
import { Card, Badge, EmptyState, Textarea } from "@pratham7711/ui";
import { Modal } from "@/components/ds/Modal";
import {
  Dropdown,
  StatusTabs,
  Pagination,
  Button,
  Banner,
  LoadError,
  ListToolbar,
  DataTable,
  NoResults,
  ViewToggle,
  StatusBadge,
  PlatformTag,
  MetricTile,
  MoreMenu,
  FilterDrawer,
  FilterButton,
  Skeleton,
  type DataTableColumn,
  type FilterDef,
  type FilterValues,
} from "@/components/ds";
import { TileGridSkeleton, ListToolbarSkeleton } from "@/components/ui/PageSkeleton";
import type { MetricKey } from "@/lib/metric-definitions";
import { Grid3X3, List, ListPlus, Plus, Check, X, XCircle, TrendingUp, BarChart3, Flag, Video, AlertTriangle, RefreshCw, Info, Radio, ExternalLink, MoreHorizontal } from "lucide-react";
import { stripAt, formatDateAbs, formatFull } from "@/lib/format";
import type { ComplianceFlag } from "@/lib/compliance/postCompliance";
import PostMedia from "@/components/PostMedia";
import { unwrittenMetricValue, fieldMetricValue, summarizePostMetrics, sharesUnknownReason, type MetricField } from "@/lib/metricDisplay";
import { asOfCaption, dataAsOf } from "@/lib/dataAge";
import { postAgeContext, postMeasuredAt, postStatus } from "@/lib/posts/postStatus";
import { viewsAsOf } from "@/lib/posts/fieldFreshness";
import PostStatusChip from "@/components/posts/PostStatusChip";
import { AgeLabel } from "@/components/ds/AgeLabel";
import { enumLabel } from "@/lib/ui/enumLabel";
import PostGridCard from "@/components/posts/PostGridCard";
import { engRatePct, trackingLabel } from "@/lib/posts/postDisplay";
import { summariseRefresh, type RefreshResult } from "@/lib/refreshSummary";
import { toast } from "sonner";
import { CampaignHeaderActions } from "@/components/campaigns/CampaignHeaderActions";
import { action } from "@/lib/ui/actions";
import { detectPlatform } from "@/lib/platforms/postUrl";
import { MAX_BULK_POSTS, mergePastedEntries, parsePastedPostEntries, pastedUrlLabel } from "@/lib/posts/pastedUrls";
import {
  SETTLE_POLL_DELAYS_MS,
  addProgressText,
  addRunReasonsText,
  addRunSummaryText,
  platformLanes,
  runInLanes,
  settleVerdict,
  summariseAddRun,
  unansweredRowMessage,
  verdictFromPostList,
  verdictFromPrecheck,
  type AddProgress,
  type AddRowOutcome,
  type SaveVerdict,
  type UnansweredKind,
} from "@/lib/posts/bulkAdd";
import { MAX_BULK_ACTION_POSTS, removeConfirmText, removePostsSummary, type BulkAction } from "@/lib/posts/bulkActions";
import { useConfirm } from "@/components/ds/ConfirmDialog";
import { Trash2 } from "lucide-react";
import { RotateCcw } from "lucide-react";
import { removePostsUndoHint, restorePostsSummary } from "@/lib/posts/bulkActions";
import PostActionMenu, { type PostMenuItem } from "@/components/posts/PostActionMenu";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { platformFromHost, detectPlatformFromUrl, platformLabel } from "@/lib/platforms/registry";
import CreatorName from "@/components/creators/CreatorName";
import { creatorNameText } from "@/lib/creators/creatorName";
import { UNKNOWN_CREATOR_LABEL, isUnattributedCreator, unknownCreatorReason } from "@/lib/posts/unattributedName";
import { isPostNotPublic, mayBeAgeLimited } from "@/lib/postRemoval";
import UnknownCreator from "@/components/posts/UnknownCreator";
import { ViewCheckDialog } from "@/components/posts/ViewCheckDialog";
import { PostAnnotationChips } from "@/components/posts/PostAnnotationChips";
import type { PostAnnotationView } from "@/lib/posts/annotations";
import { SHOW_MONEY } from "@/lib/moneyUi";
import { noun } from "@/lib/ui/noun";

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
  platformMetrics?: unknown;
  engagementRate: number;
  status: string;
  fetchState: string | null; // LIVE / UNAVAILABLE / ERROR — is the post still up
  rejectionReason: string | null;
  trackingEnabled?: boolean;
  trackingExpiresAt?: string | null;
  /** Why it is read: "tracker", "campaign", "new-post" or "final-read". */
  trackingSource?: string | null;
  lastSyncedAt: string | null;
  /** CreatorCore's last refresh, for an imported post we have not read. */
  lastFreshAt?: string | null;
  /** When views were last read; shown beside a figure the latest read lacked. */
  viewsReadAt?: string | null;
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
  { key: "ALL", label: "All" },
  { key: "PENDING_REVIEW", label: "Pending review" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
];

/* Not a review status: the posts taken out of the campaign with Remove from
   campaign, kept so they can be restored (lib/posts/removed). It sits with the
   status pills because it is the same question -- which posts am I looking at
   -- but the server answers it from removedAt, not from status. */
const REMOVED_FILTER = "REMOVED";

const PLATFORM_FILTERS = ["ALL", "TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;
const MEDIA_TYPE_FILTERS = ["ALL", "REEL", "STORY", "POST", "SHORT"] as const;

/** What the server knows about one pasted link, from the precheck route. */
type PostCheck = {
  url: string;
  platform: string | null;
  handle: string | null;
  /** "url" when the link named them, "platform" when the platform was asked,
   *  "record" when the org already files this same post under a creator. */
  handleSource: "url" | "platform" | "record" | null;
  authorName: string | null;
  creator: { id: string; name: string; handle: string } | null;
  creatorWillBeAdded: boolean;
  /** Nobody can be named; the post is filed under the org's Unattributed row. */
  willBeUnattributed?: boolean;
  inThisCampaign: { id: string; campaignId: string; campaignName: string } | null;
  inOtherCampaigns: { id: string; campaignId: string; campaignName: string }[];
};

type AddRow = {
  url: string;
  /** platform:id -- what makes two links the same post despite different query strings. */
  key: string;
  /** An earlier row in this same paste is the same post. */
  repeatOfPaste: boolean;
  /* No creator field: who posted it is always the server's to detect -- from
     the link, the platform, or the org's own copy of the post -- and never
     taken from the operator. Pratham: "creators should be automatically
     detected and added never taken from the user". */
  /** Blank means auto-detect. */
  mediaType: string;
  /** "checking": the add got no answer, and the server is being asked whether
   *  it saved the post anyway. See lib/posts/bulkAdd. */
  state: "idle" | "saving" | "checking" | "done" | "failed";
  /** How a done row got there: added by its own request, confirmed saved after
   *  the request went unanswered, or refused because the campaign holds it. */
  doneAs?: "added" | "late" | "already";
  error?: string;
  /** Undefined until the precheck for this link comes back. */
  check?: PostCheck;
};

/**
 * The one thing standing between a row and being submitted, or null.
 *
 * A "blocking" row is a rejection we can already see, so it is left out of the
 * submit rather than discovered mid-batch -- the rest of the paste still goes
 * (see addSubmittable). Non-blocking problems are notes: the row is added and
 * says why it is worth a second look.
 */
function addRowProblem(
  row: AddRow,
): { blocking: boolean; message: string } | null {
  if (row.state === "done") return null;
  /* Marked, not blocking. The submit loop skips it, so a messy paste with one
     line doubled still goes through -- holding the whole batch hostage to a
     row we already know to ignore is friction with nothing behind it. */
  if (row.repeatOfPaste) {
    return { blocking: false, message: "Same post pasted twice — this copy is skipped." };
  }
  /* Three different failures used to share one message, and none of them was
     the message: the row fell through to the creator complaint below, which
     asked an operator to pick a creator for an example.com URL and then let it
     save as a post nothing could ever read.

     The registry is consulted here rather than the detector, on purpose. The
     registry knows about platforms the Add Post path cannot track yet, so
     detectPlatformFromUrl matches a real tweet that detectPlatform returns
     null for — and telling somebody their valid X link has no post id in it
     would be a lie.

     Decided here from the link itself, not only once the precheck answers:
     the add route runs the same detectPlatform and refuses whatever it cannot
     place, so a row it would refuse is skipped from the start rather than
     sent, refused, and offered a creator picker on the way (walkthrough R2).
     Every such row leads with the same words so a skipped link reads the same
     whatever was wrong with it. */
  if (!detectPlatform(row.url) || (row.check && !row.check.platform)) {
    const namesAPost = detectPlatformFromUrl(row.url);
    if (namesAPost) {
      return {
        blocking: true,
        message: `Not a supported post link — ${platformLabel(namesAPost.platform)} posts can\u2019t be tracked yet.`,
      };
    }
    const known = platformFromHost(row.url);
    return {
      blocking: true,
      message: known
        ? `Not a supported post link — that\u2019s a ${known.label} link with no post id in it.`
        : "Not a supported post link.",
    };
  }
  if (row.check?.inThisCampaign) {
    return { blocking: true, message: "Already in this campaign." };
  }
  /* A post another campaign already tracks is not a problem at all -- it is
     added, and the row says so in a note rather than a refusal. Only the same
     post twice in THIS campaign double-counts anything. */
  /* Not knowing who posted it no longer holds a row back. Adding a post is a
     request to track it; a link nobody can attribute is added under the org's
     Unattributed row for its platform, and the row says so in a note rather
     than a refusal (see lib/posts/unattributedCreator). */
  return null;
}


/**
 * How long one add is given before the row is called failed.
 *
 * A post id that no platform will answer for used to sit in "Adding…" for the
 * 30-60s the upstream read took to give up, and then report "Network error" --
 * which blamed the operator's connection for a link that was simply wrong, and
 * left the rest of the batch waiting behind it. 25s is past the 8s each
 * platform read is given plus the creator profile read on a new handle, so a
 * slow-but-working add still lands; beyond that the row is wrong, not slow.
 *
 * Running out is no longer the verdict, though. A TikTok read queued behind the
 * server's pacer outlives this wait and still saves, so an unanswered row is
 * reconciled with the server before it is called anything (lib/posts/bulkAdd).
 */
const ADD_POST_TIMEOUT_MS = 25_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* A window writes its progress post by post, so a run whose count has not moved
   in longer than one window's 300s ceiling has died with its process. */
const REFRESH_STALL_MS = 6 * 60 * 1000;
/* Later windows land numbers as they go; re-reading the list on every 2s tick
   would be a request per tick for a change most ticks do not have. */
const REFRESH_RELOAD_EVERY_MS = 10_000;

type RefreshRunState = {
  running: null | { runId: string; total: number; completed: number };
  lastRun: null | (RefreshResult & { runId: string });
};

const PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50];

/* What the Filters drawer holds: the filters an operator sets now and then.
   Platform and type stay in the toolbar, where they are used most. */
const DRAWER_FILTERS: FilterDef[] = [
  { type: "numberRange", label: "Views", minKey: "minViews", maxKey: "maxViews" },
  { type: "dateRange", label: "Posted", fromKey: "postedFrom", toKey: "postedTo" },
  {
    type: "multiSelect",
    key: "tracking",
    label: "Tracking",
    options: [
      { value: "TRACKED", label: "Tracked" },
      { value: "UNTRACKED", label: "Not tracked" },
    ],
  },
];

type KpiTile = { key: string; metric?: MetricKey; label?: string; what?: string; how?: string; value: string };

// Whether the post is still live on the platform, independent of approval.
// CreatorCore surfaces this prominently (Unavailable = removed at source), and
// a large share of imported posts are dead, so hiding it would misrepresent them.
//
// UNAVAILABLE is no longer in this table: it now renders as RemovedPostOverlay,
// so the row, the grid card and the post page all carry one wording instead of
// a terse "Unavailable" chip here and a sentence elsewhere. ERROR stays — it is
// a different claim ("we could not look"), not a milder version of this one.
const FETCH_STATE_LABEL: Record<string, string> = {
  ERROR: "Fetch error",
};
const COMPLIANCE_LABEL: Record<string, string> = {
  POSTED_AFTER_DEADLINE: "Late",
  SYNC_DEAD_LETTERED: "Unreachable",
  SYNC_FAILING: "Sync failing",
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
  | "delta";
type SortDir = "asc" | "desc";

function formatNumber(num: number): string {
  return formatFull(num);
}

function deltaViews(post: PostData): number | null {
  const snaps = post.snapshots;
  if (!snaps || snaps.length < 2) return null;
  const previous = snaps[1];
  if (typeof previous.viewsCount !== "number") return null;
  /* A post whose views are unknown holds 0 in the column, and 0 minus its last
     reading printed as a large red loss. */
  const views = fieldMetricValue(post.viewsCount, post.lastSyncedAt, post.platformMetrics, "views");
  if (views === null) return null;
  return views - previous.viewsCount;
}

/* The same ladder the post page offers, so the two controls cannot disagree
   about what a tracking window may be. 30 is the default because it is also
   the maximum: the shorter windows are for a launch you only care about this
   week, not the normal case. */
const BULK_TTL_CHOICES = [1, 3, 7, 14, 30] as const;
const BULK_TTL_DEFAULT = 30;

/* The reject modal asks for a reason and is shared by both paths. A sentinel
   rather than a second piece of state, so there is exactly one answer to "is
   the reject dialog open". No post id can collide with it. */
const BULK_REJECT = "__bulk__";

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
  /* Which list `posts` holds, from the response itself, and how many posts
     are under Removed -- so the Removed pill shows only when there is
     something in it, and a list still in flight never renders under the
     wrong pill. */
  const [postsAreRemoved, setPostsAreRemoved] = useState(false);
  const [removedCount, setRemovedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [trackingFilter, setTrackingFilter] = useState<"ALL" | "TRACKED" | "UNTRACKED">("ALL");
  /* Only the posts with an open view check (lib/fraud/scanPosts). */
  const [checkOnly, setCheckOnly] = useState(false);
  const [viewCheckPostId, setViewCheckPostId] = useState<string | null>(null);
  /* Boost codes, rule notes and exclusion reasons, keyed by post id
     (GET /api/campaigns/[id]/post-annotations). Empty until the table exists. */
  const [annotations, setAnnotations] = useState<Record<string, PostAnnotationView>>({});
  /* Whether this campaign lets a reviewer exclude a checked post with a
     reason (Settings, Post review). Off until the same read says otherwise. */
  const [exclusionsOn, setExclusionsOn] = useState(false);
  const [loadedAtMs] = useState(() => Date.now());
  /* A Set keyed by post id rather than an array of posts: the selection has to
     survive a refetch, a filter change and a page turn, and an id is the only
     part of a post that does. Ids that fall out of the filtered set stay in
     here deliberately -- unticking them because a chip changed would lose work
     the operator did on purpose -- but every action is applied to the
     intersection with what is currently on screen, which `selectedOnPage`
     below is for. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkTtlDays, setBulkTtlDays] = useState(BULK_TTL_DEFAULT);
  const [trackingBusyId, setTrackingBusyId] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [mediaTypeFilter, setMediaTypeFilter] = useState("ALL");
  const [minViews, setMinViews] = useState("");
  const [creatorSearch, setCreatorSearch] = useState("");
  const [postedFrom, setPostedFrom] = useState("");
  const [postedTo, setPostedTo] = useState("");
  /* Most-viewed first by default, in every campaign: the post a team opens
     the tab to look at is the one that is working, and the client report
     already lists them in this order (lib/reports/campaignPerformance). */
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [maxViews, setMaxViews] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [showAddPost, setShowAddPost] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /* One pasted blob, many posts. Operators receive links in batches (a client
     sends the week's ten in one message), and adding them one modal at a time
     was ten round trips through the same three fields.

     The rows are the state and the text is not. `addDraft` holds only what has
     been typed and not yet recognised as a link -- everything the parser claims
     becomes a row, and a row is what the field renders as a chip. */
  const [addDraft, setAddDraft] = useState("");
  const [addRows, setAddRows] = useState<AddRow[]>([]);
  const addDraftRef = useRef<HTMLInputElement>(null);
  /** True while the paste is being checked against the roster and the org's posts. */
  const [checkingUrls, setCheckingUrls] = useState(false);
  /** The paste (addUrlsKey) the last precheck finished for, answered or not. */
  const [precheckSettledKey, setPrecheckSettledKey] = useState<string | null>(null);
  /** Where a submit in flight has got to; null when nothing is being sent. */
  const [addProgress, setAddProgress] = useState<AddProgress | null>(null);
  /** The last submit's receipt, kept on screen while the dialog stays open. */
  const [addSummary, setAddSummary] = useState<{ text: string; reasons: string } | null>(null);

  /* Adds every link the text carries, keeping whatever has already been chosen
     for a link that was already there. The spread matters: two rows for the
     same link must not share one object, or picking a creator on one changes
     both. Answers whether anything was found, so the caller knows whether the
     draft it came from has been consumed. */
  const addLinks = useCallback((text: string) => {
    if (parsePastedPostEntries(text).length === 0) return false;
    setAddRows((prev) => {
      const merged = mergePastedEntries(prev.map((r) => r.url), text);
      return merged.map((entry, i) => {
        const kept = prev[i]?.url === entry.url ? prev[i] : undefined;
        return {
          ...(kept ?? { mediaType: "", state: "idle" as const }),
          url: entry.url,
          key: entry.key,
          repeatOfPaste: entry.duplicate,
        };
      });
    });
    return true;
  }, []);

  /* Removing a link re-decides which of the survivors is a repeat. Filtering
     alone left the second copy of a doubled paste still marked as the repeat of
     a link that was no longer on screen -- and therefore still refusing to be
     submitted, with nothing to point at. */
  const removeAddRow = useCallback((index: number) => {
    setAddRows((prev) => {
      const seen = new Set<string>();
      return prev
        .filter((_, j) => j !== index)
        .map((r) => {
          const repeat = seen.has(r.key);
          seen.add(r.key);
          return { ...r, repeatOfPaste: repeat };
        });
    });
  }, []);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  /** How far a run in flight has got, so the button can say "12 of 88" the way
      the same button does in CreatorCore. Null when nothing is running. */
  const [refreshProgress, setRefreshProgress] = useState<{ completed: number; total: number } | null>(null);
  /** What the last refresh actually managed to fetch. Not an error -- a receipt. */
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  const loadAnnotations = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/post-annotations`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data.annotations === "object") setAnnotations(data.annotations);
      setExclusionsOn(data?.allowExclusions === true);
    } catch {
      /* Notes are extra; the list stands without them. */
    }
  }, [campaignId]);

  const fetchPosts = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (statusFilter === REMOVED_FILTER) params.set("removed", "1");
    else if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (platformFilter !== "ALL") params.set("platform", platformFilter);
    if (mediaTypeFilter !== "ALL") params.set("mediaType", mediaTypeFilter);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/posts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPosts(Array.isArray(data.posts) ? data.posts : []);
        setPostsAreRemoved(data.removed === true);
        void loadAnnotations();
        if (typeof data.removedCount === "number") setRemovedCount(data.removedCount);
      } else {
        setError("Could not load posts. Please try again.");
      }
    } catch {
      setError("Could not load posts. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [campaignId, statusFilter, platformFilter, mediaTypeFilter, loadAnnotations]);

  /* fetchPosts is rebuilt whenever a filter changes. The recovery poller below
     keys on campaignId alone, so it reaches the current one through a ref
     rather than tearing itself down and restarting on every filter change. */
  const fetchPostsRef = useRef(fetchPosts);
  useEffect(() => { fetchPostsRef.current = fetchPosts; }, [fetchPosts]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);
  useEffect(() => { setPage(1); }, [statusFilter, platformFilter, mediaTypeFilter, minViews, maxViews, creatorSearch, postedFrom, postedTo, sortKey, sortDir]);

  /* Pure URL parsing, so it runs as the operator types with no request behind
     it. The server re-derives all of this from the same function -- this copy
     exists to show the answer, never to be the answer. */
  const addDetections = useMemo(
    () => addRows.map((r) => detectPlatform(r.url)),
    [addRows]
  );

  /* Ask the server, once per paste, everything it would have told us one
     rejection at a time: whether each handle resolves to a creator, and which
     campaigns already hold each post. Reads only -- nothing is created here.

     Keyed on the joined URLs rather than on addRows, so choosing a creator or
     ticking "add anyway" does not re-run it. */
  const addUrlsKey = addRows.map((r) => r.url).join("\n");
  useEffect(() => {
    if (!showAddPost) return;
    const urls = addUrlsKey ? addUrlsKey.split("\n") : [];
    if (urls.length === 0) return;
    let cancelled = false;
    /* Debounced: a paste of ten arrives as ten chips in one go, and this asks
       about all of them once rather than ten times. */
    const t = setTimeout(async () => {
      setCheckingUrls(true);
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/posts/precheck`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls }),
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { results: PostCheck[] };
        if (cancelled) return;
        const byUrl = new Map(body.results.map((r) => [r.url, r]));
        setAddRows((prev) => prev.map((r) => ({ ...r, check: byUrl.get(r.url) ?? r.check })));
      } catch {
        /* A failed check is not a failed add: leave the rows unmarked and let
           the server have the final word at submit time, as it always did. */
      } finally {
        if (!cancelled) {
          setCheckingUrls(false);
          setPrecheckSettledKey(urls.join("\n"));
        }
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); setCheckingUrls(false); };
  }, [campaignId, showAddPost, addUrlsKey]);

  const addProblems = useMemo(
    /* The server's handle wins over the URL's: for a link that names
       nobody it is the one the platform answered with. */
    () => addRows.map((r) => addRowProblem(r)),
    [addRows]
  );

  /* The rows that will actually be sent: not already added, not a repeat of an
     earlier line, and not holding a problem we can already see.

     One blocking row used to disable the button for the whole paste, so a batch
     of ten with a single duplicate in it could not be submitted until the
     operator found and deleted that row by hand. The reason the batch was held
     — never half-fail on a rule we could see in advance — is still
     honoured, because a skipped row is skipped visibly: it keeps its red
     reason, it is left out of the button\u2019s count, and the line under the
     button says how many are being left behind. */
  const addSubmittable = addRows.filter(
    (r, i) => r.state !== "done" && !r.repeatOfPaste && !addProblems[i]?.blocking
  );
  const addSkipped = addRows.filter(
    (r, i) => r.state !== "done" && (r.repeatOfPaste || Boolean(addProblems[i]?.blocking))
  );
  const addReady = addSubmittable.length > 0;

  /* Whether the campaign now holds this link, asked of the precheck route --
     the same identity rule the add route's duplicate check uses. Null-safe: a
     request that fails is "unknown", never "absent". */
  const askPrecheck = useCallback(
    async (url: string): Promise<SaveVerdict> => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/posts/precheck`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: [url] }),
        });
        if (!res.ok) return "unknown";
        return verdictFromPrecheck(await res.json(), url);
      } catch {
        return "unknown";
      }
    },
    [campaignId]
  );

  /* The second opinion, asked once before a row is called absent: the post
     list this tab already reads, matched on the exact link. It catches a post
     the precheck cannot -- one whose first read failed is filed under the
     default platform, and the precheck narrows by the link's platform. */
  const askPostList = useCallback(
    async (url: string): Promise<SaveVerdict> => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/posts`);
        if (!res.ok) return "unknown";
        const body = await res.json();
        return verdictFromPostList(Array.isArray(body?.posts) ? body.posts : null, url);
      } catch {
        return "unknown";
      }
    },
    [campaignId]
  );

  const handleAddPosts = async () => {
    const pending = addRows.filter((r) => r.state !== "done");
    if (pending.length === 0) return;
    setSubmitting(true);
    setAddSummary(null);
    try {
      const results: AddRow[] = [...addRows];
      /* The rows sent, and every other row's reason for not being sent, so the
         end summary can account for the whole paste and not only what went. */
      const outcomes = new Map<number, AddRowOutcome>();
      const toSend: number[] = [];
      results.forEach((row, i) => {
        if (row.state === "done") return;
        // A link pasted twice is one post; submitting it twice would only earn
        // the duplicate refusal it was already marked with.
        if (row.repeatOfPaste) {
          outcomes.set(i, { kind: "repeat" });
          return;
        }
        /* A row whose rejection is already on screen. Sending it would only
           fetch the refusal it is already showing, and it must not stop the
           rows queued behind it. */
        const problem = addProblems[i];
        if (problem?.blocking) {
          outcomes.set(i, row.check?.inThisCampaign ? { kind: "already" } : { kind: "failed", reason: problem.message });
          return;
        }
        toSend.push(i);
      });

      /* Sequential per platform, and grouped. Each add triggers a first
         metrics read server side, and firing several at one platform is what
         trips the rate limits the sync path spends its life working around.
         Different platforms run side by side, at most three at once: a TikTok
         read spends none of Instagram's budget, and one after another a mixed
         paste of three took 22.7s where its slowest link took 10s
         (walkthrough A1#4; see runInLanes). Inside a platform it is still one
         link per request, one request at a time, groups of ten with a pause
         between -- see groupIndices for why there is no batch request. */
      const lanes = platformLanes(toSend, (i) => detectPlatform(results[i].url)?.platform);
      let finished = 0;
      let checking = 0;
      const showProgress = () => setAddProgress({ done: finished, total: toSend.length, checking: checking > 0 });
      showProgress();
      await runInLanes(
        lanes,
        async (i) => {
          results[i] = { ...results[i], state: "saving", error: undefined, doneAs: undefined };
          setAddRows([...results]);

          /* Set when the add itself gave no usable answer: no reply in time, no
             connection, or a server error that may have come after the write. */
          let unanswered: { kind: UnansweredKind; serverMessage?: string } | null = null;

          /* Absent keys, not nulls. mediaType is z.enum().optional(), which accepts
             undefined and rejects null, so sending `mediaType: null` for the
             "Auto-detect" option -- the default -- failed validation before it could
             reach the detector. No creatorId is ever sent: its absence is what
             asks the server to detect the creator. */
          try {
            const res = await fetch(`/api/campaigns/${campaignId}/posts`, {
              method: "POST",
              signal: AbortSignal.timeout(ADD_POST_TIMEOUT_MS),
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                postUrl: results[i].url,
                ...(results[i].mediaType ? { mediaType: results[i].mediaType } : {}),
              }),
            });
            if (res.ok) {
              results[i] = { ...results[i], state: "done", doneAs: "added" };
              outcomes.set(i, { kind: "added" });
            } else {
              const body = await res.json().catch(() => null);
              /* message first: it is the sentence written for a person,
                 where error is the machine reason ("duplicate_post"). */
              const message: string = body?.message ?? body?.error ?? `Rejected (${res.status})`;
              if (res.status === 409 && body?.error === "duplicate_post") {
                /* The campaign holds it -- which is where the operator wanted
                   it. Usually a retry of a link whose first add saved after
                   the dialog had stopped waiting, so it is not a failure. */
                results[i] = { ...results[i], state: "done", doneAs: "already" };
                outcomes.set(i, { kind: "already" });
              } else if (res.status >= 500) {
                /* A 5xx can follow the write: the post is created before the
                   audit lines, and either of those throwing answers 500. */
                unanswered = { kind: "server", serverMessage: message };
              } else {
                results[i] = { ...results[i], state: "failed", error: message };
                outcomes.set(i, { kind: "failed", reason: message });
              }
            }
          } catch (err) {
            /* Two different failures used to share "Network error": a request
               that never got an answer, and one the operator's connection had
               nothing to do with. Neither proves the post was not saved. */
            const timedOut = err instanceof DOMException && err.name === "TimeoutError";
            unanswered = { kind: timedOut ? "timeout" : "network" };
          }

          if (unanswered) {
            /* Ask before answering. A server error has finished, so one ask
               settles it; an add with no reply may still be inside its platform
               read, so it is asked about until it could no longer be running --
               and the next link on its platform waits, so the server is never
               working two adds of this batch on one platform at once. */
            results[i] = { ...results[i], state: "checking" };
            setAddRows([...results]);
            checking += 1;
            showProgress();
            const url = results[i].url;
            const verdict = await settleVerdict(() => askPrecheck(url), {
              delays: unanswered.kind === "server" ? [0] : SETTLE_POLL_DELAYS_MS,
              sleep,
              finalCheck: () => askPostList(url),
            });
            if (verdict === "saved") {
              results[i] = { ...results[i], state: "done", doneAs: "late" };
              outcomes.set(i, { kind: "late" });
            } else {
              const error = unansweredRowMessage(unanswered.kind, verdict, {
                timeoutSeconds: ADD_POST_TIMEOUT_MS / 1000,
                serverMessage: unanswered.serverMessage,
              });
              results[i] = { ...results[i], state: "failed", error };
              outcomes.set(i, { kind: "failed", reason: error });
            }
            checking -= 1;
          }
          finished += 1;
          showProgress();
          setAddRows([...results]);
        },
        { sleep },
      );
      setAddProgress(null);

      const summary = summariseAddRun([...outcomes.values()]);
      const failed = results.filter((r) => r.state === "failed");
      /* The campaign's own totals live on the page above this tab -- the
         Posts tab counter among them -- so adding posts has to tell it,
         the same way Refresh Data does. Ten at once made the stale 0
         impossible to miss.

         The list is re-read BEFORE the dialog closes. It used to be fired and
         left, so the dialog shut at once and the tab went on saying "No posts
         yet" for the ~3s the list took to come back -- long enough to read as
         the add having failed (walkthrough F1). */
      if (summary.added > 0) {
        setAddSummary({ text: "Added — updating the post list…", reasons: "" });
        onRefreshed?.();
        await fetchPosts();
      }

      /* A partial batch keeps the dialog open showing only what failed, so the
         eight that worked are not re-submitted to retry the two that did not.
         The receipt goes in the toast either way, and stays on the dialog
         while it is open, so "48 added · 2 already here · 1 not added" is
         readable after the toast has gone. */
      const text = addRunSummaryText(summary);
      const reasons = addRunReasonsText(summary);
      if (failed.length === 0) {
        setShowAddPost(false);
        setAddRows([]);
        setAddDraft("");
        toast.success(
          summary.added === 1 && summary.already + summary.repeats + summary.failedTotal === 0 ? "Post added." : `${text}.`,
          reasons ? { description: reasons } : undefined
        );
      } else {
        setAddSummary({ text, reasons });
        toast.error(summary.added > 0 ? `${text}.` : "None of those could be added.", reasons ? { description: reasons } : undefined);
      }
    } finally {
      setAddProgress(null);
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
    /* One dialog, two callers. The reason box is the whole reason rejection
       cannot be a plain bulk button, so the bulk path borrows this modal
       rather than growing a second one that asks the same question. */
    if (showRejectModal === BULK_REJECT) {
      await runBulkAction("reject");
      setShowRejectModal(null);
      setRejectionReason("");
      return;
    }
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

  /**
   * One post's tracker, from the list.
   *
   * Deliberately the single-post route, not the bulk one, even though the bulk
   * route could do it in a single statement: that route also takes the first
   * reading, so a post tracked from here behaves exactly like a post tracked
   * from its own page. The wait is the cost of that -- a platform round trip --
   * which is what trackingBusyId is for.
   */
  const handleToggleTracking = useCallback(
    async (postId: string, next: boolean) => {
      setTrackingBusyId(postId);
      setRefreshNote(null);
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/posts/${postId}/track`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next ? { enabled: true, ttlDays: bulkTtlDays } : { enabled: false }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(body.error ?? "Could not change tracking for that post.");
          return;
        }
        /* Patched in place rather than refetching the list: a refetch here
           would throw away the scroll position and the selection for a change
           to two fields on one row. */
        const updated = await res.json().catch(() => null);
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  trackingEnabled: updated?.trackingEnabled ?? next,
                  trackingExpiresAt: updated?.trackingExpiresAt ?? null,
                  trackingSource: updated?.trackingSource ?? null,
                }
              : p
          )
        );
      } finally {
        setTrackingBusyId(null);
      }
    },
    [campaignId, bulkTtlDays]
  );

  /**
   * The same action over a selection.
   *
   * Reject is not handled here -- it needs a reason, so it opens the modal that
   * already exists for the single-post case and comes back through
   * `handleReject`.
   */
  const runBulkAction = async (action: BulkAction) => {
    const ids = selectedOnPage;
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/posts/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          postIds: ids,
          ...(action === "track" ? { ttlDays: bulkTtlDays } : {}),
          ...(action === "reject" ? { rejectionReason: rejectionReason || null } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Could not apply that to the selection.");
        return;
      }
      /* The server's own sentence, not one assembled here: it is the only
         party that knows how many rows it actually touched, and for tracking
         it is also the one that knows when the first reading arrives. */
      setRefreshNote(body.message ?? null);
      clearSelection();
      fetchPosts();
    } catch {
      toast.error("Could not apply that to the selection.");
    } finally {
      setBulkBusy(false);
    }
  };

  /* Remove from campaign, for one post or the selection: a mis-pasted link
     used to stay in the post count for good, because nothing could take a
     post out (walkthrough F2). Confirmed first, naming how many. It is a soft
     remove (DELETE /api/campaigns/[id]/posts stamps removedAt and keeps the
     row), so the toast offers Undo and the posts wait under Removed after
     that. The page above is told too, so the header count and the totals
     move with the list. */
  const confirm = useConfirm();
  const removePosts = async (ids: string[]) => {
    if (ids.length === 0) return;
    const text = removeConfirmText(ids.length);
    const one = ids.length === 1 ? posts.find((p) => p.id === ids[0]) : undefined;
    /* A soft remove, so the dialog keeps the sentence about getting it back
       rather than the default "can't be undone". */
    const ok = await confirm(
      one
        ? {
            verb: "remove",
            subject: `${isUnattributedCreator(one.creator) ? "Unattributed" : creatorNameText(one.creator.name, one.creator.handle)}'s ${platformLabel(one.platform)} post`,
            description: text.description,
            confirmLabel: "Remove post",
            tone: "danger",
          }
        : { ...text, verb: "remove", tone: "danger" }
    );
    if (!ok) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/posts`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds: ids }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Could not remove those posts.");
        return;
      }
      /* postIds is what THIS call removed, so Undo cannot bring back a post
         somebody else removed earlier. */
      const removedIds: string[] = Array.isArray(body.postIds) ? body.postIds : ids;
      const removed = typeof body.removed === "number" ? body.removed : removedIds.length;
      if (removed > 0) {
        toast.success(removePostsSummary(removed), {
          description: removePostsUndoHint(removed),
          duration: 10_000,
          action: { label: "Undo", onClick: () => void restorePosts(removedIds) },
        });
      } else {
        toast.info("Already removed from this campaign.");
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      fetchPosts();
      onRefreshed?.();
    } catch {
      toast.error("Could not remove those posts.");
    } finally {
      setBulkBusy(false);
    }
  };

  /* The way back: the toast's Undo right after a remove, and Restore in the
     Removed view (single post or the selection). Reads the list through the
     ref, because Undo runs from a toast that may outlive the filters it was
     raised under. */
  const restorePosts = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/posts/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds: ids }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.message ?? body.error ?? "Could not restore those posts.");
        return;
      }
      const restored = typeof body.restored === "number" ? body.restored : ids.length;
      toast.success(restored > 0 ? restorePostsSummary(restored) : "Already back in this campaign.");
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      fetchPostsRef.current();
      onRefreshed?.();
    } catch {
      toast.error("Could not restore those posts.");
    } finally {
      setBulkBusy(false);
    }
  };

  // One request, server-side: refreshes every post on the campaign and the
  // campaign's tracked sound in the same run. It used to fan out one fetch per
  // post from here and discard every response, so a campaign whose platform was
  // unreachable refreshed nothing and said nothing.
  /* Unmounting ends the wait below; the run itself carries on server-side. */
  const unmountedRef = useRef(false);
  useEffect(() => {
    /* Reset on mount too: StrictMode mounts, unmounts and mounts again. */
    unmountedRef.current = false;
    return () => { unmountedRef.current = true; };
  }, []);

  /**
   * Follows a run past its first window, until it ends.
   *
   * The POST answers when the FIRST window closes. A campaign with posts left
   * over continues in fresh invocations for up to twenty minutes, and those
   * windows used to land with nobody watching: the button stopped, and their
   * numbers showed only after a reload. Returns the run's final tally, or null
   * when it stalled or the page went away.
   */
  const followRun = async (runId: string): Promise<RefreshRunState["lastRun"]> => {
    let lastCompleted = -1;
    let movedAt = Date.now();
    let reloadedAt = Date.now();
    while (!unmountedRef.current) {
      await sleep(2000);
      let state: RefreshRunState;
      try {
        const r = await fetch(`/api/campaigns/${campaignId}/refresh`);
        if (!r.ok) continue;
        state = await r.json();
      } catch {
        continue;
      }
      if (!state.running || state.running.runId !== runId) {
        return state.lastRun?.runId === runId ? state.lastRun : null;
      }
      const { completed, total } = state.running;
      setRefreshProgress({ completed, total });
      if (completed !== lastCompleted) {
        lastCompleted = completed;
        movedAt = Date.now();
        if (Date.now() - reloadedAt >= REFRESH_RELOAD_EVERY_MS) {
          reloadedAt = Date.now();
          fetchPostsRef.current();
        }
      } else if (Date.now() - movedAt > REFRESH_STALL_MS) {
        return null;
      }
    }
    return null;
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    setRefreshNote(null);
    setRefreshProgress(null);

    /* A campaign of eighty posts takes minutes, because the platform requests
       are paced. Without this the button span the whole time with nothing to
       show for it and looked hung; the server writes its progress as it goes,
       so poll it. */
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/campaigns/${campaignId}/refresh`);
        if (!r.ok) return;
        const state = await r.json();
        if (state.running) {
          setRefreshProgress({ completed: state.running.completed, total: state.running.total });
        }
      } catch {
        /* A dropped poll is not worth telling anyone about; the run continues
           on the server either way and the final response is authoritative. */
      }
    }, 2000);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/refresh`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        /* Transient, like CreatorCore's: the button is not broken and will work
           again shortly, so this does not belong in the persistent receipt. */
        toast.error(body.error ?? "Refreshed too recently.");
        return;
      }
      if (!res.ok) {
        setRefreshNote(body.error ?? "Refresh failed.");
        return;
      }
      fetchPosts();
      onRefreshed?.();
      if (body.continuing && typeof body.runId === "string") {
        clearInterval(poll);
        const final = await followRun(body.runId);
        if (unmountedRef.current) return;
        /* The sound is read once, in the first window, so its half of the
           sentence comes from that answer. */
        setRefreshNote(summariseRefresh({ ...(final ?? body), sound: body.sound }));
        fetchPosts();
        onRefreshed?.();
        return;
      }
      setRefreshNote(summariseRefresh(body));
    } finally {
      clearInterval(poll);
      setRefreshingAll(false);
      setRefreshProgress(null);
    }
  };

  /* A run started in another tab -- or before a reload -- is still going on the
     server. Without this the button would offer to start a second one, and the
     cooldown would refuse it for reasons the page never explained.

     This POLLS rather than reading once, because the single read had nothing
     that could ever undo it. It set refreshingAll and the only reset lives in
     handleRefreshAll's finally, which this path never runs -- and Button
     renders `disabled: disabled || loading`, so opening a campaign while a run
     was in flight left Refresh Data spinning and PERMANENTLY unclickable, with
     the "N of M" beside it frozen at whatever that one read happened to see.
     It looked like the button was broken; the POST it would have sent was
     simply never reachable. */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    /* Only keep polling through a failed read once a run is known to exist --
       otherwise a blip on the very first read would start a poller for a run
       that was never there. */
    let sawRun = false;

    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };

    /** True while the server still reports a run in flight. */
    const read = async (): Promise<boolean> => {
      try {
        const r = await fetch(`/api/campaigns/${campaignId}/refresh`);
        if (!r.ok) return sawRun;
        const state = await r.json();
        if (cancelled) return false;
        if (!state.running) return false;
        sawRun = true;
        setRefreshingAll(true);
        setRefreshProgress({ completed: state.running.completed, total: state.running.total });
        return true;
      } catch {
        /* A dropped poll says nothing about the run itself. */
        return sawRun;
      }
    };

    (async () => {
      if (!(await read()) || cancelled) return;
      timer = setInterval(async () => {
        if (await read()) return;
        stop();
        if (cancelled) return;
        setRefreshingAll(false);
        setRefreshProgress(null);
        /* The run that just ended is what moved these numbers. */
        fetchPostsRef.current();
      }, 2000);
    })();

    return () => { cancelled = true; stop(); };
  }, [campaignId]);

  const openAddPost = useCallback(() => {
    /* Reset here rather than on close: a failed batch leaves its rows on screen
       so the operator can read what went wrong, and only reopening clears them.
       Not while a batch is still being sent, though: closing the dialog does
       not stop it, and clearing the rows under a run in flight would hide the
       links it is still adding -- reopening shows the run instead. */
    if (!submitting) {
      setAddDraft("");
      setAddRows([]);
      setAddSummary(null);
    }
    setShowAddPost(true);
  }, [submitting]);

  /* Links pasted anywhere on the tab open Add Posts with them already in it
     (plan §04), so a batch copied from a client's sheet needs no click first.
     A paste into a field or another dialog is that field's, and a paste while
     a batch is being sent is left alone: the run owns the rows until it ends. */
  useEffect(() => {
    if (showAddPost || submitting) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role=dialog]")) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (parsePastedPostEntries(text).length === 0) return;
      e.preventDefault();
      openAddPost();
      addLinks(text);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [showAddPost, submitting, openAddPost, addLinks]);

  /* The two typed filters feed the list through useDeferredValue, so a
     keystroke paints the character first and re-filters afterwards. The inputs
     stay bound to the immediate state -- deferring what a field displays is how
     a text box starts dropping characters -- and only the derived list lags,
     by one frame on a small campaign and by as long as it takes on a large one.
     Everything else here is a click, which cannot outrun a render anyway. */
  const deferredCreatorSearch = useDeferredValue(creatorSearch);
  const deferredMinViews = useDeferredValue(minViews);
  const deferredMaxViews = useDeferredValue(maxViews);

  const filteredSorted = useMemo(() => {
    const minV = parseInt(deferredMinViews, 10);
    const maxV = parseInt(deferredMaxViews, 10);
    const search = deferredCreatorSearch.trim().toLowerCase();
    // Inclusive on both ends: "to" is the end of that day, not midnight at its start.
    const fromMs = postedFrom ? new Date(`${postedFrom}T00:00:00`).getTime() : null;
    const toMs = postedTo ? new Date(`${postedTo}T23:59:59.999`).getTime() : null;
    const rows = posts.filter((p) => {
      /* The status, platform and media-type chips are applied by the server, so
         while a refetch is in flight `posts` still holds the PREVIOUS filter's
         rows -- and nothing sets loading on a refetch, so the list keeps
         rendering posts the chips say are excluded. Re-applying the same three
         predicates here is what makes the rendered set agree with the chips at
         every instant; the server filter stays because it is what keeps the
         payload small. Measured: a slow /posts response left all four camp-1
         posts on screen under a YOUTUBE chip for the whole request. */
      if (postsAreRemoved !== (statusFilter === REMOVED_FILTER)) return false;
      if (statusFilter !== "ALL" && statusFilter !== REMOVED_FILTER && p.status !== statusFilter) return false;
      if (trackingFilter === "TRACKED" && p.trackingEnabled !== true) return false;
      if (trackingFilter === "UNTRACKED" && p.trackingEnabled === true) return false;
      if (checkOnly && !p.hasOpenFraudFlag) return false;
      if (platformFilter !== "ALL" && p.platform !== platformFilter) return false;
      if (mediaTypeFilter !== "ALL" && p.mediaType !== mediaTypeFilter) return false;
      if (Number.isFinite(minV) && p.viewsCount < minV) return false;
      if (Number.isFinite(maxV) && p.viewsCount > maxV) return false;
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

    /* Unknown is not 0: null is a count nobody has read, and it sinks below
       every measured one in either direction -- "Lowest" must not open on the
       posts we know nothing about. */
    const metric = (p: PostData, value: number, field: MetricField) =>
      fieldMetricValue(value, p.lastSyncedAt, p.platformMetrics, field, p.platform);
    const valueOf = (p: PostData): number | null => {
      switch (sortKey) {
        case "posted": return new Date(p.postedAt).getTime() || 0;
        case "views": return metric(p, p.viewsCount, "views");
        case "likes": return metric(p, p.likesCount, "likes");
        case "comments": return metric(p, p.commentsCount, "comments");
        case "shares": return metric(p, p.sharesCount, "shares");
        case "saves": return metric(p, p.savesCount, "saves");
        case "downloads": return p.downloadsCount;
        case "engRate":
          return metric(p, p.likesCount, "likes") === null ? null : engRatePct(p) ?? null;
        case "delta": return deltaViews(p) ?? null;
        default: return 0;
      }
    };

    /* Each key once per row, not twice per comparison: the default sort parsed
       a date on both sides of every one of ~7,700 comparisons for 800 posts,
       on every keystroke in the search box. */
    const keyed = rows.map((p) => [valueOf(p), p] as const);
    keyed.sort((a, b) => {
      if (a[0] === null || b[0] === null) return a[0] === null ? (b[0] === null ? 0 : 1) : -1;
      const diff = a[0] - b[0];
      return sortDir === "asc" ? diff : -diff;
    });
    return keyed.map(([, p]) => p);
  }, [posts, postsAreRemoved, statusFilter, trackingFilter, checkOnly, platformFilter, mediaTypeFilter, deferredMinViews, deferredMaxViews, deferredCreatorSearch, postedFrom, postedTo, sortKey, sortDir]);

  const anyDelta = useMemo(() => posts.some((p) => (p.snapshots?.length ?? 0) >= 2), [posts]);
  /* Imported posts carried view counts only, so likes, comments and engagement
     rate are unknown for all but the ones we fetched ourselves. A column none of
     these posts can fill is not shown at all. */
  const anyLikes = useMemo(
    () => posts.some((p) => fieldMetricValue(p.likesCount, p.lastSyncedAt, p.platformMetrics, "likes") !== null),
    [posts]
  );
  const anyComments = useMemo(
    () => posts.some((p) => fieldMetricValue(p.commentsCount, p.lastSyncedAt, p.platformMetrics, "comments") !== null),
    [posts]
  );
  const anyShares = useMemo(
    () => posts.some((p) => fieldMetricValue(p.sharesCount, p.lastSyncedAt, p.platformMetrics, "shares", p.platform) !== null),
    [posts]
  );
  const anySaves = useMemo(
    () => posts.some((p) => unwrittenMetricValue(p.savesCount) !== null),
    [posts]
  );
  const anyDownloads = useMemo(
    () => posts.some((p) => unwrittenMetricValue(p.downloadsCount) !== null),
    [posts]
  );
  const anyEngRate = useMemo(() => posts.some((p) => engRatePct(p) !== null), [posts]);
  /* Over the filtered set, so the row answers for what is on screen. */
  const kpis = useMemo(() => summarizePostMetrics(filteredSorted), [filteredSorted]);
  /* When the strip's figures were read, and how many posts its views cover --
     the caveat Overview and Performance already print under Total Views. */
  const viewsKnown = useMemo(
    () => filteredSorted.filter((p) => fieldMetricValue(p.viewsCount, p.lastSyncedAt, p.platformMetrics, "views") !== null).length,
    [filteredSorted]
  );
  const kpiAsOf = useMemo(
    () =>
      asOfCaption(dataAsOf(filteredSorted.map((p) => postMeasuredAt(p).at)), {
        known: viewsKnown,
        total: filteredSorted.length,
        what: "views",
      }),
    [filteredSorted, viewsKnown]
  );

  /* The same nine figures the strip always carried, as tiles. Labels come
     from lib/metric-definitions where one exists; the two without one say
     what they add up here. */
  const kpiTiles: KpiTile[] = useMemo(() => {
    const tiles: KpiTile[] = [
      { key: "posts", metric: "totalPosts", value: kpis.posts.toLocaleString() },
      // A dash, not 0, when no post in view has a view count at all.
      { key: "views", metric: "totalViews", value: viewsKnown === 0 && kpis.posts > 0 ? "\u2014" : formatNumber(kpis.views) },
    ];
    const pct = (v: number) => `${v.toFixed(2)}%`;
    if (kpis.avgPostRate !== null)
      tiles.push({
        key: "avgPostRate",
        label: "Avg. post engagement",
        what: "The engagement rate of a typical post in view: each post counts the same, however many views it had.",
        how: "Likes plus comments plus shares plus saves over views, for each measured post, then averaged across those posts.",
        value: pct(kpis.avgPostRate),
      });
    if (kpis.campaignRate !== null)
      tiles.push({ key: "campaignRate", metric: "engagementRate", label: "Campaign engagement rate", value: pct(kpis.campaignRate) });
    if (kpis.engagement !== null)
      tiles.push({
        key: "engagement",
        label: "Total engagement",
        what: "Every deliberate interaction with the posts in view.",
        how: "Adds up likes, comments, shares and saves across the measured posts in view.",
        value: formatNumber(kpis.engagement),
      });
    if (kpis.likes !== null) tiles.push({ key: "likes", metric: "totalLikes", value: formatNumber(kpis.likes) });
    if (kpis.comments !== null) tiles.push({ key: "comments", metric: "totalComments", value: formatNumber(kpis.comments) });
    if (kpis.shares !== null) tiles.push({ key: "shares", metric: "totalShares", value: formatNumber(kpis.shares) });
    /* Saves and downloads behind the same gates as their columns: the sums
       count the 0 every unfetched row holds. */
    if (anySaves && kpis.saves !== null) tiles.push({ key: "saves", metric: "totalSaves", value: formatNumber(kpis.saves) });
    if (anyDownloads && kpis.downloads !== null) tiles.push({ key: "downloads", metric: "totalDownloads", value: formatNumber(kpis.downloads) });
    return tiles;
  }, [kpis, anySaves, anyDownloads, viewsKnown]);
  /* One figure size for the whole block: the longest value decides it. */
  const kpiFit = kpiTiles.reduce((n, t) => Math.max(n, t.value.length), 0);

  const accruedMinor = useMemo(() => {
    if (!marketplace) return 0;
    return posts
      .filter((p) => p.status === "APPROVED")
      .reduce((sum, p) => sum + earnedMinorForPost(p.viewsCount, p.platform, marketplace.ratePerThousand), 0);
  }, [posts, marketplace]);

  const pendingCount = useMemo(() => posts.filter((p) => p.status === "PENDING_REVIEW").length, [posts]);
  const mixedStatuses = useMemo(() => new Set(posts.map((p) => p.status)).size > 1, [posts]);
  const viewCheckCount = useMemo(() => posts.reduce((n, p) => n + (p.hasOpenFraudFlag ? 1 : 0), 0), [posts]);
  const viewCheckPost = viewCheckPostId ? posts.find((p) => p.id === viewCheckPostId) ?? null : null;
  const capMinor = marketplace?.budgetCapMinor ?? null;
  const capFraction = capMinor && capMinor > 0 ? Math.min(1, accruedMinor / capMinor) : null;
  const capReached = capMinor != null && capMinor > 0 && accruedMinor >= capMinor;
  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / pageSize));
  const pageRows = useMemo(
    () => filteredSorted.slice((page - 1) * pageSize, page * pageSize),
    [filteredSorted, page, pageSize]
  );

  /* Every bulk action reads THIS, never selectedIds directly. The set can hold
     ids that a filter has since hidden, and acting on a post the operator
     cannot see is the one thing a bulk control must never do. */
  const selectedOnPage = useMemo(
    () => pageRows.filter((p) => selectedIds.has(p.id)).map((p) => p.id),
    [pageRows, selectedIds]
  );
  const allOnPageSelected = pageRows.length > 0 && selectedOnPage.length === pageRows.length;
  const someOnPageSelected = selectedOnPage.length > 0 && !allOnPageSelected;

  /* useCallback, not an inline arrow: PostGridCard is memoised and a fresh
     function identity on every render would defeat it silently -- the tiles
     would still be correct and would simply stop being skipped. See the
     docblock on that component, and renderDiscipline.test.tsx. */
  const toggleSelect = useCallback((postId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  /* Where the right-click landed, in viewport coordinates. Held here rather
     than in the tile so one menu serves the grid and the list, and so the tile
     stays a pure function of its post -- opening a menu must not re-render the
     other twenty-four. Both callbacks are stable for the same reason. */
  const [menu, setMenu] = useState<{
    postId: string;
    x: number;
    y: number;
    align?: "start" | "end";
    anchor?: HTMLElement | null;
  } | null>(null);
  const openMenu = useCallback((postId: string, x: number, y: number) => setMenu({ postId, x, y }), []);
  /* From a row's ⋯ button: under it, right edges aligned, and focus goes back
     to the button when the menu closes from the keyboard. */
  const openMenuFrom = useCallback((postId: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ postId, x: r.right, y: r.bottom + 4, align: "end", anchor: el });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  /* Stable for the same reason as openMenu: the grid tiles are memoised. */
  const openViewCheck = useCallback((postId: string) => setViewCheckPostId(postId), []);
  const reopenFlags = async (flagIds: string[]) => {
    await Promise.all(
      flagIds.map((id) =>
        fetch(`/api/fraud-flags/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isResolved: false }),
        }).catch(() => null),
      ),
    );
  };
  const viewCheckCleared = useCallback((postId: string) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, hasOpenFraudFlag: false } : p)));
  }, []);

  const toggleSelectAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const ids = pageRows.map((p) => p.id);
      const every = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (every) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [pageRows]);

  /* Which columns can be sorted on this campaign's data -- the same conditions
     the list headers use, so the two controls always offer the same set. A
     column nobody has a number for is not offered rather than offered as a
     column of zeros. */
  const sortFields = useMemo(() => {
    const fields: { key: SortKey; label: string }[] = [
      { key: "posted", label: "Posted" },
      { key: "views", label: "Views" },
    ];
    if (anyLikes) fields.push({ key: "likes", label: "Likes" });
    if (anyComments) fields.push({ key: "comments", label: "Comments" });
    if (anyShares) fields.push({ key: "shares", label: "Shares" });
    if (anySaves) fields.push({ key: "saves", label: "Saves" });
    if (anyDownloads) fields.push({ key: "downloads", label: "Downloads" });
    if (anyEngRate) fields.push({ key: "engRate", label: "Eng %" });
    if (anyDelta) fields.push({ key: "delta", label: "\u0394 Views" });
    return fields;
  }, [anyLikes, anyComments, anyShares, anySaves, anyDownloads, anyEngRate, anyDelta]);

  /* A refresh can fill in a counter nobody had, and in principle take one away.
     Sorting by a column that is no longer offered would leave the control
     showing one thing and the list ordered by another. */
  useEffect(() => {
    if (!sortFields.some((f) => f.key === sortKey)) setSortKey("views");
  }, [sortFields, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const drawerCount =
    (minViews || maxViews ? 1 : 0) + (postedFrom || postedTo ? 1 : 0) + (trackingFilter !== "ALL" ? 1 : 0);
  /* Memoised: the drawer resets its draft whenever this object changes. */
  const drawerValues = useMemo<FilterValues>(
    () => ({
      minViews: minViews || undefined,
      maxViews: maxViews || undefined,
      postedFrom: postedFrom || undefined,
      postedTo: postedTo || undefined,
      tracking: trackingFilter === "ALL" ? undefined : trackingFilter,
    }),
    [minViews, maxViews, postedFrom, postedTo, trackingFilter]
  );
  const applyDrawer = useCallback((next: FilterValues) => {
    setMinViews(next.minViews ?? "");
    setMaxViews(next.maxViews ?? "");
    setPostedFrom(next.postedFrom ?? "");
    setPostedTo(next.postedTo ?? "");
    // Both ticked is the same list as neither.
    const t = (next.tracking ?? "").split(",").filter(Boolean);
    setTrackingFilter(t.length === 1 ? (t[0] as "TRACKED" | "UNTRACKED") : "ALL");
  }, []);

  if (loading) {
    /* Shaped like what loads: the tile block, the one-row toolbar, then the
       poster grid at its real track and gap, so nothing jumps on arrival. */
    return (
      <div className="cc-poststab" aria-busy="true">
        <TileGridSkeleton count={9} />
        <ListToolbarSkeleton filters={5} />
        <div className="cc-poststab-grid" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="cc-poststab-grid-skel" width="100%" height="auto" radius="var(--cc-r-card)" />
          ))}
        </div>
      </div>
    );
  }

  /* What the right-clicked post may have done to it.
   *
   * The rule is the file-manager one: right-clicking something that is part of
   * the current selection acts on the whole selection, right-clicking anything
   * else acts on that post alone. Anything that reads as "open this one thing"
   * -- the analytics page, the platform, a single sync -- is offered only in
   * the single-post case, because there is no sensible batch version of it.
   */
  const menuPost = menu ? pageRows.find((p) => p.id === menu.postId) ?? null : null;
  const menuOnSelection = !!menuPost && selectedIds.has(menuPost.id) && selectedOnPage.length > 1;
  const menuTracked = menuPost?.trackingEnabled === true;
  const mayReview = postApprovalMode === "MANUAL" || !!marketplace;

  /* Under Removed the only thing to do with a post is bring it back (or look
     at it on the platform): every other action writes to a post the campaign
     no longer counts, and the routes refuse them (REMOVED_POST_REFUSAL). */
  const menuItems: PostMenuItem[] = !menuPost
    ? []
    : postsAreRemoved
      ? [
          {
            kind: "head" as const,
            label: menuOnSelection
              ? `${selectedOnPage.length} ${noun(selectedOnPage.length, "post")} selected`
              : isUnattributedCreator(menuPost.creator)
                ? UNKNOWN_CREATOR_LABEL
                : creatorNameText(menuPost.creator.name, menuPost.creator.handle),
          },
          {
            kind: "action" as const,
            label: menuOnSelection ? `Restore ${selectedOnPage.length} posts to campaign` : "Restore to campaign",
            icon: <RotateCcw size={16} />,
            disabled: bulkBusy,
            onSelect: () => restorePosts(menuOnSelection ? selectedOnPage : [menuPost.id]),
          },
          ...(menuOnSelection
            ? []
            : [
                { kind: "sep" as const },
                {
                  kind: "link" as const,
                  label: "Open on platform",
                  icon: <ExternalLink size={16} />,
                  href: menuPost.postUrl,
                  external: true,
                },
              ]),
        ]
      : [
        {
          kind: "head" as const,
          label: menuOnSelection
            ? `${selectedOnPage.length} ${noun(selectedOnPage.length, "post")} selected`
            : isUnattributedCreator(menuPost.creator)
              ? UNKNOWN_CREATOR_LABEL
              : creatorNameText(menuPost.creator.name, menuPost.creator.handle),
        },
        ...(menuOnSelection || !menuTracked
          ? [
              {
                kind: "action" as const,
                label: `Track for ${bulkTtlDays} day${bulkTtlDays === 1 ? "" : "s"}`,
                icon: <Radio size={16} />,
                disabled: !menuOnSelection && trackingBusyId === menuPost.id,
                onSelect: () =>
                  menuOnSelection ? runBulkAction("track") : handleToggleTracking(menuPost.id, true),
              },
            ]
          : []),
        ...(menuOnSelection || menuTracked
          ? [
              {
                kind: "action" as const,
                label: "Stop tracking",
                icon: <Radio size={16} />,
                disabled: !menuOnSelection && trackingBusyId === menuPost.id,
                onSelect: () =>
                  menuOnSelection ? runBulkAction("untrack") : handleToggleTracking(menuPost.id, false),
              },
            ]
          : []),
        ...(mayReview && (menuOnSelection || menuPost.status === "PENDING_REVIEW")
          ? [
              { kind: "sep" as const },
              {
                kind: "action" as const,
                label: "Approve",
                icon: <Check size={16} />,
                onSelect: () => (menuOnSelection ? runBulkAction("approve") : handleApprove(menuPost.id)),
              },
              {
                kind: "action" as const,
                label: "Reject…",
                icon: <X size={16} />,
                danger: true,
                onSelect: () => setShowRejectModal(menuOnSelection ? BULK_REJECT : menuPost.id),
              },
            ]
          : []),
        ...(menuOnSelection
          ? []
          : [
              { kind: "sep" as const },
              {
                kind: "action" as const,
                label: "Sync now",
                icon: <TrendingUp size={16} />,
                disabled: syncingId === menuPost.id,
                onSelect: () => handleSyncNow(menuPost.id),
              },
              {
                kind: "link" as const,
                label: "View analytics",
                icon: <BarChart3 size={16} />,
                href: `/campaigns/${campaignId}/posts/${menuPost.id}`,
              },
              {
                kind: "link" as const,
                label: "Open on platform",
                icon: <ExternalLink size={16} />,
                href: menuPost.postUrl,
                external: true,
              },
              /* Was a button on marketplace rows only; the row's actions live
                 in this menu now. */
              ...(marketplace && !menuPost.hasOpenFraudFlag && menuPost.status !== "REJECTED"
                ? [
                    {
                      kind: "action" as const,
                      label: "Flag as suspicious",
                      icon: <Flag size={16} />,
                      disabled: flaggingId === menuPost.id,
                      onSelect: () => handleFlagSuspicious(menuPost.id),
                    },
                  ]
                : []),
            ]),
        { kind: "sep" as const },
        {
          kind: "action" as const,
          label: menuOnSelection ? `Remove ${selectedOnPage.length} posts from campaign…` : "Remove from campaign…",
          icon: <Trash2 size={16} />,
          danger: true,
          disabled: bulkBusy,
          onSelect: () => removePosts(menuOnSelection ? selectedOnPage : [menuPost.id]),
        },
      ];

  /* Any filter that narrows the list. With one set, an empty list means
     "nothing matches" and offers the way back; with none, it means "nothing
     yet". */
  const narrowed =
    Boolean(creatorSearch.trim()) ||
    platformFilter !== "ALL" ||
    mediaTypeFilter !== "ALL" ||
    drawerCount > 0 ||
    checkOnly;
  const clearFilters = () => {
    setCreatorSearch("");
    setPlatformFilter("ALL");
    setMediaTypeFilter("ALL");
    setMinViews("");
    setMaxViews("");
    setPostedFrom("");
    setPostedTo("");
    setTrackingFilter("ALL");
    setCheckOnly(false);
  };
  const firstRun = posts.length === 0 && !narrowed && statusFilter === "ALL";
  const emptyResult =
    statusFilter === REMOVED_FILTER && !narrowed ? (
      <NoResults
        icon={<RotateCcw size={32} strokeWidth={1.75} />}
        title="No removed posts"
        description="Posts you remove from this campaign wait here, so you can restore them."
      />
    ) : narrowed ? (
      <NoResults onClear={clearFilters} />
    ) : (
      <NoResults
        icon={<Video size={32} strokeWidth={1.75} />}
        title={statusFilter === "PENDING_REVIEW" ? "No posts pending review" : `No ${enumLabel(statusFilter).toLowerCase()} posts`}
        description="Posts move here as they are reviewed."
      />
    );

  const pager = (
    <Pagination
      page={page}
      totalPages={totalPages}
      onPageChange={setPage}
      total={filteredSorted.length}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );

  /* The list. Columns a campaign has no reading for stay hidden, exactly as
     before; the change in views since the previous reading rides under the
     views figure instead of taking a column of its own, and is still a sort
     key in the toolbar. */
  const listColumns: DataTableColumn<PostData>[] = [
    {
      key: "creator",
      header: "Creator",
      minWidth: 208,
      render: (post) => {
        const unknown = isUnattributedCreator(post.creator);
        return (
          <div className="cc-poststab-creator" data-post-id={post.id}>
            <input
              type="checkbox"
              className="cc-poststab-pick"
              checked={selectedIds.has(post.id)}
              onChange={() => toggleSelect(post.id)}
              aria-label={`Select post by ${unknown ? UNKNOWN_CREATOR_LABEL.toLowerCase() : post.creator.name}`}
            />
            <PostMedia
              platform={post.platform}
              platformPostId={post.platformPostId}
              postUrl={post.postUrl}
              thumbnailUrl={post.thumbnailUrl}
              caption={post.caption}
              width={40}
              height={40}
            />
            <span className="cc-poststab-creator-name">
              {unknown ? (
                <UnknownCreator
                  platform={post.platform}
                  notPublic={isPostNotPublic(post)}
                  ageLimitPossible={mayBeAgeLimited(post)}
                />
              ) : (
                /* Out to the platform, like the thumbnail beside it. The post's
                   own page is in the row's ⋯ menu (View analytics). */
                <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="cc-poststab-creator-link">
                  <CreatorName name={post.creator.name} handle={post.creator.handle} />
                </a>
              )}
            </span>
            <PlatformTag platform={post.platform} hideLabel className="cc-poststab-platform" />
          </div>
        );
      },
    },
    {
      key: "posted",
      header: "Posted",
      width: 104,
      sortKey: "posted",
      render: (post) => <span className="cc-poststab-muted">{formatDateAbs(post.postedAt)}</span>,
    },
    {
      key: "views",
      header: "Views",
      width: 104,
      align: "right",
      sortKey: "views",
      render: (post) => {
        /* Per field: a read without views stamps lastSyncedAt too, and a 0
           here would be ours, not the platform's. */
        const views = fieldMetricValue(post.viewsCount, post.lastSyncedAt, post.platformMetrics, "views");
        const note = views === null ? null : viewsAsOf(post);
        const dv = anyDelta ? deltaViews(post) : null;
        return (
          <span title={note?.title}>
            {views === null ? "" : formatNumber(views)}
            {dv !== null && (
              <span className="cc-dt-sub" title="Change since the reading before">
                {`${dv >= 0 ? "+" : ""}${formatNumber(dv)}`}
              </span>
            )}
            {note && <span className="cc-dt-sub cc-poststab-wrap">{note.short}</span>}
          </span>
        );
      },
    },
    ...(anyLikes
      ? [{
          key: "likes", header: "Likes", width: 88, align: "right" as const, sortKey: "likes",
          render: (post: PostData) => {
            const v = fieldMetricValue(post.likesCount, post.lastSyncedAt, post.platformMetrics, "likes");
            return v === null ? "" : formatNumber(v);
          },
        }]
      : []),
    ...(anyComments
      ? [{
          key: "comments", header: "Comments", width: 108, align: "right" as const, sortKey: "comments",
          render: (post: PostData) => {
            const v = fieldMetricValue(post.commentsCount, post.lastSyncedAt, post.platformMetrics, "comments");
            return v === null ? "" : formatNumber(v);
          },
        }]
      : []),
    ...(anyShares
      ? [{
          key: "shares", header: "Shares", width: 92, align: "right" as const, sortKey: "shares",
          render: (post: PostData) => {
            const v = fieldMetricValue(post.sharesCount, post.lastSyncedAt, post.platformMetrics, "shares", post.platform);
            return v === null ? <span title={sharesUnknownReason(post.platform).title}>{"—"}</span> : formatNumber(v);
          },
        }]
      : []),
    ...(anySaves
      ? [{
          key: "saves", header: "Saves", width: 84, align: "right" as const, sortKey: "saves",
          render: (post: PostData) => {
            const v = unwrittenMetricValue(post.savesCount);
            return v === null ? "" : formatNumber(v);
          },
        }]
      : []),
    ...(anyDownloads
      ? [{
          key: "downloads", header: "Downloads", width: 112, align: "right" as const, sortKey: "downloads",
          render: (post: PostData) => {
            const v = unwrittenMetricValue(post.downloadsCount);
            return v === null ? "" : formatNumber(v);
          },
        }]
      : []),
    ...(anyEngRate
      ? [{
          key: "engRate", header: "Eng %", width: 84, align: "right" as const, sortKey: "engRate",
          render: (post: PostData) => {
            const er = engRatePct(post);
            return er === null ? "" : `${er.toFixed(2)}%`;
          },
        }]
      : []),
    {
      key: "status",
      header: "Status",
      width: 148,
      render: (post) => {
        /* One resolver for live / hidden / deleted / unverified, shared with
           the grid card, the post page and the exports. */
        const status = postStatus(post);
        const measured = postMeasuredAt(post);
        return (
          <div className="cc-poststab-status">
            <StatusBadge status={post.status} />
            <span className="cc-poststab-status-line">
              <PostStatusChip status={status} compact showLive />
              {/* The counters' age, with a Stale chip once a tracked post has
                  missed two of its reads (lib/dataAge). */}
              <AgeLabel
                at={measured.at}
                field="post"
                ctx={postAgeContext(post, status)}
                source={measured.source}
                never="Never read"
              />
            </span>
            {post.trackingEnabled === true && (
              <span
                className="cc-poststab-status-line"
                title={trackingLabel(true, post.trackingExpiresAt ?? null, post.trackingSource)}
              >
                <Radio size={12} aria-hidden="true" />
                Tracked
              </span>
            )}
            {post.fetchState && FETCH_STATE_LABEL[post.fetchState] && (
              <StatusBadge tone="warning">{FETCH_STATE_LABEL[post.fetchState]}</StatusBadge>
            )}
            {post.hasOpenFraudFlag && (
              <button
                type="button"
                className="cc-viewcheck-chip"
                onClick={() => openViewCheck(post.id)}
                title="Why this post was flagged, and how to clear it"
              >
                <AlertTriangle size={12} aria-hidden="true" /> Check views
              </button>
            )}
            {(post.complianceFlags ?? []).map((f) => (
              <StatusBadge key={f.code} tone={f.severity === "error" ? "danger" : "warning"} title={f.message}>
                {COMPLIANCE_LABEL[f.code]}
              </StatusBadge>
            ))}
            <PostAnnotationChips annotation={annotations[post.id]} removed={postsAreRemoved} nowMs={loadedAtMs} />
            {marketplace && post.status === "PENDING_REVIEW" && !post.hasOpenFraudFlag && (
              <span className="cc-poststab-status-line">
                Auto-approves in {timeRemaining(post.createdAt, marketplace.autoApproveHours)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      width: postsAreRemoved ? 132 : 96,
      render: (post) =>
        postsAreRemoved ? (
          /* A removed post is only restored from here; reading, tracking or
             approving it would act on a post the campaign no longer counts. */
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<RotateCcw size={16} />}
            onClick={() => restorePosts([post.id])}
            disabled={bulkBusy}
          >
            Restore
          </Button>
        ) : (
          <div className="cc-poststab-rowactions">
          <Link
            href={`/campaigns/${campaignId}/posts/${post.id}`}
            className="cc-more-btn cc-more-btn--inline"
            aria-label={`View analytics for the post by ${isUnattributedCreator(post.creator) ? UNKNOWN_CREATOR_LABEL.toLowerCase() : post.creator.name}`}
            title="View analytics"
          >
            <BarChart3 size={16} aria-hidden="true" />
          </Link>
          <button
            type="button"
            className="cc-more-btn cc-more-btn--inline"
            aria-haspopup="menu"
            aria-expanded={menu?.postId === post.id}
            aria-label={`Actions for the post by ${isUnattributedCreator(post.creator) ? UNKNOWN_CREATOR_LABEL.toLowerCase() : post.creator.name}`}
            title="More actions"
            onClick={(e) => (menu?.postId === post.id ? closeMenu() : openMenuFrom(post.id, e.currentTarget))}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
          </div>
        ),
    },
  ];

  /* Right-click anywhere on a row opens the same menu, as it does on a tile. */
  const onListContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const id = (e.target as Element).closest("tr")?.querySelector<HTMLElement>("[data-post-id]")?.dataset.postId;
    if (!id) return;
    e.preventDefault();
    openMenu(id, e.clientX, e.clientY);
  };

  return (
    <div className="cc-poststab">
      {marketplace && (
        <Card variant="outlined">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: SHOW_MONEY && capMinor ? 12 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{SHOW_MONEY ? "Marketplace budget" : "Marketplace"}</span>
              {SHOW_MONEY && capReached && <StatusBadge tone="danger">Cap reached</StatusBadge>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
                {pendingCount} pending &middot; auto-approve in {marketplace.autoApproveHours}h
              </span>
              {SHOW_MONEY && (
                <span style={{ fontSize: "var(--cc-t-14)", fontWeight: 700, color: "var(--cc-text)" }}>
                  {formatMinor(accruedMinor, marketplace.currency)}
                  {capMinor != null && capMinor > 0 && (
                    <span style={{ color: "var(--cc-text-muted)", fontWeight: 500 }}> / {formatMinor(capMinor, marketplace.currency)}</span>
                  )}
                </span>
              )}
            </div>
          </div>
          {SHOW_MONEY && capMinor != null && capMinor > 0 && capFraction != null && (
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
      {/* Only when the posts are actually in more than one review state. With
          manual approval as the default, every post sits in Pending review
          until someone approves it, and four tabs that all filter to the same
          list are a control for nothing. Kept while a status is picked, so the
          way back to All never disappears. Removed joins them whenever the
          campaign has removed posts -- the way back to a post taken out by
          mistake. */}
      {(statusFilter !== "ALL" || mixedStatuses || removedCount > 0) && (
        <StatusTabs
          ariaLabel="Filter posts by status"
          tabs={[
            ...(mixedStatuses || (statusFilter !== "ALL" && statusFilter !== REMOVED_FILTER) ? STATUS_TABS : STATUS_TABS.slice(0, 1)),
            ...(removedCount > 0 || statusFilter === REMOVED_FILTER
              ? [{ key: REMOVED_FILTER, label: "Removed", count: removedCount }]
              : []),
          ]}
          active={statusFilter}
          onChange={setStatusFilter}
        />
      )}
      {!postsAreRemoved && statusFilter !== REMOVED_FILTER && (viewCheckCount > 0 || checkOnly) && (
        /* Suspicious posts are put in front of the team rather than in a menu:
           one line, only when there is something to check, with the way back
           always on it. */
        <Banner
          tone="warning"
          role="status"
          action={
            <Button size="sm" variant="secondary" aria-pressed={checkOnly} onClick={() => setCheckOnly((v) => !v)}>
              {checkOnly ? "Show all posts" : "Show only these"}
            </Button>
          }
        >
          {viewCheckCount === 0
            ? "No posts need a view check now."
            : `${viewCheckCount} ${noun(viewCheckCount, "post")} ${viewCheckCount === 1 ? "needs" : "need"} a view check: views that jumped, or views with almost no engagement.`}
        </Banner>
      )}
      {statusFilter === REMOVED_FILTER && (
        <Banner tone="info">
          Removed posts don&rsquo;t count toward this campaign&rsquo;s totals and aren&rsquo;t synced. Restore one to put it and its views back.
        </Banner>
      )}
      {!error && posts.length > 0 && !postsAreRemoved && statusFilter !== REMOVED_FILTER && (
        /* Over the filtered set, so the tiles answer for what is on screen. */
        <section className="cc-poststab-summary" aria-label="Totals for the posts in view">
          <div className="cc-tiles-balanced cc-poststab-kpis">
            {kpiTiles.map((tile) => (
              <MetricTile
                key={tile.key}
                metric={tile.metric}
                label={tile.label}
                what={tile.what}
                how={tile.how}
                value={tile.value}
                fitTo={kpiFit}
              />
            ))}
          </div>
          {kpiAsOf && (
            <p data-kpi-asof className="cc-poststab-asof">
              {kpiAsOf}
            </p>
          )}
        </section>
      )}
      <ListToolbar
        search={{
          value: creatorSearch,
          onChange: setCreatorSearch,
          placeholder: "Search creators",
          ariaLabel: "Search posts by creator name or handle",
        }}
        end={
          <>
            <Dropdown
              ariaLabel="Filter by platform"
              size="md"
              align="right"
              minWidth={152}
              value={platformFilter}
              onChange={setPlatformFilter}
              options={PLATFORM_FILTERS.map((p) => ({ value: p, label: p === "ALL" ? "All platforms" : platformLabel(p) }))}
            />
            <Dropdown
              ariaLabel="Filter by post type"
              size="md"
              align="right"
              minWidth={128}
              value={mediaTypeFilter}
              onChange={setMediaTypeFilter}
              options={MEDIA_TYPE_FILTERS.map((m) => ({ value: m, label: m === "ALL" ? "All types" : enumLabel(m) }))}
            />
            {/* Sorting works in both views, grid included: the same state the
                list headers drive, so changing either moves both. */}
            <Dropdown
              ariaLabel="Sort posts by"
              size="md"
              align="right"
              minWidth={128}
              value={sortKey}
              onChange={(v) => setSortKey(v as SortKey)}
              options={sortFields.map((f) => ({ value: f.key, label: f.label }))}
            />
            <Dropdown
              ariaLabel="Sort direction"
              size="md"
              align="right"
              minWidth={112}
              value={sortDir}
              onChange={(v) => setSortDir(v as SortDir)}
              /* Posted is a date and the rest are counts, so the words differ. */
              options={
                sortKey === "posted"
                  ? [
                      { value: "desc", label: "Newest" },
                      { value: "asc", label: "Oldest" },
                    ]
                  : [
                      { value: "desc", label: "Highest" },
                      { value: "asc", label: "Lowest" },
                    ]
              }
            />
            <FilterButton count={drawerCount} onClick={() => setFiltersOpen(true)} />
            <ViewToggle
              ariaLabel="Posts view"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "grid", label: "Grid view", icon: Grid3X3 },
                { value: "list", label: "List view", icon: List },
              ]}
            />
          </>
        }
      />
      <FilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={DRAWER_FILTERS}
        values={drawerValues}
        onApply={applyDrawer}
      />

      {/* Refresh Data and Add Posts paint in the campaign header, not here. */}
      <CampaignHeaderActions>
        {/* The label must NOT change while loading: the button would grow on
            every progress tick as the digits widened. Progress belongs in the
            note below, where its width costs nothing. Not `loading` either --
            that hides the children behind a spinner. */}
        <Button
          variant="secondary"
          iconLeft={<RefreshCw size={16} style={{ animation: refreshingAll ? "cc-spin 1s linear infinite" : undefined }} />}
          onClick={handleRefreshAll}
          aria-busy={refreshingAll}
          disabled={posts.length === 0 || refreshingAll}
        >
          {refreshingAll ? "Refreshing…" : "Refresh data"}
        </Button>

        <Button variant="primary" iconLeft={<Plus size={16} />} onClick={openAddPost} {...action("add-posts")}>
          Add posts
        </Button>
      </CampaignHeaderActions>

      {error && (
        <LoadError
          title="Posts didn't load"
          description="Nothing here was read, which is not the same as the campaign having no posts."
          onRetry={fetchPosts}
        />
      )}

      {(refreshNote || (refreshingAll && refreshProgress)) && (
        <Banner
          tone="info"
          role="status"
          icon={<RefreshCw size={18} />}
          action={
            /* No dismiss while a run is in flight: the note is live progress
               then, and closing it would only make it reappear on the next tick. */
            refreshingAll ? undefined : (
              <button
                type="button"
                className="cc-more-btn cc-more-btn--inline"
                onClick={() => setRefreshNote(null)}
                aria-label="Dismiss refresh summary"
                title="Dismiss"
              >
                <X size={16} aria-hidden="true" />
              </button>
            )
          }
        >
          {refreshingAll && refreshProgress
            ? `Refreshing ${refreshProgress.completed} of ${refreshProgress.total}…`
            : refreshNote}
        </Banner>
      )}

      {/* Only while something is selected, and sticky, because the selection
          is made by scrolling. Above the list rather than below it, so it never
          covers the last row of a full page. */}
      {selectedOnPage.length > 0 && (
        <div role="region" aria-label="Bulk actions" className="cc-poststab-bulk">
          <div className="cc-poststab-bulk-start">
            {/* Indeterminate is a DOM property, not an attribute: a
                half-selected page that renders as empty is a lie about what
                clicking it will do. */}
            <input
              type="checkbox"
              className="cc-poststab-pick"
              checked={allOnPageSelected}
              ref={(el) => {
                if (el) el.indeterminate = someOnPageSelected;
              }}
              onChange={toggleSelectAllOnPage}
              aria-label={allOnPageSelected ? "Deselect all posts on this page" : "Select all posts on this page"}
              title={allOnPageSelected ? "Deselect all on this page" : "Select all on this page"}
            />
            <span className="cc-poststab-bulk-count">{selectedOnPage.length} selected</span>
            <Button variant="ghost" size="sm" onClick={clearSelection} disabled={bulkBusy}>
              Clear
            </Button>
          </div>
          <div className="cc-poststab-bulk-end">
            {/* Under Removed the selection can only be restored. */}
            {postsAreRemoved ? (
              <Button variant="primary" size="sm" iconLeft={<RotateCcw size={16} />} onClick={() => restorePosts(selectedOnPage)} loading={bulkBusy}>
                Restore
              </Button>
            ) : (
              <>
                <span className="cc-poststab-bulk-label" id="posts-bulk-ttl">Track for</span>
                <Dropdown
                  ariaLabel="Tracking window for the selection"
                  size="sm"
                  align="right"
                  minWidth={104}
                  value={String(bulkTtlDays)}
                  onChange={(v) => setBulkTtlDays(Number(v))}
                  disabled={bulkBusy}
                  options={BULK_TTL_CHOICES.map((d) => ({ value: String(d), label: `${d} ${noun(d, "day")}` }))}
                />
                <Button variant="primary" size="sm" iconLeft={<Radio size={16} />} onClick={() => runBulkAction("track")} loading={bulkBusy}>
                  Track
                </Button>
                <Button variant="secondary" size="sm" iconLeft={<Check size={16} />} onClick={() => runBulkAction("approve")} loading={bulkBusy}>
                  Approve
                </Button>
                <MoreMenu
                  label="More actions for the selected posts"
                  size="sm"
                  items={[
                    { label: "Stop tracking", icon: <Radio size={16} />, disabled: bulkBusy, onClick: () => runBulkAction("untrack") },
                    /* Rejection needs a reason, so this opens the dialog the
                       single-post path already uses. */
                    { label: "Reject…", icon: <X size={16} />, danger: true, disabled: bulkBusy, onClick: () => setShowRejectModal(BULK_REJECT) },
                    { label: "Remove from campaign…", icon: <Trash2 size={16} />, danger: true, disabled: bulkBusy, onClick: () => removePosts(selectedOnPage) },
                  ]}
                />
              </>
            )}
          </div>
        </div>
      )}

      {error ? null : firstRun ? (
        <EmptyState
          icon={<Video size={32} strokeWidth={1.75} />}
          title="No posts yet"
          description="Add post links to track their performance and manage approvals."
          action={
            <Button variant="secondary" iconLeft={<Plus size={16} />} onClick={openAddPost}>
              Add posts
            </Button>
          }
        />
      ) : viewMode === "list" ? (
        <div onContextMenu={onListContextMenu}>
          <DataTable
            caption="Posts in this campaign"
            className="cc-poststab-table"
            columns={listColumns}
            rows={pageRows}
            rowKey={(post) => post.id}
            sort={{ key: sortKey, dir: sortDir }}
            onSort={(key) => toggleSort(key as SortKey)}
            empty={emptyResult}
            footer={filteredSorted.length > 0 ? pager : undefined}
          />
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className="cc-poststab-noresults">{emptyResult}</div>
      ) : (
        <>
          <div className="cc-poststab-grid">
            {/* One memoised component per tile. See PostGridCard: the tab holds
                twenty-odd pieces of state and every one of them used to
                re-render all 25 tiles. */}
            {pageRows.map((post) => (
              <PostGridCard
                key={post.id}
                post={post}
                selected={selectedIds.has(post.id)}
                selectionActive={selectedIds.size > 0}
                onToggleSelect={toggleSelect}
                onOpenMenu={openMenu}
                showShares={anyShares}
                onCheckViews={openViewCheck}
                annotation={annotations[post.id]}
                removed={postsAreRemoved}
                nowMs={loadedAtMs}
              />
            ))}
          </div>
          {pager}
        </>
      )}

      {viewCheckPost && (
        <ViewCheckDialog
          campaignId={campaignId}
          postId={viewCheckPost.id}
          creatorName={viewCheckPost.creator.name?.trim() || `@${stripAt(viewCheckPost.creator.handle)}`}
          postUrl={viewCheckPost.postUrl}
          marketplace={Boolean(marketplace)}
          onClose={() => setViewCheckPostId(null)}
          onCleared={viewCheckCleared}
          onExcluded={exclusionsOn ? (ids, flagIds) => {
            toast.success(removePostsSummary(ids.length), {
              description: removePostsUndoHint(ids.length),
              duration: 10_000,
              /* Undo takes back the whole step: the checks the exclusion
                 marked reviewed open again before the post returns. */
              action: { label: "Undo", onClick: () => void reopenFlags(flagIds).then(() => restorePosts(ids)) },
            });
            fetchPosts();
            onRefreshed?.();
          } : undefined}
        />
      )}
      {showAddPost && (
        <Modal
          open={true}
          onClose={() => setShowAddPost(false)}
          /* No count in the title. It counted every link pasted while the
             button counts the ones that will be sent, so a paste with one bad
             link read "Add 4 Posts" over "Submit 3 Posts" (walkthrough A1#25);
             the button and the skipped line beside it carry the numbers. */
          title="Add posts"
          icon={ListPlus}
          tone="brand"
          description="Paste post links, one or a whole batch. Who posted each one is detected for you."
          size="md"
          dismissible={false}
          footer={
            <div className="cc-modal-footer" data-align="center">
              {/* What the button is leaving behind. Without this the count on the
                  button silently disagrees with the number of rows on screen,
                  which is the same surprise that holding the whole batch was
                  meant to avoid. */}
              {addSkipped.length > 0 && (
                <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginRight: "auto" }}>
                  {addSkipped.length === 1
                    ? "1 link is being skipped — its reason is on the row."
                    : `${addSkipped.length} links are being skipped — their reasons are on the rows.`}
                </span>
              )}
              <Button variant="secondary" size="sm" onClick={() => setShowAddPost(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={submitting} onClick={handleAddPosts} disabled={!addReady}>
                {/* Counts the rows that will actually be sent, so a paste of
                    three with two skipped reads "Submit 1 Post". */}
                {addRows.length > 1
                  ? `Add ${addSubmittable.length} ${noun(addSubmittable.length, "post")}`
                  : "Add post"}
              </Button>
            </div>
          }
        >
          <div className="cc-dialog-stack">
            <div className="ui-input-root">
              <label htmlFor="add-post-urls" className="ui-input-label">
                Post links
              </label>
              {/* A box that behaves like an input and holds each identified
                  link as one object. `onPaste` is where the batch actually
                  arrives -- operators paste, they do not type ninety-character
                  share URLs -- and the keyboard handlers cover the typed case
                  and the removal. */}
              <div
                className="cc-linkfield"
                onMouseDown={(e) => {
                  /* Clicking the padding focuses the input, the way clicking
                     anywhere in a text box does. Not on a chip's own remove
                     button, which would steal its click. */
                  if (e.target === e.currentTarget) {
                    e.preventDefault();
                    addDraftRef.current?.focus();
                  }
                }}
              >
                {addRows.map((row, i) => {
                  const detected = addDetections[i];
                  const problem = addProblems[i];
                  const tone =
                    row.state === "done"
                      ? "done"
                      : row.state === "saving" || row.state === "checking"
                        ? "busy"
                        : row.state === "failed" || problem
                          /* Any problem, blocking or not -- the same predicate
                             the row card below uses to turn itself red. A
                             field reading "3 links found" while one of them is
                             quietly being skipped is the surprise the skipped
                             count under the button exists to prevent. */
                          ? "danger"
                          : undefined;
                  return (
                    <span
                      /* The index is in the key because pasting one link twice
                         is precisely the case being flagged, and both chips
                         carry the same URL. */
                      key={`chip:${i}:${row.url}`}
                      className="cc-linkchip"
                      data-tone={tone}
                      title={row.url}
                    >
                      {detected && (
                        <PlatformGlyph
                          platform={detected.platform}
                          size="var(--cc-linkchip-glyph)"
                          className="cc-linkchip-glyph"
                        />
                      )}
                      <span className="cc-linkchip-label">{pastedUrlLabel(row.url)}</span>
                      {row.state === "idle" && (
                        <button
                          type="button"
                          className="cc-linkchip-remove"
                          aria-label={`Remove ${row.url}`}
                          onClick={() => removeAddRow(i)}
                        >
                          <X />
                        </button>
                      )}
                    </span>
                  );
                })}
                <input
                  id="add-post-urls"
                  ref={addDraftRef}
                  className="cc-linkfield-input"
                  autoFocus
                  value={addDraft}
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    addRows.length === 0
                      ? "Paste one link, or a whole batch at once"
                      : "Add another link"
                  }
                  onPaste={(e) => {
                    /* Joined to whatever is already in the draft, so pasting the
                       tail of a half-typed link still lands as one link. */
                    const text = addDraft + e.clipboardData.getData("text");
                    if (parsePastedPostEntries(text).length === 0) return;
                    e.preventDefault();
                    addLinks(text);
                    setAddDraft("");
                  }}
                  onChange={(e) => {
                    const text = e.target.value;
                    /* A separator is the commit for a typed link: a space, a
                       comma or a newline turns what precedes it into a chip,
                       which is the same punctuation parsePastedPostEntries
                       already splits a blob on. */
                    if (/[\s,]/.test(text) && addLinks(text)) {
                      setAddDraft("");
                      return;
                    }
                    setAddDraft(text);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (addLinks(addDraft)) setAddDraft("");
                      return;
                    }
                    /* One press, one link. This is the whole point of holding a
                       link as a chip: backspacing through ninety characters of
                       a TikTok share URL was never what "delete that link"
                       should cost. Only when there is nothing typed, so
                       backspace still edits a half-written link normally. */
                    if (e.key === "Backspace" && addDraft === "" && addRows.length > 0) {
                      e.preventDefault();
                      removeAddRow(addRows.length - 1);
                    }
                  }}
                  onBlur={() => {
                    /* Clicking Submit with a link still sitting in the input
                       should submit that link, not silently drop it. */
                    if (addLinks(addDraft)) setAddDraft("");
                  }}
                />
              </div>
              <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
                {addRows.length === 0
                  ? `Separated by new lines, spaces or commas. Up to ${MAX_BULK_POSTS} at a time.`
                  : `${addRows.length} link${addRows.length === 1 ? "" : "s"} found${
                      addRows.length >= MAX_BULK_POSTS ? ` — the limit is ${MAX_BULK_POSTS} at a time` : ""
                    }. ${checkingUrls ? "Checking… " : ""}Backspace removes the last one.`}
              </p>
              {/* Where the batch has got to, then what it came to. A live region,
                  so a screen reader hears "Adding 14 of 37" without the focus
                  moving, and the receipt stays here after the toast has gone. */}
              {(addProgress || addSummary) && (
                <div
                  role="status"
                  aria-live="polite"
                  style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text)", margin: "8px 0 0", fontWeight: "var(--cc-fw-strong)" }}
                >
                  {addProgress ? addProgressText(addProgress) : addSummary?.text}
                  {!addProgress && addSummary?.reasons && (
                    <span style={{ display: "block", whiteSpace: "pre-line", fontWeight: 400, color: "var(--cc-text-muted)", fontSize: "var(--cc-t-12)", marginTop: 2 }}>
                      {addSummary.reasons}
                    </span>
                  )}
                </div>
              )}
            </div>

            {addRows.map((row, i) => {
              const det = addDetections[i];
              const problem = addProblems[i];
              const otherCampaigns = row.check?.inOtherCampaigns ?? [];
              /* Said, not asked. The post is going in either way; what is worth
                 knowing is that its views are also counted somewhere else. Not
                 shown for a link pasted twice or one this campaign already
                 holds -- those rows carry their own refusal. */
              const showAlsoTracked =
                row.state !== "done" &&
                !row.repeatOfPaste &&
                !row.check?.inThisCampaign &&
                otherCampaigns.length > 0;
              const flagged = row.state === "failed" || Boolean(problem);
              return (
                <div
                  /* The index is in the key because pasting one link twice is
                     precisely the case being flagged, and both rows carry the
                     same URL. */
                  key={`${i}:${row.url}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    padding: 12,
                    borderRadius: 10,
                    border: `1px solid ${flagged ? "var(--cc-danger)" : "var(--cc-border)"}`,
                    background:
                      row.state === "done"
                        ? "var(--cc-primary-light)"
                        : flagged
                          ? "var(--cc-danger-light)"
                          : "var(--cc-card)",
                    opacity: row.state === "done" ? 0.7 : 1,
                  }}
                >
                  {/* Wraps, so a skipped row's reason drops under its link on a
                      phone instead of running off the dialog's edge. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
                    {/* The same chip as the one in the field above, so the row
                        and its token read as one object. The URL itself stays
                        on the title, because the label is a summary and the
                        operator must still be able to check the whole link. */}
                    <span className="cc-linkchip" title={row.url} style={{ flex: "0 1 auto" }}>
                      {det && (
                        <PlatformGlyph
                          platform={det.platform}
                          size="var(--cc-linkchip-glyph)"
                          className="cc-linkchip-glyph"
                        />
                      )}
                      <span className="cc-linkchip-label">{pastedUrlLabel(row.url)}</span>
                    </span>
                    <span style={{ flex: 1 }} />
                    {row.state === "done" && row.doneAs === "already" && (
                      <Badge variant="success">Already in this campaign</Badge>
                    )}
                    {/* Saved, though the add itself never answered -- found by
                        asking the server afterwards. Said, so a reader who saw
                        it sit on "Checking…" knows how it ended. */}
                    {row.state === "done" && row.doneAs === "late" && (
                      <span title="The add did not answer in time, but the post is in the campaign.">
                        <Badge variant="success">Added (confirmed)</Badge>
                      </span>
                    )}
                    {row.state === "done" && row.doneAs !== "already" && row.doneAs !== "late" && (
                      <Badge variant="success">Added</Badge>
                    )}
                    {row.state === "saving" && <Badge variant="neutral">Adding…</Badge>}
                    {row.state === "checking" && <Badge variant="neutral">No answer yet — checking…</Badge>}
                    {row.state === "failed" && <Badge variant="danger">{row.error ?? "Failed"}</Badge>}
                    {row.state === "idle" && problem && <Badge variant="danger">{problem.message}</Badge>}
                    {row.state === "idle" && (
                      <button
                        type="button"
                        aria-label={`Remove ${row.url}`}
                        onClick={() => removeAddRow(i)}
                        style={{ border: "none", background: "none", cursor: "pointer", color: "var(--cc-text-muted)", fontSize: "var(--cc-t-16)", lineHeight: 1 }}
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {showAlsoTracked && (
                    <p style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: 0 }}>
                      <Info size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                      <span>
                        Also tracked in{" "}
                        <strong style={{ color: "var(--cc-text)" }}>
                          {otherCampaigns.map((c) => c.campaignName).join(", ")}
                        </strong>
                        . Its views count in both.
                      </span>
                    </p>
                  )}

                  {/* Nothing to choose on a row that is skipped: its reason is on
                      the badge above, and it is not sent. */}
                  {row.state !== "done" && !row.repeatOfPaste && !problem?.blocking && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                        {/* Who posted it is detected, never asked: the link, the
                            platform or the org's own copy of the post names the
                            creator, and one nobody can name is filed under the
                            platform's Unattributed row and filled in on a later
                            refresh. The roster picker and "Pick someone else"
                            that used to sit here are gone (walkthrough R2). */}
                        {!row.check && (
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: 0 }}>
                            {precheckSettledKey !== addUrlsKey ? (
                              "Checking who posted it…"
                            ) : det?.handle ? (
                              <>
                                Detected <strong style={{ color: "var(--cc-text)" }}>@{det.handle}</strong> from the link.
                              </>
                            ) : (
                              "Who posted it is read from the platform when it is added."
                            )}
                          </p>
                        )}
                        {row.check?.creator && (
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: 0 }}>
                            Matched <strong style={{ color: "var(--cc-text)" }}>{creatorNameText(row.check.creator.name, row.check.creator.handle)}</strong>
                            {row.check.handleSource === "platform"
                              ? " from the post itself"
                              : row.check.handleSource === "record"
                                ? " from the copy already on record"
                                : " from the link"}
                            .
                          </p>
                        )}
                        {row.check?.handleSource === "platform" && !row.check.creator && !row.check.creatorWillBeAdded && (
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
                            This link names no creator; the platform says{" "}
                            <strong style={{ color: "var(--cc-text)" }}>
                              {row.check.authorName ?? `@${row.check.handle}`}
                            </strong>
                            .
                          </p>
                        )}
                        {row.check?.willBeUnattributed && (
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: 0 }}>
                            <strong style={{ color: "var(--cc-text)" }}>{unknownCreatorReason(row.check.platform)}.</strong>{" "}
                            It is added and tracked anyway. We look for the creator automatically on every refresh and fill
                            them in, with the post’s views, as soon as we find them.
                          </p>
                        )}
                        {row.check?.creatorWillBeAdded && (
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: 0 }}>
                            <strong style={{ color: "var(--cc-text)" }}>@{row.check.handle}</strong>
                            {row.check.handleSource === "platform" ? " — read off the post itself — " : " "}
                            is not on the roster yet, and will be added with this post.
                          </p>
                        )}
                      </div>
                      <div style={{ flex: "0 1 180px", minWidth: 160 }}>
                        <Dropdown
                          ariaLabel={`Media type for ${row.url}`}
                          align="left"
                          fullWidth
                          value={row.mediaType}
                          onChange={(v) =>
                            setAddRows((prev) => prev.map((r, j) => (j === i ? { ...r, mediaType: v } : r)))
                          }
                          options={[
                            { value: "", label: det?.mediaType ? `Auto (${det.mediaType.toLowerCase()})` : "Auto-detect" },
                            { value: "REEL", label: "Reel" },
                            { value: "STORY", label: "Story" },
                            { value: "POST", label: "Post" },
                            { value: "SHORT", label: "Short" },
                            { value: "VIDEO", label: "Video" },
                          ]}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {showRejectModal && (
        <Modal
          open={true}
          onClose={() => { setShowRejectModal(null); setRejectionReason(""); }}
          icon={XCircle}
          tone="danger"
          title={showRejectModal === BULK_REJECT ? `Reject ${selectedOnPage.length} ${noun(selectedOnPage.length, "post")}` : "Reject post"}
          description={
            showRejectModal === BULK_REJECT
              ? "The same reason is stored on every selected post, and each creator sees it on their own post."
              : "The post is marked Rejected, with your reason stored on it."
          }
          size="sm"
          footer={
            <div className="cc-modal-footer">
              <Button variant="secondary" size="sm" onClick={() => { setShowRejectModal(null); setRejectionReason(""); }}>Cancel</Button>
              {/* The count is in the button too, not only the title: this is the
                  irreversible half of the dialog and it should say how many rows
                  it is about to change. */}
              <Button variant="danger" size="sm" onClick={handleReject} loading={bulkBusy}>
                {showRejectModal === BULK_REJECT ? `Reject ${selectedOnPage.length} ${noun(selectedOnPage.length, "post")}` : "Reject post"}
              </Button>
            </div>
          }
        >
          <Textarea
            id="reject-reason"
            label="Reason"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Why is this post being rejected?"
            rows={3}
          />
        </Modal>
      )}

      {menu && menuItems.length > 0 && (
        <PostActionMenu x={menu.x} y={menu.y} align={menu.align} anchor={menu.anchor} items={menuItems} onClose={closeMenu} />
      )}
    </div>
  );
}
