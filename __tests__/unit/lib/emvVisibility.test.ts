import { emvEnabled, emvEnabledFromRaw } from "@/lib/orgMetrics";
import { applyOrgMetricPolicy, DEFAULT_SHARE_VISIBILITY } from "@/lib/reports/shareVisibility";

/* The default direction is the whole risk here. EMV has been visible since
   launch, so anything this parser does not recognise must keep showing it --
   a parser that fell closed would strip a column from every workspace that has
   never opened the setting. Only an explicit `false` hides it.

   That is the opposite of parseShareVisibility, which guards a public URL and
   must fail closed. Both defaults are deliberate; these tests pin them apart. */

describe("emvEnabled", () => {
  it("shows EMV when the workspace has never touched the setting", () => {
    expect(emvEnabled(null)).toBe(true);
    expect(emvEnabled(undefined)).toBe(true);
    expect(emvEnabled({})).toBe(true);
    expect(emvEnabled({ metrics: {} })).toBe(true);
  });

  it("hides EMV only on an explicit false", () => {
    expect(emvEnabled({ metrics: { showEmv: false } })).toBe(false);
    expect(emvEnabled({ metrics: { showEmv: true } })).toBe(true);
  });
});

describe("emvEnabledFromRaw", () => {
  it("survives the shapes a JSON column can actually hold", () => {
    expect(emvEnabledFromRaw(null)).toBe(true);
    expect(emvEnabledFromRaw(undefined)).toBe(true);
    expect(emvEnabledFromRaw("not an object")).toBe(true);
    expect(emvEnabledFromRaw(42)).toBe(true);
    expect(emvEnabledFromRaw([])).toBe(true);
    expect(emvEnabledFromRaw({ metrics: [] })).toBe(true);
    expect(emvEnabledFromRaw({ metrics: null })).toBe(true);
  });

  it("does not read a truthy string as false, or vice versa", () => {
    // Only the boolean false hides it; "false" is a malformed value, not a no.
    expect(emvEnabledFromRaw({ metrics: { showEmv: "false" } })).toBe(true);
    expect(emvEnabledFromRaw({ metrics: { showEmv: 0 } })).toBe(true);
    expect(emvEnabledFromRaw({ metrics: { showEmv: false } })).toBe(false);
  });

  it("ignores unrelated uiConfig keys", () => {
    expect(
      emvEnabledFromRaw({ nav: ["campaigns"], trackers: { readCadence: "daily" }, metrics: { showEmv: false } }),
    ).toBe(false);
  });
});

describe("applyOrgMetricPolicy", () => {
  it("closes a share link that was created while EMV was on", () => {
    const stored = { ...DEFAULT_SHARE_VISIBILITY, showEmv: true };
    expect(applyOrgMetricPolicy(stored, false).showEmv).toBe(false);
  });

  it("never opens one the link itself closed", () => {
    const stored = { ...DEFAULT_SHARE_VISIBILITY, showEmv: false };
    expect(applyOrgMetricPolicy(stored, true).showEmv).toBe(false);
  });

  it("leaves every other field alone", () => {
    const stored = {
      ...DEFAULT_SHARE_VISIBILITY,
      showEmv: true,
      showBudget: true,
      showCreators: true,
      platforms: ["TIKTOK" as const],
    };
    const out = applyOrgMetricPolicy(stored, false);
    expect(out.showBudget).toBe(true);
    expect(out.showCreators).toBe(true);
    expect(out.platforms).toEqual(["TIKTOK"]);
  });
});
