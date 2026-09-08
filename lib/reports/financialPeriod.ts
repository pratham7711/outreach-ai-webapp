/**
 * The financial report, computed once.
 *
 * /api/financial-reports (the screen) and /api/financial-reports/generate (the
 * PDF and the XLSX) each carried their own copy of the period maths, and the
 * copies had drifted apart -- so the file a finance lead exported did not agree
 * with the page they exported it from:
 *
 *  - Top Campaigns was period-filtered and ordered by budget on the screen, and
 *    unfiltered and ordered by createdAt in the export;
 *  - Monthly Trend dated a settled payout by completedAt on the screen and by
 *    createdAt in the export, so a payout raised in June and paid in August
 *    landed in a different month in each;
 *  - the screen bucketed money per currency and the export did not.
 *
 * Everything both routes need now lives here, so a change reaches both.
 *
 * Soft deletes are honoured consistently. Budgets already filtered on
 * `deletedAt: null` while payouts and payout requests did not, so deleting a
 * campaign dropped its budget out of the report and left its spend in -- a
 * utilisation over 100% with nothing on screen to explain it.
 */
import { db } from "@/lib/db";
import { totalsByCurrency, type CurrencyAmount } from "@/lib/money";

export type PeriodKey =
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_QUARTER"
  | "LAST_QUARTER"
  | "THIS_YEAR"
  | "ALL_TIME";

export const PERIOD_KEYS: PeriodKey[] = [
  "THIS_MONTH",
  "LAST_MONTH",
  "THIS_QUARTER",
  "LAST_QUARTER",
  "THIS_YEAR",
  "ALL_TIME",
];

export function isPeriodKey(value: unknown): value is PeriodKey {
  return typeof value === "string" && (PERIOD_KEYS as string[]).includes(value);
}

export type PeriodRange = { start: Date; end: Date; label: string };

export function getPeriodRange(period: PeriodKey): PeriodRange {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (period) {
    case "THIS_MONTH":
      return {
        start: new Date(y, m, 1),
        end: new Date(y, m + 1, 0, 23, 59, 59),
        label: now.toLocaleString("default", { month: "long", year: "numeric" }),
      };
    case "LAST_MONTH":
      return {
        start: new Date(y, m - 1, 1),
        end: new Date(y, m, 0, 23, 59, 59),
        label: new Date(y, m - 1).toLocaleString("default", { month: "long", year: "numeric" }),
      };
    case "THIS_QUARTER": {
      const q = Math.floor(m / 3);
      return {
        start: new Date(y, q * 3, 1),
        end: new Date(y, q * 3 + 3, 0, 23, 59, 59),
        label: `Q${q + 1} ${y}`,
      };
    }
    case "LAST_QUARTER": {
      const q = Math.floor(m / 3) - 1;
      const qy = q < 0 ? y - 1 : y;
      const qm = q < 0 ? 3 : q;
      return {
        start: new Date(qy, qm * 3, 1),
        end: new Date(qy, qm * 3 + 3, 0, 23, 59, 59),
        label: `Q${qm + 1} ${qy}`,
      };
    }
    case "THIS_YEAR":
      return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59), label: `${y}` };
    case "ALL_TIME":
    default:
      return { start: new Date(2020, 0, 1), end: new Date(y + 1, 0, 1), label: "All Time" };
  }
}

export function getPreviousPeriodRange(period: PeriodKey): PeriodRange {
  switch (period) {
    case "THIS_MONTH":
      return getPeriodRange("LAST_MONTH");
    case "LAST_MONTH": {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      return {
        start: new Date(y, m - 2, 1),
        end: new Date(y, m - 1, 0, 23, 59, 59),
        label: new Date(y, m - 2).toLocaleString("default", { month: "long", year: "numeric" }),
      };
    }
    case "THIS_QUARTER":
      return getPeriodRange("LAST_QUARTER");
    case "LAST_QUARTER": {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3) - 2;
      const y = q < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const qm = ((q % 4) + 4) % 4;
      return {
        start: new Date(y, qm * 3, 1),
        end: new Date(y, qm * 3 + 3, 0, 23, 59, 59),
        label: `Q${qm + 1} ${y}`,
      };
    }
    case "THIS_YEAR": {
      const y = new Date().getFullYear() - 1;
      return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59), label: `${y}` };
    }
    default:
      return { start: new Date(2015, 0, 1), end: new Date(2020, 0, 1), label: "Before 2020" };
  }
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * A payout may hang off no campaign at all (`campaignId` is nullable), and one
 * that does not is still the org's money -- so it is kept. A payout whose
 * campaign has been soft-deleted is dropped, matching what already happened to
 * that campaign's budget.
 */
const LIVE_CAMPAIGN_PAYOUT = {
  OR: [{ campaignId: null }, { campaign: { deletedAt: null } }],
};

export type CurrencyBucket = { paid: number; pending: number; total: number; budget: number };

export type PeriodStats = {
  paidPayouts: number;
  pendingPayouts: number;
  totalPayouts: number;
  totalBudget: number;
  campaignCount: number;
  activeCampaigns: number;
  approvedRequests: number;
  pendingRequests: number;
  byCurrency: Record<string, CurrencyBucket>;
};

export async function getPeriodStats(orgId: string, start: Date, end: Date): Promise<PeriodStats> {
  const [payouts, campaigns, payoutRequests] = await Promise.all([
    db.payout.findMany({
      where: { orgId, createdAt: { gte: start, lte: end }, ...LIVE_CAMPAIGN_PAYOUT },
      select: { amount: true, status: true, currency: true },
    }),
    db.campaign.findMany({
      where: { orgId, deletedAt: null, createdAt: { gte: start, lte: end } },
      select: { id: true, budget: true, status: true, currency: true },
    }),
    db.payoutRequest.findMany({
      where: { orgId, createdAt: { gte: start, lte: end }, campaign: { deletedAt: null } },
      select: { requestedAmount: true, status: true },
    }),
  ]);

  const paidPayouts = payouts.filter((p) => p.status === "SUCCESS").reduce((s, p) => s + p.amount, 0);
  const pendingPayouts = payouts.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amount, 0);
  const totalPayouts = payouts.reduce((s, p) => s + p.amount, 0);
  const totalBudget = campaigns.reduce((s, c) => s + (c.budget ?? 0), 0);
  const approvedRequests = payoutRequests
    .filter((r) => r.status === "APPROVED")
    .reduce((s, r) => s + r.requestedAmount, 0);
  const pendingRequests = payoutRequests
    .filter((r) => r.status === "PENDING")
    .reduce((s, r) => s + r.requestedAmount, 0);

  const byCurrency: Record<string, CurrencyBucket> = {};
  const bucket = (cur: string) =>
    (byCurrency[cur] ??= { paid: 0, pending: 0, total: 0, budget: 0 });
  for (const p of payouts) {
    const b = bucket(p.currency);
    b.total += p.amount;
    if (p.status === "SUCCESS") b.paid += p.amount;
    else if (p.status === "PENDING") b.pending += p.amount;
  }
  for (const c of campaigns) {
    if (c.budget) bucket(c.currency).budget += c.budget;
  }

  return {
    paidPayouts,
    pendingPayouts,
    totalPayouts,
    totalBudget,
    campaignCount: campaigns.length,
    activeCampaigns: campaigns.filter((c) => c.status === "IN_PROGRESS").length,
    approvedRequests,
    pendingRequests,
    byCurrency,
  };
}

/** One bucket list per field, so a caller can print money it did not sum blind. */
export function statsByCurrency(
  stats: PeriodStats,
  field: keyof CurrencyBucket
): CurrencyAmount[] {
  return totalsByCurrency(
    Object.entries(stats.byCurrency).map(([currency, b]) => ({ currency, amount: b[field] }))
  ).filter((t) => t.amount !== 0);
}

export type MonthlyTrendRow = { month: string; paid: number; pending: number };

/**
 * Six months of payouts grouped by YYYY-MM.
 *
 * Money paid is dated to the month it was actually paid, not the month the
 * payout was raised: a payout opened in June and settled in August is August's
 * spend. Pending has no completion date yet, so it stays on the month it was
 * raised, which is the question being asked of it -- how long has this been
 * outstanding. The export used createdAt for both and disagreed with the page.
 */
export async function getMonthlyTrend(orgId: string): Promise<MonthlyTrendRow[]> {
  const since = new Date(new Date().setMonth(new Date().getMonth() - 5));
  const payouts = await db.payout.findMany({
    where: { orgId, createdAt: { gte: since }, ...LIVE_CAMPAIGN_PAYOUT },
    select: { amount: true, status: true, createdAt: true, completedAt: true },
    orderBy: { createdAt: "asc" },
  });

  const trendMap: Record<string, { paid: number; pending: number }> = {};
  const at = (key: string) => (trendMap[key] ??= { paid: 0, pending: 0 });
  for (const p of payouts) {
    if (p.status === "SUCCESS") {
      at((p.completedAt ?? p.createdAt).toISOString().slice(0, 7)).paid += p.amount;
    } else if (p.status === "PENDING") {
      at(p.createdAt.toISOString().slice(0, 7)).pending += p.amount;
    }
  }

  return Object.entries(trendMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data }));
}

export type TopCampaign = {
  id: string;
  title: string;
  status: string;
  budget: number;
  currency: string;
  spend: number;
  utilization: number;
};

/**
 * The five biggest campaigns of the period, by budget.
 *
 * Campaigns with no budget are excluded rather than led with. `ORDER BY budget
 * DESC` puts NULLs first in Postgres, so the table opened with rows reading
 * "$0.00 / 0%" while the real top campaigns fell off the bottom -- and a
 * campaign with no budget is not a top campaign by budget in any case.
 *
 * Utilisation divides the same budget the Budget column prints. It used to
 * divide CampaignFinancials.totalBudget while the column showed
 * Campaign.budget, so a reader could not reproduce the percentage from the two
 * numbers beside it.
 */
export async function getTopCampaigns(
  orgId: string,
  range: { start: Date; end: Date }
): Promise<TopCampaign[]> {
  const campaigns = await db.campaign.findMany({
    where: {
      orgId,
      deletedAt: null,
      budget: { not: null },
      createdAt: { gte: range.start, lte: range.end },
    },
    select: {
      id: true,
      title: true,
      status: true,
      budget: true,
      currency: true,
      financials: { select: { spentAmount: true } },
    },
    orderBy: { budget: "desc" },
    take: 5,
  });

  return campaigns.map((c) => {
    const budget = c.budget ?? 0;
    const spend = c.financials?.spentAmount ?? 0;
    return {
      id: c.id,
      title: c.title,
      status: c.status,
      budget,
      currency: c.currency,
      spend,
      utilization: budget > 0 ? Math.round((spend / budget) * 100) : 0,
    };
  });
}
