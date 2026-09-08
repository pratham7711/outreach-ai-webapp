import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import {
  getMonthlyTrend,
  getPeriodRange,
  getPeriodStats,
  getPreviousPeriodRange,
  getTopCampaigns,
  isPeriodKey,
  pctChange,
  type PeriodKey,
} from "@/lib/reports/financialPeriod";

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const periodParam = req.nextUrl.searchParams.get("period") ?? "THIS_MONTH";
  if (!isPeriodKey(periodParam)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }
  const period: PeriodKey = periodParam;

  const currentRange = getPeriodRange(period);
  const previousRange = getPreviousPeriodRange(period);

  const [org, currentStats, previousStats, balances, monthlyTrend, topCampaigns] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { currency: true } }),
    getPeriodStats(orgId, currentRange.start, currentRange.end),
    getPeriodStats(orgId, previousRange.start, previousRange.end),
    db.payoutBalance.findMany({
      where: { orgId },
      select: { label: true, currentBalance: true, currency: true },
    }),
    getMonthlyTrend(orgId),
    getTopCampaigns(orgId, currentRange),
  ]);

  const comparison = {
    payoutsChange: pctChange(currentStats.paidPayouts, previousStats.paidPayouts),
    budgetChange: pctChange(currentStats.totalBudget, previousStats.totalBudget),
    campaignCountChange: pctChange(currentStats.campaignCount, previousStats.campaignCount),
    requestsChange: pctChange(currentStats.approvedRequests, previousStats.approvedRequests),
  };

  const reportCurrency = org?.currency ?? "USD";
  const currenciesPresent = Array.from(
    new Set([
      ...Object.keys(currentStats.byCurrency),
      ...balances.map((b) => b.currency),
      ...topCampaigns.map((c) => c.currency),
    ])
  );
  const hasMixedCurrencies = currenciesPresent.filter((c) => c !== reportCurrency).length > 0;

  return NextResponse.json({
    period: currentRange.label,
    previousPeriod: previousRange.label,
    reportCurrency,
    currenciesPresent,
    hasMixedCurrencies,
    current: currentStats,
    previous: previousStats,
    comparison,
    monthlyTrend,
    topCampaigns,
    balances,
  });
}
