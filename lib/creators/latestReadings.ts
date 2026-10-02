import { db } from "@/lib/db";

export type LatestReading = { followersCount: number; avgViews: number; recordedAt: Date };

/**
 * Each creator's newest tracker reading, for dating the figures on the creator
 * row (lib/creators/figureTime). Two small queries rather than one wide one:
 * the newest time per creator, then exactly those rows -- a tracked creator
 * has four readings a day, and fetching them all to keep one is the shape
 * Prisma's in-memory `distinct` would take.
 *
 * Scoped to the org through the creator. Never throws: a page that cannot date
 * its figures still shows them, with "time not recorded".
 */
export async function latestTrackerReadings(orgId: string, creatorIds: string[]): Promise<Map<string, LatestReading>> {
  const out = new Map<string, LatestReading>();
  if (creatorIds.length === 0) return out;
  try {
    const newest = await db.creatorTrackerSnapshot.groupBy({
      by: ["creatorId"],
      where: { creatorId: { in: creatorIds }, creator: { orgId } },
      _max: { recordedAt: true },
    });
    const pairs = newest
      .filter((g) => g._max?.recordedAt)
      .map((g) => ({ creatorId: g.creatorId, recordedAt: g._max.recordedAt as Date }));
    if (pairs.length === 0) return out;
    const rows = await db.creatorTrackerSnapshot.findMany({
      where: { OR: pairs, creator: { orgId } },
      select: { creatorId: true, followersCount: true, avgViews: true, recordedAt: true },
    });
    for (const r of rows) out.set(r.creatorId, { followersCount: r.followersCount, avgViews: r.avgViews, recordedAt: r.recordedAt });
  } catch {
    return new Map();
  }
  return out;
}
