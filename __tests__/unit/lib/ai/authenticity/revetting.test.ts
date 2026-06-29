import {
  detectAnomalies,
  type Snapshot,
  type AnomalyEvent,
} from "@/lib/ai/authenticity/revetting";

const baseline: Snapshot = {
  at: "snapshot-a",
  authenticityScore: 80,
  followers: 100_000,
  engagementRate: 0.05,
  audienceCountryShares: { US: 0.6, GB: 0.25, CA: 0.15 },
};

const typesOf = (events: AnomalyEvent[]): string[] => events.map((e) => e.type);

describe("detectAnomalies", () => {
  it("returns [] for identical snapshots", () => {
    expect(detectAnomalies(baseline, baseline)).toEqual([]);
  });

  it("returns [] for stable-but-not-identical snapshots", () => {
    const stable: Snapshot = {
      at: "snapshot-b",
      authenticityScore: 79,
      followers: 102_000,
      engagementRate: 0.049,
      audienceCountryShares: { US: 0.58, GB: 0.27, CA: 0.15 },
    };
    expect(detectAnomalies(baseline, stable)).toEqual([]);
  });

  it("GEOGRAPHIC_ANOMALY fires when the top-country share shifts past the threshold", () => {
    const shifted: Snapshot = {
      ...baseline,
      audienceCountryShares: { US: 0.2, GB: 0.25, CA: 0.55 },
    };
    const events = detectAnomalies(baseline, shifted);
    expect(typesOf(events)).toContain("GEOGRAPHIC_ANOMALY");
  });

  it("GEOGRAPHIC_ANOMALY fires when a sub-majority country crosses the majority line", () => {
    const prev: Snapshot = {
      ...baseline,
      audienceCountryShares: { US: 0.49, GB: 0.3, CA: 0.21 },
    };
    const curr: Snapshot = {
      ...baseline,
      audienceCountryShares: { US: 0.62, GB: 0.2, CA: 0.18 },
    };
    const events = detectAnomalies(prev, curr);
    expect(typesOf(events)).toContain("GEOGRAPHIC_ANOMALY");
  });

  it("GEOGRAPHIC_ANOMALY does NOT fire when geography is stable", () => {
    const stable: Snapshot = {
      ...baseline,
      audienceCountryShares: { US: 0.58, GB: 0.27, CA: 0.15 },
    };
    expect(typesOf(detectAnomalies(baseline, stable))).not.toContain("GEOGRAPHIC_ANOMALY");
  });

  it("ENGAGEMENT_DROP fires when engagement falls past the relative threshold", () => {
    const dropped: Snapshot = { ...baseline, engagementRate: 0.02 };
    const events = detectAnomalies(baseline, dropped);
    expect(typesOf(events)).toContain("ENGAGEMENT_DROP");
  });

  it("ENGAGEMENT_DROP does NOT fire on a stable engagement rate", () => {
    const stable: Snapshot = { ...baseline, engagementRate: 0.048 };
    expect(typesOf(detectAnomalies(baseline, stable))).not.toContain("ENGAGEMENT_DROP");
  });

  it("AUTHENTICITY_DROP fires when the score falls past the absolute-points threshold", () => {
    const dropped: Snapshot = { ...baseline, authenticityScore: 60 };
    const events = detectAnomalies(baseline, dropped);
    expect(typesOf(events)).toContain("AUTHENTICITY_DROP");
  });

  it("AUTHENTICITY_DROP does NOT fire on a small score change", () => {
    const stable: Snapshot = { ...baseline, authenticityScore: 70 };
    expect(typesOf(detectAnomalies(baseline, stable))).not.toContain("AUTHENTICITY_DROP");
  });

  it("FOLLOWER_SPIKE fires when followers grow past the relative threshold", () => {
    const spiked: Snapshot = { ...baseline, followers: 200_000 };
    const events = detectAnomalies(baseline, spiked);
    expect(typesOf(events)).toContain("FOLLOWER_SPIKE");
  });

  it("FOLLOWER_SPIKE does NOT fire on modest follower growth", () => {
    const stable: Snapshot = { ...baseline, followers: 110_000 };
    expect(typesOf(detectAnomalies(baseline, stable))).not.toContain("FOLLOWER_SPIKE");
  });

  it("relative change on a zero engagement baseline yields no anomaly and no Infinity/NaN", () => {
    const prev: Snapshot = { ...baseline, engagementRate: 0 };
    const curr: Snapshot = { ...baseline, engagementRate: 0.03 };
    const events = detectAnomalies(prev, curr);
    expect(typesOf(events)).not.toContain("ENGAGEMENT_DROP");
    for (const event of events) {
      expect(Number.isFinite(event.delta)).toBe(true);
    }
  });

  it("relative change on a zero follower baseline produces a finite delta (no Infinity/NaN)", () => {
    const prev: Snapshot = { ...baseline, followers: 0 };
    const curr: Snapshot = { ...baseline, followers: 50_000 };
    const events = detectAnomalies(prev, curr);
    const spike = events.find((e) => e.type === "FOLLOWER_SPIKE");
    expect(spike).toBeDefined();
    expect(Number.isFinite(spike!.delta)).toBe(true);
  });

  it("zero follower baseline below the absolute floor does NOT spike", () => {
    const prev: Snapshot = { ...baseline, followers: 0 };
    const curr: Snapshot = { ...baseline, followers: 10 };
    expect(typesOf(detectAnomalies(prev, curr))).not.toContain("FOLLOWER_SPIKE");
  });

  it("every emitted delta is finite across NaN/Infinity inputs", () => {
    const prev: Snapshot = {
      authenticityScore: Number.NaN,
      followers: Number.POSITIVE_INFINITY,
      engagementRate: Number.NaN,
      audienceCountryShares: { US: Number.NaN, GB: 0.5 },
    };
    const curr: Snapshot = {
      authenticityScore: 10,
      followers: 5,
      engagementRate: 0.01,
      audienceCountryShares: { US: 0.9, GB: 0.1 },
    };
    const events = detectAnomalies(prev, curr);
    for (const event of events) {
      expect(Number.isFinite(event.delta)).toBe(true);
    }
  });

  it("severity scales with magnitude (2x threshold -> high)", () => {
    const mild: Snapshot = { ...baseline, authenticityScore: 80 - 16 };
    const severe: Snapshot = { ...baseline, authenticityScore: 80 - 31 };
    const mildEvent = detectAnomalies(baseline, mild).find((e) => e.type === "AUTHENTICITY_DROP");
    const severeEvent = detectAnomalies(baseline, severe).find((e) => e.type === "AUTHENTICITY_DROP");
    expect(mildEvent).toBeDefined();
    expect(severeEvent).toBeDefined();
    expect(mildEvent!.severity).toBe("low");
    expect(severeEvent!.severity).toBe("high");
  });

  it("returns multiple anomalies together when several signals cross", () => {
    const current: Snapshot = {
      at: "snapshot-z",
      authenticityScore: 50,
      followers: 300_000,
      engagementRate: 0.01,
      audienceCountryShares: { US: 0.2, GB: 0.25, CA: 0.55 },
    };
    const events = detectAnomalies(baseline, current);
    const types = typesOf(events);
    expect(types).toContain("GEOGRAPHIC_ANOMALY");
    expect(types).toContain("ENGAGEMENT_DROP");
    expect(types).toContain("AUTHENTICITY_DROP");
    expect(types).toContain("FOLLOWER_SPIKE");
    expect(events.length).toBe(4);
  });

  it("is deterministic: same inputs twice -> deep-equal events", () => {
    const current: Snapshot = {
      authenticityScore: 50,
      followers: 300_000,
      engagementRate: 0.01,
      audienceCountryShares: { US: 0.2, GB: 0.25, CA: 0.55 },
    };
    const a = detectAnomalies(baseline, current);
    const b = detectAnomalies(baseline, current);
    expect(a).toEqual(b);
  });

  it("honors custom thresholds via opts", () => {
    const current: Snapshot = { ...baseline, authenticityScore: 70 };
    expect(typesOf(detectAnomalies(baseline, current))).not.toContain("AUTHENTICITY_DROP");
    const withLooseThreshold = detectAnomalies(baseline, current, { authenticityDropPoints: 5 });
    expect(typesOf(withLooseThreshold)).toContain("AUTHENTICITY_DROP");
  });
});
