/**
 * @jest-environment node
 *
 * The overdue-crons list the Plan B backup scheduler polls (plan §13 B): one
 * missed firing plus grace, killed jobs never listed, and nothing but job
 * names, paths and minutes behind a token of its own.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
const queryRaw = jest.fn();
const heartbeats = jest.fn();
const switches = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a),
    opsCronHeartbeat: { findMany: (...a: unknown[]) => heartbeats(...a) },
    opsKillSwitch: { findMany: (...a: unknown[]) => switches(...a) },
  },
}));

import { GET } from "@/app/api/ops/overdue-crons/route";
import { CRON_JOBS, cronCadenceMinutes } from "@/lib/ops/cronJobs";
import { resetKillSwitchCache } from "@/lib/ops/killSwitch";
import { SCHEDULER_GRACE_MINUTES, selectOverdueCrons } from "@/lib/ops/overdueCrons";
import { resetOpsTablesCache } from "@/lib/ops/opsTables";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000);
const LONG_AGO = ago(60 * 24 * 30);

/** Every job started on time except the ones named, which started `minutes` ago. */
function beats(late: Record<string, number> = {}) {
  return CRON_JOBS.map(({ job }) => ({
    job,
    firstSeenAt: LONG_AGO,
    lastStartedAt: ago(late[job] ?? 1),
  }));
}

describe("selectOverdueCrons", () => {
  it("lists a job one cadence plus grace past its last start, and not before", () => {
    const cadence = cronCadenceMinutes("read-creator-trackers");
    expect(selectOverdueCrons({ nowMs: NOW, heartbeats: beats({ "read-creator-trackers": cadence + SCHEDULER_GRACE_MINUTES }), killed: new Set() })).toEqual([]);
    expect(
      selectOverdueCrons({ nowMs: NOW, heartbeats: beats({ "read-creator-trackers": cadence + SCHEDULER_GRACE_MINUTES + 1 }), killed: new Set() }),
    ).toEqual([{ job: "read-creator-trackers", path: "/api/cron/read-creator-trackers", minutesOverdue: SCHEDULER_GRACE_MINUTES + 1 }]);
  });

  it("orders the most overdue first and never lists a killed job", () => {
    const out = selectOverdueCrons({
      nowMs: NOW,
      heartbeats: beats({ "sync-posts": 600, "refresh-creator-avatars": 300, "ops-canary": 200 }),
      killed: new Set(["cron:refresh-creator-avatars"]),
    });
    expect(out).toEqual([
      { job: "sync-posts", path: "/api/cron/sync-posts", minutesOverdue: 600 - cronCadenceMinutes("sync-posts") },
      { job: "ops-canary", path: "/api/cron/ops-canary", minutesOverdue: 200 - cronCadenceMinutes("ops-canary") },
    ]);
    expect(out.find((o) => o.job === "refresh-creator-avatars")).toBeUndefined();
  });

  it("counts a job with no heartbeat only once the canary has watched for its cadence", () => {
    const daily = "snapshot-org-views";
    const without = (canaryFirstSeen: Date) =>
      beats()
        .filter((b) => b.job !== daily)
        .map((b) => (b.job === "ops-canary" ? { ...b, firstSeenAt: canaryFirstSeen } : b));
    expect(selectOverdueCrons({ nowMs: NOW, heartbeats: without(ago(60)), killed: new Set() })).toEqual([]);
    expect(selectOverdueCrons({ nowMs: NOW, heartbeats: without(ago(24 * 60 + 60)), killed: new Set() })).toEqual([
      { job: daily, path: "/api/cron/snapshot-org-views", minutesOverdue: 60 },
    ]);
  });

  it("lists nothing when nothing has a heartbeat yet", () => {
    expect(selectOverdueCrons({ nowMs: NOW, heartbeats: [], killed: new Set() })).toEqual([]);
  });
});

describe("GET /api/ops/overdue-crons", () => {
  const req = (auth?: string) =>
    new NextRequest("http://localhost/api/ops/overdue-crons", { headers: auth ? { authorization: auth } : {} });
  const saved = { token: process.env.OPS_SCHEDULER_TOKEN, url: process.env.DATABASE_URL, cron: process.env.CRON_SECRET };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    resetOpsTablesCache();
    resetKillSwitchCache();
    process.env.OPS_SCHEDULER_TOKEN = "s".repeat(32);
    process.env.DATABASE_URL = "postgres://test.invalid/db";
    queryRaw.mockResolvedValue([{ n: 6 }]);
    heartbeats.mockResolvedValue(beats({ "sync-posts": 600 }));
    switches.mockResolvedValue([]);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => {
    process.env.OPS_SCHEDULER_TOKEN = saved.token;
    process.env.DATABASE_URL = saved.url;
    process.env.CRON_SECRET = saved.cron;
  });

  it("does not exist without OPS_SCHEDULER_TOKEN", async () => {
    delete process.env.OPS_SCHEDULER_TOKEN;
    expect((await GET(req(`Bearer ${"s".repeat(32)}`))).status).toBe(404);
    expect(heartbeats).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong token, and the cron secret", async () => {
    process.env.CRON_SECRET = "c".repeat(32);
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req(`Bearer ${"x".repeat(32)}`))).status).toBe(401);
    expect((await GET(req(`Bearer ${"c".repeat(32)}`))).status).toBe(401);
    expect(heartbeats).not.toHaveBeenCalled();
  });

  it("answers job names, paths and minutes, and nothing else", async () => {
    const res = await GET(req(`Bearer ${"s".repeat(32)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      overdue: [{ job: "sync-posts", path: "/api/cron/sync-posts", minutesOverdue: 600 - cronCadenceMinutes("sync-posts") }],
    });
  });

  it("leaves out a job switched off on the ops page", async () => {
    switches.mockResolvedValue([{ key: "cron:sync-posts", off: true, reason: null, updatedBy: null, updatedAt: null }]);
    expect(await (await GET(req(`Bearer ${"s".repeat(32)}`))).json()).toEqual({ overdue: [] });
  });

  it("lists nothing while the ops tables are absent", async () => {
    queryRaw.mockResolvedValue([{ n: 0 }]);
    expect(await (await GET(req(`Bearer ${"s".repeat(32)}`))).json()).toEqual({ overdue: [] });
    expect(heartbeats).not.toHaveBeenCalled();
  });

  it("answers 503 without the error text when the read fails", async () => {
    heartbeats.mockRejectedValue(new Error("connection to 10.0.0.1 refused"));
    const res = await GET(req(`Bearer ${"s".repeat(32)}`));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.1");
  });
});
