import { z } from "zod";

export type Severity = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high";

export interface BrandSafetySignals {
  categories?: string[];
  flaggedTermHits?: Record<string, number>;
  priorIncidents?: number;
  controversyScore?: number;
  restrictedCategories?: string[];
}

export interface BrandSafetyOptions {
  strictCategories?: string[];
}

export interface BrandSafetyFlag {
  code: string;
  severity: Severity;
  detail: string;
}

export interface BrandSafetyAssessment {
  safe: boolean;
  riskLevel: RiskLevel;
  score: number;
  flags: BrandSafetyFlag[];
}

export const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const FLAG_CODES = {
  RESTRICTED_CATEGORY: "RESTRICTED_CATEGORY",
  PRIOR_INCIDENTS: "PRIOR_INCIDENTS",
  HIGH_CONTROVERSY: "HIGH_CONTROVERSY",
  FLAGGED_TERMS: "FLAGGED_TERMS",
} as const;

const CONTROVERSY_FLAG_THRESHOLD = 0.5;
const CONTROVERSY_HIGH_THRESHOLD = 0.8;

const FLAGGED_TERMS_MEDIUM_THRESHOLD = 3;
const FLAGGED_TERMS_HIGH_THRESHOLD = 8;

const PRIOR_INCIDENTS_MEDIUM_THRESHOLD = 1;
const PRIOR_INCIDENTS_HIGH_THRESHOLD = 3;

const PENALTY_RESTRICTED_CATEGORY = 100;
const PENALTY_PRIOR_INCIDENT = 12;
const PENALTY_PRIOR_INCIDENT_CAP = 60;
const PENALTY_CONTROVERSY_MAX = 50;
const PENALTY_FLAGGED_TERM = 4;
const PENALTY_FLAGGED_TERM_CAP = 50;

const numericLike = z
  .custom<number>((value) => typeof value === "number")
  .transform((value) => (Number.isFinite(value as number) ? (value as number) : 0));

const signalsSchema = z
  .object({
    categories: z.array(z.string()).optional(),
    flaggedTermHits: z.record(z.string(), numericLike).optional(),
    priorIncidents: numericLike.optional(),
    controversyScore: numericLike.optional(),
    restrictedCategories: z.array(z.string()).optional(),
  })
  .optional();

const optionsSchema = z
  .object({
    strictCategories: z.array(z.string()).optional(),
  })
  .optional();

function toFiniteNonNegative(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return value;
}

function clamp01(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
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

function totalFlaggedHits(hits: Record<string, number> | undefined): number {
  if (!hits) {
    return 0;
  }
  let total = 0;
  for (const key of Object.keys(hits)) {
    const value = hits[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      total += value;
    }
  }
  return total;
}

function worstSeverity(flags: BrandSafetyFlag[]): Severity | null {
  let worst: Severity | null = null;
  for (const flag of flags) {
    if (worst === null || SEVERITY_RANK[flag.severity] > SEVERITY_RANK[worst]) {
      worst = flag.severity;
    }
  }
  return worst;
}

export function hasHighSeverityFlag(flags: BrandSafetyFlag[]): boolean {
  for (const flag of flags) {
    if (flag.severity === "high") {
      return true;
    }
  }
  return false;
}

export function assessBrandSafety(
  signals: BrandSafetySignals,
  opts?: BrandSafetyOptions,
): BrandSafetyAssessment {
  const parsedSignals = signalsSchema.safeParse(signals);
  const parsedOpts = optionsSchema.safeParse(opts);

  if (!parsedSignals.success || !parsedOpts.success) {
    return {
      safe: false,
      riskLevel: "high",
      score: 0,
      flags: [
        {
          code: "INVALID_SIGNALS",
          severity: "high",
          detail: "Brand-safety signals failed validation; denying by fail-closed default",
        },
      ],
    };
  }

  const safeSignals = parsedSignals.data ?? {};
  const safeOpts = parsedOpts.data ?? {};

  const flags: BrandSafetyFlag[] = [];
  let penalty = 0;

  const restrictedSet = toKeySet(safeSignals.restrictedCategories);
  const strictSet = toKeySet(safeOpts.strictCategories);
  const categorySet = toKeySet(safeSignals.categories);

  const restrictedMatches: string[] = [];
  for (const category of restrictedSet) {
    restrictedMatches.push(category);
  }
  for (const category of categorySet) {
    if (strictSet.has(category) && !restrictedSet.has(category)) {
      restrictedMatches.push(category);
    }
  }
  restrictedMatches.sort();

  if (restrictedMatches.length > 0) {
    penalty += PENALTY_RESTRICTED_CATEGORY;
    flags.push({
      code: FLAG_CODES.RESTRICTED_CATEGORY,
      severity: "high",
      detail: `Restricted/strict-blocked categories present: ${restrictedMatches.join(", ")}`,
    });
  }

  const priorIncidents = Math.floor(toFiniteNonNegative(safeSignals.priorIncidents));
  if (priorIncidents > 0) {
    penalty += Math.min(
      priorIncidents * PENALTY_PRIOR_INCIDENT,
      PENALTY_PRIOR_INCIDENT_CAP,
    );
    let severity: Severity = "low";
    if (priorIncidents >= PRIOR_INCIDENTS_HIGH_THRESHOLD) {
      severity = "high";
    } else if (priorIncidents >= PRIOR_INCIDENTS_MEDIUM_THRESHOLD + 1) {
      severity = "medium";
    } else {
      severity = "low";
    }
    flags.push({
      code: FLAG_CODES.PRIOR_INCIDENTS,
      severity,
      detail: `${priorIncidents} prior incident(s) on record`,
    });
  }

  const controversy = clamp01(safeSignals.controversyScore);
  if (controversy > CONTROVERSY_FLAG_THRESHOLD) {
    penalty += PENALTY_CONTROVERSY_MAX * controversy;
    const severity: Severity = controversy >= CONTROVERSY_HIGH_THRESHOLD ? "high" : "medium";
    flags.push({
      code: FLAG_CODES.HIGH_CONTROVERSY,
      severity,
      detail: `Controversy score ${Math.round(controversy * 100) / 100} exceeds threshold ${CONTROVERSY_FLAG_THRESHOLD}`,
    });
  }

  const flaggedHits = Math.floor(totalFlaggedHits(safeSignals.flaggedTermHits));
  if (flaggedHits > 0) {
    penalty += Math.min(flaggedHits * PENALTY_FLAGGED_TERM, PENALTY_FLAGGED_TERM_CAP);
    let severity: Severity = "low";
    if (flaggedHits >= FLAGGED_TERMS_HIGH_THRESHOLD) {
      severity = "high";
    } else if (flaggedHits >= FLAGGED_TERMS_MEDIUM_THRESHOLD) {
      severity = "medium";
    } else {
      severity = "low";
    }
    flags.push({
      code: FLAG_CODES.FLAGGED_TERMS,
      severity,
      detail: `${flaggedHits} flagged-term hit(s) detected`,
    });
  }

  const score = clampScore(100 - penalty);

  const worst = worstSeverity(flags);
  const high = hasHighSeverityFlag(flags);

  let riskLevel: RiskLevel;
  if (worst === null) {
    riskLevel = "low";
  } else {
    riskLevel = worst;
  }

  const safe = !high;

  return {
    safe,
    riskLevel,
    score: Math.round(score),
    flags,
  };
}
