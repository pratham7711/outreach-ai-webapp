import { MODELS } from "@/lib/ai/models";
import {
  COST_TABLE,
  estimateCost,
  createCostTracker,
  assertWithinBudget,
  type TokenUsage,
} from "@/lib/ai/guards/costGuard";

describe("estimateCost", () => {
  it("computes cost for a known model from its per-1k rates", () => {
    const usage: TokenUsage = {
      model: MODELS.subagent,
      inputTokens: 2000,
      outputTokens: 1000,
    };
    const rate = COST_TABLE[MODELS.subagent];
    const expected = (2000 / 1000) * rate.inputPer1k + (1000 / 1000) * rate.outputPer1k;
    expect(estimateCost(usage)).toBeCloseTo(expected, 12);
    expect(estimateCost(usage)).toBeGreaterThan(0);
  });

  it("returns 0 for an unknown model", () => {
    expect(
      estimateCost({ model: "totally-unknown-model", inputTokens: 5000, outputTokens: 5000 }),
    ).toBe(0);
  });

  it("coerces negative, NaN, and Infinity token counts to 0", () => {
    expect(
      estimateCost({ model: MODELS.analyst, inputTokens: -100, outputTokens: -50 }),
    ).toBe(0);
    expect(
      estimateCost({ model: MODELS.analyst, inputTokens: Number.NaN, outputTokens: 10 }),
    ).toBeCloseTo((10 / 1000) * COST_TABLE[MODELS.analyst].outputPer1k, 12);
    expect(
      estimateCost({
        model: MODELS.analyst,
        inputTokens: Number.POSITIVE_INFINITY,
        outputTokens: Number.NEGATIVE_INFINITY,
      }),
    ).toBe(0);
  });
});

describe("createCostTracker", () => {
  it("accumulates tokens and cost across multiple record() calls", () => {
    const tracker = createCostTracker();
    tracker.record({ model: MODELS.subagent, inputTokens: 1000, outputTokens: 500 });
    tracker.record({ model: MODELS.subagent, inputTokens: 2000, outputTokens: 1000 });

    const totals = tracker.totals();
    expect(totals.inputTokens).toBe(3000);
    expect(totals.outputTokens).toBe(1500);
    expect(totals.totalTokens).toBe(4500);
    const rate = COST_TABLE[MODELS.subagent];
    const expectedCost =
      (3000 / 1000) * rate.inputPer1k + (1500 / 1000) * rate.outputPer1k;
    expect(totals.costUsd).toBeCloseTo(expectedCost, 12);
  });

  it("flips exceeded() at the token bound", () => {
    const tracker = createCostTracker({ maxTokens: 1000 });
    tracker.record({ model: MODELS.subagent, inputTokens: 600, outputTokens: 400 });
    expect(tracker.exceeded()).toBe(false);
    tracker.record({ model: MODELS.subagent, inputTokens: 1, outputTokens: 0 });
    expect(tracker.exceeded()).toBe(true);
  });

  it("flips exceeded() at the cost bound", () => {
    const rate = COST_TABLE[MODELS.orchestrator];
    const oneCallCost = (1000 / 1000) * rate.inputPer1k + (1000 / 1000) * rate.outputPer1k;
    const tracker = createCostTracker({ maxCostUsd: oneCallCost + oneCallCost / 2 });
    tracker.record({ model: MODELS.orchestrator, inputTokens: 1000, outputTokens: 1000 });
    expect(tracker.exceeded()).toBe(false);
    tracker.record({ model: MODELS.orchestrator, inputTokens: 1000, outputTokens: 1000 });
    expect(tracker.exceeded()).toBe(true);
  });

  it("clamps remaining() to >=0 and returns null when a bound is unset", () => {
    const tracker = createCostTracker({ maxTokens: 1000 });
    tracker.record({ model: MODELS.subagent, inputTokens: 5000, outputTokens: 5000 });
    const remaining = tracker.remaining();
    expect(remaining.tokens).toBe(0);
    expect(remaining.costUsd).toBeNull();
  });

  it("produces identical totals for identical record sequences (determinism)", () => {
    const records: TokenUsage[] = [
      { model: MODELS.subagent, inputTokens: 1234, outputTokens: 567 },
      { model: MODELS.analyst, inputTokens: 89, outputTokens: 42 },
      { model: MODELS.orchestrator, inputTokens: 1000, outputTokens: 2000 },
    ];
    const a = createCostTracker();
    const b = createCostTracker();
    for (const r of records) {
      a.record(r);
      b.record(r);
    }
    expect(a.totals()).toEqual(b.totals());
  });
});

describe("assertWithinBudget", () => {
  it("is ok before the budget is exceeded and not-ok with a reason after", () => {
    const tracker = createCostTracker({ maxTokens: 1000 });
    tracker.record({ model: MODELS.subagent, inputTokens: 500, outputTokens: 200 });
    const before = assertWithinBudget(tracker);
    expect(before.ok).toBe(true);
    expect(before.reason).toBeUndefined();

    tracker.record({ model: MODELS.subagent, inputTokens: 800, outputTokens: 100 });
    const after = assertWithinBudget(tracker);
    expect(after.ok).toBe(false);
    expect(typeof after.reason).toBe("string");
    expect(after.reason && after.reason.length).toBeGreaterThan(0);
  });
});
