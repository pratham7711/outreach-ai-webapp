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
export type CreatorCampaign = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  currency: string;
  /** How many of this creator's posts sit on the campaign. */
  postCount: number;
  /** Present only when a formal activation exists, which for imported creators it does not. */
  activation: { id: string; status: string; deliverableDueDate: Date | null } | null;
};

/**
 * The campaigns one creator is attached to -- the list behind the count that
 * `deriveCampaignCounts` returns, derived the same way so the two cannot
 * disagree.
 *
 * They used to. The creator page counted campaigns from posts and activations
 * but rendered only `creator.activations`, and activations did not import from
 * CreatorCore: 1,824 of 1,834 creators have posts on campaigns and zero
 * activations. So the tab read "215 Campaigns" and then said "No campaigns yet"
 * underneath it.
 *
 * Ordered by how much of the creator's work sits on each campaign, then by
 * title so the order is total and paging over it cannot repeat or drop a row.
 */
export async function deriveCreatorCampaigns(
  creatorId: string,
  orgId: string
): Promise<CreatorCampaign[]> {
  const [postPairs, activations] = await Promise.all([
    db.post.groupBy({
      by: ["campaignId"],
      where: { creatorId, campaign: { orgId, deletedAt: null } },
      _count: { _all: true },
    }),
    db.activation.findMany({
      where: { creatorId, deletedAt: null, campaign: { orgId, deletedAt: null } },
      select: {
        id: true,
        status: true,
        deliverableDueDate: true,
        campaignId: true,
      },
    }),
  ]);

  const campaignIds = [...new Set([...postPairs.map((p) => p.campaignId), ...activations.map((a) => a.campaignId)])];
  if (campaignIds.length === 0) return [];

  const campaigns = await db.campaign.findMany({
    where: { id: { in: campaignIds }, orgId, deletedAt: null },
    select: { id: true, title: true, status: true, budget: true, currency: true },
  });

  const posts = new Map(postPairs.map((p) => [p.campaignId, p._count._all]));
  const acts = new Map(activations.map((a) => [a.campaignId, a]));

  return campaigns
    .map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      budget: c.budget,
      currency: c.currency,
      postCount: posts.get(c.id) ?? 0,
      activation: acts.has(c.id)
        ? {
            id: acts.get(c.id)!.id,
            status: acts.get(c.id)!.status,
            deliverableDueDate: acts.get(c.id)!.deliverableDueDate,
          }
        : null,
    }))
    .sort((a, b) => b.postCount - a.postCount || a.title.localeCompare(b.title));
}

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
