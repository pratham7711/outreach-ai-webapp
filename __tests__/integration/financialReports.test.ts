/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as getFinancials } from "@/app/api/financial-reports/route";

jest.mock("@/lib/db", () => ({
  db: {
    organization: {
      findUnique: jest.fn(),
    },
    payout: {
      findMany: jest.fn(),
    },
    campaign: {
      findMany: jest.fn(),
    },
    payoutRequest: {
      findMany: jest.fn(),
    },
    payoutBalance: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };

function makeRequest(period?: string) {
  const url = period
    ? `http://localhost/api/financial-reports?period=${period}`
    : "http://localhost/api/financial-reports";
  return new NextRequest(url);
}

const samplePayouts = [
  { amount: 500, status: "SUCCESS", currency: "USD", createdAt: new Date() },
  { amount: 200, status: "PENDING", currency: "USD", createdAt: new Date() },
  { amount: 300, status: "SUCCESS", currency: "USD", createdAt: new Date() },
];

const sampleCampaigns = [
  { id: "camp-1", budget: 10000, status: "IN_PROGRESS", financials: { totalBudget: 10000, spentAmount: 7000 }, title: "Campaign 1", currency: "USD" },
  { id: "camp-2", budget: 5000, status: "COMPLETE", financials: null, title: "Campaign 2", currency: "USD" },
];

const sampleRequests = [
  { requestedAmount: 1000, status: "APPROVED" },
  { requestedAmount: 500, status: "PENDING" },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);

  // Default: all db calls return empty for stats + monthly trend
  mockDb.organization.findUnique.mockResolvedValue({ currency: "USD" });
  mockDb.payout.findMany.mockResolvedValue([]);
  mockDb.campaign.findMany.mockResolvedValue([]);
  mockDb.payoutRequest.findMany.mockResolvedValue([]);
  mockDb.payoutBalance.findMany.mockResolvedValue([]);
});

// ─── Auth ──────────────────────────────────────────────────────────────────

describe("GET /api/financial-reports", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await getFinancials(makeRequest("THIS_MONTH"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid period", async () => {
    const res = await getFinancials(makeRequest("INVALID"));
    expect(res.status).toBe(400);
  });

  it("defaults to THIS_MONTH when no period given", async () => {
    const res = await getFinancials(makeRequest());
    expect(res.status).toBe(200);
  });

  it("returns correct shape for valid period", async () => {
    const res = await getFinancials(makeRequest("THIS_MONTH"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("period");
    expect(body).toHaveProperty("previousPeriod");
    expect(body).toHaveProperty("current");
    expect(body).toHaveProperty("previous");
    expect(body).toHaveProperty("comparison");
    expect(body).toHaveProperty("monthlyTrend");
    expect(body).toHaveProperty("topCampaigns");
    expect(body).toHaveProperty("balances");
  });

  it("sums paid and pending payouts correctly", async () => {
    // First 3 calls are for current period (payout, campaign, payoutRequest)
    // Next 3 are for previous period (payout, campaign, payoutRequest)
    // Then payoutBalance and monthlyPayouts (payout) and topCampaigns (campaign)
    mockDb.payout.findMany
      .mockResolvedValueOnce(samplePayouts) // current period
      .mockResolvedValueOnce([])            // previous period
      .mockResolvedValueOnce(samplePayouts); // monthly trend (6-month window)
    mockDb.campaign.findMany
      .mockResolvedValueOnce(sampleCampaigns) // current period
      .mockResolvedValueOnce([])              // previous period
      .mockResolvedValueOnce(sampleCampaigns); // topCampaigns
    mockDb.payoutRequest.findMany
      .mockResolvedValueOnce(sampleRequests) // current period
      .mockResolvedValueOnce([]);            // previous period

    const res = await getFinancials(makeRequest("THIS_MONTH"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.current.paidPayouts).toBe(800); // 500 + 300
    expect(body.current.pendingPayouts).toBe(200);
    expect(body.current.campaignCount).toBe(2);
    expect(body.current.activeCampaigns).toBe(1);
    expect(body.current.approvedRequests).toBe(1000);
  });

  it("computes positive pctChange correctly", async () => {
    const prevPayouts = [{ amount: 400, status: "SUCCESS", currency: "USD", createdAt: new Date() }];

    mockDb.payout.findMany
      .mockResolvedValueOnce(samplePayouts) // current: paid=800
      .mockResolvedValueOnce(prevPayouts)   // previous: paid=400
      .mockResolvedValueOnce([]);            // monthly trend
    mockDb.campaign.findMany.mockResolvedValue([]);
    mockDb.payoutRequest.findMany.mockResolvedValue([]);

    const res = await getFinancials(makeRequest("THIS_MONTH"));
    const body = await res.json();

    expect(body.comparison.payoutsChange).toBe(100); // 800 vs 400 = 100% increase
  });

  it("includes balance data", async () => {
    mockDb.payoutBalance.findMany.mockResolvedValue([
      { label: "Main Balance", currentBalance: 25000, currency: "USD" },
    ]);

    const res = await getFinancials(makeRequest("THIS_MONTH"));
    const body = await res.json();

    expect(body.balances).toHaveLength(1);
    expect(body.balances[0].currentBalance).toBe(25000);
  });

  it("all period keys return 200", async () => {
    const periods = ["THIS_MONTH", "LAST_MONTH", "THIS_QUARTER", "LAST_QUARTER", "THIS_YEAR", "ALL_TIME"];
    for (const p of periods) {
      mockDb.payout.findMany.mockResolvedValue([]);
      mockDb.campaign.findMany.mockResolvedValue([]);
      mockDb.payoutRequest.findMany.mockResolvedValue([]);
      mockDb.payoutBalance.findMany.mockResolvedValue([]);

      const res = await getFinancials(makeRequest(p));
      expect(res.status).toBe(200);
    }
  });

  it("compares LAST_MONTH against a distinct earlier month, not itself", async () => {
    await getFinancials(makeRequest("LAST_MONTH"));
    const current = mockDb.payout.findMany.mock.calls[0][0].where.createdAt;
    const previous = mockDb.payout.findMany.mock.calls[1][0].where.createdAt;
    expect(new Date(previous.gte).getTime()).toBeLessThan(new Date(current.gte).getTime());
  });

  it("queries top campaigns ordered by budget and scoped to the period", async () => {
    await getFinancials(makeRequest("THIS_MONTH"));
    const topCall = mockDb.campaign.findMany.mock.calls[2][0];
    expect(topCall.orderBy).toEqual({ budget: "desc" });
    expect(topCall.where.createdAt).toBeDefined();
    expect(topCall.take).toBe(5);
  });

  it("exposes the report currency and flags mixed currencies", async () => {
    mockDb.payoutBalance.findMany.mockResolvedValue([
      { label: "Main", currentBalance: 100, currency: "EUR" },
    ]);
    const res = await getFinancials(makeRequest("THIS_MONTH"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.reportCurrency).toBe("USD");
    expect(body.hasMixedCurrencies).toBe(true);
    expect(body.currenciesPresent).toContain("EUR");
  });

  it("buckets payout amounts by their own currency (no cross-currency sum)", async () => {
    mockDb.payout.findMany.mockResolvedValueOnce([
      { amount: 100, status: "SUCCESS", currency: "USD", createdAt: new Date() },
      { amount: 50, status: "PENDING", currency: "EUR", createdAt: new Date() },
    ]);
    const res = await getFinancials(makeRequest("THIS_MONTH"));
    const body = await res.json();
    expect(body.current.byCurrency.USD.paid).toBe(100);
    expect(body.current.byCurrency.EUR.pending).toBe(50);
    expect(body.current.byCurrency.EUR.paid).toBe(0);
  });
});
