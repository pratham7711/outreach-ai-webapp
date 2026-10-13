import { db } from "@/lib/db";
import { latestTrackerReadings } from "@/lib/creators/latestReadings";
import { creatorFollowersTime, figureTimeDto, type FigureTimeDto } from "@/lib/creators/figureTime";

/**
 * When each creator's follower count was measured, for a screen that lists
 * creators by row (plan A6) -- the campaign's Creators tab, which showed the
 * figure with no age while the Creators list and the creator page dated it.
 *
 * Dated exactly as those two do (creatorFollowersTime): by the primary
 * account's last good read or the newest tracker reading, whichever produced
 * the count on the row, else "time not recorded". Two batched reads for the
 * whole roster, scoped to the org.
 *
 * Never throws: a roster that cannot be dated still shows its figures, and an
 * absent entry renders no age rather than a guessed one.
 */
export async function followersTimesFor(
  orgId: string,
  creators: readonly { id: string; followersCount: number | null | undefined }[],
): Promise<Map<string, FigureTimeDto>> {
  const out = new Map<string, FigureTimeDto>();
  const ids = [...new Set(creators.map((c) => c.id))];
  if (ids.length === 0) return out;
  try {
    const [links, readings] = await Promise.all([
      db.creatorProfileLink.findMany({
        where: { orgId, creatorId: { in: ids }, isPrimary: true },
        select: { creatorId: true, followersCount: true, refreshedAt: true, refreshError: true },
      }),
      latestTrackerReadings(orgId, ids),
    ]);
    const linkBy = new Map(links.map((l) => [l.creatorId, l]));
    for (const c of creators) {
      if (out.has(c.id)) continue;
      out.set(
        c.id,
        figureTimeDto(
          creatorFollowersTime({
            followersCount: c.followersCount,
            primaryLink: linkBy.get(c.id) ?? null,
            latestSnapshot: readings.get(c.id) ?? null,
          }),
        ),
      );
    }
  } catch {
    return new Map();
  }
  return out;
}
