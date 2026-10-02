/**
 * @jest-environment node
 *
 * Who wrote Creator.followersCount, read from what the tracker already stores
 * (plan A7): a public read leaves a connected figure alone inside the field's
 * freshness window, and only then.
 */
jest.mock("@/lib/db", () => ({
  db: {
    creatorTrackerSnapshot: { findFirst: jest.fn() },
    trackerSnapshotSource: { findUnique: jest.fn() },
  },
}));
jest.mock("@/lib/trackers/sourceSwitch", () => ({ trackerSourceTablesReady: jest.fn() }));

import { db } from "@/lib/db";
import { trackerSourceTablesReady } from "@/lib/trackers/sourceSwitch";
import { CONNECTED_VIA, protectedCreatorFollowers } from "@/lib/creators/followerWriter";

const mockDb = db as any;
const NOW = new Date("2026-10-02T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

function latest(exitId: string | null, recordedAt: Date, followersCount = 2047) {
  mockDb.creatorTrackerSnapshot.findFirst.mockResolvedValue({ id: "snap-1", followersCount, recordedAt });
  mockDb.trackerSnapshotSource.findUnique.mockResolvedValue(exitId === null ? null : { exitId });
}

beforeEach(() => {
  jest.clearAllMocks();
  (trackerSourceTablesReady as jest.Mock).mockResolvedValue(true);
});

describe("protectedCreatorFollowers", () => {
  it("protects a connected figure the tracker wrote inside the window", async () => {
    latest(CONNECTED_VIA, hoursAgo(5));
    expect(await protectedCreatorFollowers("c1", NOW)).toBe(2047);
    expect(mockDb.creatorTrackerSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { creatorId: "c1" }, orderBy: { recordedAt: "desc" } }),
    );
    expect(mockDb.trackerSnapshotSource.findUnique.mock.calls[0][0].where).toEqual({ snapshotId: "snap-1" });
  });

  it("lets a public read replace a connected figure older than the window", async () => {
    latest(CONNECTED_VIA, hoursAgo(37));
    expect(await protectedCreatorFollowers("c1", NOW)).toBeNull();
  });

  it("protects nothing when the latest snapshot was a public read", async () => {
    latest("tiktok-sandbox", hoursAgo(1));
    expect(await protectedCreatorFollowers("c1", NOW)).toBeNull();
  });

  it("protects nothing under the legacy sweep, which records no exit", async () => {
    latest(null, hoursAgo(1));
    expect(await protectedCreatorFollowers("c1", NOW)).toBeNull();
  });

  it("protects nothing for a creator never tracked", async () => {
    mockDb.creatorTrackerSnapshot.findFirst.mockResolvedValue(null);
    expect(await protectedCreatorFollowers("c1", NOW)).toBeNull();
  });

  it("protects nothing, without asking, before the source tables exist", async () => {
    (trackerSourceTablesReady as jest.Mock).mockResolvedValue(false);
    expect(await protectedCreatorFollowers("c1", NOW)).toBeNull();
    expect(mockDb.creatorTrackerSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it("answers null rather than throwing when a lookup fails", async () => {
    mockDb.creatorTrackerSnapshot.findFirst.mockRejectedValue(new Error("db down"));
    await expect(protectedCreatorFollowers("c1", NOW)).resolves.toBeNull();
  });
});
