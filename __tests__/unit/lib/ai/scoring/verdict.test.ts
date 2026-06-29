import {
  composeCreatorVerdict,
  DEFAULT_AUTHENTICITY_FLOOR,
  DEFAULT_CONSIDER_THRESHOLD,
  DEFAULT_STRONG_THRESHOLD,
  type ScoreResultLike,
  type VerdictInputs,
} from "@/lib/ai/scoring/verdict";

const mk = (score: number, label = "factor"): ScoreResultLike => ({
  score,
  confidence: "high",
  factors: [{ label, impact: 1 }],
});

describe("composeCreatorVerdict", () => {
  it("returns strong for all-high sub-scores and no anomalies", () => {
    const inputs: VerdictInputs = {
      authenticity: mk(90, "Authenticity"),
      roi: mk(88, "ROI"),
      brandFit: mk(85, "Brand fit"),
      anomalies: [],
    };
    const verdict = composeCreatorVerdict(inputs);
    expect(verdict.recommendation).toBe("strong");
    expect(verdict.blockers).toHaveLength(0);
    expect(verdict.overallScore).toBeGreaterThanOrEqual(DEFAULT_STRONG_THRESHOLD);
  });

  it("forces avoid when authenticity is low even with perfect roi (blocker dominance)", () => {
    const inputs: VerdictInputs = {
      authenticity: mk(20, "Authenticity"),
      roi: mk(100, "ROI"),
    };
    const verdict = composeCreatorVerdict(inputs);
    expect(verdict.recommendation).toBe("avoid");
    expect(verdict.blockers).toContain("Low authenticity");
    expect(verdict.overallScore).toBeLessThanOrEqual(40);
  });

  it("forces avoid for a single high-severity anomaly with otherwise-high scores, naming the type", () => {
    const inputs: VerdictInputs = {
      authenticity: mk(92, "Authenticity"),
      roi: mk(90, "ROI"),
      brandFit: mk(88, "Brand fit"),
      anomalies: [{ type: "FOLLOWER_SPIKE", severity: "high" }],
    };
    const verdict = composeCreatorVerdict(inputs);
    expect(verdict.recommendation).toBe("avoid");
    expect(verdict.blockers.some((b) => b.includes("FOLLOWER_SPIKE"))).toBe(true);
    expect(verdict.overallScore).toBeLessThanOrEqual(40);
  });

  it("does not force avoid for a low-severity anomaly alone", () => {
    const inputs: VerdictInputs = {
      authenticity: mk(90, "Authenticity"),
      roi: mk(88, "ROI"),
      brandFit: mk(85, "Brand fit"),
      anomalies: [{ type: "ENGAGEMENT_DROP", severity: "low" }],
    };
    const verdict = composeCreatorVerdict(inputs);
    expect(verdict.blockers).toHaveLength(0);
    expect(verdict.recommendation).toBe("strong");
  });

  it("does not force avoid for a medium-severity anomaly alone", () => {
    const inputs: VerdictInputs = {
      authenticity: mk(90, "Authenticity"),
      roi: mk(88, "ROI"),
      anomalies: [{ type: "GEOGRAPHIC_ANOMALY", severity: "medium" }],
    };
    const verdict = composeCreatorVerdict(inputs);
    expect(verdict.blockers).toHaveLength(0);
    expect(verdict.recommendation).not.toBe("avoid");
  });

  it("produces a finite overallScore with no NaN when roi and brandFit are missing", () => {
    const inputs: VerdictInputs = {
      authenticity: mk(82, "Authenticity"),
    };
    const verdict = composeCreatorVerdict(inputs);
    expect(Number.isFinite(verdict.overallScore)).toBe(true);
    expect(Number.isNaN(verdict.overallScore)).toBe(false);
    expect(verdict.overallScore).toBe(82);
    expect(verdict.rationale).toHaveLength(1);
  });

  it("keeps overallScore within [0,100] for out-of-range and non-finite inputs", () => {
    const cases: VerdictInputs[] = [
      { authenticity: mk(9_999, "Authenticity"), roi: mk(-500, "ROI") },
      { authenticity: mk(Number.NaN, "Authenticity") },
      { authenticity: mk(Number.POSITIVE_INFINITY, "Authenticity"), brandFit: mk(50, "Brand fit") },
      { authenticity: mk(-10, "Authenticity") },
    ];
    for (const input of cases) {
      const verdict = composeCreatorVerdict(input);
      expect(verdict.overallScore).toBeGreaterThanOrEqual(0);
      expect(verdict.overallScore).toBeLessThanOrEqual(100);
      expect(Number.isFinite(verdict.overallScore)).toBe(true);
    }
  });

  it("respects the strong tier boundary with no blockers", () => {
    const at = composeCreatorVerdict({ authenticity: mk(DEFAULT_STRONG_THRESHOLD, "Authenticity") });
    const below = composeCreatorVerdict({
      authenticity: mk(DEFAULT_STRONG_THRESHOLD - 1, "Authenticity"),
    });
    expect(at.recommendation).toBe("strong");
    expect(below.recommendation).toBe("consider");
  });

  it("respects the consider and avoid tier boundaries with no blockers", () => {
    const atConsider = composeCreatorVerdict({
      authenticity: mk(DEFAULT_CONSIDER_THRESHOLD, "Authenticity"),
    });
    const belowConsider = composeCreatorVerdict({
      authenticity: mk(DEFAULT_CONSIDER_THRESHOLD, "Authenticity"),
      roi: mk(DEFAULT_CONSIDER_THRESHOLD - 10, "ROI"),
    });
    expect(atConsider.recommendation).toBe("consider");
    expect(belowConsider.recommendation).toBe("avoid");
    expect(belowConsider.blockers).toHaveLength(0);
  });

  it("references each present sub-score in the rationale", () => {
    const inputs: VerdictInputs = {
      authenticity: mk(80, "Authenticity"),
      roi: mk(70, "ROI"),
      brandFit: mk(60, "Brand fit"),
    };
    const verdict = composeCreatorVerdict(inputs);
    const labels = verdict.rationale.map((r) => r.label);
    expect(labels).toContain("Authenticity");
    expect(labels).toContain("ROI");
    expect(labels).toContain("Brand fit");
  });

  it("includes a blocker entry in the rationale when blocked", () => {
    const verdict = composeCreatorVerdict({
      authenticity: mk(10, "Authenticity"),
      anomalies: [{ type: "AUTHENTICITY_DROP", severity: "high" }],
    });
    const blockerDetails = verdict.rationale
      .filter((r) => r.label === "Blocker")
      .map((r) => r.detail);
    expect(blockerDetails).toContain("Low authenticity");
    expect(blockerDetails.some((d) => (d ?? "").includes("AUTHENTICITY_DROP"))).toBe(true);
  });

  it("honors custom thresholds passed via opts", () => {
    const verdict = composeCreatorVerdict(
      { authenticity: mk(60, "Authenticity") },
      { authenticityFloor: 65 },
    );
    expect(verdict.blockers).toContain("Low authenticity");
    expect(verdict.recommendation).toBe("avoid");
    expect(DEFAULT_AUTHENTICITY_FLOOR).toBe(40);
  });

  it("is deterministic: same input yields deep-equal output", () => {
    const inputs: VerdictInputs = {
      authenticity: mk(77, "Authenticity"),
      roi: mk(64, "ROI"),
      brandFit: mk(58, "Brand fit"),
      anomalies: [{ type: "ENGAGEMENT_DROP", severity: "medium" }],
    };
    const a = composeCreatorVerdict(inputs);
    const b = composeCreatorVerdict(inputs);
    expect(a).toEqual(b);
  });
});
