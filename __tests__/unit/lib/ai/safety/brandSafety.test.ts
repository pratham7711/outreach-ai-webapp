import {
  assessBrandSafety,
  hasHighSeverityFlag,
  SEVERITY_RANK,
  FLAG_CODES,
  type BrandSafetySignals,
  type BrandSafetyAssessment,
} from "@/lib/ai/safety/brandSafety";

const clean: BrandSafetySignals = {
  categories: ["fitness", "wellness"],
  flaggedTermHits: {},
  priorIncidents: 0,
  controversyScore: 0,
  restrictedCategories: [],
};

const codesOf = (a: BrandSafetyAssessment): string[] => a.flags.map((f) => f.code);
const riskRank: Record<string, number> = { low: 1, medium: 2, high: 3 };

describe("assessBrandSafety", () => {
  it("clean signals -> safe=true, riskLevel low, high score, no flags", () => {
    const result = assessBrandSafety(clean);
    expect(result.safe).toBe(true);
    expect(result.riskLevel).toBe("low");
    expect(result.score).toBe(100);
    expect(result.flags).toEqual([]);
  });

  it("restricted category -> RESTRICTED_CATEGORY high flag + safe=false", () => {
    const result = assessBrandSafety({
      ...clean,
      restrictedCategories: ["gambling"],
    });
    expect(codesOf(result)).toContain(FLAG_CODES.RESTRICTED_CATEGORY);
    const flag = result.flags.find((f) => f.code === FLAG_CODES.RESTRICTED_CATEGORY);
    expect(flag?.severity).toBe("high");
    expect(result.safe).toBe(false);
    expect(result.riskLevel).toBe("high");
    expect(result.score).toBe(0);
  });

  it("strict category match (opts.strictCategories) flags RESTRICTED_CATEGORY", () => {
    const result = assessBrandSafety(
      { ...clean, categories: ["alcohol", "fitness"] },
      { strictCategories: ["alcohol"] },
    );
    expect(codesOf(result)).toContain(FLAG_CODES.RESTRICTED_CATEGORY);
    expect(result.safe).toBe(false);
  });

  it("prior incidents scale severity (1 -> low, 2 -> medium, 3+ -> high)", () => {
    const one = assessBrandSafety({ ...clean, priorIncidents: 1 });
    const two = assessBrandSafety({ ...clean, priorIncidents: 2 });
    const four = assessBrandSafety({ ...clean, priorIncidents: 4 });

    const sevOf = (a: BrandSafetyAssessment) =>
      a.flags.find((f) => f.code === FLAG_CODES.PRIOR_INCIDENTS)?.severity;

    expect(sevOf(one)).toBe("low");
    expect(sevOf(two)).toBe("medium");
    expect(sevOf(four)).toBe("high");
    expect(four.safe).toBe(false);
  });

  it("high controversy over threshold flags; >=0.8 is high severity", () => {
    const mid = assessBrandSafety({ ...clean, controversyScore: 0.6 });
    const high = assessBrandSafety({ ...clean, controversyScore: 0.9 });

    expect(codesOf(mid)).toContain(FLAG_CODES.HIGH_CONTROVERSY);
    expect(mid.flags.find((f) => f.code === FLAG_CODES.HIGH_CONTROVERSY)?.severity).toBe(
      "medium",
    );
    expect(high.flags.find((f) => f.code === FLAG_CODES.HIGH_CONTROVERSY)?.severity).toBe(
      "high",
    );
    expect(high.safe).toBe(false);
  });

  it("controversy at or below threshold does not flag", () => {
    const result = assessBrandSafety({ ...clean, controversyScore: 0.5 });
    expect(codesOf(result)).not.toContain(FLAG_CODES.HIGH_CONTROVERSY);
    expect(result.safe).toBe(true);
  });

  it("flagged-term hits raise a FLAGGED_TERMS flag with count-scaled severity", () => {
    const low = assessBrandSafety({ ...clean, flaggedTermHits: { slur: 1 } });
    const medium = assessBrandSafety({ ...clean, flaggedTermHits: { slur: 2, scam: 2 } });
    const high = assessBrandSafety({ ...clean, flaggedTermHits: { slur: 5, scam: 5 } });

    const sevOf = (a: BrandSafetyAssessment) =>
      a.flags.find((f) => f.code === FLAG_CODES.FLAGGED_TERMS)?.severity;

    expect(sevOf(low)).toBe("low");
    expect(sevOf(medium)).toBe("medium");
    expect(sevOf(high)).toBe("high");
    expect(high.safe).toBe(false);
  });

  it("MONOTONICITY: adding a worse signal never raises score / never lowers riskLevel", () => {
    const ladder: BrandSafetySignals[] = [
      clean,
      { ...clean, flaggedTermHits: { x: 1 } },
      { ...clean, flaggedTermHits: { x: 3 } },
      { ...clean, flaggedTermHits: { x: 3 }, controversyScore: 0.6 },
      { ...clean, flaggedTermHits: { x: 3 }, controversyScore: 0.6, priorIncidents: 2 },
      {
        ...clean,
        flaggedTermHits: { x: 3 },
        controversyScore: 0.9,
        priorIncidents: 4,
      },
      {
        ...clean,
        flaggedTermHits: { x: 3 },
        controversyScore: 0.9,
        priorIncidents: 4,
        restrictedCategories: ["gambling"],
      },
    ];

    let prev = assessBrandSafety(ladder[0]);
    for (let i = 1; i < ladder.length; i += 1) {
      const cur = assessBrandSafety(ladder[i]);
      expect(cur.score).toBeLessThanOrEqual(prev.score);
      expect(riskRank[cur.riskLevel]).toBeGreaterThanOrEqual(riskRank[prev.riskLevel]);
      prev = cur;
    }
  });

  it("verdict-blocker contract: ANY high-severity flag forces safe=false even with pristine other signals", () => {
    const result = assessBrandSafety({
      categories: ["fitness"],
      flaggedTermHits: {},
      priorIncidents: 0,
      controversyScore: 0,
      restrictedCategories: ["weapons"],
    });
    expect(hasHighSeverityFlag(result.flags)).toBe(true);
    expect(result.safe).toBe(false);
    expect(result.riskLevel).toBe("high");
  });

  it("non-finite and negative inputs are guarded (treated as 0, not crashes)", () => {
    const result = assessBrandSafety({
      ...clean,
      priorIncidents: Number.NaN,
      controversyScore: Number.POSITIVE_INFINITY,
      flaggedTermHits: { a: Number.NEGATIVE_INFINITY, b: -5, c: Number.NaN },
    });
    expect(result.safe).toBe(true);
    expect(result.riskLevel).toBe("low");
    expect(result.score).toBe(100);
    expect(result.flags).toEqual([]);
  });

  it("clamps controversyScore > 1 to 1 (still a high-severity flag, score floored sensibly)", () => {
    const over = assessBrandSafety({ ...clean, controversyScore: 9999 });
    const exactlyOne = assessBrandSafety({ ...clean, controversyScore: 1 });
    expect(over.flags.find((f) => f.code === FLAG_CODES.HIGH_CONTROVERSY)?.severity).toBe(
      "high",
    );
    expect(over).toEqual(exactlyOne);
  });

  it("determinism: same input -> deep-equal output across calls", () => {
    const input: BrandSafetySignals = {
      categories: ["alcohol", "fitness"],
      flaggedTermHits: { scam: 4, slur: 2 },
      priorIncidents: 2,
      controversyScore: 0.55,
      restrictedCategories: ["gambling"],
    };
    const opts = { strictCategories: ["alcohol"] };
    const a = assessBrandSafety(input, opts);
    const b = assessBrandSafety(input, opts);
    expect(a).toEqual(b);
  });

  it("empty signals object is safe (no signals = no flags)", () => {
    const result = assessBrandSafety({});
    expect(result.safe).toBe(true);
    expect(result.riskLevel).toBe("low");
    expect(result.score).toBe(100);
    expect(result.flags).toEqual([]);
  });

  it("SEVERITY_RANK and hasHighSeverityFlag give cheap high-severity detection for callers", () => {
    expect(SEVERITY_RANK.high).toBeGreaterThan(SEVERITY_RANK.medium);
    expect(SEVERITY_RANK.medium).toBeGreaterThan(SEVERITY_RANK.low);
    expect(hasHighSeverityFlag([{ code: "X", severity: "medium", detail: "" }])).toBe(false);
    expect(hasHighSeverityFlag([{ code: "X", severity: "high", detail: "" }])).toBe(true);
  });
});
