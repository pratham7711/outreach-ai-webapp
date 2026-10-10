import type { SandboxPostFetcher } from "./tiktokPostSandbox";
import {
  fetchInstagramMetricsGraph,
  InstagramAuthError,
  InstagramNoSuchAccountError,
  InstagramRateLimitError,
  InstagramTimeoutError,
} from "./instagram";
import { fetchInstagramPublicPostMetrics } from "./instagramBusinessDiscovery";
import { readWithDiscoveryToken } from "./instagramDiscoveryTokens";
import {
  fetchYouTubeBatchStats,
  isQuotaExceeded,
  markVideosListExhausted,
  videosListExhausted,
  type BatchStatItem,
} from "./youtubeBatchStats";
import { fetchInstagramEmbedPost } from "./instagramEmbed";
import { fetchTikTokVideosByIds } from "./tiktokDisplay";
import { isRounded, TIKTOK_DISPLAY } from "./precision";
import { fetchTwitchMetrics } from "./twitch";
import type { FacebookPostMatch } from "./facebookPost";
import { readYouTubeWatchPage, readYouTubeWatchPages, type WatchPageCounts } from "./youtubeWatchPage";
import { createLogger } from "../observability/logger";
import { MEDIA_TYPES, detectPlatform, tiktokPageUrl, type MediaType } from "./postUrl";
import type { MetricField } from "../metricDisplay";
import { countersIn } from "../metrics/postWriters";
import { countsContradict } from "../metrics/coherence";

export type FetchMetricsContext = {
  instagramToken?: string;
  instagramHandle?: string;
  /** Business Discovery reads stop at this share of Meta's hourly usage
   *  (POST_SWEEP_STOP_PERCENT from the post sweep). Unset: a person is waiting,
   *  and the read is asked whatever the usage. */
  instagramStopAtPercent?: number;
  /** The org the post belongs to: its own Instagram account reads it, when it has one. */
  instagramOrgId?: string;
  tiktokToken?: string;
  /**
   * Skip the metadata-only fallbacks when the counters could not be had.
   *
   * For a bulk refresh this is the difference between covering a campaign and
   * covering half of it: oEmbed cannot return a single counter, so spending a
   * paced slot on it buys a thumbnail we almost certainly already have, while
   * the post behind it in the queue -- which might have returned real numbers
   * -- never gets reached inside the time budget.
   *
   * Left off for the flows that are adding a post for the first time, where a
   * title and a thumbnail are most of what the card needs and there is only one
   * fetch to pay for.
   */
  countsOnly?: boolean;
  /**
   * An open Vercel Sandbox to read TikTok pages through. Supplied by a bulk
   * refresh, which opens one for the whole run; absent for one-off fetches,
   * where a sandbox boot costs more than the read is worth.
   */
  tiktokSandbox?: SandboxPostFetcher;
  /**
   * The org whose connected Facebook Pages may read this post, and, when known,
   * the creator it is filed under and the Graph id already stored for it. A
   * caller that already matched the link passes `match` so the post is not looked
   * up twice; `match: null` means it looked and found no Page. Absent, a Facebook
   * post is not read at all.
   */
  facebook?: {
    orgId: string;
    creatorId?: string;
    knownPostId?: string | null;
    match?: FacebookPostMatch | null;
  };
};

export type PostMetrics = {
  platform: "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "TWITCH" | "FACEBOOK";
  platformPostId: string;
  thumbnailUrl: string | null;
  caption: string | null;
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  /**
   * TikTok publishes this as `collectCount` -- bookmarks, which CreatorCore's
   * report calls Total Saves. We parsed four counters out of that payload for
   * months and left the fifth sitting next to them, so the tile had no source and
   * a campaign with 1,762 saves reported none.
   *
   * Instagram publishes it as `saved`, but only on the insights edge -- so it
   * arrives for a creator who has connected their account and for nobody else.
   * YouTube's Data API has no equivalent statistic at all (playlist adds live
   * in the Analytics API, which only a channel's owner may call), and no
   * platform we can reach publishes a download count, which is why there is no
   * downloadsCount here: a field nothing can ever fill is worse than an absent
   * one.
   */
  savesCount?: number;
  /**
   * How many distinct accounts saw the post, as opposed to how many times it
   * played.
   *
   * Instagram only, and only for a creator who has connected their account:
   * it comes from the insights endpoint under instagram_manage_insights. No
   * public endpoint and no discovery-based vendor can return it, which makes it
   * the one figure we can show that CreatorCore structurally cannot -- their
   * own exported data carries it for 0 of 18,638 posts.
   *
   * Absent until Meta App Review lands. Absent, never 0: see savesCount above
   * for what writing a zero here would claim.
   */
  reachCount?: number;
  engagementRate?: number;
  /**
   * The post author's follower count, when the payload happened to carry it.
   *
   * Not a property of the post, which is why it is the odd one out here -- but
   * TikTok reports it in the same response as the counters, so a sync that has
   * already paid for the fetch can fill in a creator's followers for free. The
   * campaign roster printed 0 for all 25 creators because nothing had ever
   * written the column.
   */
  authorFollowers?: number;
  /**
   * The account that published the post, when a source named it. Instagram's
   * embed page carries the owner's username beside the counters, and for a
   * post filed with no creator that is the one read that can say whose it is
   * -- see lib/posts/detectCreator. Absent when nothing named the owner; never
   * guessed from the creator the post happens to be filed under.
   */
  authorHandle?: string;
  /**
   * The counters read through the creator's own connection -- their token, on
   * the platform's API -- rather than off a public page. Every other counter
   * here is a public reading. Absent when none was.
   *
   * What lets the writer apply the source order (lib/metrics/postWriters):
   * without it a public scrape an hour after a connected read looked like any
   * other answer and replaced it.
   */
  connectedCounters?: MetricField[];
  /** Absent when the platform did not say. Never today's date as a stand-in. */
  postedAt?: Date;
  /**
   * Why this fetch came back without counts, when it did.
   *
   * Carried on the metrics rather than thrown, because a fetch with no numbers
   * is a normal outcome here, not an error -- and "87 of 88 posts did not
   * update" is unactionable until it can say which of these it was. Absent on a
   * fetch that worked.
   */
  fetchReason?: FetchReason;
};

/**
 * The distinct ways a refresh can come back empty. Stored and counted, so keep
 * the strings stable.
 */
export type FetchReason =
  /** TikTok answered 200 with a WAF page instead of the post. */
  | "platform-challenged"
  /**
   * OUR reader could not run -- every sandbox lane failed -- so nothing ever
   * put the question to the platform.
   *
   * Distinct from platform-challenged on purpose. When a lane dies the caller
   * falls back to this project's function egress, which TikTok refuses by
   * policy; labelling that refusal "blocked by the platform" blames TikTok for
   * our reader being down, and sends whoever is debugging to the wrong place.
   * A fallback that returns a real verdict about the post (deleted, 404) still
   * wins over this -- see NON_VERDICT_REASONS.
   */
  | "reader-unavailable"
  /**
   * OUR deadline ran out before the platform answered.
   *
   * A sibling of reader-unavailable: both say the failure was ours. Separate
   * because the remedy differs -- a dead lane needs a fresh address, a timeout
   * needs a longer budget or fewer round trips -- and because this one used to
   * be filed as "platform-refused", which blamed Meta for our own clock and
   * sent whoever was reading the summary to check a healthy token.
   */
  | "reader-timeout"
  /** The gate is shut, so we never asked. Not a failure -- a deferral. */
  | "backing-off"
  /** The platform says the post is gone. */
  | "post-deleted"
  /** TikTok: the creator set the post to "Only me". It still exists and can come
   *  back, so unlike post-deleted it is never charged and never dead-lettered --
   *  a post that went dark this way is re-read once a day until its tracker
   *  expires. Measured 2026-09-30: TikTok answers statusCode 10204 for both, and
   *  only statusMsg tells them apart ("…&status_self_see" against
   *  "…&status_deleted"); five of the first six posts filed as deleted after the
   *  carousel fix were this. */
  | "post-hidden"
  /** Refused outright: 403, 429, 5xx, or the request threw. */
  | "platform-refused"
  /** We reached it and it simply carries no counters (oEmbed, and similar). */
  | "no-counts-published"
  /** Nothing here recognises the URL. */
  | "unrecognised-url"
  /** A key the deployment does not have. */
  | "not-configured"
  /** The platform rejected the credential we hold: expired, revoked, or short a
   *  scope. Distinct from "platform-refused" (which is about the moment) and
   *  from "not-configured" (which is about a key we never had), because the
   *  remedy is different and belongs to a person: the creator reconnects, or an
   *  operator replaces INSTAGRAM_BUSINESS_TOKEN.
   *
   *  Deliberately NOT in SETTLED_REASONS. An unauthenticated read returns no
   *  counts and so looks exactly like a post with no engagement -- recording
   *  that would stamp lastSyncedAt and report a success -- but it becomes
   *  readable the moment the token is replaced, so it must keep its retries. */
  | "credentials-rejected"
  /** Instagram: Business Discovery has no Business or Creator account under the
   *  name we asked about, so it shares nothing for the post. The account may be
   *  deleted, renamed, personal or private -- Graph answers all of them with the
   *  same error 110 -- and on 2026-09-30, 79 of the 80 posts filed this way no
   *  longer existed on Instagram. Not "post-deleted": the one live post among
   *  them reads the same, and nothing public tells the two apart.
   *
   *  Not charged to the post either. The name is ours to get wrong, and a
   *  charged post is switched off for good after five runs, so a corrected
   *  handle would never be read. */
  | "not-a-professional-account"
  /** Instagram: Business Discovery answered for the account, page after page,
   *  to the end of its library, and the post was on none of them -- and the
   *  embed showed nothing either. Usually the post was deleted or archived; it
   *  can also sit on a different account from the one we hold.
   *
   *  An answer, not a refusal. It used to be filed as "platform-refused", which
   *  the source breaker counts against Instagram: on 2026-10-03 fourteen such
   *  posts at the head of the cron's queue opened the breaker at 00:02Z and the
   *  run skipped every Instagram post behind them, while a campaign's Refresh,
   *  reading only live posts, measured fine. Not charged, for the same reason as
   *  the one above: the name is ours to get wrong. */
  | "not-on-account"
  /** Instagram: as not-on-account, except Instagram still had older media to
   *  offer when the walk stopped at its page limit (MAX_MEDIA_PAGES), so the
   *  post may simply be older than the account's newest 500. Filed as
   *  not-on-account until 2026-10-04, which told the agency it was probably
   *  deleted. Uncharged and an answer, like that one. */
  | "not-in-newest-media"
  /** The reading carried numbers that cannot all be true -- more likes,
   *  comments, shares or saves than views -- so none of it was kept and the
   *  post keeps its last consistent figures. Not charged: the post is fine and
   *  its next reading usually is too. See lib/metrics/coherence. */
  | "counts-inconsistent"
  /** Facebook: the post is not on any Page connected in this org. Facebook shares
   *  a Page post's numbers only with a token for that Page, so there is nobody to
   *  ask until its creator connects. Not a verdict about the post, never charged,
   *  and read again once the Page connects. */
  | "page-not-connected"
  /** Instagram: we hold no account name for the post, so Business Discovery --
   *  the only source of its views -- has nothing to look it up under. The link
   *  names nobody and the platform would not say (a post filed under the
   *  Unattributed row), or the creator it is filed under has no Instagram
   *  handle. Distinct from "not-configured", which this was filed as until
   *  2026-10-10 and which told LKM's report "needs an API key" for posts
   *  Instagram itself would not name. Never charged: it reads the moment a
   *  creator is assigned. */
  | "author-unknown"
  /** A fetcher came back empty without saying why.
   *
   *  Exists so that "we do not know" stops being spelled
   *  "no-counts-published". That slug is a claim about the POST -- it publishes
   *  no counters -- and it is settled, so refreshCampaign never retries it. Any
   *  path that returned empty without naming a reason was inheriting that
   *  verdict by accident, which is how every Instagram post in a campaign came
   *  to read as a post with no engagement and was never asked about again. */
  | "unknown";

/**
 * Does this reason mean the SOURCE went quiet, or that WE did?
 *
 * The distinction is the whole reason an alert on it can be trusted. A sandbox
 * that would not boot, a deadline we blew, a breaker we opened ourselves and a
 * credential we let lapse are all our problems, and paging someone for them at
 * 04:00 is how a monitor gets muted and then ignored. Only a completed round
 * trip that carried no numbers is evidence the platform changed under us --
 * which is exactly what an HTML restructure or a withdrawn endpoint looks like
 * from here: HTTP 200, no error, nothing to parse.
 *
 * Declared total over FetchReason, so a new reason cannot be added without
 * deciding which side of that line it falls on. Adding one without a mapping is
 * a compile error, not a silently un-alerted outage.
 */
const SOURCE_WENT_QUIET: Record<FetchReason, boolean> = {
  /* A round trip that completed and carried nothing. The signature. */
  "no-counts-published": true,
  /* Empty, and not willing to say why -- the shape a 200-with-an-empty-shell
     takes once a parser has found nothing in it. */
  unknown: true,

  /* Ours. */
  "reader-unavailable": false,
  "reader-timeout": false,
  "backing-off": false,
  "not-configured": false,
  "credentials-rejected": false,
  "unrecognised-url": false,

  /* Theirs, but said out loud. A 403, a challenge page or an explicit refusal
     is already visible in the failure counts and needs no second alarm; this
     alert exists for the failure that does not announce itself. */
  "platform-challenged": false,
  "platform-refused": false,

  /* A real verdict about the post, and the commonest one in any large library. */
  "post-deleted": false,
  "post-hidden": false,
  /* A verdict about the account, said out loud as error 110. */
  "not-a-professional-account": false,
  /* The account answered; the post was not on it, or not in its newest pages. */
  "not-on-account": false,
  /* Nobody to ask: no connected Page holds the post. */
  "page-not-connected": false,
  /* Nobody to ask: no account is known to look the post up under. */
  "author-unknown": false,
  "not-in-newest-media": false,
  /* The round trip carried numbers; we refused them. */
  "counts-inconsistent": false,
};

/** True when a reason is evidence the platform stopped answering, not that we did. */
export function isSourceWentQuiet(reason: string | null | undefined): boolean {
  if (!reason) return true;
  return SOURCE_WENT_QUIET[reason as FetchReason] === true;
}

/**
 * Did the platform give us any real number for this post?
 *
 * ANY counter, not views specifically. Requiring views made an Instagram photo
 * post unmeasurable by construction: the Graph API reports `like_count` and
 * `comments_count` for an image and no play count, because an image has none.
 * So a post with 4,100 real likes failed this check, took applyPostMetrics'
 * no-metrics branch, and had those likes thrown away -- then got reported as a
 * post that publishes no counters. Feeds of IG images read as flat zero while
 * the numbers sat in a response we had already paid for.
 *
 * Writing only the present fields is already handled downstream: countsFrom
 * records exactly which counters arrived and applyPostMetrics stores that list
 * under MEASURED_FIELDS_KEY, so the UI can tell "zero likes" from "likes not
 * reported". Nothing here has to invent a views figure to compensate.
 *
 * The engagement-exceeds-views guard stays, but only where it means something --
 * when views are present. A missing views count is not evidence of a bad likes
 * count. See lib/metrics/coherence for why the whole reading is refused.
 */
export function hasMetricCounts(m: PostMetrics): boolean {
  const anyCount =
    typeof m.viewsCount === "number" ||
    typeof m.likesCount === "number" ||
    typeof m.commentsCount === "number" ||
    typeof m.sharesCount === "number" ||
    typeof m.savesCount === "number";
  if (!anyCount) return false;
  return !countsContradict(m);
}

/**
 * Budget for a whole Instagram Graph WALK, as opposed to one round trip.
 *
 * graphGet now gives each request its own 5s budget, so this is the ceiling on
 * the sequence: id resolution plus up to five media pages plus insights. It is
 * larger than the old 8s precisely because 8s was never a walk budget -- it was
 * one request's budget being asked to cover seven, which is why a slow first
 * page returned an empty result for the whole post.
 */
const GRAPH_WALK_TIMEOUT_MS = 20000;

function fetchTimeoutSignal(ms = 8000): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

/* Moved to ./postUrl so the posts screen can read a pasted URL without pulling
   this module -- and everything it fetches from -- into the browser bundle.
   Re-exported here because seventeen call sites import it from this path and
   the split is not their business. */
export { MEDIA_TYPES, detectPlatform };
export type { MediaType };

/**
 * Plan A's answer, or plan B's reading when plan A came back empty.
 *
 * Plan B only ever adds a reading. When it reads nothing too, the post keeps
 * plan A's reason, so retries, breakers and the canary see exactly what they
 * saw before plan B existed. A verdict from plan A ("post-deleted") is never
 * second-guessed.
 */
export async function withWatchPageFallback(
  videoId: string,
  planA: Partial<PostMetrics>,
): Promise<Partial<PostMetrics>> {
  if (!planA.fetchReason || !YOUTUBE_PLAN_B_REASONS.has(planA.fetchReason)) return planA;
  const read = await readYouTubeWatchPage(videoId);
  return read.ok ? mapWatchPageCounts(read.counts) : planA;
}

/** Plan A failures plan B is asked to cover: every one that is about us or the moment, none that is about the video. */
const YOUTUBE_PLAN_B_REASONS: ReadonlySet<FetchReason> = new Set<FetchReason>([
  "not-configured",
  "platform-refused",
  "platform-challenged",
  "credentials-rejected",
  "reader-timeout",
]);

function mapWatchPageCounts(c: WatchPageCounts): Partial<PostMetrics> {
  return {
    thumbnailUrl: null,
    caption: null,
    ...(c.viewsCount !== undefined ? { viewsCount: c.viewsCount } : {}),
    ...(c.likesCount !== undefined ? { likesCount: c.likesCount } : {}),
    ...(c.commentsCount !== undefined ? { commentsCount: c.commentsCount } : {}),
    ...(c.viewsCount !== undefined && c.viewsCount > 0
      ? { engagementRate: (((c.likesCount ?? 0) + (c.commentsCount ?? 0)) / c.viewsCount) * 100 }
      : {}),
    ...(c.postedAt ? { postedAt: c.postedAt } : {}),
  };
}

export async function fetchYouTubeMetrics(videoId: string): Promise<Partial<PostMetrics>> {
  return withWatchPageFallback(videoId, await fetchYouTubeMetricsPlanA(videoId));
}

async function fetchYouTubeMetricsPlanA(videoId: string): Promise<Partial<PostMetrics>> {
  const log = createLogger({ context: { platform: "YOUTUBE", videoId } });
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    log.warn("YOUTUBE_API_KEY not set; plan A has nothing to read with");
    // Settled, not retryable: a missing key is identical on all three sweeps.
    return stubMetrics("not-configured");
  }

  /* videos.list already said its quota is gone today: straight to the
     fallback rather than spending a request to hear the same 403. */
  if (videosListExhausted()) return youtubeStatsFallback(videoId, apiKey);

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoId}&key=${apiKey}`,
      { next: { revalidate: 3600 }, signal: fetchTimeoutSignal() }
    );
    if (!res.ok) {
      const reason = await res.text().catch(() => "");
      log.error("YouTube API request failed", { status: res.status, reason: reason.slice(0, 300) });
      if (isQuotaExceeded(res.status, reason)) {
        await markVideosListExhausted();
        return youtubeStatsFallback(videoId, apiKey);
      }
      return stubMetrics("platform-refused");
    }

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) {
      log.warn("YouTube API returned no video (deleted, private, or invalid id)");
      /* YouTube answering with an empty items[] for a well-formed id is the
         platform stating the video is not there -- the same fact as a TikTok
         404. Settled, so the post can dead-letter instead of being re-asked
         every hour forever. */
      return stubMetrics("post-deleted");
    }
    return mapYouTubeItem(item);
  } catch (err) {
    log.error("YouTube API fetch threw", { error: err instanceof Error ? err.message : String(err) });
    return stubMetrics("platform-refused");
  }
}

function mapYouTubeItem(item: any): Partial<PostMetrics> {
  const stats = item?.statistics ?? {};
  const views = pickOptionalCount(stats.viewCount);
  const likes = pickOptionalCount(stats.likeCount);
  const comments = pickOptionalCount(stats.commentCount);
  const published = item?.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : undefined;
  /* No sharesCount: the Data API has no share statistic at all, so the zero
     this used to write was a reading nobody ever took. A channel that hides its
     like count omits likeCount for the same reason, and Number(undefined) || 0
     turned that into a measured none too. */
  return {
    thumbnailUrl: item?.snippet?.thumbnails?.high?.url ?? null,
    caption: item?.snippet?.title ?? null,
    ...(views !== undefined ? { viewsCount: views } : {}),
    ...(likes !== undefined ? { likesCount: likes } : {}),
    ...(comments !== undefined ? { commentsCount: comments } : {}),
    ...(views !== undefined && views > 0
      ? { engagementRate: (((likes ?? 0) + (comments ?? 0)) / views) * 100 }
      : {}),
    ...(published && !Number.isNaN(published.getTime()) ? { postedAt: published } : {}),
  };
}

/**
 * A videos.batchGetStats entry as metrics (plan §13 B). Counters and the
 * publish time only: that method returns no title and no thumbnail, and the
 * writer keeps the stored ones when these are null. Absent counters stay
 * absent, as in mapYouTubeItem.
 */
function mapYouTubeStatItem(item: BatchStatItem): Partial<PostMetrics> {
  const stats = item?.statistics ?? {};
  const views = pickOptionalCount(stats.viewCount);
  const likes = pickOptionalCount(stats.likeCount);
  const comments = pickOptionalCount(stats.commentCount);
  const published = item?.snippet?.publishTime ? new Date(item.snippet.publishTime) : undefined;
  return {
    thumbnailUrl: null,
    caption: null,
    ...(views !== undefined ? { viewsCount: views } : {}),
    ...(likes !== undefined ? { likesCount: likes } : {}),
    ...(comments !== undefined ? { commentsCount: comments } : {}),
    ...(views !== undefined && views > 0
      ? { engagementRate: (((likes ?? 0) + (comments ?? 0)) / views) * 100 }
      : {}),
    ...(published && !Number.isNaN(published.getTime()) ? { postedAt: published } : {}),
  };
}

/**
 * One video through the fallback. Not returned means not read this time --
 * "platform-refused", which spends no retry -- never "post-deleted": see
 * lib/platforms/youtubeBatchStats.
 */
async function youtubeStatsFallback(videoId: string, apiKey: string): Promise<Partial<PostMetrics>> {
  const { items } = await fetchYouTubeBatchStats([videoId], apiKey);
  const item = items.get(videoId);
  return item ? mapYouTubeStatItem(item) : stubMetrics("platform-refused");
}

export async function fetchYouTubeMetricsBatch(videoIds: string[]): Promise<Map<string, PostMetrics>> {
  const out = new Map<string, PostMetrics>();
  const ids = [...new Set(videoIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return out;

  const log = createLogger({ context: { platform: "YOUTUBE", mode: "batch" } });
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    log.warn("YOUTUBE_API_KEY not set; reading the batch through watch pages", { count: ids.length });
    await fillFromWatchPages(out, ids);
    /* Entered rather than left out, so the caller does not read each one
       again by itself -- through the same plan B that just answered. */
    for (const id of ids) if (!out.has(id)) out.set(id, assemblePostMetrics("YOUTUBE", id, stubMetrics("not-configured")));
    return out;
  }

  /* Chunks videos.list could not answer for quota, read afterwards through
     videos.batchGetStats, which has its own bucket (plan §13 B). */
  const viaFallback: string[] = [];

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (videosListExhausted()) {
      viaFallback.push(...chunk);
      continue;
    }
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${chunk
          .map((id) => encodeURIComponent(id))
          .join(",")}&key=${apiKey}`,
        { next: { revalidate: 3600 }, signal: fetchTimeoutSignal() },
      );
      if (!res.ok) {
        const reason = await res.text().catch(() => "");
        log.error("YouTube batch request failed", {
          status: res.status,
          count: chunk.length,
          reason: reason.slice(0, 300),
        });
        if (isQuotaExceeded(res.status, reason)) {
          await markVideosListExhausted();
          viaFallback.push(...chunk);
        }
        continue;
      }
      const data = await res.json();
      const returned = new Set<string>();
      for (const item of data.items ?? []) {
        if (typeof item?.id !== "string") continue;
        returned.add(item.id);
        out.set(item.id, assemblePostMetrics("YOUTUBE", item.id, mapYouTubeItem(item)));
      }
      for (const id of chunk) {
        // Same verdict as the single-video path above, for the same reason.
        if (!returned.has(id))
          out.set(id, assemblePostMetrics("YOUTUBE", id, stubMetrics("post-deleted")));
      }
    } catch (err) {
      log.error("YouTube batch fetch threw", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (viaFallback.length > 0) {
    const { items, unread } = await fetchYouTubeBatchStats(viaFallback, apiKey);
    for (const [id, item] of items) out.set(id, assemblePostMetrics("YOUTUBE", id, mapYouTubeStatItem(item)));
    /* Entered as unread rather than left out: a post missing from this map is
       read again one by one by the caller, and every one of those would be
       one more call to a fallback that has just said no. "platform-refused"
       is what that per-post read answered on a quota 403 anyway, and it
       spends no retry. */
    for (const id of unread) out.set(id, assemblePostMetrics("YOUTUBE", id, stubMetrics("platform-refused")));
    log.warn("YouTube post stats read through videos.batchGetStats", {
      asked: viaFallback.length,
      answered: items.size,
      unread: unread.length,
    });
  }

  /* Plan B for whatever plan A left unread: chunks that failed outright, and
     the ones the quota fallback could not answer. */
  const unreadIds = ids.filter((id) => {
    const m = out.get(id);
    return !m || (m.fetchReason !== undefined && YOUTUBE_PLAN_B_REASONS.has(m.fetchReason));
  });
  if (unreadIds.length > 0) await fillFromWatchPages(out, unreadIds);
  return out;
}

/** Reads these ids through watch pages and enters each one that answered. The rest are left as they were. */
async function fillFromWatchPages(out: Map<string, PostMetrics>, ids: string[]): Promise<void> {
  const reads = await readYouTubeWatchPages(ids);
  for (const [id, read] of reads) {
    if (read.ok) out.set(id, assemblePostMetrics("YOUTUBE", id, mapWatchPageCounts(read.counts)));
  }
}

export function reasonFromLookup(lookup: TikTokPostLookup): FetchReason {
  if (lookup.state === "deleted") return "post-deleted";
  if (lookup.state === "hidden") return "post-hidden";
  if (lookup.reason === "breaker-open") return "backing-off";
  if (lookup.reason === "no-parsable-payload") return "platform-challenged";
  return "platform-refused";
}

/**
 * Reasons that state nothing about the post itself -- only that the attempt
 * came back empty. These are the ones a dead lane is allowed to overwrite,
 * because a refusal from our fallback egress is not evidence either way.
 * "post-deleted" and the rest are positive verdicts and always survive.
 */
const NON_VERDICT_REASONS: ReadonlySet<FetchReason> = new Set<FetchReason>([
  "platform-challenged",
  "platform-refused",
  /* The gate is ours, so a gate that refused us is our reader being unavailable
     -- not a deferral the post should be labelled with. Without this, a run
     whose lanes had died reported "110 skipped while backing off", which reads
     as politeness toward TikTok when it was actually our own breaker, latched
     by our own dead lanes, describing an egress the run never wanted. */
  "backing-off",
]);

/**
 * Reasons that must never spend a post's retry budget.
 *
 * A superset of NON_VERDICT_REASONS, and answering a different question. That
 * set decides ATTRIBUTION inside one fetch -- whose failure was this. This one
 * decides CONSEQUENCE across runs: whether the failure is allowed to count
 * toward switching the post off.
 *
 * Everything here is a statement about us, or about the moment, and never about
 * the post: a shut gate we never asked through, a WAF challenge to our egress,
 * a dead sandbox lane, a token that lapsed, a key the deployment never had. A
 * post whose creator reconnects, or whose next read comes from a fresh address,
 * measures fine -- so charging any of these toward MAX_SYNC_FAILURES switches
 * off a healthy post, permanently, for something it did not do.
 *
 * Deliberately absent, and still chargeable: "no-counts-published" (a claim
 * about the post), "unknown" (unexplained, so it still deserves a bound), and
 * the settled verdicts "post-deleted" / "unrecognised-url", which go straight
 * to the dead letter rather than spending five runs re-confirming themselves.
 */
export const UNCHARGEABLE_REASONS: ReadonlySet<FetchReason> = new Set<FetchReason>([
  "platform-challenged",
  "platform-refused",
  "backing-off",
  "reader-unavailable",
  "reader-timeout",
  "credentials-rejected",
  "not-configured",
  /* About a name we chose, not about the post -- see the reason's own note. */
  "not-a-professional-account",
  "not-on-account",
  "not-in-newest-media",
  /* The creator can undo it, and a dead letter is forever. */
  "post-hidden",
  /* Readable the moment the Page connects. */
  "page-not-connected",
  /* Readable the moment its creator is found, which every read tries. */
  "author-unknown",
  /* A reading we refused is about the reading. On 2026-10-02 four live posts
     were switched off for good this way, filed as "unknown". */
  "counts-inconsistent",
]);

/**
 * Whose failure was it: TikTok's, or ours?
 *
 * Ordered by what each attempt actually establishes. A refusal the sandbox got
 * from TikTok outranks anything the fallback egress says, because the sandbox
 * is the egress TikTok answers. Failing that, a dead lane means we never asked,
 * so a non-verdict from the fallback is reported as our reader being down
 * rather than as the platform blocking us.
 */
export function attributeFailure(
  fallbackReason: FetchReason,
  origin: { laneFailed: boolean; sandboxRefusal: FetchReason | null },
): FetchReason {
  if (origin.sandboxRefusal) return origin.sandboxRefusal;
  if (origin.laneFailed && NON_VERDICT_REASONS.has(fallbackReason)) return "reader-unavailable";
  return fallbackReason;
}

export async function fetchTikTokMetrics(
  url: string,
  videoId?: string,
  accessToken?: string,
  countsOnly = false,
  sandbox?: SandboxPostFetcher,
): Promise<Partial<PostMetrics>> {
  if (videoId && accessToken) {
    const viaDisplay = await fetchTikTokMetricsDisplay(videoId, accessToken);
    /* Accepted only if it actually carries counts. video.query answering with
       the video but no counters is no longer coerced into zeros, so an empty
       stats block would otherwise return a countless object here and skip the
       sandbox and oEmbed paths below -- which is a step backwards, because the
       sandbox reads the public page and frequently does have the numbers.
       Thumbnail and caption are not worth forfeiting a counted read for. */
    if (viaDisplay && hasMetricCounts(viaDisplay as PostMetrics)) {
      return { ...viaDisplay, connectedCounters: countersIn(viaDisplay) };
    }
  }

  /* Sandbox first, not as a fallback. TikTok answers it and refuses this
     project's function egress, so trying direct first would spend a paced slot
     to be told no about three times in four, and would feed the breaker
     challenges that describe an egress this run is not even using. Null means
     the sandbox failed rather than TikTok refusing, so the direct path below
     still gets its turn. */
  /* Which of the two failures the sandbox had, kept apart. A null answer is our
     lane dying; an "unavailable" answer is TikTok refusing an egress it does
     answer for other posts -- the only one of the two that is evidence about
     the platform. */
  let laneFailed = false;
  let sandboxRefusal: FetchReason | null = null;
  if (sandbox) {
    const viaSandbox = await sandbox.readPost(url);
    if (viaSandbox?.metrics) return tiktokMetricsToPartial(viaSandbox.metrics);
    if (viaSandbox && isGoneFromPublic(viaSandbox)) return stubMetrics(reasonFromLookup(viaSandbox));
    if (viaSandbox === null) laneFailed = true;
    else if (viaSandbox.state === "unavailable") sandboxRefusal = reasonFromLookup(viaSandbox);
  }

  /* Still attempted after a dead lane -- this egress answers about one time in
     four, and throwing that away to save a request would cost real coverage --
     but its outcome is not allowed to move the shared breaker. See the options
     docblock on lookupTikTokPost: a lane dying says nothing about how this
     egress is standing with TikTok, and letting it latch the gate is what
     turned 12 failures into 110 posts reported as backing off. */
  const lookup = await lookupTikTokPost(url, { recordToGate: !laneFailed });
  if (lookup.metrics) return tiktokMetricsToPartial(lookup.metrics);
  const reason = attributeFailure(reasonFromLookup(lookup), { laneFailed, sandboxRefusal });

  const viaSocialKit = await fetchTikTokMetricsSocialKit(url);
  if (viaSocialKit) return viaSocialKit;

  /* Three reasons not to go on to oEmbed. A deleted or hidden post is a settled
     answer and asking a second endpoint will not bring it back; backing off has to mean
     the host, not one endpoint on it; and a bulk refresh would rather spend the
     slot on the next post than on a thumbnail. */
  if (isGoneFromPublic(lookup) || reason === "backing-off" || countsOnly) {
    return stubMetrics(reason);
  }

  const viaOEmbed = await fetchTikTokOEmbed(url);
  /* oEmbed answering does not mean the refresh succeeded, so the reason from
     the attempt that could have carried counts is the one worth keeping. */
  return { ...viaOEmbed, fetchReason: reason };
}

// video.query only returns posts owned by the token's account, so a post by a
// different creator falls through to the paid/oEmbed paths below.
async function fetchTikTokMetricsDisplay(
  videoId: string,
  accessToken: string,
): Promise<Partial<PostMetrics> | null> {
  const videos = await fetchTikTokVideosByIds(accessToken, [videoId]);
  const video = videos.find((v) => v.id === videoId);
  if (!video) return null;

  /* video.exact, not video.viewsCount: the flat fields are num()-coerced for
     display, so an absent counter reads as 0 there. Writing that 0 would make
     it a measured zero forever (see TikTokVideo.exact). */
  const { views, likes, comments, shares, createdAt } = video.exact;
  return {
    thumbnailUrl: video.coverImageUrl,
    caption: video.description || video.title || null,
    ...(views !== undefined ? { viewsCount: views } : {}),
    ...(likes !== undefined ? { likesCount: likes } : {}),
    ...(comments !== undefined ? { commentsCount: comments } : {}),
    ...(shares !== undefined ? { sharesCount: shares } : {}),
    /* Only when it can be computed from real numbers. A rate derived from a
       coerced 0 views is not 0% engagement, it is no answer. */
    ...(views !== undefined && views > 0 && likes !== undefined && comments !== undefined
      ? { engagementRate: ((likes + comments) / views) * 100 }
      : {}),
    // No invented date. postedAt is left alone unless TikTok stated create_time.
    ...(createdAt ? { postedAt: createdAt } : {}),
  };
}

export type TikTokDirectMetrics = {
  /* Optional, because every field in TikTok's stats block is. A missing one used
     to arrive here as 0 and be written as a measured zero. */
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  /** The post author's follower count, which the same payload reports under
   *  authorStats -- free, since we have already paid for this fetch. */
  authorFollowers?: number;
  /** TikTok's collectCount: bookmarks, which the client report calls saves. */
  savesCount?: number;
  caption: string | null;
  thumbnailUrl: string | null;
  postedAt: Date | null;
};

export const TIKTOK_REHYDRATION_RE =
  /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;

export const TIKTOK_DIRECT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type RateGateOptions = {
  minGapMs: number;
  jitterMs: number;
  breakerThreshold: number;
  breakerCooldownMs: number;
  /**
   * How many challenges in a row before we stop for a while.
   *
   * Far higher than breakerThreshold, and answering a different question. A
   * challenge is TikTok's ordinary reply to a datacenter IP -- roughly three in
   * four of ours come back that way, and the other one in four carries real
   * numbers -- so a run of them says nothing about whether we are in trouble.
   * Five in a row is unremarkable at that rate and used to latch a fifteen
   * minute blackout; the run then skipped every post it had left. This
   * threshold is only there to stop a pointless grind when the channel really
   * is dead, which is what a long unbroken streak means.
   */
  challengeThreshold: number;
  challengeCooldownMs: number;
};

export type RateGate = {
  acquire: () => Promise<boolean>;
  recordSuccess: () => void;
  /** 200 OK, no usable payload: TikTok's WAF, not a verdict on our behaviour. */
  recordChallenged: () => void;
  /** 403/429/5xx or a thrown request: the channel telling us to stop. */
  recordBlocked: () => void;
  isOpen: (now?: number) => boolean;
};

export function createRateGate(options: RateGateOptions): RateGate {
  let nextAllowedAt = 0;
  let consecutiveBlocked = 0;
  let consecutiveChallenged = 0;
  let breakerUntil = 0;

  function isOpen(now = Date.now()): boolean {
    return now < breakerUntil;
  }

  function open(cooldownMs: number) {
    breakerUntil = Date.now() + cooldownMs;
    consecutiveBlocked = 0;
    consecutiveChallenged = 0;
  }

  return {
    isOpen,
    async acquire() {
      const now = Date.now();
      if (isOpen(now)) return false;

      const waitMs = Math.max(0, nextAllowedAt - now);
      const gap = options.minGapMs + Math.floor(Math.random() * options.jitterMs);
      nextAllowedAt = Math.max(now, nextAllowedAt) + gap;
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      return true;
    },
    recordSuccess() {
      consecutiveBlocked = 0;
      consecutiveChallenged = 0;
    },
    recordChallenged() {
      /* Deliberately does not touch consecutiveBlocked. Mixing the two is what
         made a normal afternoon of WAF pages look like a ban and stopped the
         fetcher for a quarter of an hour at a time. */
      consecutiveChallenged += 1;
      if (consecutiveChallenged >= options.challengeThreshold) {
        open(options.challengeCooldownMs);
      }
    },
    recordBlocked() {
      consecutiveBlocked += 1;
      if (consecutiveBlocked >= options.breakerThreshold) {
        open(options.breakerCooldownMs);
      }
    },
  };
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

const tiktokGate = createRateGate({
  minGapMs: envInt("TIKTOK_FETCH_MIN_GAP_MS", 1500),
  jitterMs: envInt("TIKTOK_FETCH_JITTER_MS", 600),
  breakerThreshold: envInt("TIKTOK_FETCH_BREAKER_THRESHOLD", 5),
  breakerCooldownMs: envInt("TIKTOK_FETCH_BREAKER_COOLDOWN_MS", 15 * 60 * 1000),
  /* Thirty in a row, at a measured challenge rate around three in four, is
     about a one-in-fifty-thousand accident -- so it means the channel is
     genuinely shut, not that we hit a bad patch. Five minutes rather than
     fifteen, because a challenge is not an accusation and the next refresh
     should not inherit most of a blackout. */
  challengeThreshold: envInt("TIKTOK_FETCH_CHALLENGE_THRESHOLD", 30),
  challengeCooldownMs: envInt("TIKTOK_FETCH_CHALLENGE_COOLDOWN_MS", 5 * 60 * 1000),
});

export function isBlockedStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

export function pickCount(...values: unknown[]): number {
  let best = 0;
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

/**
 * The same, but absent stays absent.
 *
 * pickCount answers 0 when nothing was numeric, which reads downstream as a
 * counter we measured at zero -- and every field in TikTok's stats block is
 * optional, so a payload missing one would have been recorded as a real zero.
 * See fieldMetricValue in lib/metricDisplay for what depends on the difference.
 */
export function pickOptionalCount(...values: unknown[]): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n) && (best === undefined || n > best)) best = n;
  }
  return best;
}

function finiteCount(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * TikTok's exact figure where it publishes one, its rounded one otherwise.
 *
 * stats vs statsV2 is the same trap tiktokProfile.exactCount and
 * tiktokTopPostsBrowser already document: `stats` carries the number TikTok
 * RENDERS -- the 15.5M / 167.2K / 11.1K on the page, three or four significant
 * figures -- and `statsV2` carries the real one, as strings. Reading the pair
 * with pickOptionalCount, which answers the LARGER, is how a post with 11,094
 * views came to be stored as 11,100: the rounded figure is the bigger of the
 * two whenever TikTok rounds up, and it was then written as if measured.
 *
 * Measured on 2026-09-15 against the 87 TikTok posts this path has written
 * (Post.platformMetrics carrying __lastFetch): every one of the 29 with
 * >= 10,000 views was stored at TikTok's display precision, as were all 5 like
 * counts and all 4 share counts over that threshold, while every counter below
 * 10,000 -- where TikTok prints the digits -- was exact. 235,138 saves came
 * through exact in the same payload as 15,500,000 views, which is what says the
 * exact figures were there to be read.
 *
 * `> 0` rather than merely present, and stats consulted before an exact zero is
 * accepted: TikTok zeroes one block or the other, and a zero from either is
 * only believable when nothing else in the payload contradicts it. An absent
 * counter still stays absent -- see pickOptionalCount for why that matters.
 */
export function pickExactCount(exact: unknown, rounded: unknown): number | undefined {
  const precise = finiteCount(exact);
  if (precise !== undefined && precise > 0) return precise;
  const displayed = finiteCount(rounded);
  return displayed !== undefined ? displayed : precise;
}

/**
 * The size of the bucket TikTok's rendered figure stands for, or null below the
 * threshold where it prints the digits. TikTok's ladder specifically -- every
 * platform's lives in ./precision, which is where a non-TikTok caller should go.
 */
export function displayRoundingStep(value: number): number | null {
  return TIKTOK_DISPLAY(value);
}

/** Whether a counter is at TikTok's display precision rather than exact. */
export function isDisplayRounded(value: number | undefined): boolean {
  return isRounded(value, TIKTOK_DISPLAY);
}

// TikTok answers a deleted post with a normal 200 and a rehydration payload
// carrying a non-zero statusCode (10204 "item doesn't exist"). That is a
// perfectly healthy response, so callers must not mistake it for being blocked.
// Returns null when there is no payload at all, which IS the blocked/changed
// -markup case.
export function parseTikTokDetailStatus(html: string): number | null {
  const detail = tiktokVideoDetail(html);
  return typeof detail?.statusCode === "number" ? detail.statusCode : null;
}

function tiktokVideoDetail(html: string): { statusCode?: unknown; statusMsg?: unknown } | null {
  const match = html.match(TIKTOK_REHYDRATION_RE);
  if (!match) return null;
  try {
    return JSON.parse(match[1])?.__DEFAULT_SCOPE__?.["webapp.video-detail"] ?? null;
  } catch {
    return null;
  }
}

/* The one privacy status measured (2026-09-30). Any other non-zero status is
   still read as deleted, as it always was. */
const HIDDEN_BY_CREATOR_RE = /status_self_see/;

export function parseTikTokRehydration(html: string): TikTokDirectMetrics | null {
  const match = html.match(TIKTOK_REHYDRATION_RE);
  if (!match) return null;

  let payload: any;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const detail = payload?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
  if (!detail) return null;
  if (typeof detail.statusCode === "number" && detail.statusCode !== 0) return null;

  return metricsFromItemStruct(detail.itemInfo?.itemStruct);
}

/**
 * One item, however we came by it.
 *
 * The server-rendered page and TikTok's own JSON endpoint carry the same
 * itemStruct, so the reader is shared: the transports differ in what they are
 * served, not in what the payload means.
 */
export function metricsFromItemStruct(item: any): TikTokDirectMetrics | null {
  const stats = item?.stats;
  const statsV2 = item?.statsV2;
  if (!item || (!stats && !statsV2)) return null;

  const createTime = Number(item.createTime);

  return {
    viewsCount: pickExactCount(statsV2?.playCount, stats?.playCount),
    likesCount: pickExactCount(statsV2?.diggCount, stats?.diggCount),
    commentsCount: pickExactCount(statsV2?.commentCount, stats?.commentCount),
    sharesCount: pickExactCount(statsV2?.shareCount, stats?.shareCount),
    savesCount: pickExactCount(statsV2?.collectCount, stats?.collectCount),
    authorFollowers: pickExactCount(
      item?.authorStatsV2?.followerCount,
      item?.authorStats?.followerCount
    ),
    caption: typeof item.desc === "string" && item.desc.length > 0 ? item.desc : null,
    thumbnailUrl: item.video?.cover ?? item.video?.originCover ?? null,
    postedAt: Number.isFinite(createTime) && createTime > 0 ? new Date(createTime * 1000) : null,
  };
}

/**
 * What TikTok told us about a post, as opposed to merely whether we got counts.
 *
 * - `live`        the post exists and `metrics` is populated
 * - `deleted`     TikTok answered normally and said the item is gone
 * - `hidden`      TikTok answered normally and said the creator made it
 *                 "Only me"; the post exists and may come back
 * - `unavailable` we could not get a usable answer: blocked, rate-gated,
 *                 timed out, or the page shape changed. Says nothing about
 *                 whether the post exists.
 */
export type TikTokPostState = "live" | "deleted" | "hidden" | "unavailable";

/** TikTok answered, about this post, that the public cannot see it. */
export function isGoneFromPublic(lookup: TikTokPostLookup): boolean {
  return lookup.state === "deleted" || lookup.state === "hidden";
}

export type TikTokPostLookup = {
  state: TikTokPostState;
  /** TikTok's own status code when it gave us one. 0 means live. */
  statusCode: number | null;
  /** Why we could not tell, for `unavailable` only. */
  reason: string | null;
  metrics: TikTokDirectMetrics | null;
};

/**
 * Turns a TikTok video-detail page into a lookup, with no opinion about where
 * the HTML came from.
 *
 * Split out from lookupTikTokPost because there are now two egresses that both
 * ask TikTok the same question and must read the answer identically: this
 * project's function egress, which TikTok's WAF answers with a login shell
 * about three times in four, and a Vercel Sandbox, which it answers properly.
 * Only the transport differs, and only the transport should.
 *
 * Deliberately free of gate bookkeeping -- the circuit breaker describes one
 * egress's standing with TikTok, and a sandbox read must not close it or hold
 * it open.
 */
export function readTikTokPostHtml(html: string): TikTokPostLookup {
  const parsed = parseTikTokRehydration(html);
  if (parsed) return { state: "live", statusCode: 0, reason: null, metrics: parsed };

  const detail = tiktokVideoDetail(html);
  const statusCode = typeof detail?.statusCode === "number" ? detail.statusCode : null;
  if (statusCode !== null && statusCode !== 0) {
    const hidden = typeof detail?.statusMsg === "string" && HIDDEN_BY_CREATOR_RE.test(detail.statusMsg);
    return { state: hidden ? "hidden" : "deleted", statusCode, reason: null, metrics: null };
  }
  return { state: "unavailable", statusCode: null, reason: "no-parsable-payload", metrics: null };
}

export async function lookupTikTokPost(
  url: string,
  /**
   * Whether this attempt's outcome may move the shared breaker.
   *
   * tiktokGate is a module-level singleton: one per serverless instance, shared
   * by every campaign, every org and the cron. That is correct when this
   * function IS the reader -- five refusals in a row really should stop us
   * knocking. It is wrong when this call is only a fallback after a sandbox
   * lane died, because then the failure describes an egress the run was not
   * even meant to use, and latching on it stops the healthy lanes too.
   *
   * Measured: 12 dead lanes became 110 posts reported as "backing off", none of
   * which was ever asked. Pacing still applies either way -- acquire() is not
   * conditional -- so this only suppresses the bookkeeping, never the courtesy.
   */
  options: { recordToGate?: boolean } = {},
): Promise<TikTokPostLookup> {
  const log = createLogger({ context: { platform: "TIKTOK", url } });
  const recordToGate = options.recordToGate ?? true;
  const gate = {
    blocked: () => recordToGate && tiktokGate.recordBlocked(),
    challenged: () => recordToGate && tiktokGate.recordChallenged(),
    success: () => recordToGate && tiktokGate.recordSuccess(),
  };

  if (!(await tiktokGate.acquire())) {
    log.warn("TikTok direct fetch skipped; breaker open");
    return { state: "unavailable", statusCode: null, reason: "breaker-open", metrics: null };
  }

  try {
    const res = await fetch(tiktokPageUrl(url), {
      headers: {
        "User-Agent": TIKTOK_DIRECT_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: fetchTimeoutSignal(15000),
    });
    if (!res.ok) {
      if (isBlockedStatus(res.status)) gate.blocked();
      else gate.success();
      log.warn("TikTok direct fetch returned non-OK", { status: res.status });
      return {
        state: "unavailable",
        statusCode: null,
        reason: `http-${res.status}`,
        metrics: null,
      };
    }

    const html = await res.text();
    const lookup = readTikTokPostHtml(html);

    if (isGoneFromPublic(lookup)) {
      // A removed post answers 200 with a non-zero statusCode. Counting that as
      // a block let five deleted posts in a row latch the breaker for 15
      // minutes and stall every healthy fetch behind them.
      gate.success();
      log.warn("TikTok says this post is not public", { state: lookup.state, statusCode: lookup.statusCode });
      return lookup;
    }
    if (lookup.state === "unavailable") {
      gate.challenged();
      log.warn("TikTok direct fetch could not parse rehydration payload");
      return lookup;
    }

    gate.success();
    return lookup;
  } catch (err) {
    gate.blocked();
    log.error("TikTok direct fetch threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      state: "unavailable",
      statusCode: null,
      reason: err instanceof Error ? err.name : "fetch-threw",
      metrics: null,
    };
  }
}

export function tiktokMetricsToPartial(parsed: TikTokDirectMetrics): Partial<PostMetrics> {
  const views = parsed.viewsCount;
  const likes = parsed.likesCount;
  const comments = parsed.commentsCount;
  /* Only the fields TikTok sent, so an absent counter stays absent all the way
     to the write -- see countsFrom in lib/sync/syncPost. */
  return {
    thumbnailUrl: parsed.thumbnailUrl,
    caption: parsed.caption,
    ...(typeof views === "number" ? { viewsCount: views } : {}),
    ...(typeof likes === "number" ? { likesCount: likes } : {}),
    ...(typeof comments === "number" ? { commentsCount: comments } : {}),
    ...(typeof parsed.sharesCount === "number" ? { sharesCount: parsed.sharesCount } : {}),
    ...(typeof parsed.savesCount === "number" ? { savesCount: parsed.savesCount } : {}),
    ...(typeof parsed.authorFollowers === "number" ? { authorFollowers: parsed.authorFollowers } : {}),
    ...(typeof views === "number" && views > 0
      ? { engagementRate: (((likes ?? 0) + (comments ?? 0)) / views) * 100 }
      : {}),
    postedAt: parsed.postedAt ?? undefined,
  };
}

async function fetchTikTokMetricsDirect(url: string): Promise<Partial<PostMetrics> | null> {
  const lookup = await lookupTikTokPost(url);
  return lookup.metrics ? tiktokMetricsToPartial(lookup.metrics) : null;
}

async function fetchTikTokMetricsSocialKit(url: string): Promise<Partial<PostMetrics> | null> {
  const log = createLogger({ context: { platform: "TIKTOK", url } });
  const apiKey = process.env.SOCIALKIT_API_KEY;
  if (!apiKey) {
    log.debug("SOCIALKIT_API_KEY not set; falling back to oEmbed (no metric counts)");
    return null;
  }

  try {
    const endpoint = `https://api.socialkit.dev/tiktok/stats?access_key=${encodeURIComponent(
      apiKey,
    )}&url=${encodeURIComponent(url)}`;
    const res = await fetch(endpoint, {
      next: { revalidate: 3600 },
      signal: fetchTimeoutSignal(15000),
    });
    if (!res.ok) {
      const reason = await res.text().catch(() => "");
      log.error("SocialKit TikTok stats request failed", {
        status: res.status,
        reason: reason.slice(0, 300),
      });
      return null;
    }

    const json = await res.json();
    const data = json?.data;
    if (json?.success !== true || !data) {
      log.warn("SocialKit returned no data for TikTok video", { success: json?.success });
      return null;
    }

    const views = pickOptionalCount(data.views);
    const likes = pickOptionalCount(data.likes);
    const comments = pickOptionalCount(data.comments);
    const shares = pickOptionalCount(data.shares);
    const published = data.publishedAt ? new Date(data.publishedAt) : undefined;

    return {
      thumbnailUrl: data.thumbnailUrl ?? null,
      caption: data.title ?? data.description ?? null,
      ...(views !== undefined ? { viewsCount: views } : {}),
      ...(likes !== undefined ? { likesCount: likes } : {}),
      ...(comments !== undefined ? { commentsCount: comments } : {}),
      ...(shares !== undefined ? { sharesCount: shares } : {}),
      ...(views !== undefined && views > 0
        ? { engagementRate: (((likes ?? 0) + (comments ?? 0)) / views) * 100 }
        : {}),
      ...(published && !Number.isNaN(published.getTime()) ? { postedAt: published } : {}),
    };
  } catch (err) {
    log.error("SocialKit TikTok fetch threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * The cover alone, for a post whose numbers we are not asking for.
 *
 * TikTok signs every cover URL with an `x-expires` a few days out, so a stored
 * one rots: measured in production on 2026-09-06, 14 of 14 signed TikTok covers
 * had already expired and the whole post grid painted blank boxes. Refreshing
 * the picture does not need the sandbox that reading the counters needs -- this
 * is the plain oEmbed endpoint, behind the same breaker as everything else on
 * the host, and it returns a fresh signature.
 *
 * Deliberately returns only the URL. A caller that wanted counters would use
 * fetchPostMetrics; letting this one write anything else would make a cheap
 * cosmetic refresh look like a measurement and reset the cadence with it.
 */
export async function refreshTikTokCover(url: string): Promise<string | null> {
  const { thumbnailUrl } = await fetchTikTokOEmbed(url);
  return thumbnailUrl ?? null;
}

async function fetchTikTokOEmbed(url: string): Promise<Partial<PostMetrics>> {
  /* Same host, same gate. This ran ungated, which quietly inverted the breaker:
     the moment it latched, every remaining post skipped the paced path and went
     straight to oembed instead -- so a 88-post refresh that decided it was being
     blocked answered by firing ~79 unpaced requests at tiktok.com inside two
     seconds. Backing off has to mean backing off from the host, not from one
     endpoint on it, and a breaker that is open is a reason to stop rather than a
     reason to try a different door. */
  if (!(await tiktokGate.acquire())) return stubMetrics("backing-off");

  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: fetchTimeoutSignal(),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        thumbnailUrl: data.thumbnail_url ?? null,
        caption: data.title ?? null,
        /* oEmbed is a title and a picture. It reaching us is not the post's
           numbers reaching us, and reporting it as a plain empty result is what
           made a blocked campaign look like a campaign of posts with no
           engagement. */
        fetchReason: "no-counts-published",
      };
    }
  } catch {
    // fall through
  }
  return stubMetrics("platform-refused");
}

/**
 * Every Instagram source, merged -- not the first one that answers.
 *
 * This used to `return` inside each branch, and that early return was the live
 * bug. Business Discovery drops like_count whenever a creator hides their
 * likes, so it answers with views and comments and no likes; the function
 * returned right there, and the like figure was never asked of anything else.
 * Production showed it exactly: two of three Instagram posts carried
 * `__measured: ["views","comments"]` and reported no likes, while the captioned
 * embed had the real number sitting there for the asking -- 1428 on the third
 * post, matching Business Discovery's own figure to the digit.
 *
 * So the sources are now ranked by trust and each one fills only the holes the
 * ones above it left:
 *
 *   1. Graph, with the creator's own token -- their own post, their own numbers
 *   2. Business Discovery, with our business token -- official, but partial
 *   3. The captioned embed -- unofficial, credential-free, fills what is left
 *
 * A field written by a higher source is never overwritten by a lower one, so
 * adding the scrape cannot degrade an official number. And a source failing
 * outright no longer costs us the fields the next one could have supplied.
 */
export async function fetchInstagramMetrics(
  url: string,
  token?: string,
  handle?: string,
  stopAtPercent?: number,
  orgId?: string,
): Promise<Partial<PostMetrics>> {
  const log = createLogger({ context: { platform: "INSTAGRAM" } });
  const merged: Partial<PostMetrics> = {};
  const sources: string[] = [];

  /* First writer wins. `undefined` is not a value here: an absent counter has
     to stay absent so the next source down can still fill it, which is the
     same absent-is-not-zero rule the writer downstream depends on. */
  const fill = (source: string, patch: Partial<PostMetrics>): boolean => {
    let used = false;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null) continue;
      if (merged[key as keyof PostMetrics] !== undefined) continue;
      (merged as Record<string, unknown>)[key] = value;
      used = true;
    }
    if (used) sources.push(source);
    return used;
  };

  const counted = (): boolean =>
    typeof merged.viewsCount === "number" ||
    typeof merged.likesCount === "number" ||
    typeof merged.commentsCount === "number";

  /* Set when a platform REJECTED a credential, as distinct from answering
     without numbers. Both arrive here as an absence of counts, and only this
     tells them apart. */
  let authFailed = false;
  /* Set when OUR deadline ended the attempt. Kept apart from authFailed for the
     same reason authFailed exists: all three arrive here as an absence of
     counts, and only these flags say which. */
  let timedOut = false;
  /* Set when Business Discovery said there is no Business or Creator account
     under `handle`. The embed below still runs, but it has been closed since
     2026-09-17, so in practice this decides the reason. */
  let noSuchAccount = false;
  /* Set when Business Discovery answered every page it was asked for and the
     post was on none of them; see "not-on-account". */
  let notOnAccount = false;
  /* Set when it answered every page it was asked for, none held the post, and
     it still had older media; see "not-in-newest-media". */
  let pastLookupDepth = false;
  let bizRateLimited = false;

  if (token) {
    let graph: Awaited<ReturnType<typeof fetchInstagramMetricsGraph>> = null;
    try {
      graph = await fetchInstagramMetricsGraph(url, token, fetchTimeoutSignal(GRAPH_WALK_TIMEOUT_MS));
    } catch (err) {
      if (err instanceof InstagramTimeoutError) {
        /* Keep going: Business Discovery and the embed are separate endpoints
           with their own budgets, and the most common shape of this failure is
           one slow page rather than Meta being unreachable. */
        timedOut = true;
        createLogger({ context: { platform: "INSTAGRAM", call: "graph.metrics" } }).warn(
          "Graph walk timed out; trying the remaining sources",
          { path: err.path },
        );
      } else {
      if (!(err instanceof InstagramAuthError)) throw err;
      // The creator's token is dead. Business Discovery uses our own token and
      // may still answer, so keep going — but remember, so a dry result is not
      // reported as a successful read.
      authFailed = true;
      createLogger({ context: { platform: "INSTAGRAM", call: "graph.metrics" } }).warn(
        "Instagram token rejected; connection needs re-authorisation",
        { status: err.status, code: err.code },
      );
      }
    }
    if (graph) {
      fill("graph", {
        thumbnailUrl: graph.thumbnailUrl,
        caption: graph.caption,
        ...(typeof graph.viewsCount === "number" ? { viewsCount: graph.viewsCount } : {}),
        ...(typeof graph.likesCount === "number" ? { likesCount: graph.likesCount } : {}),
        ...(typeof graph.commentsCount === "number" ? { commentsCount: graph.commentsCount } : {}),
        ...(typeof graph.reachCount === "number" ? { reachCount: graph.reachCount } : {}),
        /* Shares and saves arrive from the insights edge and from nowhere else:
           no public Instagram endpoint publishes either, which is why the two
           sources below still cannot fill them and why a post read without the
           creator's own token has neither. Present here means measured -- an
           absent metric stays absent rather than becoming a 0 that asserts a
           reading nobody took. */
        ...(typeof graph.sharesCount === "number" ? { sharesCount: graph.sharesCount } : {}),
        ...(typeof graph.savesCount === "number" ? { savesCount: graph.savesCount } : {}),
        postedAt: graph.postedAt,
      });
    }
  }

  /* Graph runs first and is the only source read with the creator's own token,
     so whatever is filled at this point came from their connection; every
     counter the sources below add is a public reading. */
  const viaGraph = countersIn(merged);

  /* Whether a Business Discovery token existed to ask with -- the verdict
     below needs it, and the chooser is what knows. Set on any outcome but
     "no-credentials", a throw included. */
  let bizAttempted = false;
  if (handle) {
    let post: Awaited<ReturnType<typeof fetchInstagramPublicPostMetrics>> = null;
    bizAttempted = true;
    try {
      /* Token A, or the standby B while A is limited (plan §13 B). Each attempt
         gets its own walk budget, so a retry on B is not starved by A's. */
      const read = await readWithDiscoveryToken(
        (cred) =>
          fetchInstagramPublicPostMetrics(handle, url, cred.token, fetchTimeoutSignal(GRAPH_WALK_TIMEOUT_MS), {
            rateLimitThrows: true,
            ...cred.graphOptions,
            onNotOnAccount: () => {
              notOnAccount = true;
            },
            onPastLookupDepth: () => {
              pastLookupDepth = true;
            },
          }),
        { stopAtPercent, orgId },
      );
      if (read.ok) post = read.value;
      else bizAttempted = false;
    } catch (err) {
      if (err instanceof InstagramRateLimitError) {
        bizRateLimited = true;
        /* Every token is limited. The same outcome a throttle always had on
           this path -- no counts from here, and the embed below may still
           answer -- now said rather than folded into an empty page. */
        createLogger({ context: { platform: "INSTAGRAM", call: "businessDiscovery" } }).warn(
          "Business Discovery is rate-limited; falling through to the embed",
          { code: err.code },
        );
        post = null;
      } else if (err instanceof InstagramTimeoutError) {
        timedOut = true;
        createLogger({ context: { platform: "INSTAGRAM", call: "businessDiscovery" } }).warn(
          "Business Discovery walk timed out; falling through to the embed",
          { path: err.path },
        );
        post = null;
      } else if (err instanceof InstagramNoSuchAccountError) {
        noSuchAccount = true;
        createLogger({ context: { platform: "INSTAGRAM", call: "businessDiscovery" } }).warn(
          "Business Discovery has no Business or Creator account by this name",
          { handle, subcode: err.subcode },
        );
      } else {
      if (!(err instanceof InstagramAuthError)) throw err;
      // INSTAGRAM_BUSINESS_TOKEN itself is rejected — an operator problem, not a
      // creator one, and not something to record as a post with no engagement.
      authFailed = true;
      createLogger({ context: { platform: "INSTAGRAM", call: "businessDiscovery" } }).error(
        "INSTAGRAM_BUSINESS_TOKEN rejected; Business Discovery is down until it is replaced",
        { status: err.status, code: err.code },
      );
      }
    }
    if (post) {
      fill("business-discovery", {
        thumbnailUrl: post.thumbnailUrl,
        caption: post.caption,
        ...(typeof post.viewsCount === "number" ? { viewsCount: post.viewsCount } : {}),
        ...(typeof post.likesCount === "number" ? { likesCount: post.likesCount } : {}),
        ...(typeof post.commentsCount === "number" ? { commentsCount: post.commentsCount } : {}),
        ...(typeof post.authorFollowers === "number" ? { authorFollowers: post.authorFollowers } : {}),
        // Same as above: Instagram reports no shares, so we claim none.
        postedAt: post.postedAt ?? undefined,
      });
    }
  }

  /* The fallback runs whenever a hole is left, which includes the case where
     the official sources answered well. Two reasons it is not gated on total
     failure:
     - a hidden like_count is a hole in an otherwise successful answer, and it
       is the single most common one;
     - Business Discovery reads a creator's newest 100 media with no paging, so
       an older post is not merely unmeasured by it, it is unreachable.

     It is skipped only once nothing is left to gain, so a fully-answered post
     costs no extra request. */
  const wantsFallback =
    merged.likesCount === undefined ||
    merged.commentsCount === undefined ||
    merged.thumbnailUrl === undefined ||
    merged.thumbnailUrl === null;

  let likesHidden = false;
  if (wantsFallback) {
    const embed = await fetchInstagramEmbedPost(url, fetchTimeoutSignal(10000));
    if (embed) {
      likesHidden = embed.likesHidden;
      fill("embed", {
        thumbnailUrl: embed.thumbnailUrl,
        caption: embed.caption,
        /* likesCount is present here only when the embed reported a POSITIVE
           number; see instagramEmbed.ts for why its zero is an absence. */
        ...(typeof embed.likesCount === "number" ? { likesCount: embed.likesCount } : {}),
        ...(typeof embed.commentsCount === "number" ? { commentsCount: embed.commentsCount } : {}),
        ...(typeof embed.authorFollowers === "number"
          ? { authorFollowers: embed.authorFollowers }
          : {}),
        ...(embed.authorHandle ? { authorHandle: embed.authorHandle.replace(/^@/, "") } : {}),
        /* embed.embedViewCount is deliberately NOT mapped to viewsCount. It
           read 3337 against Business Discovery's 24245 for the same post at the
           same moment -- a different quantity, wrong by a factor we cannot
           predict, so no better than nothing and considerably more convincing. */
      });
    }
  }

  if (counted()) {
    log.info("instagram metrics resolved", {
      sources,
      fields: Object.keys(merged).filter((k) => k.endsWith("Count")),
      likesHidden,
    });
    return viaGraph.length > 0 ? { ...merged, connectedCounters: viaGraph } : merged;
  }

  /* Decided BEFORE the metadata-only endpoint below, which can never return a
     counter. Both outcomes here used to return a bare stub carrying no reason at
     all, so syncPost's `?? "no-counts-published"` fallback filed them as posts
     that publish no counters -- a settled verdict, excluded from retries.
     Instagram posts therefore reported zero engagement and were never re-asked,
     whether the deployment simply held no credential or the Graph call failed.

     With no handle there is no Business Discovery lookup to make, and that is
     "author-unknown": nobody can name the account, which no key would fix.
     "not-configured" is left for a handle we could not ask about because the
     deployment holds no token. */
  const attempted = Boolean(token) || bizAttempted;
  /* A rejected credential outranks both other verdicts. "platform-refused"
     would send this back through the retry cycle every hour with the same dead
     token and report it as the platform's doing; naming it is what lets the
     count of these reach an operator. */
  /* Ordered by what each says about who must act. A rejected credential is a
     person's job and outranks everything. Our own deadline comes next: it is
     not evidence that Instagram refused us, and filing it as such sent people
     to check tokens that were fine. Only then is a refusal the platform's. */
  const reason: FetchReason = authFailed
    ? "credentials-rejected"
    : timedOut
      ? "reader-timeout"
      : noSuchAccount
        ? "not-a-professional-account"
        : notOnAccount && !bizRateLimited
          ? "not-on-account"
          : pastLookupDepth && !bizRateLimited
          ? "not-in-newest-media"
          : /* Meta's hourly limit, or a sweep holding back below it. Not a
               refusal of this post and not the source failing: filed as
               platform-refused, 26 throttled reads in a row opened the
               post-reads breaker on 2026-10-03, whose probes were throttled in
               turn, and Instagram post reads stayed shut after the window
               reset. backing-off is uncharged and neutral to the breaker. */
            bizRateLimited
            ? "backing-off"
            : attempted
              ? "platform-refused"
              : handle
                ? "not-configured"
                : "author-unknown";
  log.warn("instagram metrics unavailable from every source", { reason, sources });

  try {
    /* graph.facebook.com/instagram_oembed, NOT api.instagram.com/oembed.
       The latter is what this called for months and it now answers 500 flat --
       measured 2026-09-02, "Oops, an error occurred." The Graph host serves the
       same payload and, unusually for Graph, needs no token at all. Still only
       a thumbnail and a title, so it stays last and its reason stays the one
       from the attempt that could have carried counts. */
    const res = await fetch(
      `https://graph.facebook.com/v26.0/instagram_oembed?url=${encodeURIComponent(url)}&fields=thumbnail_url,title`,
      { signal: fetchTimeoutSignal() },
    );
    if (res.ok) {
      const data = await res.json();
      return {
        ...merged,
        thumbnailUrl: merged.thumbnailUrl ?? data.thumbnail_url ?? null,
        caption: merged.caption ?? data.title ?? null,
        fetchReason: reason,
      };
    }
  } catch {
    // fall through
  }
  /* The stub's nulls go FIRST so anything the sources did recover survives.
     Spread the other way round -- which it was -- and a post whose embed
     answered with a caption and a thumbnail but no counters had both erased on
     the way out, because stubMetrics supplies `thumbnailUrl: null` as its
     default. A failed measurement is not a reason to discard metadata we hold. */
  return { ...stubMetrics(reason), ...merged, fetchReason: reason };
}


/**
 * The empty answer, and why it is empty.
 *
 * `reason` is REQUIRED, and that is the whole point of this signature. It used
 * to be optional, and five YouTube paths plus one Instagram path took the
 * default -- so they returned an empty result carrying no reason at all, and
 * the writer downstream filled the blank in with "no-counts-published". That
 * slug is a positive claim about the POST (it publishes no counters) and it is
 * settled, so a refresh never asked again. Every Instagram post in a campaign
 * read as a post with no engagement, permanently, because a parameter had a
 * default.
 *
 * Making it required moves that from something a reviewer has to notice to
 * something the compiler will not let anyone write. A new fetch path cannot
 * return silence; it has to say what it saw.
 */
function stubMetrics(reason: FetchReason): Partial<PostMetrics> {
  // No postedAt. A stub is what we return when the platform told us nothing, and
  // it knows least of all when the post went up -- filling in `new Date()` there
  // stamped today onto every post created while TikTok was unreachable, and the
  // reference campaign's seventeen posts all claimed to have been published on
  // the day we added them.
  return {
    thumbnailUrl: null,
    caption: null,
    fetchReason: reason,
  };
}

export async function fetchPostMetrics(
  url: string,
  context?: FetchMetricsContext,
): Promise<PostMetrics | null> {
  const detected = detectPlatform(url);
  if (!detected) return null;

  let metrics: Partial<PostMetrics>;

  switch (detected.platform) {
    case "YOUTUBE":
      metrics = await fetchYouTubeMetrics(detected.id);
      break;
    case "TIKTOK":
      metrics = await fetchTikTokMetrics(
        url,
        detected.id,
        context?.tiktokToken,
        context?.countsOnly,
        context?.tiktokSandbox,
      );
      break;
    case "INSTAGRAM":
      metrics = await fetchInstagramMetrics(
        url,
        context?.instagramToken,
        context?.instagramHandle,
        context?.instagramStopAtPercent,
        context?.instagramOrgId,
      );
      break;
    case "TWITCH":
      metrics = await fetchTwitchMetrics(url, detected.id, fetchTimeoutSignal());
      break;
    case "FACEBOOK": {
      const read = await fetchFacebookMetrics(url, context?.facebook);
      return assemblePostMetrics("FACEBOOK", read.graphPostId ?? detected.id, read.metrics);
    }
  }

  return assemblePostMetrics(detected.platform, detected.id, metrics);
}

/**
 * A Facebook Page post, read with the token of the connected Page it is on.
 *
 * Every counter here comes through the Page's own connection, so all of them are
 * connected readings. `graphPostId` is the `{page}_{post}` id the post should be
 * stored under: the comments edge and every later read need it, and a pasted
 * pfbid or share code is not one.
 */
async function fetchFacebookMetrics(
  url: string,
  context: FetchMetricsContext["facebook"],
): Promise<{ metrics: Partial<PostMetrics>; graphPostId?: string }> {
  if (!context) return { metrics: stubMetrics("page-not-connected") };
  let match = context.match;
  if (match === undefined) {
    /* Loaded here, not at the top: facebookPost reads the database, and this
       module must stay importable without a PrismaClient. */
    const { connectedFacebookPages, resolveFacebookPost } = await import("./facebookPost");
    const pages = await connectedFacebookPages(context.orgId, { creatorId: context.creatorId });
    try {
      match = await resolveFacebookPost(url, pages, {
        knownPostId: context.knownPostId,
        signal: fetchTimeoutSignal(),
      });
    } catch (err) {
      if (err instanceof InstagramAuthError) return { metrics: stubMetrics("credentials-rejected") };
      return { metrics: stubMetrics("platform-refused") };
    }
  }
  if (!match) return { metrics: stubMetrics("page-not-connected") };

  const p = match.post.exact;
  const counted: Partial<PostMetrics> = {
    ...(p.views !== undefined ? { viewsCount: p.views } : {}),
    ...(p.likes !== undefined ? { likesCount: p.likes } : {}),
    ...(p.comments !== undefined ? { commentsCount: p.comments } : {}),
    ...(p.shares !== undefined ? { sharesCount: p.shares } : {}),
  };
  return {
    graphPostId: match.graphPostId,
    metrics: {
      thumbnailUrl: match.post.coverImageUrl,
      caption: match.post.description || null,
      ...(p.createdAt ? { postedAt: p.createdAt } : {}),
      ...counted,
      connectedCounters: countersIn(counted),
    },
  };
}

/**
 * Exported for tests: this whitelist has now silently dropped a parsed counter
 * twice -- saves, then reach -- and both times every surrounding test stayed
 * green because they asserted the parser and the writer, never the step
 * between them.
 */
export function assemblePostMetrics(
  platform: PostMetrics["platform"],
  platformPostId: string,
  m: Partial<PostMetrics>,
): PostMetrics {
  const result: PostMetrics = {
    platform,
    platformPostId,
    thumbnailUrl: m.thumbnailUrl ?? null,
    caption: m.caption ?? null,
    ...(m.postedAt ? { postedAt: m.postedAt } : {}),
    ...(m.fetchReason ? { fetchReason: m.fetchReason } : {}),
  };

  const finite = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const views = finite(m.viewsCount);
  const likes = finite(m.likesCount);
  const comments = finite(m.commentsCount);
  const shares = finite(m.sharesCount);
  const saves = finite(m.savesCount);
  const reach = finite(m.reachCount);
  const engagement = finite(m.engagementRate);
  if (views !== undefined) result.viewsCount = views;
  if (likes !== undefined) result.likesCount = likes;
  if (comments !== undefined) result.commentsCount = comments;
  if (shares !== undefined) result.sharesCount = shares;
  /* This list is a whitelist, so a counter the parser produces but this omits is
     silently dropped -- which is exactly what happened to saves on its first
     run: parsed from collectCount, and gone by the time anything wrote it, and
     then again to reach: fetched under instagram_manage_insights, mapped to
     reachCount by syncPost#countsFrom, and absent from here -- so it held a
     value in 0 of 18,676 rows. */
  if (saves !== undefined) result.savesCount = saves;
  if (reach !== undefined) result.reachCount = reach;
  const followers = finite(m.authorFollowers);
  if (followers !== undefined) result.authorFollowers = followers;
  /* Same whitelist trap: the owner the embed names was dropped here, so every
     post filed with no creator stayed that way however often it was read. */
  const author = typeof m.authorHandle === "string" ? m.authorHandle.trim().replace(/^@/, "") : "";
  if (author) result.authorHandle = author;
  if (engagement !== undefined) result.engagementRate = engagement;
  /* Only counters that survived the whitelist above: a connected claim about a
     counter that is not here would describe nothing. */
  const present = new Set(countersIn(result));
  const connected = (m.connectedCounters ?? []).filter((c) => present.has(c));
  if (connected.length > 0) result.connectedCounters = connected;

  return result;
}
