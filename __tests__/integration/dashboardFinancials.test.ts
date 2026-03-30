/**
 * @jest-environment node
 *
 * Integration tests for GET /api/dashboard/financials and /api/dashboard/financials/export
 */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/dashboard/financials/route";
import { GET as EXPORT_GET } from "@/app/api/dashboard/financials/export/route";

jest.mock("@/lib/db", () => ({
  db: {
    payout: { findMany: jest.fn() },
    campaign: { findMany: jest.fn() },
    post: { findMany: jest.fn() },
    creator: { findMany: jest.fn() },
    activation: { findMany: jest.fn() },
    campaignDeposit: { findMany: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;
const session = { user: { id: "user-1", orgId: "org-1" } };

function makeRequest(url: string) {
  return new NextRequest(url);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(session);
});

// ─── GET /api/dashboard/financials ──────────────────────────────────────────

describe("GET /api/dashboard/financials", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);

    const req = makeRequest("http://localhost/api/dashboard/financials");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns financial summary with default date range", async () => {
    const now = new Date();

    // The route calls findMany twice for campaigns (filtered + all for budget)
    // and findMany for payouts, posts, activations, deposits — all via Promise.all
    mockDb.payout.findMany.mockResolvedValue([
      {
        amount: 1000,
        status: "SUCCESS",
        createdAt: now,
        creatorId: "c1",
        campaignId: "camp-1",
        creator: { id: "c1", name: "Creator One", handle: "creator1", platform: "TIKTOK" },
        campaign: { id: "camp-1", title: "Test", budget: 5000 },
      },
    ]);
    mockDb.campaign.findMany.mockResolvedValue([
      { id: "camp-1", title: "Test", budget: 5000, status: "IN_PROGRESS" },
    ]);
    mockDb.post.findMany.mockResolvedValue([
      {
        id: "post-1", viewsCount: 10000, likesCount: 500, engagementRate: 5.0,
        platform: "TIKTOK", createdAt: now, campaignId: "camp-1", creatorId: "c1",
        postUrl: "https://tiktok.com/123",
        creator: { id: "c1", name: "Creator One", handle: "creator1" },
        campaign: { id: "camp-1", title: "Test" },
      },
    ]);
    mockDb.activation.findMany.mockResolvedValue([]);
    mockDb.campaignDeposit.findMany.mockResolvedValue([
      { amountUsd: 3000, releasedAmount: 1000 },
    ]);

    const req = makeRequest("http://localhost/api/dashboard/financials");
    const res = await GET(req);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("summary");
    expect(body).toHaveProperty("spendOverTime");
    expect(body).toHaveProperty("spendByCampaign");
    expect(body).toHaveProperty("platformBreakdown");
    expect(body).toHaveProperty("creatorPerformance");
  });

  it("returns empty data for org with no financial activity", async () => {
    mockDb.payout.findMany.mockResolvedValue([]);
    mockDb.campaign.findMany.mockResolvedValue([]);
    mockDb.post.findMany.mockResolvedValue([]);
    mockDb.activation.findMany.mockResolvedValue([]);
    mockDb.campaignDeposit.findMany.mockResolvedValue([]);

    const req = makeRequest("http://localhost/api/dashboard/financials");
    const res = await GET(req);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.summary).toBeDefined();
    expect(body.summary.totalSpend).toBe(0);
    expect(body.summary.totalBudget).toBe(0);
    expect(body.spendOverTime).toEqual([]);
  });
});

// ─── GET /api/dashboard/financials/export ───────────────────────────────────

describe("GET /api/dashboard/financials/export", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);

    const req = makeRequest("http://localhost/api/dashboard/financials/export");
    const res = await EXPORT_GET(req);

    expect(res.status).toBe(401);
  });

  it("export returns CSV with correct headers", async () => {
    mockDb.payout.findMany.mockResolvedValue([
      {
        id: "pay-1",
        amount: 1000,
        currency: "USD",
        status: "SUCCESS",
        paymentMethod: "PAYPAL",
        transactionId: "txn-123",
        createdAt: new Date("2026-01-15"),
        creatorId: "c1",
        campaignId: "camp-1",
        creator: { name: "Creator One", handle: "creator1" },
        campaign: { title: "Test Campaign" },
      },
    ]);

    const req = makeRequest("http://localhost/api/dashboard/financials/export");
    const res = await EXPORT_GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");

    const csv = await res.text();
    // CSV should have a header row
    const firstLine = csv.split("\n")[0];
    expect(firstLine).toBeTruthy();
    // Should contain at least some payout-related data
    expect(csv.length).toBeGreaterThan(0);
  });
});
