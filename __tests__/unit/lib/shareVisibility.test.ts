import {
  DEFAULT_SHARE_VISIBILITY,
  SHARE_PLATFORMS,
  parseShareVisibility,
  sanitizeShareVisibility,
} from "@/lib/reports/shareVisibility";

/* These two functions sit on either side of a public URL: sanitize guards what
   gets stored, parse guards what an anonymous visitor is shown. A parser that
   falls open here does not throw an error, it quietly publishes a budget. */

describe("parseShareVisibility", () => {
  it("treats a link with no visibility as a legacy link and keeps it working", () => {
    // Links created before this feature exist in the wild with only {kind}, and
    // have already been sent to people. They must not change under their
    // recipients — except budget, which was never rendered, so showing it now
    // would be a new disclosure rather than continuity.
    expect(parseShareVisibility({ kind: "campaign-performance" })).toEqual(DEFAULT_SHARE_VISIBILITY);
    expect(DEFAULT_SHARE_VISIBILITY.showBudget).toBe(false);
    expect(DEFAULT_SHARE_VISIBILITY.showCreators).toBe(true);
  });

  it("falls back to the default for a null or non-object config", () => {
    expect(parseShareVisibility(null)).toEqual(DEFAULT_SHARE_VISIBILITY);
    expect(parseShareVisibility(undefined)).toEqual(DEFAULT_SHARE_VISIBILITY);
    expect(parseShareVisibility("nonsense")).toEqual(DEFAULT_SHARE_VISIBILITY);
    expect(parseShareVisibility({ visibility: "nonsense" })).toEqual(DEFAULT_SHARE_VISIBILITY);
  });

  it("does not accept a truthy non-boolean as permission", () => {
    // The whole point: "yes" and 1 are truthy in JS, and a === check is the
    // only thing standing between a typo and a published budget.
    const v = parseShareVisibility({
      visibility: { showBudget: "yes", showEmv: 1, showCreators: "true" },
    });
    expect(v.showBudget).toBe(false);
    expect(v.showEmv).toBe(false);
    expect(v.showCreators).toBe(false);
  });

  it("closes a field that is present-but-missing rather than opening it", () => {
    // sanitize always writes all four fields, so an absent one means the stored
    // object is malformed. Closed is the only safe reading.
    const v = parseShareVisibility({ visibility: { platforms: ["TIKTOK"] } });
    expect(v.showCreators).toBe(false);
    expect(v.showEmv).toBe(false);
    expect(v.showBudget).toBe(false);
  });

  it("keeps only recognised platforms and drops the rest", () => {
    const v = parseShareVisibility({
      visibility: { platforms: ["TIKTOK", "MYSPACE", 7, null, "YOUTUBE"], showCreators: true, showEmv: true, showBudget: false },
    });
    expect(v.platforms).toEqual(["TIKTOK", "YOUTUBE"]);
  });

  it("reads a non-array platforms value as no restriction, not as a crash", () => {
    const v = parseShareVisibility({ visibility: { platforms: "TIKTOK", showCreators: true, showEmv: true, showBudget: true } });
    expect(v.platforms).toEqual([]);
  });

  it("round-trips a real sanitized object unchanged", () => {
    const stored = sanitizeShareVisibility({
      platforms: ["INSTAGRAM"],
      showCreators: false,
      showEmv: false,
      showBudget: true,
    });
    expect(parseShareVisibility({ kind: "campaign-performance", visibility: stored })).toEqual(stored);
  });
});

describe("sanitizeShareVisibility", () => {
  it("defaults the two disclosure switches the safe way round", () => {
    // Omitted showCreators/showEmv keep the report useful (opt-out), while
    // omitted showBudget stays off (opt-in) — budget is the one nobody should
    // publish by forgetting a field.
    const v = sanitizeShareVisibility({});
    expect(v.showCreators).toBe(true);
    expect(v.showEmv).toBe(true);
    expect(v.showBudget).toBe(false);
    expect(v.platforms).toEqual([]);
  });

  it("drops unknown keys instead of persisting them", () => {
    const v = sanitizeShareVisibility({ showBudget: true, showSalaries: true, __proto__: { evil: 1 } });
    expect(Object.keys(v).sort()).toEqual([
      "markRemovedPosts",
      "platforms",
      "showBudget",
      "showCreators",
      "showEmv",
      "showStatuses",
    ]);
  });

  it("dedupes platforms and rejects unknown ones", () => {
    const v = sanitizeShareVisibility({ platforms: ["TIKTOK", "TIKTOK", "MYSPACE"] });
    expect(v.platforms).toEqual(["TIKTOK"]);
  });

  it("accepts every platform it advertises", () => {
    // Guards against SHARE_PLATFORMS and the validator drifting apart, which
    // would silently make a platform unselectable in the modal.
    const v = sanitizeShareVisibility({ platforms: [...SHARE_PLATFORMS] });
    expect(v.platforms).toEqual([...SHARE_PLATFORMS]);
  });
});

describe("showStatuses", () => {
  /* Activation statuses say who declined and what is still unposted, which is
     agency-internal until an agency decides otherwise — so this one is closed by
     default on every path, including a legacy link that predates it. */

  it("is off for a legacy link, which never showed statuses", () => {
    expect(parseShareVisibility({ kind: "campaign-performance" }).showStatuses).toBe(false);
    expect(DEFAULT_SHARE_VISIBILITY.showStatuses).toBe(false);
  });

  it("is off unless stored as exactly true", () => {
    for (const stored of ["true", 1, "yes", {}, [], null]) {
      expect(
        parseShareVisibility({ visibility: { showStatuses: stored } }).showStatuses
      ).toBe(false);
    }
    expect(parseShareVisibility({ visibility: { showStatuses: true } }).showStatuses).toBe(true);
  });

  it("stays off when the client omits it, unlike the fields that default open", () => {
    // sanitize opens showCreators/showEmv on absence for legacy continuity;
    // this one has no legacy to preserve, so absence means off.
    const sanitized = sanitizeShareVisibility({});
    expect(sanitized.showStatuses).toBe(false);
    expect(sanitized.showCreators).toBe(true);
    expect(sanitizeShareVisibility({ showStatuses: true }).showStatuses).toBe(true);
    expect(sanitizeShareVisibility({ showStatuses: "true" }).showStatuses).toBe(false);
  });

  it("survives a round trip through storage", () => {
    const stored = sanitizeShareVisibility({ showStatuses: true, showBudget: true });
    expect(parseShareVisibility({ visibility: stored })).toEqual(stored);
  });
});

describe("markRemovedPosts", () => {
  /* The odd one out: every other switch decides whether a brand sees a number
     we hold. This one decides whether it is told a post it already paid for is
     no longer on the platform — a disclosure the agency makes deliberately or
     not at all, so off is the default and off is where anything malformed lands. */

  it("is off for a legacy link and off in the default", () => {
    expect(parseShareVisibility({ kind: "campaign-performance" }).markRemovedPosts).toBe(false);
    expect(DEFAULT_SHARE_VISIBILITY.markRemovedPosts).toBe(false);
  });

  it("is off unless stored as exactly true", () => {
    for (const stored of ["true", 1, "yes", {}, [], null]) {
      expect(
        parseShareVisibility({ visibility: { markRemovedPosts: stored } }).markRemovedPosts
      ).toBe(false);
    }
    expect(parseShareVisibility({ visibility: { markRemovedPosts: true } }).markRemovedPosts).toBe(
      true
    );
  });

  it("stays off when the client omits it", () => {
    expect(sanitizeShareVisibility({}).markRemovedPosts).toBe(false);
    expect(sanitizeShareVisibility({ markRemovedPosts: true }).markRemovedPosts).toBe(true);
    expect(sanitizeShareVisibility({ markRemovedPosts: "true" }).markRemovedPosts).toBe(false);
  });

  it("survives a round trip through storage", () => {
    const stored = sanitizeShareVisibility({ markRemovedPosts: true, platforms: ["TIKTOK"] });
    expect(parseShareVisibility({ visibility: stored })).toEqual(stored);
  });
});
