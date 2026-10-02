/**
 * @jest-environment node
 */
jest.mock("@/lib/creators/snapshot", () => ({ snapshotCreators: jest.fn() }));
jest.mock("@/lib/trackers/sourceSwitch", () => ({
  ...jest.requireActual("@/lib/trackers/sourceSwitch"),
  recordSourceHealth: jest.fn().mockResolvedValue(true),
}));
jest.mock("@/lib/db", () => ({ db: {} }));

import { snapshotCreators } from "@/lib/creators/snapshot";
import { recordSourceHealth, type ResolvedTrackerPlan } from "@/lib/trackers/sourceSwitch";
import { runReaderV2, summariseExits } from "@/lib/trackers/readerRun";
import type { TikTokExit } from "@/lib/platforms/tiktokExit";

const mockSweep = snapshotCreators as jest.Mock;
type SweepOptions = NonNullable<Parameters<typeof snapshotCreators>[0]>;
const mockHealth = recordSourceHealth as jest.Mock;

const PROFILE = (followers: number) =>
  `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
    __DEFAULT_SCOPE__: {
      "webapp.user-detail": {
        statusCode: 0,
        userInfo: { user: { uniqueId: "brand", id: "1" }, stats: { followerCount: followers, videoCount: 10, heartCount: 5 } },
      },
    },
  })}</script></html>`;

function fakeExit(id: string, closed: string[]): TikTokExit {
  return {
    id,
    kind: "sandbox",
    fetchPage: async () => ({ status: 200, body: PROFILE(1234), ms: 5 }),
    close: async () => {
      closed.push(id);
    },
  };
}

const planA: ResolvedTrackerPlan = {
  position: "A",
  effective: "A",
  scopeOrgIds: ["org-small"],
  percent: 100,
  changedAt: null,
  changedBy: null,
  reason: null,
};

beforeEach(() => jest.clearAllMocks());

describe("runReaderV2", () => {
  it("refuses to run as legacy", async () => {
    await expect(runReaderV2({ plan: { ...planA, effective: "legacy" } })).rejects.toThrow(/legacy/);
  });

  it("opens lanes sized to the due TikTok queue, reads through them, closes them, and records a run", async () => {
    const closed: string[] = [];
    const reads: { result: { ok: boolean }; via: string | null }[] = [];
    mockSweep.mockImplementation(async (opts: SweepOptions) => {
      await opts.onSelected!({ total: 3, byPlatform: { TIKTOK: 3 }, tiktokPostsStale: 0 });
      for (const h of ["a", "b", "c"]) reads.push(await opts.readTikTokProfileVia!(h));
      return { snapshots: 3, failed: 0, skipped: 0 };
    });

    const r = await runReaderV2({ plan: planA, makeExit: (slot, gen) => fakeExit(`lane-${slot}#${gen}`, closed) });

    const opts = mockSweep.mock.calls[0][0];
    expect(opts).toMatchObject({ plan: "A", orgIdsIn: ["org-small"], inScope: undefined });
    expect(r.lanes).toBe(1);
    expect(reads.every((x) => x.result.ok)).toBe(true);
    expect(reads[0].via).toBe("lane-0#1");
    expect(closed).toEqual(["lane-0#1"]);
    expect(r.health).toMatchObject({ plan: "A", kind: "run", reads: 3, proper: 3, ok: true });
    expect(mockHealth).toHaveBeenCalledTimes(1);
  });

  it("opens no lanes when nothing on TikTok is due, and still records a healthy run", async () => {
    const makeExit = jest.fn();
    mockSweep.mockImplementation(async (opts: SweepOptions) => {
      await opts.onSelected!({ total: 2, byPlatform: { INSTAGRAM: 2 }, tiktokPostsStale: 0 });
      return { snapshots: 2, failed: 0, skipped: 0 };
    });

    const r = await runReaderV2({ plan: planA, makeExit });

    expect(makeExit).not.toHaveBeenCalled();
    expect(r.lanes).toBe(0);
    expect(r.health.ok).toBe(true);
  });

  it("passes the percentage filter only when the rollout is partial", async () => {
    mockSweep.mockResolvedValue({ snapshots: 0, failed: 0, skipped: 0 });
    await runReaderV2({ plan: { ...planA, percent: 25 }, makeExit: jest.fn() });
    expect(typeof mockSweep.mock.calls[0][0].inScope).toBe("function");
  });

  it("closes the lanes even when the sweep throws", async () => {
    const closed: string[] = [];
    mockSweep.mockImplementation(async (opts: SweepOptions) => {
      await opts.onSelected!({ total: 1, byPlatform: { TIKTOK: 1 }, tiktokPostsStale: 0 });
      throw new Error("db gone");
    });
    await expect(runReaderV2({ plan: planA, makeExit: (s, g) => fakeExit(`l${s}#${g}`, closed) })).rejects.toThrow("db gone");
    expect(closed).toEqual(["l0#1"]);
  });

  it("refuses B with no worker configured", async () => {
    delete process.env.TRACKER_PLAN_B_URL;
    await expect(runReaderV2({ plan: { ...planA, position: "B", effective: "B" } })).rejects.toThrow(/not configured/);
  });
});

describe("summariseExits", () => {
  it("is ok at 97% and not below", () => {
    const e = (proper: number, walls: number, failures: number) => ({
      exitId: "x",
      kind: "sandbox" as const,
      pages: proper + walls,
      proper,
      walls,
      failures,
      latenciesMs: [100, 200, 300],
    });
    expect(summariseExits([e(97, 3, 0)]).ok).toBe(true);
    expect(summariseExits([e(96, 3, 1)]).ok).toBe(false);
    expect(summariseExits([]).ok).toBe(true);
    expect(summariseExits([e(10, 0, 0)]).medianMs).toBe(200);
  });
});
