import {
  HIDDEN_FETCH_REASON,
  NOT_PUBLIC_REASON,
  NO_PUBLIC_NUMBERS_REASON,
  REMOVED_FETCH_REASON,
  isPostRemoved,
  isPostNotPublic,
  postNotice,
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

describe("postNotice", () => {
  it("says the post is unavailable when it was removed", () => {
    expect(postNotice({ fetchState: "UNAVAILABLE", platformMetrics: note(REMOVED_FETCH_REASON) })).toEqual({
      label: "Post unavailable — it may have been deleted",
      note: { reason: REMOVED_FETCH_REASON, at: "2026-09-01T00:00:00.000Z", via: "cron" },
    });
  });

  it("names the Instagram account case in its own weaker words, never as removed", () => {
    const post = { fetchState: null, platformMetrics: note(NO_PUBLIC_NUMBERS_REASON) };
    expect(isPostRemoved(post)).toBe(false);
    expect(postNotice(post)?.label).toBe("No Instagram numbers — the post or account may be gone");
    expect(postNotice(post)?.note?.reason).toBe(NO_PUBLIC_NUMBERS_REASON);
  });

  it("lets removal win when both are on the post", () => {
    const post = { fetchState: "UNAVAILABLE", platformMetrics: note(NO_PUBLIC_NUMBERS_REASON) };
    expect(postNotice(post)?.label).toBe("Post unavailable — it may have been deleted");
  });

  it("is null for every reason that only means we could not look", () => {
    for (const reason of ["platform-refused", "rate-limited", "reader-timeout", "platform-challenged"]) {
      expect(postNotice({ platformMetrics: note(reason) })).toBeNull();
    }
    expect(postNotice({ fetchState: "LIVE" })).toBeNull();
    expect(postNotice(null)).toBeNull();
  });
});

describe("a post its creator hid", () => {
  it("counts as removed, so the share report's flag and Live Posts agree", () => {
    expect(isPostRemoved({ fetchState: null, platformMetrics: note(HIDDEN_FETCH_REASON) })).toBe(true);
  });

  it("says hidden, not 'may have been deleted', even with UNAVAILABLE on the post", () => {
    const post = { fetchState: "UNAVAILABLE", platformMetrics: note(HIDDEN_FETCH_REASON) };
    expect(postNotice(post)?.label).toBe("Post hidden — the creator made it private");
    expect(postNotice(post)?.note?.at).toBe("2026-09-01T00:00:00.000Z");
  });
});

/* Two public routes agree the post is not public from where we ask: deleted,
   private or region-limited. Only the first is final, so it is never filed as
   removed -- that verdict dead-letters the post for good. */
describe("a post Instagram shows to no one", () => {
  const post = { fetchState: null, platformMetrics: note(NOT_PUBLIC_REASON) };

  it("is not called removed", () => {
    expect(isPostRemoved(post)).toBe(false);
  });

  it("names both causes in its own pill and claims neither", () => {
    expect(postNotice(post)?.label).toBe("Not public — deleted, private or region-limited");
    expect(postNotice(post)?.note?.reason).toBe(NOT_PUBLIC_REASON);
  });

  it("is not public, as removed and hidden posts are -- and nothing we merely failed to read is", () => {
    expect(isPostNotPublic(post)).toBe(true);
    expect(isPostNotPublic({ fetchState: "UNAVAILABLE" })).toBe(true);
    expect(isPostNotPublic({ platformMetrics: note(HIDDEN_FETCH_REASON) })).toBe(true);
    for (const reason of ["backing-off", "reader-timeout", "platform-refused", NO_PUBLIC_NUMBERS_REASON, "author-unknown"]) {
      expect(isPostNotPublic({ platformMetrics: note(reason) })).toBe(false);
    }
    expect(isPostNotPublic(null)).toBe(false);
  });
});
