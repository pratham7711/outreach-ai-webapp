/**
 * @jest-environment node
 *
 * The hourly canary end to end, through the real alertOps: the first run
 * mails each problem it finds, and the next hour's run -- same problems,
 * different counts -- mails nothing, because alertOps finds the first mails
 * in EmailLog. Only the database is mocked; no sandbox or platform is asked.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
const sendEmail = jest.fn<Promise<undefined>, [{ kind: string; subject: string }]>(async () => undefined);
jest.mock("@/lib/email", () => ({ sendEmail: (m: { kind: string; subject: string }) => sendEmail(m) }));
jest.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: () => {
      throw new Error("the canary must not boot a sandbox");
    },
  },
}));

jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    opsKillSwitch: { findMany: jest.fn() },
    opsCronHeartbeat: { findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    opsSourceBreaker: { findMany: jest.fn() },
    opsSandboxDay: { aggregate: jest.fn() },
    trackerReadingQuarantine: { groupBy: jest.fn() },
    trackerSourceSwitch: { findUnique: jest.fn() },
    trackerSourceHealth: { findFirst: jest.fn() },
    emailLog: { findMany: jest.fn() },
  },
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { GET } from "@/app/api/cron/ops-canary/route";
import { CRON_JOBS } from "@/lib/ops/cronJobs";
import { resetOpsTablesCache } from "@/lib/ops/opsTables";
import { resetKillSwitchCache } from "@/lib/ops/killSwitch";
import { OPS_TABLES } from "@/lib/ops/opsSchemaDdl";
import { TRACKER_SOURCE_TABLES } from "@/lib/trackers/sourceSchemaDdl";
import { resetTrackerSourceTablesCache } from "@/lib/trackers/sourceSwitch";

type M = jest.Mock;
const mockDb = db as unknown as {
  $queryRawUnsafe: M;
  opsKillSwitch: { findMany: M };
  opsCronHeartbeat: { findMany: M; upsert: M; update: M };
  opsSourceBreaker: { findMany: M };
  opsSandboxDay: { aggregate: M };
  trackerReadingQuarantine: { groupBy: M };
  trackerSourceSwitch: { findUnique: M };
  trackerSourceHealth: { findFirst: M };
  emailLog: { findMany: M };
};

const H = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);

/** One hour's state of the world: sync-posts six hours late, two readers
 *  zeroed, the gate rejecting. `n` moves every count between runs. */
function world(n: number) {
  mockDb.opsCronHeartbeat.findMany.mockResolvedValue(
    CRON_JOBS.map((j) => ({
      job: j.job,
      firstSeenAt: ago(30 * 24 * H),
      lastStartedAt: j.job === "sync-posts" ? ago((12 + n) * H + 60_000) : ago(60_000),
      lastFinishedAt: j.job === "sync-posts" ? ago((12 + n) * H) : ago(30_000),
      lastOk: true,
      lastError: null,
      consecutiveFailures: 0,
    })),
  );
  mockDb.$queryRawUnsafe.mockImplementation(async (sql: string, arg: unknown) => {
    if (sql.includes("information_schema")) {
      const names = arg as string[];
      return [{ n: names.includes("OpsKillSwitch") ? OPS_TABLES.length : TRACKER_SOURCE_TABLES.length }];
    }
    if (sql.includes("LATERAL")) return [{ platform: "TIKTOK", n: 1 + n }];
    if (sql.includes("FILTER")) return [{ platform: "TIKTOK", tracked: 200 + n, read: 40 + n }];
    throw new Error(`unexpected query: ${sql.slice(0, 40)}`);
  });
  mockDb.trackerReadingQuarantine.groupBy.mockResolvedValue([{ verdict: "rejected", _count: { _all: 11 + n } }]);
  mockDb.trackerSourceHealth.findFirst.mockResolvedValue({ startedAt: ago(5 * 60_000), reads: 60 + n, proper: 60 + n });
}

const sent: string[] = [];
const realUrl = process.env.DATABASE_URL;

beforeEach(() => {
  jest.clearAllMocks();
  sent.length = 0;
  resetOpsTablesCache();
  resetKillSwitchCache();
  resetTrackerSourceTablesCache();
  process.env.CRON_SECRET = "test-secret";
  process.env.ALERT_EMAIL_TO = "ops@example.com";
  process.env.DATABASE_URL = "postgres://test.invalid/db";
  sendEmail.mockImplementation(async (m) => {
    sent.push(m.subject);
    return undefined;
  });
  /* EmailLog as lib/email would leave it: every mail sent so far. */
  mockDb.emailLog.findMany.mockImplementation(async () => sent.map((subject) => ({ subject })));
  mockDb.opsKillSwitch.findMany.mockResolvedValue([]);
  mockDb.opsSourceBreaker.findMany.mockResolvedValue([]);
  mockDb.opsSandboxDay.aggregate.mockResolvedValue({ _sum: { creations: 12 } });
  mockDb.opsCronHeartbeat.upsert.mockResolvedValue({ job: "ops-canary" });
  mockDb.opsCronHeartbeat.update.mockResolvedValue({ job: "ops-canary" });
  mockDb.trackerSourceSwitch.findUnique.mockResolvedValue({
    id: "creator-tracker",
    position: "A",
    scopeOrgIds: [],
    percent: 100,
    changedAt: new Date(0),
    changedBy: "ops@example.com",
  });
});
afterAll(() => {
  process.env.DATABASE_URL = realUrl;
});

const run = () =>
  GET(new NextRequest("http://localhost/api/cron/ops-canary", { headers: { authorization: "Bearer test-secret" } }));

describe("ops canary", () => {
  it("alerts once per problem, and not again the next hour", async () => {
    world(0);
    const first = await run();
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.checked).toEqual({ heartbeats: true, readShare: true, quarantine: true, zeroed: true, sourceHealth: true });
    expect(sent).toEqual([
      "[CRITICAL] Cron sync-posts is overdue: last started 12h ago",
      "[WARN] Tracked TIKTOK creators read in 24h: 20%, under 50%",
      "[WARN] Validation gate rejected 11 readings in the last hour",
      "[CRITICAL] 1 tracked creator(s) now read 0 followers after a non-zero reading",
    ]);

    resetKillSwitchCache();
    world(1);
    const second = await run();
    expect(second.status).toBe(200);
    expect((await second.json()).findings).toHaveLength(4);
    expect(sendEmail).toHaveBeenCalledTimes(4);
  });

  it("records its own heartbeat", async () => {
    world(0);
    await run();
    expect(mockDb.opsCronHeartbeat.upsert.mock.calls[0][0].where).toEqual({ job: "ops-canary" });
    expect(mockDb.opsCronHeartbeat.update.mock.calls[0][0].data.lastOk).toBe(true);
  });

  it("mails nothing on a dry run", async () => {
    world(0);
    const res = await GET(
      new NextRequest("http://localhost/api/cron/ops-canary?dryRun=1", { headers: { authorization: "Bearer test-secret" } }),
    );
    expect((await res.json()).findings).toHaveLength(4);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still runs the value checks when the ops tables are absent", async () => {
    world(0);
    mockDb.$queryRawUnsafe.mockImplementation(async (sql: string, arg: unknown) => {
      if (sql.includes("information_schema")) {
        const names = arg as string[];
        return [{ n: names.includes("OpsKillSwitch") ? 0 : TRACKER_SOURCE_TABLES.length }];
      }
      if (sql.includes("LATERAL")) return [];
      if (sql.includes("FILTER")) return [{ platform: "TIKTOK", tracked: 200, read: 40 }];
      return [];
    });
    const res = await run();
    const body = await res.json();
    expect(body.checked.heartbeats).toBe(false);
    expect(body.findings.map((f: { title: string }) => f.title)).toEqual([
      "Tracked TIKTOK creators read in 24h: 20%, under 50%",
      "Validation gate rejected 11 readings in the last hour",
    ]);
    expect(mockDb.opsCronHeartbeat.findMany).not.toHaveBeenCalled();
  });

  it("answers 200 with nothing checked when every read fails", async () => {
    mockDb.$queryRawUnsafe.mockRejectedValue(new Error("connection reset"));
    mockDb.trackerSourceSwitch.findUnique.mockRejectedValue(new Error("connection reset"));
    const res = await run();
    expect(res.status).toBe(200);
    expect((await res.json()).findings).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
