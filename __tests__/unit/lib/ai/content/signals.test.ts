import {
  normalizeContentSignals,
  RESTRICTED_CATEGORIES,
  type RawContentAnalysis,
  type NormalizedContentSignals,
} from "@/lib/ai/content/signals";
import {
  assessBrandSafety,
  type BrandSafetySignals,
} from "@/lib/ai/safety/brandSafety";

const full: RawContentAnalysis = {
  transcriptTermHits: { Casino: 2, profit: 0, slur: 3 },
  frameLabels: ["Bottle", "bottle", "Logo"],
  entities: ["Acme Corp", "acme corp"],
  controversyEstimate: 0.42,
  categories: ["Gambling", "Fitness"],
  priorIncidents: 2.9,
};

describe("normalizeContentSignals", () => {
  it("maps a full raw input into the three signal groups", () => {
    const out = normalizeContentSignals(full);
    expect(out.brandSafety.categories).toEqual(["fitness", "gambling"]);
    expect(out.brandSafety.flaggedTermHits).toEqual({ casino: 2, slur: 3 });
    expect(out.brandSafety.priorIncidents).toBe(2);
    expect(out.brandSafety.controversyScore).toBeCloseTo(0.42, 10);
    expect(out.brandSafety.restrictedCategories).toEqual(["gambling"]);
    expect(out.nicheLabels).toEqual(["bottle", "logo"]);
    expect(out.entities).toEqual(["acme corp"]);
  });

  it("clamps controversyEstimate into [0,1] (1.7 -> 1, NaN -> 0, -0.5 -> 0)", () => {
    expect(
      normalizeContentSignals({ controversyEstimate: 1.7 }).brandSafety
        .controversyScore,
    ).toBe(1);
    expect(
      normalizeContentSignals({ controversyEstimate: Number.NaN }).brandSafety
        .controversyScore,
    ).toBe(0);
    expect(
      normalizeContentSignals({ controversyEstimate: -0.5 }).brandSafety
        .controversyScore,
    ).toBe(0);
    expect(
      normalizeContentSignals({
        controversyEstimate: Number.POSITIVE_INFINITY,
      }).brandSafety.controversyScore,
    ).toBe(0);
  });

  it("drops negative / non-finite / zero flaggedTermHits and floors fractional ones", () => {
    const out = normalizeContentSignals({
      transcriptTermHits: {
        good: 4.8,
        zero: 0,
        neg: -3,
        nan: Number.NaN,
        inf: Number.POSITIVE_INFINITY,
      },
    });
    expect(out.brandSafety.flaggedTermHits).toEqual({ good: 4 });
  });

  it("coerces priorIncidents to a non-negative integer", () => {
    expect(
      normalizeContentSignals({ priorIncidents: 3.9 }).brandSafety
        .priorIncidents,
    ).toBe(3);
    expect(
      normalizeContentSignals({ priorIncidents: -5 }).brandSafety
        .priorIncidents,
    ).toBe(0);
    expect(
      normalizeContentSignals({ priorIncidents: Number.NaN }).brandSafety
        .priorIncidents,
    ).toBe(0);
  });

  it("dedupes + lowercases + stably orders categories, labels and entities", () => {
    const out = normalizeContentSignals({
      categories: ["Zeta", "alpha", "ALPHA", "  Zeta  "],
      frameLabels: ["Dog", "dog", "Cat"],
      entities: ["X", "y", "Y", "x"],
    });
    expect(out.brandSafety.categories).toEqual(["alpha", "zeta"]);
    expect(out.nicheLabels).toEqual(["cat", "dog"]);
    expect(out.entities).toEqual(["x", "y"]);
  });

  it("restrictedCategories = intersection with the default restricted set", () => {
    const out = normalizeContentSignals({
      categories: ["politics", "fitness", "Gambling", "cooking"],
    });
    expect(out.brandSafety.restrictedCategories).toEqual([
      "gambling",
      "politics",
    ]);
    for (const cat of out.brandSafety.restrictedCategories) {
      expect(RESTRICTED_CATEGORIES).toContain(cat);
    }
  });

  it("restrictedCategories honours an opts override (replacing the default set)", () => {
    const out = normalizeContentSignals(
      { categories: ["crypto", "gambling", "fitness"] },
      { restrictedCategories: ["Crypto", "Fitness"] },
    );
    expect(out.brandSafety.restrictedCategories).toEqual(["crypto", "fitness"]);
    const emptyOverride = normalizeContentSignals(
      { categories: ["gambling", "politics"] },
      { restrictedCategories: [] },
    );
    expect(emptyOverride.brandSafety.restrictedCategories).toEqual([]);
  });

  it("empty / missing fields produce empty-safe output without throwing", () => {
    const out = normalizeContentSignals({});
    expect(out).toEqual<NormalizedContentSignals>({
      brandSafety: {
        categories: [],
        flaggedTermHits: {},
        priorIncidents: 0,
        controversyScore: 0,
        restrictedCategories: [],
      },
      nicheLabels: [],
      entities: [],
    });
  });

  it("handles garbage types (numbers/objects where arrays expected) without throwing", () => {
    const garbage = {
      transcriptTermHits: ["not", "an", "object"],
      frameLabels: 42,
      entities: { not: "an array" },
      categories: "gambling",
      controversyEstimate: "high",
      priorIncidents: [1, 2, 3],
    } as unknown as RawContentAnalysis;
    const out = normalizeContentSignals(garbage);
    expect(out.brandSafety.categories).toEqual([]);
    expect(out.brandSafety.flaggedTermHits).toEqual({});
    expect(out.brandSafety.controversyScore).toBe(0);
    expect(out.brandSafety.priorIncidents).toBe(0);
    expect(out.nicheLabels).toEqual([]);
    expect(out.entities).toEqual([]);
  });

  it("preserves valid signals when a sibling field is malformed (field-level tolerance)", () => {
    const out = normalizeContentSignals({
      categories: ["gambling"],
      priorIncidents: 2,
      transcriptTermHits: 5,
      frameLabels: 42,
    } as unknown as RawContentAnalysis);
    expect(out.brandSafety.categories).toEqual(["gambling"]);
    expect(out.brandSafety.restrictedCategories).toEqual(["gambling"]);
    expect(out.brandSafety.priorIncidents).toBe(2);
    expect(out.brandSafety.flaggedTermHits).toEqual({});
    expect(out.nicheLabels).toEqual([]);
  });

  it("ignores non-string array members deterministically", () => {
    const dirty = {
      categories: ["gambling", 7, null, "", "  ", "fitness"],
      frameLabels: ["dog", undefined, 3, "cat"],
    } as unknown as RawContentAnalysis;
    const out = normalizeContentSignals(dirty);
    expect(out.brandSafety.categories).toEqual(["fitness", "gambling"]);
    expect(out.nicheLabels).toEqual(["cat", "dog"]);
  });

  it("is deterministic for the same input (deep-equal across calls)", () => {
    const a = normalizeContentSignals(full);
    const b = normalizeContentSignals(full);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("produces a brandSafety shape that is accepted by assessBrandSafety", () => {
    const out = normalizeContentSignals(full);
    const piped: BrandSafetySignals = out.brandSafety;
    expect(Object.keys(piped).sort()).toEqual(
      [
        "categories",
        "controversyScore",
        "flaggedTermHits",
        "priorIncidents",
        "restrictedCategories",
      ].sort(),
    );
    const assessment = assessBrandSafety(out.brandSafety);
    expect(typeof assessment.safe).toBe("boolean");
    expect(typeof assessment.score).toBe("number");
    expect(["low", "medium", "high"]).toContain(assessment.riskLevel);
  });

  it("never invents a signal absent from the input", () => {
    const out = normalizeContentSignals({ entities: ["Nike"] });
    expect(out.entities).toEqual(["nike"]);
    expect(out.nicheLabels).toEqual([]);
    expect(out.brandSafety.categories).toEqual([]);
    expect(out.brandSafety.flaggedTermHits).toEqual({});
    expect(out.brandSafety.restrictedCategories).toEqual([]);
  });
});
