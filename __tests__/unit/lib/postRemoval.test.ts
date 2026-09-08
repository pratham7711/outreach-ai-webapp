import {
  REMOVED_FETCH_REASON,
  isPostRemoved,
  removedNote,
  removedPostLabel,
  removedSince,
} from "@/lib/postRemoval";
import { LAST_FETCH_KEY } from "@/lib/metricDisplay";

/* These four functions decide whether a card gets a "deleted" badge, so the
   thing worth testing is what they refuse to call deleted: a timeout, a rate
   limit, a post nobody has ever synced. Every one of those means we could not
   look, and none of them means the post is gone. */

const note = (reason: string, at = "2026-09-01T00:00:00.000Z") => ({
  [LAST_FETCH_KEY]: { reason, at, via: "cron" },
});

describe("isPostRemoved", () => {
  it("is true on the fetchState the sync writes for a deleted post", () => {
    expect(isPostRemoved({ fetchState: "UNAVAILABLE" })).toBe(true);
  });

  it("is true on the stored note alone, for posts synced before the column existed", () => {
    expect(isPostRemoved({ fetchState: null, platformMetrics: note(REMOVED_FETCH_REASON) })).toBe(
      true
    );
  });

  it("is false for a live post, an unsynced post, and no post at all", () => {
    expect(isPostRemoved({ fetchState: "LIVE" })).toBe(false);
    expect(isPostRemoved({ fetchState: null, platformMetrics: null })).toBe(false);
    expect(isPostRemoved({})).toBe(false);
    expect(isPostRemoved(null)).toBe(false);
    expect(isPostRemoved(undefined)).toBe(false);
  });

  it("is false for every failure that is about us rather than the post", () => {
    // ERROR and the reasons behind it mean the read did not land. Badging those
    // as deleted would tell a brand a live post had been taken down.
    expect(isPostRemoved({ fetchState: "ERROR" })).toBe(false);
    expect(isPostRemoved({ fetchState: "UNKNOWN" })).toBe(false);
    for (const reason of ["rate-limited", "timeout", "blocked", "no-counts"]) {
      expect(isPostRemoved({ fetchState: null, platformMetrics: note(reason) })).toBe(false);
    }
  });

  it("ignores a malformed bag instead of throwing on it", () => {
    expect(isPostRemoved({ platformMetrics: "nonsense" })).toBe(false);
    expect(isPostRemoved({ platformMetrics: { [LAST_FETCH_KEY]: { at: "x" } } })).toBe(false);
  });
});

describe("removedNote", () => {
  it("returns the note only when it is the removal one", () => {
    expect(removedNote({ platformMetrics: note(REMOVED_FETCH_REASON) })?.via).toBe("cron");
    expect(removedNote({ platformMetrics: note("rate-limited") })).toBeNull();
    // The column says removed but the bag holds no note: nothing to date it by.
    expect(removedNote({ fetchState: "UNAVAILABLE" })).toBeNull();
  });
});

describe("removedPostLabel", () => {
  it("hedges the cause, because a suspension looks the same from outside", () => {
    expect(removedPostLabel()).toBe("Post unavailable — it may have been deleted");
  });
});

describe("removedSince", () => {
  it("dates the check rather than the deletion", () => {
    const at = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(removedSince({ reason: REMOVED_FETCH_REASON, at, via: "cron" })).toBe(
      "Last checked 3d ago"
    );
  });

  it("says nothing at all when there is no usable timestamp", () => {
    // Better an absent tooltip than "Last checked Recently", which timeAgo
    // returns for junk and which reads as a measurement we did not make.
    expect(removedSince(null)).toBeNull();
    expect(removedSince(undefined)).toBeNull();
    expect(removedSince({ reason: REMOVED_FETCH_REASON, at: "", via: "cron" })).toBeNull();
    expect(removedSince({ reason: REMOVED_FETCH_REASON, at: "not-a-date", via: "cron" })).toBeNull();
  });
});
