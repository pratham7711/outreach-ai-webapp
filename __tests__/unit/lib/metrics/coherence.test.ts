import { countsContradict, engagementExceedsViews } from "@/lib/metrics/coherence";

describe("engagementExceedsViews", () => {
  it("holds a reading where any engagement counter is larger than views", () => {
    expect(engagementExceedsViews(406, { likes: 1092 })).toBe(true);
    expect(engagementExceedsViews(1000, { likes: 70, comments: 1001 })).toBe(true);
    expect(engagementExceedsViews(1000, { shares: 1001 })).toBe(true);
    expect(engagementExceedsViews(1000, { saves: 1001 })).toBe(true);
  });

  it("allows equal counts, and a zero view count only under zero engagement", () => {
    expect(engagementExceedsViews(1000, { likes: 1000 })).toBe(false);
    expect(engagementExceedsViews(0, { likes: 0, comments: 0 })).toBe(false);
    expect(engagementExceedsViews(0, { likes: 3 })).toBe(true);
  });

  it("says nothing when views are unknown", () => {
    expect(engagementExceedsViews(undefined, { likes: 5083 })).toBe(false);
    expect(engagementExceedsViews(null, { likes: 5083 })).toBe(false);
  });

  it("ignores counters the reading did not carry", () => {
    expect(engagementExceedsViews(1000, { likes: 70, comments: null, shares: undefined })).toBe(false);
  });
});

describe("countsContradict", () => {
  it("reads column names", () => {
    expect(countsContradict({ viewsCount: 2440, likesCount: 6043 })).toBe(true);
    expect(countsContradict({ viewsCount: 88000, likesCount: 6100, commentsCount: 41 })).toBe(false);
    expect(countsContradict({ likesCount: 6043 })).toBe(false);
  });
});
