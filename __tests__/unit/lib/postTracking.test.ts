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
  AUTO_TRACK_DAYS,
  decidePostTracking,
  dueCutoff,
  effectiveExpiry,
  hoursRemaining,
  isLiveCampaign,
  postCoverage,
  sealSource,
  trackingStopped,
  trackingView,
  type PostTrackingInput,
} from "@/lib/sync/postTracking";
import { TTL_SEAL_SOURCE } from "@/lib/sync/unsealMisfiredTtl";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);
const daysAgo = (d: number) => daysAhead(-d);

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

  /* Number(null) and Number("") are both 0, and 0 is finite, so these once
     reached the clamp and came back as the 1-day floor. Prisma returns null for
     a column nobody set, so that path is the common one, not the exotic one. */
  it("treats null and an empty string as absent, not as zero", () => {
    expect(clampTtlDays(null)).toBe(DEFAULT_POST_TRACKING.defaultTtlDays);
    expect(clampTtlDays(null, 30)).toBe(30);
    expect(clampTtlDays("", 30)).toBe(30);
    expect(clampTtlDays(null, 7)).toBe(7);
  });

  it("still honours an explicit zero, which a caller actually chose", () => {
    expect(clampTtlDays(0, 30)).toBe(1);
  });

  it("gives a tracker with no stored TTL the whole default window", () => {
    const started = new Date("2026-09-15T10:35:00.000Z");
    expect(postTrackingExpiry(started, clampTtlDays(null, 30)).toISOString()).toBe(
      "2026-10-15T10:35:00.000Z",
    );
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
      postTracking: { readCadence: "6hourly", chartGranularity: "nonsense", defaultTtlDays: 900 },
    });
    expect(g.readCadence).toBe("6hourly");
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
    // 6-hourly = 4 reads/day; 30 days = 120. That is the ceiling now that the
    // sub-6h cadences are gone -- it used to be 720 at hourly.
    expect(readsPerTrackedPost({ ...DEFAULT_POST_TRACKING, readCadence: "6hourly" }, 30)).toBe(120);
    expect(readsPerTrackedPost({ ...DEFAULT_POST_TRACKING, readCadence: "12hourly" }, 30)).toBe(60);
    expect(readsPerTrackedPost({ ...DEFAULT_POST_TRACKING, readCadence: "daily" }, 1)).toBe(1);
  });
});

describe("decidePostTracking", () => {
  it("skips a post nobody is tracking", () => {
    expect(decidePostTracking(input({ trackingEnabled: false, trackingExpiresAt: null }))).toEqual({
      action: "skip",
      reason: "not-tracked",
    });
  });

  it("names a post whose tracking was stopped by hand apart from one never tracked", () => {
    expect(decidePostTracking(input({ trackingEnabled: false, trackingExpiresAt: hoursAgo(1) }))).toEqual({
      action: "skip",
      reason: "stopped",
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
    const sixHourly = { ...DEFAULT_POST_TRACKING, readCadence: "6hourly" as const };
    expect(
      decidePostTracking(input({ granularity: sixHourly, lastSyncedAt: hoursAgo(6) })).action,
    ).toBe("sync");
    expect(
      decidePostTracking(input({ granularity: sixHourly, lastSyncedAt: hoursAgo(3) })).action,
    ).toBe("skip");
  });

  it("gives five minutes of grace so an early cron does not defer a whole cycle", () => {
    const sixHourly = { ...DEFAULT_POST_TRACKING, readCadence: "6hourly" as const };
    // 5h40m: twenty minutes early, inside the thirty-minute grace. A read
    // taken late in a previous sweep must not lose its next six-hour slot.
    expect(
      decidePostTracking(input({ granularity: sixHourly, lastSyncedAt: hoursAgo(6 - 20 / 60) })).action,
    ).toBe("sync");
    // 5h15m: forty-five minutes early, genuinely not due.
    expect(
      decidePostTracking(input({ granularity: sixHourly, lastSyncedAt: hoursAgo(6 - 45 / 60) })).action,
    ).toBe("skip");
  });

  it("throttles on the last ATTEMPT, not only the last success", () => {
    // Never measured, but asked ten minutes ago: must not be retried this run.
    const decision = decidePostTracking(
      input({ lastSyncedAt: null, lastAttemptAt: hoursAgo(10 / 60) }),
    );
    expect(decision.action).toBe("skip");
  });

  it("reads a year-old post with a live tracker until it has a reading of its own", () => {
    const decision = decidePostTracking(
      input({ postedAt: daysAgo(400), trackingStartedAt: hoursAgo(48), lastSyncedAt: hoursAgo(72) }),
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

  /* The outage this file did not catch. "Does not seal on sight" above starts
     tracking an hour ago, which survives even a one-day window, so a null TTL
     collapsing to one day was invisible here while it retired the entire
     tracked pool on prod. A null TTL must mean the org default, and the only
     test that proves it is one where a one-day window would already have
     closed. */
  it("gives a null TTL the org default, not the one-day floor", () => {
    const started = hoursAgo(48);
    expect(effectiveExpiry(input({ trackingExpiresAt: null, trackingTtlDays: null, trackingStartedAt: started })).toISOString())
      .toBe(new Date(started.getTime() + DEFAULT_POST_TRACKING.defaultTtlDays * 86_400_000).toISOString());
    expect(
      decidePostTracking(
        input({ trackingExpiresAt: null, trackingTtlDays: null, trackingStartedAt: started }),
      ).action,
    ).not.toBe("seal");
  });

  it("honours a smaller org default for a null TTL", () => {
    const decision = decidePostTracking(
      input({
        trackingExpiresAt: null,
        trackingTtlDays: null,
        trackingStartedAt: hoursAgo(48),
        granularity: { ...DEFAULT_POST_TRACKING, defaultTtlDays: 1 },
      }),
    );
    expect(decision).toEqual({ action: "seal", reason: "ttl-expired" });
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

describe("a post its creator hid", () => {
  const twelveHourly: PostTrackingInput["granularity"] = { ...DEFAULT_POST_TRACKING, readCadence: "12hourly" };
  const hidden = (hoursSinceAsked: number, granularity = twelveHourly) =>
    decidePostTracking(
      input({ lastSyncedAt: hoursAgo(72), lastAttemptAt: hoursAgo(hoursSinceAsked), lastReason: "post-hidden", granularity }),
    );

  it("is asked again once a day, not at the org's 12-hourly cadence", () => {
    expect(hidden(13)).toEqual({ action: "skip", reason: "hidden-throttle" });
    expect(hidden(24)).toEqual({ action: "sync", reason: "hidden-recheck" });
  });

  it("never waits longer than a slower cadence already would", () => {
    const daily: PostTrackingInput["granularity"] = { ...DEFAULT_POST_TRACKING, readCadence: "daily" };
    expect(hidden(24, daily)).toEqual({ action: "sync", reason: "cadence-daily" });
  });

  it("does the same for an answer about the account, even on a post in its first week", () => {
    const young = (lastReason: string, hoursSinceAsked: number) =>
      decidePostTracking(
        input({
          trackingEnabled: false,
          trackingStartedAt: null,
          trackingExpiresAt: null,
          postedAt: hoursAgo(48),
          lastSyncedAt: null,
          lastAttemptAt: hoursAgo(hoursSinceAsked),
          lastReason,
        }),
      );
    for (const reason of ["not-a-professional-account", "not-on-account", "credentials-rejected"]) {
      expect(young(reason, 7)).toEqual({ action: "skip", reason: "answered-throttle" });
      expect(young(reason, 24)).toEqual({ action: "sync", reason: "answered-recheck" });
    }
    /* A refusal is about the moment, and keeps the post's own cadence. */
    expect(young("platform-refused", 7)).toEqual({ action: "sync", reason: "cadence-new-post-6hourly" });
  });

  it("changes nothing for any other reason", () => {
    const refused = decidePostTracking(
      input({ lastSyncedAt: hoursAgo(72), lastAttemptAt: hoursAgo(13), lastReason: "platform-refused", granularity: twelveHourly }),
    );
    expect(refused).toEqual({ action: "sync", reason: "cadence-12hourly" });
  });

  it("still seals when the tracker expires", () => {
    expect(
      decidePostTracking(input({ lastReason: "post-hidden", trackingExpiresAt: hoursAgo(1), granularity: twelveHourly })),
    ).toMatchObject({ action: "seal" });
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Coverage: the reasons a post is read without anyone switching a tracker on.
 *
 * Production, 2026-10-03: 0 of the 154 posts in the 9 IN_PROGRESS campaigns had
 * a tracker, and 9 of the 752 readable posts published in the last 30 days did.
 * One COMPLETE campaign's 121 Instagram posts had gone up that morning. All of
 * them moved only when someone pressed Refresh Data.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("postCoverage", () => {
  const untracked = (over: Partial<PostTrackingInput> = {}) =>
    input({
      trackingEnabled: false,
      trackingStartedAt: null,
      trackingExpiresAt: null,
      trackingTtlDays: null,
      ...over,
    });

  it("reads every post in its first month, whatever its campaign says", () => {
    /* A COMPLETE campaign is campaignLive false. */
    const c = postCoverage(untracked({ postedAt: hoursAgo(5), campaignLive: false }));
    expect(c).toMatchObject({ covered: true, source: "new-post", cadence: "6hourly" });
  });

  it("reads 6-hourly for the first week and daily after", () => {
    expect(postCoverage(untracked({ postedAt: daysAgo(6.9) }))).toMatchObject({ cadence: "6hourly" });
    expect(postCoverage(untracked({ postedAt: daysAgo(7) }))).toMatchObject({ cadence: "daily" });
    expect(postCoverage(untracked({ postedAt: daysAgo(29.9) }))).toMatchObject({ cadence: "daily" });
  });

  it("lets go of an untracked post at the end of its first month, without sealing it", () => {
    expect(postCoverage(untracked({ postedAt: daysAgo(AUTO_TRACK_DAYS) }))).toEqual({
      covered: false,
      reason: "not-tracked",
    });
    expect(decidePostTracking(untracked({ postedAt: daysAgo(AUTO_TRACK_DAYS), lastSyncedAt: daysAgo(3) }))).toEqual({
      action: "skip",
      reason: "not-tracked",
    });
  });

  it("says when the automatic window ends", () => {
    const posted = daysAgo(10);
    const c = postCoverage(untracked({ postedAt: posted }));
    expect(c.covered && c.expiresAt?.toISOString()).toBe(
      new Date(posted.getTime() + AUTO_TRACK_DAYS * 86_400_000).toISOString(),
    );
  });

  it("reads a running campaign's posts at the org cadence, with no end date", () => {
    const c = postCoverage(untracked({ postedAt: daysAgo(90), campaignLive: true }));
    expect(c).toEqual({
      covered: true,
      source: "campaign",
      expiresAt: null,
      cadence: DEFAULT_POST_TRACKING.readCadence,
      cadenceSource: "campaign",
      sealsOnNextRead: false,
    });
  });

  it("does not read a running campaign's posts past 180 days old", () => {
    expect(postCoverage(untracked({ postedAt: daysAgo(181), campaignLive: true }))).toMatchObject({
      covered: false,
    });
  });

  it("takes the fastest cadence among the reasons that apply", () => {
    /* Live campaign at 12-hourly, but two days old: the first-week cadence wins. */
    const c = postCoverage(untracked({ postedAt: daysAgo(2), campaignLive: true }));
    expect(c).toMatchObject({ source: "campaign", cadence: "6hourly", cadenceSource: "new-post" });
    expect(decidePostTracking(untracked({ postedAt: daysAgo(2), campaignLive: true, lastSyncedAt: hoursAgo(6) }))).toEqual({
      action: "sync",
      reason: "cadence-new-post-6hourly",
    });
  });

  it("names the reason that lasts longest", () => {
    /* A tracker that ends in 10 days on a post whose first month ends in 25. */
    const c = postCoverage(input({ postedAt: daysAgo(5), trackingExpiresAt: daysAhead(10) }));
    expect(c).toMatchObject({ source: "new-post" });
    const later = postCoverage(input({ postedAt: daysAgo(25), trackingExpiresAt: daysAhead(10) }));
    expect(later).toMatchObject({ source: "tracker", cadenceSource: "tracker" });
  });

  it("is switched off by Stop, on a young post and in a running campaign alike", () => {
    const stopped = { trackingEnabled: false, trackingExpiresAt: hoursAgo(3) };
    expect(postCoverage(untracked({ ...stopped, postedAt: hoursAgo(5) }))).toEqual({ covered: false, reason: "stopped" });
    expect(postCoverage(untracked({ ...stopped, postedAt: daysAgo(40), campaignLive: true }))).toEqual({
      covered: false,
      reason: "stopped",
    });
  });

  it("never covers a sealed or dead-lettered post, however young", () => {
    expect(postCoverage(untracked({ postedAt: hoursAgo(1), hasFinalSnapshot: true }))).toEqual({ covered: false, reason: "sealed" });
    expect(postCoverage(untracked({ postedAt: hoursAgo(1), syncDisabledAt: hoursAgo(1) }))).toEqual({
      covered: false,
      reason: "dead-letter",
    });
  });

  it("does not seal an expired tracker while the post is still in its first month", () => {
    const d = decidePostTracking(input({ postedAt: daysAgo(10), trackingExpiresAt: hoursAgo(1), lastSyncedAt: daysAgo(2) }));
    expect(d).toEqual({ action: "sync", reason: "cadence-new-post-daily" });
  });

  it("does not seal an expired tracker while its campaign runs", () => {
    const d = decidePostTracking(
      input({ postedAt: daysAgo(60), campaignLive: true, trackingExpiresAt: hoursAgo(1), lastSyncedAt: hoursAgo(13) }),
    );
    expect(d).toEqual({ action: "sync", reason: "cadence-campaign-12hourly" });
  });

  it("seals the expired tracker once nothing else covers the post", () => {
    expect(decidePostTracking(input({ postedAt: daysAgo(31), trackingExpiresAt: hoursAgo(1) }))).toEqual({
      action: "seal",
      reason: "ttl-expired",
    });
  });
});

describe("the 180-day seal", () => {
  /* Measured 2026-10-03: 10,918 tracked TikTok posts over 180 days old, none
     sealed, each one a read on every cycle. The rule lived only in
     lib/sync/cadence.ts, which the cron stopped calling on 2026-09-09. */
  const old = (over: Partial<PostTrackingInput> = {}) =>
    input({ postedAt: daysAgo(400), trackingStartedAt: daysAgo(18), trackingExpiresAt: daysAhead(12), ...over });

  it("reads an old post once its tracker starts, then seals it on that reading", () => {
    expect(decidePostTracking(old({ lastSyncedAt: daysAgo(30) })).action).toBe("sync");
    expect(decidePostTracking(old({ lastSyncedAt: daysAgo(2) }))).toEqual({ action: "seal", reason: "age-over-180d" });
  });

  it("seals on the reading even when it is not due again", () => {
    expect(decidePostTracking(old({ lastSyncedAt: hoursAgo(1) }))).toEqual({ action: "seal", reason: "age-over-180d" });
  });

  it("treats a tracker with no start as begun before any reading", () => {
    expect(decidePostTracking(old({ trackingStartedAt: null, lastSyncedAt: daysAgo(30) })).action).toBe("seal");
    expect(decidePostTracking(old({ trackingStartedAt: null, lastSyncedAt: null })).action).toBe("sync");
  });

  it("leaves a running campaign's old posts on their tracker", () => {
    expect(decidePostTracking(old({ campaignLive: true, lastSyncedAt: daysAgo(2) })).action).toBe("sync");
  });

  it("does not touch a post at 180 days, only past it", () => {
    expect(decidePostTracking(old({ postedAt: daysAgo(179), lastSyncedAt: daysAgo(2) })).action).toBe("sync");
  });

  it("seals under its own source, which the TTL unseal repair does not match", () => {
    expect(sealSource("age-over-180d")).toBe("cron-seal-age");
    expect(sealSource("ttl-expired")).toBe(TTL_SEAL_SOURCE);
    expect(sealSource("age-over-180d")).not.toBe(TTL_SEAL_SOURCE);
  });
});

describe("coverage helpers", () => {
  it("treats only IN_PROGRESS and PENDING campaigns that are not archived or deleted as live", () => {
    expect(isLiveCampaign({ status: "IN_PROGRESS", archived: false })).toBe(true);
    expect(isLiveCampaign({ status: "PENDING", archived: false })).toBe(true);
    expect(isLiveCampaign({ status: "COMPLETE", archived: false })).toBe(false);
    expect(isLiveCampaign({ status: "IN_PROGRESS", archived: true })).toBe(false);
    expect(isLiveCampaign({ status: "IN_PROGRESS", archived: false, deletedAt: NOW })).toBe(false);
    expect(isLiveCampaign(null)).toBe(false);
  });

  it("tells stopped from never tracked by the expiry Stop writes", () => {
    expect(trackingStopped({ trackingEnabled: false, trackingExpiresAt: NOW })).toBe(true);
    expect(trackingStopped({ trackingEnabled: false, trackingExpiresAt: null })).toBe(false);
    expect(trackingStopped({ trackingEnabled: true, trackingExpiresAt: NOW })).toBe(false);
  });

  it("puts the due cutoff one cadence, less the grace, in the past", () => {
    expect(dueCutoff(NOW, "6hourly").toISOString()).toBe(hoursAgo(5.5).toISOString());
    expect(dueCutoff(NOW, "daily").toISOString()).toBe(hoursAgo(23.5).toISOString());
  });
});

describe("trackingView -- what the badges say", () => {
  it("calls an automatically read post tracked, and says why", () => {
    const v = trackingView(
      input({ trackingEnabled: false, trackingStartedAt: null, trackingExpiresAt: null, trackingTtlDays: null, postedAt: daysAgo(2) }),
    );
    expect(v).toEqual({
      trackingEnabled: true,
      trackingExpiresAt: daysAhead(AUTO_TRACK_DAYS - 2),
      trackingSource: "new-post",
      readCadence: "6hourly",
    });
  });

  it("calls a tracker whose window closed not tracked, before the seal lands", () => {
    expect(trackingView(input({ postedAt: daysAgo(60), trackingExpiresAt: hoursAgo(1) }))).toMatchObject({
      trackingEnabled: false,
      trackingSource: null,
    });
  });

  it("says an old post's tracker reads once more and stops", () => {
    expect(trackingView(input({ postedAt: daysAgo(400), lastSyncedAt: daysAgo(40) }))).toMatchObject({
      trackingEnabled: true,
      trackingSource: "final-read",
    });
    expect(trackingView(input({ postedAt: daysAgo(400), lastSyncedAt: hoursAgo(1) })).trackingEnabled).toBe(false);
  });

  it("calls a stopped post not tracked, even in its first days", () => {
    expect(
      trackingView(input({ trackingEnabled: false, trackingExpiresAt: hoursAgo(1), postedAt: hoursAgo(5) })).trackingEnabled,
    ).toBe(false);
  });
});
