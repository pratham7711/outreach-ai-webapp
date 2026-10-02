/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
    trackerSourceSwitch: { findUnique: jest.fn(), upsert: jest.fn() },
    trackerSourceSwitchLog: { create: jest.fn() },
    trackerSourceHealth: { findFirst: jest.fn(), create: jest.fn() },
    trackerSnapshotSource: { createMany: jest.fn() },
  },
}));

import { db } from "@/lib/db";
import {
  inReaderV2Scope,
  planBWorkerConfig,
  resetTrackerSourceTablesCache,
  resolveTrackerPlan,
  rolloutBucket,
  setTrackerSwitch,
  type ResolvedTrackerPlan,
} from "@/lib/trackers/sourceSwitch";

const mockDb = db as unknown as {
  $queryRawUnsafe: jest.Mock;
  $transaction: jest.Mock;
  trackerSourceSwitch: { findUnique: jest.Mock };
  trackerSourceHealth: { findFirst: jest.Mock };
};
const tablesPresent = () => mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 5 }]);
const tablesAbsent = () => mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
const B_ENV = { TRACKER_PLAN_B_URL: "https://worker.example", TRACKER_PLAN_B_TOKEN: "t" } as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  jest.clearAllMocks();
  resetTrackerSourceTablesCache();
  mockDb.$transaction.mockResolvedValue([{}, {}]);
  delete process.env.TRACKER_PLAN_B_URL;
  delete process.env.TRACKER_PLAN_B_TOKEN;
});

describe("resolveTrackerPlan -- anything wrong resolves to legacy", () => {
  it("is legacy while the tables are absent", async () => {
    tablesAbsent();
    await expect(resolveTrackerPlan()).resolves.toMatchObject({ position: "legacy", effective: "legacy" });
    expect(mockDb.trackerSourceSwitch.findUnique).not.toHaveBeenCalled();
  });

  it("is legacy when the switch read throws", async () => {
    tablesPresent();
    mockDb.trackerSourceSwitch.findUnique.mockRejectedValue(new Error("connection reset"));
    await expect(resolveTrackerPlan()).resolves.toMatchObject({ effective: "legacy" });
  });

  it("is legacy when the row holds an unknown position", async () => {
    tablesPresent();
    mockDb.trackerSourceSwitch.findUnique.mockResolvedValue({ position: "C", scopeOrgIds: [], percent: 100 });
    await expect(resolveTrackerPlan()).resolves.toMatchObject({ effective: "legacy" });
  });

  it("runs A as switched", async () => {
    tablesPresent();
    mockDb.trackerSourceSwitch.findUnique.mockResolvedValue({ position: "A", scopeOrgIds: ["org-small"], percent: 100, changedAt: new Date(), changedBy: "op" });
    await expect(resolveTrackerPlan()).resolves.toMatchObject({ position: "A", effective: "A", scopeOrgIds: ["org-small"] });
  });

  it("falls back to legacy when B is selected but this deployment has no worker configured", async () => {
    tablesPresent();
    mockDb.trackerSourceSwitch.findUnique.mockResolvedValue({ position: "B", scopeOrgIds: [], percent: 100 });
    const plan = await resolveTrackerPlan({} as NodeJS.ProcessEnv);
    expect(plan).toMatchObject({ position: "B", effective: "legacy" });
    expect(plan.reason).toMatch(/TRACKER_PLAN_B_URL/);
    await expect(resolveTrackerPlan(B_ENV)).resolves.toMatchObject({ effective: "B" });
  });
});

describe("rollout scope", () => {
  const plan = (over: Partial<ResolvedTrackerPlan>): ResolvedTrackerPlan => ({
    position: "A",
    effective: "A",
    scopeOrgIds: [],
    percent: 100,
    changedAt: null,
    changedBy: null,
    reason: null,
    ...over,
  });

  it("buckets are stable and roughly even", () => {
    expect(rolloutBucket("creator-abc")).toBe(rolloutBucket("creator-abc"));
    const ids = Array.from({ length: 2000 }, (_, i) => `c${i}x${i * 7919}`);
    const under10 = ids.filter((id) => rolloutBucket(id) < 10).length;
    expect(under10).toBeGreaterThan(140);
    expect(under10).toBeLessThan(260);
  });

  it("reads only the scoped orgs, and only the percentage of their creators", () => {
    const p = plan({ scopeOrgIds: ["lkm"], percent: 10 });
    expect(inReaderV2Scope(p, { id: "x", orgId: "other" })).toBe(false);
    const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
    const inScope = ids.filter((id) => inReaderV2Scope(p, { id, orgId: "lkm" }));
    expect(inScope.length).toBeGreaterThan(60);
    expect(inScope.length).toBeLessThan(140);
  });

  it("is never in scope while effective is legacy", () => {
    expect(inReaderV2Scope(plan({ effective: "legacy" }), { id: "x", orgId: "o" })).toBe(false);
  });
});

describe("setTrackerSwitch", () => {
  beforeEach(() => {
    tablesPresent();
    mockDb.trackerSourceSwitch.findUnique.mockResolvedValue(null);
  });

  it("always allows legacy and A", async () => {
    for (const position of ["legacy", "A"] as const) {
      const r = await setTrackerSwitch({ position, changedBy: "op@example.com" });
      expect(r.ok).toBe(true);
    }
    expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
  });

  it("refuses B with no daily check, a failed one, or one older than 36 hours", async () => {
    Object.assign(process.env, B_ENV);
    const now = Date.parse("2026-10-02T12:00:00Z");
    for (const last of [
      null,
      { finishedAt: new Date(now - 60 * 60 * 1000), ok: false },
      { finishedAt: new Date(now - 37 * 60 * 60 * 1000), ok: true },
    ]) {
      mockDb.trackerSourceHealth.findFirst.mockResolvedValueOnce(last);
      const r = await setTrackerSwitch({ position: "B", changedBy: "op" }, now);
      expect(r.ok).toBe(false);
    }
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("allows B on a fresh passing check with the worker configured", async () => {
    Object.assign(process.env, B_ENV);
    const now = Date.parse("2026-10-02T12:00:00Z");
    mockDb.trackerSourceHealth.findFirst.mockResolvedValueOnce({ finishedAt: new Date(now - 3 * 60 * 60 * 1000), ok: true });
    const r = await setTrackerSwitch({ position: "B", changedBy: "op" }, now);
    expect(r.ok).toBe(true);
  });

  it("refuses everything while the tables are absent", async () => {
    resetTrackerSourceTablesCache();
    tablesAbsent();
    await expect(setTrackerSwitch({ position: "A", changedBy: "op" })).resolves.toMatchObject({ ok: false });
  });
});

describe("planBWorkerConfig", () => {
  it("needs both a URL and a token", () => {
    expect(planBWorkerConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(planBWorkerConfig({ TRACKER_PLAN_B_URL: "https://w" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(planBWorkerConfig(B_ENV)).toEqual({ baseUrl: "https://worker.example", token: "t" });
  });
});
