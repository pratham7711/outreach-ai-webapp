export interface AudienceSignals {
  countrySamples?: Record<string, number>;
  ageSamples?: Record<string, number>;
  interestSamples?: Record<string, number>;
  sampleSize?: number;
}

export type DistributionEntry = {
  key: string;
  share: number;
};

export type Distribution = DistributionEntry[];

export type AudienceQuality = {
  confidence: "low" | "medium" | "high";
  flags: string[];
};

export type AudienceEstimate = {
  geo: Distribution;
  age: Distribution;
  interests: Distribution;
  quality: AudienceQuality;
};

const LOW_SAMPLE_THRESHOLD = 1000;
const GEO_CONCENTRATION_THRESHOLD = 0.85;
const MIN_INTEREST_BUCKETS = 2;

function isFiniteNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeCount(value: number): number {
  if (!isFiniteNumber(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return value;
}

export function normalizeDistribution(
  samples: Record<string, number> | undefined,
): Distribution {
  if (!samples) {
    return [];
  }

  const sanitized: Array<{ key: string; count: number }> = [];
  let total = 0;

  for (const key of Object.keys(samples)) {
    const count = sanitizeCount(samples[key]);
    sanitized.push({ key, count });
    total += count;
  }

  if (sanitized.length === 0 || total <= 0 || !Number.isFinite(total)) {
    return [];
  }

  const entries: Distribution = sanitized.map((entry) => ({
    key: entry.key,
    share: entry.count / total,
  }));

  entries.sort((a, b) => {
    if (b.share !== a.share) {
      return b.share - a.share;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return entries;
}

function topShare(distribution: Distribution): number {
  if (distribution.length === 0) {
    return 0;
  }
  return distribution[0].share;
}

export function estimateAudience(input: AudienceSignals): AudienceEstimate {
  const geo = normalizeDistribution(input.countrySamples);
  const age = normalizeDistribution(input.ageSamples);
  const interests = normalizeDistribution(input.interestSamples);

  const sampleSize = isFiniteNumber(input.sampleSize ?? NaN)
    ? Math.max(input.sampleSize as number, 0)
    : 0;

  const flags: string[] = [];

  if (sampleSize < LOW_SAMPLE_THRESHOLD) {
    flags.push("LOW_SAMPLE");
  }

  if (topShare(geo) > GEO_CONCENTRATION_THRESHOLD) {
    flags.push("GEO_CONCENTRATION");
  }

  if (interests.length < MIN_INTEREST_BUCKETS) {
    flags.push("SPARSE_INTERESTS");
  }

  const dimensionsPresent = [
    geo.length > 0,
    age.length > 0,
    interests.length > 0,
  ].filter(Boolean).length;

  let confidence: AudienceQuality["confidence"];
  if (sampleSize >= LOW_SAMPLE_THRESHOLD && dimensionsPresent === 3) {
    confidence = "high";
  } else if (dimensionsPresent >= 1) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    geo,
    age,
    interests,
    quality: {
      confidence,
      flags,
    },
  };
}
