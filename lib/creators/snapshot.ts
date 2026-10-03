import { db } from "@/lib/db";
import { captureLatestAvatar } from "@/lib/creators/avatarStore";
import type { Prisma } from "@/lib/generated/prisma";
import { createLogger } from "@/lib/observability/logger";
import { velocityBetween } from "@/lib/trackers/metrics";
import { isDueForRead, parseGranularity, DEFAULT_GRANULARITY } from "@/lib/trackers/granularity";
import {
  formatTrackerError,
  isYouTubeChannelId,
  moreSpecificFailure,
  readCreatorProfile,
  youtubeChannelIdForVideos,
  type CreatorReadResult,
  type TopPost,
} from "@/lib/platforms/creatorProfile";
import { detectPlatform } from "@/lib/platforms/postUrl";
import { followerLadder, keepPrecise } from "@/lib/platforms/precision";
import {
  describeInstagramPostReads,
  readInstagramPostForFollowers,
  type InstagramPostRead,
} from "@/lib/platforms/instagramCreatorFallback";
import { readTikTokTopPostsOfficial } from "@/lib/platforms/tiktokTopPostsOfficial";
import { embedHtmlVia, readTikTokTopPostsEmbed } from "@/lib/platforms/tiktokTopPostsEmbed";
import { readTopPostsFromCampaigns } from "./topPostsFromCampaigns";
import type { TikTokPostsRead } from "@/lib/platforms/tiktokTopPostsBrowser";
import { rosterTablesReady } from "./rosterTables";
import { recordPlatformAccountId } from "./accountIds";
import { gateFollowerReading } from "@/lib/trackers/readingGate";
import { recordSnapshotSources, type TrackerPosition } from "@/lib/trackers/sourceSwitch";
import { classifyCreatorRead, type SourceGuard } from "@/lib/ops/sourceBreaker";
import { connectedFollowerReading } from "./connectedReading";
import { pickWriter } from "@/lib/metrics/fieldSources";
import { CONNECTED_VIA } from "./followerWriter";

export { CONNECTED_VIA };

/**
 * The creator half of the tracker sweep.
 *
 * Its sibling, snapshotSounds, exists because a sound's count is only knowable
 * by asking TikTok. This exists for the same reason and a worse one: the creator
 * tracker had no reader at all. It computed averages from Post rows already in
 * this database, so it could only measure creators already on our campaigns, and
 * Creator.followersCount -- populated on 11 of 1,834 rows -- was the only
 * follower figure anywhere in the product.
 *
 * A failed read is recorded, not swallowed. Instagram will never return figures
 * for a personal account, and a tracker showing a permanent blank with no reason
 * is indistinguishable from one that is merely slow.
 */

export type CreatorSnapshotResult = {
  snapshots: number;
  failed: number;
  skipped: number;
};

export type CreatorSnapshotOptions = {
  /** Instagram reads stop at this share of Meta's hourly usage. The crons pass
   *  TRACKER_SWEEP_STOP_PERCENT; a person's Refresh passes nothing and is never held back. */
  instagramStopAtPercent?: number;
  orgId?: string;
  creatorId?: string;
  dryRun?: boolean;
  deadlineMs?: number;
  /** How long past the deadline to wait for reads still in flight before
   *  abandoning them. A test knob; the default fits inside maxDuration. */
  abandonGraceMs?: number;
  /** Injected by routes that traced Chromium into their bundle. TikTok stats
   * are a plain fetch, but the post grid arrives from a signed XHR only a real
   * browser can trigger -- the same constraint as sounds. Absent means TikTok
   * creators keep their stored topPosts and only refresh stats. */
  readTikTokPosts?: (handle: string) => Promise<TikTokPostsRead | null>;
  /** The sandbox-run curl for TikTok profile stats -- the read that works when
   * the WAF shells the direct fetch. Injected for the same bundling reason. */
  readTikTokProfileRemote?: (handle: string) => Promise<CreatorReadResult>;
  /** The embed page from an egress TikTok answers, for when this one is
   *  refused. Injected for the same bundling reason as the profile read. */
  readTikTokEmbedHtml?: (handle: string) => Promise<string | null>;

  /* Reader v2 (plan §07). Every option below is absent on the legacy sweep,
     which therefore runs exactly as it did before they existed. */

  /** TikTok profiles go straight to reader v2's lanes; the direct fetch, which
   *  this deployment's egress gets as a WAF shell, is not tried first. Reports
   *  which exit answered, for TrackerSnapshotSource. */
  readTikTokProfileVia?: (handle: string) => Promise<{ result: CreatorReadResult; via: string | null }>;
  /** Which reader this run is. Recorded with each snapshot; also turns on the
   *  validation gate (A3) and the one-read-three-uses write (T4). */
  plan?: Exclude<TrackerPosition, "legacy">;
  /** Orgs to read, or to leave out, at the query. */
  orgIdsIn?: string[];
  orgIdsNotIn?: string[];
  /** A per-creator filter on top, for a percentage rollout. */
  inScope?: (creator: { id: string; orgId: string }) => boolean;
  maxCreators?: number;
  concurrency?: number;
  /** Called once the run knows how many reads are due, before any is made --
   *  which is when the lanes can be sized (plan T3). */
  onSelected?: (due: { total: number; byPlatform: Record<string, number>; tiktokPostsStale: number }) => void | Promise<void>;
  /** The ops guard (plan §13 C), passed by the cron routes only. A platform
   *  whose kill switch is off, or whose breaker is open, is left out at the
   *  query; one whose breaker opens mid-run is skipped from then on, unstamped,
   *  so it stays first in line. Absent -- an explicit refresh, a script -- the
   *  sweep runs exactly as before. */
  sourceGuard?: SourceGuard;
};

/**
 * Creators examined in one run.
 *
 * The deadline is still what ends a run; this bounds the READ, which used to be
 * every tracked creator in the database whatever the budget could get through.
 * Ordered by trackerLastAttemptAt (see the query), so these are the staleest
 * rows and the rest rotate in next run. Not applied to a single-creator refresh,
 * which selects one row by id.
 *
 * Sized to what SWEEP_CONCURRENCY can get through in the budget -- six reads at
 * ~3.8s each for four minutes is ~380 -- so the page is not the limit.
 */
const MAX_CREATORS_PER_RUN = 400;

/**
 * Creators read at once.
 *
 * MEASURED on production 2026-09-30, the 18:30 sweep: 48 snapshots and 10
 * failures in 241s, with 142 of the 200 dropped at the deadline. The 41
 * successful TikTok reads took 155.6s, ~3.8s each, and almost all of it is
 * waiting -- on TikTok, on the embed page, on the avatar store, on Neon from
 * sin1 -- which is why the sweep's sandbox used 7-9s of CPU in a 240s life.
 * One at a time, that is ~58 creators a run and a reading every ~5.5 days
 * (median gap between readings over 14 days: 132h) against a 12-hour cadence.
 *
 * Six keeps the request rate any one TikTok egress sees modest; the direct read
 * falls back to the sandbox on its own if a burst draws the WAF shell.
 */
const SWEEP_CONCURRENCY = 6;

/**
 * How long past the deadline the sweep waits for reads still in flight.
 *
 * MEASURED on production 2026-10-01: three of the first five pooled sweeps
 * stopped writing two to three minutes in and sat silent until the platform
 * killed them at 300s -- no "complete", no "deadline" line, because every
 * worker was parked on an await that never settled, and the creators they held
 * were never stamped, so they led the next run's page and wedged it sooner
 * (332, 261, 197, 89, 51 snapshots). Whatever the await, the sweep now stops
 * waiting here: 240s deadline + 30s, inside the route's 300s with room for its
 * cleanup and response.
 */
const ABANDON_AFTER_DEADLINE_MS = 30_000;

/** Calls `fn` one at a time, in the order asked, whatever the caller's concurrency. */
function oneAtATime<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...args) => {
    const run = tail.then(() => fn(...args));
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * How expensive one creator's read is, as an ordering key rather than a time.
 *
 * Only the ranking matters, so this is deliberately not a millisecond
 * estimate that would go stale silently. TikTok is the one platform whose
 * profile and post reads go through a browser or a Vercel Sandbox; everything
 * else is a plain fetch. If another platform ever needs a browser, it belongs
 * on the same rung -- the cost that matters is "does this hold the budget".
 */
export function readCostRank(platform: string): number {
  return platform === "TIKTOK" ? 1 : 0;
}

/** Posts move much slower than follower counts; a grid read costs ~12s of
 * browser where a stats read costs one HTTP request. Once a day is the same
 * cadence CreatorCore refreshes its own Top Posts at. */
const TOP_POSTS_MAX_AGE_MS = 20 * 60 * 60 * 1000;

/** True when the stored list is old enough to be worth re-reading. A creator
 *  we have never read has no list, which counts as stale. */
function postsAreStaleFor(creator: { topPostsAt: Date | null }): boolean {
  return (
    !creator.topPostsAt || Date.now() - creator.topPostsAt.getTime() > TOP_POSTS_MAX_AGE_MS
  );
}

/** The same question for the PLATFORM rungs, which a campaign-scoped list must
 *  never hold off: it is the weaker claim, so a creator sitting on one is
 *  always worth asking the platform about again. Otherwise a creator who
 *  connects their TikTok today would keep the campaign list for another day. */
function platformPostsAreStaleFor(creator: {
  topPostsAt: Date | null;
  topPostsSource: string | null;
}): boolean {
  return creator.topPostsSource !== "platform" || postsAreStaleFor(creator);
}

/** The posts ladder without the browser rung: one official-API call for a
 *  connected TikTok creator, then the posts this workspace already tracks.
 *  Cheap enough to run on paths where the follower read did not happen, which
 *  matters because Top Posts keep their own (much slower) cadence -- gating
 *  them behind the follower cadence meant a creator read 20 minutes ago could
 *  not get posts for another whole period. */
async function readPostsWithoutBrowser(
  creator: { id: string; orgId: string; handle: string; platform: string },
  embedHtml?: (handle: string) => Promise<string | null>
): Promise<{ topPosts: TopPost[]; source: "platform" | "campaigns" } | null> {
  if (creator.platform === "TIKTOK") {
    const official = await readTikTokTopPostsOfficial(creator.id, creator.orgId, creator.handle).catch(
      () => null
    );
    if (official?.topPosts.length) return { topPosts: official.topPosts, source: "platform" };

    const embed = await readTikTokTopPostsEmbed(creator.handle, (h) =>
      embedHtmlVia(h, embedHtml)
    ).catch(() => null);
    if (embed?.topPosts.length) return { topPosts: embed.topPosts, source: "platform" };
  }
  const fromCampaigns = await readTopPostsFromCampaigns(creator.id).catch(() => null);
  if (fromCampaigns?.topPosts.length) {
    return { topPosts: fromCampaigns.topPosts, source: "campaigns" };
  }
  return null;
}

/* Four, and the number is measured rather than chosen. Walking a creator's own
   posts newest-first on production 2026-09-16, over 40 tracked creators: 22 of
   40 answered on the first post, 23 within three, 24 within four, and the curve
   is FLAT from four to twelve. So a deeper walk buys nothing and costs a ~450ms
   fetch (p90 846ms) per extra post on exactly the creators that are already
   failing -- the ones whose posts are all gone, or all owned by somebody
   else. */
const IG_FALLBACK_POSTS = 4;

/** The read, or a line saying what stopped it. */
type InstagramOwnPostRead =
  | { read: CreatorReadResult }
  | { read: null; note: string };

/**
 * The Instagram posts this workspace holds for a creator, read for the one
 * thing it can tell us that the platform will not: their follower count.
 *
 * Newest first, because the commonest reason a read comes back empty is that
 * the post itself is gone -- the embed for a deleted reel still answers 200
 * with a full-size page, just with "contextJSON":null and no owner in it. The
 * extra fetches only ever happen for a creator whose earlier post did not
 * answer, and only after the credentialled read has already failed.
 *
 * Scoped through Campaign.orgId -- Post has no orgId of its own -- so a
 * creator's read can only ever be answered by their own org's rows.
 *
 * When none of them answers it returns a note rather than a bare null: the
 * three ways this rung fails need three different things done about them, and
 * the caller has no other way to tell them apart.
 */
async function readInstagramFollowersViaOwnPost(creator: {
  id: string;
  orgId: string;
  handle: string;
}): Promise<InstagramOwnPostRead> {
  const posts = await db.post
    .findMany({
      where: {
        creatorId: creator.id,
        platform: "INSTAGRAM",
        campaign: { orgId: creator.orgId, deletedAt: null },
      },
      orderBy: { postedAt: "desc" },
      select: { postUrl: true },
      take: IG_FALLBACK_POSTS,
    })
    .catch(() => []);

  const outcomes: InstagramPostRead[] = [];
  for (const post of posts) {
    if (!post.postUrl) continue;
    const read = await readInstagramPostForFollowers(creator.handle, post.postUrl);
    if (read.ok) return { read: { ok: true, profile: read.profile } };
    outcomes.push(read);
  }
  return { read: null, note: describeInstagramPostReads(outcomes) };
}

const YT_FALLBACK_POSTS = 5;

/** The channel behind a YouTube creator's own campaign posts, if they agree. */
async function youtubeChannelFromOwnPosts(creator: { id: string; orgId: string }): Promise<string | null> {
  const posts = await db.post
    .findMany({
      where: {
        creatorId: creator.id,
        platform: "YOUTUBE",
        campaign: { orgId: creator.orgId, deletedAt: null },
      },
      orderBy: { postedAt: "desc" },
      select: { platformPostId: true, postUrl: true },
      take: YT_FALLBACK_POSTS,
    })
    .catch(() => []);
  const videoIds = posts
    .map((p) =>
      /^[\w-]{11}$/.test(p.platformPostId) ? p.platformPostId : detectPlatform(p.postUrl ?? "")?.id ?? null
    )
    .filter((id): id is string => Boolean(id));
  return youtubeChannelIdForVideos(videoIds);
}

/** Writes only the posts columns, for the paths where no snapshot was taken. */
async function storeTopPostsOnly(
  creatorId: string,
  read: { topPosts: TopPost[]; source: "platform" | "campaigns" }
): Promise<void> {
  await db.creator
    .update({
      where: { id: creatorId },
      data: {
        topPosts: read.topPosts as unknown as Prisma.InputJsonValue,
        topPostsAt: new Date(),
        topPostsSource: read.source,
      },
    })
    .catch(() => {});
}

/** The creator's newest non-zero follower reading, or null. Never throws. */
async function lastNonZeroFollowers(creatorId: string): Promise<number | null> {
  try {
    const row = await db.creatorTrackerSnapshot.findFirst({
      where: { creatorId, followersCount: { gt: 0 } },
      orderBy: { recordedAt: "desc" },
      select: { followersCount: true },
    });
    return row?.followersCount ?? null;
  } catch {
    return null;
  }
}

export async function snapshotCreators(
  options: CreatorSnapshotOptions = {}
): Promise<CreatorSnapshotResult> {
  const {
    orgId,
    creatorId,
    dryRun = false,
    deadlineMs = 4 * 60 * 1000,
    abandonGraceMs = ABANDON_AFTER_DEADLINE_MS,
    readTikTokPosts: readTikTokPostsInjected,
    readTikTokProfileRemote,
    readTikTokEmbedHtml,
    readTikTokProfileVia,
    plan,
    orgIdsIn,
    orgIdsNotIn,
    inScope,
    maxCreators = MAX_CREATORS_PER_RUN,
    concurrency = SWEEP_CONCURRENCY,
    onSelected,
    sourceGuard,
    instagramStopAtPercent,
  } = options;
  const log = createLogger({ context: { job: "snapshot-creators", orgId: orgId ?? "all", ...(plan ? { reader: plan } : {}) } });
  const deadline = Date.now() + deadlineMs;
  /* The browser rung opens a Chromium page per read, in a function that runs
     single-process Chromium in its memory. It has already reported
     ERR_INSUFFICIENT_RESOURCES one page at a time, so however many creators
     are in flight, it only ever sees one. A read still queued at the deadline
     gets nothing: each can take up to 90s, and a queue of them would outlive
     the function. The rungs after it treat null as "no grid", as they always
     have. */
  const readTikTokPosts = readTikTokPostsInjected
    ? oneAtATime((handle: string) => (Date.now() > deadline ? Promise.resolve(null) : readTikTokPostsInjected(handle)))
    : undefined;

  let snapshots = 0;
  let failed = 0;
  let skipped = 0;

  const selected = await db.creator.findMany({
    // orgId stays in the filter alongside creatorId for the same reason it does
    // in snapshotSounds: a scope check here costs nothing.
    where: {
      deletedAt: null,
      trackedSince: { not: null },
      ...(creatorId ? { id: creatorId } : {}),
      ...(orgId
        ? { orgId }
        : orgIdsIn || orgIdsNotIn
          ? { orgId: { ...(orgIdsIn ? { in: orgIdsIn } : {}), ...(orgIdsNotIn ? { notIn: orgIdsNotIn } : {}) } }
          : {}),
      /* Left out here rather than skipped one by one, so a platform that is
         switched off cannot fill the page and starve the others. */
      ...(sourceGuard?.excludedPlatforms.length ? { platform: { notIn: sourceGuard.excludedPlatforms } } : {}),
    },
    ...(creatorId ? {} : { take: maxCreators }),
    select: {
      id: true,
      orgId: true,
      handle: true,
      platform: true,
      platformUserId: true,
      /* Read only to refuse a lossy overwrite below -- see keepPrecise. */
      followersCount: true,
      topPostsAt: true,
      topPostsSource: true,
      trackerSnapshots: {
        orderBy: { recordedAt: "desc" },
        take: 1,
        select: { followersCount: true, recordedAt: true },
      },
    },
    /* Rotating, not fixed.
     *
     * This was `trackedSince: "asc"` with no `take`, which is two problems in
     * one line. Unbounded, the run reads every tracked creator on the platform
     * to process however many the deadline allows -- and it processes the SAME
     * prefix every time, because trackedSince never changes. A workspace whose
     * head takes the whole budget therefore has a tail that is never once read,
     * and no amount of waiting fixes it.
     *
     * trackerLastAttemptAt is stamped on every attempt, success or failure, so
     * ascending-nulls-first is "whoever has waited longest, and never-attempted
     * first". The head of the read is then exactly the population that is due,
     * the tail rotates in on the next run, and a creator that was just read
     * sorts to the back rather than being re-examined and skipped. */
    orderBy: { trackerLastAttemptAt: { sort: "asc", nulls: "first" } },
  });
  const creators = inScope ? selected.filter(inScope) : selected;

  if (creators.length === 0) return { snapshots, failed, skipped };

  /* Cheapest platforms first, within the batch the query already chose.
   *
   * The selection above stays exactly as it was -- the stalest rows, so
   * nothing is starved out of being CONSIDERED. What changes is the order they
   * are worked through, because the deadline is what actually ends a run and a
   * TikTok read is not like the others: it opens a browser or a Sandbox, while
   * Instagram and YouTube are ordinary HTTP.
   *
   * MEASURED on production 2026-09-16, the 06:30 sweep: 58 creators processed
   * inside the 4-minute budget -- 56 TikTok and 2 Instagram -- and 142 of the
   * 200 read were dropped at the deadline. That is ~4.2s per TikTok creator
   * against ~450ms for an Instagram embed read (p90 846ms). Instagram has 246
   * tracked creators; at two per six-hourly run the column fills in some time
   * next year.
   *
   * Sorting the cheap ones to the front costs TikTok only the seconds the
   * cheap reads take -- on that batch's mix, roughly four TikTok creators out
   * of fifty-six -- and buys every Instagram and YouTube creator in the batch
   * a read instead of two of them. Stable, so within a platform the staleness
   * order the query established is untouched. */
  creators.sort((a, b) => readCostRank(a.platform) - readCostRank(b.platform));

  /* Cadence is per-organisation, as it is for sounds, so an org on the 6-hourly
     setting does work on one run in six rather than needing its own schedule. */
  const orgIds = [...new Set(creators.map((c) => c.orgId))];
  const orgs = await db.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, uiConfig: true },
  });
  const cadenceByOrg = new Map(orgs.map((o) => [o.id, parseGranularity(o.uiConfig)]));
  const now = new Date();

  if (onSelected) {
    const byPlatform: Record<string, number> = {};
    let total = 0;
    /* TikTok Top Posts come from the embed page, which goes through the same
       lanes when this egress is refused it, so it counts toward their size. */
    let tiktokPostsStale = 0;
    for (const c of creators) {
      const cadence = cadenceByOrg.get(c.orgId) ?? DEFAULT_GRANULARITY;
      const due = isDueForRead(c.trackerSnapshots[0]?.recordedAt ?? null, cadence, now);
      if (c.platform === "TIKTOK" && (due ? platformPostsAreStaleFor(c) : postsAreStaleFor(c))) tiktokPostsStale++;
      if (!due) continue;
      byPlatform[c.platform] = (byPlatform[c.platform] ?? 0) + 1;
      total++;
    }
    await onSelected({ total, byPlatform, tiktokPostsStale });
  }

  /* Which exit read each snapshot, written in one batch at the end. */
  const sources: { snapshotId: string; creatorId: string; plan: TrackerPosition; exitId: string | null; recordedAt: Date }[] = [];

  log.info("creator sweep starting", {
    /* Which region this actually ran in -- preferredRegion is a request, and
       whether Vercel honored it was exactly the question the last two hours of
       debugging needed answered. */
    region: process.env.VERCEL_REGION ?? "local",
    considered: creators.length,
    platforms: creators.reduce<Record<string, number>>((acc, c) => {
      acc[c.platform] = (acc[c.platform] ?? 0) + 1;
      return acc;
    }, {}),
  });

  const readOne = async (creator: (typeof creators)[number], at: { stage: string }): Promise<void> => {
    if (sourceGuard && !sourceGuard.admit(creator.platform)) {
      skipped++;
      return;
    }
    const cadence = cadenceByOrg.get(creator.orgId) ?? DEFAULT_GRANULARITY;
    const previous = creator.trackerSnapshots[0] ?? null;

    /* Even an explicit refresh respects the gate: re-reading a figure that cannot
       have moved records the same number twice and turns the change column into
       a plateau that never happened. */
    if (!isDueForRead(previous?.recordedAt ?? null, cadence, now)) {
      skipped++;
      /* Top Posts keep their own, much slower cadence, so a creator whose
         follower read is not due can still be due a posts read -- that is why
         this rung exists here at all.
      
         It asks postsAreStaleFor (age) and NOT platformPostsAreStaleFor
         (age OR source !== "platform"). The source clause is permanently true
         for every creator whose list came from campaign posts, so on this path
         it meant an official-API call, an embed fetch and a database read for
         each of them on EVERY run, forever, for a list that is at most 20 hours
         old. The upgrade from a campaigns list to a platform list still
         happens; it happens once a day, like every other posts read. */
      if (!dryRun && postsAreStaleFor(creator)) {
        at.stage = "posts";
        const read = await readPostsWithoutBrowser(creator, readTikTokEmbedHtml);
        if (read) await storeTopPostsOnly(creator.id, read);
      }
      return;
    }

    let result: CreatorReadResult;
    let via: string | null = null;
    try {
      at.stage = "profile";
      if (creator.platform === "TIKTOK" && readTikTokProfileVia && !dryRun) {
        at.stage = "lanes";
        const read = await readTikTokProfileVia(creator.handle);
        result = read.result;
        via = read.via;
      } else {
        result = await readCreatorProfile(creator.platform, creator.handle, { instagramStopAtPercent, orgId: creator.orgId });
      }
    } catch (e) {
      result = {
        ok: false,
        reason: "unreadable",
        detail: e instanceof Error ? e.message : String(e),
      };
    }

    /* TikTok's WAF serves this deployment's egress a 1.4KB login shell for
       profile pages -- to plain fetch and to headless Chromium alike -- so a
       failed direct read goes to the sandbox fetcher, which runs the same
       request from an egress TikTok answers. */
    if (!result.ok && creator.platform === "TIKTOK" && readTikTokProfileRemote && !readTikTokProfileVia && !dryRun) {
      at.stage = "sandbox";
      const remote = await readTikTokProfileRemote(creator.handle).catch(
        (e): CreatorReadResult => ({
          ok: false,
          reason: "unreadable",
          detail: `sandbox: ${e instanceof Error ? e.message : String(e)}`,
        })
      );
      if (remote.ok) result = remote;
      else {
        /* The sandbox is the rung that can actually reach TikTok, so it is
           usually the one that learns *why* -- "no such account" among them.
           Keeping the direct read's reason and only appending the sandbox's
           detail buried that: .olise.ftbl was a deleted handle filed as
           "unreadable", and the screen told the operator to wait. */
        const reason = moreSpecificFailure(result.reason, remote.reason);
        const detail =
          remote.detail && remote.detail !== result.detail
            ? `${result.detail ?? result.reason}; ${remote.detail}`
            : result.detail;
        result = { ok: false, reason, ...(detail ? { detail } : {}) };
      }
    }

    /* Last resort for stats, and normally pointless (the WAF shells the
       browser too) -- but it is also how the grid read reports evidence, so it
       stays behind the remote read rather than ahead of it.

       Not for an account TikTok has already said does not exist. That answer
       (statusCode 10221) comes inside a page TikTok served in full, and the
       browser would only ask the same server again -- once per renamed or
       deleted handle, every run, which is how the pooled sweep came to spend
       most of its browser pages, and its wedges, on accounts that are gone. */
    let gridRead: TikTokPostsRead | null | undefined;
    if (
      !result.ok &&
      result.reason !== "no-such-account" &&
      creator.platform === "TIKTOK" &&
      readTikTokPosts &&
      !dryRun
    ) {
      at.stage = "browser";
      let browserDetail: string | null = null;
      gridRead = await readTikTokPosts(creator.handle).catch((e) => {
        browserDetail = e instanceof Error ? e.message : String(e);
        return null;
      });
      if (!gridRead && browserDetail && !result.ok) {
        /* Both paths failed; store both, because "fetch got a WAF shell" and
           "the browser saw X" point at different problems. */
        result = {
          ...result,
          detail: `${result.detail ?? result.reason}; browser: ${browserDetail}`,
        };
      }
      if (gridRead?.profile) {
        result = {
          ok: true,
          profile: {
            followersCount: gridRead.profile.followersCount,
            postsCount: gridRead.profile.postsCount,
            avgViews: gridRead.avgViews,
            sampledPosts: gridRead.sampledPosts,
            ...(gridRead.topPosts.length ? { topPosts: gridRead.topPosts } : {}),
          },
        };
      }
    }

    /* Instagram's one credentialled reader answers for nobody without a Meta
       token and for no personal account with one, which on production means it
       has never answered at all. The embed rung needs no credential but needs a
       post: one of the creator's own, which is exactly what a tracked creator
       tends to have. Same shape as TikTok's sandbox rung above -- it only runs
       when the platform read has already failed, and it never downgrades a
       reason: what it returns on failure is a note appended to the platform's
       own, not a reason of its own. */
    let instagramNote: string | null = null;
    if (!result.ok && creator.platform === "INSTAGRAM" && !dryRun) {
      at.stage = "instagram-post";
      const fromPost = await readInstagramFollowersViaOwnPost(creator);
      if (fromPost.read) result = fromPost.read;
      else instagramNote = fromPost.note;
    }

    /* YouTube's handle column often holds the channel's display name, which
       forHandle cannot resolve however long we wait. The handle stays the
       first question, so a corrected handle always wins; after it, the channel
       id this rung found last time, then the channel the creator's own
       campaign videos were published by. */
    let youtubeChannelId: string | null = null;
    if (!result.ok && result.reason === "no-such-account" && creator.platform === "YOUTUBE" && !dryRun) {
      at.stage = "youtube-own-post";
      youtubeChannelId = isYouTubeChannelId(creator.platformUserId)
        ? creator.platformUserId
        : await youtubeChannelFromOwnPosts(creator);
      if (youtubeChannelId) {
        /* Whatever the channel read says is truer than "no channel for
           handle": the channel exists, so a failure here is about it. */
        result = await readCreatorProfile(creator.platform, creator.handle, { youtubeChannelId });
        if (!result.ok) youtubeChannelId = null;
      }
    }

    if (dryRun) {
      if (result.ok) snapshots++;
      else failed++;
      return;
    }

    /* After every rung, so the breaker hears what the run finally got: a
       TikTok profile the sandbox rescued is the source working. */
    sourceGuard?.record(creator.platform, classifyCreatorRead(result), result.ok ? null : result.reason);

    /* The read that produced these figures also saw the profile picture, on a
       signed link that will be dead within days. Keep the image, not the link. */
    if (result.ok && result.profile.avatarUrl) {
      at.stage = "avatar";
      await captureLatestAvatar(creator, result.profile.avatarUrl).catch((e) =>
        log.warn("avatar capture failed", {
          creatorId: creator.id,
          error: e instanceof Error ? e.message : String(e),
        })
      );
    }

    if (!result.ok) {
      failed++;
      /* Logged as well as stored. The stored copy is for the reader in the UI;
         this one is for whoever is looking at why a whole sweep did nothing --
         a silent failure here previously left no trace outside the database. */
      log.warn("creator read failed", {
        creatorId: creator.id,
        platform: creator.platform,
        handle: creator.handle,
        reason: result.reason,
        detail: result.detail ?? null,
        ownPosts: instagramNote,
      });
      /* A creator we cannot read is exactly the one whose tracked campaign
         posts are the only Top Posts we will ever have -- a renamed handle
         does not un-publish the videos they made for us. So the fallback runs
         here too, on its own cadence, without pretending the follower read
         succeeded. */
      at.stage = "posts";
      const salvaged =
        platformPostsAreStaleFor(creator) && !dryRun
          ? await readPostsWithoutBrowser(creator, readTikTokEmbedHtml)
          : null;

      /* Stamped even though no snapshot exists, so the UI can tell "we tried and
         this account cannot be read" from "we have not got to it yet". */
      await db.creator
        .update({
          where: { id: creator.id },
          data: {
            trackerLastAttemptAt: new Date(),
            trackerLastError: formatTrackerError(
              result.reason,
              result.detail,
              instagramNote
            ),
            ...(salvaged
              ? {
                  topPosts: salvaged.topPosts as unknown as Prisma.InputJsonValue,
                  topPostsAt: new Date(),
                  topPostsSource: salvaged.source,
                }
              : {}),
          },
        })
        .catch(() => {});
      return;
    }

    const { profile } = result;

    /* TikTok: the stats read cannot see posts, so posts are a separate read on
       their own daily cadence. A posts failure is not a creator failure -- the
       follower snapshot still lands either way.

       Two sources, tried in that order:
         1. The official Display API (video.list), for a creator who connected
            their account through the portal. One HTTPS request, real counts,
            no browser, no scraping.
         2. The browser grid, which is kept as a rung but has never worked from
            Vercel -- /api/post/item_list/ answers 200 with a zero-byte body to
            every browser measured. It is here for the day that changes, and
            because it costs nothing when rung 1 answers. */
    const postsAreStale = postsAreStaleFor(creator);
    const platformPostsAreStale = platformPostsAreStaleFor(creator);

    let tiktokPosts: TikTokPostsRead | null = null;
    let topPostsSource: "platform" | "campaigns" | null = null;
    if (creator.platform === "TIKTOK" && platformPostsAreStale && !dryRun) {
      at.stage = "posts-official";
      const official = await readTikTokTopPostsOfficial(creator.id, creator.orgId, creator.handle).catch(
        (e) => {
          log.warn("tiktok official posts read failed", {
            creatorId: creator.id,
            handle: creator.handle,
            error: e instanceof Error ? e.message : String(e),
          });
          return null;
        }
      );
      /* null means "no usable connection", which is not a failure and must not
         consume the creator's daily slot for the browser rung below. */
      if (official) {
        tiktokPosts = { ...official, profile: null };
        topPostsSource = "platform";
        log.info("tiktok top posts from official API", {
          creatorId: creator.id,
          handle: creator.handle,
          posts: official.topPosts.length,
        });
      }
    }

    /* Rung 2: TikTok's own embed page. It server-renders the creator's video
       list -- id, caption, cover, playCount -- because it exists to be embedded
       by other sites, so it needs no consent, no browser and no signing params.
       This is what covers a creator who never connected their account, which
       every rung below it failed to do. */
    if (!tiktokPosts && creator.platform === "TIKTOK" && platformPostsAreStale && !dryRun) {
      at.stage = "posts-embed";
      const embed = await readTikTokTopPostsEmbed(creator.handle, (h) =>
        embedHtmlVia(h, readTikTokEmbedHtml)
      ).catch((e) => {
        log.warn("tiktok embed posts read failed", {
          creatorId: creator.id,
          handle: creator.handle,
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      });
      if (embed?.topPosts.length) {
        tiktokPosts = { ...embed, profile: null };
        topPostsSource = "platform";
        log.info("tiktok top posts from embed page", {
          creatorId: creator.id,
          handle: creator.handle,
          posts: embed.topPosts.length,
        });
      }
    }

    if (
      !tiktokPosts &&
      creator.platform === "TIKTOK" &&
      readTikTokPosts &&
      gridRead === undefined && // the WAF fallback above has not already read the page
      platformPostsAreStale
    ) {
      at.stage = "browser";
      tiktokPosts = await readTikTokPosts(creator.handle).catch((e) => {
        log.warn("tiktok grid read failed", {
          creatorId: creator.id,
          handle: creator.handle,
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      });
      if (tiktokPosts && tiktokPosts.topPosts.length) topPostsSource = "platform";
    }

    /* Last rung, and the only one that asks TikTok for nothing: the posts this
       workspace already tracks for the creator, whose counts the sync cron
       keeps current. It answers where the two rungs above cannot -- an
       unconnected creator whose grid TikTok refuses -- and it is recorded as a
       DIFFERENT source, because "their best videos in your campaigns" is a
       narrower claim than "their best videos" and the panel has to say so.

       Runs for every platform: an Instagram or YouTube creator whose API read
       came back without posts gets the same fallback. */
    if (!tiktokPosts?.topPosts.length && !profile.topPosts?.length && postsAreStale && !dryRun) {
      at.stage = "posts-campaigns";
      const fromCampaigns = await readTopPostsFromCampaigns(creator.id).catch((e) => {
        log.warn("campaign top posts read failed", {
          creatorId: creator.id,
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      });
      if (fromCampaigns?.topPosts.length) {
        topPostsSource = "campaigns";
        profile.topPosts = fromCampaigns.topPosts;
        /* Deliberately NOT touching avgViews/sampledPosts: those feed the
           follower-growth snapshot and must keep meaning "measured across the
           creator's own catalogue", not "across the ones we happen to run". */
        log.info("top posts from tracked campaign posts", {
          creatorId: creator.id,
          handle: creator.handle,
          posts: fromCampaigns.topPosts.length,
        });
      }
    }

    if (tiktokPosts && tiktokPosts.sampledPosts > 0) {
      profile.avgViews = tiktokPosts.avgViews;
      profile.sampledPosts = tiktokPosts.sampledPosts;
      profile.topPosts = tiktokPosts.topPosts;
    }

    /* A profile read that carried posts of its own (YouTube's uploads feed,
       for one) is the creator's own catalogue -- label it, or the panel shows
       an unlabelled list and the source column stops meaning anything. */
    if (!topPostsSource && profile.topPosts?.length) topPostsSource = "platform";

    const recordedAt = new Date();

    /* Reader v2 only: one writer per field (plan A7, lib/metrics/fieldSources).
       The creator's own connection outranks the public read for their follower
       count, so a fresh figure from it -- through the grant gate, for the same
       account, newer than the last snapshot -- is what this snapshot records,
       and the snapshot says so in its exit column. The public read still ran
       and still feeds everything else here (posts, averages, the avatar). The
       legacy sweep is left exactly as it was. */
    let readFollowers = profile.followersCount;
    if (plan) {
      at.stage = "connected";
      const connected = await connectedFollowerReading(creator, previous?.recordedAt ?? null);
      const winner = pickWriter(
        "creator.followers",
        [{ source: "public" as const, value: profile.followersCount, measuredAt: recordedAt }, ...(connected ? [connected] : [])],
        recordedAt,
      );
      if (winner?.source === "connected") {
        readFollowers = winner.value;
        via = CONNECTED_VIA;
      }
    }

    /* A platform that only publishes a rendered figure must not be allowed to
       grind down an exact one we already hold. YouTube's Data API rounds
       subscriberCount to three significant figures above 1,000 and offers
       nothing better; TikTok's profile statsV2 and Instagram's followers_count
       are exact, and take the exact ladder, so this changes nothing for them.

       It has to happen before the delta, not just at the write: a series that
       alternates an exact 1,234,567 with a rounded 1,230,000 reports a 4,567
       drop and a negative velocity for a channel that only grew.

       Reader v2 anchors on the last reading it recorded, not on the Creator
       column: an agency can type over that column, and a typed-in figure is
       never what a computed change is measured from (plan A8). */
    const followersCount =
      keepPrecise(
        readFollowers,
        plan ? previous?.followersCount : creator.followersCount,
        followerLadder(creator.platform),
      ) ?? readFollowers;

    /* The last real figure, which is not always the newest reading: a 0 the
       legacy sweep stored before the rule below existed is not a baseline, and
       judging against it waves the next 0 through and skips every hold. Looked
       up only when the newest reading is itself 0, so the common case costs no
       query. */
    const anchor =
      previous && !(previous.followersCount > 0)
        ? ((await lastNonZeroFollowers(creator.id)) ?? previous.followersCount)
        : (previous?.followersCount ?? null);

    /* Reader v2 only: a reading that cannot be right is never written, and a
       surprising one waits for a second read (plan A3). The attempt is still
       stamped so the creator rotates, but no snapshot lands, so they stay due
       and the next hourly run is the confirming read. */
    if (plan) {
      at.stage = "gate";
      const verdict = await gateFollowerReading({
        creator,
        previous: anchor !== null ? { followersCount: anchor } : null,
        next: { followersCount, postsCount: profile.postsCount },
        via,
      }).catch(() => ({ action: "write" as const }));
      if (verdict.action !== "write") {
        skipped++;
        log.warn("tracker reading not written", {
          creatorId: creator.id,
          platform: creator.platform,
          verdict: verdict.action,
          reason: verdict.reason,
          via,
        });
        await db.creator
          .update({ where: { id: creator.id }, data: { trackerLastAttemptAt: new Date() } })
          .catch(() => {});
        return;
      }
    }

    /* Both paths, and after the gate so a gate that threw cannot let it by: a
       count that fell to 0 from something is a page that was not the profile
       (lib/trackers/readingGate), never a reading. The legacy sweep used to
       write it -- three TikTok creators on 2026-10-02, found by the canary's
       first run -- which drew a -100% change and a cliff on the chart and put
       0 on the roster. The good figure already stored stays. */
    if (followersCount === 0 && anchor !== null && anchor > 0) {
      skipped++;
      log.warn("tracker reading not written", {
        creatorId: creator.id,
        platform: creator.platform,
        verdict: "reject",
        reason: `fell to 0 from ${Math.round(anchor)}`,
        via,
      });
      await db.creator
        .update({ where: { id: creator.id }, data: { trackerLastAttemptAt: new Date() } })
        .catch(() => {});
      return;
    }

    const deltaFollowers = previous
      ? Math.round(followersCount - previous.followersCount)
      : 0;
    // Percentage growth against the previous reading, matching how the sound
    // tracker stores velocityScore on each snapshot.
    const velocityScore = previous
      ? velocityBetween(previous.followersCount, followersCount)
      : 0;

    /* The channel this read actually answered for, whichever rung found it.
       Kept so the next read can ask by id when the handle stops resolving --
       a handle can be renamed, a channel id cannot. */
    const channelId =
      creator.platform === "YOUTUBE" && isYouTubeChannelId(profile.accountId) ? profile.accountId : youtubeChannelId;

    /* The one unguarded await in the sweep, and the only write that ends it.
       Every read above is wrapped, so a creator TikTok refuses costs one
       `failed` and the run continues -- but a unique-constraint clash, a lost
       Neon connection or a deadlock here threw straight out of snapshotCreators
       and abandoned every creator after this one, after paying for their
       browser and sandbox time. One creator's write failing is one creator's
       problem. */
    try {
      at.stage = "write";
      const [snapshot] = await db.$transaction([
        db.creatorTrackerSnapshot.create({
          data: {
            creatorId: creator.id,
            followersCount,
            postsCount: profile.postsCount,
            avgViews: profile.avgViews,
            deltaFollowers,
            velocityScore,
            recordedAt,
          },
        }),
        /* The denormalised columns on Creator are what the rest of the product
           reads (rosters, media kits, exports). Leaving them stale would mean the
           tracker knew a number the rest of the app did not.
           averageViews is only written when the mean came from real samples --
           writing 0 for a creator whose posts carry no view counts would report a
           measured zero for something we simply could not see. */
        db.creator.update({
          where: { id: creator.id },
          data: {
            followersCount,
            ...(profile.sampledPosts > 0 ? { averageViews: profile.avgViews } : {}),
            /* topPosts only moves forward -- an absent list on this read means
               "not measured here", never "the posts are gone". */
            ...(profile.topPosts?.length
              ? {
                  topPosts: profile.topPosts,
                  topPostsAt: recordedAt,
                  /* Recorded with the list, never on its own: the label has to
                     describe the posts actually stored, so a read that changed
                     nothing must not relabel what is already there. */
                  ...(topPostsSource ? { topPostsSource } : {}),
                }
              : {}),
            ...(channelId && channelId !== creator.platformUserId ? { platformUserId: channelId } : {}),
            trackerLastAttemptAt: recordedAt,
            trackerLastError: null,
          },
        }),
      ]);
      snapshots++;
      /* The account's stable id, from this same read (plan A4). Never throws
         and never reads anything itself; a missing table or id writes nothing. */
      await recordPlatformAccountId({
        creatorId: creator.id,
        orgId: creator.orgId,
        platform: creator.platform,
        handle: creator.handle,
        profile,
        source: "tracker",
        now: recordedAt,
      });
      if (plan) {
        sources.push({ snapshotId: (snapshot as { id?: string } | undefined)?.id ?? "", creatorId: creator.id, plan, exitId: via, recordedAt });
        /* One read, three uses (plan T4): the roster's link for this account
           takes the same figure, so the hourly roster pass finds it fresh and
           does not read the profile again. The avatar was already kept above. */
        if (await rosterTablesReady()) {
          await db.creatorProfileLink
            .updateMany({
              where: {
                orgId: creator.orgId,
                creatorId: creator.id,
                platform: creator.platform as never,
                handle: { equals: creator.handle.replace(/^@/, ""), mode: "insensitive" },
              },
              data: {
                followersCount,
                ...(profile.sampledPosts > 0 ? { averageViews: profile.avgViews } : {}),
                refreshedAt: recordedAt,
                refreshError: null,
              },
            })
            .catch(() => {});
        }
      }
    } catch (e) {
      failed++;
      log.error("creator snapshot write failed", {
        creatorId: creator.id,
        handle: creator.handle,
        error: e instanceof Error ? e.message : String(e),
      });
      /* Best-effort breadcrumb for the UI, on the same column the read-failure
         path uses. Swallowed: this is already the failure handler. */
      await db.creator
        .update({
          where: { id: creator.id },
          data: {
            trackerLastAttemptAt: new Date(),
            trackerLastError: `snapshot-write-failed: ${
              e instanceof Error ? e.message : String(e)
            }`,
          },
        })
        .catch(() => {});
    }
  };

  /* A pool, not a batch: each worker takes the next creator as soon as its last
     one is done, so one slow read holds up one worker rather than a whole wave.
     Past the deadline a worker stops taking new ones; the creators nobody
     started are counted in one go so the tally still adds up to the read. */
  let started = 0;
  const inFlight = new Map<string, { stage: string }>();
  const worker = async (): Promise<void> => {
    while (started < creators.length) {
      if (Date.now() > deadline) return;
      const creator = creators[started++];
      const at = { stage: "start" };
      inFlight.set(creator.id, at);
      try {
        await readOne(creator, at);
      } catch (e) {
        /* Every read above has its own catch; this is for the one nobody
           foresaw. It used to end the whole sweep, and with other reads in
           flight it would now leave them running unobserved. */
        failed++;
        log.error("creator read threw", {
          creatorId: creator.id,
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        inFlight.delete(creator.id);
      }
    }
  };

  let backstop: ReturnType<typeof setTimeout> | undefined;
  const finished = await Promise.race([
    Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), creators.length) }, worker)).then(() => true),
    new Promise<false>((resolve) => {
      backstop = setTimeout(() => resolve(false), Math.max(0, deadline + abandonGraceMs - Date.now()));
    }),
  ]);
  clearTimeout(backstop);

  if (!finished) {
    /* See ABANDON_AFTER_DEADLINE_MS. The stage says which await never came
       back, which is the one thing the silence before a 504 never told us.
       Stamping the attempt sends these creators to the back of the rotation
       instead of to the head of the next run. */
    const stuck = [...inFlight.entries()];
    skipped += stuck.length;
    log.error("creator sweep abandoned reads that never returned", {
      abandoned: stuck.length,
      stages: stuck.reduce<Record<string, number>>((acc, [, at]) => {
        acc[at.stage] = (acc[at.stage] ?? 0) + 1;
        return acc;
      }, {}),
    });
    if (!dryRun && stuck.length) {
      await db.creator
        .updateMany({
          where: { id: { in: stuck.map(([id]) => id) } },
          data: { trackerLastAttemptAt: new Date() },
        })
        .catch(() => {});
    }
  }

  const notStarted = creators.length - started;
  if (notStarted > 0) {
    skipped += notStarted;
    log.warn("creator sweep hit its deadline", {
      processed: started,
      remaining: notStarted,
    });
  }

  if (plan && !dryRun) await recordSnapshotSources(sources.filter((s) => s.snapshotId)).catch(() => {});

  log.info("creator sweep complete", { snapshots, failed, skipped, considered: creators.length });
  return { snapshots, failed, skipped };
}
