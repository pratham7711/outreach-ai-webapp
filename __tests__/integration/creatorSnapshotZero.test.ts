/**
 * @jest-environment node
 *
 * A follower count that fell to 0 from something is a page that was not the
 * profile, never a reading. The legacy sweep wrote three of them on 2026-10-02;
 * these pin that neither path writes one again, and that the list maths no
 * longer turns one already stored into a -100% change.
 */
import { snapshotCreators } from "@/lib/creators/snapshot";
import { figuresFor, type Reading } from "@/lib/trackers/creatorPage";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    creatorTrackerSnapshot: { create: jest.fn(), findFirst: jest.fn() },
    creatorProfileLink: { updateMany: jest.fn() },
    organization: { findMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRawUnsafe: jest.fn(),
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
  embedHtmlVia: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/creators/topPostsFromCampaigns", () => ({ readTopPostsFromCampaigns: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/trackers/readingGate", () => ({ gateFollowerReading: jest.fn() }));
jest.mock("@/lib/trackers/sourceSwitch", () => ({ recordSnapshotSources: jest.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { readCreatorProfile, type CreatorReadResult } from "@/lib/platforms/creatorProfile";
import { gateFollowerReading } from "@/lib/trackers/readingGate";

const mockDb = db as unknown as {
  creator: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  creatorTrackerSnapshot: { findFirst: jest.Mock };
  creatorProfileLink: { updateMany: jest.Mock };
  organization: { findMany: jest.Mock };
  $transaction: jest.Mock;
};
const mockRead = readCreatorProfile as jest.Mock;
const mockGate = gateFollowerReading as jest.Mock;
const HOUR_MS = 60 * 60 * 1000;

const zeroProfile = { ok: true, profile: { followersCount: 0, postsCount: 0, avgViews: 0, sampledPosts: 0 } } as unknown as CreatorReadResult;
const realProfile = { ok: true, profile: { followersCount: 52_300, postsCount: 40, avgViews: 0, sampledPosts: 0 } } as unknown as CreatorReadResult;

function creator(previousFollowers: number | null) {
  return {
    id: "c-1",
    orgId: "org-1",
    handle: "@someone",
    platform: "TIKTOK",
    followersCount: previousFollowers ?? 0,
    topPostsAt: new Date(Date.now() - HOUR_MS),
    topPostsSource: "platform",
    trackerSnapshots:
      previousFollowers === null ? [] : [{ followersCount: previousFollowers, recordedAt: new Date(Date.now() - 30 * HOUR_MS) }],
  };
}

const notWritten = () => {
  expect(mockDb.$transaction).not.toHaveBeenCalled();
  expect(mockDb.creator.update).toHaveBeenCalledWith({ where: { id: "c-1" }, data: { trackerLastAttemptAt: expect.any(Date) } });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockDb.organization.findMany.mockResolvedValue([{ id: "org-1", uiConfig: null }]);
  mockDb.creator.update.mockResolvedValue({});
  mockDb.creator.updateMany.mockResolvedValue({ count: 0 });
  mockDb.creatorProfileLink.updateMany.mockResolvedValue({ count: 1 });
  mockDb.creatorTrackerSnapshot.findFirst.mockResolvedValue(null);
  mockDb.$transaction.mockResolvedValue([{ id: "snap-1" }, {}]);
  mockGate.mockResolvedValue({ action: "write" });
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
  (console.warn as jest.Mock).mockRestore();
});

describe("legacy sweep — a fall to 0", () => {
  it("does not write a 0 after a real figure, and stamps the attempt so the creator rotates", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator(52_000)]);
    mockRead.mockResolvedValue(zeroProfile);

    const counts = await snapshotCreators({});

    expect(counts).toEqual({ snapshots: 0, failed: 0, skipped: 1 });
    notWritten();
    expect(mockGate).not.toHaveBeenCalled();
  });

  it("judges against the last non-zero reading when a 0 is already the newest", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator(0)]);
    mockDb.creatorTrackerSnapshot.findFirst.mockResolvedValue({ followersCount: 52_000 });
    mockRead.mockResolvedValue(zeroProfile);

    const counts = await snapshotCreators({});

    expect(counts.skipped).toBe(1);
    notWritten();
    expect(mockDb.creatorTrackerSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { creatorId: "c-1", followersCount: { gt: 0 } } })
    );
  });

  it("still writes a first reading of 0 -- there is nothing it fell from", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator(null)]);
    mockRead.mockResolvedValue(zeroProfile);

    const counts = await snapshotCreators({});

    expect(counts.snapshots).toBe(1);
    expect(mockDb.creatorTrackerSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it("writes the real figure that follows a stored 0", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator(0)]);
    mockDb.creatorTrackerSnapshot.findFirst.mockResolvedValue({ followersCount: 52_000 });
    mockRead.mockResolvedValue(realProfile);

    const counts = await snapshotCreators({});

    expect(counts.snapshots).toBe(1);
  });

  it("asks for nothing extra when the newest reading is a real figure", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator(52_000)]);
    mockRead.mockResolvedValue(realProfile);

    await snapshotCreators({});

    expect(mockDb.creatorTrackerSnapshot.findFirst).not.toHaveBeenCalled();
  });
});

describe("reader v2 — a fall to 0", () => {
  const via = () => jest.fn().mockResolvedValue({ result: zeroProfile, via: "A:x" });

  it("hands the gate the last non-zero figure, not a 0 already stored", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator(0)]);
    mockDb.creatorTrackerSnapshot.findFirst.mockResolvedValue({ followersCount: 52_000 });
    mockGate.mockResolvedValue({ action: "reject", reason: "fell to 0 from 52000" });

    await snapshotCreators({ plan: "A", readTikTokProfileVia: via() });

    expect(mockGate).toHaveBeenCalledWith(expect.objectContaining({ previous: { followersCount: 52_000 } }));
    notWritten();
  });

  it("refuses the 0 even when the gate throws", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator(52_000)]);
    mockGate.mockRejectedValue(new Error("connection reset"));

    const counts = await snapshotCreators({ plan: "A", readTikTokProfileVia: via() });

    expect(counts).toEqual({ snapshots: 0, failed: 0, skipped: 1 });
    notWritten();
  });
});

describe("list maths — a 0 already stored", () => {
  const now = new Date("2026-10-02T14:00:00Z");
  const r = (hoursAgo: number, followers: number): Reading => ({
    recordedAt: new Date(now.getTime() - hoursAgo * HOUR_MS),
    followersCount: followers,
    avgViews: 0,
  });

  it("is not the newest figure, and draws no -100% change", () => {
    const f = figuresFor([r(1, 0), r(10, 52_100), r(20, 52_000)], 0, "24h", now);

    expect(f.followersCount).toBe(52_100);
    expect(f.followersDelta).toBe(100);
    expect(f.followerHistory.map((p) => p.value)).toEqual([52_100, 52_000]);
  });

  it("is not a baseline either: no gain of the whole audience", () => {
    const f = figuresFor([r(1, 52_300), r(20, 0)], 0, "24h", now);

    expect(f.followersDelta).toBeNull();
    expect(f.followersChangePercent).toBeNull();
  });
});
