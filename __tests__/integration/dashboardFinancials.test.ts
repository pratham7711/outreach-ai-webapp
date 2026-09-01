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
    post: { findMany: jest.fn(), groupBy: jest.fn() },
    creator: { findMany: jest.fn() },
    activation: { findMany: jest.fn() },
    campaignDeposit: { findMany: jest.fn() },
    $queryRawUnsafe: jest.fn(),
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

// Every aggregate the route runs, empty by default; individual tests override.
function stubEmptyAggregates() {
  mockDb.campaign.count.mockResolvedValue(0);
  mockDb.campaign.findMany.mockResolvedValue([]);
  mockDb.post.groupBy.mockResolvedValue([]);
  mockDb.post.findMany.mockResolvedValue([]);
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
    expect(body.summary).toEqual({ activeCampaigns: 1, totalCreators: 1 });
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
    expect(body.summary).toEqual({ activeCampaigns: 0, totalCreators: 0 });
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

  it("rejects the retired payouts export type", async () => {
    const req = makeRequest("http://localhost/api/dashboard/financials/export?type=payouts");
    const res = await EXPORT_GET(req);
    expect(res.status).toBe(400);
  });
});
