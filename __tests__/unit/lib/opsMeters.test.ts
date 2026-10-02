/**
 * @jest-environment node
 *
 * Weekly meters: Neon's consumption parsed from either shape it comes in,
 * last week's cost set against the 4k model, and every failure recorded as a
 * row rather than thrown.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
const alertOps = jest.fn<Promise<undefined>, [{ title: string }]>(async () => undefined);
jest.mock("@/lib/alerts", () => ({ alertOps: (a: { title: string }) => alertOps(a) }));
const queryRaw = jest.fn();
const aggregate = jest.fn();
const upsert = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a),
    opsSandboxDay: { aggregate: (...a: unknown[]) => aggregate(...a) },
    opsMeterWeek: { upsert: (...a: unknown[]) => upsert(...a) },
  },
}));

import { resetOpsTablesCache } from "@/lib/ops/opsTables";
import {
  NEON_USD_PER_CU_HOUR,
  OVER_MODEL_RATIO,
  SANDBOX_USD_PER_VCPU_HOUR,
  compareToModel,
  meterAlert,
  neonConsumptionUrl,
  parseNeonConsumption,
  previousWeek,
  readNeonMeter,
  runMeters,
  weeklyModel,
} from "@/lib/ops/meters";

/** The shape measured from the v2 endpoint on 2026-10-02, with fake ids. */
function project(id: string, cuSecondsPerDay: number[]) {
  return {
    project_id: id,
    periods: [
      {
        period_id: "period-1",
        period_plan: "launch",
        period_start: "2026-09-01T00:00:00Z",
        period_end: null,
        consumption: cuSecondsPerDay.map((v, i) => ({
          timeframe_start: `2026-09-2${i}T00:00:00Z`,
          timeframe_end: `2026-09-2${i + 1}T00:00:00Z`,
          metrics: [
            { metric_name: "compute_unit_seconds", value: v },
            { metric_name: "root_branch_bytes_month", value: 1000 },
          ],
        })),
      },
    ],
  };
}

const realUrl = process.env.DATABASE_URL;
beforeEach(() => {
  jest.clearAllMocks();
  resetOpsTablesCache();
  process.env.DATABASE_URL = "postgres://test.invalid/db";
  queryRaw.mockResolvedValue([{ n: 6 }]);
  aggregate.mockResolvedValue({ _sum: { creations: 70, closed: 70, refused: 0, seconds: 70 * 300, vcpuSeconds: 70 * 300 } });
  upsert.mockResolvedValue({ id: "x" });
});
afterAll(() => {
  process.env.DATABASE_URL = realUrl;
});

describe("the model", () => {
  it("converts the monthly model to a week as 168/730 of it", () => {
    expect(weeklyModel("neon-compute").high).toBeCloseTo((39 * 168) / 730, 6);
    expect(weeklyModel("neon-compute").low).toBeCloseTo((19 * 168) / 730, 6);
    expect(weeklyModel("sandbox-compute").high).toBeCloseTo((22 * 168) / 730, 6);
    expect(weeklyModel("sandbox-compute").low).toBeCloseTo((9 * 168) / 730, 6);
  });

  it(`is over at ${OVER_MODEL_RATIO * 100}% of the upper bound, not below`, () => {
    const high = weeklyModel("neon-compute").high;
    expect(compareToModel("neon-compute", high * OVER_MODEL_RATIO).status).toBe("over");
    expect(compareToModel("neon-compute", high * OVER_MODEL_RATIO - 0.01).status).toBe("ok");
    expect(compareToModel("neon-compute", high).ratio).toBeCloseTo(1, 6);
  });
});

describe("previousWeek", () => {
  it("is the Monday-to-Monday week before the one now falls in, UTC", () => {
    const w = previousWeek(Date.UTC(2026, 9, 5, 3, 14)); // Monday 2026-10-05 03:14
    expect(w.weekStart).toBe("2026-09-28");
    expect(w.from.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("gives the same week from any day inside the next one", () => {
    expect(previousWeek(Date.UTC(2026, 9, 11, 23, 59)).weekStart).toBe("2026-09-28"); // Sunday
  });
});

describe("parseNeonConsumption", () => {
  it("reads the {projects} shape the API returns", () => {
    const p = parseNeonConsumption({ projects: [project("proj-a", [3600, 7200]), project("proj-b", [360])] });
    expect(p).toEqual({ projects: 2, summed: ["proj-a", "proj-b"], totals: { compute_unit_seconds: 11160, root_branch_bytes_month: 3000 } });
  });

  it("reads the bare array neonctl returns", () => {
    const p = parseNeonConsumption([project("proj-a", [3600])]);
    expect(p?.totals.compute_unit_seconds).toBe(3600);
  });

  it("sums one project when asked", () => {
    const p = parseNeonConsumption({ projects: [project("proj-a", [3600]), project("proj-b", [99])] }, "proj-b");
    expect(p).toMatchObject({ projects: 2, summed: ["proj-b"], totals: { compute_unit_seconds: 99 } });
  });

  it("skips what does not fit rather than guessing", () => {
    const p = parseNeonConsumption({
      projects: [
        null,
        { project_id: "proj-a", periods: "nope" },
        { project_id: "proj-b", periods: [{ consumption: [{ metrics: [{ metric_name: "compute_unit_seconds", value: "12" }, { metric_name: 5, value: 1 }, { value: 3 }, { metric_name: "x", value: "NaN" }] }] }] },
      ],
    });
    expect(p?.totals).toEqual({ compute_unit_seconds: 12 });
  });

  it("is null without a project list", () => {
    expect(parseNeonConsumption({ error: "nope" })).toBeNull();
    expect(parseNeonConsumption(null)).toBeNull();
    expect(parseNeonConsumption("text")).toBeNull();
  });

  it("asks for the four metrics, daily, for the org", () => {
    const url = new URL(neonConsumptionUrl({ from: new Date("2026-09-28T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z"), orgId: "org-test" }));
    expect(url.pathname).toBe("/api/v2/consumption_history/v2/projects");
    expect(url.searchParams.get("granularity")).toBe("daily");
    expect(url.searchParams.get("org_id")).toBe("org-test");
    expect(url.searchParams.get("metrics")).toBe("compute_unit_seconds,root_branch_bytes_month,child_branch_bytes_month,public_network_transfer_bytes");
  });
});

describe("readNeonMeter", () => {
  const week = previousWeek(Date.UTC(2026, 9, 5, 3, 14));
  const env = { NEON_API_KEY: "test-key", NEON_ORG_ID: "org-test" };
  const answer = (status: number, body: unknown) =>
    jest.fn(async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response);

  it("records not-configured, without a request, when either env var is missing", async () => {
    const f = answer(200, {});
    const r = await readNeonMeter(week, { NEON_ORG_ID: "org-test" }, f);
    expect(r).toMatchObject({ status: "not-configured", detail: { missing: ["NEON_API_KEY"] } });
    expect(f).not.toHaveBeenCalled();
  });

  it("prices CU-hours at the Launch rate", async () => {
    const r = await readNeonMeter(week, env, answer(200, { projects: [project("proj-a", [3600 * 10, 3600 * 5])] }));
    expect(r.status).toBe("ok");
    expect(r.value).toBe(15);
    expect(r.costUsd).toBeCloseTo(15 * NEON_USD_PER_CU_HOUR, 6);
    expect(r.detail).toMatchObject({ scope: "org", projects: 1 });
  });

  it("is over when last week cost 120% of the model", async () => {
    const cuHours = (weeklyModel("neon-compute").high * 1.3) / NEON_USD_PER_CU_HOUR;
    const r = await readNeonMeter(week, env, answer(200, [project("proj-a", [cuHours * 3600])]));
    expect(r.status).toBe("over");
  });

  it("records an error row for a refused request, a bad body, or a missing project", async () => {
    expect((await readNeonMeter(week, env, answer(403, {}))).detail).toEqual({ httpStatus: 403 });
    expect((await readNeonMeter(week, env, answer(200, { nope: true }))).status).toBe("error");
    const r = await readNeonMeter(week, { ...env, NEON_PROJECT_ID: "proj-z" }, answer(200, [project("proj-a", [1])]));
    expect(r).toMatchObject({ status: "error", detail: { reason: "NEON_PROJECT_ID is not in the response" } });
  });

  it("never throws, and never writes the key into the row", async () => {
    const f = jest.fn(async () => {
      throw new Error("request to https://console.neon.tech failed, header test-key");
    });
    const r = await readNeonMeter(week, env, f as unknown as typeof fetch);
    expect(r.status).toBe("error");
    expect(JSON.stringify(r)).not.toContain("test-key");
  });
});

describe("runMeters", () => {
  const now = Date.UTC(2026, 9, 5, 3, 14);

  it("stores one row per meter for last week and alerts only on what is over", async () => {
    const vcpuSeconds = ((weeklyModel("sandbox-compute").high * 1.5) / SANDBOX_USD_PER_VCPU_HOUR) * 3600;
    aggregate.mockResolvedValue({ _sum: { creations: 900, closed: 880, refused: 0, seconds: vcpuSeconds / 2, vcpuSeconds } });
    const res = await runMeters({ nowMs: now, env: {}, fetchImpl: jest.fn() as unknown as typeof fetch });

    expect(res.weekStart).toBe("2026-09-28");
    expect(res.rows.map((r) => [r.meter, r.status, r.saved])).toEqual([
      ["neon-compute", "not-configured", true],
      ["sandbox-compute", "over", true],
    ]);
    expect(upsert.mock.calls.map((c) => c[0].where.id)).toEqual(["neon-compute:2026-09-28", "sandbox-compute:2026-09-28"]);
    expect(aggregate.mock.calls[0][0].where).toEqual({ day: { gte: "2026-09-28", lt: "2026-10-05" } });
    expect(alertOps).toHaveBeenCalledTimes(1);
    expect(alertOps.mock.calls[0][0].title).toBe("Sandbox compute last week at 150% of the 4k model");
    expect(res.rows[1].detail).toMatchObject({ untimed: 20 });
  });

  it("writes and alerts nothing on a dry run", async () => {
    aggregate.mockResolvedValue({ _sum: { vcpuSeconds: 1e9 } });
    await runMeters({ nowMs: now, dryRun: true, env: {} });
    expect(upsert).not.toHaveBeenCalled();
    expect(alertOps).not.toHaveBeenCalled();
  });

  it("returns rows, unsaved, when the ops tables are not applied", async () => {
    queryRaw.mockResolvedValue([{ n: 0 }]);
    const res = await runMeters({ nowMs: now, env: {} });
    expect(res.rows.map((r) => [r.status, r.saved])).toEqual([
      ["not-configured", false],
      ["not-configured", false],
    ]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("survives a failed save", async () => {
    upsert.mockRejectedValue(new Error("connection reset"));
    const res = await runMeters({ nowMs: now, env: {} });
    expect(res.rows.every((r) => r.saved === false)).toBe(true);
  });
});

describe("meterAlert", () => {
  it("raises nothing for ok or not-configured, and a warning for an unreadable meter", () => {
    const base = { meter: "neon-compute" as const, weekStart: "2026-09-28", unit: "CU-hours", value: null, costUsd: null, budgetUsd: 1, ratio: null, detail: {} };
    expect(meterAlert({ ...base, status: "ok" })).toBeNull();
    expect(meterAlert({ ...base, status: "not-configured" })).toBeNull();
    expect(meterAlert({ ...base, status: "error", detail: { httpStatus: 500 } })?.title).toBe("Neon compute meter could not be read");
  });
});
