import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { renderToBuffer } from "@react-pdf/renderer";
import { FinancialPDF, ReportData } from "@/lib/reports/FinancialPDF";
import React from "react";
import * as XLSX from "xlsx";
import {
  getMonthlyTrend,
  getPeriodRange,
  getPeriodStats,
  getPreviousPeriodRange,
  getTopCampaigns,
  isPeriodKey,
  pctChange,
} from "@/lib/reports/financialPeriod";

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
  if (!isPeriodKey(periodParam)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  const currentRange = getPeriodRange(periodParam);
  const previousRange = getPreviousPeriodRange(periodParam);

  /* Every figure below comes from lib/reports/financialPeriod, the same module
     the screen reads. This route used to carry its own copy, and the copies had
     drifted: Top Campaigns was unfiltered and ordered by createdAt here while
     the screen filtered by period and ordered by budget, and the trend dated a
     settled payout by createdAt here and by completedAt there. The file a
     finance lead exported did not agree with the page they exported it from. */
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

  const data: ReportData = {
    period: currentRange.label,
    previousPeriod: previousRange.label,
    reportCurrency,
    currenciesPresent,
    current: currentStats,
    previous: previousStats,
    comparison,
    monthlyTrend,
    topCampaigns,
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

  /* The currency travels with the money in a spreadsheet too: a "Paid Payouts"
     cell of 40500 says nothing about whether that is rupees or dollars, and
     this org may hold both. */
  const summaryRows: (string | number)[][] = [
    ["Org Financial Report", data.period],
    ["Report Currency", reportCurrency],
    ...(currenciesPresent.filter((c) => c !== reportCurrency).length > 0
      ? [["Currencies Present (not converted)", currenciesPresent.join(", ")]]
      : []),
    [],
    ["Metric", "Current", "Previous", "Change %"],
    [
      "Paid Payouts",
      data.current.paidPayouts,
      data.previous.paidPayouts,
      data.comparison.payoutsChange ?? "—",
    ],
    ["Pending Payouts", data.current.pendingPayouts, data.previous.pendingPayouts, "—"],
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
    [
      "Approved Requests",
      data.current.approvedRequests,
      data.previous.approvedRequests,
      data.comparison.requestsChange ?? "—",
    ],
    ["Pending Requests", data.current.pendingRequests, data.previous.pendingRequests, "—"],
    [],
    ["Currency", "Paid", "Pending", "Total", "Budget"],
    ...Object.entries(data.current.byCurrency).map(([currency, b]) => [
      currency,
      b.paid,
      b.pending,
      b.total,
      b.budget,
    ]),
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
    ["Campaign", "Status", "Budget", "Currency", "Spend", "Utilization %"],
    ...data.topCampaigns.map((c) => [c.title, c.status, c.budget, c.currency, c.spend, c.utilization]),
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
