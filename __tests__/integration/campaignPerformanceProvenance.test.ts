/**
 * @jest-environment node
 *
 * The engagement counters default to 0, so a campaign of imported posts used to
 * report "0 engagements, 0.00% rate" as though it had been measured. These pin
 * the rule that an unfetched counter reports nothing at all.
 */
jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn() },
    // The views-over-time read is raw SQL: DISTINCT ON collapses the
    // append-only snapshot log to one row per post per UTC day in the database
    // rather than shipping every hourly reading to Node.
    $queryRawUnsafe: jest.fn(),
    activation: { findMany: jest.fn() },
    // The report also reaches campaign -> song -> sound for the audio card.
    campaign: { findUnique: jest.fn() },
    soundTrackerSnapshot: { findMany: jest.fn() },
    // The cache key is a stamp read off the campaign's own state.
    $queryRaw: jest.fn(),
  },
}));

import { db } from "@/lib/db";
import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";

const mockDb = db as unknown as {
  post: { findMany: jest.Mock };
  $queryRawUnsafe: jest.Mock;
  activation: { findMany: jest.Mock };
  campaign: { findUnique: jest.Mock };
  soundTrackerSnapshot: { findMany: jest.Mock };
  $queryRaw: jest.Mock;
};

/* Every test below drives the same campaign id with different posts, so a
   constant stamp would hand the first test's result to all the others. A fresh
   stamp per call keeps each one computing: these pin the arithmetic, and the
   cache itself is verified against a running server, not here. */
let stampCounter = 0;

const campaign = { id: "camp-1", orgId: "org-1", budget: null, currency: "USD" };

const creator = { id: "creator-1", name: "Ada", avatarUrl: null };

function post(over: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    platform: "TIKTOK",
    postedAt: new Date("2026-08-01"),
    viewsCount: 10_000,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    savesCount: 0,
    lastSyncedAt: null,
    // Never inspected, which is the state of every imported post.
    fetchState: null,
    creator,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.$queryRawUnsafe.mockResolvedValue([]);
  // No activations by default — which is the state of every imported campaign,
  // and the reason a leaderboard status is null rather than a default status.
  mockDb.activation.findMany.mockResolvedValue([]);
  // No song by default, so there is no audio card to build.
  mockDb.campaign.findUnique.mockResolvedValue({ song: null });
  mockDb.soundTrackerSnapshot.findMany.mockResolvedValue([]);
  mockDb.$queryRaw.mockImplementation(() =>
    Promise.resolve([
      { posts: BigInt(1), synced: null, activations: null, views: String(++stampCounter) },
    ])
  );
});

describe("computeCampaignPerformance engagement provenance", () => {
  it("reports no engagement figures when nothing was ever fetched", async () => {
    mockDb.post.findMany.mockResolvedValue([post()]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.views).toBe(10_000);
    expect(result.kpis.engagements).toBeNull();
    expect(result.kpis.engagementRate).toBeNull();
    expect(result.leaderboard[0].engagements).toBeNull();
    expect(result.leaderboard[0].engagementRate).toBeNull();
  });

  it("reports the figures for posts it did fetch", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ likesCount: 300, commentsCount: 200, lastSyncedAt: new Date("2026-08-02") }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.engagements).toBe(500);
    expect(result.kpis.engagementRate).toBeCloseTo(0.05);
    expect(result.leaderboard[0].engagements).toBe(500);
  });

  it("rates only the views it has engagement for, so a mixed campaign is not diluted", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ id: "synced", likesCount: 500, lastSyncedAt: new Date("2026-08-02") }),
      post({ id: "imported", viewsCount: 90_000 }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.views).toBe(100_000);
    expect(result.kpis.engagements).toBe(500);
    // 500 / 10,000 measured views -- not 500 / 100,000.
    expect(result.kpis.engagementRate).toBeCloseTo(0.05);
  });

  it("keeps a genuine zero once the post has actually been synced", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ likesCount: 0, commentsCount: 0, lastSyncedAt: new Date("2026-08-02") }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.engagements).toBe(0);
    expect(result.kpis.engagementRate).toBe(0);
  });

  it("no longer carries spend, CPM or CPE", async () => {
    mockDb.post.findMany.mockResolvedValue([post()]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis).not.toHaveProperty("spend");
    expect(result.kpis).not.toHaveProperty("cpm");
    expect(result.kpis).not.toHaveProperty("cpe");
    expect(result).not.toHaveProperty("spendSource");
  });

  it("leaves the status null for a creator with no activation on the campaign", async () => {
    mockDb.post.findMany.mockResolvedValue([post()]);
    const r = await computeCampaignPerformance(campaign);
    expect(r.leaderboard[0].status).toBeNull();
  });

  it("carries the current status when the creator does have an activation", async () => {
    mockDb.post.findMany.mockResolvedValue([post()]);
    mockDb.activation.findMany.mockResolvedValue([
      { creatorId: "creator-1", status: "APPROVED" },
    ]);
    const r = await computeCampaignPerformance(campaign);
    expect(r.leaderboard[0].status).toBe("APPROVED");
  });

  it("takes the latest activation when a creator has more than one", async () => {
    // The query orders by updatedAt ascending, so the last row wins — a creator
    // re-briefed on the same campaign shows where they are now, not where they
    // started.
    mockDb.post.findMany.mockResolvedValue([post()]);
    mockDb.activation.findMany.mockResolvedValue([
      { creatorId: "creator-1", status: "DECLINED" },
      { creatorId: "creator-1", status: "POSTED" },
    ]);
    const r = await computeCampaignPerformance(campaign);
    expect(r.leaderboard[0].status).toBe("POSTED");
    expect(mockDb.activation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: "asc" } })
    );
  });

  it("scopes the activation read to this campaign and skips deleted ones", async () => {
    mockDb.post.findMany.mockResolvedValue([post()]);
    await computeCampaignPerformance(campaign);
    expect(mockDb.activation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: "camp-1", deletedAt: null } })
    );
  });
});

describe("computeCampaignPerformance audio provenance", () => {
  it("carries no audio when the campaign has no song", async () => {
    mockDb.post.findMany.mockResolvedValue([post()]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.audio).toBeNull();
  });

  it("carries no audio when the song has no tracked sound", async () => {
    mockDb.post.findMany.mockResolvedValue([post()]);
    mockDb.campaign.findUnique.mockResolvedValue({ song: { coverUrl: "https://cdn/x.jpg", sound: null } });

    const result = await computeCampaignPerformance(campaign);

    expect(result.audio).toBeNull();
  });

  it("reports null uses for a sound that has been tracked but never synced", async () => {
    mockDb.post.findMany.mockResolvedValue([post()]);
    mockDb.campaign.findUnique.mockResolvedValue({
      song: {
        coverUrl: "https://cdn/song.jpg",
        sound: { id: "s1", tiktokSoundId: "999", title: "Wherever I Go", artist: "Ellie Holcomb", coverImageUrl: null },
      },
    });
    mockDb.soundTrackerSnapshot.findMany.mockResolvedValue([]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.audio).not.toBeNull();
    // Zero here would claim the audio has never been used, which is a
    // measurement no snapshot has made.
    expect(result.audio!.uses).toBeNull();
    expect(result.audio!.videosAdded24h).toBeNull();
    expect(result.audio!.usageSeries).toEqual([]);
    // The song's art stands in until the tracker has a cover of its own.
    expect(result.audio!.coverUrl).toBe("https://cdn/song.jpg");
    expect(result.audio!.soundUrl).toContain("999");
  });

  it("reports the latest snapshot and orders the usage curve oldest first", async () => {
    mockDb.post.findMany.mockResolvedValue([post()]);
    mockDb.campaign.findUnique.mockResolvedValue({
      song: {
        coverUrl: null,
        sound: { id: "s1", tiktokSoundId: "999", title: "Wherever I Go", artist: "Ellie Holcomb", coverImageUrl: "https://cdn/sound.jpg" },
      },
    });
    // The query orders newest first, so the newest row is the current count and
    // the series has to come back reversed.
    mockDb.soundTrackerSnapshot.findMany.mockResolvedValue([
      { usesCount: 44, videosAdded24h: 21, recordedAt: new Date("2026-08-22T00:00:00Z") },
      { usesCount: 23, videosAdded24h: 9, recordedAt: new Date("2026-08-21T00:00:00Z") },
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.audio!.uses).toBe(44);
    expect(result.audio!.videosAdded24h).toBe(21);
    /* `at` carries the clock as well as the day, because several readings can
       land on one date and the axis then printed the same label for all of
       them. It is the chart's own dataKey, so a row without it is not a
       cosmetic loss -- it is a report that does not render. */
    expect(result.audio!.usageSeries).toEqual([
      { date: "2026-08-21", at: "2026-08-21T00:00:00.000Z", uses: 23 },
      { date: "2026-08-22", at: "2026-08-22T00:00:00.000Z", uses: 44 },
    ]);
    // The tracker's own cover wins over the song's art.
    expect(result.audio!.coverUrl).toBe("https://cdn/sound.jpg");
  });
});

describe("computeCampaignPerformance per-counter totals", () => {
  it("counts posts even when nothing about them has been measured", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ viewsCount: 400, lastSyncedAt: null }),
      post({ id: "p2", viewsCount: 600, lastSyncedAt: null }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    // How many posts exist is a fact about our own records, not a measurement
    // taken from a platform, so it is always known.
    expect(result.kpis.posts).toBe(2);
    expect(result.kpis.views).toBe(1000);
  });

  it("reports null for counters no post has measured, not zero", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ viewsCount: 400, likesCount: 0, commentsCount: 0, sharesCount: 0, savesCount: 0, lastSyncedAt: null }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    // A tile reading "Total Saves 0" would tell a brand the campaign earned no
    // saves. We never asked TikTok for saves; it does not carry them.
    expect(result.kpis.likes).toBeNull();
    expect(result.kpis.comments).toBeNull();
    expect(result.kpis.shares).toBeNull();
    expect(result.kpis.saves).toBeNull();
    expect(result.kpis.downloads).toBeNull();
  });

  it("sums only the posts where a counter was actually measured", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({
        id: "measured", viewsCount: 1000, likesCount: 90, commentsCount: 4,
        sharesCount: 7, savesCount: 0, lastSyncedAt: new Date("2026-08-22"),
      }),
      post({
        id: "never", viewsCount: 500, likesCount: 0, commentsCount: 0,
        sharesCount: 0, savesCount: 0, lastSyncedAt: null,
      }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.likes).toBe(90);
    expect(result.kpis.comments).toBe(4);
    expect(result.kpis.shares).toBe(7);
    // Saves is different: lastSyncedAt does not vouch for it, because the sync
    // that stamped the timestamp never fetched a saves count in the first place.
    expect(result.kpis.saves).toBeNull();
    // Views are carried by every source, including the import, so both count.
    expect(result.kpis.views).toBe(1500);
  });

  it("says nothing about live posts until something has been inspected", async () => {
    // fetchState is nullable and only /api/posts/inspect writes it. Counting
    // nulls as live would report a deleted post as standing; counting them as
    // dead would report a healthy campaign as gone.
    mockDb.post.findMany.mockResolvedValue([
      post({ id: "a", viewsCount: 100 }),
      post({ id: "b", viewsCount: 200 }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.posts).toBe(2);
    expect(result.kpis.livePosts).toBeNull();
  });

  it("counts the live ones once every post has been reached", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ id: "a", viewsCount: 100, fetchState: "LIVE" }),
      post({ id: "b", viewsCount: 200, fetchState: "UNAVAILABLE" }),
      post({ id: "c", viewsCount: 300, fetchState: "LIVE" }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.posts).toBe(3);
    expect(result.kpis.livePosts).toBe(2);
  });

  it("withholds the count while even one post has never been reached", async () => {
    // "3 posts, 2 live" would say a creator deleted one. The truth is that the
    // third has never been fetched, which is a different statement entirely.
    mockDb.post.findMany.mockResolvedValue([
      post({ id: "a", viewsCount: 100, fetchState: "LIVE" }),
      post({ id: "b", viewsCount: 200, fetchState: "LIVE" }),
      post({ id: "c", viewsCount: 300 }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.posts).toBe(3);
    expect(result.kpis.livePosts).toBeNull();
  });

  it("counts saves and downloads only where something actually wrote them", async () => {
    // Only the CreatorCore import populates these two, and it writes no
    // lastSyncedAt -- so provenance has to come from the value, not the stamp.
    mockDb.post.findMany.mockResolvedValue([
      post({ id: "imported", viewsCount: 900, savesCount: 12, downloadsCount: 3, lastSyncedAt: null }),
      post({ id: "synced", viewsCount: 400, savesCount: 0, downloadsCount: 0, lastSyncedAt: new Date("2026-08-22") }),
    ]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.kpis.saves).toBe(12);
    expect(result.kpis.downloads).toBe(3);
  });
});

/**
 * The views-over-time read. PostMetricSnapshot is append-only and an
 * hourly-synced post writes 24 rows a day, of which the chart uses exactly one.
 * The report used to pull all of them, with no `take` at all.
 */
describe("computeCampaignPerformance views-over-time read", () => {
  const sqlOfSeriesRead = () => String(mockDb.$queryRawUnsafe.mock.calls[0][0]);

  beforeEach(() => {
    mockDb.post.findMany.mockResolvedValue([post()]);
  });

  it("collapses the snapshot log to one row per post per UTC day in the database", async () => {
    await computeCampaignPerformance(campaign);

    const sql = sqlOfSeriesRead();
    expect(sql).toContain('DISTINCT ON (s."postId", s."recordedAt"::date)');
    // Latest reading of the day, which is the rule carryForwardViewsByDay
    // applies in Node — same rule, moved to where the rows already are.
    expect(sql).toContain('ORDER BY s."postId", s."recordedAt"::date, s."recordedAt" DESC');
  });

  it("bounds the read and drops the oldest days first when it hits the bound", async () => {
    await computeCampaignPerformance(campaign);

    const sql = sqlOfSeriesRead();
    expect(sql).toMatch(/LIMIT \d+/);
    expect(sql).toContain('ORDER BY collapsed."day" DESC');
  });

  it("selects only the three columns the series needs", async () => {
    await computeCampaignPerformance(campaign);

    const sql = sqlOfSeriesRead();
    for (const column of ["likesCount", "commentsCount", "sharesCount", "platformMetrics", "syncSource"]) {
      expect(sql).not.toContain(column);
    }
    // The day is formatted in Postgres: recordedAt is `timestamp without time
    // zone` holding UTC, and node-postgres reads that as LOCAL time, which would
    // move a reading near midnight into the wrong bucket on an IST laptop.
    expect(sql).toContain("to_char(s.\"recordedAt\", 'YYYY-MM-DD')");
  });

  it("scopes the read to the campaign, with the id bound rather than interpolated", async () => {
    await computeCampaignPerformance(campaign);

    const [sql, ...params] = mockDb.$queryRawUnsafe.mock.calls[0];
    expect(String(sql)).toContain('p."campaignId" = $1');
    expect(params[0]).toBe("camp-1");
    expect(String(sql)).not.toContain("camp-1");
  });

  it("does not narrow by platform when the caller did not", async () => {
    /* It used to narrow to TIKTOK/INSTAGRAM/YOUTUBE, because the chart had
       exactly those three columns and a TWITTER post's snapshots would have
       been fetched and then discarded. The chart now takes its columns from the
       campaign, so narrowing here would only put the hole back one layer down —
       and the pie beside the chart has always counted every platform. */
    await computeCampaignPerformance(campaign);

    const [sql, ...params] = mockDb.$queryRawUnsafe.mock.calls[0];
    expect(String(sql)).not.toContain("p.platform::text IN");
    expect(params).toEqual(["camp-1"]);
  });

  it("narrows further to the caller's own platform filter", async () => {
    await computeCampaignPerformance(campaign, ["INSTAGRAM"]);

    const [sql, ...params] = mockDb.$queryRawUnsafe.mock.calls[0];
    expect(String(sql)).toContain("p.platform::text IN ($2)");
    expect(params).toEqual(["camp-1", "INSTAGRAM"]);
  });

  it("charts the day the database bucketed, not the laptop's reading of it", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ id: "p1", platform: "TIKTOK", postedAt: new Date("2026-08-01T00:00:00Z"), viewsCount: 10 }),
    ]);
    mockDb.$queryRawUnsafe.mockResolvedValue([
      { postId: "p1", day: "2026-08-02", viewsCount: 4_000 },
      { postId: "p1", day: "2026-08-03", viewsCount: 5_000 },
    ]);

    const result = await computeCampaignPerformance(campaign);

    // One key per platform the campaign posted on, and this campaign is
    // TikTok-only, so INSTAGRAM and YOUTUBE are absent rather than zero.
    expect(result.timeSeries).toEqual([
      { date: "2026-08-02", TIKTOK: 4_000 },
      { date: "2026-08-03", TIKTOK: 5_000 },
    ]);
    expect(result.seriesPlatforms).toEqual(["TIKTOK"]);
  });

  /**
   * The stacked area and the pie beside it must add up to the same number.
   *
   * The pie split ALL posts by platform while the series was filtered to
   * TIKTOK/INSTAGRAM/YOUTUBE, so a campaign with a Twitter or Facebook post
   * drew a stack whose total sat below the Total Views tile above it.
   */
  it("charts every platform the campaign posted on, most-viewed first", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post({ id: "p1", platform: "TWITTER", postedAt: new Date("2026-08-01T00:00:00Z"), viewsCount: 900 }),
      post({ id: "p2", platform: "TIKTOK", postedAt: new Date("2026-08-01T00:00:00Z"), viewsCount: 100 }),
    ]);
    mockDb.$queryRawUnsafe.mockResolvedValue([]);

    const result = await computeCampaignPerformance(campaign);

    expect(result.seriesPlatforms).toEqual(["TWITTER", "TIKTOK"]);
    const last = result.timeSeries[result.timeSeries.length - 1];
    expect(last).toEqual({ date: "2026-08-01", TWITTER: 900, TIKTOK: 100 });
    // Which is the whole point: the stack now totals the Total Views tile.
    expect(Number(last.TWITTER) + Number(last.TIKTOK)).toBe(result.kpis.views);
  });
});
