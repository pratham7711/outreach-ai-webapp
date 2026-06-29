import {
  HashingEmbeddingProvider,
  embedBatch,
  getEmbeddingProvider,
} from "@/lib/ai/embeddings";
import type { EmbeddingProvider } from "@/lib/ai/embeddings/types";

function l2Norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((acc, value) => acc + value * value, 0));
}

describe("HashingEmbeddingProvider", () => {
  const provider = new HashingEmbeddingProvider();

  it("is deterministic: same text twice yields deep-equal vectors", async () => {
    const [a] = await provider.embed(["the quick brown fox jumps"]);
    const [b] = await provider.embed(["the quick brown fox jumps"]);
    expect(a).toEqual(b);
  });

  it("produces different vectors for different texts", async () => {
    const [a] = await provider.embed(["music label outreach"]);
    const [b] = await provider.embed(["talent agency discovery"]);
    expect(a).not.toEqual(b);
  });

  it("returns vectors of length equal to dimensions", async () => {
    const vectors = await provider.embed(["hello world", "another phrase here"]);
    for (const vector of vectors) {
      expect(vector).toHaveLength(provider.dimensions);
    }
  });

  it("L2-normalizes non-empty vectors to approx 1", async () => {
    const [vector] = await provider.embed(["creator campaign roi forecast"]);
    expect(l2Norm(vector)).toBeCloseTo(1, 6);
  });

  it("returns a zero vector for text with no tokens", async () => {
    const [vector] = await provider.embed(["   !!! --- "]);
    expect(vector).toHaveLength(provider.dimensions);
    expect(l2Norm(vector)).toBe(0);
  });
});

describe("embedBatch", () => {
  const provider = new HashingEmbeddingProvider();

  it("returns [] for empty input", async () => {
    const result = await embedBatch(provider, []);
    expect(result).toEqual([]);
  });

  it("processes 130 texts with batchSize 64 and preserves global order", async () => {
    const texts = Array.from({ length: 130 }, (_, i) => `creator number ${i} profile text`);
    const batched = await embedBatch(provider, texts, { batchSize: 64 });
    expect(batched).toHaveLength(130);

    const individual = await Promise.all(
      texts.map(async (text) => (await provider.embed([text]))[0]),
    );

    for (const index of [0, 63, 64, 65, 127, 128, 129]) {
      expect(batched[index]).toEqual(individual[index]);
    }
  });

  it("uses default batchSize of 64 when opts omitted", async () => {
    const texts = Array.from({ length: 70 }, (_, i) => `text ${i}`);
    const batched = await embedBatch(provider, texts);
    expect(batched).toHaveLength(70);
    const individual = await Promise.all(
      texts.map(async (text) => (await provider.embed([text]))[0]),
    );
    expect(batched[63]).toEqual(individual[63]);
    expect(batched[64]).toEqual(individual[64]);
  });

  it("throws when a provider returns a wrong-length vector", async () => {
    const badProvider: EmbeddingProvider = {
      id: "bad-provider",
      dimensions: 256,
      async embed(texts: string[]): Promise<number[][]> {
        return texts.map(() => new Array<number>(8).fill(0));
      },
    };
    await expect(embedBatch(badProvider, ["anything"])).rejects.toThrow();
  });

  it("throws when batchSize is below 1", async () => {
    await expect(embedBatch(provider, ["x"], { batchSize: 0 })).rejects.toThrow();
  });
});

describe("getEmbeddingProvider", () => {
  it("returns the default hashing-v1 provider when called with no id", () => {
    const provider = getEmbeddingProvider();
    expect(provider.id).toBe("hashing-v1");
    expect(provider.dimensions).toBe(256);
  });

  it("returns the same provider when the default id is passed explicitly", () => {
    expect(getEmbeddingProvider("hashing-v1").id).toBe("hashing-v1");
  });

  it("throws on an unknown provider id", () => {
    expect(() => getEmbeddingProvider("nope")).toThrow();
  });
});
