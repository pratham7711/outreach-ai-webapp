import { z } from "zod";

export interface GroundingResult {
  grounded: boolean;
  total: number;
  supported: number;
  unsupported: string[];
  hallucinationRate: number;
}

export interface SampleResult {
  caseCount: number;
  meanHallucinationRate: number;
  worst: { index: number; rate: number } | null;
  failures: number;
  passRate: number;
}

export interface SampleOpts {
  threshold?: number;
}

export interface AssertOpts {
  maxMeanRate?: number;
  minPassRate?: number;
}

const evidenceValueSchema = z.union([z.string(), z.number()]);

const caseSchema = z.object({
  output: z.string(),
  evidenceValues: z.array(evidenceValueSchema),
});

export class GroundingQualityError extends Error {
  readonly meanHallucinationRate: number;
  readonly passRate: number;
  readonly maxMeanRate: number | null;
  readonly minPassRate: number | null;

  constructor(params: {
    message: string;
    meanHallucinationRate: number;
    passRate: number;
    maxMeanRate: number | null;
    minPassRate: number | null;
  }) {
    super(params.message);
    this.name = "GroundingQualityError";
    this.meanHallucinationRate = params.meanHallucinationRate;
    this.passRate = params.passRate;
    this.maxMeanRate = params.maxMeanRate;
    this.minPassRate = params.minPassRate;
  }
}

const NUMERIC_TOKEN_PATTERN = /(?<!\d)-?\d+(?:\.\d+)?%?/g;

function extractNumericTokens(text: string): string[] {
  const matches = text.match(NUMERIC_TOKEN_PATTERN);
  return matches ?? [];
}

function normalizeNumericString(raw: string): string | null {
  const stripped = raw.endsWith("%") ? raw.slice(0, -1) : raw;
  const value = Number(stripped);
  if (!Number.isFinite(value)) return null;
  return String(value);
}

function normalizeEvidenceValue(value: string | number): string[] {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return [];
    return [String(value)];
  }
  const out: string[] = [];
  for (const token of extractNumericTokens(value)) {
    const normalized = normalizeNumericString(token);
    if (normalized !== null) out.push(normalized);
  }
  return out;
}

function buildAllowedSet(evidenceValues: (string | number)[]): Set<string> {
  const allowed = new Set<string>();
  for (const value of evidenceValues) {
    for (const normalized of normalizeEvidenceValue(value)) {
      allowed.add(normalized);
    }
  }
  return allowed;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  if (rate < 0) return 0;
  if (rate > 1) return 1;
  return rate;
}

export function evaluateGrounding(
  output: string,
  evidenceValues: (string | number)[],
): GroundingResult {
  const safeOutput = typeof output === "string" ? output : "";
  const safeEvidence = Array.isArray(evidenceValues) ? evidenceValues : [];
  const allowed = buildAllowedSet(safeEvidence);

  const tokens = extractNumericTokens(safeOutput);
  const total = tokens.length;

  if (total === 0) {
    return {
      grounded: true,
      total: 0,
      supported: 0,
      unsupported: [],
      hallucinationRate: 0,
    };
  }

  let supported = 0;
  const unsupported: string[] = [];

  for (const token of tokens) {
    const normalized = normalizeNumericString(token);
    if (normalized !== null && allowed.has(normalized)) {
      supported += 1;
    } else {
      unsupported.push(token);
    }
  }

  const hallucinationRate = clampRate(unsupported.length / total);

  return {
    grounded: unsupported.length === 0,
    total,
    supported,
    unsupported,
    hallucinationRate,
  };
}

export function evaluateSample(
  cases: { output: string; evidenceValues: (string | number)[] }[],
  opts: SampleOpts = {},
): SampleResult {
  const parsed = z.array(caseSchema).parse(cases);
  const threshold = clampRate(opts.threshold ?? 0);

  const caseCount = parsed.length;

  if (caseCount === 0) {
    return {
      caseCount: 0,
      meanHallucinationRate: 0,
      worst: null,
      failures: 0,
      passRate: 1,
    };
  }

  let rateSum = 0;
  let failures = 0;
  let worst: { index: number; rate: number } | null = null;

  for (let index = 0; index < parsed.length; index += 1) {
    const single = parsed[index];
    const result = evaluateGrounding(single.output, single.evidenceValues);
    const rate = result.hallucinationRate;
    rateSum += rate;

    if (rate > threshold) {
      failures += 1;
    }

    if (worst === null || rate > worst.rate) {
      worst = { index, rate };
    }
  }

  const meanHallucinationRate = clampRate(rateSum / caseCount);
  const passRate = clampRate((caseCount - failures) / caseCount);

  return {
    caseCount,
    meanHallucinationRate,
    worst,
    failures,
    passRate,
  };
}

export function assertGroundingQuality(
  result: SampleResult,
  opts: AssertOpts = {},
): void {
  const hasMaxMean = typeof opts.maxMeanRate === "number" && Number.isFinite(opts.maxMeanRate);
  const hasMinPass = typeof opts.minPassRate === "number" && Number.isFinite(opts.minPassRate);

  const maxMeanRate = hasMaxMean ? clampRate(opts.maxMeanRate as number) : null;
  const minPassRate = hasMinPass ? clampRate(opts.minPassRate as number) : null;

  if (maxMeanRate !== null && result.meanHallucinationRate > maxMeanRate) {
    throw new GroundingQualityError({
      message: `mean hallucination rate ${result.meanHallucinationRate} exceeds max ${maxMeanRate}`,
      meanHallucinationRate: result.meanHallucinationRate,
      passRate: result.passRate,
      maxMeanRate,
      minPassRate,
    });
  }

  if (minPassRate !== null && result.passRate < minPassRate) {
    throw new GroundingQualityError({
      message: `pass rate ${result.passRate} is below min ${minPassRate}`,
      meanHallucinationRate: result.meanHallucinationRate,
      passRate: result.passRate,
      maxMeanRate,
      minPassRate,
    });
  }
}
