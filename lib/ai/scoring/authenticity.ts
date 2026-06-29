export interface AuthenticityInput {
  followers: number;
  following: number;
  avgLikes: number;
  avgComments: number;
  avgViews: number;
  postCount: number;
  followerGrowthSeries?: number[];
  audienceCountryShares?: Record<string, number>;
}

export type Confidence = "low" | "medium" | "high";

export interface ScoreFactor {
  label: string;
  impact: number;
  detail?: string;
}

export type ScoreResult = {
  score: number;
  confidence: Confidence;
  factors: ScoreFactor[];
};

const NEUTRAL_BASE = 70;

const WEIGHT_ENGAGEMENT = 22;
const WEIGHT_COMMENT_QUALITY = 12;
const WEIGHT_FOLLOW_RATIO = 10;
const WEIGHT_GROWTH_SPIKE = 18;
const WEIGHT_GEO_CONCENTRATION = 8;

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function safeRatio(numerator: number, denominator: number): number {
  const num = safeNumber(numerator);
  const den = Math.max(safeNumber(denominator), 1);
  return safeNumber(num / den);
}

function median(values: number[]): number {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function engagementImpact(rate: number): number {
  if (rate <= 0) return -1;
  if (rate > 0.2) return -1;
  if (rate < 0.005) return -0.85;
  if (rate < 0.01) return -0.3;
  if (rate <= 0.1) return 1;
  if (rate <= 0.15) return 0.2;
  return -0.5;
}

function commentQualityImpact(ratio: number): number {
  if (ratio < 0.005) return -0.9;
  if (ratio < 0.01) return -0.3;
  if (ratio <= 0.25) return 0.6;
  return 0.1;
}

function followRatioImpact(ratio: number, following: number): number {
  if (following > 1500 && ratio < 0.5) return -0.9;
  if (ratio < 0.1) return -0.6;
  if (ratio < 0.5) return -0.2;
  return 0.2;
}

export function scoreAuthenticity(input: AuthenticityInput): ScoreResult {
  const followers = Math.max(safeNumber(input.followers), 0);
  const following = Math.max(safeNumber(input.following), 0);
  const avgLikes = Math.max(safeNumber(input.avgLikes), 0);
  const avgComments = Math.max(safeNumber(input.avgComments), 0);
  const postCount = Math.max(safeNumber(input.postCount), 0);

  const factors: ScoreFactor[] = [];

  const engagementRate = safeRatio(avgLikes + avgComments, followers);
  const engImpact = engagementImpact(engagementRate);
  factors.push({
    label: "Engagement rate",
    impact: engImpact,
    detail: `${(engagementRate * 100).toFixed(2)}% of followers engaging`,
  });

  const commentToLike = safeRatio(avgComments, avgLikes);
  const commentImpact = commentQualityImpact(commentToLike);
  factors.push({
    label: "Comment quality",
    impact: commentImpact,
    detail: `${(commentToLike * 100).toFixed(2)}% comment-to-like ratio`,
  });

  const followRatio = safeRatio(followers, following);
  const followImpact = followRatioImpact(followRatio, following);
  factors.push({
    label: "Follow ratio",
    impact: followImpact,
    detail: `${followRatio.toFixed(2)} followers per following`,
  });

  const hasGrowthSeries =
    Array.isArray(input.followerGrowthSeries) && input.followerGrowthSeries.length > 0;
  if (hasGrowthSeries) {
    const series = (input.followerGrowthSeries as number[]).map(safeNumber);
    const maxPeriod = series.reduce((acc, value) => (value > acc ? value : acc), 0);
    const med = median(series);
    const spikeRatio = safeRatio(maxPeriod, Math.max(med, 1));
    const largeAbsoluteAdd = maxPeriod > 1000;
    if (med > 0 && spikeRatio > 5 && largeAbsoluteAdd) {
      factors.push({
        label: "Suspicious growth spike",
        impact: clamp(-0.4 - (spikeRatio - 5) * 0.06, -1, -0.4),
        detail: `Peak period is ${spikeRatio.toFixed(1)}x the median`,
      });
    } else if (med <= 0 && largeAbsoluteAdd) {
      factors.push({
        label: "Suspicious growth spike",
        impact: -0.7,
        detail: "Large add against a flat baseline",
      });
    }
  }

  const hasGeoShares =
    input.audienceCountryShares !== undefined &&
    Object.keys(input.audienceCountryShares).length > 0;
  if (hasGeoShares) {
    const shares = Object.values(input.audienceCountryShares as Record<string, number>).map(
      safeNumber,
    );
    const maxShare = shares.reduce((acc, value) => (value > acc ? value : acc), 0);
    if (maxShare > 0.85) {
      factors.push({
        label: "Audience geo concentration",
        impact: -0.4,
        detail: `${(maxShare * 100).toFixed(0)}% from a single country`,
      });
    }
  }

  let raw = NEUTRAL_BASE;
  for (const factor of factors) {
    switch (factor.label) {
      case "Engagement rate":
        raw += factor.impact * WEIGHT_ENGAGEMENT;
        break;
      case "Comment quality":
        raw += factor.impact * WEIGHT_COMMENT_QUALITY;
        break;
      case "Follow ratio":
        raw += factor.impact * WEIGHT_FOLLOW_RATIO;
        break;
      case "Suspicious growth spike":
        raw += factor.impact * WEIGHT_GROWTH_SPIKE;
        break;
      case "Audience geo concentration":
        raw += factor.impact * WEIGHT_GEO_CONCENTRATION;
        break;
      default:
        break;
    }
  }

  const score = clamp(Math.round(raw), 0, 100);

  const presentSignals = [hasGrowthSeries, hasGeoShares, postCount >= 10].filter(Boolean).length;
  let confidence: Confidence;
  if (presentSignals === 3) {
    confidence = "high";
  } else if (presentSignals >= 1) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    score,
    confidence,
    factors: factors.map((factor) => ({
      ...factor,
      impact: clamp(factor.impact, -1, 1),
    })),
  };
}
