import { assessQuality } from "@/lib/ai/ingestion/dataQuality";
import type { IngestedRecord } from "@/lib/ai/ingestion/dataQuality";

const complete: IngestedRecord = {
  source: "apify",
  fetchedAtLabel: "scraped recently",
  fields: {
    handle: "creator",
    followers: 12000,
    avgLikes: 800,
    avgComments: 40,
  },
  requiredFields: ["handle", "followers", "avgLikes"],
  metricFields: ["followers", "avgLikes", "avgComments"],
};

describe("assessQuality", () => {
  it("scores a complete record high and usable", () => {
    const result = assessQuality(complete);
    expect(result.usable).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.flags).toEqual([]);
  });

  it("flags MISSING_REQUIRED and is not usable even when other fields are rich", () => {
    const record: IngestedRecord = {
      source: "apify",
      fields: {
        handle: "creator",
        avgLikes: 800,
        avgComments: 40,
        bio: "lots of rich extra context here",
        website: "https://example.com",
      },
      requiredFields: ["handle", "followers", "avgLikes"],
    };
    const result = assessQuality(record);
    expect(result.flags).toContain("MISSING_REQUIRED");
    expect(result.usable).toBe(false);
  });

  it("treats null/undefined required values as missing", () => {
    const record: IngestedRecord = {
      source: "apify",
      fields: { handle: "creator", followers: null, avgLikes: undefined },
      requiredFields: ["handle", "followers", "avgLikes"],
    };
    const result = assessQuality(record);
    expect(result.flags).toContain("MISSING_REQUIRED");
    expect(result.usable).toBe(false);
  });

  it("flags EMPTY, is low confidence and not usable for no fields", () => {
    const record: IngestedRecord = { source: "apify", fields: {} };
    const result = assessQuality(record);
    expect(result.flags).toContain("EMPTY");
    expect(result.confidence).toBe("low");
    expect(result.usable).toBe(false);
    expect(result.score).toBe(0);
  });

  it("flags LOW_COMPLETENESS when present-required fraction is below threshold", () => {
    const record: IngestedRecord = {
      source: "apify",
      fields: { a: 1, b: 2 },
      requiredFields: ["a", "b", "c", "d", "e"],
    };
    const result = assessQuality(record);
    expect(result.flags).toContain("LOW_COMPLETENESS");
    expect(result.flags).toContain("MISSING_REQUIRED");
  });

  it("does not flag LOW_COMPLETENESS at or above the threshold", () => {
    const record: IngestedRecord = {
      source: "apify",
      fields: { a: 1, b: 2, c: 3, d: 4 },
      requiredFields: ["a", "b", "c", "d", "e"],
    };
    const result = assessQuality(record);
    expect(result.flags).not.toContain("LOW_COMPLETENESS");
  });

  it("flags STALE only when ageHint > maxAge", () => {
    const stale = assessQuality(complete, { ageHint: 100, maxAge: 50 });
    expect(stale.flags).toContain("STALE");

    const fresh = assessQuality(complete, { ageHint: 30, maxAge: 50 });
    expect(fresh.flags).not.toContain("STALE");

    const equal = assessQuality(complete, { ageHint: 50, maxAge: 50 });
    expect(equal.flags).not.toContain("STALE");
  });

  it("does not flag STALE when ageHint is absent", () => {
    const noHint = assessQuality(complete, { maxAge: 50 });
    expect(noHint.flags).not.toContain("STALE");

    const noOpts = assessQuality(complete);
    expect(noOpts.flags).not.toContain("STALE");

    const labelOnly = assessQuality({
      ...complete,
      fetchedAtLabel: "2 years ago",
    });
    expect(labelOnly.flags).not.toContain("STALE");
  });

  it("flags SUSPICIOUS_ZEROS only when every present metric field is 0", () => {
    const allZero = assessQuality({
      source: "apify",
      fields: { followers: 0, avgLikes: 0, avgComments: 0 },
      metricFields: ["followers", "avgLikes", "avgComments"],
    });
    expect(allZero.flags).toContain("SUSPICIOUS_ZEROS");

    const oneNonZero = assessQuality({
      source: "apify",
      fields: { followers: 0, avgLikes: 5, avgComments: 0 },
      metricFields: ["followers", "avgLikes", "avgComments"],
    });
    expect(oneNonZero.flags).not.toContain("SUSPICIOUS_ZEROS");

    const metricMissing = assessQuality({
      source: "apify",
      fields: { followers: 0, avgLikes: 0 },
      metricFields: ["followers", "avgLikes", "avgComments"],
    });
    expect(metricMissing.flags).not.toContain("SUSPICIOUS_ZEROS");
  });

  it("derives confidence tiers from completeness and presence", () => {
    expect(assessQuality(complete).confidence).toBe("high");

    const medium = assessQuality({
      source: "apify",
      fields: { a: 1, b: 2 },
      requiredFields: ["a"],
    });
    expect(medium.confidence).toBe("medium");

    const low = assessQuality({ source: "apify", fields: {} });
    expect(low.confidence).toBe("low");
  });

  it("is deterministic: same input -> deep-equal output", () => {
    const a = assessQuality(complete, { ageHint: 10, maxAge: 5 });
    const b = assessQuality(complete, { ageHint: 10, maxAge: 5 });
    expect(a).toEqual(b);
  });

  it("respects a custom minScore for usability", () => {
    const record: IngestedRecord = {
      source: "apify",
      fields: { followers: 0, avgLikes: 0, avgComments: 0 },
      requiredFields: ["followers"],
      metricFields: ["followers", "avgLikes", "avgComments"],
    };
    const lenient = assessQuality(record, { minScore: 40 });
    const strict = assessQuality(record, { minScore: 95 });
    expect(lenient.usable).toBe(true);
    expect(strict.usable).toBe(false);
  });

  it("fail-closed: a missing required field forces usable=false even when the score clears minScore", () => {
    const record: IngestedRecord = {
      source: "apify",
      fields: {
        handle: "creator",
        followers: 12000,
        avgLikes: 800,
        avgComments: 40,
        bio: "rich extra context",
      },
      requiredFields: ["handle", "followers", "avgLikes", "verifiedEmail"],
    };
    const result = assessQuality(record, { minScore: 0 });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.flags).toContain("MISSING_REQUIRED");
    expect(result.usable).toBe(false);
  });
});
