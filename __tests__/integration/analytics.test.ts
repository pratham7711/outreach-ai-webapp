/**
 * @jest-environment node
 *
 * The route counts in the database, so these mocks stub aggregates rather than
 * post rows: db.post.aggregate for the KPIs, groupBy for the per-creator and
 * per-platform rollups, and one raw query for the monthly campaign trend.
 */
import { NextRequest } from "next/server";
import { GET as getAnalytics } from "@/app/api/analytics/route";

jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn(), aggregate: jest.fn(), groupBy: jest.fn() },
    payout: { findMany: jest.fn() },
    campaign: { findMany: jest.fn() },
    creator: { findMany: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/analytics${query}`);
}

/**
 * $queryRawUnsafe is called twice, in order: the monthly campaign trend, then
 * the weekday-hour posting slots. Both are raw because month bucketing and
 * percentile_cont are the two things Prisma's query API cannot express.
 */
function stubRaw(monthRows: any[] = [], slotRows: any[] = []) {
  mockDb.$queryRawUnsafe.mockResolvedValueOnce(monthRows).mockResolvedValueOnce(slotRows);
}

const EMPTY_KPIS = {
  _sum: { viewsCount: null, likesCount: null, commentsCount: null },
  _avg: { engagementRate: null },
  _count: { _all: 0 },
};

/**
 * aggregate is called twice: once for the totals over every post, then once
 * over only the posts carrying an engagement rate — the second is the average's
 * real sample, because the import left the column at 0 on 99.4% of rows.
 */
function stubAggregates(totals: any, measured: any) {
  mockDb.post.aggregate.mockResolvedValueOnce(totals).mockResolvedValueOnce(measured);
}

/**
 * groupBy is called three times, in order: (creator, platform) totals,
 * (creator, campaign) pairs, then per-platform totals.
 */
function stubGroupBy(creatorPlatform: any[] = [], creatorCampaign: any[] = [], byPlatform: any[] = []) {
  mockDb.post.groupBy
    .mockResolvedValueOnce(creatorPlatform)
    .mockResolvedValueOnce(creatorCampaign)
    .mockResolvedValueOnce(byPlatform);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.post.aggregate.mockResolvedValue(EMPTY_KPIS);
  mockDb.post.groupBy.mockResolvedValue([]);
  mockDb.$queryRawUnsafe.mockResolvedValue([]);
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
    expect(body.kpis.avgEngagementRate).toBe(0);
    // Spend, CPM and payout counts are gone: the product does not do payments.
    expect(body.kpis.totalSpend).toBeUndefined();
    expect(body.kpis.avgCPM).toBeUndefined();
    expect(body.kpis.totalPayouts).toBeUndefined();
    expect(body.leaderboard).toHaveLength(0);
    expect(body.platformBreakdown).toHaveLength(0);
    expect(body.monthlyTrend).toHaveLength(6);
  });

  it("reports the KPIs the database counted", async () => {
    stubAggregates(
      {
        _sum: { viewsCount: 30_000, likesCount: 1_500, commentsCount: 150 },
        _count: { _all: 2 },
      },
      { _avg: { engagementRate: 5 }, _count: { _all: 2 } }
    );
    stubGroupBy(
      [
        {
          creatorId: "creator-1",
          platform: "TIKTOK",
          _sum: { viewsCount: 30_000, likesCount: 1_500, commentsCount: 150, sharesCount: 0, savesCount: 0 },
          _count: { _all: 2 },
        },
      ],
      [{ creatorId: "creator-1", campaignId: "camp-1" }],
      [{ platform: "TIKTOK", _sum: { viewsCount: 30_000 }, _count: { _all: 2 } }]
    );
    mockDb.creator.findMany.mockResolvedValue([
      { id: "creator-1", name: "Alice", handle: "alice", platform: "TIKTOK", avatarUrl: null, followersCount: 50_000 },
    ]);

    const res = await getAnalytics(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.kpis).toEqual({
      totalViews: 30_000,
      totalLikes: 1_500,
      totalComments: 150,
      avgEngagementRate: 5,
      totalPosts: 2,
      engagementSample: 2,
    });

    expect(body.leaderboard).toHaveLength(1);
    expect(body.leaderboard[0]).toMatchObject({
      name: "Alice",
      views: 30_000,
      posts: 2,
      campaigns: 1,
    });
    expect(body.leaderboard[0].earnings).toBeUndefined();
    expect(body.platformBreakdown).toEqual([{ platform: "TIKTOK", views: 30_000, posts: 2 }]);
  });

  it("averages engagement over measured posts only, and says how many", async () => {
    stubAggregates(
      { _sum: { viewsCount: 1_000_000, likesCount: 500, commentsCount: 0 }, _count: { _all: 18_708 } },
      { _avg: { engagementRate: 1.1 }, _count: { _all: 106 } }
    );

    const body = await (await getAnalytics(makeRequest())).json();
    expect(body.kpis.avgEngagementRate).toBe(1.1);
    expect(body.kpis.engagementSample).toBe(106);
    expect(body.kpis.totalPosts).toBe(18_708);

    // The second aggregate is the one that excludes the unmeasured rows.
    const [, measuredCall] = mockDb.post.aggregate.mock.calls;
    expect(measuredCall[0].where.engagementRate).toEqual({ gt: 0 });
  });

  it("prices EMV off each platform's summed counts", async () => {
    // TIKTOK view rate is $0.04, like $0.50 — 1000 views + 10 likes = $45.
    stubGroupBy([
      {
        creatorId: "creator-1",
        platform: "TIKTOK",
        _sum: { viewsCount: 1_000, likesCount: 10, commentsCount: 0, sharesCount: 0, savesCount: 0 },
        _count: { _all: 1 },
      },
    ]);
    mockDb.creator.findMany.mockResolvedValue([
      { id: "creator-1", name: "Alice", handle: "alice", platform: "TIKTOK", avatarUrl: null, followersCount: 0 },
    ]);

    const body = await (await getAnalytics(makeRequest())).json();
    expect(body.leaderboard[0].emv).toBeCloseTo(45, 2);
  });

  it("fills the six-month trend from the bucketed campaign counts", async () => {
    // A UTC month start, which is what date_trunc('month', …) returns from a UTC
    // database. Building it from LOCAL parts instead made this test depend on the
    // time of day: in IST a local 1 Aug 00:07 is 31 Jul 18:37 UTC, so between
    // 18:30 and 24:00 UTC the row keyed to the previous month and the newest slot
    // read zero. The fixture, not the clock, was wrong.
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    mockDb.$queryRawUnsafe.mockResolvedValue([
      { bucket: thisMonth, campaigns: BigInt(4), active: BigInt(1) },
    ]);

    const body = await (await getAnalytics(makeRequest())).json();
    expect(body.monthlyTrend).toHaveLength(6);
    expect(body.monthlyTrend[5]).toMatchObject({ campaigns: 4, active: 1 });
  });

  it("never queries payouts, and never reads whole post rows", async () => {
    await getAnalytics(makeRequest());
    expect(mockDb.payout.findMany).not.toHaveBeenCalled();
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
  });

  it("does not leak data across orgs (cross-tenant isolation)", async () => {
    stubGroupBy([
      {
        creatorId: "creator-1",
        platform: "TIKTOK",
        _sum: { viewsCount: 1, likesCount: 0, commentsCount: 0, sharesCount: 0, savesCount: 0 },
        _count: { _all: 1 },
      },
    ]);
    await getAnalytics(makeRequest());

    const scopedToOrg = expect.objectContaining({
      where: expect.objectContaining({
        campaign: expect.objectContaining({ orgId: "org-1" }),
      }),
    });
    expect(mockDb.post.aggregate).toHaveBeenCalledWith(scopedToOrg);
    for (const call of mockDb.post.groupBy.mock.calls) {
      expect(call[0].where.campaign.orgId).toBe("org-1");
    }
    // Leaderboard profiles are fetched by id, and still scoped to the org.
    expect(mockDb.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: "org-1" }),
      })
    );
    const [, orgArg] = mockDb.$queryRawUnsafe.mock.calls[0];
    expect(orgArg).toBe("org-1");
  });

  it("returns the posting slots the database bucketed, in the requested zone", async () => {
    stubRaw([], [{ day: 4, hour: 19, count: 5, medianViews: 1200 }]);
    const body = await (await getAnalytics(makeRequest("?tz=Asia/Kolkata"))).json();

    expect(body.postingTimeZone).toBe("Asia/Kolkata");
    expect(body.postingBuckets).toEqual([{ day: 4, hour: 19, count: 5, medianViews: 1200 }]);

    // The zone reaches the query as a bound parameter, and the conversion is
    // doubled: "postedAt" is timestamp WITHOUT time zone holding UTC, so a
    // single AT TIME ZONE would shift every post by the viewer's offset.
    const [sql, orgArg, tzArg] = mockDb.$queryRawUnsafe.mock.calls[1];
    expect(orgArg).toBe("org-1");
    expect(tzArg).toBe("Asia/Kolkata");
    expect(sql).toContain("AT TIME ZONE 'UTC') AT TIME ZONE $2");
    expect(sql).toContain("percentile_cont");
  });

  it("falls back to UTC rather than passing an unknown zone to the database", async () => {
    // Postgres throws on an unrecognised zone name, so a hand-edited tz must not
    // reach it — and it is a bound parameter, so it was never an injection.
    await getAnalytics(makeRequest("?tz=Mars/Olympus_Mons"));
    expect(mockDb.$queryRawUnsafe.mock.calls[1][2]).toBe("UTC");
  });

  it("reports an all-null median as zero instead of null", async () => {
    stubRaw([], [{ day: 0, hour: 0, count: 2, medianViews: null }]);
    const body = await (await getAnalytics(makeRequest())).json();
    expect(body.postingBuckets[0].medianViews).toBe(0);
  });

  it("narrows the posting slots by the same platform and date filters as the KPIs", async () => {
    await getAnalytics(makeRequest("?platform=TIKTOK&from=2026-01-01"));
    const [sql, , , platformArg, fromArg] = mockDb.$queryRawUnsafe.mock.calls[1];
    expect(sql).toContain("p.platform::text = $3");
    expect(sql).toContain('p."postedAt" >= $4');
    expect(platformArg).toBe("TIKTOK");
    expect(new Date(fromArg as string).getUTCFullYear()).toBe(2026);
  });

  it("scopes the posting slots to the org", async () => {
    await getAnalytics(makeRequest());
    const [sql, orgArg] = mockDb.$queryRawUnsafe.mock.calls[1];
    expect(sql).toContain('c."orgId" = $1');
    expect(orgArg).toBe("org-1");
  });
});
