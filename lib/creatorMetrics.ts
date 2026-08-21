import { db } from "@/lib/db";

/**
 * Average views per creator, measured from their posts.
 *
 * `Creator.averageViews` is a hand-editable column nothing populates: 1,833 of
 * 1,834 creators sit at 0 while their posts hold real view counts (steve.i4
 * averages 225k across 356 posts and the column reads 0). Every surface that
 * showed the column therefore printed a confident zero.
 *
 * Posts with no view count are excluded, so an unfetched zero cannot drag the
 * mean down, and a creator with no measured posts is absent from the map --
 * callers render an em dash rather than inventing a number. The stored column is
 * deliberately never a fallback.
 */
export async function deriveAverageViews(creatorIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (creatorIds.length === 0) return result;

  const grouped = await db.post.groupBy({
    by: ["creatorId"],
    where: { creatorId: { in: creatorIds }, viewsCount: { gt: 0 } },
    _avg: { viewsCount: true },
  });

  for (const g of grouped) {
    if (g._avg.viewsCount !== null) result.set(g.creatorId, Math.round(g._avg.viewsCount));
  }
  return result;
}
