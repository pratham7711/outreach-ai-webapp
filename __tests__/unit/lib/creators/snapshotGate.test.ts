/**
 * @jest-environment node
 *
 * The tracker sweep through the shared validation gate (plan A3). The rules are
 * tested one by one in __tests__/unit/lib/acquisition/validate.test.ts; these
 * pin what the sweep does when one fires -- writes nothing, keeps the stored
 * figure, files the refusal -- and that the readings beside each rule that
 * must still land do.
 */
import { snapshotCreators } from "@/lib/creators/snapshot";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    creatorTrackerSnapshot: { create: jest.fn(), findFirst: jest.fn() },
    creatorProfileLink: { updateMany: jest.fn() },
    creatorPlatformAccountId: { findMany: jest.fn(), upsert: jest.fn() },
    trackerReadingQuarantine: { create: jest.fn() },
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
jest.mock("@/lib/creators/accountIdTables", () => ({ accountIdTablesReady: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/trackers/readingGate", () => ({ gateFollowerReading: jest.fn().mockResolvedValue({ action: "write" }) }));
jest.mock("@/lib/trackers/sourceSwitch", () => ({
  recordSnapshotSources: jest.fn().mockResolvedValue(undefined),
  trackerSourceTablesReady: jest.fn().mockResolvedValue(true),
}));

import { db } from "@/lib/db";
import { readCreatorProfile, type CreatorReadResult } from "@/lib/platforms/creatorProfile";

const mockDb = db as unknown as Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
const mockRead = readCreatorProfile as jest.Mock;
const HOUR_MS = 60 * 60 * 1000;

const read = (over: Record<string, unknown>) =>
  ({ ok: true, profile: { followersCount: 52_300, postsCount: 40, avgViews: 0, sampledPosts: 0, ...over } }) as unknown as CreatorReadResult;

function creator(over: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    orgId: "org-1",
    handle: "leakit.official",
    platform: "TIKTOK",
    followersCount: 52_000,
    averageViews: 18_000,
    topPostsAt: new Date(Date.now() - HOUR_MS),
    topPostsSource: "platform",
    trackerSnapshots: [{ followersCount: 52_000, recordedAt: new Date(Date.now() - 30 * HOUR_MS) }],
    ...over,
  };
}

const lines: string[] = [];
let spy: jest.SpyInstance;
const gateLines = () =>
  lines.map((l) => JSON.parse(l)).filter((l) => l.context?.gate === "acquisition.validate");

beforeEach(() => {
  jest.clearAllMocks();
  lines.length = 0;
  process.env.LOG_LEVEL = "info";
  spy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    const text = String(chunk);
    if (text.startsWith("{")) lines.push(text);
    return true;
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockDb.organization.findMany.mockResolvedValue([{ id: "org-1", uiConfig: null }]);
  mockDb.creator.update.mockResolvedValue({});
  mockDb.creatorProfileLink.updateMany.mockResolvedValue({ count: 1 });
  mockDb.creatorTrackerSnapshot.findFirst.mockResolvedValue(null);
  mockDb.creatorPlatformAccountId.findMany.mockResolvedValue([]);
  mockDb.creatorPlatformAccountId.upsert.mockResolvedValue({});
  mockDb.trackerReadingQuarantine.create.mockResolvedValue({ id: "q-1" });
  mockDb.$transaction.mockResolvedValue([{ id: "snap-1" }, {}]);
});

afterEach(() => {
  spy.mockRestore();
  (console.error as jest.Mock).mockRestore();
  (console.warn as jest.Mock).mockRestore();
});

/** The Creator write inside the snapshot transaction. */
const creatorWrite = () => mockDb.creator.update.mock.calls.find((c) => "followersCount" in c[0].data)?.[0].data;

describe("tracker sweep — account bound to the handle", () => {
  const bound = [{ platformAccountId: "6800000000000000001", handle: "leakit.official" }];

  it("refuses a read of the handle that answered with a different account, and files it", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    mockDb.creatorPlatformAccountId.findMany.mockResolvedValue(bound);
    mockRead.mockResolvedValue(read({ followersCount: 310, accountId: "7300000000000000002" }));

    const counts = await snapshotCreators({});

    expect(counts).toEqual({ snapshots: 0, failed: 0, skipped: 1 });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    // The new id is not recorded as this creator's: the next read is refused too.
    expect(mockDb.creatorPlatformAccountId.upsert).not.toHaveBeenCalled();
    expect(mockDb.trackerReadingQuarantine.create.mock.calls[0][0].data).toMatchObject({
      creatorId: "c-1",
      verdict: "rejected",
      followersCount: 310,
      previousFollowers: 52_000,
    });
    expect(mockDb.trackerReadingQuarantine.create.mock.calls[0][0].data.reason).toMatch(/^account-mismatch: /);
    expect(gateLines()[0]).toMatchObject({
      level: "warn",
      msg: "reading rejected",
      context: { writer: "tracker:legacy", kind: "creator", rowId: "c-1", rules: ["account-mismatch"] },
    });
  });

  it("writes the bound account's reading, renamed or not", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    mockDb.creatorPlatformAccountId.findMany.mockResolvedValue(bound);
    mockRead.mockResolvedValue(read({ followersCount: 52_400, accountId: "6800000000000000001" }));

    const counts = await snapshotCreators({});

    expect(counts.snapshots).toBe(1);
    expect(gateLines()).toEqual([]);
  });

  it("writes any account when no id was ever seen under this handle (nothing is bound yet)", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    mockDb.creatorPlatformAccountId.findMany.mockResolvedValue([{ platformAccountId: "1", handle: "an.old.name" }]);
    mockRead.mockResolvedValue(read({ followersCount: 52_400, accountId: "7300000000000000002" }));

    expect((await snapshotCreators({})).snapshots).toBe(1);
  });

  it("does not ask when the read carried no id", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    mockRead.mockResolvedValue(read({ followersCount: 52_400 }));

    expect((await snapshotCreators({})).snapshots).toBe(1);
    expect(mockDb.creatorPlatformAccountId.findMany).not.toHaveBeenCalled();
  });
});

describe("tracker sweep — falls to 0", () => {
  it("refuses a first kept reading of 0 when the roster already holds a real figure", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator({ trackerSnapshots: [] })]);
    mockRead.mockResolvedValue(read({ followersCount: 0, postsCount: 0 }));

    const counts = await snapshotCreators({});

    expect(counts.skipped).toBe(1);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(gateLines()[0].context.reason).toBe("fell-to-zero: followers fell to 0 from 52000");
  });

  it("keeps the stored average when a read's average over real samples fell to 0, and still writes followers", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    mockRead.mockResolvedValue(read({ followersCount: 52_400, avgViews: 0, sampledPosts: 9 }));

    const counts = await snapshotCreators({});

    expect(counts.snapshots).toBe(1);
    expect(creatorWrite()).toMatchObject({ followersCount: 52_400 });
    expect(creatorWrite()).not.toHaveProperty("averageViews");
    expect(gateLines()[0]).toMatchObject({ msg: "reading field dropped", context: { fields: ["avgViews"] } });
  });

  it("writes a real average that went down", async () => {
    mockDb.creator.findMany.mockResolvedValue([creator()]);
    mockRead.mockResolvedValue(read({ followersCount: 52_400, avgViews: 4_100, sampledPosts: 9 }));

    await snapshotCreators({});

    expect(creatorWrite()).toMatchObject({ followersCount: 52_400, averageViews: 4_100 });
  });
});
