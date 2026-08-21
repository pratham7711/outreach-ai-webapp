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

/**
 * How many distinct campaigns each creator is attached to, counting a post as
 * an attachment and not only a formal activation.
 *
 * Activations could not be imported from CreatorCore -- that type 404s on their
 * Data API -- so `_count.activations` reads 0 for essentially the whole roster
 * while those same creators plainly have posts on campaigns. Grouping returns
 * distinct (creator, campaign) pairs, so a creator with 356 posts on one
 * campaign costs one row, and the union is taken over both sides.
 */
export async function deriveCampaignCounts(creatorIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (creatorIds.length === 0) return result;

  const [postPairs, activationPairs] = await Promise.all([
    db.post.groupBy({ by: ["creatorId", "campaignId"], where: { creatorId: { in: creatorIds } } }),
    db.activation.groupBy({
      by: ["creatorId", "campaignId"],
      where: { creatorId: { in: creatorIds }, deletedAt: null },
    }),
  ]);

  const seen = new Map<string, Set<string>>();
  for (const pair of [...postPairs, ...activationPairs]) {
    const set = seen.get(pair.creatorId) ?? new Set<string>();
    set.add(pair.campaignId);
    seen.set(pair.creatorId, set);
  }
  for (const [creatorId, campaigns] of seen) result.set(creatorId, campaigns.size);
  return result;
}
