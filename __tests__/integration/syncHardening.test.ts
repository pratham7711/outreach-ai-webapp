/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as cronSync } from "@/app/api/cron/sync-posts/route";

jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn(), update: jest.fn() },
    postMetricSnapshot: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/platforms/fetchPostMetrics", () => ({
  fetchPostMetrics: jest.fn(),
  hasMetricCounts: jest.requireActual("@/lib/platforms/fetchPostMetrics").hasMetricCounts,
}));

import { db } from "@/lib/db";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";

const mockDb = db as any;
const mockFetch = fetchPostMetrics as jest.Mock;

const HOUR_MS = 60 * 60 * 1000;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * HOUR_MS);
}

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    platform: "TIKTOK",
    postUrl: "https://www.tiktok.com/@u/video/1",
    postedAt: hoursAgo(1),
    lastSyncedAt: null,
    viewsCount: 100,
    likesCount: 10,
    commentsCount: 2,
    sharesCount: 1,
    engagementRate: 12,
    syncFailCount: 0,
    syncDisabledAt: null,
    snapshots: [],
    ...overrides,
  };
}

function cronReq(url = "http://localhost/api/cron/sync-posts") {
  return new NextRequest(url, { headers: { authorization: "Bearer secret" } });
}

const realSecret = process.env.CRON_SECRET;
const realTikTokBudget = process.env.SYNC_BUDGET_TIKTOK;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env.CRON_SECRET = "secret";
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
  if (realSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = realSecret;
  if (realTikTokBudget === undefined) delete process.env.SYNC_BUDGET_TIKTOK;
  else process.env.SYNC_BUDGET_TIKTOK = realTikTokBudget;
});

describe("cron sync hardening — dry run", () => {
  it("performs no fetches or writes and returns per-post decisions with a summary", async () => {
    mockDb.post.findMany.mockResolvedValue([
      makePost({ id: "fresh" }),
      makePost({ id: "old", postedAt: hoursAgo(31 * 24) }),
      makePost({ id: "disabled", syncDisabledAt: hoursAgo(2) }),
      makePost({ id: "done", snapshots: [{ id: "snap-final" }] }),
      makePost({ id: "cadence", postedAt: hoursAgo(3 * 24), lastSyncedAt: hoursAgo(1) }),
    ]);

    const res = await cronSync(cronReq("http://localhost/api/cron/sync-posts?dryRun=1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.post.update).not.toHaveBeenCalled();
    expect(mockDb.postMetricSnapshot.create).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();

    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.total).toBe(5);
    expect(body.decisions).toEqual([
      { postId: "fresh", platform: "TIKTOK", action: "sync", reason: "due" },
      { postId: "old", platform: "TIKTOK", action: "seal", reason: "age-over-30d" },
      { postId: "disabled", platform: "TIKTOK", action: "skip", reason: "dead-letter" },
      { postId: "done", platform: "TIKTOK", action: "skip", reason: "sealed" },
      { postId: "cadence", platform: "TIKTOK", action: "skip", reason: "cadence-1-7d" },
    ]);
    expect(body.summary.byAction).toEqual({ sync: 1, seal: 1, skip: 3 });
    expect(body.summary.byReason).toEqual({
      due: 1,
      "age-over-30d": 1,
      "dead-letter": 1,
      sealed: 1,
      "cadence-1-7d": 1,
    });
  });
});

describe("cron sync hardening — dead-letter", () => {
  it("increments syncFailCount on thrown error and dead-letters at 5", async () => {
    mockDb.post.findMany.mockResolvedValue([
      makePost({ id: "p-low", syncFailCount: 0 }),
      makePost({ id: "p-edge", postUrl: "https://www.tiktok.com/@u/video/2", syncFailCount: 4 }),
    ]);
    mockFetch.mockRejectedValue(new Error("platform down"));
    mockDb.post.update.mockResolvedValue({});

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.failed).toBe(2);
    expect(body.deadLettered).toBe(1);
    expect(body.synced).toBe(0);

    const updates = mockDb.post.update.mock.calls.map((c: any[]) => c[0]);
    const lowUpdate = updates.find((u: any) => u.where.id === "p-low");
    expect(lowUpdate.data.syncFailCount).toBe(1);
    expect(lowUpdate.data.syncDisabledAt).toBeUndefined();

    const edgeUpdate = updates.find((u: any) => u.where.id === "p-edge");
    expect(edgeUpdate.data.syncFailCount).toBe(5);
    expect(edgeUpdate.data.syncDisabledAt).toBeInstanceOf(Date);
  });

  it("skips a dead-lettered post without fetching", async () => {
    mockDb.post.findMany.mockResolvedValue([
      makePost({ id: "p-dead", syncFailCount: 5, syncDisabledAt: hoursAgo(24) }),
    ]);

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(body.synced).toBe(0);
    expect(body.failed).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.post.update).not.toHaveBeenCalled();
  });

  it("resets syncFailCount to 0 on successful sync", async () => {
    mockDb.post.findMany.mockResolvedValue([makePost({ id: "p-recover", syncFailCount: 3 })]);
    mockFetch.mockResolvedValue({
      platform: "TIKTOK",
      platformPostId: "1",
      thumbnailUrl: null,
      caption: null,
      viewsCount: 500,
      likesCount: 5,
      commentsCount: 1,
      sharesCount: 0,
      engagementRate: 1.2,
      postedAt: new Date(),
    });
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(body.synced).toBe(1);
    const updateArg = mockDb.post.update.mock.calls[0][0];
    expect(updateArg.where.id).toBe("p-recover");
    expect(updateArg.data.syncFailCount).toBe(0);
  });
});

describe("cron sync hardening — sealing", () => {
  it("seals a >30d post from stored counts without a platform fetch", async () => {
    mockDb.post.findMany.mockResolvedValue([
      makePost({
        id: "p-old",
        postedAt: hoursAgo(31 * 24),
        viewsCount: 4321,
        likesCount: 21,
        commentsCount: 3,
        sharesCount: 2,
        engagementRate: 0.55,
      }),
    ]);
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(body.sealed).toBe(1);
    expect(body.synced).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();

    const snapArg = mockDb.postMetricSnapshot.create.mock.calls[0][0];
    expect(snapArg.data).toMatchObject({
      postId: "p-old",
      viewsCount: 4321,
      likesCount: 21,
      commentsCount: 3,
      sharesCount: 2,
      engagementRate: 0.55,
      isFinalSnapshot: true,
      syncSource: "cron-seal",
    });

    const updateArg = mockDb.post.update.mock.calls[0][0];
    expect(updateArg.where.id).toBe("p-old");
    expect(updateArg.data.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("is idempotent — skips when a final snapshot already exists", async () => {
    mockDb.post.findMany.mockResolvedValue([
      makePost({ id: "p-done", postedAt: hoursAgo(31 * 24), snapshots: [{ id: "snap-1" }] }),
    ]);

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(body.sealed).toBe(0);
    expect(body.synced).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.postMetricSnapshot.create).not.toHaveBeenCalled();
    expect(mockDb.post.update).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});

describe("cron sync hardening — per-platform budgets", () => {
  it("skips remaining posts of a platform once its budget is exhausted", async () => {
    process.env.SYNC_BUDGET_TIKTOK = "1";
    mockDb.post.findMany.mockResolvedValue([
      makePost({ id: "t-1" }),
      makePost({ id: "t-2", postUrl: "https://www.tiktok.com/@u/video/2" }),
      makePost({
        id: "y-1",
        platform: "YOUTUBE",
        postUrl: "https://www.youtube.com/watch?v=abc123",
      }),
    ]);
    mockFetch.mockResolvedValue({
      platform: "TIKTOK",
      platformPostId: "1",
      thumbnailUrl: null,
      caption: null,
      postedAt: new Date(),
    });
    mockDb.post.update.mockResolvedValue({});

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith("https://www.tiktok.com/@u/video/1");
    expect(mockFetch).toHaveBeenCalledWith("https://www.youtube.com/watch?v=abc123");
    expect(mockFetch).not.toHaveBeenCalledWith("https://www.tiktok.com/@u/video/2");
    expect(body.skippedForBudget).toBe(1);
    expect(body.synced).toBe(2);
  });

  it("reports budget skips in dry-run decisions", async () => {
    process.env.SYNC_BUDGET_TIKTOK = "1";
    mockDb.post.findMany.mockResolvedValue([
      makePost({ id: "t-1" }),
      makePost({ id: "t-2", postUrl: "https://www.tiktok.com/@u/video/2" }),
    ]);

    const res = await cronSync(cronReq("http://localhost/api/cron/sync-posts?dryRun=1"));
    const body = await res.json();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.post.update).not.toHaveBeenCalled();
    expect(body.decisions).toEqual([
      { postId: "t-1", platform: "TIKTOK", action: "sync", reason: "due" },
      { postId: "t-2", platform: "TIKTOK", action: "skip", reason: "budget" },
    ]);
    expect(body.summary.byReason.budget).toBe(1);
  });
});
