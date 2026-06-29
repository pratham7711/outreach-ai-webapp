import { z } from "zod";

export interface UsageEvent {
  orgId: string;
  tool: string;
  tokens: number;
  costUsd: number;
  periodKey: string;
}

export interface ToolUsage {
  tokens: number;
  costUsd: number;
  runs: number;
}

export interface UsageAggregate {
  orgId: string;
  totalTokens: number;
  totalCostUsd: number;
  byTool: Record<string, ToolUsage>;
  runs: number;
}

export interface UsageContext {
  orgId: string;
}

export interface EntitlementLimits {
  maxTokens?: number;
  maxCostUsd?: number;
  maxRuns?: number;
}

export type EntitlementDimension = "tokens" | "costUsd" | "runs";

export interface EntitlementDecision {
  allowed: boolean;
  exceeded: EntitlementDimension[];
  remaining: {
    tokens?: number;
    costUsd?: number;
    runs?: number;
  };
}

export class EntitlementError extends Error {
  readonly exceeded: EntitlementDimension[];

  constructor(exceeded: EntitlementDimension[]) {
    super(`entitlement check failed: limit exceeded for ${exceeded.join(", ") || "unknown"}`);
    this.name = "EntitlementError";
    this.exceeded = exceeded;
  }
}

const usageEventSchema = z.object({
  orgId: z.string(),
  tool: z.string(),
  tokens: z.unknown(),
  costUsd: z.unknown(),
  periodKey: z.string(),
});

const limitsSchema = z.object({
  maxTokens: z.unknown().optional(),
  maxCostUsd: z.unknown().optional(),
  maxRuns: z.unknown().optional(),
});

function toSafeNonNegative(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function toFiniteLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < 0) {
    return 0;
  }
  return value;
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

export function aggregateUsage(events: UsageEvent[], ctx: UsageContext): UsageAggregate {
  const scopedOrgId = ctx?.orgId;
  const empty: UsageAggregate = {
    orgId: typeof scopedOrgId === "string" ? scopedOrgId : "",
    totalTokens: 0,
    totalCostUsd: 0,
    byTool: {},
    runs: 0,
  };

  if (typeof scopedOrgId !== "string" || scopedOrgId.length === 0) {
    return empty;
  }

  if (!Array.isArray(events)) {
    return empty;
  }

  let totalTokens = 0;
  let totalCostUsd = 0;
  let runs = 0;
  const byTool: Record<string, ToolUsage> = Object.create(null);

  for (const raw of events) {
    const parsed = usageEventSchema.safeParse(raw);
    if (!parsed.success) {
      continue;
    }
    const event = parsed.data;

    if (event.orgId !== scopedOrgId) {
      continue;
    }

    const tokens = toSafeNonNegative(event.tokens);
    const costUsd = toSafeNonNegative(event.costUsd);
    const tool = event.tool;

    totalTokens += tokens;
    totalCostUsd += costUsd;
    runs += 1;

    const existing = byTool[tool] ?? { tokens: 0, costUsd: 0, runs: 0 };
    byTool[tool] = {
      tokens: existing.tokens + tokens,
      costUsd: existing.costUsd + costUsd,
      runs: existing.runs + 1,
    };
  }

  return {
    orgId: scopedOrgId,
    totalTokens,
    totalCostUsd,
    byTool,
    runs,
  };
}

export function checkEntitlement(
  usage: UsageAggregate,
  limits: EntitlementLimits,
): EntitlementDecision {
  const parsedLimits = limitsSchema.safeParse(limits ?? {});
  const safeLimits = parsedLimits.success ? parsedLimits.data : {};

  const maxTokens = toFiniteLimit(safeLimits.maxTokens);
  const maxCostUsd = toFiniteLimit(safeLimits.maxCostUsd);
  const maxRuns = toFiniteLimit(safeLimits.maxRuns);

  const usedTokens = clampNonNegative(usage?.totalTokens ?? 0);
  const usedCostUsd = clampNonNegative(usage?.totalCostUsd ?? 0);
  const usedRuns = clampNonNegative(usage?.runs ?? 0);

  const exceeded: EntitlementDimension[] = [];
  const remaining: EntitlementDecision["remaining"] = {};

  if (maxTokens !== undefined) {
    if (usedTokens >= maxTokens) {
      exceeded.push("tokens");
    }
    remaining.tokens = clampNonNegative(maxTokens - usedTokens);
  }

  if (maxCostUsd !== undefined) {
    if (usedCostUsd >= maxCostUsd) {
      exceeded.push("costUsd");
    }
    remaining.costUsd = clampNonNegative(maxCostUsd - usedCostUsd);
  }

  if (maxRuns !== undefined) {
    if (usedRuns >= maxRuns) {
      exceeded.push("runs");
    }
    remaining.runs = clampNonNegative(maxRuns - usedRuns);
  }

  return {
    allowed: exceeded.length === 0,
    exceeded,
    remaining,
  };
}

export function assertEntitled(usage: UsageAggregate, limits: EntitlementLimits): void {
  const decision = checkEntitlement(usage, limits);
  if (!decision.allowed) {
    throw new EntitlementError(decision.exceeded);
  }
}
