/**
 * @jest-environment node
 *
 * lib/posts/postStatus: one answer to "is this post still up" (plan §13 A5),
 * shared by the list, the grid, the post page, the shared report and every
 * export. "Deleted" needs two separate checks; one is "unverified since".
 */
import {
  DELETED_AFTER_STRIKES,
  noteStrikes,
  postAgeContext,
  postMeasuredAt,
  postStatus,
  postStatusCell,
  postStatusSummary,
} from "@/lib/posts/postStatus";
import { nextLastFetchNote, lastFetchNote } from "@/lib/metricDisplay";

const SEEN = new Date("2026-09-03T10:00:00Z");
// formatDateAbs is Intl en-GB, which spells September "Sep" or "Sept" by ICU version.
const note = (reason: string, extra: Record<string, unknown> = {}) => ({
  __lastFetch: { reason, at: "2026-09-05T10:00:00.000Z", via: "cron", ...extra },
});

describe("postStatus", () => {
  it("is live when the last read came back with counts", () => {
    const s = postStatus({ lastSyncedAt: SEEN, fetchState: "LIVE" });
    expect(s.kind).toBe("live");
    expect(s.label).toBe("Live");
    expect(s.since).toEqual(SEEN);
    expect(s.source).toBe("Platform read");
  });

  it("is hidden on TikTok's Only me, with when that was first seen", () => {
    const s = postStatus({ lastSyncedAt: SEEN, platformMetrics: note("post-hidden", { since: "2026-09-04T10:00:00.000Z" }) });
    expect(s.kind).toBe("hidden");
    expect(s.label).toBe("Hidden");
    expect(s.since).toEqual(new Date("2026-09-04T10:00:00.000Z"));
    expect(s.detail).toContain("Only me");
  });

  it("is only unverified after one deletion answer", () => {
    const s = postStatus({ lastSyncedAt: SEEN, fetchState: "UNAVAILABLE", platformMetrics: note("post-deleted") });
    expect(s.kind).toBe("unverified");
    expect(s.label).toMatch(/^Unverified since 3 Sept? 2026$/);
    expect(s.detail).toMatch(/second check/);
  });

  it("is deleted once two separate checks said so", () => {
    expect(DELETED_AFTER_STRIKES).toBe(2);
    const s = postStatus({
      lastSyncedAt: SEEN,
      fetchState: "UNAVAILABLE",
      platformMetrics: note("post-deleted", { strikes: 2, since: "2026-09-04T10:00:00.000Z" }),
    });
    expect(s.kind).toBe("deleted");
    expect(s.label).toBe("Deleted");
    expect(s.detail).toMatch(/2 separate checks, first on 4 Sept? 2026/);
    expect(s.since).toEqual(new Date("2026-09-04T10:00:00.000Z"));
  });

  it("does not call an imported UNAVAILABLE post gone on someone else's word", () => {
    const s = postStatus({ fetchState: "UNAVAILABLE" });
    expect(s.kind).toBe("unverified");
    expect(s.label).toBe("Unverified");
    expect(s.source).toBe("CreatorCore import");
  });

  it("is unverified since its last live read when our read failed", () => {
    const s = postStatus({ lastSyncedAt: SEEN, platformMetrics: note("reader-timeout") });
    expect(s.kind).toBe("unverified");
    expect(s.label).toMatch(/^Unverified since 3 Sept? 2026$/);
    expect(s.detail).toContain("our read timed out");
    expect(s.checkedAt).toEqual(new Date("2026-09-05T10:00:00.000Z"));
  });

  it("never produces private: Instagram's #110 is a hint, not a verdict", () => {
    const s = postStatus({ platformMetrics: note("not-a-professional-account") });
    expect(s.kind).toBe("unverified");
    expect(s.detail).toContain("personal, private, renamed or gone");
  });

  it("never calls a post that is not public deleted: a private or region-limited one looks the same", () => {
    const s = postStatus({ platformMetrics: note("not-public") });
    expect(s.kind).toBe("unverified");
    expect(s.detail).toContain("Instagram won’t show it publicly; it was deleted, the account is private, or it is limited by region");
  });

  it("takes an imported post's live status from the import, and says so", () => {
    const s = postStatus({ fetchState: "LIVE", lastFreshAt: "2026-07-20T00:00:00.000Z" });
    expect(s.kind).toBe("live");
    expect(s.source).toBe("CreatorCore import");
    expect(s.detail).toContain("not read by us yet");
  });

  it("is unverified when nothing has ever read it", () => {
    expect(postStatus({}).kind).toBe("unverified");
    expect(postStatus(null).label).toBe("Unverified");
    expect(postStatusCell({ lastSyncedAt: SEEN })).toBe("Live");
  });
});

describe("the strike count kept in the note", () => {
  it("counts a note from before strikes were kept as one", () => {
    expect(noteStrikes(null)).toBe(0);
    expect(noteStrikes({ reason: "post-deleted", at: "x", via: "cron" })).toBe(1);
    expect(noteStrikes({ reason: "post-deleted", at: "x", via: "cron", strikes: 3 })).toBe(3);
  });

  it("adds a strike for the same answer and starts over on a different one", () => {
    const first = nextLastFetchNote(null, "post-deleted", "2026-09-05T00:00:00.000Z", "cron");
    expect(first).toMatchObject({ reason: "post-deleted", since: "2026-09-05T00:00:00.000Z", strikes: 1 });
    const second = nextLastFetchNote(first, "post-deleted", "2026-09-06T00:00:00.000Z", "manual");
    expect(second).toMatchObject({ at: "2026-09-06T00:00:00.000Z", since: "2026-09-05T00:00:00.000Z", strikes: 2, via: "manual" });
    const other = nextLastFetchNote(second, "reader-timeout", "2026-09-07T00:00:00.000Z", "cron");
    expect(other).toMatchObject({ reason: "reader-timeout", since: "2026-09-07T00:00:00.000Z", strikes: 1 });
    // A legacy note without since/strikes counts as its own first strike.
    const legacy = nextLastFetchNote({ reason: "post-deleted", at: "2026-09-01T00:00:00.000Z", via: "cron" }, "post-deleted", "2026-09-02T00:00:00.000Z", "cron");
    expect(legacy).toMatchObject({ since: "2026-09-01T00:00:00.000Z", strikes: 2 });
  });

  it("reads since and strikes back off a stored note", () => {
    const parsed = lastFetchNote({ __lastFetch: { reason: "post-deleted", at: "a", via: "cron", since: "b", strikes: 2 } });
    expect(parsed).toMatchObject({ since: "b", strikes: 2 });
  });
});

describe("postMeasuredAt / postAgeContext / postStatusSummary", () => {
  it("dates counters by our read, else the import, else nothing", () => {
    expect(postMeasuredAt({ lastSyncedAt: SEEN, lastFreshAt: "2026-07-01T00:00:00Z" })).toEqual({ at: SEEN, source: "Platform read" });
    expect(postMeasuredAt({ lastFreshAt: "2026-07-01T00:00:00Z" })).toEqual({ at: new Date("2026-07-01T00:00:00Z"), source: "CreatorCore import" });
    expect(postMeasuredAt({})).toEqual({ at: null, source: "Not read" });
  });

  it("treats a post nothing reads any more as final, not late", () => {
    const now = new Date("2026-10-02T00:00:00Z");
    const live = postStatus({ lastSyncedAt: SEEN });
    expect(postAgeContext({ trackingEnabled: true }, live, now).tracked).toBe(true);
    expect(postAgeContext({ trackingEnabled: false }, live, now).tracked).toBe(false);
    expect(postAgeContext({ trackingEnabled: true, trackingExpiresAt: "2026-09-01T00:00:00Z" }, live, now).tracked).toBe(false);
    const hidden = postStatus({ platformMetrics: note("post-hidden") });
    expect(postAgeContext({ trackingEnabled: true }, hidden, now).tracked).toBe(false);
  });

  it("summarises many posts in one cell", () => {
    expect(postStatusSummary([])).toBe("No posts");
    expect(postStatusSummary([{ kind: "live" }, { kind: "live" }])).toBe("All live");
    expect(postStatusSummary([{ kind: "unverified" }, { kind: "live" }, { kind: "hidden" }, { kind: "live" }])).toBe("2 live, 1 hidden, 1 unverified");
  });
});
