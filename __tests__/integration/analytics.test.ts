/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as getAnalytics } from "@/app/api/analytics/route";

jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn() },
    payout: { findMany: jest.fn() },
    campaign: { findMany: jest.fn() },
    creator: { findMany: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };

function makeRequest() {
  return new NextRequest("http://localhost/api/analytics");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.post.findMany.mockResolvedValue([]);
  mockDb.payout.findMany.mockResolvedValue([]);
  mockDb.campaign.findMany.mockResolvedValue([]);
  mockDb.creator.findMany.mockResolvedValue([]);
});

describe("GET /api/analytics", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await getAnalytics(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it("returns empty analytics when no data", async () => {
    const res = await getAnalytics(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kpis.totalViews).toBe(0);
    expect(body.kpis.totalSpend).toBe(0);
    expect(body.kpis.avgEngagementRate).toBe(0);
    expect(body.kpis.avgCPM).toBe(0);
    expect(body.leaderboard).toHaveLength(0);
    expect(body.platformBreakdown).toHaveLength(0);
    expect(body.monthlyTrend).toHaveLength(6);
  });

  it("aggregates KPIs from posts and payouts correctly", async () => {
    mockDb.post.findMany.mockResolvedValue([
      {
        viewsCount: 10_000,
        likesCount: 500,
        commentsCount: 50,
        engagementRate: 5.5,
        createdAt: new Date(),
        creatorId: "creator-1",
        creator: { id: "creator-1", name: "Alice", handle: "alice" },
      },
      {
        viewsCount: 20_000,
        likesCount: 1_000,
        commentsCount: 100,
        engagementRate: 4.5,
        createdAt: new Date(),
        creatorId: "creator-1",
        creator: { id: "creator-1", name: "Alice", handle: "alice" },
      },
    ]);
    mockDb.payout.findMany.mockResolvedValue([
      { amount: 300, creatorId: "creator-1", createdAt: new Date() },
    ]);
    mockDb.creator.findMany.mockResolvedValue([
      { id: "creator-1", name: "Alice", handle: "alice", platform: "TIKTOK", avatarUrl: null, followersCount: 50_000 },
    ]);

    const res = await getAnalytics(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    // KPIs
    expect(body.kpis.totalViews).toBe(30_000);
    expect(body.kpis.totalLikes).toBe(1_500);
    expect(body.kpis.totalComments).toBe(150);
    expect(body.kpis.totalSpend).toBe(300);
    expect(body.kpis.avgEngagementRate).toBe(5); // (5.5 + 4.5) / 2
    expect(body.kpis.totalPosts).toBe(2);

    // avgCPM = (300 / 30000) * 1000 = 10
    expect(body.kpis.avgCPM).toBe(10);

    // Leaderboard — only 1 creator with 30K views
    expect(body.leaderboard).toHaveLength(1);
    expect(body.leaderboard[0].name).toBe("Alice");
    expect(body.leaderboard[0].views).toBe(30_000);
    expect(body.leaderboard[0].earnings).toBe(300);
  });

  it("does not leak data across orgs (cross-tenant isolation)", async () => {
    // The org-1 session should only see org-1 data.
    // We verify the db query was called with the correct orgId filter.
    await getAnalytics(makeRequest());
    expect(mockDb.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaign: expect.objectContaining({ orgId: "org-1" }),
        }),
      })
    );
    expect(mockDb.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: "org-1" }),
      })
    );
    expect(mockDb.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: "org-1" }),
      })
    );
  });
});
