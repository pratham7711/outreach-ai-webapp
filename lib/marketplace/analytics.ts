import { db } from "@/lib/db";
import { computeCampaignAccrual } from "@/lib/marketplace/cap";
import { minorToMajor } from "@/lib/marketplace/public";

export type MarketplaceAnalytics = {
  joinsOverTime: { date: string; joins: number; cumulative: number }[];
  submissionsByStatus: { status: string; count: number }[];
  budget: {
    accruedMinor: number;
    accruedMajor: number;
    capMinor: number | null;
    capMajor: number | null;
    fraction: number | null;
    capReached: boolean;
  };
  projectedExhaustionDate: string | null;
  totals: { joins: number; submissions: number };
};

const STATUS_ORDER = ["PENDING_REVIEW", "APPROVED", "REJECTED"] as const;

/**
 * Org-scoped marketplace analytics for a single campaign. The caller MUST have
 * already verified the campaign belongs to the session's org — this helper is
 * only ever passed a pre-authorized campaignId, never an org from the request.
 */
export async function computeMarketplaceAnalytics(
  campaignId: string,
  campaign: { ratePerThousand: unknown; marketplaceBudgetCapMinor: number | null }
): Promise<MarketplaceAnalytics> {
  const activations = await db.activation.findMany({
    where: { campaignId, deletedAt: null },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const byDay = new Map<string, number>();
  for (const a of activations) {
    const key = a.createdAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  let running = 0;
  const joinsOverTime = Array.from(byDay.entries()).map(([date, joins]) => {
    running += joins;
    return { date, joins, cumulative: running };
  });

  const statusGroups = await db.post.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const statusMap = new Map(statusGroups.map((g) => [g.status, g._count._all]));
  const submissionsByStatus = STATUS_ORDER.map((status) => ({
    status,
    count: statusMap.get(status) ?? 0,
  }));
  const totalSubmissions = submissionsByStatus.reduce((s, r) => s + r.count, 0);

  const accrual = await computeCampaignAccrual(campaignId, campaign);
  const accruedMajor = minorToMajor(accrual.accruedMinor);

  let projectedExhaustionDate: string | null = null;
  if (
    accrual.capMinor != null &&
    accrual.capMinor > 0 &&
    accrual.accruedMinor > 0 &&
    !accrual.capReached &&
    activations.length > 0
  ) {
    const first = activations[0].createdAt.getTime();
    const elapsedDays = Math.max(1, (Date.now() - first) / 86_400_000);
    const ratePerDay = accrual.accruedMinor / elapsedDays;
    if (ratePerDay > 0) {
      const remaining = accrual.capMinor - accrual.accruedMinor;
      const daysToExhaust = remaining / ratePerDay;
      const eta = new Date(Date.now() + daysToExhaust * 86_400_000);
      if (!Number.isNaN(eta.getTime())) projectedExhaustionDate = eta.toISOString();
    }
  }

  return {
    joinsOverTime,
    submissionsByStatus,
    budget: {
      accruedMinor: accrual.accruedMinor,
      accruedMajor,
      capMinor: accrual.capMinor,
      capMajor: accrual.capMinor != null ? minorToMajor(accrual.capMinor) : null,
      fraction: accrual.fraction,
      capReached: accrual.capReached,
    },
    projectedExhaustionDate,
    totals: { joins: activations.length, submissions: totalSubmissions },
  };
}
