/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST as POSTSync } from "@/app/api/campaigns/[id]/posts/[postId]/sync/route";
import { GET as cronSync } from "@/app/api/cron/sync-posts/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    post: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    postMetricSnapshot: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

jest.mock("@/lib/platforms/fetchPostMetrics", () => ({
  ...jest.requireActual("@/lib/platforms/fetchPostMetrics"),
  fetchPostMetrics: jest.fn(),
  fetchYouTubeMetrics: jest.fn(),
  fetchYouTubeMetricsBatch: jest.fn().mockResolvedValue(new Map()),
  fetchTikTokMetrics: jest.fn(),
  fetchInstagramMetrics: jest.fn(),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;
const mockFetch = fetchPostMetrics as jest.Mock;

const authedSession = { user: { id: "u1", orgId: "org-1" } };

function makeParams(id: string, postId: string) {
  return { params: Promise.resolve({ id, postId }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  /* One live, due campaign by default. The route now asks which campaigns are
     due before it reads a single post, so even a suite about failure accounting
     has to answer that question -- an unmocked campaign.findMany resolves to
     undefined and the route 500s on .filter. */
  mockDb.campaign.findMany.mockResolvedValue([
    { id: "camp-1", refreshActive: null, refreshInterval: null, lastRefreshAt: null },
  ]);
  mockDb.campaign.updateMany.mockResolvedValue({ count: 1 });
});

describe("manual sync — never overwrites real counts with unknowns", () => {
  beforeEach(() => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: "camp-1", orgId: "org-1", deletedAt: null });
    mockDb.post.findFirst.mockResolvedValue({
      id: "post-1",
      campaignId: "camp-1",
      postUrl: "https://www.tiktok.com/@u/video/1",
      thumbnailUrl: "old.jpg",
      caption: "old caption",
      viewsCount: 9999,
    });
  });

  it("with unknown counts, updates only metadata — no count write, no snapshot", async () => {
    mockFetch.mockResolvedValue({
      platform: "TIKTOK",
      platformPostId: "1",
      thumbnailUrl: "new.jpg",
      caption: "new caption",
      postedAt: new Date(),
    });
    mockDb.post.update.mockResolvedValue({ id: "post-1", viewsCount: 9999 });

    const req = new NextRequest("http://localhost/api/campaigns/camp-1/posts/post-1/sync", { method: "POST" });
    const res = await POSTSync(req, makeParams("camp-1", "post-1"));

    expect(res.status).toBe(200);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.postMetricSnapshot.create).not.toHaveBeenCalled();

    const arg = mockDb.post.update.mock.calls[0][0];
    expect(arg.data.viewsCount).toBeUndefined();
    expect(arg.data.likesCount).toBeUndefined();
    expect(arg.data.thumbnailUrl).toBe("new.jpg");
    expect(arg.data.caption).toBe("new caption");
  });

  it("with known counts, writes counts and creates a snapshot", async () => {
    mockFetch.mockResolvedValue({
      platform: "YOUTUBE",
      platformPostId: "1",
      thumbnailUrl: "y.jpg",
      caption: "v",
      viewsCount: 1000,
      likesCount: 50,
      commentsCount: 5,
      sharesCount: 0,
      engagementRate: 5.5,
      postedAt: new Date(),
    });
    mockDb.$transaction.mockResolvedValue([{ id: "post-1", viewsCount: 1000 }, { id: "snap-1" }]);

    const req = new NextRequest("http://localhost/api/campaigns/camp-1/posts/post-1/sync", { method: "POST" });
    const res = await POSTSync(req, makeParams("camp-1", "post-1"));

    expect(res.status).toBe(200);
    expect(mockDb.$transaction).toHaveBeenCalled();
  });
});

describe("cron sync — never overwrites real counts with unknowns", () => {
  const realSecret = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "secret";
  });
  afterEach(() => {
    if (realSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = realSecret;
  });

  it("with unknown counts, updates metadata only — no snapshot", async () => {
    mockDb.post.findMany.mockResolvedValue([
      {
        id: "post-1",
        campaignId: "camp-1",
        /* Instagram, not TikTok: the cron skips TikTok outright (no sandbox on
           that path, so those reads are ~75% doomed) and this test is about the
           present-only write rule, which is platform-agnostic. The manual-sync
           block above stays on TikTok -- that route does open a sandbox. */
        platform: "INSTAGRAM",
        postUrl: "https://www.instagram.com/reel/AAA1/",
        postedAt: new Date(),
        lastSyncedAt: null,
        viewsCount: 9999,
        likesCount: 10,
        commentsCount: 2,
        sharesCount: 1,
        engagementRate: 0.5,
        syncFailCount: 0,
        syncDisabledAt: null,
        snapshots: [],
        creator: { orgId: "org-1", handle: null, socialAccounts: [] },
      },
    ]);
    mockFetch.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "1",
      thumbnailUrl: "new.jpg",
      caption: "new",
      postedAt: new Date(),
    });
    mockDb.post.update.mockResolvedValue({});

    const req = new NextRequest("http://localhost/api/cron/sync-posts", {
      headers: { authorization: "Bearer secret" },
    });
    const res = await cronSync(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    /* Not synced:1. The fetch returned metadata and no counters, and the route
       no longer files that as a successful sync -- lastSyncedAt is the only
       thing separating "no likes" from "nobody looked", so a countless fetch is
       reported as what it is. The metadata is still written, which is what the
       rest of this test checks. */
    expect(body.synced).toBe(0);
    expect(body.noCounts).toBe(1);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.postMetricSnapshot.create).not.toHaveBeenCalled();

    const arg = mockDb.post.update.mock.calls[0][0];
    expect(arg.data.viewsCount).toBeUndefined();
    expect(arg.data.thumbnailUrl).toBe("new.jpg");
  });

  it("rejects a bad cron secret with 401", async () => {
    const req = new NextRequest("http://localhost/api/cron/sync-posts", {
      headers: { authorization: "Bearer wrong" },
    });
    const res = await cronSync(req);
    expect(res.status).toBe(401);
  });
});
