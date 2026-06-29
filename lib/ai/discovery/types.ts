export type AttributeValue = string | number | boolean | string[];

export interface Candidate {
  id: string;
  denseScore?: number;
  sparseScore?: number;
  attributes?: Record<string, AttributeValue>;
}

export type FilterOp = "eq" | "in" | "gte" | "lte" | "contains";

export interface Filter {
  field: string;
  op: FilterOp;
  value: unknown;
}

export interface FusionWeights {
  dense?: number;
  sparse?: number;
}

export interface FusionQuery {
  filters?: Filter[];
  weights?: FusionWeights;
}

export interface RankedResult {
  id: string;
  score: number;
  components: {
    dense: number;
    sparse: number;
  };
  matchedFilters: string[];
  explanation: string;
}
