import { normalizeSparse, applyFilters, fuse } from "@/lib/ai/discovery/fusion";
import type { Candidate, FusionQuery } from "@/lib/ai/discovery/types";

describe("normalizeSparse", () => {
  it("maps min sparse to 0 and max sparse to 1", () => {
    const candidates: Candidate[] = [
      { id: "a", sparseScore: 10 },
      { id: "b", sparseScore: 50 },
      { id: "c", sparseScore: 30 },
    ];
    const norm = normalizeSparse(candidates);
    expect(norm.get("a")).toBe(0);
    expect(norm.get("b")).toBe(1);
    expect(norm.get("c")).toBeCloseTo(0.5, 10);
  });

  it("returns 0 for all-equal sparse with no NaN", () => {
    const candidates: Candidate[] = [
      { id: "a", sparseScore: 7 },
      { id: "b", sparseScore: 7 },
    ];
    const norm = normalizeSparse(candidates);
    expect(norm.get("a")).toBe(0);
    expect(norm.get("b")).toBe(0);
    expect(Number.isNaN(norm.get("a"))).toBe(false);
    expect(Number.isNaN(norm.get("b"))).toBe(false);
  });

  it("returns empty map for empty input", () => {
    expect(normalizeSparse([]).size).toBe(0);
  });
});

describe("applyFilters", () => {
  const base: Candidate[] = [
    { id: "a", attributes: { country: "US", followers: 1000, tags: ["beauty", "skincare"] } },
    { id: "b", attributes: { country: "IN", followers: 50, tags: ["fitness"] } },
    { id: "c", attributes: { country: "US", followers: 9000, bio: "luxury travel blogger" } },
  ];

  it("eq filter keeps only exact matches", () => {
    const kept = applyFilters(base, [{ field: "country", op: "eq", value: "US" }]);
    expect(kept.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("in filter keeps members of the value set", () => {
    const kept = applyFilters(base, [{ field: "country", op: "in", value: ["IN", "GB"] }]);
    expect(kept.map((c) => c.id)).toEqual(["b"]);
  });

  it("gte filter compares numerically", () => {
    const kept = applyFilters(base, [{ field: "followers", op: "gte", value: 1000 }]);
    expect(kept.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("contains filter works on arrays and strings", () => {
    const arrKept = applyFilters(base, [{ field: "tags", op: "contains", value: "skincare" }]);
    expect(arrKept.map((c) => c.id)).toEqual(["a"]);
    const strKept = applyFilters(base, [{ field: "bio", op: "contains", value: "travel" }]);
    expect(strKept.map((c) => c.id)).toEqual(["c"]);
  });

  it("excludes a candidate missing the filtered attribute", () => {
    const kept = applyFilters(base, [{ field: "country", op: "eq", value: "US" }]);
    const missing: Candidate = { id: "z", attributes: { followers: 100 } };
    const keptMissing = applyFilters([...base, missing], [
      { field: "country", op: "eq", value: "US" },
    ]);
    expect(kept.map((c) => c.id)).toEqual(["a", "c"]);
    expect(keptMissing.map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("fuse", () => {
  it("ranks by dense score when only dense signal is present", () => {
    const candidates: Candidate[] = [
      { id: "low", denseScore: 0.2 },
      { id: "high", denseScore: 0.9 },
      { id: "mid", denseScore: 0.5 },
    ];
    const results = fuse(candidates, {});
    expect(results.map((r) => r.id)).toEqual(["high", "mid", "low"]);
    expect(results[0].score).toBeCloseTo(0.9, 10);
    expect(results[0].components.dense).toBeCloseTo(0.9, 10);
  });

  it("ranks higher combined signal first under default weights", () => {
    const candidates: Candidate[] = [
      { id: "a", denseScore: 0.9, sparseScore: 10 },
      { id: "b", denseScore: 0.3, sparseScore: 100 },
      { id: "c", denseScore: 0.2, sparseScore: 0 },
    ];
    const results = fuse(candidates, {});
    expect(results[0].id).toBe("b");
    expect(results[results.length - 1].id).toBe("c");
  });

  it("excludes a high-dense candidate that fails a filter", () => {
    const candidates: Candidate[] = [
      { id: "star", denseScore: 0.99, attributes: { country: "FR" } },
      { id: "ok", denseScore: 0.4, attributes: { country: "US" } },
    ];
    const query: FusionQuery = { filters: [{ field: "country", op: "eq", value: "US" }] };
    const results = fuse(candidates, query);
    expect(results.map((r) => r.id)).toEqual(["ok"]);
    expect(results.some((r) => r.id === "star")).toBe(false);
  });

  it("changes order when weights are overridden toward sparse", () => {
    const candidates: Candidate[] = [
      { id: "denseWinner", denseScore: 0.9, sparseScore: 0 },
      { id: "sparseWinner", denseScore: 0.1, sparseScore: 100 },
    ];
    const denseBiased = fuse(candidates, { weights: { dense: 0.9, sparse: 0.1 } });
    const sparseBiased = fuse(candidates, { weights: { dense: 0.1, sparse: 0.9 } });
    expect(denseBiased[0].id).toBe("denseWinner");
    expect(sparseBiased[0].id).toBe("sparseWinner");
  });

  it("returns empty array for empty candidates", () => {
    expect(fuse([], {})).toEqual([]);
  });

  it("produces a deterministic stable order with id tie-break", () => {
    const candidates: Candidate[] = [
      { id: "c", denseScore: 0.5, sparseScore: 5 },
      { id: "a", denseScore: 0.5, sparseScore: 5 },
      { id: "b", denseScore: 0.5, sparseScore: 5 },
    ];
    const first = fuse(candidates, {});
    const second = fuse(candidates, {});
    expect(first.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });

  it("explanation references matched filters and both components", () => {
    const candidates: Candidate[] = [
      { id: "a", denseScore: 0.8, sparseScore: 10, attributes: { country: "US" } },
    ];
    const query: FusionQuery = { filters: [{ field: "country", op: "eq", value: "US" }] };
    const results = fuse(candidates, query);
    expect(results[0].matchedFilters).toEqual(["country eq US"]);
    expect(results[0].explanation).toContain("country eq US");
    expect(results[0].explanation).toContain("dense=");
    expect(results[0].explanation).toContain("sparse=");
  });
});
