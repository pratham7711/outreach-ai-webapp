/**
 * @jest-environment node
 *
 * GET /api/analytics/campaigns — the Campaign Comparison chart.
 *
 * The series is the interesting part. PostMetricSnapshot.viewsCount is a LEVEL,
 * so the route must take the latest reading per post per day and carry it
 * forward, not add up whatever readings happen to land on a day. It used to add
 * them, which multiplied an hourly-synced post's views by as much as 24 and put
 * the comparison lines an order of magnitude above the campaigns' own KPIs.
 */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/analytics/campaigns/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findMany: jest.fn() },
    post: { findMany: jest.fn() },
  },
}));

jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn() }));

import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

const mockDb = db as any;
const mockAuth = authenticateRequest as jest.Mock;

function req(query: string) {
  return new NextRequest(`http://localhost/api/analytics/campaigns${query}`);
}

function post(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    campaignId: "camp-1",
    platform: "TIKTOK",
    postedAt: new Date("2026-09-01T00:00:00Z"),
    viewsCount: 0,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    savesCount: 0,
    // Null is the imported state: counters at their column default, nothing
    // ever fetched. rollupEngagement reads that as "not measured".
    lastSyncedAt: null,
    snapshots: [],
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ orgId: "org-1" });
  mockDb.campaign.findMany.mockResolvedValue([{ id: "camp-1", title: "Test" }]);
  mockDb.post.findMany.mockResolvedValue([]);
});

describe("GET /api/analytics/campaigns", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET(req("?ids=camp-1"))).status).toBe(401);
  });

  it("scopes the campaign lookup to the session org and skips deleted ones", async () => {
    await GET(req("?ids=camp-1"));
    expect(mockDb.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: "org-1", deletedAt: null }),
      })
    );
  });

  /* The bug. One post, two readings on one day, one campaign total. */
  it("counts two same-day snapshots of one post once, at the later reading", async () => {
    mockDb.post.findMany
      .mockResolvedValueOnce([
        post({
          viewsCount: 1_200,
          snapshots: [
            { recordedAt: new Date("2026-09-02T01:00:00Z"), viewsCount: 1_000 },
            { recordedAt: new Date("2026-09-02T13:00:00Z"), viewsCount: 1_200 },
          ],
        }),
      ])
      .mockResolvedValueOnce([]);

    const body = await (await GET(req("?ids=camp-1"))).json();

    expect(body.series).toEqual([{ date: "2026-09-02", "camp-1": 1_200 }]);
    expect(body.series[0]["camp-1"]).not.toBe(2_200);
  });

  /* A post nobody snapshotted still has views, and the KPI total counts them,
     so the chart has to as well — it used to drop such posts entirely whenever
     any other post on the campaign had a snapshot. */
  it("charts an unsnapshotted post from its posting day, alongside snapshotted ones", async () => {
    mockDb.post.findMany
      .mockResolvedValueOnce([
        post({
          id: "snapped",
          viewsCount: 900,
          snapshots: [{ recordedAt: new Date("2026-09-01T06:00:00Z"), viewsCount: 900 }],
        }),
        post({ id: "imported", postedAt: new Date("2026-09-02T00:00:00Z"), viewsCount: 300 }),
      ])
      .mockResolvedValueOnce([]);

    const body = await (await GET(req("?ids=camp-1"))).json();

    expect(body.series).toEqual([
      { date: "2026-09-01", "camp-1": 900 },
      { date: "2026-09-02", "camp-1": 1_200 },
    ]);
    // The chart's last point now agrees with the comparison row's own total.
    expect(body.comparison[0].views).toBe(1_200);
  });

  /* The engagement rate on this chart used to be computeEngagementRate over the
     summed counters, which puts an unmeasured post's views in the denominator
     against zeroes it never earned. Same campaign, same day, a different rate
     from the Performance tab and the client report. It is rollupEngagement now,
     which is the one definition. */
  describe("engagement rate", () => {
    it("rates only the views of the posts it actually measured", async () => {
      mockDb.post.findMany
        .mockResolvedValueOnce([
          post({
            id: "measured",
            viewsCount: 10_000,
            likesCount: 500,
            commentsCount: 100,
            lastSyncedAt: new Date("2026-09-03"),
          }),
          // 90,000 views, never fetched. Counting these in the denominator was
          // what turned 6% into 0.6%.
          post({ id: "imported", viewsCount: 90_000 }),
        ])
        .mockResolvedValueOnce([]);

      const body = await (await GET(req("?ids=camp-1"))).json();

      // 600 / 10,000, not 600 / 100,000.
      expect(body.comparison[0].engagementRate).toBeCloseTo(0.06, 6);
      expect(body.comparison[0].engagements).toBe(600);
      // Views are still every post's — those were always measured.
      expect(body.comparison[0].views).toBe(100_000);
    });

    it("reports zero rather than a rate when no post on the campaign was measured", async () => {
      mockDb.post.findMany
        .mockResolvedValueOnce([post({ viewsCount: 5_000 })])
        .mockResolvedValueOnce([]);

      const body = await (await GET(req("?ids=camp-1"))).json();
      expect(body.comparison[0].engagementRate).toBe(0);
      expect(body.comparison[0].engagements).toBe(0);
    });

    it("measures the org distribution the same way as the campaign it compares", async () => {
      // Selected campaign: 6%. The org's other campaign: 1%, on measured posts.
      mockDb.campaign.findMany.mockResolvedValue([{ id: "camp-1", title: "Test" }]);
      mockDb.post.findMany
        .mockResolvedValueOnce([
          post({ id: "m", viewsCount: 10_000, likesCount: 600, lastSyncedAt: new Date("2026-09-03") }),
        ])
        .mockResolvedValueOnce([
          { campaignId: "camp-1", platform: "TIKTOK", viewsCount: 10_000, likesCount: 600, commentsCount: 0, sharesCount: 0, savesCount: 0, lastSyncedAt: new Date("2026-09-03") },
          { campaignId: "camp-2", platform: "TIKTOK", viewsCount: 10_000, likesCount: 100, commentsCount: 0, sharesCount: 0, savesCount: 0, lastSyncedAt: new Date("2026-09-03") },
          // Unmeasured, and on a third campaign, so it contributes no rate at
          // all rather than a 0% that would drag the org average down.
          { campaignId: "camp-3", platform: "TIKTOK", viewsCount: 500_000, likesCount: 0, commentsCount: 0, sharesCount: 0, savesCount: 0, lastSyncedAt: null },
        ]);

      const body = await (await GET(req("?ids=camp-1"))).json();
      // 0.06 against a distribution of [0.06, 0.01, null] — comfortably above.
      expect(body.comparison[0].engRateVsOrg).not.toBeNull();
      expect(body.comparison[0].engagementRate).toBeCloseTo(0.06, 6);
    });

    it("selects lastSyncedAt, without which every post reads as measured-zero", async () => {
      await GET(req("?ids=camp-1"));
      for (const call of mockDb.post.findMany.mock.calls) {
        expect(call[0].select.lastSyncedAt).toBe(true);
      }
    });
  });

  it("returns an empty payload when no requested campaign belongs to the org", async () => {
    mockDb.campaign.findMany.mockResolvedValue([]);
    const body = await (await GET(req("?ids=someone-elses"))).json();
    expect(body).toEqual({ campaigns: [], series: [], orgAverages: null });
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
  });
});
