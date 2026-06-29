export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbedBatchOptions {
  batchSize?: number;
}

export interface EmbeddingRegistryEntry {
  id: string;
  dimensions: number;
  provider: EmbeddingProvider;
}
