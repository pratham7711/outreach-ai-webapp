import { MODELS } from "@/lib/ai/models";

export interface ModelCost {
  inputPer1k: number;
  outputPer1k: number;
}

export const PLACEHOLDER_CONFIGURABLE_DEFAULT_ORCHESTRATOR_INPUT_PER_1K = 0.015;
export const PLACEHOLDER_CONFIGURABLE_DEFAULT_ORCHESTRATOR_OUTPUT_PER_1K = 0.075;
export const PLACEHOLDER_CONFIGURABLE_DEFAULT_SUBAGENT_INPUT_PER_1K = 0.001;
export const PLACEHOLDER_CONFIGURABLE_DEFAULT_SUBAGENT_OUTPUT_PER_1K = 0.005;
export const PLACEHOLDER_CONFIGURABLE_DEFAULT_ANALYST_INPUT_PER_1K = 0.003;
export const PLACEHOLDER_CONFIGURABLE_DEFAULT_ANALYST_OUTPUT_PER_1K = 0.015;

export const COST_TABLE: Record<string, ModelCost> = {
  [MODELS.orchestrator]: {
    inputPer1k: PLACEHOLDER_CONFIGURABLE_DEFAULT_ORCHESTRATOR_INPUT_PER_1K,
    outputPer1k: PLACEHOLDER_CONFIGURABLE_DEFAULT_ORCHESTRATOR_OUTPUT_PER_1K,
  },
  [MODELS.subagent]: {
    inputPer1k: PLACEHOLDER_CONFIGURABLE_DEFAULT_SUBAGENT_INPUT_PER_1K,
    outputPer1k: PLACEHOLDER_CONFIGURABLE_DEFAULT_SUBAGENT_OUTPUT_PER_1K,
  },
  [MODELS.analyst]: {
    inputPer1k: PLACEHOLDER_CONFIGURABLE_DEFAULT_ANALYST_INPUT_PER_1K,
    outputPer1k: PLACEHOLDER_CONFIGURABLE_DEFAULT_ANALYST_OUTPUT_PER_1K,
  },
};

export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CostBudget {
  maxTokens?: number;
  maxCostUsd?: number;
}

function safeNonNegative(value: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return value;
}

export function estimateCost(usage: TokenUsage): number {
  const cost = COST_TABLE[usage.model];
  if (!cost) {
    return 0;
  }
  const inputTokens = safeNonNegative(usage.inputTokens);
  const outputTokens = safeNonNegative(usage.outputTokens);
  const inputRate = safeNonNegative(cost.inputPer1k);
  const outputRate = safeNonNegative(cost.outputPer1k);
  return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
}

export interface CostTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface CostRemaining {
  tokens: number | null;
  costUsd: number | null;
}

export interface CostTracker {
  record(usage: TokenUsage): void;
  totals(): CostTotals;
  remaining(): CostRemaining;
  exceeded(): boolean;
}

export function createCostTracker(budget?: CostBudget): CostTracker {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  const maxTokens =
    budget && budget.maxTokens !== undefined ? safeNonNegative(budget.maxTokens) : null;
  const maxCostUsd =
    budget && budget.maxCostUsd !== undefined ? safeNonNegative(budget.maxCostUsd) : null;

  function record(usage: TokenUsage): void {
    inputTokens += safeNonNegative(usage.inputTokens);
    outputTokens += safeNonNegative(usage.outputTokens);
    costUsd += safeNonNegative(estimateCost(usage));
  }

  function totals(): CostTotals {
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd,
    };
  }

  function remaining(): CostRemaining {
    return {
      tokens: maxTokens === null ? null : Math.max(0, maxTokens - (inputTokens + outputTokens)),
      costUsd: maxCostUsd === null ? null : Math.max(0, maxCostUsd - costUsd),
    };
  }

  function exceeded(): boolean {
    if (maxTokens !== null && inputTokens + outputTokens > maxTokens) {
      return true;
    }
    if (maxCostUsd !== null && costUsd > maxCostUsd) {
      return true;
    }
    return false;
  }

  return { record, totals, remaining, exceeded };
}

export interface BudgetAssertion {
  ok: boolean;
  reason?: string;
}

export function assertWithinBudget(tracker: CostTracker): BudgetAssertion {
  if (tracker.exceeded()) {
    const t = tracker.totals();
    return {
      ok: false,
      reason: `Cost budget exceeded: ${t.totalTokens} tokens, $${t.costUsd} spent`,
    };
  }
  return { ok: true };
}
