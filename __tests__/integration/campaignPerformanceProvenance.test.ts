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
    postMetricSnapshot: { findMany: jest.fn() },
    activation: { findMany: jest.fn() },
    // The report also reaches campaign -> song -> sound for the audio card.
    campaign: { findUnique: jest.fn() },
    soundTrackerSnapshot: { findMany: jest.fn() },
  },
}));

import { db } from "@/lib/db";
import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";

const mockDb = db as unknown as {
  post: { findMany: jest.Mock };
  postMetricSnapshot: { findMany: jest.Mock };
  activation: { findMany: jest.Mock };
  campaign: { findUnique: jest.Mock };
  soundTrackerSnapshot: { findMany: jest.Mock };
};

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
    creator,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.postMetricSnapshot.findMany.mockResolvedValue([]);
  // No activations by default — which is the state of every imported campaign,
  // and the reason a leaderboard status is null rather than a default status.
  mockDb.activation.findMany.mockResolvedValue([]);
  // No song by default, so there is no audio card to build.
  mockDb.campaign.findUnique.mockResolvedValue({ song: null });
  mockDb.soundTrackerSnapshot.findMany.mockResolvedValue([]);
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
    expect(result.audio!.usageSeries).toEqual([
      { date: "2026-08-21", uses: 23 },
      { date: "2026-08-22", uses: 44 },
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
    // A zero we did observe is a real measurement and counts.
    expect(result.kpis.saves).toBe(0);
    // Views are carried by every source, including the import, so both count.
    expect(result.kpis.views).toBe(1500);
  });
});
