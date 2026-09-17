import { DEFAULT_POST_TRACKING } from "@/lib/trackers/granularity";
import type { PostTrackingInput } from "@/lib/sync/postTracking";
import {
  TTL_SEAL_SOURCE,
  UNSEAL_CHUNK,
  chunk,
  sealedInError,
} from "@/lib/sync/unsealMisfiredTtl";

const NOW = new Date("2026-09-17T06:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

function tracking(over: Partial<PostTrackingInput> = {}): PostTrackingInput {
  return {
    trackingEnabled: false,
    trackingStartedAt: hoursAgo(48),
    trackingExpiresAt: null,
    trackingTtlDays: null,
    lastSyncedAt: hoursAgo(1),
    lastAttemptAt: null,
    syncDisabledAt: null,
    hasFinalSnapshot: false,
    granularity: DEFAULT_POST_TRACKING,
    now: NOW,
    ...over,
  };
}

describe("sealedInError", () => {
  it("restores the exact shape the misfire produced: a null TTL sealed early", () => {
    expect(sealedInError({ sealSources: [TTL_SEAL_SOURCE], tracking: tracking() })).toBe(true);
  });

  it("leaves a seal whose window really had closed", () => {
    expect(
      sealedInError({
        sealSources: [TTL_SEAL_SOURCE],
        tracking: tracking({ trackingExpiresAt: hoursAgo(1) }),
      }),
    ).toBe(false);
  });

  it("leaves a tracker whose own org default had genuinely run out", () => {
    expect(
      sealedInError({
        sealSources: [TTL_SEAL_SOURCE],
        tracking: tracking({ granularity: { ...DEFAULT_POST_TRACKING, defaultTtlDays: 1 } }),
      }),
    ).toBe(false);
  });

  it("ignores the older age-based seal, which is a different fault", () => {
    expect(sealedInError({ sealSources: ["cron-seal"], tracking: tracking() })).toBe(false);
    expect(sealedInError({ sealSources: [], tracking: tracking() })).toBe(false);
  });

  it("still selects a post carrying both seal sources", () => {
    expect(
      sealedInError({ sealSources: ["cron-seal", TTL_SEAL_SOURCE], tracking: tracking() }),
    ).toBe(true);
  });

  /* hasFinalSnapshot is what the seal set. Consulting it would make every
     sealed post ineligible and the repair a no-op. */
  it("does not let the seal it is undoing decide the answer", () => {
    expect(
      sealedInError({ sealSources: [TTL_SEAL_SOURCE], tracking: tracking({ hasFinalSnapshot: true }) }),
    ).toBe(true);
  });

  it("honours an explicit TTL rather than assuming the default", () => {
    expect(
      sealedInError({ sealSources: [TTL_SEAL_SOURCE], tracking: tracking({ trackingTtlDays: 1 }) }),
    ).toBe(false);
    expect(
      sealedInError({ sealSources: [TTL_SEAL_SOURCE], tracking: tracking({ trackingTtlDays: 7 }) }),
    ).toBe(true);
  });
});

describe("chunk", () => {
  it("splits into bounded groups and loses nothing", () => {
    const items = Array.from({ length: 450 }, (_, i) => i);
    const groups = chunk(items);
    expect(groups.map((g) => g.length)).toEqual([UNSEAL_CHUNK, UNSEAL_CHUNK, 50]);
    expect(groups.flat()).toEqual(items);
  });

  it("returns nothing for an empty list, so the repair writes nothing", () => {
    expect(chunk([])).toEqual([]);
  });
});
