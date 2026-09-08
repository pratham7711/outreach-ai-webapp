import { METRIC_DEFINITIONS } from "@/lib/metric-definitions";

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

  it("keeps the trending threshold in the definition matching statusFor", () => {
    // lib/trackers/metrics.ts: statusFor returns "trending" at >= 10/h and
    // "viral" at >= 100/h, both of which this tile counts.
    expect(METRIC_DEFINITIONS.trackersTrending.how).toMatch(/at least 10 uses an hour/i);
  });
});
