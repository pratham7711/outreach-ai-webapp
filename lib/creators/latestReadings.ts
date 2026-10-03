import { db } from "@/lib/db";

export type LatestReading = {
  followersCount: number;
  avgViews: number;
  recordedAt: Date;
  /** The newest reading that measured views, which is often not the newest
   *  reading: TikTok's posts are read once a day and its follower count every
   *  few hours, and a reading without the posts stores avgViews 0. Dating the
   *  Avg. Views figure by the newest reading therefore matched nothing, and
   *  the roster said "time not recorded" for a figure measured that morning. */
  viewsReading?: { avgViews: number; recordedAt: Date } | null;
};

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
    const newestOf = async (measuredViews: boolean) => {
      const newest = await db.creatorTrackerSnapshot.groupBy({
        by: ["creatorId"],
        where: { creatorId: { in: creatorIds }, creator: { orgId }, ...(measuredViews ? { avgViews: { gt: 0 } } : {}) },
        _max: { recordedAt: true },
      });
      const pairs = newest
        .filter((g) => g._max?.recordedAt)
        .map((g) => ({ creatorId: g.creatorId, recordedAt: g._max.recordedAt as Date }));
      if (pairs.length === 0) return [];
      return db.creatorTrackerSnapshot.findMany({
        where: { OR: pairs, creator: { orgId } },
        select: { creatorId: true, followersCount: true, avgViews: true, recordedAt: true },
      });
    };
    const [rows, viewRows] = await Promise.all([newestOf(false), newestOf(true)]);
    const views = new Map(viewRows.map((r) => [r.creatorId, { avgViews: r.avgViews, recordedAt: r.recordedAt }]));
    for (const r of rows) {
      out.set(r.creatorId, {
        followersCount: r.followersCount,
        avgViews: r.avgViews,
        recordedAt: r.recordedAt,
        viewsReading: views.get(r.creatorId) ?? null,
      });
    }
  } catch {
    return new Map();
  }
  return out;
}
