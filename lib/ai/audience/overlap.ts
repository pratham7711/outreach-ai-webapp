import { z } from "zod";

export type WeightMap = Record<string, number>;

export type AudienceVector = {
  geo?: WeightMap;
  age?: WeightMap;
  interests?: WeightMap;
};

export type RosterCreator = {
  id: string;
  reach: number;
  audience: AudienceVector;
};

export type DedupOptions = {
  threshold?: number;
};

export type DropRecord = {
  id: string;
  overlapsWith: string;
  overlap: number;
};

export type DedupResult = {
  keep: string[];
  drop: DropRecord[];
};

export type PairwiseEntry = {
  a: string;
  b: string;
  overlap: number;
};

const DEFAULT_THRESHOLD = 0.85;

const FLOAT_EPSILON = 1e-12;

const DIMENSIONS = ["geo", "age", "interests"] as const;

type Dimension = (typeof DIMENSIONS)[number];

const weightMapSchema = z.record(z.string(), z.number());

const audienceVectorSchema = z.object({
  geo: weightMapSchema.optional(),
  age: weightMapSchema.optional(),
  interests: weightMapSchema.optional(),
});

const rosterCreatorSchema = z.object({
  id: z.string(),
  reach: z.number(),
  audience: audienceVectorSchema,
});

const rosterSchema = z.array(rosterCreatorSchema);

const dedupOptionsSchema = z
  .object({
    threshold: z.number().optional(),
  })
  .optional();

function isSafeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeWeight(value: number): number {
  if (!isSafeNumber(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return value;
}

function clamp01(value: number): number {
  if (!isSafeNumber(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function sanitizeWeightMap(map: WeightMap | undefined): WeightMap {
  const out: WeightMap = {};
  if (!map) {
    return out;
  }
  for (const key of Object.keys(map)) {
    const weight = sanitizeWeight(map[key]);
    if (weight > 0) {
      out[key] = weight;
    }
  }
  return out;
}

function hasAnyWeight(map: WeightMap): boolean {
  return Object.keys(map).length > 0;
}

function cosineOverDimension(a: WeightMap, b: WeightMap): number | null {
  const cleanA = sanitizeWeightMap(a);
  const cleanB = sanitizeWeightMap(b);

  const presentA = hasAnyWeight(cleanA);
  const presentB = hasAnyWeight(cleanB);

  if (!presentA || !presentB) {
    return null;
  }

  let dot = 0;
  let normASq = 0;
  let normBSq = 0;

  for (const key of Object.keys(cleanA)) {
    const va = cleanA[key];
    normASq += va * va;
    const vb = cleanB[key];
    if (vb !== undefined) {
      dot += va * vb;
    }
  }

  for (const key of Object.keys(cleanB)) {
    const vb = cleanB[key];
    normBSq += vb * vb;
  }

  const denom = Math.sqrt(normASq) * Math.sqrt(normBSq);

  if (denom <= FLOAT_EPSILON) {
    return 0;
  }

  return clamp01(dot / denom);
}

export function overlapScore(a: AudienceVector, b: AudienceVector): number {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const dimension of DIMENSIONS) {
    const dimA = (a?.[dimension as Dimension] ?? undefined) as
      | WeightMap
      | undefined;
    const dimB = (b?.[dimension as Dimension] ?? undefined) as
      | WeightMap
      | undefined;

    const score = cosineOverDimension(dimA ?? {}, dimB ?? {});

    if (score === null) {
      continue;
    }

    weightedSum += score;
    weightTotal += 1;
  }

  if (weightTotal <= 0) {
    return 0;
  }

  return clamp01(weightedSum / weightTotal);
}

export function pairwiseOverlap(creators: RosterCreator[]): PairwiseEntry[] {
  const parsed = rosterSchema.parse(creators);
  const entries: PairwiseEntry[] = [];

  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      entries.push({
        a: parsed[i].id,
        b: parsed[j].id,
        overlap: overlapScore(parsed[i].audience, parsed[j].audience),
      });
    }
  }

  return entries;
}

function resolveThreshold(opts: DedupOptions | undefined): number {
  const candidate = opts?.threshold;
  if (!isSafeNumber(candidate)) {
    return DEFAULT_THRESHOLD;
  }
  if (candidate < 0) {
    return 0;
  }
  if (candidate > 1) {
    return 1;
  }
  return candidate;
}

export function dedupRoster(
  creators: RosterCreator[],
  opts?: DedupOptions,
): DedupResult {
  const parsed = rosterSchema.parse(creators);
  const validatedOpts = dedupOptionsSchema.parse(opts);
  const threshold = resolveThreshold(validatedOpts);

  const ordered = [...parsed].sort((x, y) => {
    const reachX = isSafeNumber(x.reach) ? x.reach : 0;
    const reachY = isSafeNumber(y.reach) ? y.reach : 0;
    if (reachY !== reachX) {
      return reachY - reachX;
    }
    if (x.id < y.id) {
      return -1;
    }
    if (x.id > y.id) {
      return 1;
    }
    return 0;
  });

  const keep: string[] = [];
  const keptVectors: { id: string; audience: AudienceVector }[] = [];
  const drop: DropRecord[] = [];

  for (const creator of ordered) {
    let bestId: string | null = null;
    let bestOverlap = -1;

    for (const kept of keptVectors) {
      const score = overlapScore(creator.audience, kept.audience);
      if (score > bestOverlap) {
        bestOverlap = score;
        bestId = kept.id;
      }
    }

    if (bestId !== null && bestOverlap > threshold) {
      drop.push({
        id: creator.id,
        overlapsWith: bestId,
        overlap: bestOverlap,
      });
    } else {
      keep.push(creator.id);
      keptVectors.push({ id: creator.id, audience: creator.audience });
    }
  }

  return { keep, drop };
}
