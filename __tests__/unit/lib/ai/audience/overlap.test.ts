import {
  overlapScore,
  dedupRoster,
  pairwiseOverlap,
  type AudienceVector,
  type RosterCreator,
} from "@/lib/ai/audience/overlap";

const usHeavy: AudienceVector = {
  geo: { US: 0.7, GB: 0.2, CA: 0.1 },
  age: { "18-24": 0.5, "25-34": 0.5 },
  interests: { music: 0.6, fashion: 0.4 },
};

const usHeavyClone: AudienceVector = {
  geo: { US: 0.7, GB: 0.2, CA: 0.1 },
  age: { "18-24": 0.5, "25-34": 0.5 },
  interests: { music: 0.6, fashion: 0.4 },
};

const disjoint: AudienceVector = {
  geo: { IN: 0.6, BD: 0.4 },
  age: { "45-54": 1 },
  interests: { gardening: 1 },
};

describe("overlapScore", () => {
  it("is symmetric", () => {
    const ab = overlapScore(usHeavy, disjoint);
    const ba = overlapScore(disjoint, usHeavy);
    expect(ab).toBeCloseTo(ba, 12);
  });

  it("self-overlap of a non-empty vector is 1", () => {
    expect(overlapScore(usHeavy, usHeavyClone)).toBeCloseTo(1, 10);
  });

  it("disjoint vectors (no shared keys) score 0", () => {
    expect(overlapScore(usHeavy, disjoint)).toBeCloseTo(0, 12);
  });

  it("partial overlap lies strictly between 0 and 1", () => {
    const partial: AudienceVector = {
      geo: { US: 0.5, IN: 0.5 },
      age: { "18-24": 0.5, "45-54": 0.5 },
      interests: { music: 0.5, gardening: 0.5 },
    };
    const score = overlapScore(usHeavy, partial);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("more shared mass yields a higher score (monotone)", () => {
    const base: AudienceVector = { geo: { US: 1 } };
    const small: AudienceVector = { geo: { US: 0.2, IN: 0.8 } };
    const large: AudienceVector = { geo: { US: 0.8, IN: 0.2 } };
    const lowOverlap = overlapScore(base, small);
    const highOverlap = overlapScore(base, large);
    expect(highOverlap).toBeGreaterThan(lowOverlap);
  });

  it("only blends dimensions present in both vectors", () => {
    const geoOnlyA: AudienceVector = { geo: { US: 1 } };
    const geoOnlyB: AudienceVector = { geo: { US: 1 }, age: { "18-24": 1 } };
    expect(overlapScore(geoOnlyA, geoOnlyB)).toBeCloseTo(1, 10);
  });

  it("guards empty and degenerate vectors without throwing or NaN", () => {
    expect(overlapScore({}, {})).toBe(0);
    expect(overlapScore({ geo: {} }, { geo: { US: 1 } })).toBe(0);
    expect(
      overlapScore(
        { geo: { US: Number.NaN, GB: Number.POSITIVE_INFINITY } },
        { geo: { US: 1 } },
      ),
    ).toBe(0);
    expect(overlapScore({ geo: { US: -5 } }, { geo: { US: 1 } })).toBe(0);
  });
});

describe("dedupRoster", () => {
  it("keeps the highest-reach creator of a near-duplicate pair", () => {
    const roster: RosterCreator[] = [
      { id: "low", reach: 100, audience: usHeavy },
      { id: "high", reach: 1000, audience: usHeavyClone },
    ];
    const result = dedupRoster(roster, { threshold: 0.85 });
    expect(result.keep).toEqual(["high"]);
    expect(result.drop).toHaveLength(1);
    expect(result.drop[0].id).toBe("low");
    expect(result.drop[0].overlapsWith).toBe("high");
    expect(result.drop[0].overlap).toBeCloseTo(1, 10);
  });

  it("keeps both creators when overlap is below threshold", () => {
    const roster: RosterCreator[] = [
      { id: "a", reach: 500, audience: usHeavy },
      { id: "b", reach: 400, audience: disjoint },
    ];
    const result = dedupRoster(roster);
    expect(result.keep.sort()).toEqual(["a", "b"]);
    expect(result.drop).toHaveLength(0);
  });

  it("breaks reach ties deterministically by id", () => {
    const roster: RosterCreator[] = [
      { id: "zeta", reach: 100, audience: usHeavy },
      { id: "alpha", reach: 100, audience: usHeavyClone },
    ];
    const result = dedupRoster(roster, { threshold: 0.9 });
    expect(result.keep).toEqual(["alpha"]);
    expect(result.drop[0].id).toBe("zeta");
    expect(result.drop[0].overlapsWith).toBe("alpha");
  });

  it("handles empty roster without throwing", () => {
    expect(dedupRoster([])).toEqual({ keep: [], drop: [] });
  });

  it("clamps out-of-range threshold and tolerates degenerate audiences", () => {
    const roster: RosterCreator[] = [
      { id: "x", reach: 10, audience: {} },
      { id: "y", reach: 5, audience: { geo: {} } },
    ];
    const result = dedupRoster(roster, { threshold: 5 });
    expect(result.keep.sort()).toEqual(["x", "y"]);
    expect(result.drop).toHaveLength(0);
  });

  it("is deterministic: same input yields deep-equal output", () => {
    const roster: RosterCreator[] = [
      { id: "c1", reach: 300, audience: usHeavy },
      { id: "c2", reach: 900, audience: usHeavyClone },
      { id: "c3", reach: 600, audience: disjoint },
    ];
    const first = dedupRoster(roster, { threshold: 0.85 });
    const second = dedupRoster(roster, { threshold: 0.85 });
    expect(first).toEqual(second);
  });

  it("rejects a non-finite reach at the validation boundary (fail-closed)", () => {
    const roster = [
      { id: "nan", reach: Number.NaN, audience: usHeavy },
      { id: "real", reach: 50, audience: usHeavyClone },
    ] as RosterCreator[];
    expect(() => dedupRoster(roster, { threshold: 0.85 })).toThrow();
  });
});

describe("pairwiseOverlap", () => {
  it("returns the symmetric upper-triangle list", () => {
    const roster: RosterCreator[] = [
      { id: "a", reach: 1, audience: usHeavy },
      { id: "b", reach: 1, audience: usHeavyClone },
      { id: "c", reach: 1, audience: disjoint },
    ];
    const entries = pairwiseOverlap(roster);
    expect(entries).toHaveLength(3);
    const ab = entries.find((e) => e.a === "a" && e.b === "b");
    expect(ab?.overlap).toBeCloseTo(1, 10);
    const ac = entries.find((e) => e.a === "a" && e.b === "c");
    expect(ac?.overlap).toBeCloseTo(0, 12);
  });

  it("is deterministic across calls", () => {
    const roster: RosterCreator[] = [
      { id: "a", reach: 1, audience: usHeavy },
      { id: "b", reach: 1, audience: disjoint },
    ];
    expect(pairwiseOverlap(roster)).toEqual(pairwiseOverlap(roster));
  });
});
