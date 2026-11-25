/**
 * @jest-environment node
 *
 * Meta's Business Discovery allowance is spent on the reels that have no views
 * before it is spent on ones that already do.
 */
import { lacksViews, viewsFresh } from "@/lib/sync/instagramViews";
import { selectSweepCandidates, urgentFirst, type SweepQuery } from "@/lib/sync/sweepCandidates";
import { noteForNewPost } from "@/lib/sync/syncPost";
import { postStatus } from "@/lib/posts/postStatus";
import { isPersonalAccountPost, personalAccountLabel } from "@/lib/postRemoval";

jest.mock("@/lib/db", () => ({ db: {} }));

const NOW = new Date("2026-11-25T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const reel = (over: Record<string, unknown> = {}) => ({
  platform: "INSTAGRAM",
  mediaType: "REEL",
  postUrl: "https://www.instagram.com/reel/AAA/",
  viewsCount: 0,
  platformMetrics: null,
  ...over,
});

describe("lacksViews", () => {
  it("is a reel with no views ever measured", () => {
    expect(lacksViews(reel())).toBe(true);
    expect(lacksViews(reel({ platformMetrics: { __measured: ["likes", "comments"] } }))).toBe(true);
  });
  it("is not a reel that has views, by column or by the measured list", () => {
    expect(lacksViews(reel({ viewsCount: 1200 }))).toBe(false);
    expect(lacksViews(reel({ platformMetrics: { __measured: ["views"] } }))).toBe(false);
  });
  it("is never a photo, a carousel or another platform", () => {
    expect(lacksViews(reel({ mediaType: "POST", postUrl: "https://www.instagram.com/p/AAA/" }))).toBe(false);
    expect(lacksViews(reel({ platform: "TIKTOK" }))).toBe(false);
  });
  it("reads a /reel/ link as a video even when the row has no media type", () => {
    expect(lacksViews(reel({ mediaType: null }))).toBe(true);
  });
});

describe("viewsFresh", () => {
  const withViews = (at: string) => reel({ viewsCount: 900, platformMetrics: { __measured: ["views"], __writers: { views: { source: "public", at } } } });
  it("holds inside the 6 hour window and not past it", () => {
    expect(viewsFresh(withViews(hoursAgo(2)), NOW)).toBe(true);
    expect(viewsFresh(withViews(hoursAgo(7)), NOW)).toBe(false);
  });
  it("is false for a post with no views, however recent the read", () => {
    expect(viewsFresh(reel({ platformMetrics: { __writers: { likes: { source: "public", at: hoursAgo(1) } } } }), NOW)).toBe(false);
  });
});

describe("urgentFirst", () => {
  it("puts the urgent first, keeps each side in order, and groups one creator's posts", () => {
    const rows = [
      { id: "a", c: "x", u: false },
      { id: "b", c: "y", u: true },
      { id: "c", c: "x", u: false },
      { id: "d", c: "z", u: true },
      { id: "e", c: "y", u: true },
    ];
    expect(urgentFirst(rows, (r) => r.u, (r) => r.c).map((r) => r.id)).toEqual(["b", "e", "d", "a", "c"]);
  });
});

describe("selectSweepCandidates — readFirst", () => {
  const rows = [
    { id: "has-views", creatorId: "c1", lacks: false },
    { id: "pending-1", creatorId: "c2", lacks: true },
    { id: "hidden", creatorId: "c3", lacks: false, later: true },
    { id: "pending-2", creatorId: "c1", lacks: true },
  ];

  it("asks reels without views before the rest, daily-recheck posts last, creators together", async () => {
    /* Call 0 is the seal query; call 1 is the first read tier. */
    let call = 0;
    const out = await selectSweepCandidates(
      async () => (call++ === 1 ? rows : []),
      {
        platform: "INSTAGRAM",
        budget: 10,
        now: NOW,
        readLast: (r) => r.later === true,
        readFirst: (r) => r.lacks,
        groupKey: (r) => r.creatorId,
      },
    );
    expect(out.posts.map((p) => p.id)).toEqual(["pending-1", "pending-2", "has-views", "hidden"]);
  });
});

describe("the add-time verdict", () => {
  it("stores a personal account's verdict on a new Instagram post", () => {
    const note = noteForNewPost("INSTAGRAM", "personal-account", NOW) as { __lastFetch: { reason: string; via: string } };
    expect(note.__lastFetch).toMatchObject({ reason: "personal-account", via: "add-post" });
  });
  it("stores views-pending and an account that shares no numbers, and nothing else", () => {
    expect(noteForNewPost("INSTAGRAM", "views-pending", NOW)).not.toBeNull();
    expect(noteForNewPost("INSTAGRAM", "not-a-professional-account", NOW)).not.toBeNull();
    expect(noteForNewPost("INSTAGRAM", "platform-refused", NOW)).toBeNull();
    expect(noteForNewPost("INSTAGRAM", undefined, NOW)).toBeNull();
    expect(noteForNewPost("TIKTOK", "personal-account", NOW)).toBeNull();
  });
  it("is surfaced as a label in the app, and the post still reads as live", () => {
    const platformMetrics = noteForNewPost("INSTAGRAM", "personal-account", NOW);
    expect(isPersonalAccountPost({ platformMetrics })).toBe(true);
    expect(personalAccountLabel()).toBe("Personal Instagram account — views need a free Creator account");
    const status = postStatus({ platformMetrics, lastSyncedAt: NOW });
    expect(status.kind).toBe("live");
  });
});
