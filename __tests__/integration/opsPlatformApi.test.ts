/**
 * @jest-environment node
 *
 * /api/platform/ops: platform admins only (404 for everyone else, before any
 * read), a kill switch flip is written with its log row and comes back in the
 * report, and a breaker can be closed by hand. Keys are validated against the
 * known set, never taken on trust.
 */
const mockAuth = jest.fn();
jest.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));
jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
    opsKillSwitch: { findMany: jest.fn(), upsert: jest.fn() },
    opsKillSwitchLog: { findMany: jest.fn(), create: jest.fn() },
    opsCronHeartbeat: { findMany: jest.fn() },
    opsSourceBreaker: { findMany: jest.fn(), upsert: jest.fn() },
    opsSandboxDay: { findMany: jest.fn() },
    opsMeterWeek: { findMany: jest.fn() },
  },
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/platform/ops/route";
import { resetOpsTablesCache } from "@/lib/ops/opsTables";
import { resetKillSwitchCache } from "@/lib/ops/killSwitch";

type M = jest.Mock;
const mockDb = db as unknown as {
  $queryRawUnsafe: M;
  $transaction: M;
  opsKillSwitch: { findMany: M; upsert: M };
  opsKillSwitchLog: { findMany: M; create: M };
  opsCronHeartbeat: { findMany: M };
  opsSourceBreaker: { findMany: M; upsert: M };
  opsSandboxDay: { findMany: M };
  opsMeterWeek: { findMany: M };
};

const realUrl = process.env.DATABASE_URL;
const realAdmins = process.env.PLATFORM_ADMIN_EMAILS;
let switches: { key: string; off: boolean; reason: string | null; updatedBy: string | null; updatedAt: Date }[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  resetOpsTablesCache();
  resetKillSwitchCache();
  switches = [];
  process.env.DATABASE_URL = "postgres://test.invalid/db";
  process.env.PLATFORM_ADMIN_EMAILS = "ops@example.com";
  mockAuth.mockResolvedValue({ user: { email: "ops@example.com" } });
  mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 6 }]);
  mockDb.opsKillSwitch.findMany.mockImplementation(async () => switches);
  mockDb.opsKillSwitch.upsert.mockImplementation((a: { create: (typeof switches)[number] }) => a);
  mockDb.opsKillSwitchLog.create.mockImplementation((a: unknown) => a);
  mockDb.$transaction.mockImplementation(async (ops: { create: (typeof switches)[number] }[]) => {
    const s = ops[0].create;
    switches = [...switches.filter((x) => x.key !== s.key), s];
    return ops;
  });
  mockDb.opsKillSwitchLog.findMany.mockResolvedValue([]);
  mockDb.opsCronHeartbeat.findMany.mockResolvedValue([]);
  mockDb.opsSourceBreaker.findMany.mockResolvedValue([]);
  mockDb.opsSourceBreaker.upsert.mockResolvedValue({ key: "x" });
  mockDb.opsSandboxDay.findMany.mockResolvedValue([]);
  mockDb.opsMeterWeek.findMany.mockResolvedValue([]);
});
afterAll(() => {
  process.env.DATABASE_URL = realUrl;
  process.env.PLATFORM_ADMIN_EMAILS = realAdmins;
});

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/platform/ops", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe("/api/platform/ops", () => {
  it("is 404 for a signed-in user who is not a platform admin, and reads nothing", async () => {
    mockAuth.mockResolvedValue({ user: { email: "agency@example.com" } });
    expect((await GET()).status).toBe(404);
    expect((await post({ action: "kill-switch", key: "cron:sync-posts", off: true })).status).toBe(404);
    expect(mockDb.opsKillSwitch.findMany).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("is 404 signed out", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
  });

  it("reports every job, switch and breaker", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.tablesReady).toBe(true);
    expect(r.jobs.map((j: { job: string }) => j.job)).toContain("ops-canary");
    expect(r.jobs.every((j: { health: string }) => j.health === "no-heartbeat")).toBe(true);
    expect(r.switches.filter((s: { kind: string }) => s.kind === "source")).toHaveLength(3);
    expect(r.breakers).toHaveLength(6);
    expect(r.sandbox).toMatchObject({ used: 0, cap: 600 });
  });

  it("turns a job off, logs who did it, and shows it killed", async () => {
    const res = await post({ action: "kill-switch", key: "cron:sync-posts", off: true, reason: "investigating" });
    expect(res.status).toBe(200);
    const { report } = await res.json();
    expect(mockDb.opsKillSwitchLog.create.mock.calls[0][0].data).toMatchObject({
      key: "cron:sync-posts",
      off: true,
      reason: "investigating",
      changedBy: "ops@example.com",
    });
    expect(report.jobs.find((j: { job: string }) => j.job === "sync-posts").health).toBe("killed");
    expect(report.switches.find((s: { key: string }) => s.key === "cron:sync-posts").off).toBe(true);
  });

  it("refuses an unknown key or a missing off", async () => {
    expect((await post({ action: "kill-switch", key: "cron:drop-everything", off: true })).status).toBe(400);
    expect((await post({ action: "kill-switch", key: "cron:sync-posts" })).status).toBe(400);
    expect((await post({ action: "reset-breaker", key: "post-reads:myspace" })).status).toBe(400);
    expect((await post({ action: "explode" })).status).toBe(400);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("answers 409 while the ops tables are not applied", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    expect((await post({ action: "kill-switch", key: "cron:sync-posts", off: true })).status).toBe(409);
  });

  it("closes a breaker by hand", async () => {
    const res = await post({ action: "reset-breaker", key: "post-reads:tiktok" });
    expect(res.status).toBe(200);
    expect(mockDb.opsSourceBreaker.upsert.mock.calls[0][0]).toMatchObject({
      where: { key: "post-reads:tiktok" },
      update: { state: "closed", consecutiveFailures: 0 },
    });
  });
});
