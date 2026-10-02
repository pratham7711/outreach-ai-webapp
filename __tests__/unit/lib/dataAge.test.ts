/**
 * @jest-environment node
 *
 * lib/dataAge: how old a figure is, and when that is too old (plan §13 A2·A6).
 * The cadences are cross-checked against the code that schedules each read, so
 * a change there that this table does not follow fails here rather than
 * quietly mislabelling every number on screen.
 */
jest.mock("@/lib/db", () => ({ db: {} }));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));
jest.mock("@/lib/creators/avatarStore", () => ({ captureLatestAvatar: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn() }));

import {
  AGE_TARGET_HOURS,
  FUTURE_TOLERANCE_MS,
  STALE_MULTIPLIER,
  ageMs,
  asOfCell,
  dataAsOf,
  dataAsOfLine,
  formatAge,
  formatAsOf,
  freshnessCell,
  isStale,
  staleAfter,
  targetHours,
} from "@/lib/dataAge";
import { PROFILE_REFRESH_MS } from "@/lib/creators/profileRefresh";
import { decideSyncAction } from "@/lib/sync/cadence";
import { DEFAULT_GRANULARITY, READ_CADENCE_HOURS } from "@/lib/trackers/granularity";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-02T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("formatAge", () => {
  it.each([
    [0, "Just now"],
    [59_999, "Just now"],
    [60_000, "1m ago"],
    [59 * 60_000, "59m ago"],
    [HOUR, "1h ago"],
    [23 * HOUR + 59 * 60_000, "23h ago"],
    [24 * HOUR, "1d ago"],
    [3 * 24 * HOUR, "3d ago"],
  ])("words %d ms as %s", (ms, words) => {
    expect(formatAge(ago(ms), NOW)).toBe(words);
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(formatAge(ago(2 * HOUR).toISOString(), NOW)).toBe("2h ago");
  });

  it("gives no age for a missing or unparseable time", () => {
    expect(formatAge(null, NOW)).toBeNull();
    expect(formatAge(undefined, NOW)).toBeNull();
    expect(formatAge("", NOW)).toBeNull();
    expect(formatAge("not a date", NOW)).toBeNull();
  });

  it("reads a little clock skew as just now, and a real future time as no age", () => {
    expect(formatAge(new Date(NOW.getTime() + 60_000), NOW)).toBe("Just now");
    expect(formatAge(new Date(NOW.getTime() + FUTURE_TOLERANCE_MS), NOW)).toBe("Just now");
    expect(formatAge(new Date(NOW.getTime() + FUTURE_TOLERANCE_MS + 1), NOW)).toBeNull();
    expect(ageMs(new Date(NOW.getTime() + 60_000), NOW)).toBe(0);
  });
});

describe("staleAfter / isStale", () => {
  it("is twice the target for every kind of figure", () => {
    expect(STALE_MULTIPLIER).toBe(2);
    expect(staleAfter("profile", {}, NOW)).toBe(48 * HOUR);
    expect(staleAfter("account", {}, NOW)).toBe(48 * HOUR);
    expect(staleAfter("topPosts", {}, NOW)).toBe(48 * HOUR);
  });

  it("goes stale strictly past twice the target, not at it", () => {
    expect(isStale(ago(48 * HOUR), "profile", {}, NOW)).toBe(false);
    expect(isStale(ago(48 * HOUR + 1), "profile", {}, NOW)).toBe(true);
  });

  it("never calls a figure with no time stale -- it is unread, not late", () => {
    expect(isStale(null, "profile", {}, NOW)).toBe(false);
    expect(isStale(new Date(NOW.getTime() + 2 * HOUR), "profile", {}, NOW)).toBe(false);
  });

  it("reads trackers and sounds at the org's cadence, else the default", () => {
    expect(targetHours("tracker", { cadenceHours: 6 }, NOW)).toBe(6);
    expect(targetHours("sound", { cadenceHours: 24 }, NOW)).toBe(24);
    expect(targetHours("tracker", {}, NOW)).toBe(READ_CADENCE_HOURS[DEFAULT_GRANULARITY.readCadence]);
    expect(targetHours("tracker", { cadenceHours: 0 }, NOW)).toBe(READ_CADENCE_HOURS[DEFAULT_GRANULARITY.readCadence]);
    expect(isStale(ago(13 * HOUR), "tracker", { cadenceHours: 6 }, NOW)).toBe(true);
    expect(isStale(ago(13 * HOUR), "tracker", { cadenceHours: 12 }, NOW)).toBe(false);
  });

  it("reads a young post six-hourly and an older one daily", () => {
    expect(targetHours("post", { postedAt: ago(2 * 24 * HOUR) }, NOW)).toBe(6);
    expect(targetHours("post", { postedAt: ago(8 * 24 * HOUR) }, NOW)).toBe(24);
    // Unknown publish date: the slower rung, so an unknown never raises a chip.
    expect(targetHours("post", {}, NOW)).toBe(24);
    expect(isStale(ago(13 * HOUR), "post", { postedAt: ago(2 * 24 * HOUR) }, NOW)).toBe(true);
    expect(isStale(ago(13 * HOUR), "post", { postedAt: ago(30 * 24 * HOUR) }, NOW)).toBe(false);
  });

  it("never calls a post that nothing reads any more stale", () => {
    expect(targetHours("post", { tracked: false }, NOW)).toBeNull();
    expect(staleAfter("post", { tracked: false }, NOW)).toBeNull();
    expect(isStale(ago(400 * 24 * HOUR), "post", { tracked: false }, NOW)).toBe(false);
  });
});

/* The table is only honest while it matches the schedulers. */
describe("targets match the code that schedules each read", () => {
  it("profile: the roster refresh's own interval", () => {
    expect(AGE_TARGET_HOURS.profile * HOUR).toBe(PROFILE_REFRESH_MS);
  });

  const decide = (postedAgoH: number, syncedAgoH: number) =>
    decideSyncAction({
      now: NOW,
      postedAt: ago(postedAgoH * HOUR),
      lastSyncedAt: ago(syncedAgoH * HOUR),
      lastAttemptAt: null,
      syncDisabledAt: null,
      hasFinalSnapshot: false,
      trackingEnabled: false,
      trackingStartedAt: null,
      settlementClosesAt: null,
    } as Parameters<typeof decideSyncAction>[0]).action;

  it("post, first week: due again once six hours have passed", () => {
    expect(decide(3 * 24, AGE_TARGET_HOURS.postFirstWeek - 0.1)).toBe("skip");
    expect(decide(3 * 24, AGE_TARGET_HOURS.postFirstWeek)).toBe("sync");
  });

  it("post, after the first week: due again once a day has passed", () => {
    expect(decide(30 * 24, AGE_TARGET_HOURS.postAfterFirstWeek - 0.1)).toBe("skip");
    expect(decide(30 * 24, AGE_TARGET_HOURS.postAfterFirstWeek)).toBe("sync");
  });
});

describe("Data as of", () => {
  it("is the newest valid reading, ignoring missing and future times", () => {
    const newest = ago(HOUR);
    expect(dataAsOf([ago(5 * HOUR), null, newest, undefined, "junk", new Date(NOW.getTime() + 10 * HOUR)], NOW)).toEqual(newest);
    expect(dataAsOf([null, undefined], NOW)).toBeNull();
    expect(dataAsOf([], NOW)).toBeNull();
  });

  it("words the line with an absolute UTC time, or says nothing was read", () => {
    expect(dataAsOfLine(new Date("2026-10-02T14:05:00Z"))).toBe("Data as of 2 Oct 2026, 14:05 UTC");
    expect(dataAsOfLine(null)).toBe("Data as of: no readings yet");
    expect(formatAsOf(null)).toBe("—");
  });

  it("writes an export's As of as ISO 8601, or — when nothing was read", () => {
    expect(asOfCell(new Date("2026-10-02T14:05:00Z"))).toBe("2026-10-02T14:05:00.000Z");
    expect(asOfCell(null)).toBe("—");
    expect(asOfCell("junk")).toBe("—");
  });

  it("calls a figure Current, Stale or Not read for an export", () => {
    expect(freshnessCell(ago(HOUR), "profile", {}, NOW)).toBe("Current");
    expect(freshnessCell(ago(49 * HOUR), "profile", {}, NOW)).toBe("Stale");
    expect(freshnessCell(null, "profile", {}, NOW)).toBe("Not read");
  });
});
