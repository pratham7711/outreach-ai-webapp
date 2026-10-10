/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as cronSync } from "@/app/api/cron/sync-posts/route";

/* Instagram belongs to the hourly paced pass by default (lib/sync/instagramPacing).
   These tests are about the shared sweep through the 6-hourly route, reading
   every platform, which is what it does with that pass switched off. */
const realInstagramHourly = process.env.SYNC_INSTAGRAM_HOURLY;
beforeAll(() => {
  process.env.SYNC_INSTAGRAM_HOURLY = "off";
});
afterAll(() => {
  if (realInstagramHourly === undefined) delete process.env.SYNC_INSTAGRAM_HOURLY;
  else process.env.SYNC_INSTAGRAM_HOURLY = realInstagramHourly;
});

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
  fetchYouTubeMetrics: jest.fn(),
  fetchYouTubeMetricsBatch: jest.fn().mockResolvedValue(new Map()),
  fetchTikTokMetrics: jest.fn(),
  fetchInstagramMetrics: jest.fn(),
}));

/* The pool is a real Vercel Sandbox in production; here it is a handle whose
   lifecycle is the thing under test -- opened once per run, sized from the due
   TikTok count, handed to every TikTok fetch, closed in the finally. */
/* alertOps is the only thing in lib/alerts that reaches outward (it mails);
   shouldAlertOnBatch is the pure threshold the route composes with, so it stays
   real -- mocking it would make the alerting tests below assert the mock. */
jest.mock("@/lib/alerts", () => ({
  ...jest.requireActual("@/lib/alerts"),
  alertOps: jest.fn().mockResolvedValue(undefined),
}));

/* Real detection asks the database and Business Discovery; what this file
   checks is what the sweep does with its answer. */
jest.mock("@/lib/posts/detectCreator", () => ({ detectPostCreator: jest.fn().mockResolvedValue(null) }));

const mockPool = { size: 1, readPost: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
jest.mock("@/lib/platforms/tiktokPostSandbox", () => ({
  laneCountFor: jest.fn((n: number) => (n > 0 ? 1 : 0)),
  openSandboxPostPool: jest.fn(() => mockPool),
}));

import { db } from "@/lib/db";
import { alertOps } from "@/lib/alerts";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { openSandboxPostPool } from "@/lib/platforms/tiktokPostSandbox";
import { detectPostCreator } from "@/lib/posts/detectCreator";

const mockDb = db as any;

/* The sweep asks for candidates one platform at a time, so the mock answers
   each query with that platform's posts rather than all of them every time. */
function mockPostCandidates(posts: any[]) {
  mockDb.post.findMany.mockImplementation(async (args: any) => {
    const platform = args?.where?.platform;
    return platform ? posts.filter((p) => p.platform === platform) : posts;
  });
}
const mockFetch = fetchPostMetrics as jest.Mock;
const mockAlert = alertOps as jest.Mock;

const HOUR_MS = 60 * 60 * 1000;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * HOUR_MS);
}

/**
 * Instagram, deliberately -- and it does not matter which platform it is.
 *
 * Every test in this file is about platform-agnostic machinery: retry
 * accounting, sealing, per-platform budgets, dry-run reporting. These fixtures
 * were TikTok only because TikTok was the first platform to exist here, and
 * that became load-bearing the moment the cron started skipping TikTok
 * outright (it then had no sandbox, so those reads were ~75% doomed) -- every
 * test below went green-on-nothing, asserting behaviour that no longer ran.
 *
 * TikTok's sandbox lane has its own tests, `cron sync -- TikTok` below. Do not
 * flip these back to TIKTOK to "cover" it.
 */
function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    campaignId: "campaign-1",
    platform: "INSTAGRAM",
    postUrl: "https://www.instagram.com/reel/AAA1/",
    /* Past its first month, on a campaign that has finished (no `campaign`
       here reads as not live): read only because it is tracked, which is the
       machinery these tests are about. A younger post is read on the strength
       of its age as well -- see "automatic coverage" below. */
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
    /* The cron selects post TRACKERS now, not posts belonging to a due campaign.
       A fixture without these is skipped as "not-tracked" before any of the
       machinery under test runs, so they are part of the baseline rather than
       something an individual test opts into. A 30-day window starting an hour
       ago is the ordinary case: live, and nowhere near expiry. */
    trackingEnabled: true,
    trackingStartedAt: hoursAgo(1),
    trackingTtlDays: 30,
    trackingExpiresAt: new Date(Date.now() + 29 * 24 * HOUR_MS),
    creator: { orgId: "org-1", handle: null, platform: null, profileLinks: [], socialAccounts: [] },
    ...overrides,
  };
}

function cronReq(url = "http://localhost/api/cron/sync-posts") {
  return new NextRequest(url, { headers: { authorization: "Bearer secret" } });
}

const realSecret = process.env.CRON_SECRET;
const realInstagramBudget = process.env.SYNC_BUDGET_INSTAGRAM;

beforeEach(() => {
  jest.clearAllMocks();
  /* clearAllMocks keeps queued *Once implementations; one a test never
     consumed would otherwise fire in whichever test runs next. */
  mockDb.post.update.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env.CRON_SECRET = "secret";
  /* Campaigns no longer gate the sweep -- post trackers do -- but the route
     still stamps Campaign.lastRefreshAt for the campaign header, so the mock
     stays. */
  mockDb.campaign.findMany.mockResolvedValue([
    { id: "campaign-1", refreshActive: null, refreshInterval: null, lastRefreshAt: null },
  ]);
  mockDb.campaign.updateMany.mockResolvedValue({ count: 1 });
  /* Read cadence and default TTL are per organisation. An org that has stored
     nothing gets DEFAULT_POST_TRACKING, which is what a null uiConfig means. */
  mockDb.organization.findMany.mockResolvedValue([{ id: "org-1", uiConfig: null }]);
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
  if (realSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = realSecret;
  if (realInstagramBudget === undefined) delete process.env.SYNC_BUDGET_INSTAGRAM;
  else process.env.SYNC_BUDGET_INSTAGRAM = realInstagramBudget;
});

describe("cron sync hardening — dry run", () => {
  it("performs no fetches or writes and returns per-post decisions with a summary", async () => {
    /* One fixture per branch of decidePostTracking. "old" is a post whose
       TRACKER expired; the fixture is past its first month on a finished
       campaign, so nothing else still covers it and the tracker seals. */
    mockPostCandidates([
      makePost({ id: "fresh" }),
      makePost({ id: "old", trackingExpiresAt: hoursAgo(1) }),
      makePost({ id: "disabled", syncDisabledAt: hoursAgo(2) }),
      makePost({ id: "done", snapshots: [{ id: "snap-final" }] }),
      makePost({ id: "cadence", lastSyncedAt: hoursAgo(1) }),
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
      { postId: "fresh", platform: "INSTAGRAM", action: "sync", reason: "never-read" },
      { postId: "old", platform: "INSTAGRAM", action: "seal", reason: "ttl-expired" },
      { postId: "disabled", platform: "INSTAGRAM", action: "skip", reason: "dead-letter" },
      { postId: "done", platform: "INSTAGRAM", action: "skip", reason: "sealed" },
      {
        postId: "cadence",
        platform: "INSTAGRAM",
        action: "skip",
        reason: "cadence-throttle-12hourly",
      },
    ]);
    expect(body.summary.byAction).toEqual({ sync: 1, seal: 1, skip: 3 });
    expect(body.summary.byReason).toEqual({
      "never-read": 1,
      "ttl-expired": 1,
      "dead-letter": 1,
      sealed: 1,
      "cadence-throttle-12hourly": 1,
    });
  });
});

describe("cron sync hardening — dead-letter", () => {
  /**
   * A throw is ours, not the post's.
   *
   * This used to assert the opposite -- five thrown errors dead-lettered the
   * post -- which is the bug: the throw path bypassed UNCHARGEABLE_REASONS
   * entirely, so five transient DB or token blips switched off a healthy post
   * for good and nothing in this codebase ever clears syncDisabledAt again.
   */
  it("does not charge a thrown error to the post, and leaves it eligible", async () => {
    mockPostCandidates([
      makePost({ id: "p-low", syncFailCount: 0 }),
      makePost({ id: "p-edge", postUrl: "https://www.instagram.com/reel/AAA2/", syncFailCount: 4 }),
    ]);
    mockFetch.mockRejectedValue(new Error("platform down"));
    mockDb.post.update.mockResolvedValue({});

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    // Still reported: uncharged is not unrecorded.
    expect(body.failed).toBe(2);
    expect(body.deadLettered).toBe(0);
    expect(body.synced).toBe(0);

    const touched = mockDb.post.update.mock.calls
      .map((c: any[]) => c[0])
      .filter(
        (u: any) => u.data?.syncFailCount !== undefined || u.data?.syncDisabledAt !== undefined,
      );
    expect(touched).toEqual([]);
  });

  it("skips a dead-lettered post without fetching", async () => {
    mockPostCandidates([
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
    mockPostCandidates([makePost({ id: "p-recover", syncFailCount: 3 })]);
    mockFetch.mockResolvedValue({
      platform: "INSTAGRAM",
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
    /* Found by content, not by position. applyPostMetrics writes the counters
       in its own post.update, so the streak reset is no longer the first call
       -- and indexing [0] made this assert on the metrics write, where
       syncFailCount is simply absent. */
    const resetArg = mockDb.post.update.mock.calls
      .map((call: any[]) => call[0])
      .find((arg: any) => arg.data?.syncFailCount !== undefined);
    expect(resetArg.where.id).toBe("p-recover");
    expect(resetArg.data.syncFailCount).toBe(0);
  });

  /**
   * syncFailCount exists to stop us asking a post the platform will never
   * answer for. Our own reader being down is not that, and charging it to the
   * post would walk a healthy one to MAX_SYNC_FAILURES and set syncDisabledAt
   * -- taking it out of the queue for good, silently.
   *
   * Defensive today: the cron opens no sandbox, so "reader-unavailable" cannot
   * arise on this path yet. It is here so that giving the cron a sandbox later
   * cannot quietly start dead-lettering good posts.
   */
  it("does not spend a post's retry budget when our own reader was what failed", async () => {
    mockPostCandidates([
      makePost({ id: "p-ours", syncFailCount: 4 }), // one away from dead-letter
    ]);
    mockFetch.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "1",
      thumbnailUrl: null,
      caption: null,
      fetchReason: "reader-unavailable",
      postedAt: new Date(),
    });
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(body.deadLettered).toBe(0);
    const charged = mockDb.post.update.mock.calls
      .map((call: any[]) => call[0])
      .find((arg: any) => arg.data?.syncFailCount !== undefined);
    expect(charged).toBeUndefined();
    expect(
      mockDb.post.update.mock.calls
        .map((call: any[]) => call[0])
        .find((arg: any) => arg.data?.syncDisabledAt !== undefined)
    ).toBeUndefined();
  });

  /**
   * The control for the test above: something that IS about the post must still
   * count, or the backoff that stops us hammering a dead post is gone.
   *
   * This used to use "platform-challenged" and that was the bug. A WAF
   * challenge to our datacenter egress says nothing whatsoever about the post
   * -- the same URL loads fine from a browser -- yet it walked healthy posts to
   * syncDisabledAt in five hourly runs. "no-counts-published" is the real
   * control: the platform answered, about this post, and published no numbers.
   */
  it("still spends the budget when the post is what has nothing to report", async () => {
    mockPostCandidates([makePost({ id: "p-theirs", syncFailCount: 4 })]);
    mockFetch.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "1",
      thumbnailUrl: null,
      caption: null,
      fetchReason: "no-counts-published",
      postedAt: new Date(),
    });
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(body.deadLettered).toBe(1);
    const charged = mockDb.post.update.mock.calls
      .map((call: any[]) => call[0])
      .find((arg: any) => arg.data?.syncFailCount !== undefined);
    expect(charged.data.syncFailCount).toBe(5);
    expect(charged.data.syncDisabledAt).toBeInstanceOf(Date);
  });
});

describe("cron sync hardening — sealing", () => {
  it("seals an expired tracker from stored counts without a platform fetch", async () => {
    mockPostCandidates([
      makePost({
        id: "p-old",
        trackingExpiresAt: hoursAgo(1),
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
      syncSource: "cron-seal-ttl",
    });

    /* The fixture has lastSyncedAt: null -- never measured -- so the seal must
       not stamp it. lastSyncedAt is the sole "was this ever measured" flag
       (lib/metricDisplay), and stamping it here turned the post's default-zero
       counters into measured zeros on the Posts tab, the report and the PDF.

       The update itself is no longer optional: a seal always switches
       trackingEnabled off, because the tracker is over and the UI reads that
       flag to decide between Untrack and Track. So the assertion is on the
       absence of the FIELD, not the absence of the call. */
    const updateArg = mockDb.post.update.mock.calls[0][0];
    expect(updateArg.data.trackingEnabled).toBe(false);
    expect(updateArg.data).not.toHaveProperty("lastSyncedAt");
    const txArg = mockDb.$transaction.mock.calls[0][0];
    expect(txArg).toHaveLength(2);
  });

  it("never moves lastSyncedAt: a seal reads nothing, so its counters are as old as the last read", async () => {
    mockPostCandidates([
      makePost({
        id: "p-measured",
        trackingExpiresAt: hoursAgo(1),
        lastSyncedAt: hoursAgo(40 * 24),
        platformMetrics: { __measured: ["views", "likes", "comments"] },
      }),
    ]);
    mockDb.$transaction.mockResolvedValue([{}, {}]);
    mockDb.post.update.mockResolvedValue({});

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(body.sealed).toBe(1);
    const updateArg = mockDb.post.update.mock.calls[0][0];
    expect(updateArg.where.id).toBe("p-measured");
    expect(updateArg.data).not.toHaveProperty("lastSyncedAt");
    // The final row says which of its counters were real.
    const snapArg = mockDb.postMetricSnapshot.create.mock.calls[0][0];
    expect(snapArg.data.platformMetrics).toEqual({ __measured: ["views", "likes", "comments"] });
  });

  it("seals saves and downloads too, and marks a never-read post's zeros unknown", async () => {
    mockPostCandidates([
      makePost({
        id: "p-imported",
        trackingExpiresAt: hoursAgo(1),
        viewsCount: 900,
        savesCount: 12,
        downloadsCount: 4,
      }),
    ]);
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    await cronSync(cronReq());

    const snapArg = mockDb.postMetricSnapshot.create.mock.calls[0][0];
    expect(snapArg.data).toMatchObject({ viewsCount: 900, savesCount: 12, downloadsCount: 4 });
    expect(snapArg.data.platformMetrics).toEqual({ __measured: [] });
  });

  it("is idempotent — skips when a final snapshot already exists", async () => {
    mockPostCandidates([
      makePost({ id: "p-done", trackingExpiresAt: hoursAgo(1), snapshots: [{ id: "snap-1" }] }),
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
    process.env.SYNC_BUDGET_INSTAGRAM = "1";
    mockPostCandidates([
      makePost({ id: "ig-1" }),
      makePost({ id: "ig-2", postUrl: "https://www.instagram.com/reel/AAA2/" }),
      makePost({
        id: "y-1",
        platform: "YOUTUBE",
        postUrl: "https://www.youtube.com/watch?v=abc123",
      }),
    ]);
    mockFetch.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "1",
      thumbnailUrl: null,
      caption: null,
      postedAt: new Date(),
    });
    mockDb.post.update.mockResolvedValue({});

    const res = await cronSync(cronReq());
    const body = await res.json();

    const fetchedUrls = mockFetch.mock.calls.map((call) => call[0]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(fetchedUrls).toContain("https://www.instagram.com/reel/AAA1/");
    expect(fetchedUrls).toContain("https://www.youtube.com/watch?v=abc123");
    expect(fetchedUrls).not.toContain("https://www.instagram.com/reel/AAA2/");
    expect(body.skippedForBudget).toBe(1);
    /* The budget is what this test is about, and the two assertions above are
       it. These two only pin down where the fetched posts landed: the mock
       returns no counters, so both are noCounts rather than synced. */
    expect(body.synced).toBe(0);
    expect(body.noCounts).toBe(2);
  });

  it("reports budget skips in dry-run decisions", async () => {
    process.env.SYNC_BUDGET_INSTAGRAM = "1";
    mockPostCandidates([
      makePost({ id: "ig-1" }),
      makePost({ id: "ig-2", postUrl: "https://www.instagram.com/reel/AAA2/" }),
    ]);

    const res = await cronSync(cronReq("http://localhost/api/cron/sync-posts?dryRun=1"));
    const body = await res.json();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.post.update).not.toHaveBeenCalled();
    expect(body.decisions).toEqual([
      { postId: "ig-1", platform: "INSTAGRAM", action: "sync", reason: "never-read" },
      { postId: "ig-2", platform: "INSTAGRAM", action: "skip", reason: "budget" },
    ]);
    expect(body.summary.byReason.budget).toBe(1);
  });
});

/**
 * The cron reads TikTok through a sandbox pool. This is the test for that
 * decision -- and for the one it reversed.
 *
 * TikTok answers a datacenter IP with a WAF shell roughly three times in four,
 * so the only way to read it reliably is a Vercel Sandbox. This route used to
 * open none and skip every TikTok post ("tiktok-needs-sandbox") to keep the bill
 * flat, on an estimate made before the campaign cadence filter existed. With
 * the filter, prod had 13 due TikTok posts an hour and skipped all 13 -- so
 * 15,403 live TikTok posts moved only when someone pressed Refresh. The pool
 * here is bounded twice (lanes by SYNC_CRON_TIKTOK_MAX_LANES, reads by
 * SYNC_BUDGET_TIKTOK) and boots lazily, so a run with no due TikTok post still
 * creates no sandbox.
 */
describe("cron sync — TikTok", () => {
  const tiktokPost = (overrides: Record<string, unknown> = {}) =>
    makePost({
      platform: "TIKTOK",
      postUrl: "https://www.tiktok.com/@u/video/1",
      ...overrides,
    });
  const mockOpen = openSandboxPostPool as jest.Mock;

  beforeEach(() => {
    mockOpen.mockClear();
    mockPool.close.mockClear();
  });

  it("opens one pool for the run, reads TikTok through it, and closes it", async () => {
    mockPostCandidates([tiktokPost({ id: "tt-1" }), tiktokPost({ id: "tt-2" })]);
    mockFetch.mockResolvedValue(undefined);

    const res = await cronSync(cronReq());
    expect(res.status).toBe(200);

    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    for (const call of mockFetch.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ tiktokSandbox: mockPool, countsOnly: true }));
    }
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it("opens no sandbox when no TikTok post is due", async () => {
    mockPostCandidates([makePost({ id: "ig-1" })]);
    mockFetch.mockResolvedValue(undefined);

    await cronSync(cronReq());

    expect(mockOpen).not.toHaveBeenCalled();
    /* The Instagram read must not be told about a pool that does not exist. */
    expect(mockFetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({ tiktokSandbox: undefined, countsOnly: false }),
    );
  });

  it("opens no sandbox on a dry run, which reads nothing", async () => {
    mockPostCandidates([tiktokPost({ id: "tt-1" })]);

    const res = await cronSync(cronReq("http://localhost/api/cron/sync-posts?dryRun=1"));
    const body = await res.json();

    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(body.decisions).toEqual([
      { postId: "tt-1", platform: "TIKTOK", action: "sync", reason: "never-read" },
    ]);
  });

  it("closes the pool even when the run crashes", async () => {
    mockPostCandidates([tiktokPost({ id: "tt-1" })]);
    mockFetch.mockRejectedValue(new Error("lane died"));
    // The per-post catch records the failure; make that write blow up too so
    // the run's own catch is reached.
    mockDb.post.update.mockRejectedValueOnce(new Error("db down"));

    const res = await cronSync(cronReq());
    expect([200, 500]).toContain(res.status);
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it("still sweeps the other platforms in the same run", async () => {
    mockPostCandidates([
      tiktokPost({ id: "tt-1" }),
      makePost({ id: "ig-1" }),
    ]);
    mockFetch.mockImplementation(async (url: string) =>
      url.includes("instagram.com")
        ? {
            platform: "INSTAGRAM",
            platformPostId: "1",
            thumbnailUrl: null,
            caption: null,
            viewsCount: 500,
            likesCount: 5,
            commentsCount: 1,
            sharesCount: 0,
            engagementRate: 1.2,
            postedAt: new Date(),
          }
        : undefined,
    );
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(["https://www.instagram.com/reel/AAA1/", "https://www.tiktok.com/@u/video/1"]),
    );
    expect(body.synced).toBe(1);
  });
});

/**
 * The reads run side by side now, one queue per platform. The loop this
 * replaced read one post at a time across all three, and on production it ended
 * at the four-minute deadline every run (243.6s on 2026-10-02 18:00) having
 * measured 30-45 TikTok posts, while the pool's second lane sat idle.
 *
 * What these pin is what concurrency must not change: the pool is never asked
 * for more reads at once than it has lanes, a budget is spent exactly however
 * many reads are in flight, and a post the deadline cut off is still counted.
 */
describe("cron sync — concurrent reads", () => {
  const tiktokPost = (id: string) =>
    makePost({ id, platform: "TIKTOK", postUrl: `https://www.tiktok.com/@u/video/${id}` });
  const realTikTokBudget = process.env.SYNC_BUDGET_TIKTOK;
  let clockSpy: jest.SpyInstance | undefined;

  /* A read that takes a tick, and a count of how many were open at once. */
  function trackInFlight() {
    const seen = { now: 0, max: 0 };
    mockFetch.mockImplementation(async () => {
      seen.now++;
      seen.max = Math.max(seen.max, seen.now);
      await new Promise((r) => setTimeout(r, 5));
      seen.now--;
      return undefined;
    });
    return seen;
  }

  beforeEach(() => {
    mockPool.size = 3;
    mockDb.post.update.mockResolvedValue({});
  });

  afterEach(() => {
    mockPool.size = 1;
    if (realTikTokBudget === undefined) delete process.env.SYNC_BUDGET_TIKTOK;
    else process.env.SYNC_BUDGET_TIKTOK = realTikTokBudget;
    clockSpy?.mockRestore();
    clockSpy = undefined;
  });

  it("keeps one TikTok read in flight per lane, and no more", async () => {
    mockPostCandidates(["a", "b", "c", "d", "e", "f", "g"].map(tiktokPost));
    const inFlight = trackInFlight();

    const res = await cronSync(cronReq());
    expect(res.status).toBe(200);

    expect(mockFetch).toHaveBeenCalledTimes(7);
    expect(inFlight.max).toBe(3);
  });

  it("reads the platforms at the same time rather than one after another", async () => {
    mockPostCandidates([tiktokPost("tt-1"), makePost({ id: "ig-1" })]);
    const inFlight = trackInFlight();

    await cronSync(cronReq());

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(inFlight.max).toBe(2);
  });

  it("spends a platform's budget exactly, however many reads are in flight", async () => {
    process.env.SYNC_BUDGET_TIKTOK = "2";
    mockPostCandidates(["a", "b", "c", "d", "e"].map(tiktokPost));
    trackInFlight();

    const body = await (await cronSync(cronReq())).json();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(body.skippedForBudget).toBe(3);
    expect(body.skippedByReason).toEqual({ budget: 3 });
  });

  it("counts every post a platform had not reached by the deadline", async () => {
    mockPostCandidates(["a", "b", "c", "d", "e"].map(tiktokPost));
    /* The first read takes five minutes, as far as the route can tell. */
    const start = Date.now();
    let clock = start;
    clockSpy = jest.spyOn(Date, "now").mockImplementation(() => clock);
    mockFetch.mockImplementation(async () => {
      clock = start + 5 * 60 * 1000;
      return undefined;
    });

    const body = await (await cronSync(cronReq())).json();

    /* Three lanes claimed a, b and c before the clock moved; d and e were
       never claimed. */
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(body.skippedForBudget).toBe(2);
  });
});

/**
 * Which campaigns the cron sweeps at all.
 *
 * Campaign.refreshInterval / refreshActive / lastRefreshAt were migrated from
 * CreatorCore onto all 506 campaigns and then read by nothing -- the cron swept
 * every post of every live campaign, every hour, regardless. Honouring them is
 * the largest single cost saving here: most campaigns are not due in a given
 * hour, and a campaign that is not due costs zero function seconds and zero
 * Neon reads instead of a full sweep.
 */
describe("cron sync — post tracker selection", () => {
  /**
   * The gate this block used to guard is gone.
   *
   * It asserted that only campaigns due on `Campaign.refreshInterval` had their
   * posts read, and that CreatorCore's 9999 sentinel meant "off". Both were
   * faithfully implemented and both were the wrong question: that sentinel
   * arrived with the import on 497 of ~500 campaigns (measured prod 2026-09-08),
   * so the gate reduced an hourly sweep of 18,787 live posts to 17. What decides
   * now is the post tracker -- on, unexpired, due on the org's read cadence.
   */
  /* The tiers themselves are tested without a database in
     __tests__/unit/lib/sweepTiers.test.ts; this is that the route asks them. */
  it("asks each platform in tier order, never for a sealed, dead or deleted campaign's post", async () => {
    mockPostCandidates([]);

    await cronSync(cronReq());

    const instagram = mockDb.post.findMany.mock.calls
      .map((c: any[]) => c[0])
      .filter((a: any) => a.where.platform === "INSTAGRAM");
    /* Seal first, on its own take; then the read tiers, each asked for what
       the ones above left -- all of it, here, since they returned nothing. */
    expect(instagram.map((a: any) => a.take)).toEqual([600, 300, 300, 300, 300]);
    for (const { where } of instagram) {
      expect(where.syncDisabledAt).toBeNull();
      expect(where.snapshots).toEqual({ none: { isFinalSnapshot: true } });
      const campaigns = where.campaign ? [where.campaign] : where.OR.map((o: any) => o.campaign);
      for (const c of campaigns) expect(c.deletedAt).toBeNull();
    }
    expect(instagram[0].where.trackingEnabled).toBe(true);
    /* The first 72 hours, whatever the campaign; then the running campaigns. */
    expect(instagram[1].where.campaign).toEqual({ deletedAt: null });
    expect(instagram[2].where.campaign.status).toEqual({ in: ["IN_PROGRESS", "PENDING"] });
  });

  it("splits on whether the campaign is running, never on refreshActive or refreshInterval", async () => {
    mockPostCandidates([]);

    await cronSync(cronReq());

    for (const [args] of mockDb.post.findMany.mock.calls) {
      const where = args.where;
      expect(where).not.toHaveProperty("campaignId");
      const campaigns = where.campaign ? [where.campaign] : where.OR.map((o: any) => o.campaign);
      for (const c of campaigns) {
        expect(c).not.toHaveProperty("refreshActive");
        expect(c).not.toHaveProperty("refreshInterval");
      }
    }
  });

  it("returns expired trackers from the query so they can seal, rather than filtering them out", async () => {
    mockPostCandidates([]);

    await cronSync(cronReq());

    /* An expired tracker still has one job -- to seal -- and it can only do it
       if the query returns it. It is returned at most once, because sealing
       writes the isFinalSnapshot row that the filter above excludes. */
    const where = mockDb.post.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("trackingExpiresAt");
  });

  it("reads each org's cadence once, not once per post", async () => {
    mockPostCandidates([
      makePost({ id: "a" }),
      makePost({ id: "b" }),
      makePost({ id: "c", creator: { orgId: "org-2", handle: null, platform: null, profileLinks: [], socialAccounts: [] } }),
    ]);
    mockDb.organization.findMany.mockResolvedValue([
      { id: "org-1", uiConfig: null },
      { id: "org-2", uiConfig: null },
    ]);
    mockFetch.mockResolvedValue(null);

    await cronSync(cronReq());

    expect(mockDb.organization.findMany).toHaveBeenCalledTimes(1);
    const where = mockDb.organization.findMany.mock.calls[0][0].where;
    expect(where.id.in.sort()).toEqual(["org-1", "org-2"]);
  });

  it("honours a slower read cadence stored on the org", async () => {
    // Read 3h ago; a daily org is not due, a 2-hourly org is.
    mockPostCandidates([
      makePost({ id: "p-1", lastSyncedAt: hoursAgo(3) }),
    ]);
    mockDb.organization.findMany.mockResolvedValue([
      { id: "org-1", uiConfig: { postTracking: { readCadence: "daily" } } },
    ]);

    const res = await cronSync(cronReq("http://localhost/api/cron/sync-posts?dryRun=1"));
    const body = await res.json();

    expect(body.decisions).toEqual([
      { postId: "p-1", platform: "INSTAGRAM", action: "skip", reason: "cadence-throttle-daily" },
    ]);
  });

  it("reads a year-old post whose tracker is still live, until it has a reading of its own", async () => {
    mockPostCandidates([
      makePost({ id: "ancient", postedAt: hoursAgo(400 * 24), lastSyncedAt: hoursAgo(13) }),
    ]);

    const res = await cronSync(cronReq("http://localhost/api/cron/sync-posts?dryRun=1"));
    const body = await res.json();

    // Last read before the tracker started an hour ago: one more reading is owed.
    expect(body.decisions[0].action).toBe("sync");
  });
});

describe("cron sync — automatic coverage", () => {
  const COMPLETE = { status: "COMPLETE", archived: false, deletedAt: null };
  const RUNNING = { status: "IN_PROGRESS", archived: false, deletedAt: null };
  const untracked = { trackingEnabled: false, trackingStartedAt: null, trackingTtlDays: null, trackingExpiresAt: null };

  it("reads a new post on a COMPLETE campaign with no tracker", async () => {
    /* Measured 2026-10-03: a COMPLETE campaign of 121 Instagram posts, the
       newest posted that day, none tracked. */
    mockPostCandidates([makePost({ id: "today", postedAt: hoursAgo(5), campaign: COMPLETE, ...untracked })]);

    const body = await (await cronSync(cronReq("http://localhost/api/cron/sync-posts?dryRun=1"))).json();
    expect(body.decisions).toEqual([{ postId: "today", platform: "INSTAGRAM", action: "sync", reason: "never-read" }]);
  });

  it("reads a running campaign's post with no tracker, at the org cadence", async () => {
    mockPostCandidates([
      makePost({ id: "due", postedAt: hoursAgo(60 * 24), lastSyncedAt: hoursAgo(13), campaign: RUNNING, ...untracked }),
      makePost({ id: "not-yet", postedAt: hoursAgo(60 * 24), lastSyncedAt: hoursAgo(7), campaign: RUNNING, ...untracked }),
    ]);

    const body = await (await cronSync(cronReq("http://localhost/api/cron/sync-posts?dryRun=1"))).json();
    expect(body.decisions).toEqual([
      { postId: "due", platform: "INSTAGRAM", action: "sync", reason: "cadence-campaign-12hourly" },
      { postId: "not-yet", platform: "INSTAGRAM", action: "skip", reason: "cadence-throttle-campaign-12hourly" },
    ]);
  });

  it("does not read a post someone stopped, however new", async () => {
    mockPostCandidates([
      makePost({ id: "stopped", postedAt: hoursAgo(5), campaign: RUNNING, ...untracked, trackingExpiresAt: hoursAgo(1) }),
    ]);

    const body = await (await cronSync(cronReq("http://localhost/api/cron/sync-posts?dryRun=1"))).json();
    expect(body.decisions).toEqual([{ postId: "stopped", platform: "INSTAGRAM", action: "skip", reason: "stopped" }]);
  });

  it("seals an old post's tracker on its reading, under a source the TTL unseal repair does not match", async () => {
    mockPostCandidates([
      makePost({
        id: "ancient",
        postedAt: hoursAgo(400 * 24),
        campaign: COMPLETE,
        trackingStartedAt: hoursAgo(18 * 24),
        lastSyncedAt: hoursAgo(2 * 24),
      }),
    ]);
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    const body = await (await cronSync(cronReq())).json();

    expect(body.sealed).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.postMetricSnapshot.create.mock.calls[0][0].data).toMatchObject({
      postId: "ancient",
      isFinalSnapshot: true,
      syncSource: "cron-seal-age",
    });
  });

  it("reports how many candidates each tier contributed", async () => {
    mockPostCandidates([]);
    const body = await (await cronSync(cronReq())).json();
    expect(body.candidatesByTier.INSTAGRAM).toEqual({
      seal: 0,
      "live-campaign": 0,
      "first-72h": 0,
      "first-30d": 0,
      backlog: 0,
    });
  });
});

describe("cron sync — campaign lastRefreshAt", () => {
  it("stamps lastRefreshAt only on the campaigns it actually measured", async () => {
    mockDb.campaign.findMany.mockResolvedValue([
      { id: "campaign-1", refreshActive: true, refreshInterval: 1, lastRefreshAt: hoursAgo(4) },
      { id: "campaign-2", refreshActive: true, refreshInterval: 1, lastRefreshAt: hoursAgo(4) },
    ]);
    // Due, but only campaign-1 has a post in this run.
    mockPostCandidates([makePost({ id: "ig-1", campaignId: "campaign-1" })]);
    mockFetch.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "1",
      thumbnailUrl: null,
      caption: null,
      viewsCount: 7,
      likesCount: 1,
      commentsCount: 0,
      sharesCount: 0,
      engagementRate: 1,
      postedAt: new Date(),
    });
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    await cronSync(cronReq());

    expect(mockDb.campaign.updateMany).toHaveBeenCalledTimes(1);
    const arg = mockDb.campaign.updateMany.mock.calls[0][0];
    expect(arg.where.id.in).toEqual(["campaign-1"]);
    expect(arg.data.lastRefreshAt).toBeInstanceOf(Date);
  });

  it("does not stamp a campaign whose posts were asked but none measured", async () => {
    mockDb.campaign.findMany.mockResolvedValue([
      { id: "campaign-1", refreshActive: true, refreshInterval: 1, lastRefreshAt: hoursAgo(4) },
      { id: "campaign-2", refreshActive: true, refreshInterval: 1, lastRefreshAt: hoursAgo(4) },
    ]);
    mockPostCandidates([
      makePost({ id: "ig-1", campaignId: "campaign-1", postUrl: "https://www.instagram.com/reel/A1/" }),
      makePost({ id: "ig-2", campaignId: "campaign-2", postUrl: "https://www.instagram.com/reel/A2/" }),
    ]);
    const counts = {
      platform: "INSTAGRAM",
      platformPostId: "1",
      thumbnailUrl: null,
      caption: null,
      viewsCount: 7,
      likesCount: 1,
      commentsCount: 0,
      sharesCount: 0,
      engagementRate: 1,
      postedAt: new Date(),
    };
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("A1")) return counts;
      throw new Error("lane died");
    });
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    await cronSync(cronReq());

    expect(mockDb.campaign.updateMany).toHaveBeenCalledTimes(1);
    expect(mockDb.campaign.updateMany.mock.calls[0][0].where.id.in).toEqual(["campaign-1"]);
  });

  it("stamps nothing when every read failed", async () => {
    mockDb.campaign.findMany.mockResolvedValue([
      { id: "campaign-1", refreshActive: true, refreshInterval: 1, lastRefreshAt: hoursAgo(4) },
    ]);
    mockPostCandidates([makePost({ id: "ig-1", campaignId: "campaign-1" })]);
    mockFetch.mockRejectedValue(new Error("lane died"));

    await cronSync(cronReq());

    expect(mockDb.campaign.updateMany).not.toHaveBeenCalled();
  });

  it("stamps nothing when there was nothing to sweep", async () => {
    mockDb.campaign.findMany.mockResolvedValue([
      { id: "campaign-1", refreshActive: true, refreshInterval: 1, lastRefreshAt: hoursAgo(4) },
    ]);
    mockPostCandidates([]);

    await cronSync(cronReq());

    expect(mockDb.campaign.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * Reasons that are about us, not about the post.
 *
 * Each of these used to spend a strike against syncFailCount, and five strikes
 * sets syncDisabledAt -- which removes the post from this route's own query and
 * is never written back to null by anything, including a successful on-demand
 * refresh. A WAF challenge to our egress, our own gate, a dead sandbox lane, a
 * lapsed token and a missing API key were all one bad afternoon away from
 * permanently switching off a perfectly healthy post.
 */
/**
 * Total lockout is the loudest outage and used to be the quietest alert.
 *
 * shouldAlertOnBatch was fed `failed`, which only the throw path increments. A
 * platform answering every post with a WAF challenge produces clean no-counts
 * outcomes, so a run that measured nothing at all reported failed:0 and mailed
 * nobody.
 */
describe("cron sync — alerting on a run that measured nothing", () => {
  function challengedPosts(n: number) {
    return Array.from({ length: n }, (_, i) =>
      makePost({ id: `p-${i}`, postUrl: `https://www.instagram.com/reel/A${i}/` }),
    );
  }

  it("alerts when every attempt came back with no counts, though nothing threw", async () => {
    mockPostCandidates(challengedPosts(6));
    mockFetch.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "1",
      thumbnailUrl: null,
      caption: null,
      fetchReason: "platform-challenged",
      postedAt: new Date(),
    });
    mockDb.post.update.mockResolvedValue({});

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(body.synced).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.noCounts).toBe(6);

    expect(mockAlert).toHaveBeenCalledTimes(1);
    const alert = mockAlert.mock.calls[0][0];
    expect(alert.source).toBe("cron/sync-posts");
    expect(alert.severity).toBe("critical");
    expect(alert.facts).toMatchObject({ noCounts: 6, attempted: 6, synced: 0 });
  });

  it("stays quiet when the same run mostly measured", async () => {
    mockPostCandidates(challengedPosts(6));
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("A0/")
          ? {
              platform: "INSTAGRAM",
              platformPostId: "1",
              thumbnailUrl: null,
              caption: null,
              fetchReason: "platform-challenged",
              postedAt: new Date(),
            }
          : {
              platform: "INSTAGRAM",
              platformPostId: "1",
              thumbnailUrl: null,
              caption: null,
              viewsCount: 10,
              likesCount: 1,
              commentsCount: 0,
              postedAt: new Date(),
            },
      ),
    );
    mockDb.post.update.mockResolvedValue({});
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(body.synced).toBe(5);
    expect(body.noCounts).toBe(1);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  /* An answer about the post is not a failure to read it. Counted as one, 54
     deletions paged at 80% on 2026-09-24, and ~40 Instagram posts that no longer
     exist kept every run between 46% and 53% for the week after -- while the
     readers were healthy. */
  function answeredWith(reason: string) {
    return {
      platform: "INSTAGRAM",
      platformPostId: "1",
      thumbnailUrl: null,
      caption: null,
      fetchReason: reason,
      postedAt: new Date(),
    };
  }

  it.each([
    "post-deleted", "not-a-professional-account", "no-counts-published", "unrecognised-url", "post-hidden",
    "not-on-account", "not-in-newest-media", "counts-inconsistent",
  ])(
    "sends nothing when every post answered %s",
    async (reason) => {
      mockPostCandidates(challengedPosts(6));
      mockFetch.mockResolvedValue(answeredWith(reason));
      mockDb.post.update.mockResolvedValue({});

      const body = await (await cronSync(cronReq())).json();

      expect(body.noCounts).toBe(6);
      /* Not even the dead-letter notice: a post the platform said is gone
         dead-letters once and carries its pill, and six of those were the whole
         of the mail on 2026-09-30. */
      expect(mockAlert).not.toHaveBeenCalled();
    },
  );

  it("mails about posts stopped after five reads nobody explained", async () => {
    mockPostCandidates(
      challengedPosts(3).map((p, i) => ({ ...p, syncFailCount: i === 0 ? 0 : 4 })),
    );
    mockFetch.mockResolvedValue(answeredWith("no-counts-published"));
    mockDb.post.update.mockResolvedValue({});

    const body = await (await cronSync(cronReq())).json();

    expect(body.deadLettered).toBe(2);
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const alert = mockAlert.mock.calls[0][0];
    expect(alert.title).toBe("2 post(s) stopped syncing after 5 reads with no numbers");
    expect(alert.facts).toMatchObject({ unexplained: 2, byReason: { "no-counts-published": 2 } });
  });

  it("leaves settled dead letters out of that mail's count", async () => {
    mockPostCandidates(
      challengedPosts(3).map((p) => ({ ...p, syncFailCount: 4 })),
    );
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(answeredWith(url.endsWith("A0/") ? "no-counts-published" : "post-deleted")),
    );
    mockDb.post.update.mockResolvedValue({});

    const body = await (await cronSync(cronReq())).json();

    expect(body.deadLettered).toBe(3);
    expect(mockAlert.mock.calls[0][0].title).toBe("1 post(s) stopped syncing after 5 reads with no numbers");
  });

  it("still pages on the reads that failed when answers are mixed in", async () => {
    mockPostCandidates(challengedPosts(10));
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(answeredWith(/A[0-4]\/$/.test(url) ? "not-a-professional-account" : "platform-challenged")),
    );
    mockDb.post.update.mockResolvedValue({});

    await cronSync(cronReq());

    expect(mockAlert).toHaveBeenCalledTimes(1);
    const alert = mockAlert.mock.calls[0][0];
    expect(alert.title).toBe("Post metric sync returning nothing: 5/10 attempts");
    expect(alert.facts).toMatchObject({ noCounts: 10, answered: 5, attempted: 10 });
  });
});

describe("cron sync — which Instagram name is asked for", () => {
  function igPost(postUrl: string, creator: Record<string, unknown>) {
    return makePost({
      postUrl,
      creator: { orgId: "org-1", handle: null, platform: null, profileLinks: [], socialAccounts: [], ...creator },
    });
  }

  async function askedHandle(post: ReturnType<typeof makePost>) {
    mockPostCandidates([post]);
    mockFetch.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "1",
      thumbnailUrl: null,
      caption: null,
      fetchReason: "platform-refused",
      postedAt: new Date(),
    });
    mockDb.post.update.mockResolvedValue({});
    await cronSync(cronReq());
    return mockFetch.mock.calls[0][1].instagramHandle;
  }

  it("never asks Instagram about a TikTok-first creator's TikTok handle", async () => {
    expect(await askedHandle(igPost("https://www.instagram.com/reel/AAA1/", { handle: "tt_name", platform: "TIKTOK" })))
      .toBeUndefined();
  });

  it("takes the Instagram account on the creator's profile over their primary handle", async () => {
    const post = igPost("https://www.instagram.com/reel/AAA1/", {
      handle: "tt_name",
      platform: "TIKTOK",
      profileLinks: [{ handle: "ig_name" }],
    });
    expect(await askedHandle(post)).toBe("ig_name");
  });

  it("takes the author named in the post's own link over everything", async () => {
    const post = igPost("https://www.instagram.com/author.name/reel/AAA1/", {
      handle: "ig_primary",
      platform: "INSTAGRAM",
      profileLinks: [{ handle: "ig_name" }],
    });
    expect(await askedHandle(post)).toBe("author.name");
  });
});

describe("cron sync — uncharged reasons", () => {
  const uncharged = [
    "platform-challenged",
    "platform-refused",
    "backing-off",
    "reader-unavailable",
    "reader-timeout",
    "credentials-rejected",
    "not-configured",
    "not-a-professional-account",
    "post-hidden",
    "author-unknown",
  ] as const;

  it.each(uncharged)("does not charge %s to the post", async (fetchReason) => {
    mockPostCandidates([makePost({ id: "p-ours", syncFailCount: 4 })]);
    mockFetch.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "1",
      thumbnailUrl: null,
      caption: null,
      fetchReason,
      postedAt: new Date(),
    });
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(body.deadLettered).toBe(0);
    const touched = mockDb.post.update.mock.calls
      .map((call: any[]) => call[0])
      .filter(
        (arg: any) =>
          arg.data?.syncFailCount !== undefined || arg.data?.syncDisabledAt !== undefined,
      );
    expect(touched).toEqual([]);
    /* Uncharged is not unreported: the run still counts it and still names it,
       or the summary line goes back to saying nothing moved and not why. */
    expect(body.noCounts).toBe(1);
    expect(body.noCountReasons[fetchReason]).toBe(1);
  });
});

describe("cron sync — a post nobody could attribute", () => {
  const mockDetect = detectPostCreator as jest.Mock;
  const holding = { orgId: "org-1", handle: "", platform: "INSTAGRAM", profileLinks: [], socialAccounts: [] };

  it("files it under the creator the read named and reads its views in the same run", async () => {
    mockPostCandidates([makePost({ id: "p-unattr", creatorId: "unattr-ig", creator: holding })]);
    mockFetch
      .mockResolvedValueOnce({
        platform: "INSTAGRAM",
        platformPostId: "AAA1",
        thumbnailUrl: null,
        caption: null,
        authorHandle: "jane",
        fetchReason: "author-unknown",
      })
      .mockResolvedValueOnce({
        platform: "INSTAGRAM",
        platformPostId: "AAA1",
        thumbnailUrl: null,
        caption: null,
        viewsCount: 9000,
        likesCount: 50,
        commentsCount: 3,
      });
    mockDetect.mockResolvedValueOnce({
      creatorId: "c-jane",
      handle: "jane",
      source: "post-read",
      created: true,
      movedPostIds: ["p-unattr"],
    });
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    const body = await (await cronSync(cronReq())).json();

    expect(mockDetect).toHaveBeenCalledWith(expect.objectContaining({ id: "p-unattr", authorHandle: "jane" }), "org-1");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "https://www.instagram.com/reel/AAA1/",
      expect.objectContaining({ instagramHandle: "jane", instagramOrgId: "org-1" }),
    );
    expect(body).toMatchObject({ synced: 1, creatorsDetected: 1 });
  });

  it("keeps it tracked and uncharged when nobody can be found yet", async () => {
    mockPostCandidates([makePost({ id: "p-unattr", creatorId: "unattr-ig", syncFailCount: 4, creator: holding })]);
    mockFetch.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "AAA1",
      thumbnailUrl: null,
      caption: null,
      fetchReason: "author-unknown",
    });

    const body = await (await cronSync(cronReq())).json();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ synced: 0, creatorsDetected: 0, deadLettered: 0 });
    const charged = mockDb.post.update.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.data?.syncFailCount !== undefined);
    expect(charged).toBeUndefined();
  });

  it("does not look for a creator when the post is read under a known account", async () => {
    mockPostCandidates([
      makePost({ id: "p-jane", creator: { ...holding, handle: "jane", name: "Jane" } }),
    ]);
    mockFetch.mockResolvedValue({
      platform: "INSTAGRAM",
      platformPostId: "AAA1",
      thumbnailUrl: null,
      caption: null,
      viewsCount: 10,
    });
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    await cronSync(cronReq());
    expect(mockDetect).not.toHaveBeenCalled();
  });
});
