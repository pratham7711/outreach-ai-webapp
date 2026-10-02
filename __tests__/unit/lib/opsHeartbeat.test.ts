/**
 * @jest-environment node
 *
 * A heartbeat that cannot be written is a gap in monitoring, never a failed
 * job: every write here is caught.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
const queryRaw = jest.fn();
const upsert = jest.fn();
const update = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a),
    opsCronHeartbeat: { upsert: (...a: unknown[]) => upsert(...a), update: (...a: unknown[]) => update(...a) },
  },
}));

import { resetOpsTablesCache } from "@/lib/ops/opsTables";
import { HEARTBEAT_ERROR_MAX, recordCronFinish, recordCronStart, truncateError } from "@/lib/ops/heartbeat";

const realUrl = process.env.DATABASE_URL;
beforeEach(() => {
  jest.clearAllMocks();
  resetOpsTablesCache();
  process.env.DATABASE_URL = "postgres://test.invalid/db";
  queryRaw.mockResolvedValue([{ n: 6 }]);
  upsert.mockResolvedValue({ job: "sync-posts" });
  update.mockResolvedValue({ job: "sync-posts" });
});
afterAll(() => {
  process.env.DATABASE_URL = realUrl;
});

describe("truncateError", () => {
  it("collapses whitespace and cuts long errors", () => {
    expect(truncateError("a\n  b")).toBe("a b");
    const long = truncateError("x".repeat(2000))!;
    expect(long).toHaveLength(HEARTBEAT_ERROR_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(truncateError(null)).toBeNull();
    expect(truncateError("")).toBeNull();
  });
});

describe("recordCronStart / recordCronFinish", () => {
  it("writes the start, then a successful finish", async () => {
    const at = new Date("2026-10-02T10:00:00Z");
    const beat = await recordCronStart("sync-posts", at);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      where: { job: "sync-posts" },
      create: { job: "sync-posts", firstSeenAt: at, lastStartedAt: at, runs: 1 },
      update: { lastStartedAt: at, runs: { increment: 1 } },
    });

    await recordCronFinish(beat, { ok: true }, new Date("2026-10-02T10:00:42Z"));
    expect(update.mock.calls[0][0].data).toMatchObject({
      lastOk: true,
      lastError: null,
      durationMs: 42_000,
      consecutiveFailures: 0,
    });
  });

  it("writes a failed finish with the error, and counts it", async () => {
    const beat = await recordCronStart("sync-posts");
    await recordCronFinish(beat, { ok: false, error: "HTTP 500: boom" });
    expect(update.mock.calls[0][0].data).toMatchObject({
      lastOk: false,
      lastError: "HTTP 500: boom",
      consecutiveFailures: { increment: 1 },
    });
  });

  it("never throws when the writes fail", async () => {
    upsert.mockRejectedValue(new Error("connection reset"));
    update.mockRejectedValue(new Error("connection reset"));
    const beat = await recordCronStart("sync-posts");
    await expect(recordCronFinish(beat, { ok: true })).resolves.toBeUndefined();
  });

  it("writes nothing while the tables are not applied", async () => {
    queryRaw.mockResolvedValue([{ n: 1 }]);
    const beat = await recordCronStart("sync-posts");
    await recordCronFinish(beat, { ok: true });
    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
