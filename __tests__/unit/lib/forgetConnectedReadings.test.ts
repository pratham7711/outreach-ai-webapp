/**
 * @jest-environment node
 *
 * YouTube API Services policy III.D.2: data read through a grant is deleted
 * when the grant ends. Reader v2 copies the creator's connected follower figure
 * into the tracker, so a Disconnect must take those readings with it, and
 * nothing the public read recorded.
 */
jest.mock("@/lib/db", () => ({
  db: {
    $transaction: jest.fn(),
    creator: { findUnique: jest.fn(), updateMany: jest.fn() },
    creatorTrackerSnapshot: { findMany: jest.fn(), deleteMany: jest.fn(), update: jest.fn() },
    trackerSnapshotSource: { findMany: jest.fn(), deleteMany: jest.fn() },
    trackerReadingQuarantine: { deleteMany: jest.fn(), updateMany: jest.fn() },
    creatorProfileLink: { updateMany: jest.fn() },
  },
}));
jest.mock("@/lib/trackers/sourceSwitch", () => ({ trackerSourceTablesReady: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn() }));

import { db } from "@/lib/db";
import { trackerSourceTablesReady } from "@/lib/trackers/sourceSwitch";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { forgetConnectedReadings } from "@/lib/creators/forgetConnectedReadings";
import { CONNECTED_VIA } from "@/lib/creators/followerWriter";

const mockDb = db as any;
const mockTables = trackerSourceTablesReady as jest.Mock;
const mockRoster = rosterTablesReady as jest.Mock;

/* Each query builder returns a tagged object, so the transaction's contents
   can be read back in order. */
function tag(model: string, op: string) {
  return (args: unknown) => ({ model, op, args });
}

function series(rows: { id: string; followersCount: number; connected?: boolean }[]) {
  mockDb.creatorTrackerSnapshot.findMany.mockResolvedValue(rows.map(({ id, followersCount }) => ({ id, followersCount })));
  mockDb.trackerSnapshotSource.findMany.mockResolvedValue(
    rows.filter((r) => r.connected).map((r) => ({ snapshotId: r.id })),
  );
}

function ops(): { model: string; op: string; args: any }[] {
  return mockDb.$transaction.mock.calls[0][0];
}
const find = (model: string, op: string) => ops().filter((o) => o.model === model && o.op === op);

beforeEach(() => {
  jest.clearAllMocks();
  mockTables.mockResolvedValue(true);
  mockRoster.mockResolvedValue(true);
  mockDb.creator.findUnique.mockResolvedValue({ platform: "YOUTUBE" });
  mockDb.creator.updateMany.mockImplementation(tag("creator", "updateMany"));
  mockDb.creatorTrackerSnapshot.deleteMany.mockImplementation(tag("snapshot", "deleteMany"));
  mockDb.creatorTrackerSnapshot.update.mockImplementation(tag("snapshot", "update"));
  mockDb.trackerSnapshotSource.deleteMany.mockImplementation(tag("source", "deleteMany"));
  mockDb.trackerReadingQuarantine.deleteMany.mockImplementation(tag("quarantine", "deleteMany"));
  mockDb.trackerReadingQuarantine.updateMany.mockImplementation(tag("quarantine", "updateMany"));
  mockDb.creatorProfileLink.updateMany.mockImplementation(tag("link", "updateMany"));
  mockDb.$transaction.mockImplementation(async (list: { op: string }[]) =>
    list.map((o, i) => (i === 0 ? { count: 2 } : i === 2 ? { count: 1 } : o)),
  );
});

describe("forgetConnectedReadings", () => {
  it("deletes only the snapshots the connection wrote, with their source rows", async () => {
    series([
      { id: "s1", followersCount: 1000 },
      { id: "s2", followersCount: 1210, connected: true },
      { id: "s3", followersCount: 1220, connected: true },
      { id: "s4", followersCount: 1150 },
    ]);
    const out = await forgetConnectedReadings("cr-1", "YOUTUBE");

    expect(mockDb.trackerSnapshotSource.findMany.mock.calls[0][0].where).toEqual({ creatorId: "cr-1", exitId: CONNECTED_VIA });
    expect(find("snapshot", "deleteMany")[0].args).toEqual({ where: { creatorId: "cr-1", id: { in: ["s2", "s3"] } } });
    expect(find("source", "deleteMany")[0].args).toEqual({ where: { creatorId: "cr-1", snapshotId: { in: ["s2", "s3"] } } });
    expect(out).toEqual({ snapshots: 2, quarantined: 1 });
  });

  it("re-measures the next public reading against the one before the removed run", async () => {
    series([
      { id: "s1", followersCount: 1000 },
      { id: "s2", followersCount: 1210, connected: true },
      { id: "s3", followersCount: 1150 },
      { id: "s4", followersCount: 1160 },
    ]);
    await forgetConnectedReadings("cr-1", "YOUTUBE");

    /* s3 stored 1150 - 1210 = -60, which with its own figure gives 1210 back. */
    const updates = find("snapshot", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].args).toEqual({ where: { id: "s3" }, data: { deltaFollowers: 150, velocityScore: 15 } });
  });

  it("zeroes the change of a public reading left with nothing before it", async () => {
    series([
      { id: "s1", followersCount: 900, connected: true },
      { id: "s2", followersCount: 950 },
    ]);
    await forgetConnectedReadings("cr-1", "YOUTUBE");
    expect(find("snapshot", "update")[0].args).toEqual({ where: { id: "s2" }, data: { deltaFollowers: 0, velocityScore: 0 } });
  });

  it("puts the roster figures back to the newest public reading when they hold the deleted one", async () => {
    series([
      { id: "s1", followersCount: 1000 },
      { id: "s2", followersCount: 1210, connected: true },
    ]);
    await forgetConnectedReadings("cr-1", "YOUTUBE");

    expect(find("creator", "updateMany")[0].args).toEqual({
      where: { id: "cr-1", followersCount: 1210 },
      data: { followersCount: 1000 },
    });
    expect(find("link", "updateMany")[0].args).toEqual({
      where: { creatorId: "cr-1", platform: "YOUTUBE", followersCount: 1210 },
      data: { followersCount: 1000 },
    });
  });

  it("leaves the roster figures as never read when no public reading is left", async () => {
    series([{ id: "s1", followersCount: 1210, connected: true }]);
    await forgetConnectedReadings("cr-1", "YOUTUBE");
    expect(find("creator", "updateMany")[0].args.data).toEqual({ followersCount: 0 });
    expect(find("link", "updateMany")[0].args.data).toEqual({ followersCount: null });
  });

  it("does not touch the roster figures when the newest reading was public", async () => {
    series([
      { id: "s1", followersCount: 1210, connected: true },
      { id: "s2", followersCount: 1150 },
    ]);
    await forgetConnectedReadings("cr-1", "YOUTUBE");
    expect(find("creator", "updateMany")).toHaveLength(0);
    expect(find("link", "updateMany")).toHaveLength(0);
  });

  it("deletes quarantined connected readings and clears a deleted figure kept as a previous value", async () => {
    series([
      { id: "s1", followersCount: 1000 },
      { id: "s2", followersCount: 1210, connected: true },
    ]);
    await forgetConnectedReadings("cr-1", "YOUTUBE");
    expect(find("quarantine", "deleteMany")[0].args).toEqual({ where: { creatorId: "cr-1", via: CONNECTED_VIA } });
    expect(find("quarantine", "updateMany")[0].args).toEqual({
      where: { creatorId: "cr-1", previousFollowers: { in: [1210] } },
      data: { previousFollowers: null },
    });
  });

  it("still deletes quarantined connected readings when no snapshot came from the connection", async () => {
    series([{ id: "s1", followersCount: 1000 }]);
    await forgetConnectedReadings("cr-1", "YOUTUBE");
    expect(mockDb.creatorTrackerSnapshot.findMany).not.toHaveBeenCalled();
    expect(find("quarantine", "deleteMany")).toHaveLength(1);
    expect(find("snapshot", "update")).toHaveLength(0);
    expect(find("creator", "updateMany")).toHaveLength(0);
  });

  it("deletes nothing for a platform the creator is not tracked on", async () => {
    mockDb.creator.findUnique.mockResolvedValue({ platform: "TIKTOK" });
    expect(await forgetConnectedReadings("cr-1", "YOUTUBE")).toEqual({ snapshots: 0, quarantined: 0 });
    expect(mockDb.trackerSnapshotSource.findMany).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("deletes nothing before the tracker source tables exist, and asks without the cache", async () => {
    mockTables.mockResolvedValue(false);
    expect(await forgetConnectedReadings("cr-1", "YOUTUBE")).toEqual({ snapshots: 0, quarantined: 0 });
    expect(mockTables).toHaveBeenCalledWith({ fresh: true });
    expect(mockDb.creator.findUnique).not.toHaveBeenCalled();
  });

  it("throws when the delete fails, so the disconnect fails with it", async () => {
    series([{ id: "s1", followersCount: 1210, connected: true }]);
    mockDb.$transaction.mockRejectedValue(new Error("db down"));
    await expect(forgetConnectedReadings("cr-1", "YOUTUBE")).rejects.toThrow("db down");
  });
});
