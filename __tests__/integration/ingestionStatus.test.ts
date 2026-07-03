/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as ingestionStatusGET } from "@/app/api/ingestion/status/route";

jest.mock("@/lib/db", () => ({
  db: {
    post: { groupBy: jest.fn(), findMany: jest.fn() },
    postMetricSnapshot: { groupBy: jest.fn() },
  },
}));

jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: jest.fn(),
}));

import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

const mockDb = db as any;
const mockAuth = authenticateRequest as jest.Mock;

function getReq() {
  return new NextRequest("http://localhost/api/ingestion/status");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ orgId: "org-1", userId: "u1", actorEmail: "a@b.com", actorType: "USER" });
  mockDb.post.groupBy.mockResolvedValue([]);
  mockDb.post.findMany.mockResolvedValue([]);
  mockDb.postMetricSnapshot.groupBy.mockResolvedValue([]);
});

describe("GET /api/ingestion/status", () => {
  it("returns 401 when unauthenticated and runs no queries", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await ingestionStatusGET(getReq());
    expect(res.status).toBe(401);
    expect(mockDb.post.groupBy).not.toHaveBeenCalled();
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
    expect(mockDb.postMetricSnapshot.groupBy).not.toHaveBeenCalled();
  });

  it("scopes every query to the session org via the campaign relation", async () => {
    const res = await ingestionStatusGET(getReq());
    expect(res.status).toBe(200);

    expect(mockDb.post.groupBy.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockDb.post.groupBy.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ campaign: { orgId: "org-1" } }));
    }

    expect(mockDb.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaign: { orgId: "org-1" } }),
        take: 20,
      })
    );

    expect(mockDb.postMetricSnapshot.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ post: { campaign: { orgId: "org-1" } } }),
      })
    );
  });

  it("returns per-platform stats, dead-letter list, and snapshot sources", async () => {
    mockDb.post.groupBy.mockImplementation((args: any) => {
      const { where, _max } = args;
      if (_max) {
        return Promise.resolve([
          { platform: "TIKTOK", _count: { _all: 5 }, _max: { lastSyncedAt: new Date("2026-07-01T00:00:00.000Z") } },
        ]);
      }
      if (where.lastSyncedAt && where.lastSyncedAt.gte) {
        return Promise.resolve([{ platform: "TIKTOK", _count: { _all: 3 } }]);
      }
      if (where.lastSyncedAt === null) {
        return Promise.resolve([{ platform: "TIKTOK", _count: { _all: 1 } }]);
      }
      if (where.syncDisabledAt) {
        return Promise.resolve([{ platform: "TIKTOK", _count: { _all: 2 } }]);
      }
      if (where.snapshots) {
        return Promise.resolve([{ platform: "TIKTOK", _count: { _all: 4 } }]);
      }
      return Promise.resolve([]);
    });

    mockDb.post.findMany.mockResolvedValue([
      {
        id: "post-1",
        postUrl: "https://tiktok.com/@x/video/1",
        platform: "TIKTOK",
        syncFailCount: 5,
        syncDisabledAt: new Date("2026-06-30T00:00:00.000Z"),
        campaign: { title: "Summer Launch" },
      },
    ]);

    mockDb.postMetricSnapshot.groupBy.mockResolvedValue([
      { syncSource: "apify", _count: { _all: 7 } },
      { syncSource: null, _count: { _all: 2 } },
    ]);

    const res = await ingestionStatusGET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.perPlatform)).toBe(true);
    expect(body.perPlatform).toHaveLength(3);

    const tiktok = body.perPlatform.find((p: any) => p.platform === "TIKTOK");
    expect(tiktok).toMatchObject({
      total: 5,
      syncedLast24h: 3,
      neverSynced: 1,
      deadLettered: 2,
      sealed: 4,
      lastSyncAt: "2026-07-01T00:00:00.000Z",
    });

    const youtube = body.perPlatform.find((p: any) => p.platform === "YOUTUBE");
    expect(youtube).toMatchObject({
      total: 0,
      syncedLast24h: 0,
      neverSynced: 0,
      deadLettered: 0,
      sealed: 0,
      lastSyncAt: null,
    });

    expect(body.deadLetter).toEqual([
      expect.objectContaining({
        id: "post-1",
        postUrl: "https://tiktok.com/@x/video/1",
        platform: "TIKTOK",
        syncFailCount: 5,
        syncDisabledAt: "2026-06-30T00:00:00.000Z",
        campaignTitle: "Summer Launch",
      }),
    ]);

    expect(body.recentSnapshots).toEqual([
      { syncSource: "apify", count: 7 },
      { syncSource: "unknown", count: 2 },
    ]);
  });
});
