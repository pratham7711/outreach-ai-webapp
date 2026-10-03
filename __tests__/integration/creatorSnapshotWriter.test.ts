/**
 * @jest-environment node
 *
 * One writer per field in the tracker's reader v2 (plan A7, A8): a fresh
 * reading from the creator's own connection outranks the public read for the
 * follower count, the snapshot says which source it was, and the precision
 * anchor is the last reading -- never the Creator column an agency can type
 * over. The legacy sweep is unchanged.
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
  embedHtmlVia: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/creators/topPostsFromCampaigns", () => ({ readTopPostsFromCampaigns: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/trackers/readingGate", () => ({ gateFollowerReading: jest.fn() }));
jest.mock("@/lib/trackers/sourceSwitch", () => ({ recordSnapshotSources: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/creators/connectedReading", () => ({ connectedFollowerReading: jest.fn() }));

import { db } from "@/lib/db";
import { readCreatorProfile, type CreatorReadResult } from "@/lib/platforms/creatorProfile";
import { gateFollowerReading } from "@/lib/trackers/readingGate";
import { recordSnapshotSources } from "@/lib/trackers/sourceSwitch";
import { connectedFollowerReading } from "@/lib/creators/connectedReading";
import { CONNECTED_VIA } from "@/lib/creators/snapshot";

const mockDb = db as unknown as {
  creator: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  creatorTrackerSnapshot: { create: jest.Mock };
  creatorProfileLink: { updateMany: jest.Mock };
  organization: { findMany: jest.Mock };
  $transaction: jest.Mock;
};
const mockRead = readCreatorProfile as jest.Mock;
const mockGate = gateFollowerReading as jest.Mock;
const mockSources = recordSnapshotSources as jest.Mock;
const mockConnected = connectedFollowerReading as jest.Mock;
const HOUR_MS = 60 * 60 * 1000;

function profile(followersCount: number) {
  return { ok: true, profile: { followersCount, postsCount: 10, avgViews: 500, sampledPosts: 5 } } as unknown as CreatorReadResult;
}

function creator(over: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    orgId: "org-1",
    handle: "@fake_someone",
    platform: "INSTAGRAM",
    platformUserId: null,
    followersCount: 1900,
    topPostsAt: new Date(Date.now() - HOUR_MS),
    topPostsSource: "platform",
    trackerSnapshots: [{ followersCount: 1900, recordedAt: new Date(Date.now() - 30 * HOUR_MS) }],
    ...over,
  };
}

/** The follower count each write in the snapshot transaction carried. */
function written() {
  const snap = mockDb.creatorTrackerSnapshot.create.mock.calls[0]?.[0]?.data;
  const row = mockDb.creator.update.mock.calls.find((c) => "followersCount" in (c[0].data ?? {}))?.[0]?.data;
  return { snapshot: snap?.followersCount, creator: row?.followersCount };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockDb.organization.findMany.mockResolvedValue([{ id: "org-1", uiConfig: null }]);
  mockDb.creator.update.mockResolvedValue({});
  mockDb.creator.updateMany.mockResolvedValue({ count: 0 });
  mockDb.creatorProfileLink.updateMany.mockResolvedValue({ count: 1 });
  mockDb.creatorTrackerSnapshot.create.mockReturnValue({});
  mockDb.$transaction.mockResolvedValue([{ id: "snap-1" }, {}]);
  mockRead.mockResolvedValue(profile(2000));
  mockGate.mockResolvedValue({ action: "write" });
  mockConnected.mockResolvedValue(null);
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
  (console.warn as jest.Mock).mockRestore();
});

describe("reader v2", () => {
  it("writes the connection's fresh figure over the public read, and records the source", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    mockConnected.mockResolvedValue({ source: "connected", value: 2047, measuredAt: new Date(Date.now() - 2 * HOUR_MS) });

    await snapshotCreators({ plan: "A" });

    expect(written()).toEqual({ snapshot: 2047, creator: 2047 });
    expect(mockDb.creatorProfileLink.updateMany.mock.calls[0][0].data.followersCount).toBe(2047);
    expect(mockGate.mock.calls[0][0]).toMatchObject({ next: { followersCount: 2047 }, via: CONNECTED_VIA });
    expect(mockSources).toHaveBeenCalledWith([expect.objectContaining({ exitId: CONNECTED_VIA })]);
    expect(mockConnected).toHaveBeenCalledWith(expect.objectContaining({ id: "c-1", orgId: "org-1" }), expect.any(Date));
  });

  it("keeps the public read when the connection's figure is past its freshness window", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    mockConnected.mockResolvedValue({ source: "connected", value: 2047, measuredAt: new Date(Date.now() - 48 * HOUR_MS) });

    await snapshotCreators({ plan: "A" });

    expect(written()).toEqual({ snapshot: 2000, creator: 2000 });
  });

  it("keeps the public read, and its exit, when there is no granted connection", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator({ platform: "TIKTOK" })]);
    const via = jest.fn().mockResolvedValue({ result: profile(2000), via: "A:iad1:0#1" });

    await snapshotCreators({ plan: "A", readTikTokProfileVia: via });

    expect(written().snapshot).toBe(2000);
    expect(mockSources).toHaveBeenCalledWith([expect.objectContaining({ exitId: "A:iad1:0#1" })]);
  });

  it("anchors precision on the last reading, not on a typed-in Creator figure", async () => {
    /* YouTube publishes subscriber counts rounded to three figures. A typed
       1,234,567 on the Creator row sits inside the rounded 1,230,000's window
       and used to be kept as if it were an exact reading. */
    mockDb.creator.findMany.mockResolvedValue([
      creator({
        platform: "YOUTUBE",
        followersCount: 1_234_567,
        trackerSnapshots: [{ followersCount: 1_200_000, recordedAt: new Date(Date.now() - 30 * HOUR_MS) }],
      }),
    ]);
    mockRead.mockResolvedValue(profile(1_230_000));

    await snapshotCreators({ plan: "A" });

    expect(written().snapshot).toBe(1_230_000);
  });

  it("still keeps an exact figure the last reading recorded", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      creator({
        platform: "YOUTUBE",
        followersCount: 999,
        trackerSnapshots: [{ followersCount: 1_234_567, recordedAt: new Date(Date.now() - 30 * HOUR_MS) }],
      }),
    ]);
    mockRead.mockResolvedValue(profile(1_230_000));

    await snapshotCreators({ plan: "A" });

    expect(written().snapshot).toBe(1_234_567);
  });
});

describe("the legacy sweep", () => {
  it("does not consult the connection and keeps its Creator-column anchor", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      creator({
        platform: "YOUTUBE",
        followersCount: 1_234_567,
        trackerSnapshots: [{ followersCount: 1_200_000, recordedAt: new Date(Date.now() - 30 * HOUR_MS) }],
      }),
    ]);
    mockRead.mockResolvedValue(profile(1_230_000));

    await snapshotCreators({});

    expect(mockConnected).not.toHaveBeenCalled();
    expect(written().snapshot).toBe(1_234_567);
  });

  /* So the next read can ask by id once the handle stops resolving. Before,
     only a channel found through the creator's own campaign videos was kept. */
  it("keeps the channel id a YouTube read answered for", async () => {
    const CHANNEL = "UC" + "c".repeat(22);
    mockDb.creator.findMany.mockResolvedValue([creator({ platform: "YOUTUBE" })]);
    mockRead.mockResolvedValue({
      ok: true,
      profile: { followersCount: 2000, postsCount: 10, avgViews: 500, sampledPosts: 5, accountId: CHANNEL },
    });

    await snapshotCreators({});

    const row = mockDb.creator.update.mock.calls.find((c) => "followersCount" in (c[0].data ?? {}))?.[0]?.data;
    expect(row.platformUserId).toBe(CHANNEL);
  });

  it("leaves platformUserId alone for an id from another platform's namespace", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator({ platform: "INSTAGRAM" })]);
    mockRead.mockResolvedValue({
      ok: true,
      profile: { followersCount: 2000, postsCount: 10, avgViews: 500, sampledPosts: 5, accountId: "17841400000000001" },
    });

    await snapshotCreators({});

    const row = mockDb.creator.update.mock.calls.find((c) => "followersCount" in (c[0].data ?? {}))?.[0]?.data;
    expect(row).not.toHaveProperty("platformUserId");
  });
});
