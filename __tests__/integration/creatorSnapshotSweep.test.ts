/**
 * @jest-environment node
 */
import { snapshotCreators } from "@/lib/creators/snapshot";
import { DEAD_ACCOUNT_RECHECK_MS, TRACKER_HANDLE_PROBLEM_WHERE } from "@/lib/creators/handleCheck";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    creatorTrackerSnapshot: { create: jest.fn() },
    organization: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/platforms/creatorProfile", () => ({
  ...jest.requireActual("@/lib/platforms/creatorProfile"),
  readCreatorProfile: jest.fn(),
}));

jest.mock("@/lib/platforms/tiktokTopPostsOfficial", () => ({
  readTikTokTopPostsOfficial: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/platforms/tiktokTopPostsEmbed", () => ({
  readTikTokTopPostsEmbed: jest.fn().mockResolvedValue(null),
  fetchTikTokEmbedHtmlDirect: jest.fn().mockResolvedValue(null),
  embedHtmlVia: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/creators/topPostsFromCampaigns", () => ({
  readTopPostsFromCampaigns: jest.fn().mockResolvedValue(null),
}));

import { db } from "@/lib/db";
import { readCreatorProfile } from "@/lib/platforms/creatorProfile";
import { readTopPostsFromCampaigns } from "@/lib/creators/topPostsFromCampaigns";

const mockDb = db as any;
const mockRead = readCreatorProfile as jest.Mock;
const mockCampaignPosts = readTopPostsFromCampaigns as jest.Mock;

const HOUR_MS = 60 * 60 * 1000;

function makeCreator(over: Record<string, unknown> = {}) {
  return {
    id: "creator-1",
    orgId: "org-1",
    handle: "someone",
    platform: "INSTAGRAM",
    topPostsAt: new Date(Date.now() - HOUR_MS),
    topPostsSource: "platform",
    trackerSnapshots: [],
    ...over,
  };
}

const okProfile = {
  ok: true,
  profile: { followersCount: 1000, postsCount: 10, avgViews: 500, sampledPosts: 5 },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockDb.organization.findMany.mockResolvedValue([{ id: "org-1", uiConfig: null }]);
  mockDb.creator.update.mockResolvedValue({});
  mockDb.creator.updateMany.mockResolvedValue({ count: 0 });
  mockDb.$transaction.mockResolvedValue([{}, {}]);
  mockRead.mockResolvedValue(okProfile);
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
  (console.warn as jest.Mock).mockRestore();
});

describe("creator sweep — bounded and rotating", () => {
  it("reads a bounded page, oldest attempt first, so the tail is not starved", async () => {
    mockDb.creator.findMany.mockResolvedValue([makeCreator()]);

    await snapshotCreators({});

    const args = mockDb.creator.findMany.mock.calls[0][0];
    expect(args.take).toBe(400);
    /* trackedSince asc never changes, so the same prefix was read and processed
       on every run and the tail was never reached. */
    expect(args.orderBy).toEqual({ trackerLastAttemptAt: { sort: "asc", nulls: "first" } });
  });

  it("does not bound a single-creator refresh, which selects one row by id", async () => {
    mockDb.creator.findMany.mockResolvedValue([makeCreator()]);

    await snapshotCreators({ creatorId: "creator-1", orgId: "org-1" });

    const args = mockDb.creator.findMany.mock.calls[0][0];
    expect(args.take).toBeUndefined();
    expect(args.where).toMatchObject({ id: "creator-1", orgId: "org-1" });
    // A person pressing Refresh is always read, even on an account last seen gone.
    expect(args.where).not.toHaveProperty("AND");
  });

  it("leaves out, at the query, an account the platform said is gone within the week", async () => {
    mockDb.creator.findMany.mockResolvedValue([]);
    const before = Date.now();

    await snapshotCreators({});

    const args = mockDb.creator.findMany.mock.calls[0][0];
    const [clause] = args.where.AND;
    expect(clause.OR).toHaveLength(4);
    expect(clause.OR.slice(0, 2)).toEqual([{ trackerLastError: null }, { trackerLastAttemptAt: null }]);
    const cutoff = clause.OR[2].trackerLastAttemptAt.lt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - DEAD_ACCOUNT_RECHECK_MS);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - DEAD_ACCOUNT_RECHECK_MS);
    expect(clause.OR[3]).toEqual({ NOT: TRACKER_HANDLE_PROBLEM_WHERE });
  });
});

describe("creator sweep — the deadline", () => {
  it("breaks at the deadline and counts the whole remainder as skipped", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      makeCreator({ id: "c-1" }),
      makeCreator({ id: "c-2" }),
      makeCreator({ id: "c-3" }),
    ]);

    const counts = await snapshotCreators({ deadlineMs: -1 });

    expect(counts).toEqual({ snapshots: 0, failed: 0, skipped: 3 });
    expect(mockRead).not.toHaveBeenCalled();
  });
});

describe("creator sweep — reads in parallel", () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const creatorsNamed = (n: number, over: Record<string, unknown> = {}) =>
    Array.from({ length: n }, (_, i) => makeCreator({ id: `c-${i}`, handle: `h${i}`, ...over }));

  function tracked<T>(ms: number, value: T) {
    const state = { inFlight: 0, peak: 0 };
    const fn = jest.fn(async () => {
      state.inFlight++;
      state.peak = Math.max(state.peak, state.inFlight);
      await wait(ms);
      state.inFlight--;
      return value;
    });
    return { fn, state };
  }

  it("has six reads in flight at once and still reads every creator", async () => {
    const read = tracked(20, okProfile);
    mockRead.mockImplementation(read.fn);
    mockDb.creator.findMany.mockResolvedValue(creatorsNamed(14));

    const counts = await snapshotCreators({});

    expect(read.state.peak).toBe(6);
    expect(counts).toEqual({ snapshots: 14, failed: 0, skipped: 0 });
  });

  it("finishes the reads already started at the deadline and skips only the ones nobody started", async () => {
    mockRead.mockImplementation(tracked(80, okProfile).fn);
    mockDb.creator.findMany.mockResolvedValue(creatorsNamed(10));

    const counts = await snapshotCreators({ deadlineMs: 40 });

    expect(mockRead).toHaveBeenCalledTimes(6);
    expect(counts).toEqual({ snapshots: 6, failed: 0, skipped: 4 });
  });

  it("gives the browser one creator at a time however many are in flight", async () => {
    mockRead.mockResolvedValue({ ok: false, reason: "unreadable", detail: "waf shell" });
    const browser = tracked(10, null);
    mockDb.creator.findMany.mockResolvedValue(creatorsNamed(5, { platform: "TIKTOK" }));

    const counts = await snapshotCreators({ readTikTokPosts: browser.fn });

    expect(browser.fn).toHaveBeenCalledTimes(5);
    expect(browser.state.peak).toBe(1);
    expect(counts).toEqual({ snapshots: 0, failed: 5, skipped: 0 });
  });

  it("does not open a browser page for a read still queued at the deadline", async () => {
    mockRead.mockResolvedValue({ ok: false, reason: "unreadable", detail: "waf shell" });
    const browser = tracked(80, null);
    mockDb.creator.findMany.mockResolvedValue(creatorsNamed(3, { platform: "TIKTOK" }));

    const counts = await snapshotCreators({ deadlineMs: 40, readTikTokPosts: browser.fn });

    expect(browser.fn).toHaveBeenCalledTimes(1);
    expect(counts).toEqual({ snapshots: 0, failed: 3, skipped: 0 });
  });

  it("never opens the browser for an account TikTok says does not exist", async () => {
    mockRead.mockResolvedValue({ ok: false, reason: "no-such-account", detail: "statusCode 10221" });
    const browser = tracked(10, null);
    mockDb.creator.findMany.mockResolvedValue(creatorsNamed(3, { platform: "TIKTOK" }));

    const counts = await snapshotCreators({ readTikTokPosts: browser.fn });

    expect(browser.fn).not.toHaveBeenCalled();
    expect(counts).toEqual({ snapshots: 0, failed: 3, skipped: 0 });
  });

  it("returns past the deadline when a read never settles, and rotates that creator to the back", async () => {
    mockRead.mockImplementation((_platform: string, handle: string) =>
      handle === "stuck" ? new Promise(() => {}) : Promise.resolve(okProfile)
    );
    mockDb.creator.findMany.mockResolvedValue([
      makeCreator({ id: "c-stuck", handle: "stuck" }),
      ...creatorsNamed(3),
    ]);

    const counts = await snapshotCreators({ deadlineMs: 20, abandonGraceMs: 20 });

    expect(counts).toEqual({ snapshots: 3, failed: 0, skipped: 1 });
    expect(mockDb.creator.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c-stuck"] } },
      data: { trackerLastAttemptAt: expect.any(Date) },
    });
  });

  it("counts a creator whose read throws and carries on with the rest", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      makeCreator({ id: "c-broken", trackerSnapshots: undefined }),
      makeCreator({ id: "c-fine" }),
    ]);

    const counts = await snapshotCreators({});

    expect(counts).toEqual({ snapshots: 1, failed: 1, skipped: 0 });
  });
});

describe("creator sweep — a creator that is not due", () => {
  /**
   * platformPostsAreStaleFor is `age OR source !== "platform"`, and the source
   * half is permanently true for every creator whose Top Posts came from
   * campaign posts. On the not-due path that meant a posts read for each of
   * them on every single run, for a list at most 20 hours old.
   */
  it("reads nothing at all for a not-due creator whose posts are fresh", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      makeCreator({
        topPostsSource: "campaigns",
        topPostsAt: new Date(Date.now() - HOUR_MS),
        trackerSnapshots: [{ followersCount: 900, recordedAt: new Date(Date.now() - HOUR_MS) }],
      }),
    ]);

    const counts = await snapshotCreators({});

    expect(counts).toEqual({ snapshots: 0, failed: 0, skipped: 1 });
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockCampaignPosts).not.toHaveBeenCalled();
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it("still refreshes Top Posts on their own daily cadence when they are stale", async () => {
    mockCampaignPosts.mockResolvedValue({ topPosts: [{ id: "v1" }] });
    mockDb.creator.findMany.mockResolvedValue([
      makeCreator({
        topPostsSource: "campaigns",
        topPostsAt: new Date(Date.now() - 30 * HOUR_MS),
        trackerSnapshots: [{ followersCount: 900, recordedAt: new Date(Date.now() - HOUR_MS) }],
      }),
    ]);

    const counts = await snapshotCreators({});

    expect(counts.skipped).toBe(1);
    expect(mockCampaignPosts).toHaveBeenCalledTimes(1);
    expect(mockDb.creator.update).toHaveBeenCalledTimes(1);
  });
});

describe("creator sweep — one bad write is not the whole run", () => {
  it("counts a failed snapshot transaction and carries on to the next creator", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      makeCreator({ id: "c-bad", handle: "bad" }),
      makeCreator({ id: "c-good", handle: "good" }),
    ]);
    mockDb.$transaction
      .mockRejectedValueOnce(new Error("deadlock detected"))
      .mockResolvedValue([{}, {}]);

    const counts = await snapshotCreators({});

    expect(counts).toEqual({ snapshots: 1, failed: 1, skipped: 0 });
    expect(mockRead).toHaveBeenCalledTimes(2);
    /* The failure leaves a breadcrumb on the creator rather than vanishing.
       Taken from the LAST update for that creator: the update inside the
       transaction array is constructed (and so recorded by the mock) before
       $transaction ever runs, so the first call is the one that never landed. */
    const updates = mockDb.creator.update.mock.calls
      .map((c: any[]) => c[0])
      .filter((a: any) => a.where.id === "c-bad");
    expect(updates[updates.length - 1].data.trackerLastError).toContain("snapshot-write-failed");
  });
});
