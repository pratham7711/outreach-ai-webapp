/**
 * @jest-environment node
 *
 * Instagram post reads paced hourly (lib/sync/instagramPacing): the 6-hourly
 * sweep leaves Instagram to the hourly pass, the hourly pass reads Instagram
 * only under its own small budget and below Meta's usage threshold, and a post
 * it holds back for usage is left untouched so it stays due.
 */
import { NextRequest } from "next/server";
import { GET as sixHourly } from "@/app/api/cron/sync-posts/route";
import { GET as hourlyInstagram } from "@/app/api/cron/sync-instagram-posts/route";

jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn(), update: jest.fn() },
    organization: { findUnique: jest.fn(), findMany: jest.fn() },
    campaign: { findMany: jest.fn(), updateMany: jest.fn() },
    postMetricSnapshot: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/platforms/fetchPostMetrics", () => ({
  ...jest.requireActual("@/lib/platforms/fetchPostMetrics"),
  fetchPostMetrics: jest.fn(),
  fetchYouTubeMetricsBatch: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock("@/lib/alerts", () => ({
  ...jest.requireActual("@/lib/alerts"),
  alertOps: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/platforms/tiktokPostSandbox", () => ({
  laneCountFor: jest.fn(() => 0),
  openSandboxPostPool: jest.fn(() => ({ size: 1, readPost: jest.fn(), close: jest.fn().mockResolvedValue(undefined) })),
}));
const deferred = jest.fn((_pct: number) => false);
jest.mock("@/lib/platforms/instagramDiscoveryTokens", () => ({
  ...jest.requireActual("@/lib/platforms/instagramDiscoveryTokens"),
  backgroundReadsDeferred: (pct: number) => deferred(pct),
}));

import { db } from "@/lib/db";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { POST_SWEEP_STOP_PERCENT } from "@/lib/platforms/instagramDiscoveryTokens";

const mockDb = db as any;
const mockFetch = fetchPostMetrics as jest.Mock;
const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR_MS);

function post(id: string, platform: "INSTAGRAM" | "YOUTUBE", url: string) {
  return {
    id,
    campaignId: "campaign-1",
    platform,
    postUrl: url,
    postedAt: hoursAgo(60 * 24),
    lastSyncedAt: null,
    viewsCount: 100,
    likesCount: 10,
    commentsCount: 2,
    sharesCount: 1,
    engagementRate: 12,
    syncFailCount: 0,
    syncDisabledAt: null,
    snapshots: [],
    trackingEnabled: true,
    trackingStartedAt: hoursAgo(1),
    trackingTtlDays: 30,
    trackingExpiresAt: new Date(Date.now() + 29 * 24 * HOUR_MS),
    creator: { orgId: "org-1", handle: null, platform: null, profileLinks: [], socialAccounts: [] },
  };
}

const POSTS = [
  post("ig-1", "INSTAGRAM", "https://www.instagram.com/reel/AAA1/"),
  post("ig-2", "INSTAGRAM", "https://www.instagram.com/reel/AAA2/"),
  post("ig-3", "INSTAGRAM", "https://www.instagram.com/reel/AAA3/"),
  post("yt-1", "YOUTUBE", "https://www.youtube.com/watch?v=abc123"),
];

const req = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { authorization: "Bearer secret" } });
const askedPlatforms = () => mockDb.post.findMany.mock.calls.map((c: any[]) => c[0]?.where?.platform).filter(Boolean);

const saved = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  mockDb.post.update.mockReset();
  deferred.mockReset().mockReturnValue(false);
  process.env.CRON_SECRET = "secret";
  delete process.env.SYNC_INSTAGRAM_HOURLY;
  delete process.env.SYNC_BUDGET_INSTAGRAM_HOURLY;
  mockDb.post.findMany.mockImplementation(async (args: any) => {
    const platform = args?.where?.platform;
    return platform ? POSTS.filter((p) => p.platform === platform) : POSTS;
  });
  mockDb.campaign.findMany.mockResolvedValue([{ id: "campaign-1", refreshActive: null, refreshInterval: null, lastRefreshAt: null }]);
  mockDb.campaign.updateMany.mockResolvedValue({ count: 1 });
  mockDb.organization.findMany.mockResolvedValue([{ id: "org-1", uiConfig: null }]);
  mockDb.post.update.mockResolvedValue({});
  mockFetch.mockImplementation(async (url: string) => ({
    platform: url.includes("instagram") ? "INSTAGRAM" : "YOUTUBE",
    platformPostId: "x",
    thumbnailUrl: null,
    caption: null,
  }));
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  (console.error as jest.Mock).mockRestore();
  process.env = { ...saved };
});

describe("the 6-hourly sweep", () => {
  it("leaves Instagram to the hourly pass", async () => {
    const res = await sixHourly(req("/api/cron/sync-posts"));
    expect(res.status).toBe(200);
    expect(askedPlatforms()).not.toContain("INSTAGRAM");
    expect(askedPlatforms()).toEqual(expect.arrayContaining(["YOUTUBE", "TIKTOK"]));
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual(["https://www.youtube.com/watch?v=abc123"]);
  });

  it("reads Instagram as before when the hourly pass is off", async () => {
    process.env.SYNC_INSTAGRAM_HOURLY = "off";
    await sixHourly(req("/api/cron/sync-posts"));
    expect(askedPlatforms()).toContain("INSTAGRAM");
    expect(mockFetch.mock.calls.map((c) => c[0])).toContain("https://www.instagram.com/reel/AAA1/");
  });
});

describe("the hourly Instagram pass", () => {
  it("reads Instagram only, within its own budget, below the post-sweep threshold", async () => {
    process.env.SYNC_BUDGET_INSTAGRAM_HOURLY = "2";
    const res = await hourlyInstagram(req("/api/cron/sync-instagram-posts"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect([...new Set(askedPlatforms())]).toEqual(["INSTAGRAM"]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.every((c) => String(c[0]).includes("instagram.com"))).toBe(true);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ instagramStopAtPercent: POST_SWEEP_STOP_PERCENT });
    expect(body.skippedForBudget).toBe(1);
  });

  it("leaves a post untouched, and still due, once Meta's usage passes the threshold", async () => {
    deferred.mockReturnValueOnce(false).mockReturnValue(true);
    const res = await hourlyInstagram(req("/api/cron/sync-instagram-posts?dryRun=1"));
    const body = await res.json();
    expect(body.decisions.map((d: any) => [d.postId, d.action, d.reason])).toEqual([
      ["ig-1", "sync", "never-read"],
      ["ig-2", "skip", "meta-usage"],
      ["ig-3", "skip", "meta-usage"],
    ]);
    expect(deferred).toHaveBeenCalledWith(POST_SWEEP_STOP_PERCENT);

    jest.clearAllMocks();
    deferred.mockReset().mockReturnValue(true);
    await hourlyInstagram(req("/api/cron/sync-instagram-posts"));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.post.update).not.toHaveBeenCalled();
  });

  it("reads nothing when switched off, and refuses a caller without the cron secret", async () => {
    process.env.SYNC_INSTAGRAM_HOURLY = "off";
    const off = await hourlyInstagram(req("/api/cron/sync-instagram-posts"));
    expect(await off.json()).toEqual({ ok: true, skipped: "off" });
    expect(mockDb.post.findMany).not.toHaveBeenCalled();

    const anon = await hourlyInstagram(new NextRequest("http://localhost/api/cron/sync-instagram-posts"));
    expect(anon.status).toBe(401);
  });
});
