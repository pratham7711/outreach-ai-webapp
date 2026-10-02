/**
 * @jest-environment node
 *
 * The cron wrapper, on a real cron route: a killed job answers 200 skipped
 * without running, a run leaves a start and a finish heartbeat, and neither
 * the switch nor the heartbeat is reachable without the cron secret.
 */
jest.mock("@/lib/db", () => ({
  db: {
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    orgViewsSnapshot: { upsert: jest.fn() },
    opsKillSwitch: { findMany: jest.fn() },
    opsCronHeartbeat: { upsert: jest.fn(), update: jest.fn() },
  },
}));
jest.mock("@/lib/alerts", () => ({ alertOps: jest.fn().mockResolvedValue(undefined) }));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { GET } from "@/app/api/cron/snapshot-org-views/route";
import { resetOpsTablesCache } from "@/lib/ops/opsTables";
import { resetKillSwitchCache } from "@/lib/ops/killSwitch";

const mockDb = db as unknown as {
  $queryRaw: jest.Mock;
  $queryRawUnsafe: jest.Mock;
  orgViewsSnapshot: { upsert: jest.Mock };
  opsKillSwitch: { findMany: jest.Mock };
  opsCronHeartbeat: { upsert: jest.Mock; update: jest.Mock };
};

const realUrl = process.env.DATABASE_URL;
beforeEach(() => {
  jest.clearAllMocks();
  resetOpsTablesCache();
  resetKillSwitchCache();
  process.env.CRON_SECRET = "test-secret";
  process.env.DATABASE_URL = "postgres://test.invalid/db";
  mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 6 }]);
  mockDb.$queryRaw.mockResolvedValue([]);
  mockDb.opsKillSwitch.findMany.mockResolvedValue([]);
  mockDb.opsCronHeartbeat.upsert.mockResolvedValue({ job: "snapshot-org-views" });
  mockDb.opsCronHeartbeat.update.mockResolvedValue({ job: "snapshot-org-views" });
});
afterAll(() => {
  process.env.DATABASE_URL = realUrl;
});

const call = (query = "", auth = "Bearer test-secret") =>
  GET(
    new NextRequest(`http://localhost/api/cron/snapshot-org-views${query}`, {
      headers: auth ? { authorization: auth } : {},
    }),
  );

describe("cronRoute on snapshot-org-views", () => {
  it("skips a killed job with 200 and does none of its work", async () => {
    mockDb.opsKillSwitch.findMany.mockResolvedValue([
      { key: "cron:snapshot-org-views", off: true, reason: "test", updatedBy: "ops@example.com", updatedAt: new Date(0) },
    ]);

    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "killed", job: "snapshot-org-views" });
    expect(mockDb.$queryRaw).not.toHaveBeenCalled();
    expect(mockDb.opsCronHeartbeat.upsert).not.toHaveBeenCalled();
  });

  it("runs and records a start and a successful finish", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockDb.$queryRaw).toHaveBeenCalled();
    expect(mockDb.opsCronHeartbeat.upsert).toHaveBeenCalledTimes(1);
    expect(mockDb.opsCronHeartbeat.upsert.mock.calls[0][0].where).toEqual({ job: "snapshot-org-views" });
    expect(mockDb.opsCronHeartbeat.update).toHaveBeenCalledTimes(1);
    expect(mockDb.opsCronHeartbeat.update.mock.calls[0][0].data).toMatchObject({ lastOk: true, lastError: null });
  });

  it("records a failed finish with the response body when the job answers 500", async () => {
    mockDb.$queryRaw.mockRejectedValue(new Error("boom"));
    const res = await call();
    expect(res.status).toBe(500);
    const data = mockDb.opsCronHeartbeat.update.mock.calls[0][0].data;
    expect(data.lastOk).toBe(false);
    expect(data.lastError).toContain("HTTP 500");
    expect(data.consecutiveFailures).toEqual({ increment: 1 });
  });

  it("still runs the job when the heartbeat writes fail", async () => {
    mockDb.opsCronHeartbeat.upsert.mockRejectedValue(new Error("connection reset"));
    mockDb.opsCronHeartbeat.update.mockRejectedValue(new Error("connection reset"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockDb.$queryRaw).toHaveBeenCalled();
  });

  it("runs the job when the switch table is unreadable", async () => {
    mockDb.opsKillSwitch.findMany.mockRejectedValue(new Error("relation does not exist"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockDb.$queryRaw).toHaveBeenCalled();
  });

  it("writes no heartbeat for a dry run", async () => {
    await call("?dryRun=1");
    expect(mockDb.opsCronHeartbeat.upsert).not.toHaveBeenCalled();
    expect(mockDb.opsCronHeartbeat.update).not.toHaveBeenCalled();
  });

  it("answers 401 without the secret, before reading a switch or writing a heartbeat", async () => {
    const res = await call("", "Bearer wrong");
    expect(res.status).toBe(401);
    expect(mockDb.opsKillSwitch.findMany).not.toHaveBeenCalled();
    expect(mockDb.opsCronHeartbeat.upsert).not.toHaveBeenCalled();
  });
});
