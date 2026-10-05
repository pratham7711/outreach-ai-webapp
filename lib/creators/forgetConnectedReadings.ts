import { db } from "@/lib/db";
import type { Platform, Prisma } from "@/lib/generated/prisma/client";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { trackerSourceTablesReady } from "@/lib/trackers/sourceSwitch";
import { velocityBetween } from "@/lib/trackers/metrics";
import { CONNECTED_VIA } from "./followerWriter";

export type ForgottenReadings = { snapshots: number; quarantined: number };

/**
 * Deletes what the tracker stored from a creator's own connection on one
 * platform, for the Disconnect that ends it (lib/portal/disconnect.ts). YouTube
 * API Services policy III.D.2 wants data read through a grant gone within 7 days
 * of an in-app revoke and 30 days of a Google-side one; the CreatorSocialAccount
 * row going was not enough, because reader v2 copies the connection's follower
 * figure into the tracker (lib/creators/snapshot.ts, connectedFollowerReading).
 *
 * A connected reading is a CreatorTrackerSnapshot whose TrackerSnapshotSource
 * exit is CONNECTED_VIA. Its followersCount came from the connection and its
 * deltaFollowers and velocityScore were computed from that figure; only
 * postsCount and avgViews came from the public read that ran beside it. The
 * follower column is NOT NULL and there is no public figure to put back (the
 * public read lost the pick and was never stored), so the whole snapshot goes
 * rather than a forged 0 the charts and the reading gate would treat as a read.
 *
 * Also, in the same transaction:
 *  - the next surviving snapshot after each removed run has its change
 *    re-measured against the reading before the run, since its stored delta
 *    is (its figure - the connected figure) and would give the deleted
 *    number back;
 *  - Creator.followersCount and the roster link's figure, which reader v2
 *    writes with the snapshot, fall back to the newest surviving reading when
 *    they still hold the deleted one (0 / null, "never read", when none is
 *    left). A figure typed in or read since is left alone;
 *  - quarantined readings taken through the connection are deleted, and a
 *    removed figure kept as another quarantine row's previous value is cleared.
 *
 * Public-read snapshots are never deleted. Only the creator's tracked platform
 * can hold connected readings (the tracker reads creator.platform), so another
 * platform's disconnect deletes nothing. TrackerSnapshotSource does not record
 * WHICH connection a reading came from, so a second connection on the same
 * platform loses its readings too; reader v2 takes a fresh one on its next run.
 *
 * Throws on a database failure, so the caller's disconnect fails with it and is
 * retried, rather than deleting the connection and leaving its readings behind.
 */
export async function forgetConnectedReadings(creatorId: string, platform: string): Promise<ForgottenReadings> {
  const none: ForgottenReadings = { snapshots: 0, quarantined: 0 };
  /* Reader v2 is the only writer of a connected reading, and it runs only once
     these tables exist (resolveTrackerPlan falls back to legacy without them). */
  if (!(await trackerSourceTablesReady({ fresh: true }))) return none;

  const creator = await db.creator.findUnique({
    where: { id: creatorId },
    select: { platform: true },
  });
  if (!creator || creator.platform !== platform) return none;

  const sources = await db.trackerSnapshotSource.findMany({
    where: { creatorId, exitId: CONNECTED_VIA },
    select: { snapshotId: true },
  });
  const gone = new Set(sources.map((s) => s.snapshotId));

  const series =
    gone.size > 0
      ? await db.creatorTrackerSnapshot.findMany({
          where: { creatorId },
          orderBy: { recordedAt: "asc" },
          select: { id: true, followersCount: true },
        })
      : [];

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  let kept: { followersCount: number } | null = null;
  let afterRemoved = false;
  for (const row of series) {
    if (gone.has(row.id)) {
      afterRemoved = true;
      continue;
    }
    if (afterRemoved) {
      writes.push(
        db.creatorTrackerSnapshot.update({
          where: { id: row.id },
          data: {
            deltaFollowers: kept ? Math.round(row.followersCount - kept.followersCount) : 0,
            velocityScore: kept ? velocityBetween(kept.followersCount, row.followersCount) : 0,
          },
        }),
      );
      afterRemoved = false;
    }
    kept = row;
  }

  const removedFigures = [...new Set(series.filter((s) => gone.has(s.id)).map((s) => s.followersCount))];
  if (removedFigures.length > 0) {
    writes.push(
      db.trackerReadingQuarantine.updateMany({
        where: { creatorId, previousFollowers: { in: removedFigures } },
        data: { previousFollowers: null },
      }),
    );
  }

  const newest = series[series.length - 1];
  if (newest && gone.has(newest.id)) {
    const fallback: number | null = kept?.followersCount ?? null;
    writes.push(
      db.creator.updateMany({
        where: { id: creatorId, followersCount: newest.followersCount },
        data: { followersCount: fallback ?? 0 },
      }),
    );
    if (await rosterTablesReady()) {
      writes.push(
        db.creatorProfileLink.updateMany({
          where: { creatorId, platform: platform as Platform, followersCount: newest.followersCount },
          data: { followersCount: fallback },
        }),
      );
    }
  }

  const ids = [...gone];
  const [snapshots, , quarantined] = await db.$transaction([
    db.creatorTrackerSnapshot.deleteMany({ where: { creatorId, id: { in: ids } } }),
    db.trackerSnapshotSource.deleteMany({ where: { creatorId, snapshotId: { in: ids } } }),
    db.trackerReadingQuarantine.deleteMany({ where: { creatorId, via: CONNECTED_VIA } }),
    ...writes,
  ]);
  return {
    snapshots: (snapshots as { count: number }).count,
    quarantined: (quarantined as { count: number }).count,
  };
}
