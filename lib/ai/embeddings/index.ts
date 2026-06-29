import type {
  EmbeddingProvider,
  EmbedBatchOptions,
  EmbeddingRegistryEntry,
} from "@/lib/ai/embeddings/types";

const DEFAULT_BATCH_SIZE = 64;
const DEFAULT_PROVIDER_ID = "hashing-v1";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function l2Normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) {
    sumSquares += value * value;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
}

export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly id = DEFAULT_PROVIDER_ID;
  readonly dimensions = 256;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);
    for (const token of tokens) {
      const bucket = hashToken(token) % this.dimensions;
      vector[bucket] += 1;
    }
    return l2Normalize(vector);
  }
}

export async function embedBatch(
  provider: EmbeddingProvider,
  texts: string[],
  opts?: EmbedBatchOptions,
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;
  if (batchSize < 1) {
    throw new Error(`embedBatch batchSize must be >= 1, received ${batchSize}`);
  }
  const result: number[][] = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    const chunk = texts.slice(start, start + batchSize);
    const vectors = await provider.embed(chunk);
    for (const vector of vectors) {
      if (vector.length !== provider.dimensions) {
        throw new Error(
          `embedBatch: provider '${provider.id}' returned vector of length ${vector.length}, expected ${provider.dimensions}`,
        );
      }
      result.push(vector);
    }
  }
  return result;
}

const REGISTRY = new Map<string, EmbeddingRegistryEntry>();

function registerProvider(provider: EmbeddingProvider): void {
  REGISTRY.set(provider.id, {
    id: provider.id,
    dimensions: provider.dimensions,
    provider,
  });
}

registerProvider(new HashingEmbeddingProvider());

export function getEmbeddingProvider(id: string = DEFAULT_PROVIDER_ID): EmbeddingProvider {
  const entry = REGISTRY.get(id);
  if (!entry) {
    throw new Error(`Unknown embedding provider id: ${id}`);
  }
  return entry.provider;
}
