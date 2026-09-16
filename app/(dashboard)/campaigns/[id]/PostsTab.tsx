"use client";

import React from "react";
import Link from "next/link";
import { useState, useEffect, useMemo, useCallback, useDeferredValue, useRef } from "react";
import { Card, Badge, Input, Modal, EmptyState, Skeleton, Avatar } from "@pratham7711/ui";
import { Dropdown, StatusTabs, Pagination, Button } from "@/components/ds";
import { Grid3X3, List, Plus, Check, X, TrendingUp, BarChart3, ArrowUp, ArrowDown, ArrowUpDown, Flag, Video, AlertTriangle, RefreshCw, Info } from "lucide-react";
import { CreatorSelect } from "@/components/CreatorSelect";
import { stripAt, formatDateAbs, formatFull } from "@/lib/format";
import type { ComplianceFlag } from "@/lib/compliance/postCompliance";
import PostMedia from "@/components/PostMedia";
import { imgSrc } from "@/lib/postMedia";
import { metricValue, unwrittenMetricValue, fieldMetricValue, engagementRateValue, summarizePostMetrics } from "@/lib/metricDisplay";
import { isPostRemoved, removedNote } from "@/lib/postRemoval";
import RemovedPostOverlay from "@/components/posts/RemovedPostOverlay";
import PostGridCard from "@/components/posts/PostGridCard";
import { STATUS_BADGE, formatSince, engRatePct } from "@/lib/posts/postDisplay";
import { summariseRefresh } from "@/lib/refreshSummary";
import { toast } from "sonner";
import { CampaignHeaderActions } from "@/components/campaigns/CampaignHeaderActions";
import { detectPlatform } from "@/lib/platforms/fetchPostMetrics";
import { MAX_BULK_POSTS, mergePastedEntries, parsePastedPostEntries, pastedUrlLabel } from "@/lib/posts/pastedUrls";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { platformFromHost, detectPlatformFromUrl, platformLabel } from "@/lib/platforms/registry";

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
  /* A hex, like its three siblings, NOT var(--cc-warning-ink). statusInk
     scores a non-hex as the worst possible contrast, so the var made it pick
     the PALE #FEF3C7 as this tab's ink -- and a selected pill fills with its
     ink, which is how Pending Review came out white-on-cream. The literal is
     the one STATUS_COLOR_TOKENS already maps to var(--cc-warning). */
  { key: "PENDING_REVIEW", label: "Pending Review", bg: "#FEF3C7", color: "#d97706" },
  { key: "APPROVED", label: "Approved", bg: "#D1FAE5", color: "#059669" },
  { key: "REJECTED", label: "Rejected", bg: "#FEE2E2", color: "#DC2626" },
];

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
  inThisCampaign: { id: string; campaignId: string; campaignName: string } | null;
  inOtherCampaigns: { id: string; campaignId: string; campaignName: string }[];
};

type AddRow = {
  url: string;
  /** platform:id -- what makes two links the same post despite different query strings. */
  key: string;
  /** An earlier row in this same paste is the same post. */
  repeatOfPaste: boolean;
  /** Blank means "let the server read the creator off the link". */
  creatorId: string;
  /** The chosen creator's own platform, kept so a mismatch with the link's
   *  platform can be pointed out. Undefined until somebody picks one. */
  creatorPlatform?: string;
  /** Blank means auto-detect. */
  mediaType: string;
  state: "idle" | "saving" | "done" | "failed";
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
  detectedHandle: string | undefined,
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
     would be a lie. */
  if (row.check && !row.check.platform) {
    const namesAPost = detectPlatformFromUrl(row.url);
    if (namesAPost) {
      return {
        blocking: true,
        message: `${platformLabel(namesAPost.platform)} posts can\u2019t be tracked yet — this link can\u2019t be added.`,
      };
    }
    const known = platformFromHost(row.url);
    return {
      blocking: true,
      message: known
        ? `That\u2019s a ${known.label} link, but there is no post id in it — check the URL.`
        : "Not a post link we recognise — this platform isn\u2019t supported yet.",
    };
  }
  if (row.check?.inThisCampaign) {
    return { blocking: true, message: "Already in this campaign." };
  }
  /* A post another campaign already tracks is not a problem at all -- it is
     added, and the row says so in a note rather than a refusal. Only the same
     post twice in THIS campaign double-counts anything. */
  if (row.creatorId) return null;
  if (!detectedHandle) {
    /* The precheck asks the platform whenever the link itself names nobody, so
       until it has answered there is nothing to complain about. Blocking on the
       URL alone is what used to make every YouTube link demand a creator the
       platform would have handed over for free. */
    if (!row.check) return null;
    return { blocking: true, message: "Neither this link nor the platform names a creator — pick one." };
  }
  /* A handle the roster has never seen is not an error any more -- the post add
     creates the creator from the link. It only blocks on a seat that is not
     allowed to add creators, which is the one case where nothing downstream can
     resolve it. */
  if (row.check && !row.check.creator && !row.check.creatorWillBeAdded) {
    return {
      blocking: true,
      message: `No creator on the roster is @${detectedHandle}, and this account cannot add one — pick a creator.`,
    };
  }
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
 */
const ADD_POST_TIMEOUT_MS = 25_000;

const PAGE_SIZE = 25;

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
const FETCH_STATE_BADGE: Record<string, "danger" | "warning"> = {
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
  delta: "148px",
  status: "136px", // "PENDING REVIEW" is ~130px at this type size; 104 ran into Last synced
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
          ...(kept ?? { creatorId: "", mediaType: "", state: "idle" as const }),
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

  /* fetchPosts is rebuilt whenever a filter changes. The recovery poller below
     keys on campaignId alone, so it reaches the current one through a ref
     rather than tearing itself down and restarting on every filter change. */
  const fetchPostsRef = useRef(fetchPosts);
  useEffect(() => { fetchPostsRef.current = fetchPosts; }, [fetchPosts]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);
  useEffect(() => { setPage(1); }, [statusFilter, platformFilter, mediaTypeFilter, minViews, creatorSearch, postedFrom, postedTo, sortKey, sortDir]);

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
        if (!cancelled) setCheckingUrls(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); setCheckingUrls(false); };
  }, [campaignId, showAddPost, addUrlsKey]);

  const addProblems = useMemo(
    /* The server's handle wins over the URL's: for a link that names
       nobody it is the one the platform answered with. */
    () => addRows.map((r, i) => addRowProblem(r, r.check?.handle ?? addDetections[i]?.handle)),
    [addRows, addDetections]
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

  const handleAddPosts = async () => {
    const pending = addRows.filter((r) => r.state !== "done");
    if (pending.length === 0) return;
    setSubmitting(true);
    try {
      /* Sequential on purpose. Each add triggers a first metrics read server
         side, and firing ten at once is what trips the platform rate limits the
         sync path spends its life working around. Ten links is a few seconds. */
      const results: AddRow[] = [...addRows];
      for (let i = 0; i < results.length; i++) {
        if (results[i].state === "done") continue;
        // A link pasted twice is one post; submitting it twice would only earn
        // the duplicate refusal it was already marked with.
        if (results[i].repeatOfPaste) continue;
        /* A row whose rejection is already on screen. Sending it would only
           fetch the refusal it is already showing, and it must not stop the
           rows queued behind it. */
        if (addProblems[i]?.blocking) continue;
        results[i] = { ...results[i], state: "saving", error: undefined };
        setAddRows([...results]);

        /* Absent keys, not nulls. mediaType is z.enum().optional(), which accepts
           undefined and rejects null, so sending `mediaType: null` for the
           "Auto-detect" option -- the default -- failed validation before it could
           reach the detector. Same for creatorId, whose absence is now what asks
           the server to read the creator off the URL. */
        try {
          const res = await fetch(`/api/campaigns/${campaignId}/posts`, {
            method: "POST",
            signal: AbortSignal.timeout(ADD_POST_TIMEOUT_MS),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              postUrl: results[i].url,
              ...(results[i].creatorId ? { creatorId: results[i].creatorId } : {}),
              ...(results[i].mediaType ? { mediaType: results[i].mediaType } : {}),
            }),
          });
          if (res.ok) {
            results[i] = { ...results[i], state: "done" };
          } else {
            const body = await res.json().catch(() => null);
            results[i] = {
              ...results[i],
              state: "failed",
              /* message first: it is the sentence written for a person,
                 where error is the machine reason ("duplicate_post"). */
              error: body?.message ?? body?.error ?? `Rejected (${res.status})`,
            };
          }
        } catch (err) {
          /* Two different failures used to share "Network error": a request
             that never got an answer, and one the operator's connection had
             nothing to do with. A failed row is not skipped on the next
             Submit, so both are worth saying are retryable. */
          const timedOut = err instanceof DOMException && err.name === "TimeoutError";
          results[i] = {
            ...results[i],
            state: "failed",
            error: timedOut
              ? "No answer in 25s — not added. Submit again to retry."
              : "Could not reach the server — not added. Submit again to retry.",
          };
        }
        setAddRows([...results]);
      }

      const added = results.filter((r) => r.state === "done").length;
      const failed = results.filter((r) => r.state === "failed");
      /* The campaign's own totals live on the page above this tab -- the
         Posts tab counter among them -- so adding posts has to tell it,
         the same way Refresh Data does. Ten at once made the stale 0
         impossible to miss. */
      if (added > 0) {
        fetchPosts();
        onRefreshed?.();
      }

      /* A partial batch keeps the dialog open showing only what failed, so the
         eight that worked are not re-submitted to retry the two that did not. */
      if (failed.length === 0) {
        setShowAddPost(false);
        setAddRows([]);
        setAddDraft("");
        toast.success(added === 1 ? "Post added." : `${added} posts added.`);
      } else {
        toast.error(
          added > 0
            ? `${added} added, ${failed.length} could not be added.`
            : "None of those could be added."
        );
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
      setRefreshNote(summariseRefresh(body));
      fetchPosts();
      onRefreshed?.();
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

  const openAddPost = () => {
    /* Reset here rather than on close: a failed batch leaves its rows on screen
       so the operator can read what went wrong, and only reopening clears them. */
    setAddDraft("");
    setAddRows([]);
    setShowAddPost(true);
  };

  /* The two typed filters feed the list through useDeferredValue, so a
     keystroke paints the character first and re-filters afterwards. The inputs
     stay bound to the immediate state -- deferring what a field displays is how
     a text box starts dropping characters -- and only the derived list lags,
     by one frame on a small campaign and by as long as it takes on a large one.
     Everything else here is a click, which cannot outrun a render anyway. */
  const deferredCreatorSearch = useDeferredValue(creatorSearch);
  const deferredMinViews = useDeferredValue(minViews);

  const filteredSorted = useMemo(() => {
    const minV = parseInt(deferredMinViews, 10);
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
      if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
      if (platformFilter !== "ALL" && p.platform !== platformFilter) return false;
      if (mediaTypeFilter !== "ALL" && p.mediaType !== mediaTypeFilter) return false;
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
        case "delta": return deltaViews(p) ?? Number.NEGATIVE_INFINITY;
        default: return 0;
      }
    };

    const sorted = [...rows].sort((a, b) => {
      const diff = valueOf(a) - valueOf(b);
      return sortDir === "asc" ? diff : -diff;
    });
    return sorted;
  }, [posts, statusFilter, platformFilter, mediaTypeFilter, deferredMinViews, deferredCreatorSearch, postedFrom, postedTo, sortKey, sortDir]);

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
    () => posts.some((p) => fieldMetricValue(p.sharesCount, p.lastSyncedAt, p.platformMetrics, "shares") !== null),
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
    /* Their wording, verbatim, on both rate chips -- the first spells
       "Average" and the second abbreviates it, and matching that is what makes
       the two strips read as the same row. */
    add("Average Post Eng Rate", pct(kpis.avgPostRate));
    add("Avg. Campaign Eng Rate", pct(kpis.campaignRate));
    add("Total Engagement", kpis.engagement === null ? null : formatNumber(kpis.engagement));
    add("Total Likes", kpis.likes === null ? null : formatNumber(kpis.likes));
    add("Total Comments", kpis.comments === null ? null : formatNumber(kpis.comments));
    add("Total Shares", kpis.shares === null ? null : formatNumber(kpis.shares));
    add("Total Saves", kpis.saves === null ? null : formatNumber(kpis.saves));
    add("Total Downloads", kpis.downloads === null ? null : formatNumber(kpis.downloads));
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
    if (!sortFields.some((f) => f.key === sortKey)) setSortKey("posted");
  }, [sortFields, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  if (loading) {
    /* Two grey bars, 48px and 200px, used to stand in for a status tab row, a
       filter toolbar and a grid of 9:16 posters. Nothing lined up, so the whole
       tab jumped the moment the posts arrived -- the skeleton was measuring a
       layout that does not exist. This mirrors the real one: same tab pills,
       same toolbar height, same grid track and gap, same card aspect and
       radius, so the placeholders sit exactly where the posts land. */
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* The KPI chip strip. It was missing entirely, and it is 59px tall, so
            the grid below sat exactly that much too high and everything dropped
            when the numbers arrived. The chips only render once there is at
            least one post, so on a genuinely empty campaign this row reserves
            space that never fills -- the wrong guess in the rare direction
            rather than in the usual one. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} width="112px" height="59px" borderRadius="8px" />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STATUS_TABS.map((t) => (
            <Skeleton key={t.key} width={`${52 + t.label.length * 7}px`} height="34px" borderRadius="8px" />
          ))}
        </div>
        {/* The same nine controls at their real widths, in the same order, so
            the toolbar wraps onto the same number of rows it will once it is
            interactive. Five stand-ins on one row left the grid 116px too high
            and the whole tab dropped when the posts arrived. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {[140, 110, 140, 140, 150, 140, 130, 110, 96].map((w, i) => (
            <Skeleton key={i} width={`${w}px`} height="36px" borderRadius="8px" />
          ))}
          <div style={{ flex: 1, minWidth: 0 }} />
          <Skeleton width="130px" height="36px" borderRadius="8px" />
          <Skeleton width="72px" height="36px" borderRadius="8px" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 18 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ aspectRatio: "9 / 16", borderRadius: 20, overflow: "hidden" }}>
              <Skeleton width="100%" height="100%" borderRadius="20px" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const selectStyle = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--cc-border)",
    fontSize: "var(--cc-t-13)",
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
        className="cc-microlabel"
        data-active={active || undefined}
        style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: align === "right" ? "flex-end" : "flex-start", background: "none", border: "none", padding: 0, cursor: "pointer" }}
      >
        {label}
        {active ? (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} />}
      </button>
    );
  };

  const PlainHeader = ({ label }: { label: string }) => (
    <span className="cc-microlabel">{label}</span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{".posts-min-views { display: none; } @media (min-width: 768px) { .posts-min-views { display: block; } }"}</style>
      {marketplace && (
        <Card variant="outlined" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: capMinor ? 12 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "var(--cc-t-13)", fontWeight: 700, color: "var(--cc-text)" }}>Marketplace budget</span>
              {capReached && <Badge variant="danger" style={{ fontSize: "var(--cc-t-11)"}}>Cap reached</Badge>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
                {pendingCount} pending &middot; auto-approve in {marketplace.autoApproveHours}h
              </span>
              <span style={{ fontSize: "var(--cc-t-14)", fontWeight: 700, color: "var(--cc-text)" }}>
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
      {/* The status pills alone above the strip -- MEASURED, their filter row is
          two pills 32px tall at 293,134 and the strip follows at 180. The
          search-and-date cluster stays under the strip: carried up here it
          wrapped to a second line and pushed the strip 49px past theirs. */}
      <div className="cc-poststab-filter" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <StatusTabs
          variant="pill"
          ariaLabel="Filter posts by status"
          tabs={STATUS_TABS}
          active={statusFilter}
          onChange={setStatusFilter}
        />
      </div>
      {!error && posts.length > 0 && (
        /* Classes, not inline styles: every number that was here is now a
           --cc-kpi-* token, because an inline style is the one thing a theme
           cannot outrank and the census measured all seven of them off their
           strip. Base values reproduce exactly what this JSX painted.

           BELOW the filter row, not above it. MEASURED 2026-09-14 at
           desktop-1600: their Posts tab opens with a two-pill filter at
           293,134 99x32 and only then the strip at 180 -- ours led with the
           strip and put the pills under it, so the whole page ran a row out of
           step with theirs. */
        <div className="cc-kpi-strip">
          {kpiChips.map((chip) => (
            <div key={chip.label} className="cc-kpi-chip">
              <span className="cc-kpi-chip-label">{chip.label}</span>
              <span className="cc-kpi-chip-value">{chip.value}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
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

          {/* Sorting used to live entirely in the list headers, and grid is the
              default view, so the view most people see could not be sorted at
              all. Same state as the headers: changing either moves both. */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <ArrowUpDown size={15} aria-hidden="true" style={{ color: "var(--cc-text-muted)" }} />
            <Dropdown
              ariaLabel="Sort posts by"
              align="left"
              minWidth={130}
              value={sortKey}
              onChange={(v) => setSortKey(v as SortKey)}
              options={sortFields.map((f) => ({ value: f.key, label: f.label }))}
            />
            <Dropdown
              ariaLabel="Sort direction"
              align="left"
              minWidth={110}
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
          </span>

          <div style={{ display: "flex", border: "1px solid var(--cc-border)", borderRadius: 8, overflow: "hidden" }}>
            <button onClick={() => setViewMode("list")} aria-label="List view" aria-pressed={viewMode === "list"} style={{ padding: "6px 10px", background: viewMode === "list" ? "var(--cc-bg)" : "var(--cc-card)", border: "none", cursor: "pointer" }}>
              <List size={16} color={viewMode === "list" ? "var(--cc-primary)" : "var(--cc-text-muted)"} />
            </button>
            <button onClick={() => setViewMode("grid")} aria-label="Grid view" aria-pressed={viewMode === "grid"} style={{ padding: "6px 10px", background: viewMode === "grid" ? "var(--cc-bg)" : "var(--cc-card)", border: "none", cursor: "pointer" }}>
              <Grid3X3 size={16} color={viewMode === "grid" ? "var(--cc-primary)" : "var(--cc-text-muted)"} />
            </button>
          </div>

        </div>
      </div>



      {/* Refresh Data and Add Posts paint in the campaign header, not here.
          MEASURED at desktop-1600: theirs sit on the header card's right edge
          (Add Posts x=1332 y=42.5 w=200 h=45, Refresh Data immediately left of
          it), while ours sat in the section body under the filter row. Their
          order is Share Campaign / Refresh Data / Add <thing>, so the refresh
          goes first here too. */}
      <CampaignHeaderActions>
        {/* The label must NOT change while loading. components/ds/Button keeps
            the children as the button's sizing element and lays the spinner
            over them, so swapping in "Refreshing 12 of 58" made the button
            grow -- and grow again on every progress tick as the digits
            widened, which reads as a loader swelling on the screen. Progress
            belongs in the note card below, where its width costs nothing.

            The glyph goes through `iconLeft` rather than into the children,
            even though the reference paints it on the RIGHT: the library
            renders that prop as its own .ui-btn-icon element, which is what
            the theme's `order` rule moves. Hand-building the row here would
            have put the icon on the right in all three themes instead of the
            one that asked for it. */}
        <Button
          variant="secondary"
          iconLeft={<RefreshCw size={16} />}
          onClick={handleRefreshAll}
          loading={refreshingAll}
          disabled={posts.length === 0}
        >
          Refresh Data
        </Button>

        <Button variant="primary" iconLeft={<Plus size={16} />} onClick={openAddPost}>
          Add Posts
        </Button>
      </CampaignHeaderActions>

      {error && (
        <Card variant="outlined" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{error}</span>
            <Button variant="secondary" onClick={fetchPosts}>Retry</Button>
          </div>
        </Card>
      )}

      {(refreshNote || (refreshingAll && refreshProgress)) && (
        <Card variant="outlined" style={{ padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
              {refreshingAll && refreshProgress
                ? `Refreshing ${refreshProgress.completed} of ${refreshProgress.total}\u2026`
                : refreshNote}
            </span>
            {/* No dismiss while a run is in flight: the card is live progress
                at that point, and closing it would only make it reappear on the
                next tick. */}
            {!refreshingAll && (
              <button
                onClick={() => setRefreshNote(null)}
                aria-label="Dismiss refresh summary"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", display: "flex" }}
              >
                <X size={14} />
              </button>
            )}
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
              {anyDelta && <SortHeader label="Δ Views" sk="delta" align="right" />}
              <PlainHeader label="Status" />
              <PlainHeader label="Last Synced" />
              <PlainHeader label="Actions" />
            </div>
            {pageRows.map((post, i) => {
              const er = engRatePct(post);
              const dv = deltaViews(post);
              // A 0 we never fetched is unknown, not zero -- see lib/metricDisplay.
              const views = metricValue(post.viewsCount, post.lastSyncedAt);
              // Per field: Instagram reports no shares, so a 0 there is ours, not theirs.
              const likes = fieldMetricValue(post.likesCount, post.lastSyncedAt, post.platformMetrics, "likes");
              const comments = fieldMetricValue(post.commentsCount, post.lastSyncedAt, post.platformMetrics, "comments");
              const shares = fieldMetricValue(post.sharesCount, post.lastSyncedAt, post.platformMetrics, "shares");
              // Nothing in this repo writes these two, so lastSyncedAt cannot vouch for a
              // zero here the way it can for views -- see unwrittenMetricValue.
              const saves = unwrittenMetricValue(post.savesCount);
              const downloads = unwrittenMetricValue(post.downloadsCount);
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
                    {/* Out to the platform, not in to our own detail page. Clicking a
                        post means "let me see the post"; the thumbnail beside this
                        already behaved that way (PostMedia opens postUrl), so the two
                        halves of one row used to go to two different places. The
                        detail page — tracking and bot signals — is still reached
                        from the Performance tab's post table. */}
                    <a href={post.postUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", minWidth: 0 }}>
                      <Avatar
                        name={post.creator.name}
                        size="sm"
                        src={imgSrc(post.authorProfilePic, 64) ?? imgSrc(post.creator.avatarUrl, 64) ?? undefined}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div title={post.creator.name} style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.creator.name}</div>
                        <div title={`@${stripAt(post.creator.handle)}`} style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{stripAt(post.creator.handle)}</div>
                      </div>
                    </a>
                  </div>
                  <Badge variant={PLATFORM_BADGE[post.platform] ?? "neutral"} style={{ fontSize: "var(--cc-t-11)"}}>{post.platform}</Badge>
                  <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{formatDateAbs(post.postedAt)}</span>
                  <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", textAlign: "right" }}>
                    {views === null ? "" : formatNumber(views)}
                  </span>
                  {anyLikes && (
                    <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", textAlign: "right" }}>
                      {likes === null ? "" : formatNumber(likes)}
                    </span>
                  )}
                  {anyComments && (
                    <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", textAlign: "right" }}>
                      {comments === null ? "" : formatNumber(comments)}
                    </span>
                  )}
                  {anyShares && (
                    <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", textAlign: "right" }}>
                      {shares === null ? "" : formatNumber(shares)}
                    </span>
                  )}
                  {anySaves && (
                    <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", textAlign: "right" }}>
                      {saves === null ? "" : formatNumber(saves)}
                    </span>
                  )}
                  {anyDownloads && (
                    <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", textAlign: "right" }}>
                      {downloads === null ? "" : formatNumber(downloads)}
                    </span>
                  )}
                  {anyEngRate && (
                    <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-primary)", textAlign: "right" }}>
                      {erShown === null ? "" : `${erShown.toFixed(1)}%`}
                    </span>
                  )}
                  {anyDelta && (
                    <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", textAlign: "right", color: dv === null ? "var(--cc-text-subtle)" : dv >= 0 ? "var(--cc-success)" : "var(--cc-danger)" }}>
                      {dv === null ? "" : `${dv >= 0 ? "+" : ""}${formatNumber(dv)}`}
                    </span>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                    <Badge variant={STATUS_BADGE[post.status] ?? "neutral"}>{post.status.replace(/_/g, " ")}</Badge>
                    {/* The counters in this row stay exactly as stored: the post
                        is gone, the reach it earned while it was up is not. */}
                    {isPostRemoved(post) && <RemovedPostOverlay variant="inline" compact note={removedNote(post)} />}
                    {post.fetchState && FETCH_STATE_LABEL[post.fetchState] && (
                      <Badge variant={FETCH_STATE_BADGE[post.fetchState]} style={{ fontSize: "var(--cc-t-10)"}}>
                        {FETCH_STATE_LABEL[post.fetchState]}
                      </Badge>
                    )}
                    {post.hasOpenFraudFlag && <Badge variant="danger" style={{ fontSize: "var(--cc-t-10)", display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={14} color="var(--cc-danger)" /> Flagged</Badge>}
                    {(post.complianceFlags ?? []).map((f) => (
                      <Badge key={f.code} variant={f.severity === "error" ? "danger" : "warning"} title={f.message} style={{ fontSize: "var(--cc-t-10)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle size={12} color={f.severity === "error" ? "var(--cc-danger)" : "var(--cc-warning)"} /> {COMPLIANCE_LABEL[f.code]}
                      </Badge>
                    ))}
                    {marketplace && post.status === "PENDING_REVIEW" && !post.hasOpenFraudFlag && (
                      <span style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-muted)" }}>
                        auto in {timeRemaining(post.createdAt, marketplace.autoApproveHours)}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>{formatSince(post.lastSyncedAt)}</span>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {/* The only way into our own post page now that the row itself
                        goes out to the platform. Tracking and bot signals live
                        there and nothing else in a campaign links to it. */}
                    <Link href={`/campaigns/${campaignId}/posts/${post.id}`} aria-label="View post analytics" title="View post analytics" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-border)", background: "var(--cc-card)", color: "var(--cc-text-muted)", fontSize: "var(--cc-t-12)", display: "flex", alignItems: "center", gap: 2, textDecoration: "none" }}>
                      <BarChart3 size={12} />
                    </Link>
                    <button onClick={() => handleSyncNow(post.id)} disabled={syncingId === post.id} aria-label="Sync post metrics now" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-border)", background: "var(--cc-card)", color: "var(--cc-text-muted)", cursor: syncingId === post.id ? "wait" : "pointer", fontSize: "var(--cc-t-12)", display: "flex", alignItems: "center", gap: 2, opacity: syncingId === post.id ? 0.6 : 1 }}>
                      <TrendingUp size={12} />
                    </button>
                    {(postApprovalMode === "MANUAL" || marketplace) && post.status === "PENDING_REVIEW" && (
                      <>
                        <button onClick={() => handleApprove(post.id)} aria-label="Approve post" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-success)", background: "color-mix(in srgb, var(--cc-success) 14%, transparent)", color: "var(--cc-success)", cursor: "pointer", fontSize: "var(--cc-t-12)", display: "flex", alignItems: "center", gap: 2 }}>
                          <Check size={12} />
                        </button>
                        <button onClick={() => setShowRejectModal(post.id)} aria-label="Reject post" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-danger)", background: "color-mix(in srgb, var(--cc-danger) 14%, transparent)", color: "var(--cc-danger-ink)", cursor: "pointer", fontSize: "var(--cc-t-12)", display: "flex", alignItems: "center", gap: 2 }}>
                          <X size={12} />
                        </button>
                      </>
                    )}
                    {marketplace && !post.hasOpenFraudFlag && post.status !== "REJECTED" && (
                      <button onClick={() => handleFlagSuspicious(post.id)} disabled={flaggingId === post.id} aria-label="Flag post as suspicious" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-warning)", background: "color-mix(in srgb, var(--cc-warning) 14%, transparent)", color: "var(--cc-warning)", cursor: flaggingId === post.id ? "wait" : "pointer", fontSize: "var(--cc-t-12)", display: "flex", alignItems: "center", gap: 2, opacity: flaggingId === post.id ? 0.6 : 1 }}>
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
            {/* One memoised component per tile, not 140 lines of inline JSX.
                See PostGridCard: the tab holds twenty-odd pieces of state and
                every one of them used to re-render all 25 tiles. */}
            {pageRows.map((post) => (
              <PostGridCard key={post.id} post={post} campaignId={campaignId} />
            ))}
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
        <Modal
          open={true}
          onClose={() => setShowAddPost(false)}
          title={addRows.length > 1 ? `Add ${addRows.length} Posts` : "Add Post"}
          size="lg"
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
              <Button variant="secondary" onClick={() => setShowAddPost(false)}>Cancel</Button>
              <Button variant="primary" loading={submitting} onClick={handleAddPosts} disabled={!addReady}>
                {/* Counts the rows that will actually be sent, so a paste of
                    three with two skipped reads "Submit 1 Post". */}
                {addRows.length > 1
                  ? `Submit ${addSubmittable.length} Post${addSubmittable.length === 1 ? "" : "s"}`
                  : "Submit Post"}
              </Button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label htmlFor="add-post-urls" style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>
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
                      : row.state === "saving"
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
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
                    {row.state === "done" && <Badge variant="success">Added</Badge>}
                    {row.state === "saving" && <Badge variant="neutral">Adding…</Badge>}
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

                  {row.state !== "done" && !row.repeatOfPaste && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                        <CreatorSelect
                          value={row.creatorId}
                          onChange={(id, creator) =>
                            setAddRows((prev) =>
                              prev.map((r, j) =>
                                j === i ? { ...r, creatorId: id, creatorPlatform: creator?.platform } : r
                              )
                            )
                          }
                        />
                        {row.check?.creator && !row.creatorId && (
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
                            Matched <strong style={{ color: "var(--cc-text)" }}>{row.check.creator.name}</strong>
                            {row.check.handleSource === "platform"
                              ? " from the post itself"
                              : row.check.handleSource === "record"
                                ? " from the copy already on record"
                                : " from the link"} — leave blank to use them.
                          </p>
                        )}
                        {row.check?.handleSource === "platform" && !row.check.creator && !row.check.creatorWillBeAdded && !row.creatorId && (
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
                            This link names no creator; the platform says{" "}
                            <strong style={{ color: "var(--cc-text)" }}>
                              {row.check.authorName ?? `@${row.check.handle}`}
                            </strong>
                            .
                          </p>
                        )}
                        {row.check?.creatorWillBeAdded && !row.creatorId && (
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
                            <strong style={{ color: "var(--cc-text)" }}>@{row.check.handle}</strong>
                            {row.check.handleSource === "platform" ? " — read off the post itself — " : " "}
                            is not on the roster yet, and will be added with this post. Pick someone else to
                            attribute it differently.
                          </p>
                        )}
                        {det?.handle && !row.check && !row.creatorId && (
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
                            Detected <strong style={{ color: "var(--cc-text)" }}>@{det.handle}</strong> — leave blank to use them.
                          </p>
                        )}
                        {/* The picker lists the whole roster whatever the link is, and every
                            creator is labelled with its own platform -- so the operator can
                            attribute a YouTube post to a TikTok creator with nothing said.
                            Flagged rather than filtered on purpose: in an org whose roster is
                            all one platform, filtering would empty the picker and strand the
                            post with no way forward. */}
                        {row.creatorId && row.creatorPlatform && det?.platform && row.creatorPlatform !== det.platform && (
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-warning)", margin: "6px 0 0" }}>
                            That is a {platformLabel(row.creatorPlatform)} creator on a{" "}
                            {platformLabel(det.platform)} link — it will still be added, but check it is
                            the right person.
                          </p>
                        )}
                        {problem && !row.check?.inThisCampaign && otherCampaigns.length === 0 && (
                          <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-danger)", margin: "6px 0 0" }}>
                            {problem.message}
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
        <Modal open={true} onClose={() => { setShowRejectModal(null); setRejectionReason(""); }} title="Reject Post" size="sm" footer={
          <div className="cc-modal-footer">
            <Button variant="secondary" onClick={() => { setShowRejectModal(null); setRejectionReason(""); }}>Cancel</Button>
            <Button variant="primary" onClick={handleReject} style={{ background: "#DC2626" }}>Reject Post</Button>
          </div>
        }>
          <div>
            <label htmlFor="reject-reason" style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>Reason (optional)</label>
            <textarea
              id="reject-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Why is this post being rejected?"
              rows={3}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: "var(--cc-t-14)", color: "var(--cc-text)", outline: "none", resize: "vertical" }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
