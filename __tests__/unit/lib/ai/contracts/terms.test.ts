import {
  buildContractTerms,
  validateContractTerms,
  summarizeContractTerms,
  ContractTerms,
} from "@/lib/ai/contracts/terms";

const MS_DAY = 86_400_000;

const validTerms: ContractTerms = {
  deliverables: [
    { kind: "reel", quantity: 2 },
    { kind: "story", quantity: 3 },
  ],
  rateUsd: 1500,
  schedule: { startEpochMs: 1_000_000_000_000, endEpochMs: 1_000_864_000_000 },
  usageRights: "paid social, 6 months",
  exclusivityDays: 30,
};

function hasError(issues: { code: string; severity: string }[], code: string): boolean {
  return issues.some((i) => i.code === code && i.severity === "error");
}

function hasWarning(issues: { code: string; severity: string }[], code: string): boolean {
  return issues.some((i) => i.code === code && i.severity === "warning");
}

describe("buildContractTerms normalization", () => {
  it("normalizes a raw input and clamps a negative quantity to 0", () => {
    const terms = buildContractTerms({
      deliverables: [{ kind: "reel", quantity: -5 }],
      rateUsd: 500,
      schedule: { startEpochMs: 0, endEpochMs: 1000 },
    });
    expect(terms.deliverables[0].quantity).toBe(0);
    expect(terms.deliverables[0].kind).toBe("reel");
  });

  it("clamps a non-finite quantity (NaN / Infinity) to 0", () => {
    const terms = buildContractTerms({
      deliverables: [
        { kind: "a", quantity: Number.NaN },
        { kind: "b", quantity: Number.POSITIVE_INFINITY },
      ],
      rateUsd: 10,
      schedule: { startEpochMs: 0, endEpochMs: 10 },
    });
    expect(terms.deliverables[0].quantity).toBe(0);
    expect(terms.deliverables[1].quantity).toBe(0);
  });

  it("defaults optional fields and produces a safe shape on garbage input", () => {
    const terms = buildContractTerms(null);
    expect(terms.deliverables).toEqual([]);
    expect(terms.rateUsd).toBe(0);
    expect(terms.schedule).toEqual({ startEpochMs: 0, endEpochMs: 0 });
    expect(terms.usageRights).toBeUndefined();
    expect(terms.exclusivityDays).toBeUndefined();
  });

  it("coerces a non-finite rateUsd to 0 during build", () => {
    const terms = buildContractTerms({
      deliverables: [{ kind: "reel", quantity: 1 }],
      rateUsd: Number.NaN,
      schedule: { startEpochMs: 0, endEpochMs: 10 },
    });
    expect(terms.rateUsd).toBe(0);
  });
});

describe("validateContractTerms fail-closed errors", () => {
  it("a valid contract is valid with no error issues", () => {
    const result = validateContractTerms(validTerms);
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.severity === "error")).toBe(false);
  });

  it("NO_DELIVERABLES on empty deliverables -> error + invalid", () => {
    const result = validateContractTerms({ ...validTerms, deliverables: [] });
    expect(hasError(result.issues, "NO_DELIVERABLES")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("NO_DELIVERABLES when all quantities are zero", () => {
    const result = validateContractTerms({
      ...validTerms,
      deliverables: [
        { kind: "reel", quantity: 0 },
        { kind: "story", quantity: 0 },
      ],
    });
    expect(hasError(result.issues, "NO_DELIVERABLES")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("INVALID_RATE for rate 0, negative, and NaN -> error + invalid", () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validateContractTerms({ ...validTerms, rateUsd: bad });
      expect(hasError(result.issues, "INVALID_RATE")).toBe(true);
      expect(result.valid).toBe(false);
    }
  });

  it("INVALID_SCHEDULE when end <= start -> error + invalid", () => {
    const result = validateContractTerms({
      ...validTerms,
      schedule: { startEpochMs: 1000, endEpochMs: 500 },
    });
    expect(hasError(result.issues, "INVALID_SCHEDULE")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("INVALID_SCHEDULE at the boundary end == start -> invalid", () => {
    const result = validateContractTerms({
      ...validTerms,
      schedule: { startEpochMs: 1000, endEpochMs: 1000 },
    });
    expect(hasError(result.issues, "INVALID_SCHEDULE")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("INVALID_SCHEDULE for non-finite schedule values", () => {
    const result = validateContractTerms({
      ...validTerms,
      schedule: { startEpochMs: Number.NaN, endEpochMs: 10 },
    });
    expect(hasError(result.issues, "INVALID_SCHEDULE")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("NEGATIVE_EXCLUSIVITY -> error + invalid", () => {
    const result = validateContractTerms({ ...validTerms, exclusivityDays: -10 });
    expect(hasError(result.issues, "NEGATIVE_EXCLUSIVITY")).toBe(true);
    expect(result.valid).toBe(false);
  });
});

describe("validateContractTerms warnings (still valid)", () => {
  it("MISSING_USAGE_RIGHTS is a warning, contract stays valid", () => {
    const { usageRights, ...withoutUsage } = validTerms;
    void usageRights;
    const result = validateContractTerms(withoutUsage as ContractTerms);
    expect(hasWarning(result.issues, "MISSING_USAGE_RIGHTS")).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("VERY_LONG_EXCLUSIVITY over the threshold is a warning, contract stays valid", () => {
    const result = validateContractTerms({ ...validTerms, exclusivityDays: 400 });
    expect(hasWarning(result.issues, "VERY_LONG_EXCLUSIVITY")).toBe(true);
    expect(hasError(result.issues, "NEGATIVE_EXCLUSIVITY")).toBe(false);
    expect(result.valid).toBe(true);
  });

  it("never marks an error-bearing contract as valid (combined errors)", () => {
    const result = validateContractTerms({
      deliverables: [],
      rateUsd: -1,
      schedule: { startEpochMs: 10, endEpochMs: 5 },
      exclusivityDays: -1,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.filter((i) => i.severity === "error").length).toBeGreaterThanOrEqual(4);
  });
});

describe("summarizeContractTerms", () => {
  it("includes deliverables, rate, and a day-count, and never prints NaN", () => {
    const summary = summarizeContractTerms(validTerms);
    expect(summary).toContain("reel");
    expect(summary).toContain("1500");
    expect(summary).toContain("10-day");
    expect(summary).not.toContain("NaN");
  });

  it("is numeric-safe with non-finite/garbage schedule and rate (no NaN)", () => {
    const summary = summarizeContractTerms({
      deliverables: [{ kind: "post", quantity: Number.NaN }],
      rateUsd: Number.POSITIVE_INFINITY,
      schedule: { startEpochMs: Number.NaN, endEpochMs: Number.NaN },
    } as ContractTerms);
    expect(summary).not.toContain("NaN");
    expect(summary).not.toContain("Infinity");
    expect(summary).toContain("0-day");
  });

  it("does not reference signing, sending, or executing an e-signature", () => {
    const summary = summarizeContractTerms(validTerms).toLowerCase();
    expect(summary).not.toContain("signed and sent");
    expect(summary).not.toContain("e-sign");
    expect(summary).toContain("not signed or sent");
  });
});

describe("determinism", () => {
  it("buildContractTerms: same input -> deep-equal output", () => {
    const input = {
      deliverables: [{ kind: "reel", quantity: 2 }],
      rateUsd: 900,
      schedule: { startEpochMs: 0, endEpochMs: MS_DAY },
      usageRights: "organic",
      exclusivityDays: 14,
    };
    expect(buildContractTerms(input)).toEqual(buildContractTerms(input));
  });

  it("validateContractTerms + summarizeContractTerms: same input -> deep-equal output", () => {
    expect(validateContractTerms(validTerms)).toEqual(validateContractTerms(validTerms));
    expect(summarizeContractTerms(validTerms)).toBe(summarizeContractTerms(validTerms));
  });
});
