import { z } from "zod";

export interface CacheControl {
  type: "ephemeral";
}

export interface CachedTextBlock {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

export interface BuildCachedSystemBlocksInput {
  stable: string[];
  volatile?: string[];
  cacheStableTail?: boolean;
}

const stringArraySchema = z.array(z.string());

const buildCachedSystemBlocksInputSchema = z.object({
  stable: stringArraySchema,
  volatile: stringArraySchema.optional(),
  cacheStableTail: z.boolean().optional(),
});

function nonEmptyEntries(values: string[]): string[] {
  return values.filter((value) => value.trim().length > 0);
}

export function buildCachedSystemBlocks(
  input: BuildCachedSystemBlocksInput,
): CachedTextBlock[] {
  const parsed = buildCachedSystemBlocksInputSchema.parse(input);

  const stable = nonEmptyEntries(parsed.stable);
  const volatile = nonEmptyEntries(parsed.volatile ?? []);

  const cacheStableTail = parsed.cacheStableTail ?? true;
  const lastStableIndex = stable.length - 1;

  const stableBlocks: CachedTextBlock[] = stable.map((text, index) => {
    const block: CachedTextBlock = { type: "text", text };
    if (cacheStableTail && index === lastStableIndex && stable.length > 0) {
      block.cache_control = { type: "ephemeral" };
    }
    return block;
  });

  const volatileBlocks: CachedTextBlock[] = volatile.map((text) => ({
    type: "text",
    text,
  }));

  return [...stableBlocks, ...volatileBlocks];
}

export function countCacheBreakpoints(blocks: CachedTextBlock[]): number {
  return blocks.reduce(
    (count, block) => (block.cache_control ? count + 1 : count),
    0,
  );
}

export function orderForCache<T extends { stable?: boolean }>(
  parts: T[],
): T[] {
  return parts
    .map((part, index) => ({ part, index }))
    .sort((a, b) => {
      const aStable = a.part.stable === true ? 0 : 1;
      const bStable = b.part.stable === true ? 0 : 1;
      if (aStable !== bStable) {
        return aStable - bStable;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.part);
}
