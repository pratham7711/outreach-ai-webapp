/**
 * A bulk action must not be able to do what the single-post action refuses.
 *
 * The two paths write the same columns from different files -- PATCH
 * .../posts/[postId] and POST .../posts/[postId]/track on one side,
 * bulkUpdateData on the other -- so the risk is drift: an approve that forgets
 * to clear a rejection reason, or a track that writes an unbounded window
 * because ttlDays happened to be absent. Both are asserted here rather than
 * left to review.
 */
import { bulkActionSummary, bulkUpdateData, isBulkAction, MAX_BULK_ACTION_POSTS } from "@/lib/posts/bulkActions";
import { POST_TTL_MAX_DAYS } from "@/lib/sync/postTracking";

const NOW = new Date("2026-09-16T12:00:00.000Z");
const base = { defaultTtlDays: 30, now: NOW };

describe("bulkUpdateData", () => {
  it("clears the rejection reason when approving", () => {
    /* The single-post PATCH does this explicitly. A post rejected with a
       sentence and then approved would otherwise keep showing it in the
       creator's portal. */
    const data = bulkUpdateData({ ...base, action: "approve" });
    expect(data.status).toBe("APPROVED");
    expect(data.rejectionReason).toBeNull();
  });

  it("stores a rejection reason, trimmed", () => {
    const data = bulkUpdateData({ ...base, action: "reject", rejectionReason: "  wrong product  " });
    expect(data.status).toBe("REJECTED");
    expect(data.rejectionReason).toBe("wrong product");
  });

  it("stores an empty reason as null, never as an empty string", () => {
    // "" renders as a rejection with a blank explanation; null renders as none.
    for (const reason of ["", "   ", null, undefined]) {
      const data = bulkUpdateData({ ...base, action: "reject", rejectionReason: reason });
      expect(data.rejectionReason).toBeNull();
    }
  });

  it("always sets an expiry when tracking, even with no ttlDays", () => {
    /* The trade the product makes: unlimited post trackers precisely because
       every one of them stops on its own. An omitted ttlDays must fall back to
       the org default, never to forever. */
    const data = bulkUpdateData({ ...base, action: "track" });
    expect(data.trackingEnabled).toBe(true);
    expect(data.trackingTtlDays).toBe(30);
    expect(data.trackingStartedAt).toEqual(NOW);
    expect(data.trackingExpiresAt).toBeInstanceOf(Date);
    expect((data.trackingExpiresAt as Date).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("honours a chosen window", () => {
    const data = bulkUpdateData({ ...base, action: "track", ttlDays: 7 });
    expect(data.trackingTtlDays).toBe(7);
    const days = ((data.trackingExpiresAt as Date).getTime() - NOW.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 5);
  });

  it("clamps a window the caller had no business asking for", () => {
    const data = bulkUpdateData({ ...base, action: "track", ttlDays: 9000 });
    expect(data.trackingTtlDays).toBe(POST_TTL_MAX_DAYS);
  });

  it("restarts the window rather than resuming it", () => {
    // Re-tracking an already-tracked post is a new instruction; inheriting a
    // stale expiry could end the tracker before its first read.
    const later = new Date("2026-09-20T12:00:00.000Z");
    const first = bulkUpdateData({ ...base, action: "track", ttlDays: 3 });
    const second = bulkUpdateData({ ...base, action: "track", ttlDays: 3, now: later });
    expect((second.trackingExpiresAt as Date).getTime()).toBeGreaterThan(
      (first.trackingExpiresAt as Date).getTime()
    );
  });

  it("clears every tracking column when untracking", () => {
    const data = bulkUpdateData({ ...base, action: "untrack" });
    expect(data).toEqual({
      trackingEnabled: false,
      trackingStartedAt: null,
      trackingTtlDays: null,
      trackingExpiresAt: null,
    });
  });

  it("never writes a status while tracking, or tracking while approving", () => {
    // The two actions are separate on purpose: bulk-tracking a selection must
    // not quietly approve it.
    const track = bulkUpdateData({ ...base, action: "track" });
    expect(track.status).toBeUndefined();
    const approve = bulkUpdateData({ ...base, action: "approve" });
    expect(approve.trackingEnabled).toBeUndefined();
  });
});

describe("isBulkAction", () => {
  it("accepts only the four actions", () => {
    for (const a of ["approve", "reject", "track", "untrack"]) expect(isBulkAction(a)).toBe(true);
    // "sync" is deliberately not one: a subset sync needs the refresh route's
    // pacing and progress, which this does not have.
    for (const a of ["sync", "delete", "", "APPROVE", null, 7, {}]) expect(isBulkAction(a)).toBe(false);
  });
});

describe("bulkActionSummary", () => {
  it("says when the first tracking reading arrives", () => {
    /* Without this the operator tracks fifty posts, sees no number move, and
       reasonably concludes it did not work -- the sweep is up to six hours
       away. */
    const msg = bulkActionSummary("track", 50, 30);
    expect(msg).toContain("50 posts");
    expect(msg).toContain("30 days");
    expect(msg).toMatch(/first reading/i);
    expect(msg).toMatch(/Refresh Data/);
  });

  it("counts one post in the singular", () => {
    expect(bulkActionSummary("approve", 1)).toBe("Approved 1 post.");
    expect(bulkActionSummary("track", 1, 1)).toContain("1 post for 1 day.");
  });

  it("reports what actually happened, not what was asked", () => {
    // The route passes updateMany's count, so a selection holding an id from
    // another tenant reports the smaller number.
    expect(bulkActionSummary("untrack", 3)).toBe("Stopped tracking 3 posts.");
  });
});

describe("the cap", () => {
  it("is the same 50 the paste box uses", () => {
    expect(MAX_BULK_ACTION_POSTS).toBe(50);
  });
});
