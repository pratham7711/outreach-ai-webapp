/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    trackerReadingQuarantine: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  },
}));

import { db } from "@/lib/db";
import { gateFollowerReading, judgeFollowerReading } from "@/lib/trackers/readingGate";
import { resetTrackerSourceTablesCache } from "@/lib/trackers/sourceSwitch";

const mockDb = db as unknown as {
  $queryRawUnsafe: jest.Mock;
  trackerReadingQuarantine: { findFirst: jest.Mock; updateMany: jest.Mock; create: jest.Mock };
};
const NOW = Date.parse("2026-10-02T12:00:00Z");

describe("judgeFollowerReading", () => {
  it("writes ordinary movement and a first reading", () => {
    expect(judgeFollowerReading(null, { followersCount: 5000 })).toEqual({ action: "write" });
    expect(judgeFollowerReading({ followersCount: 5000 }, { followersCount: 5400 })).toEqual({ action: "write" });
    expect(judgeFollowerReading({ followersCount: 5000 }, { followersCount: 2600 })).toEqual({ action: "write" });
  });

  it("rejects a count that is not a count, and a fall to zero", () => {
    expect(judgeFollowerReading({ followersCount: 10 }, { followersCount: NaN }).action).toBe("reject");
    expect(judgeFollowerReading({ followersCount: 10 }, { followersCount: -1 }).action).toBe("reject");
    expect(judgeFollowerReading({ followersCount: 120_000 }, { followersCount: 0 })).toMatchObject({ action: "reject" });
  });

  it("holds a drop over half and a jump over three times", () => {
    expect(judgeFollowerReading({ followersCount: 10_000 }, { followersCount: 4_000 })).toMatchObject({ action: "hold", reason: "drop of 60%" });
    expect(judgeFollowerReading({ followersCount: 10_000 }, { followersCount: 35_000 })).toMatchObject({ action: "hold", reason: "jump of 3.5x" });
  });

  it("does not hold small accounts", () => {
    expect(judgeFollowerReading({ followersCount: 40 }, { followersCount: 130 })).toEqual({ action: "write" });
  });

  it("writes a surprising reading once a second read agrees with the held one", () => {
    const held = { id: "q1", followersCount: 35_500, recordedAt: new Date(NOW - 60 * 60 * 1000) };
    expect(judgeFollowerReading({ followersCount: 10_000 }, { followersCount: 35_000 }, held, NOW)).toEqual({
      action: "write",
      confirmsHeldId: "q1",
    });
  });

  it("keeps holding when the second read disagrees, or the held one is stale", () => {
    const disagree = { id: "q1", followersCount: 60_000, recordedAt: new Date(NOW - 60 * 60 * 1000) };
    expect(judgeFollowerReading({ followersCount: 10_000 }, { followersCount: 35_000 }, disagree, NOW).action).toBe("hold");
    const stale = { id: "q1", followersCount: 35_000, recordedAt: new Date(NOW - 8 * 24 * 60 * 60 * 1000) };
    expect(judgeFollowerReading({ followersCount: 10_000 }, { followersCount: 35_000 }, stale, NOW).action).toBe("hold");
  });
});

describe("gateFollowerReading", () => {
  const creator = { id: "c1", orgId: "o1", platform: "TIKTOK" };
  beforeEach(() => {
    jest.clearAllMocks();
    resetTrackerSourceTablesCache();
    mockDb.trackerReadingQuarantine.updateMany.mockResolvedValue({ count: 0 });
    mockDb.trackerReadingQuarantine.create.mockResolvedValue({ id: "new" });
  });

  it("costs no query for an ordinary reading", async () => {
    const v = await gateFollowerReading({ creator, previous: { followersCount: 1000 }, next: { followersCount: 1010, postsCount: 3 }, via: "A:iad1:0#1" }, NOW);
    expect(v.action).toBe("write");
    expect(mockDb.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("quarantines a held reading and supersedes the last open hold", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 5 }]);
    mockDb.trackerReadingQuarantine.findFirst.mockResolvedValue(null);
    const v = await gateFollowerReading({ creator, previous: { followersCount: 10_000 }, next: { followersCount: 40_000, postsCount: 3 }, via: "A:x" }, NOW);
    expect(v.action).toBe("hold");
    expect(mockDb.trackerReadingQuarantine.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resolution: "superseded" }) }));
    expect(mockDb.trackerReadingQuarantine.create.mock.calls[0][0].data).toMatchObject({ verdict: "held", followersCount: 40_000, previousFollowers: 10_000, via: "A:x" });
  });

  it("confirms on the second agreeing read", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 5 }]);
    mockDb.trackerReadingQuarantine.findFirst.mockResolvedValue({ id: "q1", followersCount: 40_200, recordedAt: new Date(NOW - 3600_000) });
    const v = await gateFollowerReading({ creator, previous: { followersCount: 10_000 }, next: { followersCount: 40_000, postsCount: 3 }, via: null }, NOW);
    expect(v).toEqual({ action: "write", confirmsHeldId: "q1" });
    expect(mockDb.trackerReadingQuarantine.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resolution: "confirmed" }) }));
    expect(mockDb.trackerReadingQuarantine.create).not.toHaveBeenCalled();
  });

  it("degrades a hold to today's write when the quarantine table is absent", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    const v = await gateFollowerReading({ creator, previous: { followersCount: 10_000 }, next: { followersCount: 40_000, postsCount: 3 }, via: null }, NOW);
    expect(v.action).toBe("write");
  });

  it("rejects a fall to zero even without the table", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    const v = await gateFollowerReading({ creator, previous: { followersCount: 10_000 }, next: { followersCount: 0, postsCount: 0 }, via: null }, NOW);
    expect(v.action).toBe("reject");
    expect(mockDb.trackerReadingQuarantine.create).not.toHaveBeenCalled();
  });
});
