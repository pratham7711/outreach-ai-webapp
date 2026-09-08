import { METRIC_DEFINITIONS } from "@/lib/metric-definitions";
import { rollupEngagement } from "@/lib/metricDisplay";

/**
 * The tracker tiles are fed by the snapshot-sounds cron, which vercel.json
 * schedules "0 4 * * *". Nothing on that page is measured now, so a definition
 * claiming "today" or "right now" is a wrong number with a confident name —
 * which is the defect this suite exists to stop coming back.
 */
const CRON_FED_METRICS = ["trackerUses", "trackersTrending", "trackersNewUses"] as const;

/* Word-bounded so "not this minute" and "not a figure for any particular
   period" survive while "climbing right now" does not. */
const PRESENT_TENSE_CLAIMS = [/\bright now\b/i, /\btoday\b/i, /\bthis week\b/i, /\bcurrently\b/i, /\blive now\b/i];

describe("METRIC_DEFINITIONS", () => {
  it("gives every metric a label and a plain-language 'what'", () => {
    for (const [key, def] of Object.entries(METRIC_DEFINITIONS)) {
      expect(def.label.trim().length).toBeGreaterThan(0);
      expect(def.what.trim().length).toBeGreaterThan(0);
      // A "how" that exists must actually say something.
      if (def.how !== undefined) expect(def.how.trim().length).toBeGreaterThan(0);
      expect(key).not.toMatch(/\s/);
    }
  });

  describe("daily-cron metrics do not claim to be current", () => {
    it.each(CRON_FED_METRICS)("%s", (key) => {
      const def = METRIC_DEFINITIONS[key];
      const text = `${def.label} ${def.what} ${def.how ?? ""}`;
      for (const claim of PRESENT_TENSE_CLAIMS) {
        expect(text).not.toMatch(claim);
      }
    });
  });

  it('does not label the period-aware tracker growth tile "New today"', () => {
    // The value is the growth over the period the buttons select — 24h by
    // default, up to 30d — so the label has to be period-neutral. The trackers
    // page overrides it with the selected period.
    expect(METRIC_DEFINITIONS.trackersNewUses.label).toBe("New uses");
  });

  it("says out loud that a tracker reading can be a day old", () => {
    expect(METRIC_DEFINITIONS.trackerUses.how).toMatch(/up to a day old/i);
  });

  /* Engagement rate is one function -- lib/metricDisplay rollupEngagement -- and
     these two entries describe it on two screens. They said different things:
     `avgEngagementRate` claimed three terms averaged across posts while the code
     computes four terms over measured views, which is the same defect as three
     screens printing three rates, just in the tooltip instead of the tile. */
  describe("the engagement rate has one description", () => {
    const HOW = "Likes plus comments plus shares plus saves, divided by the views of the posts we have actually measured.";

    it("says the same sentence on the campaign tile and the analytics tile", () => {
      expect(METRIC_DEFINITIONS.engagementRate.how).toBe(HOW);
      expect(METRIC_DEFINITIONS.avgEngagementRate.how).toBe(HOW);
    });

    it("does not describe it as a mean of per-post rates", () => {
      // A 12-view post at 50% would outweigh a 400k-view post at 2%.
      expect(METRIC_DEFINITIONS.avgEngagementRate.how).not.toMatch(/averaged across posts/i);
    });

    it("describes the formula rollupEngagement actually applies", () => {
      // Four terms over the measured post's views, and nothing from the
      // unmeasured one in either half.
      const rollup = rollupEngagement([
        {
          viewsCount: 1_000,
          likesCount: 40,
          commentsCount: 20,
          sharesCount: 10,
          savesCount: 30,
          lastSyncedAt: new Date("2026-09-01"),
        },
        { viewsCount: 9_000, likesCount: 0, commentsCount: 0, sharesCount: 0, savesCount: 0, lastSyncedAt: null },
      ]);
      expect(rollup.engagements).toBe(100);
      expect(rollup.measuredViews).toBe(1_000);
      expect(rollup.rate).toBeCloseTo(0.1, 6);

      for (const term of ["Likes", "comments", "shares", "saves"]) {
        expect(HOW).toContain(term);
      }
      expect(HOW).toMatch(/actually measured/i);
    });
  });

  it("keeps the trending threshold in the definition matching statusFor", () => {
    // lib/trackers/metrics.ts: statusFor returns "trending" at >= 10/h and
    // "viral" at >= 100/h, both of which this tile counts.
    expect(METRIC_DEFINITIONS.trackersTrending.how).toMatch(/at least 10 uses an hour/i);
  });
});
