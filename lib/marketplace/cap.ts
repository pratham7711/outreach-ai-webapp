import { db } from "@/lib/db";
import { earnedMinorForPost, parseRatePerThousand } from "@/lib/marketplace/earnings";

/**
 * Marketplace budget-cap logic (Phase 2M / M4).
 *
 * Accrual for a marketplace campaign is the sum, over its APPROVED posts, of
 * `earnedMinorForPost(views, platform, ratePerThousand)`. This mirrors the
 * accrual math already used in `lib/marketplace/earnings.ts` (APPROVED-only),
 * so approvals and the cap agree by construction.
 *
 * Note: this is intentionally distinct from the VIEW_BASED `ViewLedger`
 * mechanism (which uses `Campaign.typeConfig` floats). Marketplace campaigns
 * accrue against `Campaign.ratePerThousand` (Json, minor units per 1k views)
 * and cap against `Campaign.marketplaceBudgetCapMinor`.
 */

export type CampaignAccrual = {
  accruedMinor: number;
  capMinor: number | null;
  capReached: boolean;
  /** 0..1 progress toward the cap; null when no cap is set. */
  fraction: number | null;
};

type CampaignCapInput = {
  ratePerThousand: unknown;
  marketplaceBudgetCapMinor: number | null;
};

/**
 * Compute accrued minor units for a campaign from its APPROVED posts.
 * Optionally accepts a pre-fetched campaign to avoid a duplicate query.
 */
export async function computeCampaignAccrual(
  campaignId: string,
  campaign?: CampaignCapInput
): Promise<CampaignAccrual> {
  const c =
    campaign ??
    (await db.campaign.findUnique({
      where: { id: campaignId },
      select: { ratePerThousand: true, marketplaceBudgetCapMinor: true },
    }));

  const capMinor = c?.marketplaceBudgetCapMinor ?? null;
  const rates = parseRatePerThousand(c?.ratePerThousand);

  const posts = await db.post.findMany({
    where: { campaignId, status: "APPROVED" },
    select: { viewsCount: true, platform: true },
  });

  let accruedMinor = 0;
  for (const p of posts) {
    accruedMinor += earnedMinorForPost(p.viewsCount, p.platform, rates);
  }

  const capReached = capMinor != null && capMinor > 0 && accruedMinor >= capMinor;
  const fraction =
    capMinor != null && capMinor > 0 ? Math.min(1, accruedMinor / capMinor) : null;

  return { accruedMinor, capMinor, capReached, fraction };
}

/** Convenience: has this campaign hit (or exceeded) its marketplace budget cap? */
export async function capReached(
  campaignId: string,
  campaign?: CampaignCapInput
): Promise<boolean> {
  const { capReached } = await computeCampaignAccrual(campaignId, campaign);
  return capReached;
}
