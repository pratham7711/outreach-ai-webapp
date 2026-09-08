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

  it("returns an empty payload when no requested campaign belongs to the org", async () => {
    mockDb.campaign.findMany.mockResolvedValue([]);
    const body = await (await GET(req("?ids=someone-elses"))).json();
    expect(body).toEqual({ campaigns: [], series: [], orgAverages: null });
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
  });
});
