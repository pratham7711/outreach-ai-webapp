import type { SandboxPostFetcher } from "./tiktokPostSandbox";
import {
  fetchInstagramMetricsGraph,
  InstagramAuthError,
  InstagramTimeoutError,
} from "./instagram";
import {
  businessDiscoveryToken,
  fetchInstagramPublicPostMetrics,
} from "./instagramBusinessDiscovery";
import { fetchInstagramEmbedPost } from "./instagramEmbed";
import { fetchTikTokVideosByIds } from "./tiktokDisplay";
import { fetchTwitchMetrics } from "./twitch";
import { createLogger } from "../observability/logger";

export type FetchMetricsContext = {
  instagramToken?: string;
  instagramHandle?: string;
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
};

export type PostMetrics = {
  platform: "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "TWITCH";
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
   * Instagram and YouTube publish no equivalent, and no platform we can reach
   * publishes a download count at all, which is why there is no downloadsCount
   * here: a field nothing can ever fill is worse than an absent one.
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
 * The likes-exceed-views guard stays, but only where it means something -- when
 * both numbers are present. A missing views count is not evidence of a bad
 * likes count.
 */
export function hasMetricCounts(m: PostMetrics): boolean {
  const anyCount =
    typeof m.viewsCount === "number" ||
    typeof m.likesCount === "number" ||
    typeof m.commentsCount === "number" ||
    typeof m.sharesCount === "number" ||
    typeof m.savesCount === "number";
  if (!anyCount) return false;
  const likesExceedViews =
    typeof m.viewsCount === "number" &&
    typeof m.likesCount === "number" &&
    m.likesCount > m.viewsCount;
  return !likesExceedViews;
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

export const MEDIA_TYPES = ["REEL", "STORY", "POST", "SHORT", "VIDEO"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/**
 * What a post URL says about itself.
 *
 * The URL already carries the two things an operator was being asked to retype:
 * which kind of post it is, and often whose it is. A TikTok link cannot be
 * anything but /@handle/video/id, and an Instagram reel says "reel" in the path.
 * `mediaType` and `handle` are optional because not every form carries them --
 * a youtu.be link names no channel, and instagram.com/p/CODE names no author --
 * and an absent field means "the URL does not say", never "there is none".
 */
export function detectPlatform(
  url: string
): { platform: PostMetrics["platform"]; id: string; mediaType?: MediaType; handle?: string } | null {
  // YouTube: watch?v=ID, youtu.be/ID, shorts/ID, live/ID, embed/ID (IDs are 11 chars).
  // Host-guarded so a stray ?v= on another domain can't be misread as YouTube.
  if (/(?:youtube\.com|youtu\.be)/.test(url)) {
    const ytMatch =
      url.match(/(?:youtube\.com\/(?:shorts|live|embed)\/|youtu\.be\/)([\w-]{11})/) ||
      url.match(/[?&]v=([\w-]{11})/);
    if (ytMatch) {
      // A channel handle only appears on some YouTube forms, and never on the
      // watch?v= one that most people paste.
      const yHandle = url.match(/youtube\.com\/@([\w.-]+)/)?.[1];
      return {
        platform: "YOUTUBE",
        id: ytMatch[1],
        mediaType: /youtube\.com\/shorts\//.test(url) ? "SHORT" : "VIDEO",
        ...(yHandle ? { handle: yHandle } : {}),
      };
    }
  }

  // TikTok: tiktok.com/@user/video/ID, and /photo/ID for image carousels.
  const ttMatch = url.match(/tiktok\.com\/@([\w.]+)\/(video|photo)\/(\d+)/);
  if (ttMatch) {
    return {
      platform: "TIKTOK",
      id: ttMatch[3],
      mediaType: ttMatch[2] === "photo" ? "POST" : "VIDEO",
      handle: ttMatch[1],
    };
  }

  // Instagram: /reel/CODE and /p/CODE, either bare or prefixed with the author
  // -- instagram.com/someone/reel/CODE is what the app's own share sheet gives
  // you, and it used to match nothing here at all.
  const igStory = url.match(/instagram\.com\/stories\/([\w.]+)\/(\d+)/);
  if (igStory) {
    return { platform: "INSTAGRAM", id: igStory[2], mediaType: "STORY", handle: igStory[1] };
  }
  const igMatch = url.match(/instagram\.com\/(?:([\w.]+)\/)?(reels?|p|tv)\/([\w-]+)/);
  if (igMatch) {
    return {
      platform: "INSTAGRAM",
      id: igMatch[3],
      mediaType: igMatch[2].startsWith("reel") ? "REEL" : "POST",
      ...(igMatch[1] ? { handle: igMatch[1] } : {}),
    };
  }


  /* Twitch: a VOD is /videos/<numeric id>, a clip is either clips.twitch.tv/<slug>
     or /<channel>/clip/<slug>. The two are served by different Helix endpoints,
     which is why fetchTwitchMetrics re-reads the kind off the url. Clips are
     short-form, so they map to SHORT rather than VIDEO. */
  const twVod = url.match(/twitch\.tv\/videos\/(\d+)/i);
  if (twVod) {
    return { platform: "TWITCH", id: twVod[1], mediaType: "VIDEO" };
  }
  const twClipHosted = url.match(/clips\.twitch\.tv\/([\w-]+)/i);
  if (twClipHosted) {
    return { platform: "TWITCH", id: twClipHosted[1], mediaType: "SHORT" };
  }
  const twClipChannel = url.match(/twitch\.tv\/(\w+)\/clip\/([\w-]+)/i);
  if (twClipChannel) {
    return {
      platform: "TWITCH",
      id: twClipChannel[2],
      mediaType: "SHORT",
      handle: twClipChannel[1],
    };
  }

  return null;
}

export async function fetchYouTubeMetrics(videoId: string): Promise<Partial<PostMetrics>> {
  const log = createLogger({ context: { platform: "YOUTUBE", videoId } });
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    log.warn("YOUTUBE_API_KEY not set; storing no metric counts for this post");
    // Settled, not retryable: a missing key is identical on all three sweeps.
    return stubMetrics("not-configured");
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoId}&key=${apiKey}`,
      { next: { revalidate: 3600 }, signal: fetchTimeoutSignal() }
    );
    if (!res.ok) {
      const reason = await res.text().catch(() => "");
      log.error("YouTube API request failed", { status: res.status, reason: reason.slice(0, 300) });
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

export async function fetchYouTubeMetricsBatch(videoIds: string[]): Promise<Map<string, PostMetrics>> {
  const out = new Map<string, PostMetrics>();
  const ids = [...new Set(videoIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return out;

  const log = createLogger({ context: { platform: "YOUTUBE", mode: "batch" } });
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    log.warn("YOUTUBE_API_KEY not set; batch skipped", { count: ids.length });
    return out;
  }

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
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
  return out;
}

export function reasonFromLookup(lookup: TikTokPostLookup): FetchReason {
  if (lookup.state === "deleted") return "post-deleted";
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
    if (viaDisplay && hasMetricCounts(viaDisplay as PostMetrics)) return viaDisplay;
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
    if (viaSandbox?.state === "deleted") return stubMetrics("post-deleted");
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

  /* Three reasons not to go on to oEmbed. A deleted post is a settled answer
     and asking a second endpoint will not un-delete it; backing off has to mean
     the host, not one endpoint on it; and a bulk refresh would rather spend the
     slot on the next post than on a thumbnail. */
  if (lookup.state === "deleted" || reason === "backing-off" || countsOnly) {
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

// TikTok answers a deleted post with a normal 200 and a rehydration payload
// carrying a non-zero statusCode (10204 "item doesn't exist"). That is a
// perfectly healthy response, so callers must not mistake it for being blocked.
// Returns null when there is no payload at all, which IS the blocked/changed
// -markup case.
export function parseTikTokDetailStatus(html: string): number | null {
  const match = html.match(TIKTOK_REHYDRATION_RE);
  if (!match) return null;

  try {
    const detail = JSON.parse(match[1])?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
    if (!detail) return null;
    return typeof detail.statusCode === "number" ? detail.statusCode : null;
  } catch {
    return null;
  }
}

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

  const item = detail.itemInfo?.itemStruct;
  const stats = item?.stats;
  const statsV2 = item?.statsV2;
  if (!item || (!stats && !statsV2)) return null;

  const createTime = Number(item.createTime);

  return {
    viewsCount: pickOptionalCount(stats?.playCount, statsV2?.playCount),
    likesCount: pickOptionalCount(stats?.diggCount, statsV2?.diggCount),
    commentsCount: pickOptionalCount(stats?.commentCount, statsV2?.commentCount),
    sharesCount: pickOptionalCount(stats?.shareCount, statsV2?.shareCount),
    savesCount: pickOptionalCount(stats?.collectCount, statsV2?.collectCount),
    authorFollowers: pickOptionalCount(
      item?.authorStats?.followerCount,
      item?.authorStatsV2?.followerCount
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
 * - `unavailable` we could not get a usable answer: blocked, rate-gated,
 *                 timed out, or the page shape changed. Says nothing about
 *                 whether the post exists.
 */
export type TikTokPostState = "live" | "deleted" | "unavailable";

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

  const statusCode = parseTikTokDetailStatus(html);
  if (statusCode !== null && statusCode !== 0) {
    return { state: "deleted", statusCode, reason: null, metrics: null };
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
    const res = await fetch(url, {
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

    if (lookup.state === "deleted") {
      // A removed post answers 200 with a non-zero statusCode. Counting that as
      // a block let five deleted posts in a row latch the breaker for 15
      // minutes and stall every healthy fetch behind them.
      gate.success();
      log.warn("TikTok says this post is gone", { statusCode: lookup.statusCode });
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
        /* No sharesCount at all. Instagram publishes no share count on any
           endpoint we can reach, so writing 0 asserted a measurement we cannot
           make -- and CreatorCore's report of the same posts shows no shares row
           for them either. */
        postedAt: graph.postedAt,
      });
    }
  }

  const bizToken = businessDiscoveryToken();
  if (bizToken && handle) {
    let post: Awaited<ReturnType<typeof fetchInstagramPublicPostMetrics>> = null;
    try {
      post = await fetchInstagramPublicPostMetrics(
        handle,
        url,
        bizToken,
        fetchTimeoutSignal(GRAPH_WALK_TIMEOUT_MS),
      );
    } catch (err) {
      if (err instanceof InstagramTimeoutError) {
        timedOut = true;
        createLogger({ context: { platform: "INSTAGRAM", call: "businessDiscovery" } }).warn(
          "Business Discovery walk timed out; falling through to the embed",
          { path: err.path },
        );
        post = null;
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
    return merged;
  }

  /* Decided BEFORE the metadata-only endpoint below, which can never return a
     counter. Both outcomes here used to return a bare stub carrying no reason at
     all, so syncPost's `?? "no-counts-published"` fallback filed them as posts
     that publish no counters -- a settled verdict, excluded from retries.
     Instagram posts therefore reported zero engagement and were never re-asked,
     whether the deployment simply held no credential or the Graph call failed.

     "not-configured" covers a missing handle as well as a missing token: with
     no handle there is no Business Discovery lookup to make, so the shortfall
     is still something the deployment has to supply, not something Instagram
     refused us. */
  const attempted = Boolean(token) || Boolean(bizToken && handle);
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
      : attempted
        ? "platform-refused"
        : "not-configured";
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
      metrics = await fetchInstagramMetrics(url, context?.instagramToken, context?.instagramHandle);
      break;
    case "TWITCH":
      metrics = await fetchTwitchMetrics(url, detected.id, fetchTimeoutSignal());
      break;
  }

  return assemblePostMetrics(detected.platform, detected.id, metrics);
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
  if (engagement !== undefined) result.engagementRate = engagement;

  return result;
}
