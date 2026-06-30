import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { renderToBuffer } from "@react-pdf/renderer";
import { FinancialPDF, ReportData } from "@/lib/reports/FinancialPDF";
import React from "react";
import * as XLSX from "xlsx";

type PeriodKey =
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_QUARTER"
  | "LAST_QUARTER"
  | "THIS_YEAR"
  | "ALL_TIME";

function getPeriodRange(period: PeriodKey): { start: Date; end: Date; label: string } {
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
      return {
        start: new Date(y, 0, 1),
        end: new Date(y, 11, 31, 23, 59, 59),
        label: `${y}`,
      };
    case "ALL_TIME":
    default:
      return {
        start: new Date(2020, 0, 1),
        end: new Date(y + 1, 0, 1),
        label: "All Time",
      };
  }
}

function getPreviousPeriodRange(period: PeriodKey): { start: Date; end: Date; label: string } {
  switch (period) {
    case "THIS_MONTH":
      return getPeriodRange("LAST_MONTH");
    case "LAST_MONTH": {
      const d = new Date();
      d.setMonth(d.getMonth() - 2);
      return getPeriodRange("LAST_MONTH");
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
      return {
        start: new Date(y, 0, 1),
        end: new Date(y, 11, 31, 23, 59, 59),
        label: `${y}`,
      };
    }
    default:
      return { start: new Date(2015, 0, 1), end: new Date(2020, 0, 1), label: "Before 2020" };
  }
}

async function getPeriodStats(orgId: string, start: Date, end: Date) {
  const [payouts, campaigns, payoutRequests] = await Promise.all([
    db.payout.findMany({
      where: { orgId, createdAt: { gte: start, lte: end } },
      select: { amount: true, status: true, currency: true },
    }),
    db.campaign.findMany({
      where: { orgId, deletedAt: null, createdAt: { gte: start, lte: end } },
      select: { id: true, budget: true, status: true },
    }),
    db.payoutRequest.findMany({
      where: { orgId, createdAt: { gte: start, lte: end } },
      select: { requestedAmount: true, status: true },
    }),
  ]);

  const paidPayouts = payouts.filter((p) => p.status === "SUCCESS").reduce((s, p) => s + p.amount, 0);
  const pendingPayouts = payouts.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amount, 0);
  const totalPayouts = payouts.reduce((s, p) => s + p.amount, 0);
  const totalBudget = campaigns.reduce((s, c) => s + (c.budget ?? 0), 0);
  const campaignCount = campaigns.length;
  const activeCampaigns = campaigns.filter((c) => c.status === "IN_PROGRESS").length;
  const approvedRequests = payoutRequests
    .filter((r) => r.status === "APPROVED")
    .reduce((s, r) => s + r.requestedAmount, 0);
  const pendingRequests = payoutRequests
    .filter((r) => r.status === "PENDING")
    .reduce((s, r) => s + r.requestedAmount, 0);

  return {
    paidPayouts,
    pendingPayouts,
    totalPayouts,
    totalBudget,
    campaignCount,
    activeCampaigns,
    approvedRequests,
    pendingRequests,
  };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export async function POST(req: NextRequest): Promise<Response> {
  const authResult = await authenticateRequest(req);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { orgId } = authResult;

  let body: { period?: string; format?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { period: periodParam = "THIS_MONTH", format } = body;

  if (format !== "pdf" && format !== "xlsx") {
    return NextResponse.json({ error: "Invalid format. Must be 'pdf' or 'xlsx'." }, { status: 400 });
  }

  const validPeriods: PeriodKey[] = [
    "THIS_MONTH",
    "LAST_MONTH",
    "THIS_QUARTER",
    "LAST_QUARTER",
    "THIS_YEAR",
    "ALL_TIME",
  ];
  if (!validPeriods.includes(periodParam as PeriodKey)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  const periodKey = periodParam as PeriodKey;
  const currentRange = getPeriodRange(periodKey);
  const previousRange = getPreviousPeriodRange(periodKey);

  const [currentStats, previousStats, balances, monthlyPayouts, topCampaigns] = await Promise.all([
    getPeriodStats(orgId, currentRange.start, currentRange.end),
    getPeriodStats(orgId, previousRange.start, previousRange.end),
    db.payoutBalance.findMany({
      where: { orgId },
      select: { label: true, currentBalance: true, currency: true },
    }),
    db.payout.findMany({
      where: {
        orgId,
        createdAt: { gte: new Date(new Date().setMonth(new Date().getMonth() - 5)) },
      },
      select: { amount: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.campaign.findMany({
      where: { orgId, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        budget: true,
        currency: true,
        financials: { select: { totalBudget: true, spentAmount: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  // Build monthly trend
  const trendMap: Record<string, { paid: number; pending: number }> = {};
  for (const p of monthlyPayouts) {
    const key = p.createdAt.toISOString().slice(0, 7);
    if (!trendMap[key]) trendMap[key] = { paid: 0, pending: 0 };
    if (p.status === "SUCCESS") trendMap[key].paid += p.amount;
    else if (p.status === "PENDING") trendMap[key].pending += p.amount;
  }
  const monthlyTrend = Object.entries(trendMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, trendData]) => ({ month, ...trendData }));

  const comparison = {
    payoutsChange: pctChange(currentStats.paidPayouts, previousStats.paidPayouts),
    budgetChange: pctChange(currentStats.totalBudget, previousStats.totalBudget),
    campaignCountChange: pctChange(currentStats.campaignCount, previousStats.campaignCount),
    requestsChange: pctChange(currentStats.approvedRequests, previousStats.approvedRequests),
  };

  const data: ReportData = {
    period: currentRange.label,
    previousPeriod: previousRange.label,
    current: currentStats,
    previous: previousStats,
    comparison,
    monthlyTrend,
    topCampaigns: topCampaigns.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      budget: c.budget ?? 0,
      currency: c.currency,
      spend: c.financials?.spentAmount ?? 0,
      utilization:
        c.financials && c.financials.totalBudget > 0
          ? Math.round((c.financials.spentAmount / c.financials.totalBudget) * 100)
          : 0,
    })),
    balances,
  };

  const filenameStem = `financial-report-${data.period.replace(/\s+/g, "-").toLowerCase()}`;

  if (format === "pdf") {
    const buffer = await renderToBuffer(React.createElement(FinancialPDF, { data }) as any);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filenameStem}.pdf"`,
      },
    });
  }

  // xlsx
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryRows: (string | number)[][] = [
    ["Org Financial Report", data.period],
    [],
    ["Metric", "Current", "Previous", "Change %"],
    [
      "Paid Payouts",
      data.current.paidPayouts,
      data.previous.paidPayouts,
      data.comparison.payoutsChange ?? "—",
    ],
    [
      "Pending Payouts",
      data.current.pendingPayouts,
      data.previous.pendingPayouts,
      "—",
    ],
    [
      "Total Budget",
      data.current.totalBudget,
      data.previous.totalBudget,
      data.comparison.budgetChange ?? "—",
    ],
    [
      "Campaigns",
      data.current.campaignCount,
      data.previous.campaignCount,
      data.comparison.campaignCountChange ?? "—",
    ],
    ["Active Campaigns", data.current.activeCampaigns, "—", "—"],
    ["Approved Requests", data.current.approvedRequests, data.previous.approvedRequests, data.comparison.requestsChange ?? "—"],
    ["Pending Requests", data.current.pendingRequests, data.previous.pendingRequests, "—"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");

  // Sheet 2: Monthly Trend
  const trendRows: (string | number)[][] = [
    ["Month", "Paid", "Pending"],
    ...data.monthlyTrend.map((r) => [r.month, r.paid, r.pending]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(trendRows), "Monthly Trend");

  // Sheet 3: Top Campaigns
  const campaignRows: (string | number)[][] = [
    ["Campaign", "Status", "Budget", "Spend", "Utilization %"],
    ...data.topCampaigns.map((c) => [c.title, c.status, c.budget, c.spend, c.utilization]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(campaignRows), "Top Campaigns");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filenameStem}.xlsx"`,
    },
  });
}
