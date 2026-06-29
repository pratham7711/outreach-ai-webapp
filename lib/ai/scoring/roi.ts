export interface RoiInput {
  followers: number;
  engagementRate: number;
  avgViews: number;
  pastCampaignConversions?: number[];
  benchmarkConversionRate?: number;
  productPrice?: number;
  estimatedCost?: number;
  category?: string;
}

export type Confidence = "low" | "medium" | "high";

export interface ScoreFactor {
  label: string;
  impact: number;
  detail?: string;
}

export interface ScoreResult {
  score: number;
  confidence: Confidence;
  factors: ScoreFactor[];
}

export interface RoiProjection {
  expectedReach: number;
  expectedConversions: number;
  expectedRevenue: number;
  expectedRoiMultiple: number;
}

export interface RoiForecast extends ScoreResult {
  projection: RoiProjection;
}

const DEFAULT_BENCHMARK_CONVERSION_RATE = 0.01;

const HIGH_VALUE_CATEGORIES = new Set([
  "finance",
  "saas",
  "software",
  "tech",
  "education",
  "b2b",
]);

const LOW_VALUE_CATEGORIES = new Set([
  "entertainment",
  "meme",
  "lifestyle",
  "general",
]);

function safeNumber(value: number | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  const n = safeNumber(value, min);
  if (n < min) {
    return min;
  }
  if (n > max) {
    return max;
  }
  return n;
}

function safeRatio(numerator: number, denominator: number): number {
  const num = safeNumber(numerator, 0);
  const den = safeNumber(denominator, 0);
  if (den === 0) {
    return 0;
  }
  const ratio = num / den;
  if (!Number.isFinite(ratio)) {
    return 0;
  }
  return ratio;
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  const scaled = safeNumber(value, 0) * factor;
  return Math.round(scaled) / factor;
}

function categorySignal(category?: string): number {
  if (!category) {
    return 0;
  }
  const key = category.trim().toLowerCase();
  if (key.length === 0) {
    return 0;
  }
  if (HIGH_VALUE_CATEGORIES.has(key)) {
    return 0.2;
  }
  if (LOW_VALUE_CATEGORIES.has(key)) {
    return -0.15;
  }
  return 0.05;
}

function historicalImpliedRate(
  pastCampaignConversions: number[] | undefined,
  reach: number,
): number | null {
  if (!pastCampaignConversions || pastCampaignConversions.length === 0) {
    return null;
  }
  const sane = pastCampaignConversions
    .map((v) => safeNumber(v, 0))
    .filter((v) => v >= 0);
  if (sane.length === 0) {
    return null;
  }
  const total = sane.reduce((acc, v) => acc + v, 0);
  const avgConversions = safeRatio(total, sane.length);
  if (reach <= 0) {
    return null;
  }
  return clamp(safeRatio(avgConversions, reach), 0, 1);
}

export function forecastRoi(input: RoiInput): RoiForecast {
  const followers = Math.max(0, safeNumber(input.followers, 0));
  const engagementRate = clamp(safeNumber(input.engagementRate, 0), 0, 1);
  const avgViews = Math.max(0, safeNumber(input.avgViews, 0));
  const productPrice = Math.max(0, safeNumber(input.productPrice, 0));
  const estimatedCost = Math.max(0, safeNumber(input.estimatedCost, 0));

  const benchmarkConversionRate = clamp(
    input.benchmarkConversionRate === undefined
      ? DEFAULT_BENCHMARK_CONVERSION_RATE
      : safeNumber(input.benchmarkConversionRate, DEFAULT_BENCHMARK_CONVERSION_RATE),
    0,
    1,
  );

  const expectedReach = avgViews > 0 ? avgViews : followers * engagementRate;

  const hasHistory =
    Array.isArray(input.pastCampaignConversions) &&
    input.pastCampaignConversions.length > 0;

  const implied = historicalImpliedRate(input.pastCampaignConversions, expectedReach);

  let effectiveConvRate: number;
  if (implied !== null) {
    effectiveConvRate = clamp(implied * 0.6 + benchmarkConversionRate * 0.4, 0, 1);
  } else {
    effectiveConvRate = benchmarkConversionRate;
  }

  const expectedConversions = Math.max(0, expectedReach * effectiveConvRate);
  const expectedRevenue = Math.max(0, expectedConversions * productPrice);

  let expectedRoiMultiple: number;
  if (estimatedCost > 0) {
    expectedRoiMultiple = safeRatio(expectedRevenue, estimatedCost);
  } else if (productPrice > 0) {
    expectedRoiMultiple = safeRatio(expectedRevenue, productPrice * 1000);
  } else {
    expectedRoiMultiple = 0;
  }
  expectedRoiMultiple = Math.max(0, safeNumber(expectedRoiMultiple, 0));

  const saturating = safeRatio(expectedRoiMultiple, expectedRoiMultiple + 1);
  const score = clamp(round(100 * saturating, 2), 0, 100);

  const factors: ScoreFactor[] = [];

  const reachSignal = clamp(safeRatio(expectedReach, expectedReach + 100_000), 0, 1);
  factors.push({
    label: "Projected reach",
    impact: round(reachSignal, 4),
    detail: `Expected reach ${Math.round(expectedReach).toLocaleString("en-US")}`,
  });

  if (hasHistory) {
    const historyImpact = clamp((effectiveConvRate - benchmarkConversionRate) * 10, -1, 1);
    factors.push({
      label: "Historical conversion",
      impact: round(historyImpact, 4),
      detail: `Blended conversion rate ${round(effectiveConvRate * 100, 2)}%`,
    });
  }

  const catSignal = categorySignal(input.category);
  factors.push({
    label: "Category",
    impact: round(catSignal, 4),
    detail: input.category ? `Category: ${input.category}` : "No category provided",
  });

  let costSignal: number;
  if (estimatedCost > 0) {
    costSignal = clamp(saturating * 2 - 1, -1, 1);
  } else {
    costSignal = -0.1;
  }
  factors.push({
    label: "Cost leverage",
    impact: round(costSignal, 4),
    detail:
      estimatedCost > 0
        ? `ROI multiple ${round(expectedRoiMultiple, 2)}x`
        : "No estimated cost provided",
  });

  let presentSignals = 0;
  if (hasHistory) {
    presentSignals += 1;
  }
  if (estimatedCost > 0) {
    presentSignals += 1;
  }
  if (productPrice > 0) {
    presentSignals += 1;
  }

  let confidence: Confidence;
  if (presentSignals >= 3) {
    confidence = "high";
  } else if (presentSignals >= 1) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  const projection: RoiProjection = {
    expectedReach: round(expectedReach, 2),
    expectedConversions: round(expectedConversions, 4),
    expectedRevenue: round(expectedRevenue, 2),
    expectedRoiMultiple: round(expectedRoiMultiple, 4),
  };

  return {
    score,
    confidence,
    factors,
    projection,
  };
}
