/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({ db: {} }));
jest.mock("@/lib/alerts", () => ({ alertOps: jest.fn() }));

import { dailyCheckPassed, planBCheckFinding, readerFindings } from "@/lib/trackers/readerAlerts";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const base = { plan: "A" as const, maxWallStreak: 0, day: null, oldestAttemptAt: new Date(NOW - 3600_000), planBLastCheck: null, nowMs: NOW };

describe("readerFindings", () => {
  it("is quiet on a healthy run", () => {
    expect(readerFindings({ ...base, day: { reads: 900, proper: 890 } })).toEqual([]);
  });

  it("raises three walls in a row", () => {
    expect(readerFindings({ ...base, maxWallStreak: 3 })[0].title).toMatch(/3 profile reads in a row walled/);
  });

  it("raises A below 97% in a day, once there is enough to judge", () => {
    expect(readerFindings({ ...base, day: { reads: 40, proper: 20 } })).toEqual([]);
    const f = readerFindings({ ...base, day: { reads: 1000, proper: 950 } });
    expect(f[0]).toMatchObject({ severity: "critical" });
    expect(f[0].title).toMatch(/95% in 24h/);
  });

  it("raises a queue not drained in 24 hours", () => {
    const f = readerFindings({ ...base, oldestAttemptAt: new Date(NOW - 25 * 3600_000) });
    expect(f[0].title).toMatch(/not drained/);
  });

  it("raises Plan B going silent only once it has reported before", () => {
    expect(readerFindings({ ...base, planBLastCheck: null })).toEqual([]);
    const f = readerFindings({ ...base, planBLastCheck: { at: new Date(NOW - 49 * 3600_000), ok: true } });
    expect(f[0].source).toBe("tracker-plan-b");
  });
});

describe("Plan B daily check", () => {
  it("passes on 12+ reads with 90% answered", () => {
    expect(dailyCheckPassed(15, 14)).toBe(true);
    expect(dailyCheckPassed(15, 13)).toBe(false);
    expect(dailyCheckPassed(10, 10)).toBe(false);
  });
  it("alarms on the second failure in a row, not the first", () => {
    expect(planBCheckFinding({ ok: false }, { ok: true })).toBeNull();
    expect(planBCheckFinding({ ok: false }, null)).toBeNull();
    expect(planBCheckFinding({ ok: false }, { ok: false })).toMatchObject({ severity: "critical" });
    expect(planBCheckFinding({ ok: true }, { ok: false })).toBeNull();
  });
});
