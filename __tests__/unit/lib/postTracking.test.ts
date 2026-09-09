import {
  DEFAULT_POST_TRACKING,
  POST_TTL_MAX_DAYS,
  POST_TTL_MIN_DAYS,
  clampTtlDays,
  parsePostTracking,
  postTrackingExpiry,
  readsPerTrackedPost,
} from "@/lib/trackers/granularity";
import {
  decidePostTracking,
  effectiveExpiry,
  hoursRemaining,
  type PostTrackingInput,
} from "@/lib/sync/postTracking";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

function input(over: Partial<PostTrackingInput> = {}): PostTrackingInput {
  return {
    trackingEnabled: true,
    trackingStartedAt: hoursAgo(24),
    trackingExpiresAt: daysAhead(10),
    trackingTtlDays: 30,
    lastSyncedAt: hoursAgo(1),
    lastAttemptAt: null,
    syncDisabledAt: null,
    hasFinalSnapshot: false,
    granularity: DEFAULT_POST_TRACKING,
    now: NOW,
    ...over,
  };
}

describe("post tracking TTL bounds", () => {
  it("offers exactly 1 to 30 days", () => {
    expect(POST_TTL_MIN_DAYS).toBe(1);
    expect(POST_TTL_MAX_DAYS).toBe(30);
  });

  it("clamps anything outside the bounds rather than refusing it", () => {
    expect(clampTtlDays(0)).toBe(1);
    expect(clampTtlDays(-5)).toBe(1);
    expect(clampTtlDays(90)).toBe(30);
    expect(clampTtlDays(7)).toBe(7);
    expect(clampTtlDays(7.4)).toBe(7);
  });

  it("falls back to the default, never to zero, for a non-number", () => {
    expect(clampTtlDays(undefined)).toBe(DEFAULT_POST_TRACKING.defaultTtlDays);
    expect(clampTtlDays("soon")).toBe(DEFAULT_POST_TRACKING.defaultTtlDays);
    expect(clampTtlDays(NaN, 5)).toBe(5);
  });

  it("computes an expiry a whole number of days out", () => {
    expect(postTrackingExpiry(NOW, 3).toISOString()).toBe("2026-09-12T12:00:00.000Z");
  });
});

describe("parsePostTracking", () => {
  it("defaults when the org has said nothing", () => {
    expect(parsePostTracking(null)).toEqual(DEFAULT_POST_TRACKING);
    expect(parsePostTracking({})).toEqual(DEFAULT_POST_TRACKING);
  });

  it("keeps the good fields when one is garbage", () => {
    const g = parsePostTracking({
      postTracking: { readCadence: "hourly", chartGranularity: "nonsense", defaultTtlDays: 900 },
    });
    expect(g.readCadence).toBe("hourly");
    expect(g.chartGranularity).toBe(DEFAULT_POST_TRACKING.chartGranularity);
    // Out of bounds is not clamped on read — it is rejected, so an edited blob
    // cannot quietly buy a 900-day tracker.
    expect(g.defaultTtlDays).toBe(DEFAULT_POST_TRACKING.defaultTtlDays);
  });

  it("does not read the sound/creator tracker block", () => {
    const g = parsePostTracking({ trackers: { readCadence: "hourly" } });
    expect(g.readCadence).toBe(DEFAULT_POST_TRACKING.readCadence);
  });

  it("states the per-post read ceiling", () => {
    // 4-hourly = 6 reads/day; 30 days = 180.
    expect(readsPerTrackedPost({ ...DEFAULT_POST_TRACKING, readCadence: "4hourly" }, 30)).toBe(180);
    expect(readsPerTrackedPost({ ...DEFAULT_POST_TRACKING, readCadence: "hourly" }, 30)).toBe(720);
    expect(readsPerTrackedPost({ ...DEFAULT_POST_TRACKING, readCadence: "daily" }, 1)).toBe(1);
  });
});

describe("decidePostTracking", () => {
  it("skips a post nobody is tracking", () => {
    expect(decidePostTracking(input({ trackingEnabled: false }))).toEqual({
      action: "skip",
      reason: "not-tracked",
    });
  });

  it("skips a dead-lettered post before anything else", () => {
    expect(
      decidePostTracking(input({ syncDisabledAt: hoursAgo(2), trackingExpiresAt: hoursAgo(1) })),
    ).toEqual({ action: "skip", reason: "dead-letter" });
  });

  it("never re-decides a sealed post", () => {
    expect(decidePostTracking(input({ hasFinalSnapshot: true }))).toEqual({
      action: "skip",
      reason: "sealed",
    });
  });

  it("seals as soon as the TTL closes", () => {
    expect(decidePostTracking(input({ trackingExpiresAt: hoursAgo(0.1) }))).toEqual({
      action: "seal",
      reason: "ttl-expired",
    });
  });

  it("seals on the exact boundary, not a moment later", () => {
    expect(decidePostTracking(input({ trackingExpiresAt: NOW })).action).toBe("seal");
  });

  it("checks expiry before cadence, so a lapsed window seals even when throttled", () => {
    const decision = decidePostTracking(
      input({ trackingExpiresAt: hoursAgo(1), lastSyncedAt: hoursAgo(0.1) }),
    );
    expect(decision.action).toBe("seal");
  });

  it("reads a never-read tracker immediately", () => {
    expect(decidePostTracking(input({ lastSyncedAt: null, lastAttemptAt: null }))).toEqual({
      action: "sync",
      reason: "never-read",
    });
  });

  it("honours the org read cadence", () => {
    const fourHourly = { ...DEFAULT_POST_TRACKING, readCadence: "4hourly" as const };
    expect(
      decidePostTracking(input({ granularity: fourHourly, lastSyncedAt: hoursAgo(4) })).action,
    ).toBe("sync");
    expect(
      decidePostTracking(input({ granularity: fourHourly, lastSyncedAt: hoursAgo(2) })).action,
    ).toBe("skip");
  });

  it("gives five minutes of grace so an early cron does not defer a whole cycle", () => {
    const hourly = { ...DEFAULT_POST_TRACKING, readCadence: "hourly" as const };
    // 56 minutes: inside the hour, but within grace.
    expect(
      decidePostTracking(input({ granularity: hourly, lastSyncedAt: hoursAgo(56 / 60) })).action,
    ).toBe("sync");
    // 50 minutes: genuinely early.
    expect(
      decidePostTracking(input({ granularity: hourly, lastSyncedAt: hoursAgo(50 / 60) })).action,
    ).toBe("skip");
  });

  it("throttles on the last ATTEMPT, not only the last success", () => {
    // Never measured, but asked ten minutes ago: must not be retried this run.
    const decision = decidePostTracking(
      input({ lastSyncedAt: null, lastAttemptAt: hoursAgo(10 / 60) }),
    );
    expect(decision.action).toBe("skip");
  });

  it("ignores post age entirely — a year-old post with a live tracker is read", () => {
    const decision = decidePostTracking(
      input({ trackingStartedAt: hoursAgo(400 * 24), lastSyncedAt: hoursAgo(24) }),
    );
    expect(decision.action).toBe("sync");
  });
});

describe("effectiveExpiry — rows written before the column existed", () => {
  it("does not seal a null expiry on sight", () => {
    const decision = decidePostTracking(
      input({ trackingExpiresAt: null, trackingTtlDays: null, trackingStartedAt: hoursAgo(1) }),
    );
    expect(decision.action).not.toBe("seal");
  });

  it("dates the window from when tracking started", () => {
    const at = effectiveExpiry(
      input({ trackingExpiresAt: null, trackingTtlDays: 2, trackingStartedAt: hoursAgo(24) }),
    );
    expect(at.toISOString()).toBe("2026-09-10T12:00:00.000Z");
  });

  it("seals a legacy row whose implied window has already closed", () => {
    const decision = decidePostTracking(
      input({ trackingExpiresAt: null, trackingTtlDays: 1, trackingStartedAt: hoursAgo(48) }),
    );
    expect(decision).toEqual({ action: "seal", reason: "ttl-expired" });
  });

  it("gives a tracker with neither timestamp a full window rather than none", () => {
    const decision = decidePostTracking(
      input({ trackingExpiresAt: null, trackingStartedAt: null, trackingTtlDays: null }),
    );
    expect(decision.action).not.toBe("seal");
  });
});

describe("hoursRemaining", () => {
  it("counts down to the expiry", () => {
    expect(hoursRemaining(input({ trackingExpiresAt: daysAhead(1) }))).toBe(24);
  });

  it("floors at zero rather than going negative", () => {
    expect(hoursRemaining(input({ trackingExpiresAt: hoursAgo(5) }))).toBe(0);
  });
});
