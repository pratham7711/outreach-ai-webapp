/**
 * @jest-environment node
 *
 * A kill switch may stop a job only when a row says so. Every other state of
 * the table -- not applied yet, unreadable, empty -- must answer "not killed",
 * or the guard becomes the outage.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
const queryRaw = jest.fn();
const findMany = jest.fn();
const upsert = jest.fn((args: unknown) => ({ op: "upsert", args }));
const logCreate = jest.fn((args: unknown) => ({ op: "log", args }));
const transaction = jest.fn(async (ops: unknown[]) => ops);
jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a),
    $transaction: (ops: unknown[]) => transaction(ops),
    opsKillSwitch: { findMany: (...a: unknown[]) => findMany(...a), upsert: (a: unknown) => upsert(a) },
    opsKillSwitchLog: { create: (a: unknown) => logCreate(a) },
  },
}));

import { resetOpsTablesCache } from "@/lib/ops/opsTables";
import {
  KILL_SWITCH_KEYS,
  KILL_SWITCH_TTL_MS,
  cronKillKey,
  isKilled,
  killedSources,
  resetKillSwitchCache,
  setKillSwitch,
  sourceKillKey,
} from "@/lib/ops/killSwitch";

const realUrl = process.env.DATABASE_URL;
const row = (key: string, off: boolean) => ({ key, off, reason: null, updatedBy: "ops@example.com", updatedAt: new Date(0) });

beforeEach(() => {
  jest.clearAllMocks();
  resetOpsTablesCache();
  resetKillSwitchCache();
  process.env.DATABASE_URL = "postgres://test.invalid/db";
  queryRaw.mockResolvedValue([{ n: 6 }]);
  findMany.mockResolvedValue([]);
});
afterAll(() => {
  process.env.DATABASE_URL = realUrl;
});

describe("isKilled", () => {
  it("is false when the tables are not applied", async () => {
    queryRaw.mockResolvedValue([{ n: 2 }]);
    expect(await isKilled(cronKillKey("sync-posts"))).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("is false with no database configured, without asking one", async () => {
    delete process.env.DATABASE_URL;
    expect(await isKilled(cronKillKey("sync-posts"))).toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("is false when the read throws", async () => {
    findMany.mockRejectedValue(new Error("connection reset"));
    expect(await isKilled(cronKillKey("sync-posts"))).toBe(false);
  });

  it("is false when the table check itself throws", async () => {
    queryRaw.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await isKilled(cronKillKey("sync-posts"))).toBe(false);
  });

  it("is true only for a row that says off", async () => {
    findMany.mockResolvedValue([row("cron:sync-posts", true), row("cron:snapshot-sounds", false)]);
    expect(await isKilled("cron:sync-posts")).toBe(true);
    expect(await isKilled("cron:snapshot-sounds")).toBe(false);
    expect(await isKilled("cron:sync-trackers")).toBe(false);
  });

  it("asks the database at most once per TTL", async () => {
    findMany.mockResolvedValue([row("cron:sync-posts", true)]);
    const t0 = 1_000_000;
    await isKilled("cron:sync-posts", t0);
    await isKilled("cron:sync-posts", t0 + KILL_SWITCH_TTL_MS - 1);
    expect(findMany).toHaveBeenCalledTimes(1);

    findMany.mockResolvedValue([]);
    expect(await isKilled("cron:sync-posts", t0 + KILL_SWITCH_TTL_MS)).toBe(false);
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});

describe("killedSources", () => {
  it("lists only the sources switched off", async () => {
    findMany.mockResolvedValue([row(sourceKillKey("instagram"), true), row(sourceKillKey("youtube"), false)]);
    expect([...(await killedSources())]).toEqual(["instagram"]);
  });
});

describe("the key set", () => {
  it("has one key per cron and one per read source", () => {
    expect(KILL_SWITCH_KEYS).toContain("cron:read-creator-trackers");
    expect(KILL_SWITCH_KEYS).toContain("cron:ops-canary");
    expect(KILL_SWITCH_KEYS).toEqual(expect.arrayContaining(["source:tiktok", "source:instagram", "source:youtube"]));
  });
});

describe("setKillSwitch", () => {
  it("refuses a key that is not a switch", async () => {
    expect(await setKillSwitch({ key: "cron:nope", off: true, changedBy: "ops@example.com" })).toEqual({
      ok: false,
      error: "unknown kill switch",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses while the tables are not applied", async () => {
    queryRaw.mockResolvedValue([{ n: 0 }]);
    const res = await setKillSwitch({ key: "cron:sync-posts", off: true, changedBy: "ops@example.com" });
    expect(res.ok).toBe(false);
  });

  it("writes the switch and its log row together, and the next read sees it", async () => {
    const res = await setKillSwitch({ key: "source:tiktok", off: true, reason: "x".repeat(400), changedBy: "ops@example.com" });
    expect(res.ok).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    const [[ops]] = transaction.mock.calls;
    expect(ops).toHaveLength(2);
    expect((upsert.mock.calls[0][0] as { create: { reason: string } }).create.reason).toHaveLength(300);
    expect(logCreate).toHaveBeenCalledTimes(1);

    findMany.mockResolvedValue([row("source:tiktok", true)]);
    expect(await isKilled("source:tiktok")).toBe(true);
  });
});
