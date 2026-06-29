export interface IngestedRecord {
  source: string;
  fetchedAtLabel?: string;
  fields: Record<string, unknown>;
  requiredFields?: string[];
  metricFields?: string[];
}

export interface DataQualityOptions {
  minScore?: number;
  minCompleteness?: number;
  ageHint?: number;
  maxAge?: number;
}

export interface DataQualityResult {
  score: number;
  confidence: "low" | "medium" | "high";
  flags: string[];
  usable: boolean;
}

const DEFAULT_MIN_SCORE = 50;
const DEFAULT_MIN_COMPLETENESS = 0.8;

const PENALTY_MISSING_REQUIRED = 35;
const PENALTY_LOW_COMPLETENESS = 20;
const PENALTY_STALE = 15;
const PENALTY_SUSPICIOUS_ZEROS = 25;
const PENALTY_EMPTY = 100;

const FLAG_EMPTY = "EMPTY";
const FLAG_MISSING_REQUIRED = "MISSING_REQUIRED";
const FLAG_LOW_COMPLETENESS = "LOW_COMPLETENESS";
const FLAG_STALE = "STALE";
const FLAG_SUSPICIOUS_ZEROS = "SUSPICIOUS_ZEROS";

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function safeFraction(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator <= 0) return 0;
  const fraction = numerator / denominator;
  if (!Number.isFinite(fraction)) return 0;
  return clamp(fraction, 0, 1);
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function isZero(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value === 0;
}

export function assessQuality(
  record: IngestedRecord,
  opts?: DataQualityOptions,
): DataQualityResult {
  const minScore = Number.isFinite(opts?.minScore as number)
    ? (opts?.minScore as number)
    : DEFAULT_MIN_SCORE;
  const minCompleteness = Number.isFinite(opts?.minCompleteness as number)
    ? clamp(opts?.minCompleteness as number, 0, 1)
    : DEFAULT_MIN_COMPLETENESS;

  const fields = record.fields ?? {};
  const fieldKeys = Object.keys(fields);
  const requiredFields = Array.isArray(record.requiredFields)
    ? record.requiredFields
    : [];
  const metricFields = Array.isArray(record.metricFields)
    ? record.metricFields
    : [];

  const flags: string[] = [];

  const isEmpty = fieldKeys.length === 0;
  if (isEmpty) {
    flags.push(FLAG_EMPTY);
  }

  const presentRequiredCount = requiredFields.filter((key) =>
    isPresent(fields[key]),
  ).length;
  const hasMissingRequired =
    requiredFields.length > 0 && presentRequiredCount < requiredFields.length;
  if (hasMissingRequired) {
    flags.push(FLAG_MISSING_REQUIRED);
  }

  const requiredCompleteness =
    requiredFields.length > 0
      ? safeFraction(presentRequiredCount, requiredFields.length)
      : 1;
  if (requiredFields.length > 0 && requiredCompleteness < minCompleteness) {
    flags.push(FLAG_LOW_COMPLETENESS);
  }

  const ageHint = opts?.ageHint;
  const maxAge = opts?.maxAge;
  const isStale =
    ageHint !== null &&
    ageHint !== undefined &&
    maxAge !== null &&
    maxAge !== undefined &&
    Number.isFinite(ageHint) &&
    Number.isFinite(maxAge) &&
    ageHint > maxAge;
  if (isStale) {
    flags.push(FLAG_STALE);
  }

  const metricsPresent =
    metricFields.length > 0 &&
    metricFields.every((key) => isPresent(fields[key]));
  const allMetricsZero =
    metricsPresent && metricFields.every((key) => isZero(fields[key]));
  if (allMetricsZero) {
    flags.push(FLAG_SUSPICIOUS_ZEROS);
  }

  const completeness = requiredFields.length > 0 ? requiredCompleteness : 1;

  let score = completeness * 100;
  if (isEmpty) score -= PENALTY_EMPTY;
  if (hasMissingRequired) score -= PENALTY_MISSING_REQUIRED;
  if (requiredFields.length > 0 && requiredCompleteness < minCompleteness) {
    score -= PENALTY_LOW_COMPLETENESS;
  }
  if (isStale) score -= PENALTY_STALE;
  if (allMetricsZero) score -= PENALTY_SUSPICIOUS_ZEROS;

  const finalScore = Math.round(clamp(score, 0, 100));

  let confidence: DataQualityResult["confidence"];
  if (isEmpty || hasMissingRequired) {
    confidence = "low";
  } else if (completeness >= 0.95 && fieldKeys.length >= 3) {
    confidence = "high";
  } else if (completeness >= minCompleteness) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  const usable = finalScore >= minScore && !hasMissingRequired && !isEmpty;

  return {
    score: finalScore,
    confidence,
    flags,
    usable,
  };
}
