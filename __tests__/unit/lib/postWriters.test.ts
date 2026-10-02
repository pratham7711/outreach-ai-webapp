/**
 * @jest-environment node
 *
 * One writer per post counter (plan A7): which source wrote each counter is
 * kept on the post, and a public reading does not replace a connected one
 * inside the field's freshness window. Also the fetchers' half -- the counters
 * read with the creator's own token are the ones named connected.
 */
jest.mock("@/lib/platforms/tiktokDisplay", () => ({ fetchTikTokVideosByIds: jest.fn() }));

import { METRIC_WRITERS_KEY, countersIn, rankPostCounters, writerNotes } from "@/lib/metrics/postWriters";
import { assemblePostMetrics, fetchTikTokMetrics, type PostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { fetchTikTokVideosByIds } from "@/lib/platforms/tiktokDisplay";
import { countsFrom } from "@/lib/sync/syncPost";

const NOW = new Date("2026-10-02T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

const fetched = (over: Partial<PostMetrics> = {}): PostMetrics => ({
  platform: "TIKTOK",
  platformPostId: "1",
  thumbnailUrl: null,
  caption: null,
  ...over,
});

const bag = (notes: Record<string, unknown>) => ({ [METRIC_WRITERS_KEY]: notes });

describe("rankPostCounters", () => {
  it("keeps a fresh connected count when a public read arrives", () => {
    const out = rankPostCounters(
      fetched({ viewsCount: 47_900, likesCount: 500, engagementRate: 1.1 }),
      { viewsCount: 48_210, likesCount: 480 },
      bag({ views: { source: "connected", at: hoursAgo(1) } }),
      NOW,
    );
    expect(out.metrics.viewsCount).toBe(48_210);
    // A counter the connection did not write is written as before.
    expect(out.metrics.likesCount).toBe(500);
    // The rate was worked out from 47,900 views, which were not written.
    expect(out.metrics).not.toHaveProperty("engagementRate");
    expect(out.notes.views).toEqual({ source: "connected", at: hoursAgo(1) });
    expect(out.notes.likes).toEqual({ source: "public", at: NOW.toISOString() });
    expect(out.held).toEqual([]);
  });

  it("replaces a connected count once it is older than the field's window", () => {
    const out = rankPostCounters(
      fetched({ viewsCount: 47_900 }),
      { viewsCount: 48_210 },
      bag({ views: { source: "connected", at: hoursAgo(7) } }),
      NOW,
    );
    expect(out.metrics.viewsCount).toBe(47_900);
    expect(out.notes.views).toEqual({ source: "public", at: NOW.toISOString() });
  });

  it("never lets a manual figure block a reading", () => {
    const out = rankPostCounters(
      fetched({ viewsCount: 47_900 }),
      { viewsCount: 99_999 },
      bag({ views: { source: "manual", at: hoursAgo(0) } }),
      NOW,
    );
    expect(out.metrics.viewsCount).toBe(47_900);
  });

  it("lets any reading write a counter nobody has signed, which is every post before this", () => {
    const out = rankPostCounters(fetched({ viewsCount: 47_900 }), { viewsCount: 48_210 }, { ccRaw: {} }, NOW);
    expect(out.metrics.viewsCount).toBe(47_900);
    expect(out.notes.views).toEqual({ source: "public", at: NOW.toISOString() });
  });

  it("lets the connection replace a fresh public count", () => {
    const out = rankPostCounters(
      fetched({ viewsCount: 48_210, connectedCounters: ["views"] }),
      { viewsCount: 47_900 },
      bag({ views: { source: "public", at: hoursAgo(0) } }),
      NOW,
    );
    expect(out.metrics.viewsCount).toBe(48_210);
    expect(out.notes.views).toEqual({ source: "connected", at: NOW.toISOString() });
  });

  it("drops a held counter whose stored value the caller did not load, and says so", () => {
    const out = rankPostCounters(
      fetched({ viewsCount: 47_900 }),
      {},
      bag({ views: { source: "connected", at: hoursAgo(1) } }),
      NOW,
    );
    expect(out.metrics).not.toHaveProperty("viewsCount");
    expect(out.held).toEqual(["views"]);
  });

  it("drops a reach from a public read, which may never write it, without calling it measured", () => {
    const out = rankPostCounters(fetched({ viewsCount: 1, reachCount: 7 }), { reachCount: 0 }, null, NOW);
    expect(out.metrics).not.toHaveProperty("reachCount");
    expect(out.held).toEqual([]);
    expect(out.notes).not.toHaveProperty("reach");
  });

  it("returns the fetch untouched when nothing is held", () => {
    const metrics = fetched({ viewsCount: 1, engagementRate: 2 });
    expect(rankPostCounters(metrics, {}, null, NOW).metrics).toBe(metrics);
  });
});

describe("writerNotes", () => {
  it("drops a note it cannot date, so it can never pin a counter", () => {
    expect(
      writerNotes(
        bag({
          views: { source: "connected", at: "not a date" },
          likes: { source: "telepathy", at: hoursAgo(1) },
          comments: { source: "connected", at: hoursAgo(1) },
        }),
      ),
    ).toEqual({ comments: { source: "connected", at: hoursAgo(1) } });
  });

  it("reads nothing from a missing bag", () => {
    expect(writerNotes(null)).toEqual({});
    expect(writerNotes(undefined)).toEqual({});
  });
});

describe("the fetchers name what the connection read", () => {
  it("assemblePostMetrics keeps the claim only for counters that survived", () => {
    const out = assemblePostMetrics("INSTAGRAM", "C1", { viewsCount: 10, connectedCounters: ["views", "likes"] });
    expect(out.connectedCounters).toEqual(["views"]);
    expect(countersIn(out)).toEqual(["views"]);
  });

  it("assemblePostMetrics adds nothing for a public read", () => {
    expect(assemblePostMetrics("TIKTOK", "1", { viewsCount: 10 })).not.toHaveProperty("connectedCounters");
  });

  it("TikTok's Display API, read with the creator's token, is connected", async () => {
    (fetchTikTokVideosByIds as jest.Mock).mockResolvedValue([
      {
        id: "7675846963421646098",
        coverImageUrl: null,
        description: "",
        title: "",
        exact: { views: 4165, likes: 535, comments: 2, shares: undefined, createdAt: undefined },
      },
    ]);
    const out = await fetchTikTokMetrics(
      "https://www.tiktok.com/@someone/video/7675846963421646098",
      "7675846963421646098",
      "creator-token",
    );
    expect(out.connectedCounters).toEqual(["views", "likes", "comments"]);
  });
});

describe("countsFrom signs a new post's first reading", () => {
  it("with the source of each counter it carries", () => {
    const { measuredPatch } = countsFrom(fetched({ viewsCount: 10, likesCount: 2, connectedCounters: ["views"] }), NOW);
    expect(measuredPatch[METRIC_WRITERS_KEY]).toEqual({
      views: { source: "connected", at: NOW.toISOString() },
      likes: { source: "public", at: NOW.toISOString() },
    });
  });
});
