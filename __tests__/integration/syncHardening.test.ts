/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as cronSync } from "@/app/api/cron/sync-posts/route";

jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn(), update: jest.fn() },
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

const mockPool = { size: 1, readPost: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
jest.mock("@/lib/platforms/tiktokPostSandbox", () => ({
  laneCountFor: jest.fn((n: number) => (n > 0 ? 1 : 0)),
  openSandboxPostPool: jest.fn(() => mockPool),
}));

import { db } from "@/lib/db";
import { alertOps } from "@/lib/alerts";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { openSandboxPostPool } from "@/lib/platforms/tiktokPostSandbox";

const mockDb = db as any;
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
    creator: { orgId: "org-1", handle: null, socialAccounts: [] },
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
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env.CRON_SECRET = "secret";
  /* One live, due campaign by default. The route now asks which campaigns are
     due before it reads a single post, so even a suite about failure accounting
     has to answer that question -- an unmocked campaign.findMany resolves to
     undefined and the route 500s on .filter. */
  mockDb.campaign.findMany.mockResolvedValue([
    { id: "campaign-1", refreshActive: null, refreshInterval: null, lastRefreshAt: null },
  ]);
  mockDb.campaign.updateMany.mockResolvedValue({ count: 1 });
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
    mockDb.post.findMany.mockResolvedValue([
      makePost({ id: "fresh" }),
      makePost({ id: "old", postedAt: hoursAgo(200 * 24) }),
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
      { postId: "fresh", platform: "INSTAGRAM", action: "sync", reason: "due" },
      { postId: "old", platform: "INSTAGRAM", action: "seal", reason: "age-over-180d" },
      { postId: "disabled", platform: "INSTAGRAM", action: "skip", reason: "dead-letter" },
      { postId: "done", platform: "INSTAGRAM", action: "skip", reason: "sealed" },
      { postId: "cadence", platform: "INSTAGRAM", action: "skip", reason: "cadence-1-7d" },
    ]);
    expect(body.summary.byAction).toEqual({ sync: 1, seal: 1, skip: 3 });
    expect(body.summary.byReason).toEqual({
      due: 1,
      "age-over-180d": 1,
      "dead-letter": 1,
      sealed: 1,
      "cadence-1-7d": 1,
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
    mockDb.post.findMany.mockResolvedValue([
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
    mockDb.post.findMany.mockResolvedValue([
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
    mockDb.post.findMany.mockResolvedValue([makePost({ id: "p-theirs", syncFailCount: 4 })]);
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
  it("seals a >180d post from stored counts without a platform fetch", async () => {
    mockDb.post.findMany.mockResolvedValue([
      makePost({
        id: "p-old",
        postedAt: hoursAgo(200 * 24),
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

    /* The fixture has lastSyncedAt: null -- never measured -- so the seal must
       not stamp it. lastSyncedAt is the sole "was this ever measured" flag
       (lib/metricDisplay), and stamping it here turned the post's default-zero
       counters into measured zeros on the Posts tab, the report and the PDF. */
    expect(mockDb.post.update).not.toHaveBeenCalled();
    const txArg = mockDb.$transaction.mock.calls[0][0];
    expect(txArg).toHaveLength(1);
  });

  it("stamps lastSyncedAt on the seal only when the post was measured before", async () => {
    mockDb.post.findMany.mockResolvedValue([
      makePost({ id: "p-measured", postedAt: hoursAgo(200 * 24), lastSyncedAt: hoursAgo(40 * 24) }),
    ]);
    mockDb.$transaction.mockResolvedValue([{}, {}]);
    mockDb.post.update.mockResolvedValue({});

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(body.sealed).toBe(1);
    const updateArg = mockDb.post.update.mock.calls[0][0];
    expect(updateArg.where.id).toBe("p-measured");
    expect(updateArg.data.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("is idempotent — skips when a final snapshot already exists", async () => {
    mockDb.post.findMany.mockResolvedValue([
      makePost({ id: "p-done", postedAt: hoursAgo(200 * 24), snapshots: [{ id: "snap-1" }] }),
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
    mockDb.post.findMany.mockResolvedValue([
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
    mockDb.post.findMany.mockResolvedValue([
      makePost({ id: "ig-1" }),
      makePost({ id: "ig-2", postUrl: "https://www.instagram.com/reel/AAA2/" }),
    ]);

    const res = await cronSync(cronReq("http://localhost/api/cron/sync-posts?dryRun=1"));
    const body = await res.json();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.post.update).not.toHaveBeenCalled();
    expect(body.decisions).toEqual([
      { postId: "ig-1", platform: "INSTAGRAM", action: "sync", reason: "due" },
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
    mockDb.post.findMany.mockResolvedValue([tiktokPost({ id: "tt-1" }), tiktokPost({ id: "tt-2" })]);
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
    mockDb.post.findMany.mockResolvedValue([makePost({ id: "ig-1" })]);
    mockFetch.mockResolvedValue(undefined);

    await cronSync(cronReq());

    expect(mockOpen).not.toHaveBeenCalled();
    /* The Instagram read must not be told about a pool that does not exist. */
    expect(mockFetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({ tiktokSandbox: undefined, countsOnly: false }),
    );
  });

  it("opens no sandbox on a dry run, which reads nothing", async () => {
    mockDb.post.findMany.mockResolvedValue([tiktokPost({ id: "tt-1" })]);

    const res = await cronSync(cronReq("http://localhost/api/cron/sync-posts?dryRun=1"));
    const body = await res.json();

    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(body.decisions).toEqual([
      { postId: "tt-1", platform: "TIKTOK", action: "sync", reason: "due" },
    ]);
  });

  it("closes the pool even when the run crashes", async () => {
    mockDb.post.findMany.mockResolvedValue([tiktokPost({ id: "tt-1" })]);
    mockFetch.mockRejectedValue(new Error("lane died"));
    // The per-post catch records the failure; make that write blow up too so
    // the run's own catch is reached.
    mockDb.post.update.mockRejectedValueOnce(new Error("db down"));

    const res = await cronSync(cronReq());
    expect([200, 500]).toContain(res.status);
    expect(mockPool.close).toHaveBeenCalledTimes(1);
  });

  it("still sweeps the other platforms in the same run", async () => {
    mockDb.post.findMany.mockResolvedValue([
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
 * Which campaigns the cron sweeps at all.
 *
 * Campaign.refreshInterval / refreshActive / lastRefreshAt were migrated from
 * CreatorCore onto all 506 campaigns and then read by nothing -- the cron swept
 * every post of every live campaign, every hour, regardless. Honouring them is
 * the largest single cost saving here: most campaigns are not due in a given
 * hour, and a campaign that is not due costs zero function seconds and zero
 * Neon reads instead of a full sweep.
 */
describe("cron sync — campaign cadence", () => {
  it("does not read posts when no campaign is due", async () => {
    mockDb.campaign.findMany.mockResolvedValue([
      { id: "campaign-1", refreshActive: true, refreshInterval: 24, lastRefreshAt: hoursAgo(1) },
    ]);
    mockDb.post.findMany.mockResolvedValue([]);

    const res = await cronSync(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
    // The saving is in the query, not in a later filter: an empty due-list must
    // not become an unbounded post read.
    const where = mockDb.post.findMany.mock.calls[0][0].where;
    expect(where.campaignId).toEqual({ in: [] });
  });

  it("asks only for the due campaigns' posts", async () => {
    mockDb.campaign.findMany.mockResolvedValue([
      { id: "due-now", refreshActive: true, refreshInterval: 8, lastRefreshAt: hoursAgo(9) },
      { id: "too-soon", refreshActive: true, refreshInterval: 8, lastRefreshAt: hoursAgo(2) },
      { id: "never-swept", refreshActive: true, refreshInterval: 8, lastRefreshAt: null },
      /* refreshActive=false must NOT exclude a campaign. The flag came from the
         CreatorCore import, not from a user choice, and honouring it left 129 of
         169 live posts unswept since 08-18. Renamed from "paused" because that
         is what it was wrongly assumed to mean. */
      { id: "flag-false-still-due", refreshActive: false, refreshInterval: 8, lastRefreshAt: null },
      // 9999 is CreatorCore's "off" sentinel, not a 416-day interval.
      { id: "off", refreshActive: true, refreshInterval: 9999, lastRefreshAt: null },
    ]);
    mockDb.post.findMany.mockResolvedValue([]);

    await cronSync(cronReq());

    const where = mockDb.post.findMany.mock.calls[0][0].where;
    expect(where.campaignId.in.sort()).toEqual(["due-now", "flag-false-still-due", "never-swept"]);
    // The real off switch still works; only the imported flag stopped counting.
    expect(where.campaignId.in).not.toContain("off");
  });

  it("treats a campaign a few minutes short of its interval as due, so hourly stays hourly", async () => {
    // Vercel fires near :00, not at it; the previous run stamped its own start.
    // 03:00:40 -> 04:00:10 is 59m30s, and an exact compare would skip the hour.
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);
    mockDb.campaign.findMany.mockResolvedValue([
      { id: "jitter", refreshActive: true, refreshInterval: 1, lastRefreshAt: minutesAgo(58) },
      { id: "recent", refreshActive: true, refreshInterval: 1, lastRefreshAt: minutesAgo(50) },
      { id: "daily-jitter", refreshActive: true, refreshInterval: 24, lastRefreshAt: minutesAgo(24 * 60 - 2) },
      { id: "daily-recent", refreshActive: true, refreshInterval: 24, lastRefreshAt: minutesAgo(23 * 60) },
    ]);
    mockDb.post.findMany.mockResolvedValue([]);

    await cronSync(cronReq());

    const where = mockDb.post.findMany.mock.calls[0][0].where;
    expect(where.campaignId.in.sort()).toEqual(["daily-jitter", "jitter"]);
  });

  it("stamps lastRefreshAt only on the campaigns it actually swept", async () => {
    mockDb.campaign.findMany.mockResolvedValue([
      { id: "campaign-1", refreshActive: true, refreshInterval: 1, lastRefreshAt: hoursAgo(4) },
      { id: "campaign-2", refreshActive: true, refreshInterval: 1, lastRefreshAt: hoursAgo(4) },
    ]);
    // Due, but only campaign-1 has a post in this run.
    mockDb.post.findMany.mockResolvedValue([makePost({ id: "ig-1", campaignId: "campaign-1" })]);
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

  it("stamps nothing when there was nothing to sweep", async () => {
    mockDb.campaign.findMany.mockResolvedValue([
      { id: "campaign-1", refreshActive: true, refreshInterval: 1, lastRefreshAt: hoursAgo(4) },
    ]);
    mockDb.post.findMany.mockResolvedValue([]);

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
    mockDb.post.findMany.mockResolvedValue(challengedPosts(6));
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
    mockDb.post.findMany.mockResolvedValue(challengedPosts(6));
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
  ] as const;

  it.each(uncharged)("does not charge %s to the post", async (fetchReason) => {
    mockDb.post.findMany.mockResolvedValue([makePost({ id: "p-ours", syncFailCount: 4 })]);
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
