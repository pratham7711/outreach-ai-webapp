/**
 * @jest-environment node
 *
 * The engagement counters default to 0, so a campaign of imported posts used to
 * report "0 engagements, 0.00% rate" as though it had been measured. These pin
 * the rule that an unfetched counter reports nothing at all.
 */
jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn() },
    postMetricSnapshot: { findMany: jest.fn() },
  },
}));

import { db } from "@/lib/db";
import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";

const mockDb = db as unknown as {
  post: { findMany: jest.Mock };
  postMetricSnapshot: { findMany: jest.Mock };
};

const campaign = { id: "camp-1", orgId: "org-1", budget: null, currency: "USD" };

const creator = { id: "creator-1", name: "Ada", avatarUrl: null };

function post(over: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    platform: "TIKTOK",
    postedAt: new Date("2026-08-01"),
    viewsCount: 10_000,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    savesCount: 0,
    lastSyncedAt: null,
    creator,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.postMetricSnapshot.findMany.mockResolvedValue([]);
});

describe("computeCampaignPerformance engagement provenance", () => {
  it("reports no engagement figures when nothing was ever fetched", async () => {
    mockDb.post.findMany.mockResolvedValue([post()]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.views).toBe(10_000);
    expect(result.kpis.engagements).toBeNull();
    expect(result.kpis.engagementRate).toBeNull();
    expect(result.leaderboard[0].engagements).toBeNull();
    expect(result.leaderboard[0].engagementRate).toBeNull();
  });

  it("reports the figures for posts it did fetch", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ likesCount: 300, commentsCount: 200, lastSyncedAt: new Date("2026-08-02") }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.engagements).toBe(500);
    expect(result.kpis.engagementRate).toBeCloseTo(0.05);
    expect(result.leaderboard[0].engagements).toBe(500);
  });

  it("rates only the views it has engagement for, so a mixed campaign is not diluted", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ id: "synced", likesCount: 500, lastSyncedAt: new Date("2026-08-02") }),
      post({ id: "imported", viewsCount: 90_000 }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.views).toBe(100_000);
    expect(result.kpis.engagements).toBe(500);
    // 500 / 10,000 measured views -- not 500 / 100,000.
    expect(result.kpis.engagementRate).toBeCloseTo(0.05);
  });

  it("keeps a genuine zero once the post has actually been synced", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ likesCount: 0, commentsCount: 0, lastSyncedAt: new Date("2026-08-02") }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.engagements).toBe(0);
    expect(result.kpis.engagementRate).toBe(0);
  });

  it("no longer carries spend, CPM or CPE", async () => {
    mockDb.post.findMany.mockResolvedValue([post()]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis).not.toHaveProperty("spend");
    expect(result.kpis).not.toHaveProperty("cpm");
    expect(result.kpis).not.toHaveProperty("cpe");
    expect(result).not.toHaveProperty("spendSource");
  });
});
