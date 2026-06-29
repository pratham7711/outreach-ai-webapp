import type {
  AttributeValue,
  Candidate,
  Filter,
  FusionQuery,
  RankedResult,
} from "@/lib/ai/discovery/types";

const DEFAULT_DENSE_WEIGHT = 0.5;
const DEFAULT_SPARSE_WEIGHT = 0.5;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeScore(value: number | undefined): number {
  return isFiniteNumber(value) ? value : 0;
}

export function normalizeSparse(candidates: Candidate[]): Map<string, number> {
  const normalized = new Map<string, number>();
  if (candidates.length === 0) {
    return normalized;
  }

  let min = Infinity;
  let max = -Infinity;
  for (const candidate of candidates) {
    const value = safeScore(candidate.sparseScore);
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  const range = max - min;
  for (const candidate of candidates) {
    if (!isFiniteNumber(range) || range <= 0) {
      normalized.set(candidate.id, 0);
      continue;
    }
    const value = safeScore(candidate.sparseScore);
    normalized.set(candidate.id, (value - min) / range);
  }
  return normalized;
}

function asComparableNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function matchesFilter(attributes: Record<string, AttributeValue>, filter: Filter): boolean {
  if (!Object.prototype.hasOwnProperty.call(attributes, filter.field)) {
    return false;
  }
  const actual = attributes[filter.field];

  switch (filter.op) {
    case "eq":
      return actual === filter.value;
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(actual);
    case "gte": {
      const left = asComparableNumber(actual);
      const right = asComparableNumber(filter.value);
      if (left === undefined || right === undefined) {
        return false;
      }
      return left >= right;
    }
    case "lte": {
      const left = asComparableNumber(actual);
      const right = asComparableNumber(filter.value);
      if (left === undefined || right === undefined) {
        return false;
      }
      return left <= right;
    }
    case "contains": {
      if (Array.isArray(actual)) {
        return actual.includes(filter.value as string);
      }
      if (typeof actual === "string" && typeof filter.value === "string") {
        return actual.includes(filter.value);
      }
      return false;
    }
    default:
      return false;
  }
}

export function applyFilters(candidates: Candidate[], filters?: Filter[]): Candidate[] {
  if (!filters || filters.length === 0) {
    return candidates.slice();
  }
  return candidates.filter((candidate) => {
    const attributes = candidate.attributes ?? {};
    return filters.every((filter) => matchesFilter(attributes, filter));
  });
}

function filterLabel(filter: Filter): string {
  return `${filter.field} ${filter.op} ${String(filter.value)}`;
}

function resolveWeights(query: FusionQuery, hasDense: boolean, hasSparse: boolean): {
  wDense: number;
  wSparse: number;
} {
  const requestedDense = query.weights?.dense;
  const requestedSparse = query.weights?.sparse;
  let wDense = isFiniteNumber(requestedDense) ? requestedDense : DEFAULT_DENSE_WEIGHT;
  let wSparse = isFiniteNumber(requestedSparse) ? requestedSparse : DEFAULT_SPARSE_WEIGHT;

  if (hasDense && !hasSparse) {
    return { wDense: 1, wSparse: 0 };
  }
  if (hasSparse && !hasDense) {
    return { wDense: 0, wSparse: 1 };
  }

  const total = wDense + wSparse;
  if (!isFiniteNumber(total) || total <= 0) {
    return { wDense: DEFAULT_DENSE_WEIGHT, wSparse: DEFAULT_SPARSE_WEIGHT };
  }
  wDense = wDense / total;
  wSparse = wSparse / total;
  return { wDense, wSparse };
}

function buildExplanation(
  matchedFilters: string[],
  denseComponent: number,
  sparseComponent: number,
): string {
  const parts: string[] = [];
  if (matchedFilters.length > 0) {
    parts.push(`matched filters: ${matchedFilters.join(", ")}`);
  } else {
    parts.push("no filters applied");
  }
  parts.push(`dense=${denseComponent.toFixed(4)}`);
  parts.push(`sparse=${sparseComponent.toFixed(4)}`);
  return parts.join("; ");
}

export function fuse(candidates: Candidate[], query: FusionQuery = {}): RankedResult[] {
  const survivors = applyFilters(candidates, query.filters);
  if (survivors.length === 0) {
    return [];
  }

  const normSparse = normalizeSparse(survivors);
  const hasDense = survivors.some((candidate) => isFiniteNumber(candidate.denseScore));
  const hasSparse = survivors.some((candidate) => isFiniteNumber(candidate.sparseScore));
  const { wDense, wSparse } = resolveWeights(query, hasDense, hasSparse);

  const matchedFilters = (query.filters ?? []).map(filterLabel);

  const results: RankedResult[] = survivors.map((candidate) => {
    const denseComponent = safeScore(candidate.denseScore);
    const sparseComponent = normSparse.get(candidate.id) ?? 0;
    const score = wDense * denseComponent + wSparse * sparseComponent;
    return {
      id: candidate.id,
      score,
      components: {
        dense: denseComponent,
        sparse: sparseComponent,
      },
      matchedFilters: matchedFilters.slice(),
      explanation: buildExplanation(matchedFilters, denseComponent, sparseComponent),
    };
  });

  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.id < b.id) {
      return -1;
    }
    if (a.id > b.id) {
      return 1;
    }
    return 0;
  });

  return results;
}
