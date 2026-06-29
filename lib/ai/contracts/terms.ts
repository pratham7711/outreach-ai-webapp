import { z } from "zod";

export interface ContractDeliverable {
  kind: string;
  quantity: number;
}

export interface ContractSchedule {
  startEpochMs: number;
  endEpochMs: number;
}

export interface ContractTerms {
  deliverables: ContractDeliverable[];
  rateUsd: number;
  schedule: ContractSchedule;
  usageRights?: string;
  exclusivityDays?: number;
}

export type ContractIssueSeverity = "error" | "warning";

export interface ContractIssue {
  code: string;
  severity: ContractIssueSeverity;
  detail: string;
}

export interface ContractValidationResult {
  valid: boolean;
  issues: ContractIssue[];
}

const DEFAULT_KIND = "deliverable";
const MS_PER_DAY = 86_400_000;
const VERY_LONG_EXCLUSIVITY_DAYS = 365;

const deliverableInputSchema = z.object({
  kind: z.unknown(),
  quantity: z.unknown(),
});

const scheduleInputSchema = z
  .object({
    startEpochMs: z.unknown(),
    endEpochMs: z.unknown(),
  })
  .nullable()
  .catch(null)
  .optional();

const contractTermsInputSchema = z.object({
  deliverables: z.array(z.unknown()).catch([]).optional(),
  rateUsd: z.unknown(),
  schedule: scheduleInputSchema,
  usageRights: z.unknown().optional(),
  exclusivityDays: z.unknown().optional(),
});

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toFiniteOrZero(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function clampNonNegative(value: unknown): number {
  const n = toFiniteOrZero(value);
  return n < 0 ? 0 : n;
}

function toCleanString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeDeliverable(raw: unknown): ContractDeliverable {
  const parsed = deliverableInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: DEFAULT_KIND, quantity: 0 };
  }
  const kindStr = toCleanString(parsed.data.kind).trim();
  return {
    kind: kindStr.length > 0 ? kindStr : DEFAULT_KIND,
    quantity: clampNonNegative(parsed.data.quantity),
  };
}

export function buildContractTerms(input: unknown): ContractTerms {
  const parsed = contractTermsInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      deliverables: [],
      rateUsd: 0,
      schedule: { startEpochMs: 0, endEpochMs: 0 },
    };
  }

  const rawDeliverables = Array.isArray(parsed.data.deliverables)
    ? parsed.data.deliverables
    : [];
  const deliverables = rawDeliverables.map(normalizeDeliverable);

  const rawSchedule = parsed.data.schedule ?? null;
  const schedule: ContractSchedule = {
    startEpochMs: toFiniteOrZero(rawSchedule?.startEpochMs),
    endEpochMs: toFiniteOrZero(rawSchedule?.endEpochMs),
  };

  const terms: ContractTerms = {
    deliverables,
    rateUsd: toFiniteOrZero(parsed.data.rateUsd),
    schedule,
  };

  const usageRights = toCleanString(parsed.data.usageRights).trim();
  if (usageRights.length > 0) {
    terms.usageRights = usageRights;
  }

  if (parsed.data.exclusivityDays !== undefined) {
    terms.exclusivityDays = toFiniteOrZero(parsed.data.exclusivityDays);
  }

  return terms;
}

export function validateContractTerms(
  terms: ContractTerms,
): ContractValidationResult {
  const issues: ContractIssue[] = [];

  const deliverables = Array.isArray(terms?.deliverables)
    ? terms.deliverables
    : [];
  const hasPositiveDeliverable = deliverables.some(
    (d) => isFiniteNumber(d?.quantity) && d.quantity > 0,
  );

  if (deliverables.length === 0 || !hasPositiveDeliverable) {
    issues.push({
      code: "NO_DELIVERABLES",
      severity: "error",
      detail:
        "Contract terms must list at least one deliverable with a positive quantity.",
    });
  }

  const rateUsd = terms?.rateUsd;
  if (!isFiniteNumber(rateUsd) || rateUsd <= 0) {
    issues.push({
      code: "INVALID_RATE",
      severity: "error",
      detail: "rateUsd must be a finite number greater than zero.",
    });
  }

  const start = terms?.schedule?.startEpochMs;
  const end = terms?.schedule?.endEpochMs;
  if (
    !isFiniteNumber(start) ||
    !isFiniteNumber(end) ||
    end <= start
  ) {
    issues.push({
      code: "INVALID_SCHEDULE",
      severity: "error",
      detail:
        "schedule.endEpochMs must be a finite value strictly after a finite schedule.startEpochMs.",
    });
  }

  const exclusivityDays = terms?.exclusivityDays;
  if (exclusivityDays !== undefined) {
    if (!isFiniteNumber(exclusivityDays) || exclusivityDays < 0) {
      issues.push({
        code: "NEGATIVE_EXCLUSIVITY",
        severity: "error",
        detail: "exclusivityDays must be a finite non-negative number when present.",
      });
    } else if (exclusivityDays > VERY_LONG_EXCLUSIVITY_DAYS) {
      issues.push({
        code: "VERY_LONG_EXCLUSIVITY",
        severity: "warning",
        detail: `exclusivityDays of ${exclusivityDays} exceeds the ${VERY_LONG_EXCLUSIVITY_DAYS}-day review threshold.`,
      });
    }
  }

  const usageRights = terms?.usageRights;
  if (typeof usageRights !== "string" || usageRights.trim().length === 0) {
    issues.push({
      code: "MISSING_USAGE_RIGHTS",
      severity: "warning",
      detail:
        "usageRights is not specified; define content usage scope before approval.",
    });
  }

  const hasError = issues.some((issue) => issue.severity === "error");

  return {
    valid: !hasError,
    issues,
  };
}

function scheduleWindowDays(schedule: ContractSchedule): number {
  const start = schedule?.startEpochMs;
  const end = schedule?.endEpochMs;
  if (!isFiniteNumber(start) || !isFiniteNumber(end)) {
    return 0;
  }
  const spanMs = end - start;
  if (!Number.isFinite(spanMs) || spanMs <= 0) {
    return 0;
  }
  return Math.round(spanMs / MS_PER_DAY);
}

export function summarizeContractTerms(terms: ContractTerms): string {
  const deliverables = Array.isArray(terms?.deliverables)
    ? terms.deliverables
    : [];

  const deliverablePhrase =
    deliverables.length === 0
      ? "no deliverables"
      : deliverables
          .map((d) => {
            const qty = clampNonNegative(d?.quantity);
            const kind = toCleanString(d?.kind).trim() || DEFAULT_KIND;
            return `${qty} x ${kind}`;
          })
          .join(", ");

  const rate = toFiniteOrZero(terms?.rateUsd);
  const days = scheduleWindowDays(terms?.schedule);

  const rawExclusivity = terms?.exclusivityDays;
  const exclusivityPhrase =
    rawExclusivity === undefined
      ? "no exclusivity"
      : `${clampNonNegative(rawExclusivity)}-day exclusivity`;

  const usagePhrase =
    typeof terms?.usageRights === "string" && terms.usageRights.trim().length > 0
      ? terms.usageRights.trim()
      : "unspecified usage rights";

  return `Draft contract terms (not signed or sent): ${deliverablePhrase} at $${rate} USD over a ${days}-day window, ${exclusivityPhrase}, ${usagePhrase}.`;
}

export const __schemas = {
  contractTermsInputSchema,
  deliverableInputSchema,
  scheduleInputSchema,
};
