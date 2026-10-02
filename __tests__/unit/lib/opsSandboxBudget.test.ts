/**
 * @jest-environment node
 *
 * Every sandbox boot goes through createSandbox: counted per UTC day, refused
 * above the cap with one alert a day, and always persistent:false. An absent
 * or unreadable counter must never stop a boot.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
const alertOps = jest.fn<Promise<undefined>, [{ title: string }]>(async () => undefined);
jest.mock("@/lib/alerts", () => ({ alertOps: (a: { title: string }) => alertOps(a) }));

const sandboxDelete = jest.fn(async () => undefined);
const create = jest.fn<Promise<{ sandboxId: string; delete: typeof sandboxDelete }>, [Record<string, unknown>]>(async () => ({
  sandboxId: "sb_test",
  delete: sandboxDelete,
}));
jest.mock("@vercel/sandbox", () => ({ Sandbox: { create: (p: Record<string, unknown>) => create(p) } }));

const queryRaw = jest.fn();
const executeRaw = jest.fn<Promise<number>, unknown[]>(async () => 1);
const aggregate = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a),
    $executeRawUnsafe: (...a: unknown[]) => executeRaw(...a),
    opsSandboxDay: { aggregate: (...a: unknown[]) => aggregate(...a) },
  },
}));

import { resetOpsTablesCache } from "@/lib/ops/opsTables";
import {
  DEFAULT_SANDBOX_DAILY_CAP,
  SandboxCapError,
  capAllows,
  createSandbox,
  resetSandboxBudgetState,
  sandboxDailyCap,
  utcDay,
} from "@/lib/ops/sandboxBudget";

const realUrl = process.env.DATABASE_URL;
const realCap = process.env.SANDBOX_DAILY_CAP;
const params = { region: "iad1", timeout: 300_000, persistent: false } as const;

beforeEach(() => {
  jest.clearAllMocks();
  resetOpsTablesCache();
  resetSandboxBudgetState();
  process.env.DATABASE_URL = "postgres://test.invalid/db";
  delete process.env.SANDBOX_DAILY_CAP;
  queryRaw.mockResolvedValue([{ n: 6 }]);
  aggregate.mockResolvedValue({ _sum: { creations: 10 } });
});
afterAll(() => {
  process.env.DATABASE_URL = realUrl;
  if (realCap === undefined) delete process.env.SANDBOX_DAILY_CAP;
  else process.env.SANDBOX_DAILY_CAP = realCap;
});

describe("the cap arithmetic", () => {
  it("defaults to 600 a day and takes a positive integer from the env", () => {
    expect(DEFAULT_SANDBOX_DAILY_CAP).toBe(600);
    expect(sandboxDailyCap({})).toBe(600);
    expect(sandboxDailyCap({ SANDBOX_DAILY_CAP: "250" })).toBe(250);
  });

  it.each(["0", "-5", "abc", "12.5", ""])("ignores SANDBOX_DAILY_CAP=%p", (v) => {
    expect(sandboxDailyCap({ SANDBOX_DAILY_CAP: v })).toBe(600);
  });

  it("allows below the cap, refuses at it, and always allows an unknown count", () => {
    expect(capAllows(599, 600)).toBe(true);
    expect(capAllows(600, 600)).toBe(false);
    expect(capAllows(null, 600)).toBe(true);
    expect(capAllows(Number.NaN, 600)).toBe(true);
  });

  it("days are UTC", () => {
    expect(utcDay(Date.UTC(2026, 9, 2, 23, 59))).toBe("2026-10-02");
    expect(utcDay(Date.UTC(2026, 9, 3, 0, 0))).toBe("2026-10-03");
  });
});

describe("createSandbox", () => {
  it("boots, counts the creation under its caller, and forces persistent:false", async () => {
    await createSandbox({ ...params, persistent: true } as never, "post-lanes");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ region: "iad1", timeout: 300_000, persistent: false });
    const [sql, , caller] = executeRaw.mock.calls[0] as [string, string, string];
    expect(sql).toContain(`"creations"`);
    expect(caller).toBe("post-lanes");
  });

  it("records the lifetime once, when the sandbox is deleted", async () => {
    const sb = await createSandbox({ ...params, resources: { vcpus: 1 } } as never, "reader-v2");
    executeRaw.mockClear();
    await sb.delete({ deleteOrphanSnapshots: true } as never);
    await sb.delete({ deleteOrphanSnapshots: true } as never);
    expect(sandboxDelete).toHaveBeenCalledTimes(2);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [sql, , , seconds, vcpuSeconds] = executeRaw.mock.calls[0] as [string, string, string, number, number];
    expect(sql).toContain(`"vcpuSeconds"`);
    expect(seconds).toBeGreaterThanOrEqual(0);
    expect(vcpuSeconds).toBe(seconds);
  });

  it("refuses at the cap, counts the refusal, and alerts once a day", async () => {
    process.env.SANDBOX_DAILY_CAP = "10";
    await expect(createSandbox(params, "profile-fetcher")).rejects.toBeInstanceOf(SandboxCapError);
    await expect(createSandbox(params, "profile-fetcher")).rejects.toBeInstanceOf(SandboxCapError);
    expect(create).not.toHaveBeenCalled();
    expect(alertOps).toHaveBeenCalledTimes(1);
    expect(alertOps.mock.calls[0][0].title).toBe("Sandbox daily cap reached: 10 of 10 created today (UTC)");
    expect(executeRaw.mock.calls.every(([sql]) => String(sql).includes(`"refused"`))).toBe(true);
  });

  it("boots when the tables are not applied, and counts nothing", async () => {
    queryRaw.mockResolvedValue([{ n: 0 }]);
    process.env.SANDBOX_DAILY_CAP = "1";
    await createSandbox(params, "post-lanes");
    expect(create).toHaveBeenCalledTimes(1);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("boots when the count cannot be read", async () => {
    aggregate.mockRejectedValue(new Error("connection reset"));
    process.env.SANDBOX_DAILY_CAP = "1";
    await createSandbox(params, "post-lanes");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("returns the boot even when the counter write fails", async () => {
    executeRaw.mockRejectedValueOnce(new Error("connection reset"));
    const sb = await createSandbox(params, "post-lanes");
    expect(sb).toMatchObject({ sandboxId: "sb_test" });
  });

  it("counts every lane that boots at once on a cold instance, with one table check", async () => {
    await Promise.all([1, 2, 3, 4, 5].map(() => createSandbox(params, "reader-v2")));
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw.mock.calls.filter(([sql]) => String(sql).includes(`"creations"`))).toHaveLength(5);
  });

  it("propagates a failed boot without counting it", async () => {
    create.mockRejectedValueOnce(new Error("quota"));
    await expect(createSandbox(params, "post-lanes")).rejects.toThrow("quota");
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
