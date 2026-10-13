/**
 * @jest-environment node
 *
 * Integration tests for GET /api/dashboard/financials and /api/dashboard/financials/export.
 *
 * The rollup reports campaign delivery, not money, and aggregates in the
 * database rather than reducing rows in Node.
 */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/dashboard/financials/route";
import { GET as EXPORT_GET } from "@/app/api/dashboard/financials/export/route";

jest.mock("@/lib/db", () => ({
  db: {
    payout: { findMany: jest.fn() },
    campaign: { findMany: jest.fn(), count: jest.fn() },
    post: { findMany: jest.fn(), groupBy: jest.fn(), aggregate: jest.fn() },
    creator: { findMany: jest.fn() },
    activation: { findMany: jest.fn() },
    campaignDeposit: { findMany: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  },
}));

/* Org totals leave out repeat copies of a video (lib/posts/duplicates). That
   lookup is its own query; these tests are about the aggregates, so it finds none. */
const mockDuplicatePostIds = jest.fn().mockResolvedValue([]);
jest.mock("@/lib/posts/duplicates", () => ({
  ...jest.requireActual("@/lib/posts/duplicates"),
  duplicatePostIds: (...args: unknown[]) => mockDuplicatePostIds(...args),
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

// Every aggregate the route runs, empty by default; individual tests override.
function stubEmptyAggregates() {
  mockDb.campaign.count.mockResolvedValue(0);
  mockDb.campaign.findMany.mockResolvedValue([]);
  mockDb.post.groupBy.mockResolvedValue([]);
  mockDb.post.findMany.mockResolvedValue([]);
  mockDb.post.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { lastSyncedAt: null, lastFreshAt: null } });
  mockDb.activation.findMany.mockResolvedValue([]);
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.$queryRawUnsafe.mockResolvedValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(session);
  stubEmptyAggregates();
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

  it("returns a delivery rollup with the default date range", async () => {
    mockDb.campaign.count.mockResolvedValue(1);
    mockDb.campaign.findMany.mockResolvedValue([{ id: "camp-1", title: "Test" }]);
    mockDb.activation.findMany.mockResolvedValue([{ campaignId: "camp-1", creatorId: "c1" }]);
    // One measured reading, as OrgViewsSnapshot rows come back.
    mockDb.$queryRawUnsafe.mockResolvedValue([
      { bucket: new Date("2026-08-01"), views: 10000, posts: 1 },
    ]);
    mockDb.post.groupBy
      // The creators who posted in range (the Creators tile).
      .mockResolvedValueOnce([{ creatorId: "c1" }])
      .mockResolvedValueOnce([{ campaignId: "camp-1", _sum: { viewsCount: 10000 } }])
      .mockResolvedValueOnce([{ platform: "TIKTOK", _sum: { viewsCount: 10000 }, _count: { _all: 1 } }])
      .mockResolvedValueOnce([
        { creatorId: "c1", _sum: { viewsCount: 10000 }, _avg: { engagementRate: 5 }, _count: { _all: 1 } },
      ]);
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", name: "Creator One", handle: "creator1", platform: "TIKTOK", _count: { activations: 1 } },
    ]);
    mockDb.post.findMany.mockResolvedValue([
      {
        id: "post-1", viewsCount: 10000, likesCount: 500, engagementRate: 5.0,
        platform: "TIKTOK", postUrl: "https://tiktok.com/123",
        creator: { name: "Creator One" }, campaign: { title: "Test" },
      },
    ]);

    const req = makeRequest("http://localhost/api/dashboard/financials");
    const res = await GET(req);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.summary).toMatchObject({ activeCampaigns: 1, totalCreators: 1 });
    expect(body.viewsOverTime).toEqual([{ date: "2026-08", views: 10000, posts: 1 }]);
    expect(body.viewsByCampaign).toEqual([
      { campaignId: "camp-1", title: "Test", views: 10000, creatorsCount: 1 },
    ]);
    expect(body.platformBreakdown).toEqual([{ platform: "TIKTOK", views: 10000, postsCount: 1 }]);
    expect(body.creatorPerformance[0]).toMatchObject({ name: "Creator One", views: 10000 });
    /* The handle alone does not identify a creator. Production holds 22 handles
       that exist on both TikTok and Instagram -- two real accounts, two rows --
       and a table without the platform shows them as one creator listed twice.
       That misreading is what this field exists to prevent. */
    expect(body.creatorPerformance[0].platform).toBe("TIKTOK");
    expect(body.topPosts[0]).toMatchObject({ id: "post-1", viewsCount: 10000 });
  });

  it("never reads payouts or deposits", async () => {
    await GET(makeRequest("http://localhost/api/dashboard/financials"));
    expect(mockDb.payout.findMany).not.toHaveBeenCalled();
    expect(mockDb.campaignDeposit.findMany).not.toHaveBeenCalled();
  });

  it("scopes every aggregate to the session org", async () => {
    await GET(makeRequest("http://localhost/api/dashboard/financials"));
    expect(mockDb.campaign.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: "org-1" }) })
    );
    const [sql, orgArg] = mockDb.$queryRawUnsafe.mock.calls[0];
    expect(orgArg).toBe("org-1");
    expect(sql).toContain('"OrgViewsSnapshot"');
    expect(sql).toContain('s."orgId" = $1');
  });

  /* Soft-deleted campaigns are gone from activeCampaigns and from the title
     lookup, so a post aggregate that still counted them made the Total Views
     and Total Posts tiles disagree with the campaign list beside them, and gave
     "Views by campaign" a bar whose title lookup missed -- an "Unknown campaign"
     that is really a campaign somebody deleted. */
  it("excludes posts belonging to soft-deleted campaigns from every post aggregate", async () => {
    await GET(makeRequest("http://localhost/api/dashboard/financials"));

    const postWheres = [
      ...mockDb.post.groupBy.mock.calls.map((c: any[]) => c[0].where),
      ...mockDb.post.findMany.mock.calls.map((c: any[]) => c[0].where),
    ];
    expect(postWheres.length).toBeGreaterThan(0);
    for (const where of postWheres) {
      expect(where.campaign).toEqual({ orgId: "org-1", deletedAt: null });
    }
  });

  it("counts a video in two campaigns once org-wide, and once per campaign in Views by campaign", async () => {
    mockDuplicatePostIds.mockResolvedValueOnce(["post-copy"]);
    await GET(makeRequest("http://localhost/api/dashboard/financials"));

    const byGroup = (by: string) =>
      mockDb.post.groupBy.mock.calls.find((c: Array<{ by: string[]; where: unknown }>) => c[0].by.join() === by)![0].where;
    expect(byGroup("platform").id).toEqual({ notIn: ["post-copy"] });
    expect(byGroup("creatorId").id).toEqual({ notIn: ["post-copy"] });
    expect(byGroup("campaignId").id).toBeUndefined();
    expect(mockDb.post.findMany.mock.calls[0][0].where.id).toEqual({ notIn: ["post-copy"] });
  });

  /* The Creators tile follows the range picker like the tiles beside it: the
     creators who POSTED in the range, on campaigns that still exist. It was
     every creator holding an activation, which no range could move -- the tile
     read 6 on 7D and 1Y alike. The Unattributed holding row is not a creator. */
  it("counts the creators who posted in the range, on live campaigns, without the Unattributed row", async () => {
    const from = "2026-10-06T00:00:00.000Z";
    await GET(makeRequest(`http://localhost/api/dashboard/financials?from=${from}`));

    const [creatorsCall] = mockDb.post.groupBy.mock.calls;
    expect(creatorsCall[0].by).toEqual(["creatorId"]);
    expect(creatorsCall[0].where.campaign).toEqual({ orgId: "org-1", deletedAt: null });
    expect(creatorsCall[0].where.postedAt.gte.toISOString()).toBe(from);
    expect(creatorsCall[0].where.creator).toEqual({ NOT: expect.objectContaining({ handle: "" }) });
    expect(mockDb.activation.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ["creatorId"] }),
    );
  });

  it("counts no creators for a range nobody posted in", async () => {
    mockDb.post.groupBy.mockResolvedValueOnce([]);
    const body = await (await GET(makeRequest("http://localhost/api/dashboard/financials"))).json();
    expect(body.summary.totalCreators).toBe(0);
  });

  /* Unknown is never 0: a creator whose posts in range carry no view count
     (Instagram photos publish none) has no views, and Top posts lists only
     posts that have one. */
  it("reports unknown views as null, and ranks only posts with a view count as top posts", async () => {
    mockDb.post.groupBy
      .mockResolvedValueOnce([{ creatorId: "c1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ creatorId: "c1", _sum: { viewsCount: 0 }, _count: { _all: 3 } }]);
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", name: "Photo Person", handle: "photos", platform: "INSTAGRAM", _count: { activations: 1 } },
    ]);
    mockDb.post.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _max: { lastSyncedAt: new Date("2026-10-13T07:50:00Z"), lastFreshAt: null },
    });

    const body = await (await GET(makeRequest("http://localhost/api/dashboard/financials"))).json();
    expect(body.creatorPerformance[0].views).toBeNull();
    expect(body.summary).toMatchObject({ viewsKnownPosts: 0, asOf: "2026-10-13T07:50:00.000Z" });
    expect(mockDb.post.findMany.mock.calls[0][0].where.viewsCount).toEqual({ gt: 0 });
    const creatorRanking = mockDb.post.groupBy.mock.calls[3][0];
    expect(creatorRanking.where.creator).toEqual({ NOT: expect.objectContaining({ handle: "" }) });
  });

  /* The point of the snapshot table. If the chart ever goes back to reading
     Post.viewsCount, the past starts moving again and a screenshot from last
     week stops matching today's chart. */
  it("reads the views chart from measured snapshots, not from post rows", async () => {
    await GET(makeRequest("http://localhost/api/dashboard/financials"));
    const [sql] = mockDb.$queryRawUnsafe.mock.calls[0];
    expect(sql).not.toContain('p."postedAt"');
    expect(sql).not.toContain("SUM(views)");
  });

  /* viewsCount is a LEVEL, so a monthly bucket takes the last reading in the
     month. Summing would add the same lifetime views once per day. */
  it("takes one row per bucket rather than summing the readings", async () => {
    await GET(makeRequest("http://localhost/api/dashboard/financials?granularity=monthly"));
    const [sql] = mockDb.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("DISTINCT ON (bucket)");
    expect(sql).toContain('ORDER BY bucket, s."day" DESC');
    expect(sql).not.toMatch(/SUM\s*\(\s*s\."viewsCount"/i);
  });

  it("returns empty collections for an org with no delivery yet", async () => {
    const req = makeRequest("http://localhost/api/dashboard/financials");
    const res = await GET(req);

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.summary).toEqual({ activeCampaigns: 0, totalCreators: 0, viewsKnownPosts: 0, asOf: null });
    expect(body.viewsOverTime).toEqual([]);
    expect(body.viewsByCampaign).toEqual([]);
    expect(body.platformBreakdown).toEqual([]);
    expect(body.topPosts).toEqual([]);
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

  it("exports campaigns as CSV, with no money columns", async () => {
    mockDb.campaign.findMany.mockResolvedValue([
      {
        title: "Test Campaign",
        status: "IN_PROGRESS",
        createdAt: new Date("2026-01-15"),
        client: { name: "Acme" },
        activations: [{ id: "a1" }],
      },
    ]);

    const req = makeRequest("http://localhost/api/dashboard/financials/export");
    const res = await EXPORT_GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");

    const csv = await res.text();
    const header = csv.split("\n")[0];
    expect(header).toBe("Campaign,Client,Status,Creators,Start Date");
    expect(csv).toContain("Test Campaign");
    expect(csv).not.toMatch(/Budget|Spent|Paid/);
  });

  /* Plan A2/A6: the creators export dates its one metric and says where it
     came from, in columns appended after the ones it always had. */
  it("exports creators with Avg Views, its age and its source, and — where none was measured", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", name: "Creator One", handle: "fake.one", platform: "TIKTOK", activations: [{ id: "a1" }] },
      { id: "c2", name: "Creator Two", handle: "fake.two", platform: "INSTAGRAM", activations: [] },
    ]);
    mockDb.post.groupBy.mockResolvedValue([
      { creatorId: "c1", _avg: { viewsCount: 1234.4 }, _max: { lastSyncedAt: new Date("2026-09-30T06:00:00Z"), lastFreshAt: null } },
    ]);

    const res = await EXPORT_GET(makeRequest("http://localhost/api/dashboard/financials/export?type=creators"));
    const [header, one, two] = (await res.text()).split("\n");

    expect(header).toBe("Creator,Handle,Platform,Activations,Avg Views,Avg Views as of,Avg Views source");
    expect(one).toBe("Creator One,fake.one,TIKTOK,1,1234,2026-09-30T06:00:00.000Z,Tracked posts");
    expect(two).toBe("Creator Two,fake.two,INSTAGRAM,0,—,—,No measured posts");
    // The org's creators only.
    expect(mockDb.creator.findMany.mock.calls[0][0].where).toMatchObject({ orgId: "org-1" });
  });

  it("rejects the retired payouts export type", async () => {
    const req = makeRequest("http://localhost/api/dashboard/financials/export?type=payouts");
    const res = await EXPORT_GET(req);
    expect(res.status).toBe(400);
  });
});
