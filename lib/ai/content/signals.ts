export interface RawContentAnalysis {
  transcriptTermHits?: Record<string, number>;
  frameLabels?: string[];
  entities?: string[];
  controversyEstimate?: number;
  categories?: string[];
  priorIncidents?: number;
}

export interface NormalizedBrandSafetySignals {
  categories: string[];
  flaggedTermHits: Record<string, number>;
  priorIncidents: number;
  controversyScore: number;
  restrictedCategories: string[];
}

export interface NormalizedContentSignals {
  brandSafety: NormalizedBrandSafetySignals;
  nicheLabels: string[];
  entities: string[];
}

export interface NormalizeContentSignalsOptions {
  restrictedCategories?: string[];
}

export const RESTRICTED_CATEGORIES: readonly string[] = [
  "adult",
  "alcohol",
  "drugs",
  "firearms",
  "gambling",
  "hate",
  "politics",
  "tobacco",
  "violence",
  "weapons",
];

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function clamp01(value: number | null | undefined): number {
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

function toNonNegativeInt(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const key = value.trim().toLowerCase();
  return key.length > 0 ? key : null;
}

function dedupeNormalized(values: unknown[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (!values) {
    return out;
  }
  for (const raw of values) {
    const key = normalizeKey(raw);
    if (key !== null && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  out.sort();
  return out;
}

function normalizeTermHits(
  hits: Record<string, unknown> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!hits) {
    return out;
  }
  for (const rawKey of Object.keys(hits)) {
    const key = normalizeKey(rawKey);
    if (key === null) {
      continue;
    }
    const value = (hits as Record<string, unknown>)[rawKey];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      continue;
    }
    const count = Math.floor(value);
    if (count <= 0) {
      continue;
    }
    out[key] = (out[key] ?? 0) + count;
  }
  return out;
}

function buildRestrictedSet(
  override: unknown[] | undefined,
): Set<string> {
  const source =
    override === undefined
      ? (RESTRICTED_CATEGORIES as readonly string[])
      : override;
  const set = new Set<string>();
  for (const raw of source) {
    const key = normalizeKey(raw);
    if (key !== null) {
      set.add(key);
    }
  }
  return set;
}

const EMPTY_SIGNALS: NormalizedContentSignals = {
  brandSafety: {
    categories: [],
    flaggedTermHits: {},
    priorIncidents: 0,
    controversyScore: 0,
    restrictedCategories: [],
  },
  nicheLabels: [],
  entities: [],
};

export function normalizeContentSignals(
  raw: RawContentAnalysis,
  opts?: NormalizeContentSignalsOptions,
): NormalizedContentSignals {
  const safeRaw = asRecord(raw) ?? {};
  const safeOpts = asRecord(opts) ?? {};

  const categories = dedupeNormalized(asArray(safeRaw.categories));
  const nicheLabels = dedupeNormalized(asArray(safeRaw.frameLabels));
  const entities = dedupeNormalized(asArray(safeRaw.entities));

  const flaggedTermHits = normalizeTermHits(asRecord(safeRaw.transcriptTermHits));
  const priorIncidents = toNonNegativeInt(safeRaw.priorIncidents as number | null | undefined);
  const controversyScore = clamp01(safeRaw.controversyEstimate as number | null | undefined);

  const restrictedSet = buildRestrictedSet(asArray(safeOpts.restrictedCategories));
  const restrictedCategories: string[] = [];
  for (const category of categories) {
    if (restrictedSet.has(category)) {
      restrictedCategories.push(category);
    }
  }
  restrictedCategories.sort();

  return {
    brandSafety: {
      categories,
      flaggedTermHits,
      priorIncidents,
      controversyScore,
      restrictedCategories,
    },
    nicheLabels,
    entities,
  };
}

export { EMPTY_SIGNALS };
