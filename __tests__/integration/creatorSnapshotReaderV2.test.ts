/**
 * @jest-environment node
 */
import { snapshotCreators } from "@/lib/creators/snapshot";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    creatorTrackerSnapshot: { create: jest.fn() },
    creatorProfileLink: { updateMany: jest.fn() },
    organization: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/platforms/creatorProfile", () => ({
  ...jest.requireActual("@/lib/platforms/creatorProfile"),
  readCreatorProfile: jest.fn(),
}));
jest.mock("@/lib/platforms/tiktokTopPostsOfficial", () => ({ readTikTokTopPostsOfficial: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/platforms/tiktokTopPostsEmbed", () => ({
  readTikTokTopPostsEmbed: jest.fn().mockResolvedValue(null),
  fetchTikTokEmbedHtmlDirect: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/creators/topPostsFromCampaigns", () => ({ readTopPostsFromCampaigns: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/trackers/readingGate", () => ({ gateFollowerReading: jest.fn() }));
jest.mock("@/lib/trackers/sourceSwitch", () => ({ recordSnapshotSources: jest.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { readCreatorProfile, type CreatorReadResult } from "@/lib/platforms/creatorProfile";
import { gateFollowerReading } from "@/lib/trackers/readingGate";
import { recordSnapshotSources } from "@/lib/trackers/sourceSwitch";

const mockDb = db as unknown as {
  creator: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  creatorProfileLink: { updateMany: jest.Mock };
  organization: { findMany: jest.Mock };
  $transaction: jest.Mock;
};
const mockRead = readCreatorProfile as jest.Mock;
const mockGate = gateFollowerReading as jest.Mock;
const mockSources = recordSnapshotSources as jest.Mock;
const HOUR_MS = 60 * 60 * 1000;

const okProfile = { ok: true, profile: { followersCount: 2000, postsCount: 10, avgViews: 500, sampledPosts: 5 } } as unknown as CreatorReadResult;

function creator(over: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    orgId: "org-1",
    handle: "@someone",
    platform: "TIKTOK",
    topPostsAt: new Date(Date.now() - HOUR_MS),
    topPostsSource: "platform",
    trackerSnapshots: [{ followersCount: 1900, recordedAt: new Date(Date.now() - 30 * HOUR_MS) }],
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockDb.organization.findMany.mockResolvedValue([{ id: "org-1", uiConfig: null }]);
  mockDb.creator.update.mockResolvedValue({});
  mockDb.creator.updateMany.mockResolvedValue({ count: 0 });
  mockDb.creatorProfileLink.updateMany.mockResolvedValue({ count: 1 });
  mockDb.$transaction.mockResolvedValue([{ id: "snap-1" }, {}]);
  mockRead.mockResolvedValue(okProfile);
  mockGate.mockResolvedValue({ action: "write" });
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
  (console.warn as jest.Mock).mockRestore();
});

describe("reader v2 through snapshotCreators", () => {
  it("sends TikTok profiles to the lanes, not the direct fetch, and records which exit read it", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    const via = jest.fn().mockResolvedValue({ result: okProfile, via: "A:iad1:0#1" });

    const counts = await snapshotCreators({ plan: "A", readTikTokProfileVia: via });

    expect(counts).toEqual({ snapshots: 1, failed: 0, skipped: 0 });
    expect(via).toHaveBeenCalledWith("@someone");
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockSources).toHaveBeenCalledWith([
      expect.objectContaining({ snapshotId: "snap-1", creatorId: "c-1", plan: "A", exitId: "A:iad1:0#1" }),
    ]);
  });

  it("still reads other platforms the usual way", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator({ platform: "INSTAGRAM" })]);
    const via = jest.fn();

    await snapshotCreators({ plan: "A", readTikTokProfileVia: via });

    expect(via).not.toHaveBeenCalled();
    expect(mockRead).toHaveBeenCalledWith("INSTAGRAM", "@someone");
  });

  it("does not fall back to the old sandbox fetcher when the lanes fail", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    const remote = jest.fn();
    const via = jest.fn().mockResolvedValue({ result: { ok: false, reason: "unreadable", detail: "wall" }, via: "A:iad1:0#1" });

    const counts = await snapshotCreators({ plan: "A", readTikTokProfileVia: via, readTikTokProfileRemote: remote });

    expect(remote).not.toHaveBeenCalled();
    expect(counts.failed).toBe(1);
  });

  it("writes no snapshot for a held reading, but stamps the attempt so the creator rotates", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    mockGate.mockResolvedValue({ action: "hold", reason: "jump of 4.0x" });
    const via = jest.fn().mockResolvedValue({ result: okProfile, via: "A:x" });

    const counts = await snapshotCreators({ plan: "A", readTikTokProfileVia: via });

    expect(counts).toEqual({ snapshots: 0, failed: 0, skipped: 1 });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.creator.update).toHaveBeenCalledWith({ where: { id: "c-1" }, data: { trackerLastAttemptAt: expect.any(Date) } });
  });

  it("feeds the roster link from the same read (one read, three uses)", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    const via = jest.fn().mockResolvedValue({ result: okProfile, via: "A:x" });

    await snapshotCreators({ plan: "A", readTikTokProfileVia: via });

    const args = mockDb.creatorProfileLink.updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ orgId: "org-1", creatorId: "c-1", platform: "TIKTOK", handle: { equals: "someone", mode: "insensitive" } });
    expect(args.data).toMatchObject({ followersCount: 2000, averageViews: 500, refreshError: null });
  });

  it("scopes the query to the rollout's orgs and size, and applies the percentage filter", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator({ id: "keep" }), creator({ id: "drop" })]);
    const via = jest.fn().mockResolvedValue({ result: okProfile, via: "A:x" });

    const counts = await snapshotCreators({
      plan: "A",
      readTikTokProfileVia: via,
      orgIdsIn: ["org-1"],
      maxCreators: 600,
      inScope: (c) => c.id === "keep",
    });

    const args = mockDb.creator.findMany.mock.calls[0][0];
    expect(args.where.orgId).toEqual({ in: ["org-1"] });
    expect(args.take).toBe(600);
    expect(via).toHaveBeenCalledTimes(1);
    expect(counts.snapshots).toBe(1);
  });

  it("tells the caller how many reads are due by platform before reading any", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      creator({ id: "a" }),
      creator({ id: "b", platform: "INSTAGRAM" }),
      creator({ id: "c", trackerSnapshots: [{ followersCount: 1, recordedAt: new Date() }] }),
    ]);
    const order: unknown[] = [];
    const via = jest.fn(async () => {
      order.push("read");
      return { result: okProfile, via: "A:x" };
    });

    await snapshotCreators({
      plan: "A",
      readTikTokProfileVia: via,
      onSelected: (due) => {
        order.push(due);
      },
    });

    expect(order[0]).toEqual({ total: 2, byPlatform: { TIKTOK: 1, INSTAGRAM: 1 }, tiktokPostsStale: 0 });
    expect(order.slice(1)).toEqual(["read"]);
  });

  it("leaves the legacy sweep alone: no gate, no source rows, no roster write", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);

    await snapshotCreators({});

    expect(mockGate).not.toHaveBeenCalled();
    expect(mockSources).not.toHaveBeenCalled();
    expect(mockDb.creatorProfileLink.updateMany).not.toHaveBeenCalled();
    expect(mockRead).toHaveBeenCalledWith("TIKTOK", "@someone");
  });
});
