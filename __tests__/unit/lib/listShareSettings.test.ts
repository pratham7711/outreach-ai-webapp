import {
  DEFAULT_SHARE_REVIEW,
  LEGACY_SHARE_REVIEW,
  mergeShareReview,
  parseShareReview,
  platformIncluded,
} from "@/lib/lists/shareSettings";

describe("parseShareReview", () => {
  it("reads a link minted before review existed as the old read-only page", () => {
    // A brand already holding a link must not wake up to approve/decline buttons.
    expect(parseShareReview({ stats: true, tags: true, audienceCountry: true, price: false })).toEqual(LEGACY_SHARE_REVIEW);
    expect(LEGACY_SHARE_REVIEW.approvals).toBe(false);
    expect(LEGACY_SHARE_REVIEW.feedback).toBe(false);
  });

  it("fills a stored review object from today's defaults", () => {
    expect(parseShareReview({ review: {} })).toEqual(DEFAULT_SHARE_REVIEW);
    expect(DEFAULT_SHARE_REVIEW.approvals).toBe(true);
  });

  it("keeps the list rates total off by default", () => {
    expect(DEFAULT_SHARE_REVIEW.rateTotal).toBe(false);
  });

  it("applies stored overrides over the defaults", () => {
    expect(parseShareReview({ review: { approvals: false, rateTotal: true } })).toMatchObject({ approvals: false, rateTotal: true, feedback: true });
  });

  it("ignores a non-boolean where a switch is expected", () => {
    expect(parseShareReview({ review: { approvals: "no", feedback: 0 } })).toEqual(DEFAULT_SHARE_REVIEW);
  });

  it("ignores retired or unknown keys", () => {
    expect(parseShareReview({ review: { showAge: true, email: true } })).toEqual(DEFAULT_SHARE_REVIEW);
  });

  it("survives a column holding a scalar or an array", () => {
    expect(parseShareReview(null)).toEqual(LEGACY_SHARE_REVIEW);
    expect(parseShareReview("x")).toEqual(LEGACY_SHARE_REVIEW);
    expect(parseShareReview([1, 2])).toEqual(LEGACY_SHARE_REVIEW);
    expect(parseShareReview({ review: [true] })).toEqual(LEGACY_SHARE_REVIEW);
  });

  it("keeps only platforms it recognises, and de-duplicates them", () => {
    expect(parseShareReview({ review: { platforms: ["TIKTOK", "TIKTOK", "MYSPACE", 7, "YOUTUBE"] } }).platforms).toEqual(["TIKTOK", "YOUTUBE"]);
  });

  it("treats a non-array platforms value as unset", () => {
    expect(parseShareReview({ review: { platforms: "TIKTOK" } }).platforms).toEqual([]);
  });
});

describe("mergeShareReview", () => {
  it("changes only the switches it is given", () => {
    expect(mergeShareReview(LEGACY_SHARE_REVIEW, { approvals: true })).toEqual({ ...LEGACY_SHARE_REVIEW, approvals: true });
  });

  it("does not share the base's platforms array", () => {
    const base = { ...DEFAULT_SHARE_REVIEW, platforms: ["TIKTOK" as const] };
    const out = mergeShareReview(base, {});
    out.platforms.push("YOUTUBE");
    expect(base.platforms).toEqual(["TIKTOK"]);
  });
});

describe("platformIncluded", () => {
  it("includes every platform when none is selected", () => {
    expect(platformIncluded({ platforms: [] }, "TWITCH")).toBe(true);
  });

  it("includes only the selected platforms once a selection exists", () => {
    expect(platformIncluded({ platforms: ["TIKTOK"] }, "TIKTOK")).toBe(true);
    expect(platformIncluded({ platforms: ["TIKTOK"] }, "INSTAGRAM")).toBe(false);
  });
});
