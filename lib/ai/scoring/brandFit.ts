export interface BrandFitInput {
  creatorCategories: string[];
  creatorAudience: {
    countryShares?: Record<string, number>;
    ageShares?: Record<string, number>;
    interestShares?: Record<string, number>;
  };
  creatorBrandSafetyFlags?: string[];
  brand: {
    categories: string[];
    targetCountries?: string[];
    targetAgeBands?: string[];
    targetInterests?: string[];
    brandSafetyLevel?: "strict" | "standard";
  };
}

export interface ScoreFactor {
  label: string;
  impact: number;
  detail?: string;
}

export type ScoreResult = {
  score: number;
  confidence: "low" | "medium" | "high";
  factors: ScoreFactor[];
};

const STRICT_SAFETY_CAP = 25;

function isFiniteNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!isFiniteNumber(value)) {
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

function round1(value: number): number {
  if (!isFiniteNumber(value)) {
    return 0;
  }
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  if (!isFiniteNumber(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function toKeySet(values: string[] | undefined): Set<string> {
  const set = new Set<string>();
  if (!values) {
    return set;
  }
  for (const value of values) {
    if (typeof value === "string") {
      const key = normalizeKey(value);
      if (key.length > 0) {
        set.add(key);
      }
    }
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  if (union <= 0) {
    return 0;
  }
  const ratio = intersection / union;
  return isFiniteNumber(ratio) ? clamp(ratio, 0, 1) : 0;
}

function shareSum(
  shares: Record<string, number> | undefined,
  targets: string[] | undefined,
): number {
  if (!shares || !targets || targets.length === 0) {
    return 0;
  }
  const normalized = new Map<string, number>();
  for (const rawKey of Object.keys(shares)) {
    const value = shares[rawKey];
    if (isFiniteNumber(value)) {
      normalized.set(normalizeKey(rawKey), value);
    }
  }
  let total = 0;
  for (const target of targets) {
    if (typeof target !== "string") {
      continue;
    }
    const value = normalized.get(normalizeKey(target));
    if (value !== undefined && isFiniteNumber(value)) {
      total += value;
    }
  }
  return clamp(total, 0, 1);
}

function hasShareData(shares: Record<string, number> | undefined): boolean {
  return !!shares && Object.keys(shares).length > 0;
}

export function scoreBrandFit(input: BrandFitInput): ScoreResult {
  const creatorCategories = toKeySet(input.creatorCategories);
  const brandCategories = toKeySet(input.brand?.categories);

  const categoryOverlap = jaccard(creatorCategories, brandCategories);

  const geoUsable =
    hasShareData(input.creatorAudience?.countryShares) &&
    !!input.brand?.targetCountries &&
    input.brand.targetCountries.length > 0;
  const interestUsable =
    hasShareData(input.creatorAudience?.interestShares) &&
    !!input.brand?.targetInterests &&
    input.brand.targetInterests.length > 0;
  const ageUsable =
    hasShareData(input.creatorAudience?.ageShares) &&
    !!input.brand?.targetAgeBands &&
    input.brand.targetAgeBands.length > 0;

  const geoAlignment = geoUsable
    ? shareSum(input.creatorAudience.countryShares, input.brand.targetCountries)
    : 0;
  const interestAlignment = interestUsable
    ? shareSum(input.creatorAudience.interestShares, input.brand.targetInterests)
    : 0;
  const ageAlignment = ageUsable
    ? shareSum(input.creatorAudience.ageShares, input.brand.targetAgeBands)
    : 0;

  const factors: ScoreFactor[] = [];

  const CATEGORY_WEIGHT = 0.4;
  const GEO_WEIGHT = 0.25;
  const INTEREST_WEIGHT = 0.2;
  const AGE_WEIGHT = 0.15;

  let weightedSum = categoryOverlap * CATEGORY_WEIGHT;
  let weightUsed = CATEGORY_WEIGHT;

  factors.push({
    label: "Category match",
    impact: round2(categoryOverlap),
    detail: `Jaccard overlap ${round2(categoryOverlap)} of creator vs brand categories`,
  });

  if (geoUsable) {
    weightedSum += geoAlignment * GEO_WEIGHT;
    weightUsed += GEO_WEIGHT;
    factors.push({
      label: "Audience geo fit",
      impact: round2(geoAlignment),
      detail: `${Math.round(geoAlignment * 100)}% of audience in target countries`,
    });
  }

  if (interestUsable) {
    weightedSum += interestAlignment * INTEREST_WEIGHT;
    weightUsed += INTEREST_WEIGHT;
    factors.push({
      label: "Interest fit",
      impact: round2(interestAlignment),
      detail: `${Math.round(interestAlignment * 100)}% of audience interests align`,
    });
  }

  if (ageUsable) {
    weightedSum += ageAlignment * AGE_WEIGHT;
    weightUsed += AGE_WEIGHT;
    factors.push({
      label: "Age fit",
      impact: round2(ageAlignment),
      detail: `${Math.round(ageAlignment * 100)}% of audience in target age bands`,
    });
  }

  const base = weightUsed > 0 ? weightedSum / weightUsed : 0;
  let score = clamp(base * 100, 0, 100);

  const flags = (input.creatorBrandSafetyFlags ?? []).filter(
    (flag) => typeof flag === "string" && flag.trim().length > 0,
  );
  const hasFlags = flags.length > 0;
  const isStrict = input.brand?.brandSafetyLevel === "strict";

  if (hasFlags) {
    if (isStrict) {
      score = clamp(Math.min(score, STRICT_SAFETY_CAP), 0, 100);
      factors.push({
        label: "Brand safety",
        impact: -1,
        detail: `Strict brand blocks creator flags: ${flags.join(", ")} (score capped at ${STRICT_SAFETY_CAP})`,
      });
    } else {
      const penaltyPoints = clamp(10 * flags.length, 0, 40);
      score = clamp(score - penaltyPoints, 0, 100);
      factors.push({
        label: "Brand safety",
        impact: round2(-(penaltyPoints / 100)),
        detail: `Standard brand penalized for flags: ${flags.join(", ")}`,
      });
    }
  }

  score = clamp(round1(score), 0, 100);

  let presentSignals = 0;
  if (brandCategories.size > 0 || creatorCategories.size > 0) {
    presentSignals += 1;
  }
  if (geoUsable) {
    presentSignals += 1;
  }
  if (interestUsable) {
    presentSignals += 1;
  }
  if (ageUsable) {
    presentSignals += 1;
  }

  let confidence: ScoreResult["confidence"];
  if (presentSignals >= 4) {
    confidence = "high";
  } else if (presentSignals >= 2) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return { score, confidence, factors };
}
