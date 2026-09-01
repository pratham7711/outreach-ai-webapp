import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import { velocityBetween } from "@/lib/trackers/metrics";
import { isDueForRead, parseGranularity, DEFAULT_GRANULARITY } from "@/lib/trackers/granularity";
import { readCreatorProfile, type CreatorReadResult } from "@/lib/platforms/creatorProfile";
import { readTikTokTopPostsOfficial } from "@/lib/platforms/tiktokTopPostsOfficial";
import type { TikTokPostsRead } from "@/lib/platforms/tiktokTopPostsBrowser";

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
  orgId?: string;
  creatorId?: string;
  dryRun?: boolean;
  deadlineMs?: number;
  /** Injected by routes that traced Chromium into their bundle. TikTok stats
   * are a plain fetch, but the post grid arrives from a signed XHR only a real
   * browser can trigger -- the same constraint as sounds. Absent means TikTok
   * creators keep their stored topPosts and only refresh stats. */
  readTikTokPosts?: (handle: string) => Promise<TikTokPostsRead | null>;
  /** The sandbox-run curl for TikTok profile stats -- the read that works when
   * the WAF shells the direct fetch. Injected for the same bundling reason. */
  readTikTokProfileRemote?: (handle: string) => Promise<CreatorReadResult>;
};

/** Posts move much slower than follower counts; a grid read costs ~12s of
 * browser where a stats read costs one HTTP request. Once a day is the same
 * cadence CreatorCore refreshes its own Top Posts at. */
const TOP_POSTS_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export async function snapshotCreators(
  options: CreatorSnapshotOptions = {}
): Promise<CreatorSnapshotResult> {
  const {
    orgId,
    creatorId,
    dryRun = false,
    deadlineMs = 4 * 60 * 1000,
    readTikTokPosts,
    readTikTokProfileRemote,
  } = options;
  const log = createLogger({ context: { job: "snapshot-creators", orgId: orgId ?? "all" } });
  const deadline = Date.now() + deadlineMs;

  let snapshots = 0;
  let failed = 0;
  let skipped = 0;

  const creators = await db.creator.findMany({
    // orgId stays in the filter alongside creatorId for the same reason it does
    // in snapshotSounds: a scope check here costs nothing.
    where: {
      deletedAt: null,
      trackedSince: { not: null },
      ...(creatorId ? { id: creatorId } : {}),
      ...(orgId ? { orgId } : {}),
    },
    select: {
      id: true,
      orgId: true,
      handle: true,
      platform: true,
      topPostsAt: true,
      trackerSnapshots: {
        orderBy: { recordedAt: "desc" },
        take: 1,
        select: { followersCount: true, recordedAt: true },
      },
    },
    orderBy: { trackedSince: "asc" },
  });

  if (creators.length === 0) return { snapshots, failed, skipped };

  /* Cadence is per-organisation, as it is for sounds, so an org on the 6-hourly
     setting does work on one run in six rather than needing its own schedule. */
  const orgIds = [...new Set(creators.map((c) => c.orgId))];
  const orgs = await db.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, uiConfig: true },
  });
  const cadenceByOrg = new Map(orgs.map((o) => [o.id, parseGranularity(o.uiConfig)]));
  const now = new Date();

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

  for (const creator of creators) {
    if (Date.now() > deadline) {
      skipped++;
      continue;
    }

    const cadence = cadenceByOrg.get(creator.orgId) ?? DEFAULT_GRANULARITY;
    const previous = creator.trackerSnapshots[0] ?? null;

    /* Even an explicit refresh respects the gate: re-reading a figure that cannot
       have moved records the same number twice and turns the change column into
       a plateau that never happened. */
    if (!isDueForRead(previous?.recordedAt ?? null, cadence, now)) {
      skipped++;
      continue;
    }

    let result: CreatorReadResult;
    try {
      result = await readCreatorProfile(creator.platform, creator.handle);
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
    if (!result.ok && creator.platform === "TIKTOK" && readTikTokProfileRemote && !dryRun) {
      const remote = await readTikTokProfileRemote(creator.handle).catch(
        (e): CreatorReadResult => ({
          ok: false,
          reason: "unreadable",
          detail: `sandbox: ${e instanceof Error ? e.message : String(e)}`,
        })
      );
      if (remote.ok) result = remote;
      else if (remote.detail && remote.detail !== result.detail) {
        result = { ...result, detail: `${result.detail ?? result.reason}; ${remote.detail}` };
      }
    }

    /* Last resort for stats, and normally pointless (the WAF shells the
       browser too) -- but it is also how the grid read reports evidence, so it
       stays behind the remote read rather than ahead of it. */
    let gridRead: TikTokPostsRead | null | undefined;
    if (!result.ok && creator.platform === "TIKTOK" && readTikTokPosts && !dryRun) {
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

    if (dryRun) {
      if (result.ok) snapshots++;
      else failed++;
      continue;
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
      });
      /* Stamped even though no snapshot exists, so the UI can tell "we tried and
         this account cannot be read" from "we have not got to it yet". */
      await db.creator
        .update({
          where: { id: creator.id },
          data: {
            trackerLastAttemptAt: new Date(),
            trackerLastError: result.detail
              ? `${result.reason}: ${result.detail}`
              : result.reason,
          },
        })
        .catch(() => {});
      continue;
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
    const postsAreStale =
      !creator.topPostsAt || now.getTime() - creator.topPostsAt.getTime() > TOP_POSTS_MAX_AGE_MS;

    let tiktokPosts: TikTokPostsRead | null = null;
    if (creator.platform === "TIKTOK" && postsAreStale && !dryRun) {
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
        log.info("tiktok top posts from official API", {
          creatorId: creator.id,
          handle: creator.handle,
          posts: official.topPosts.length,
        });
      }
    }

    if (
      !tiktokPosts &&
      creator.platform === "TIKTOK" &&
      readTikTokPosts &&
      gridRead === undefined && // the WAF fallback above has not already read the page
      postsAreStale
    ) {
      tiktokPosts = await readTikTokPosts(creator.handle).catch((e) => {
        log.warn("tiktok grid read failed", {
          creatorId: creator.id,
          handle: creator.handle,
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      });
    }
    if (tiktokPosts && tiktokPosts.sampledPosts > 0) {
      profile.avgViews = tiktokPosts.avgViews;
      profile.sampledPosts = tiktokPosts.sampledPosts;
      profile.topPosts = tiktokPosts.topPosts;
    }

    const recordedAt = new Date();
    const deltaFollowers = previous
      ? Math.round(profile.followersCount - previous.followersCount)
      : 0;
    // Percentage growth against the previous reading, matching how the sound
    // tracker stores velocityScore on each snapshot.
    const velocityScore = previous
      ? velocityBetween(previous.followersCount, profile.followersCount)
      : 0;

    await db.$transaction([
      db.creatorTrackerSnapshot.create({
        data: {
          creatorId: creator.id,
          followersCount: profile.followersCount,
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
          followersCount: profile.followersCount,
          ...(profile.sampledPosts > 0 ? { averageViews: profile.avgViews } : {}),
          /* topPosts only moves forward -- an absent list on this read means
             "not measured here", never "the posts are gone". */
          ...(profile.topPosts?.length
            ? { topPosts: profile.topPosts, topPostsAt: recordedAt }
            : {}),
          trackerLastAttemptAt: recordedAt,
          trackerLastError: null,
        },
      }),
    ]);
    snapshots++;
  }

  log.info("creator sweep complete", { snapshots, failed, skipped, considered: creators.length });
  return { snapshots, failed, skipped };
}
