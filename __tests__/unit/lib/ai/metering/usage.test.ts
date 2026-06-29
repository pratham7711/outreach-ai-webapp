import {
  aggregateUsage,
  checkEntitlement,
  assertEntitled,
  EntitlementError,
  UsageEvent,
} from "@/lib/ai/metering/usage";

const ORG = "org_alpha";
const ATTACKER = "org_evil";

function evt(partial: Partial<UsageEvent>): UsageEvent {
  return {
    orgId: ORG,
    tool: "discovery",
    tokens: 100,
    costUsd: 0.5,
    periodKey: "2026-06",
    ...partial,
  };
}

describe("aggregateUsage", () => {
  it("sums tokens, cost and runs for ctx.orgId only", () => {
    const events: UsageEvent[] = [
      evt({ tokens: 100, costUsd: 0.5 }),
      evt({ tokens: 200, costUsd: 1.5 }),
      evt({ tokens: 50, costUsd: 0.25 }),
    ];
    const agg = aggregateUsage(events, { orgId: ORG });
    expect(agg.orgId).toBe(ORG);
    expect(agg.totalTokens).toBe(350);
    expect(agg.totalCostUsd).toBeCloseTo(2.25, 10);
    expect(agg.runs).toBe(3);
  });

  it("SECURITY: excludes events carrying a foreign orgId so an attacker cannot inflate or leak the tenant total", () => {
    const events: UsageEvent[] = [
      evt({ orgId: ORG, tokens: 100, costUsd: 1 }),
      evt({ orgId: ATTACKER, tokens: 999999, costUsd: 9999 }),
      evt({ orgId: ATTACKER, tool: "outreach", tokens: 12345, costUsd: 777 }),
    ];
    const agg = aggregateUsage(events, { orgId: ORG });
    expect(agg.totalTokens).toBe(100);
    expect(agg.totalCostUsd).toBe(1);
    expect(agg.runs).toBe(1);
    expect(agg.byTool).not.toHaveProperty("outreach");
    expect(JSON.stringify(agg)).not.toContain("999999");
    expect(JSON.stringify(agg)).not.toContain("12345");
    expect(JSON.stringify(agg)).not.toContain(ATTACKER);
  });

  it("scopes strictly from ctx, never from event objects (mixed orgIds)", () => {
    const events: UsageEvent[] = [
      evt({ orgId: ORG, tokens: 10 }),
      evt({ orgId: "org_beta", tokens: 20 }),
      evt({ orgId: ORG, tokens: 30 }),
    ];
    const aAlpha = aggregateUsage(events, { orgId: ORG });
    const aBeta = aggregateUsage(events, { orgId: "org_beta" });
    expect(aAlpha.totalTokens).toBe(40);
    expect(aAlpha.runs).toBe(2);
    expect(aBeta.totalTokens).toBe(20);
    expect(aBeta.runs).toBe(1);
  });

  it("does not pollute Object.prototype when a tool name is __proto__", () => {
    const events: UsageEvent[] = [
      evt({ tool: "__proto__", tokens: 10, costUsd: 1 }),
      evt({ tool: "constructor", tokens: 20, costUsd: 2 }),
    ];
    const agg = aggregateUsage(events, { orgId: ORG });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(agg.byTool, "__proto__")).toBe(true);
    expect(agg.byTool["__proto__"]).toEqual({ tokens: 10, costUsd: 1, runs: 1 });
    expect(agg.runs).toBe(2);
  });

  it("builds a correct byTool breakdown", () => {
    const events: UsageEvent[] = [
      evt({ tool: "discovery", tokens: 100, costUsd: 1 }),
      evt({ tool: "discovery", tokens: 50, costUsd: 0.5 }),
      evt({ tool: "outreach", tokens: 200, costUsd: 2 }),
    ];
    const agg = aggregateUsage(events, { orgId: ORG });
    expect(agg.byTool.discovery).toEqual({ tokens: 150, costUsd: 1.5, runs: 2 });
    expect(agg.byTool.outreach).toEqual({ tokens: 200, costUsd: 2, runs: 1 });
  });

  it("guards non-finite and negative tokens/cost by treating them as 0 (still counts the run)", () => {
    const events: UsageEvent[] = [
      evt({ tokens: Number.NaN, costUsd: Number.POSITIVE_INFINITY }),
      evt({ tokens: -500, costUsd: -10 }),
      evt({ tokens: 25, costUsd: 0.1 }),
    ];
    const agg = aggregateUsage(events, { orgId: ORG });
    expect(agg.totalTokens).toBe(25);
    expect(agg.totalCostUsd).toBeCloseTo(0.1, 10);
    expect(agg.runs).toBe(3);
    expect(Number.isFinite(agg.totalTokens)).toBe(true);
    expect(Number.isFinite(agg.totalCostUsd)).toBe(true);
  });

  it("returns zeros for empty events", () => {
    const agg = aggregateUsage([], { orgId: ORG });
    expect(agg).toEqual({
      orgId: ORG,
      totalTokens: 0,
      totalCostUsd: 0,
      byTool: {},
      runs: 0,
    });
  });

  it("is deterministic: equal input yields deep-equal output", () => {
    const events: UsageEvent[] = [
      evt({ tool: "a", tokens: 10, costUsd: 1 }),
      evt({ tool: "b", tokens: 20, costUsd: 2 }),
    ];
    const first = aggregateUsage(events, { orgId: ORG });
    const second = aggregateUsage(events, { orgId: ORG });
    expect(first).toEqual(second);
  });

  it("fail-closed on a malformed ctx.orgId (empty) -> zeros", () => {
    const events: UsageEvent[] = [evt({ tokens: 100 })];
    const agg = aggregateUsage(events, { orgId: "" });
    expect(agg.totalTokens).toBe(0);
    expect(agg.runs).toBe(0);
  });
});

describe("checkEntitlement", () => {
  const usage = aggregateUsage(
    [
      evt({ tokens: 1000, costUsd: 5 }),
      evt({ tokens: 1000, costUsd: 5 }),
    ],
    { orgId: ORG },
  );

  it("allows when under all provided limits", () => {
    const d = checkEntitlement(usage, { maxTokens: 5000, maxCostUsd: 50, maxRuns: 10 });
    expect(d.allowed).toBe(true);
    expect(d.exceeded).toEqual([]);
    expect(d.remaining).toEqual({ tokens: 3000, costUsd: 40, runs: 8 });
  });

  it("blocks when tokens exceed the cap", () => {
    const d = checkEntitlement(usage, { maxTokens: 1500 });
    expect(d.allowed).toBe(false);
    expect(d.exceeded).toContain("tokens");
    expect(d.remaining.tokens).toBe(0);
  });

  it("blocks when cost exceeds the cap", () => {
    const d = checkEntitlement(usage, { maxCostUsd: 5 });
    expect(d.allowed).toBe(false);
    expect(d.exceeded).toContain("costUsd");
  });

  it("blocks when runs exceed the cap", () => {
    const d = checkEntitlement(usage, { maxRuns: 1 });
    expect(d.allowed).toBe(false);
    expect(d.exceeded).toContain("runs");
  });

  it("boundary: exactly at cap is fail-closed blocked (>=)", () => {
    const d = checkEntitlement(usage, { maxTokens: 2000, maxCostUsd: 10, maxRuns: 2 });
    expect(d.allowed).toBe(false);
    expect(d.exceeded).toEqual(expect.arrayContaining(["tokens", "costUsd", "runs"]));
    expect(d.remaining).toEqual({ tokens: 0, costUsd: 0, runs: 0 });
  });

  it("does not enforce an unprovided limit", () => {
    const d = checkEntitlement(usage, {});
    expect(d.allowed).toBe(true);
    expect(d.exceeded).toEqual([]);
    expect(d.remaining).toEqual({});
  });

  it("remaining is never negative", () => {
    const d = checkEntitlement(usage, { maxTokens: 10, maxCostUsd: 1, maxRuns: 1 });
    expect(d.remaining.tokens).toBeGreaterThanOrEqual(0);
    expect(d.remaining.costUsd).toBeGreaterThanOrEqual(0);
    expect(d.remaining.runs).toBeGreaterThanOrEqual(0);
  });

  it("fail-closed on a non-finite limit by ignoring it (not enforced, not crashing)", () => {
    const d = checkEntitlement(usage, { maxTokens: Number.NaN });
    expect(d.allowed).toBe(true);
    expect(d.remaining.tokens).toBeUndefined();
  });
});

describe("assertEntitled", () => {
  const usage = aggregateUsage([evt({ tokens: 1000, costUsd: 5 })], { orgId: ORG });

  it("returns void when entitled", () => {
    expect(assertEntitled(usage, { maxTokens: 5000 })).toBeUndefined();
  });

  it("throws a typed EntitlementError when over a limit", () => {
    expect(() => assertEntitled(usage, { maxTokens: 100 })).toThrow(EntitlementError);
    try {
      assertEntitled(usage, { maxTokens: 100 });
    } catch (err) {
      expect(err).toBeInstanceOf(EntitlementError);
      expect((err as EntitlementError).exceeded).toContain("tokens");
    }
  });
});
