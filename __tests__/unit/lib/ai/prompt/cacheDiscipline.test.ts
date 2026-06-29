import {
  buildCachedSystemBlocks,
  countCacheBreakpoints,
  orderForCache,
  type CachedTextBlock,
} from "@/lib/ai/prompt/cacheDiscipline";

describe("buildCachedSystemBlocks", () => {
  it("places all stable blocks before volatile blocks in order", () => {
    const blocks = buildCachedSystemBlocks({
      stable: ["s1", "s2"],
      volatile: ["v1", "v2"],
    });
    expect(blocks.map((b) => b.text)).toEqual(["s1", "s2", "v1", "v2"]);
  });

  it("puts cache_control on the last stable block only", () => {
    const blocks = buildCachedSystemBlocks({
      stable: ["s1", "s2", "s3"],
      volatile: ["v1"],
    });
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toBeUndefined();
    expect(blocks[2].cache_control).toEqual({ type: "ephemeral" });
  });

  it("emits exactly one cache_control breakpoint", () => {
    const blocks = buildCachedSystemBlocks({
      stable: ["s1", "s2", "s3", "s4"],
      volatile: ["v1", "v2"],
    });
    expect(countCacheBreakpoints(blocks)).toBe(1);
    const withControl = blocks.filter((b) => b.cache_control !== undefined);
    expect(withControl).toHaveLength(1);
  });

  it("never puts cache_control on volatile blocks", () => {
    const blocks = buildCachedSystemBlocks({
      stable: ["s1"],
      volatile: ["v1", "v2", "v3"],
    });
    const volatileBlocks = blocks.slice(1);
    for (const block of volatileBlocks) {
      expect(block.cache_control).toBeUndefined();
    }
  });

  it("drops empty and whitespace-only entries", () => {
    const blocks = buildCachedSystemBlocks({
      stable: ["s1", "", "   ", "\t\n", "s2"],
      volatile: ["", "v1", "  "],
    });
    expect(blocks.map((b) => b.text)).toEqual(["s1", "s2", "v1"]);
    expect(countCacheBreakpoints(blocks)).toBe(1);
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("emits no cache_control when there are no stable blocks", () => {
    const blocks = buildCachedSystemBlocks({
      stable: [],
      volatile: ["v1", "v2"],
    });
    expect(blocks.map((b) => b.text)).toEqual(["v1", "v2"]);
    expect(countCacheBreakpoints(blocks)).toBe(0);
  });

  it("emits no cache_control when all stable entries are whitespace", () => {
    const blocks = buildCachedSystemBlocks({
      stable: ["  ", "\n"],
      volatile: ["v1"],
    });
    expect(blocks.map((b) => b.text)).toEqual(["v1"]);
    expect(countCacheBreakpoints(blocks)).toBe(0);
  });

  it("suppresses the breakpoint when cacheStableTail is false", () => {
    const blocks = buildCachedSystemBlocks({
      stable: ["s1", "s2"],
      volatile: ["v1"],
      cacheStableTail: false,
    });
    expect(countCacheBreakpoints(blocks)).toBe(0);
  });

  it("handles missing volatile array", () => {
    const blocks = buildCachedSystemBlocks({ stable: ["s1", "s2"] });
    expect(blocks.map((b) => b.text)).toEqual(["s1", "s2"]);
    expect(countCacheBreakpoints(blocks)).toBe(1);
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("every block is typed as text", () => {
    const blocks = buildCachedSystemBlocks({
      stable: ["s1"],
      volatile: ["v1"],
    });
    for (const block of blocks) {
      expect(block.type).toBe("text");
    }
  });

  it("is deterministic: same input yields deep-equal output", () => {
    const input = {
      stable: ["a", "b", "c"],
      volatile: ["x", "y"],
    };
    const first = buildCachedSystemBlocks(input);
    const second = buildCachedSystemBlocks(input);
    expect(first).toEqual(second);
  });

  it("rejects non-string stable entries via zod", () => {
    expect(() =>
      buildCachedSystemBlocks({
        stable: [42 as unknown as string],
      }),
    ).toThrow();
  });
});

describe("orderForCache", () => {
  it("moves stable=true parts before non-stable parts", () => {
    const parts = [
      { stable: false, id: "a" },
      { stable: true, id: "b" },
      { id: "c" },
      { stable: true, id: "d" },
    ];
    expect(orderForCache(parts).map((p) => p.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("preserves intra-group order for same-flag pairs (index tiebreak)", () => {
    const parts = [
      { stable: true, id: "s-first" },
      { stable: true, id: "s-second" },
      { stable: false, id: "v-first" },
      { stable: false, id: "v-second" },
    ];
    expect(orderForCache(parts).map((p) => p.id)).toEqual([
      "s-first",
      "s-second",
      "v-first",
      "v-second",
    ]);
  });

  it("treats undefined stable as not-stable", () => {
    const parts = [{ id: "a" }, { stable: true, id: "b" }, { id: "c" }];
    expect(orderForCache(parts).map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("returns an empty array unchanged", () => {
    expect(orderForCache([])).toEqual([]);
  });

  it("is deterministic for a large stable/volatile interleave", () => {
    const parts = Array.from({ length: 20 }, (_, i) => ({
      stable: i % 2 === 0,
      id: i,
    }));
    const ordered = orderForCache(parts);
    const stableIds = ordered.filter((p) => p.stable).map((p) => p.id);
    const volatileIds = ordered.filter((p) => !p.stable).map((p) => p.id);
    expect(stableIds).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(volatileIds).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]);
    expect(orderForCache(parts)).toEqual(ordered);
  });
});

describe("countCacheBreakpoints", () => {
  it("counts only blocks carrying cache_control", () => {
    const blocks: CachedTextBlock[] = [
      { type: "text", text: "a", cache_control: { type: "ephemeral" } },
      { type: "text", text: "b" },
    ];
    expect(countCacheBreakpoints(blocks)).toBe(1);
  });
});
