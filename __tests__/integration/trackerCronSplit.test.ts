/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({ db: {} }));
jest.mock("@/lib/creators/snapshot", () => ({ snapshotCreators: jest.fn() }));
jest.mock("@/lib/platforms/tiktokTopPostsBrowser", () => ({
  openTopPostsSession: () => ({ read: jest.fn(), close: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock("@/lib/platforms/tiktokProfileSandbox", () => ({
  openSandboxProfileFetcher: () => ({ read: jest.fn(), readEmbedHtml: jest.fn(), close: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock("@/lib/trackers/sourceSwitch", () => ({
  ...jest.requireActual("@/lib/trackers/sourceSwitch"),
  resolveTrackerPlan: jest.fn(),
}));
jest.mock("@/lib/trackers/readerRun", () => ({ runReaderV2: jest.fn() }));
jest.mock("@/lib/trackers/readerAlerts", () => ({ checkReaderAlerts: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/alerts", () => ({ alertOps: jest.fn() }));

import { GET as legacyGET } from "@/app/api/cron/sync-creator-trackers/route";
import { GET as v2GET } from "@/app/api/cron/read-creator-trackers/route";
import { snapshotCreators } from "@/lib/creators/snapshot";
import { resolveTrackerPlan, type ResolvedTrackerPlan } from "@/lib/trackers/sourceSwitch";
import { runReaderV2 } from "@/lib/trackers/readerRun";
import { alertOps } from "@/lib/alerts";

const mockSweep = snapshotCreators as jest.Mock;
const mockPlan = resolveTrackerPlan as jest.Mock;
const mockRun = runReaderV2 as jest.Mock;

const plan = (over: Partial<ResolvedTrackerPlan>): ResolvedTrackerPlan => ({
  position: "legacy",
  effective: "legacy",
  scopeOrgIds: [],
  percent: 100,
  changedAt: null,
  changedBy: null,
  reason: null,
  ...over,
});
const req = (path: string) =>
  new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });

beforeAll(() => {
  process.env.CRON_SECRET = "cron-test";
});
beforeEach(() => {
  jest.clearAllMocks();
  mockSweep.mockResolvedValue({ snapshots: 1, failed: 0, skipped: 0 });
  mockRun.mockResolvedValue({
    plan: "A",
    counts: { snapshots: 1, failed: 0, skipped: 0 },
    dueTikTok: 1,
    lanes: 1,
    maxWallStreak: 0,
    exits: [],
    health: { reads: 1, proper: 1, walls: 0, failures: 0, ok: true },
  });
});

describe("the two tracker crons share the creators between them", () => {
  it("legacy: the old sweep reads everyone and reader v2 does nothing", async () => {
    mockPlan.mockResolvedValue(plan({}));
    await legacyGET(req("/api/cron/sync-creator-trackers"));
    const opts = mockSweep.mock.calls[0][0];
    expect(opts.orgIdsNotIn).toBeUndefined();
    expect(opts.inScope).toBeUndefined();

    const res = await v2GET(req("/api/cron/read-creator-trackers"));
    expect(await res.json()).toMatchObject({ ran: false });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("A on one org: the old sweep leaves that org out, reader v2 reads it", async () => {
    mockPlan.mockResolvedValue(plan({ position: "A", effective: "A", scopeOrgIds: ["org-small"] }));
    await legacyGET(req("/api/cron/sync-creator-trackers"));
    expect(mockSweep.mock.calls[0][0].orgIdsNotIn).toEqual(["org-small"]);

    const res = await v2GET(req("/api/cron/read-creator-trackers"));
    expect(await res.json()).toMatchObject({ ran: true, plan: "A" });
  });

  it("A at 10%: the old sweep reads exactly the complement", async () => {
    const p = plan({ position: "A", effective: "A", percent: 10 });
    mockPlan.mockResolvedValue(p);
    await legacyGET(req("/api/cron/sync-creator-trackers"));
    const { inScope } = mockSweep.mock.calls[0][0];
    const { inReaderV2Scope } = jest.requireActual("@/lib/trackers/sourceSwitch");
    for (let i = 0; i < 200; i++) {
      const c = { id: `creator-${i}`, orgId: "o" };
      expect(inScope(c)).toBe(!inReaderV2Scope(p, c));
    }
  });

  it("A on everything: the old sweep stands down", async () => {
    mockPlan.mockResolvedValue(plan({ position: "A", effective: "A" }));
    const res = await legacyGET(req("/api/cron/sync-creator-trackers"));
    expect(await res.json()).toMatchObject({ ran: false });
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("a failed reader v2 run alerts the operator and answers 500", async () => {
    mockPlan.mockResolvedValue(plan({ position: "A", effective: "A" }));
    mockRun.mockRejectedValue(new Error("sandbox quota"));
    const res = await v2GET(req("/api/cron/read-creator-trackers"));
    expect(res.status).toBe(500);
    expect(alertOps).toHaveBeenCalledWith(expect.objectContaining({ source: "tracker-reader", severity: "critical" }));
  });

  it("both refuse a request without the cron secret", async () => {
    const bad = new NextRequest("http://localhost/x");
    expect((await legacyGET(bad)).status).toBe(401);
    expect((await v2GET(bad)).status).toBe(401);
  });
});
