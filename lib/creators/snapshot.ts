import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import { velocityBetween } from "@/lib/trackers/metrics";
import { isDueForRead, parseGranularity, DEFAULT_GRANULARITY } from "@/lib/trackers/granularity";
import { readCreatorProfile, type CreatorReadResult } from "@/lib/platforms/creatorProfile";

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
};

export async function snapshotCreators(
  options: CreatorSnapshotOptions = {}
): Promise<CreatorSnapshotResult> {
  const { orgId, creatorId, dryRun = false, deadlineMs = 4 * 60 * 1000 } = options;
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
