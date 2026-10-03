import { fetchInstagramProfile, MEDIA_PAGE_SIZE, type IgPublicProfile } from "./instagramBusinessDiscovery";
import { readWithDiscoveryToken, type DiscoveryCredential } from "./instagramDiscoveryTokens";
import { InstagramNoSuchAccountError, InstagramRateLimitError, resolveIgUserId } from "./instagram";
import { fetchTikTokProfile } from "./tiktokProfile";
import { latestAverageViews, RECENT_POSTS_FOR_AVERAGE } from "@/lib/trackers/recentViews";

/**
 * Reading a tracked creator's public numbers, per platform.
 *
 * The creator tracker previously computed everything from Post rows already in
 * this database, joined through Campaign.orgId. That limited it to creators we
 * already work with — a watchlist you cannot add a stranger to is not a
 * watchlist — and left Creator.followersCount, populated on 11 of 1,834 rows, as
 * the only follower figure anywhere.
 *
 * Each platform is a different bargain and the differences are not hideable:
 *
 *   Instagram  Business Discovery. Any Business/Creator account, no connection
 *              needed, but personal and private accounts return nothing at all
 *              and always will. That is a permanent property of the account, not
 *              a transient failure, which is why `reason` is carried out of here
 *              rather than collapsed into null.
 *   YouTube    Data API v3, public and generous. Averages the most recent
 *              uploads rather than lifetime views/videos, so the figure means the
 *              same thing it does on the other platforms.
 *   TikTok     No public API exists. Handled by the browser reader, the same way
 *              sound counts already are.
 */

/** One entry in a creator's Top Posts, in the shape the Creator.topPosts JSON
 * column stores. Nullable fields are platform gaps, not parse failures --
 * Instagram omits view_count on stills, YouTube thumbnails can be absent on a
 * just-uploaded video. */
export type TopPost = {
  postId: string;
  url: string | null;
  caption: string | null;
  coverUrl: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** ISO string, so the value survives the JSON column round-trip unchanged. */
  postedAt: string | null;
};

export type CreatorProfileRead = {
  followersCount: number;
  /** Lifetime post count as the platform reports it, not our Post row count. */
  postsCount: number;
  /** Mean views across the recent posts the reader could see. */
  avgViews: number;
  /** How many posts that mean was taken over — 0 means avgViews is not a measurement. */
  sampledPosts: number;
  /** Best recent posts by views, when the read that produced the stats could
   * also see the posts themselves. Absent means "not measured here" -- TikTok
   * stats come from a page that renders no posts -- and the caller must keep
   * whatever it already has rather than erase it. */
  topPosts?: TopPost[];
  /** The profile picture the same read saw, when it carried one. Usually a
   * signed CDN URL with a shelf life of days -- download it, do not store it. */
  avatarUrl?: string;
  /** The platform's own id for the account, when the same read carried it:
   * TikTok's user id and secUid, Instagram's user id, YouTube's channel id
   * (plan A4). A handle can be renamed; these cannot. Recorded in
   * CreatorPlatformAccountId. */
  accountId?: string;
  secUid?: string;
};

export const TOP_POSTS_LIMIT = 6;

export function rankTopPosts(posts: TopPost[]): TopPost[] {
  /* Views rank first; a post the platform gave no view count for (an Instagram
     still, typically) falls back to likes, which systematically underrates it
     against reels but beats excluding it entirely. */
  return [...posts]
    .sort((a, b) => (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0))
    .slice(0, TOP_POSTS_LIMIT);
}

/** Why a read produced nothing. Leads Creator.trackerLastError -- see
 *  formatTrackerError below for what else that column may carry. */
export type CreatorReadFailure =
  /** No token/key configured for this platform in this environment. */
  | "no-credentials"
  /** We have no reader for this platform at all. */
  | "unsupported-platform"
  /** Instagram: personal or private account. Permanent until they convert it. */
  | "not-a-professional-account"
  /** The platform answered, but without the numbers we need. */
  | "unreadable"
  /** The platform says this handle does not exist. Permanent until someone
   *  edits the tracked handle -- a renamed or deleted account, or a typo. */
  | "no-such-account"
  /** The platform refused us for now — quota, throttle, or a transient block. */
  | "rate-limited";

export type CreatorReadResult =
  | { ok: true; profile: CreatorProfileRead }
  | { ok: false; reason: CreatorReadFailure; detail?: string };

/** Human copy for the UI. The tracker says why, rather than showing a zero. */
export const READ_FAILURE_COPY: Record<CreatorReadFailure, string> = {
  "no-credentials": "This platform is not connected yet, so we cannot read this creator.",
  "unsupported-platform": "We do not track this platform yet.",
  "not-a-professional-account":
    "Instagram only shares figures for Business and Creator accounts. This one is personal or private.",
  unreadable: "The platform answered but did not include follower or view counts.",
  "no-such-account":
    "We could not find this handle on the platform. It may have been renamed or deleted, or the spelling may be off — waiting will not fix it.",
  "rate-limited": "We are reading too many creators right now. This one retries on the next sweep.",
};

/**
 * How a failed read is written into, and read back out of, Creator.trackerLastError.
 *
 * That column is one free-text string doing two jobs: it carries the machine
 * reason the UI maps to copy, and -- since 2026-09-16 -- whatever a fallback
 * rung observed on the way, which is the only thing that tells three
 * identical-looking Instagram failures apart. A newline separates them because
 * a platform error message is one line and never contains one, so the reason
 * survives being parsed out of strings written before the note existed.
 */
const TRACKER_NOTE_SEP = "\n";

export function formatTrackerError(
  reason: CreatorReadFailure,
  detail?: string | null,
  note?: string | null
): string {
  const head = detail ? `${reason}: ${detail}` : reason;
  return note ? `${head}${TRACKER_NOTE_SEP}${note}` : head;
}

/** The reason and the note, from a stored string of either vintage. */
export function parseTrackerError(stored: string): {
  reason: CreatorReadFailure;
  note: string | null;
} {
  const [head, ...rest] = stored.split(TRACKER_NOTE_SEP);
  const note = rest.join(TRACKER_NOTE_SEP).trim();
  return { reason: head.split(":")[0].trim() as CreatorReadFailure, note: note || null };
}

/**
 * Which of two failures to keep when a fallback rung answers after the first.
 *
 * The ladder used to keep the first rung's reason and only append the later
 * rung's detail, so a sandbox read that learned "statusCode 10221 — no such
 * account" was filed under the generic "unreadable" and the operator was told
 * the platform had withheld the numbers. It had not; the account was gone.
 *
 * Specificity, not order, decides. A reason that names a cause the operator can
 * act on beats one that only says the read produced nothing.
 */
const FAILURE_SPECIFICITY: Record<CreatorReadFailure, number> = {
  unreadable: 0,
  "rate-limited": 1,
  "no-credentials": 2,
  "unsupported-platform": 2,
  "not-a-professional-account": 3,
  "no-such-account": 3,
};

export function moreSpecificFailure(
  first: CreatorReadFailure,
  second: CreatorReadFailure
): CreatorReadFailure {
  return FAILURE_SPECIFICITY[second] > FAILURE_SPECIFICITY[first] ? second : first;
}

/* The IG user id behind each Business Discovery token, for the life of the
   process. Every read is asked through the reading account's own id, and with
   none configured fetchInstagramProfile looks it up with a me/accounts call
   first -- one extra Graph call per creator read, for an answer that only
   changes when the token does. */
const readerIgUserIds = new Map<string, string>();

/** For tests. */
export function resetInstagramReaderState() {
  readerIgUserIds.clear();
}

async function readerIgUserId(cred: DiscoveryCredential): Promise<string | null> {
  if (cred.graphOptions.igUserId) return cred.graphOptions.igUserId;
  const known = readerIgUserIds.get(cred.token);
  if (known) return known;
  const id = await resolveIgUserId(cred.token, undefined, {
    rateLimitThrows: true,
    onHeaders: cred.graphOptions.onHeaders,
  });
  if (id) readerIgUserIds.set(cred.token, id);
  return id;
}

/**
 * How many media the first Business Discovery page asks for.
 *
 * The figure needs the newest ten reels, and reels are most of what a tracked
 * creator posts, so thirty media usually hold them. Meta bills a read by the
 * time it spends answering it (x-app-usage total_time, the limit the sweep
 * hits first), and a hundred media with captions and links is the bulk of
 * that answer. A creator whose first thirty hold fewer than ten reels gets the
 * other seventy too, so the figure covers the same hundred media it always
 * did.
 */
export const PROFILE_MEDIA_FIRST_PAGE = 30;

class NoReaderAccountError extends Error {
  constructor() {
    super("the Business Discovery token has no Instagram account to read through");
    this.name = "NoReaderAccountError";
  }
}

async function readDiscoveryProfile(handle: string, cred: DiscoveryCredential): Promise<IgPublicProfile | null> {
  const igUserId = await readerIgUserId(cred);
  if (!igUserId) throw new NoReaderAccountError();
  const options = { ...cred.graphOptions, igUserId, rateLimitThrows: true };
  const first = await fetchInstagramProfile(handle, cred.token, undefined, undefined, {
    ...options,
    noSuchAccountThrows: true,
    mediaLimit: PROFILE_MEDIA_FIRST_PAGE,
  });
  if (!first?.nextMediaCursor) return first;
  const reels = latestAverageViews(first.recentPosts.map((p) => ({ views: p.viewsCount, postedAt: p.postedAt })));
  if (reels.sampledPosts >= RECENT_POSTS_FOR_AVERAGE) return first;
  try {
    const rest = await fetchInstagramProfile(handle, cred.token, undefined, first.nextMediaCursor, {
      ...options,
      mediaLimit: MEDIA_PAGE_SIZE - PROFILE_MEDIA_FIRST_PAGE,
    });
    if (rest) return { ...first, recentPosts: [...first.recentPosts, ...rest.recentPosts] };
  } catch {
    /* The first page already holds the followers and some reels. The second
       only widens the sample, so its failure is not the read's. */
  }
  return first;
}

async function readInstagram(handle: string): Promise<CreatorReadResult> {
  let profile;
  try {
    /* Token A, or the standby B while A is limited (plan §13 B). Both limited
       is a rate limit, caught below like any other. */
    const read = await readWithDiscoveryToken((cred) => readDiscoveryProfile(handle, cred));
    if (!read.ok) return { ok: false, reason: "no-credentials" };
    profile = read.value;
  } catch (e) {
    /* Graph's 110 is its whole answer for a name it has no Business or Creator
       account for: a personal or private account, or a handle nobody holds.
       Until it was asked for as an error it came back as null -- and so did a
       Graph 500, a dropped connection and a token whose own account could not
       be looked up, every one of them filed as "personal account", which the
       roster shows as a handle for someone to fix. */
    if (e instanceof InstagramNoSuchAccountError) return { ok: false, reason: "not-a-professional-account" };
    const detail = e instanceof Error ? e.message : String(e);
    // Graph signals throttling with codes 4/17/32/613; treat those as retryable so a
    // busy hour does not get written down as "this account is personal".
    if (e instanceof InstagramRateLimitError || /rate|limit|\(#(4|17|32|613)\)/i.test(detail)) {
      return { ok: false, reason: "rate-limited", detail };
    }
    return { ok: false, reason: "unreadable", detail };
  }

  if (!profile) return { ok: false, reason: "unreadable", detail: "Business Discovery answered without a profile" };

  if (profile.followersCount === undefined) {
    return { ok: false, reason: "unreadable", detail: "no followers_count in response" };
  }

  /* Business Discovery sends view_count on reels only, so the newest ten posts
     that carry one are the newest ten reels. */
  const recent = latestAverageViews(
    profile.recentPosts.map((p) => ({ views: p.viewsCount, postedAt: p.postedAt }))
  );

  const topPosts = rankTopPosts(
    profile.recentPosts.map((p) => ({
      postId: p.id,
      url: p.permalink,
      caption: p.caption,
      coverUrl: p.thumbnailUrl,
      views: typeof p.viewsCount === "number" ? p.viewsCount : null,
      likes: typeof p.likesCount === "number" ? p.likesCount : null,
      comments: typeof p.commentsCount === "number" ? p.commentsCount : null,
      postedAt: p.postedAt ? p.postedAt.toISOString() : null,
    }))
  );

  return {
    ok: true,
    profile: {
      followersCount: profile.followersCount,
      postsCount: profile.mediaCount ?? 0,
      avgViews: recent.avgViews,
      sampledPosts: recent.sampledPosts,
      ...(topPosts.length ? { topPosts } : {}),
      ...(profile.profilePictureUrl ? { avatarUrl: profile.profilePictureUrl } : {}),
      ...(profile.igUserId ? { accountId: profile.igUserId } : {}),
    },
  };
}

const YT_RECENT = 20;

export function channelThumbnail(thumbnails: unknown): string | null {
  const t = (thumbnails ?? {}) as Record<string, { url?: unknown } | undefined>;
  const url = t.high?.url ?? t.medium?.url ?? t.default?.url;
  return typeof url === "string" && url ? url : null;
}

async function youtubeApi(key: string, path: string, params: Record<string, string>) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries({ ...params, key })) url.searchParams.set(k, v);
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 403 || res.status === 429) throw new Error(`quota:${res.status}`);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

/** A channel id as YouTube issues them: "UC" and 22 more characters. */
export function isYouTubeChannelId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^UC[\w-]{22}$/.test(value);
}

/**
 * The channel that published these videos, when they all agree on one.
 *
 * A tracked creator's handle column is free text from an import or the add
 * form, and for YouTube it often holds the channel's display name rather than
 * its @handle -- which forHandle can never resolve. MEASURED on prod
 * 2026-10-02: 40 of 78 tracked YouTube creators failed "no channel for
 * handle", 37 of the 40 stored values contained a space, and all 40 had
 * campaign posts of their own. The posts name the channel outright. Null when
 * the videos are gone or disagree, so a wrong guess is never made.
 */
export async function youtubeChannelIdForVideos(videoIds: string[]): Promise<string | null> {
  const key = process.env.YOUTUBE_API_KEY;
  const ids = [...new Set(videoIds)].filter(Boolean).slice(0, 50);
  if (!key || !ids.length) return null;
  try {
    const vids = await youtubeApi(key, "videos", { part: "snippet", id: ids.join(",") });
    const channels = new Set<string>(
      (vids?.items ?? []).map((v: any) => v?.snippet?.channelId).filter(isYouTubeChannelId)
    );
    return channels.size === 1 ? [...channels][0] : null;
  } catch {
    return null;
  }
}

async function readYouTube(handle: string, channelId?: string): Promise<CreatorReadResult> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { ok: false, reason: "no-credentials" };

  const clean = handle.replace(/^@/, "").trim();
  if (!clean && !channelId) return { ok: false, reason: "unreadable", detail: "empty handle" };

  const api = (path: string, params: Record<string, string>) => youtubeApi(key, path, params);

  try {
    // forHandle resolves @handles directly; forUsername only matches the old
    // legacy usernames, which almost no current channel has.
    const ch = await api("channels", {
      // snippet carries the channel picture; channels.list costs one quota
      // unit whatever parts are asked for.
      part: "snippet,statistics,contentDetails",
      ...(channelId ? { id: channelId } : { forHandle: `@${clean}` }),
    });
    const item = ch?.items?.[0];
    /* An empty items array from forHandle is definitive: YouTube resolved the
       lookup and there is no such channel. Distinct from "unreadable" because
       the fix is editing the handle, not waiting for the next sweep. */
    if (!item) {
      return {
        ok: false,
        reason: "no-such-account",
        detail: channelId ? "no channel for id" : "no channel for handle",
      };
    }

    const followersCount = Number(item.statistics?.subscriberCount ?? NaN);
    const postsCount = Number(item.statistics?.videoCount ?? 0);
    const uploads = item.contentDetails?.relatedPlaylists?.uploads;

    /* Lifetime viewCount/videoCount would be a different statistic to the one the
       other platforms report — it is dragged by a single old hit forever. Averaging
       the recent uploads instead costs two cheap calls and means the same thing. */
    let avgViews = 0;
    let sampledPosts = 0;
    let topPosts: TopPost[] = [];
    if (uploads) {
      let pl: any = null;
      try {
        pl = await api("playlistItems", {
          part: "contentDetails",
          playlistId: uploads,
          maxResults: String(YT_RECENT),
        });
      } catch (e) {
        /* An uploads playlist answers 404 when its channel has no videos, and
           a handle that lands on an empty channel has usually landed on the
           wrong one. MEASURED on prod 2026-10-03: 5 tracked YouTube creators
           and 14 roster links failed "unreadable: playlistItems 404" and none
           had ever been read. For both of the tracked ones with campaign
           videos, forHandle named a different channel from the one those
           videos were published by -- 0 videos, 5 and 21 subscribers. Filed
           as unreadable, the sweep's own-posts rung, which only answers "no
           such account", never looked for the real one. Asked by id, the
           channel is the right one and simply has nothing to average. */
        if (!(e instanceof Error && e.message === "playlistItems 404")) throw e;
        if (!channelId) {
          return { ok: false, reason: "no-such-account", detail: "the channel for this handle has no videos" };
        }
      }
      const ids: string[] = (pl?.items ?? [])
        .map((i: any) => i?.contentDetails?.videoId)
        .filter(Boolean);
      if (ids.length) {
        // snippet rides along for the Top Posts card -- title, thumbnail,
        // publish date -- at no extra quota unit beyond the part itself.
        const vids = await api("videos", { part: "statistics,snippet", id: ids.join(",") });
        const items: any[] = vids?.items ?? [];
        const recent = latestAverageViews(
          items.map((v) => ({
            views: Number.isFinite(Number(v?.statistics?.viewCount)) ? Number(v.statistics.viewCount) : null,
            postedAt: v?.snippet?.publishedAt ?? null,
          }))
        );
        avgViews = recent.avgViews;
        sampledPosts = recent.sampledPosts;
        topPosts = rankTopPosts(
          items.map((v: any) => ({
            postId: String(v?.id ?? ""),
            url: v?.id ? `https://www.youtube.com/watch?v=${v.id}` : null,
            caption: v?.snippet?.title ?? null,
            coverUrl:
              v?.snippet?.thumbnails?.medium?.url ?? v?.snippet?.thumbnails?.default?.url ?? null,
            views: Number.isFinite(Number(v?.statistics?.viewCount))
              ? Number(v.statistics.viewCount)
              : null,
            likes: Number.isFinite(Number(v?.statistics?.likeCount))
              ? Number(v.statistics.likeCount)
              : null,
            comments: Number.isFinite(Number(v?.statistics?.commentCount))
              ? Number(v.statistics.commentCount)
              : null,
            postedAt: v?.snippet?.publishedAt ?? null,
          }))
        );
      }
    }

    /* A hidden subscriber count is NOT an absent field.
     *
     * When a channel hides its count, the Data API still returns
     * `statistics.subscriberCount`, as the string "0", and marks it with
     * `hiddenSubscriberCount: true`. So the finite check below can never catch
     * it: Number("0") is 0, which is finite, and the read returned ok with a
     * follower count of zero. Measured on prod 2026-09-10: one tracked YouTube
     * creator had written 100 consecutive snapshots of followersCount 0 since
     * 2026-09-01, with postsCount 1 and avgViews 3 alongside -- readable in
     * every other way, exactly as the old comment here said -- and
     * trackerLastError NULL the whole time, because nothing had failed. A
     * withheld number had become a measured zero, which is the same class of
     * bug the post sync had (see lib/sync/syncPost) one table over.
     *
     * lib/platforms/youtube.ts:189 already reads the flag correctly. This is
     * the same rule, in the reader the creator trackers actually call. */
    if (item.statistics?.hiddenSubscriberCount === true) {
      return { ok: false, reason: "unreadable", detail: "subscriberCount hidden" };
    }
    if (!Number.isFinite(followersCount)) {
      // Absent rather than withheld -- a shape the API is not documented to
      // return, so it is treated the same way rather than guessed at.
      return { ok: false, reason: "unreadable", detail: "subscriberCount missing" };
    }
    return {
      ok: true,
      profile: {
        followersCount,
        postsCount,
        avgViews,
        sampledPosts,
        ...(topPosts.length ? { topPosts } : {}),
        ...(channelThumbnail(item.snippet?.thumbnails) ? { avatarUrl: channelThumbnail(item.snippet?.thumbnails)! } : {}),
        ...(isYouTubeChannelId(item.id) ? { accountId: item.id } : {}),
      },
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (detail.startsWith("quota:")) return { ok: false, reason: "rate-limited", detail };
    return { ok: false, reason: "unreadable", detail };
  }
}

/**
 * Read one creator's public figures.
 *
 * TikTok is routed to the browser reader by the caller rather than from here, so
 * that this module stays free of the serverless-Chromium import — it is used by
 * request paths that must not pay for that bundle.
 */
export async function readCreatorProfile(
  platform: string,
  handle: string,
  options: { youtubeChannelId?: string } = {}
): Promise<CreatorReadResult> {
  switch (platform?.toUpperCase()) {
    case "INSTAGRAM":
      return readInstagram(handle);
    case "YOUTUBE":
      return readYouTube(handle, options.youtubeChannelId);
    case "TIKTOK":
      /* Profile pages are server-rendered, unlike music pages, so this is a
         plain fetch and belongs here with the others rather than behind the
         browser seam the caller used to have to supply. */
      return fetchTikTokProfile(handle);
    default:
      return { ok: false, reason: "unsupported-platform" };
  }
}
