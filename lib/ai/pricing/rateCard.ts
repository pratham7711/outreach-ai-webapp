import { z } from "zod";

export interface RateCardScoreFactor {
  label: string;
  impact: number;
  detail?: string;
}

export type RateBand = "below" | "fair" | "above";

export interface BenchmarkResult {
  percentile: number;
  band: RateBand;
  median: number;
  suggestedRange: { low: number; high: number };
  factors: RateCardScoreFactor[];
}

export interface BenchmarkInput {
  rate: number;
  peerRates: number[];
  opts?: {
    fairLowPct?: number;
    fairHighPct?: number;
  };
}

const NEUTRAL_PERCENTILE = 50;
const DEFAULT_FAIR_LOW_PCT = 25;
const DEFAULT_FAIR_HIGH_PCT = 75;

const finiteNumber = z
  .number()
  .refine((n) => Number.isFinite(n), { message: "value must be a finite number" });

const benchmarkInputSchema = z.object({
  rate: z.unknown(),
  peerRates: z.array(z.unknown()).catch([]),
  opts: z
    .object({
      fairLowPct: z.unknown().optional(),
      fairHighPct: z.unknown().optional(),
    })
    .nullable()
    .catch(null)
    .optional(),
});

function isFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function round(value: number, decimals: number): number {
  if (!isFinite(value)) {
    return 0;
  }
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function sanitizeDistribution(distribution: unknown): number[] {
  if (!Array.isArray(distribution)) {
    return [];
  }
  return distribution.filter((n): n is number => isFinite(n));
}

function coerceOptPct(value: unknown, fallback: number): number {
  return isFinite(value) ? clamp(value, 0, 100) : fallback;
}

export function percentileOf(value: number, distribution: number[]): number {
  const peers = sanitizeDistribution(distribution);
  if (peers.length === 0) {
    return NEUTRAL_PERCENTILE;
  }
  if (!isFinite(value)) {
    return NEUTRAL_PERCENTILE;
  }

  let below = 0;
  let equal = 0;
  for (const peer of peers) {
    if (peer < value) {
      below += 1;
    } else if (peer === value) {
      equal += 1;
    }
  }

  const rank = (below + equal / 2) / peers.length;
  return clamp(round(rank * 100, 4), 0, 100);
}

function quantileValue(sorted: number[], pct: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  const p = clamp(pct, 0, 100) / 100;
  const position = p * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lowerIndex === upperIndex) {
    return lower;
  }
  const fraction = position - lowerIndex;
  return lower + (upper - lower) * fraction;
}

function lowConfidenceResult(safeRate: number): BenchmarkResult {
  return {
    percentile: NEUTRAL_PERCENTILE,
    band: "fair",
    median: 0,
    suggestedRange: { low: 0, high: 0 },
    factors: [
      {
        label: "Peer sample",
        impact: 0,
        detail: "No peer rates available; low-confidence neutral benchmark",
      },
      {
        label: "Subject rate",
        impact: 0,
        detail: `Rate ${round(safeRate, 2)} could not be benchmarked against peers`,
      },
    ],
  };
}

export function benchmarkRate(input: BenchmarkInput): BenchmarkResult {
  const parsed = benchmarkInputSchema.safeParse(input);
  if (!parsed.success) {
    return lowConfidenceResult(0);
  }

  const rawRate = parsed.data.rate;
  const rateIsFinite = isFinite(rawRate);
  const safeRate = rateIsFinite ? rawRate : 0;
  const peers = sanitizeDistribution(parsed.data.peerRates);

  if (peers.length === 0 || !rateIsFinite) {
    return lowConfidenceResult(safeRate);
  }

  const opts = parsed.data.opts ?? undefined;
  const fairLowPct = coerceOptPct(opts?.fairLowPct, DEFAULT_FAIR_LOW_PCT);
  const fairHighPctRaw = coerceOptPct(opts?.fairHighPct, DEFAULT_FAIR_HIGH_PCT);
  const fairHighPct = Math.max(fairLowPct, fairHighPctRaw);

  const sorted = [...peers].sort((a, b) => a - b);
  const percentile = percentileOf(safeRate, peers);
  const median = round(quantileValue(sorted, 50), 4);
  const low = round(quantileValue(sorted, fairLowPct), 4);
  const high = round(quantileValue(sorted, fairHighPct), 4);
  const suggestedLow = Math.min(low, high);
  const suggestedHigh = Math.max(low, high);

  let band: RateBand;
  if (percentile < fairLowPct) {
    band = "below";
  } else if (percentile > fairHighPct) {
    band = "above";
  } else {
    band = "fair";
  }

  const factors: RateCardScoreFactor[] = [];

  factors.push({
    label: "Peer count",
    impact: clamp(peers.length / (peers.length + 5), 0, 1),
    detail: `Benchmarked against ${peers.length} peer rate${peers.length === 1 ? "" : "s"}`,
  });

  const percentileImpact = round((percentile - NEUTRAL_PERCENTILE) / 50, 4);
  factors.push({
    label: "Percentile",
    impact: clamp(percentileImpact, -1, 1),
    detail: `Rate sits at the ${round(percentile, 2)}th percentile of peers`,
  });

  const medianDelta =
    median === 0 ? 0 : round(clamp((safeRate - median) / median, -1, 1), 4);
  factors.push({
    label: "Median comparison",
    impact: medianDelta,
    detail:
      safeRate > median
        ? `Rate ${round(safeRate, 2)} is above peer median ${median}`
        : safeRate < median
          ? `Rate ${round(safeRate, 2)} is below peer median ${median}`
          : `Rate ${round(safeRate, 2)} matches peer median ${median}`,
  });

  const verdictDetail =
    band === "below"
      ? `Underpriced: below the ${fairLowPct}th percentile`
      : band === "above"
        ? `Overpriced: above the ${fairHighPct}th percentile`
        : `Fair: within the ${fairLowPct}th-${fairHighPct}th percentile band`;
  factors.push({
    label: "Verdict",
    impact: band === "below" ? -0.5 : band === "above" ? 0.5 : 0,
    detail: verdictDetail,
  });

  return {
    percentile,
    band,
    median,
    suggestedRange: { low: suggestedLow, high: suggestedHigh },
    factors,
  };
}

export const __schemas = { benchmarkInputSchema, finiteNumber };
