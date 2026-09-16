import {
  CANARY_TRACKING_EXPIRES_AT,
  STALE_AFTER_READS,
  canaryVerdict,
  metricsCarried,
  movedAcross,
} from "@/lib/health/canary";
import { decidePostTracking } from "@/lib/sync/postTracking";
import { DEFAULT_POST_TRACKING } from "@/lib/trackers/granularity";

const now = new Date("2026-09-17T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

describe("canaryVerdict", () => {
  it("separates 'never provisioned' from 'provisioned and never read'", () => {
    /* The two look identical on a dashboard that only counts snapshots, and
       they need different people: one is a setup step, the other is a reader. */
    expect(canaryVerdict({ exists: false, lastReadAt: null, now, staleAfterHours: 24 })).toBe(
      "missing",
    );
    expect(canaryVerdict({ exists: true, lastReadAt: null, now, staleAfterHours: 24 })).toBe(
      "never-read",
    );
  });

  it("tolerates one missed read and reports the second", () => {
    const staleAfterHours = 12 * STALE_AFTER_READS;
    expect(
      canaryVerdict({ exists: true, lastReadAt: hoursAgo(13), now, staleAfterHours }),
    ).toBe("ok");
    expect(
      canaryVerdict({ exists: true, lastReadAt: hoursAgo(25), now, staleAfterHours }),
    ).toBe("stale");
  });
});

describe("metricsCarried", () => {
  it("does not count a zero as a reading", () => {
    /* Every counter column defaults to 0, so "shares: 0" and "shares were never
       fetched" are the same row -- which is how Instagram looked healthy for ten
       days while returning likes and nothing else. */
    expect(
      metricsCarried({
        viewsCount: 0,
        likesCount: 120,
        commentsCount: 4,
        sharesCount: 0,
        savesCount: 0,
      }),
    ).toEqual(["likes", "comments"]);
  });

  it("says nothing at all about a canary with no snapshot", () => {
    expect(metricsCarried(null)).toEqual([]);
  });
});

describe("movedAcross", () => {
  it("withholds a verdict until there are two readings", () => {
    expect(movedAcross([])).toBeNull();
    expect(movedAcross([{ viewsCount: 10 }])).toBeNull();
  });

  it("flags a reader that keeps handing back the same numbers", () => {
    const flat = [{ viewsCount: 10, likesCount: 2 }, { viewsCount: 10, likesCount: 2 }];
    expect(movedAcross(flat)).toBe(false);
    expect(movedAcross([{ viewsCount: 11, likesCount: 2 }, ...flat])).toBe(true);
  });
});

describe("the canary's tracking window", () => {
  it("never seals, where a default tracker would have", () => {
    /* The point of the constant. A canary provisioned today and read every
       twelve hours must still be read in five years; a normal tracker gets at
       most 30 days and then seals itself, which would retire the health check
       exactly the way the Instagram outage went unnoticed. */
    const input = {
      trackingEnabled: true,
      trackingStartedAt: new Date("2026-09-17T00:00:00.000Z"),
      trackingExpiresAt: CANARY_TRACKING_EXPIRES_AT,
      trackingTtlDays: null,
      lastSyncedAt: null,
      syncDisabledAt: null,
      hasFinalSnapshot: false,
      granularity: DEFAULT_POST_TRACKING,
      now: new Date("2031-01-01T00:00:00.000Z"),
    };
    expect(decidePostTracking(input).action).toBe("sync");

    const bounded = { ...input, trackingExpiresAt: new Date("2026-10-17T00:00:00.000Z") };
    expect(decidePostTracking(bounded).action).toBe("seal");
  });
});
