/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({
  db: {
    creatorProfileLink: { findMany: jest.fn(), update: jest.fn() },
    creator: { update: jest.fn(), updateMany: jest.fn() },
    creatorPlatformAccountId: { findMany: jest.fn(), upsert: jest.fn() },
  },
}));
jest.mock("@/lib/creators/accountIdTables", () => ({ accountIdTablesReady: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/creators/followerWriter", () => ({ protectedCreatorFollowers: jest.fn() }));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));
jest.mock("@/lib/creators/avatarStore", () => ({ captureLatestAvatar: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn() }));
jest.mock("@/lib/platforms/tiktokTopPostsEmbed", () => ({ readTikTokTopPostsEmbed: jest.fn(), embedHtmlVia: jest.fn() }));

import { db } from "@/lib/db";
import { readCreatorProfile } from "@/lib/platforms/creatorProfile";
import { captureLatestAvatar } from "@/lib/creators/avatarStore";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { protectedCreatorFollowers } from "@/lib/creators/followerWriter";
import { embedHtmlVia, readTikTokTopPostsEmbed } from "@/lib/platforms/tiktokTopPostsEmbed";
import { EMBED_GIVE_UP_STREAK, PROFILE_REFRESH_MS, refreshRosterProfiles } from "@/lib/creators/profileRefresh";

const mockDb = db as any;
const mockRead = readCreatorProfile as jest.Mock;
const mockCapture = captureLatestAvatar as jest.Mock;
const mockEmbed = readTikTokTopPostsEmbed as jest.Mock;
const NOW = Date.parse("2026-09-29T10:00:00Z");

const link = (over: Record<string, unknown> = {}) => ({
  id: "l1", creatorId: "c1", orgId: "org-1", platform: "TIKTOK", handle: "synthpage", isPrimary: true, creator: { trackedSince: null }, ...over,
});
const profile = (over: Record<string, unknown> = {}) => ({
  ok: true,
  profile: { followersCount: 51000, postsCount: 80, avgViews: 9000, sampledPosts: 12, avatarUrl: "https://cdn.example/p.jpg", ...over },
});

beforeEach(() => {
  jest.clearAllMocks();
  (rosterTablesReady as jest.Mock).mockResolvedValue(true);
  mockCapture.mockResolvedValue(true);
  (protectedCreatorFollowers as jest.Mock).mockResolvedValue(null);
  mockEmbed.mockResolvedValue(null);
});

describe("refreshRosterProfiles", () => {
  it("takes due accounts only, least recently read first", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([]);
    await refreshRosterProfiles({ nowMs: NOW, limit: 40 });
    const args = mockDb.creatorProfileLink.findMany.mock.calls[0][0];
    expect(args.where.OR).toEqual([{ refreshedAt: null }, { refreshedAt: { lt: new Date(NOW - PROFILE_REFRESH_MS) } }]);
    expect(args.where.creator).toEqual({ deletedAt: null });
    expect(args.orderBy[0]).toEqual({ refreshedAt: { sort: "asc", nulls: "first" } });
    expect(args.take).toBe(40);
  });

  it("writes the primary account's figures onto the creator and stores its picture", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link()]);
    mockRead.mockResolvedValue(profile());
    const counts = await refreshRosterProfiles({ nowMs: NOW });
    expect(mockDb.creatorProfileLink.update).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: { followersCount: 51000, averageViews: 9000, refreshedAt: new Date(NOW), refreshError: null },
    });
    expect(mockDb.creator.update).toHaveBeenCalledWith({ where: { id: "c1", orgId: "org-1" }, data: { followersCount: 51000, averageViews: 9000 } });
    expect(mockCapture).toHaveBeenCalledWith({ id: "c1", orgId: "org-1" }, "https://cdn.example/p.jpg", NOW);
    expect(counts).toMatchObject({ considered: 1, refreshed: 1, avatars: 1, failed: 0 });
  });

  it("leaves the creator row alone for a secondary account, and keeps views a read did not measure", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link({ platform: "INSTAGRAM", isPrimary: false })]);
    mockRead.mockResolvedValue(profile({ sampledPosts: 0, avgViews: 0 }));
    await refreshRosterProfiles({ nowMs: NOW });
    expect(mockDb.creatorProfileLink.update.mock.calls[0][0].data).toEqual({ followersCount: 51000, refreshedAt: new Date(NOW), refreshError: null });
    expect(mockDb.creator.update).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("falls back to the sandbox for TikTok", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link()]);
    mockRead.mockResolvedValue({ ok: false, reason: "unreadable", detail: "login shell" });
    const remote = jest.fn().mockResolvedValue(profile());
    const counts = await refreshRosterProfiles({ nowMs: NOW, readTikTokProfileRemote: remote });
    expect(remote).toHaveBeenCalledWith("synthpage");
    expect(counts.refreshed).toBe(1);
  });

  it("stamps a failed read so it waits a day instead of blocking the queue", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link({ platform: "YOUTUBE" })]);
    mockRead.mockResolvedValue({ ok: false, reason: "no-such-account" });
    const counts = await refreshRosterProfiles({ nowMs: NOW });
    expect(mockDb.creatorProfileLink.update).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: { refreshedAt: new Date(NOW), refreshError: "no-such-account" },
    });
    expect(mockDb.creator.update).not.toHaveBeenCalled();
    expect(counts).toMatchObject({ failed: 1, refreshed: 0 });
  });

  it("stops reading a platform once it rate-limits, and leaves those accounts due", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([
      link({ id: "l1", platform: "INSTAGRAM", handle: "one" }),
      link({ id: "l2", platform: "INSTAGRAM", handle: "two" }),
      link({ id: "l3", platform: "YOUTUBE", handle: "three" }),
    ]);
    mockRead.mockImplementation(async (platform: string) =>
      platform === "INSTAGRAM" ? { ok: false, reason: "rate-limited", detail: "(#4) Application request limit reached" } : profile(),
    );
    const counts = await refreshRosterProfiles({ nowMs: NOW });
    expect(mockRead.mock.calls.map((c) => c[0])).toEqual(["INSTAGRAM", "YOUTUBE"]);
    const touched = mockDb.creatorProfileLink.update.mock.calls.map((c: any[]) => c[0].where.id);
    expect(touched).toEqual(["l3"]);
    expect(counts).toMatchObject({ refreshed: 1, failed: 0, skipped: 2 });
  });

  it("does nothing before the roster tables exist", async () => {
    (rosterTablesReady as jest.Mock).mockResolvedValue(false);
    expect(await refreshRosterProfiles({ nowMs: NOW })).toMatchObject({ considered: 0 });
    expect(mockDb.creatorProfileLink.findMany).not.toHaveBeenCalled();
  });

  it("stops at its deadline and counts the rest as skipped", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link(), link({ id: "l2" })]);
    mockRead.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return profile();
    });
    const counts = await refreshRosterProfiles({ nowMs: NOW, deadlineMs: 10 });
    expect(counts).toMatchObject({ considered: 1, skipped: 1 });
  });

  /* Plan A7: this read is public, so a connected figure the tracker wrote onto
     the creator inside its freshness window stays. */
  it("leaves a fresh connected follower figure on the creator and still writes the averages", async () => {
    (protectedCreatorFollowers as jest.Mock).mockResolvedValue(51_234);
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link()]);
    mockRead.mockResolvedValue(profile());
    await refreshRosterProfiles({ nowMs: NOW });
    expect(protectedCreatorFollowers).toHaveBeenCalledWith("c1", new Date(NOW));
    expect(mockDb.creator.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", orgId: "org-1", NOT: { followersCount: 51_234 } },
      data: { followersCount: 51000 },
    });
    expect(mockDb.creator.update).toHaveBeenCalledWith({ where: { id: "c1", orgId: "org-1" }, data: { averageViews: 9000 } });
  });

  it("writes no empty update when a protected creator's read sampled no posts", async () => {
    (protectedCreatorFollowers as jest.Mock).mockResolvedValue(51_234);
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link()]);
    mockRead.mockResolvedValue(profile({ sampledPosts: 0 }));
    await refreshRosterProfiles({ nowMs: NOW });
    expect(mockDb.creator.updateMany).toHaveBeenCalledTimes(1);
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it("does not ask about a non-primary account, which never writes the creator", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link({ isPrimary: false })]);
    mockRead.mockResolvedValue(profile());
    await refreshRosterProfiles({ nowMs: NOW });
    expect(protectedCreatorFollowers).not.toHaveBeenCalled();
  });

  describe("TikTok Avg. views from the embed page", () => {
    /* TikTok's profile page has followers and no per-video views, so its read
       always comes back with sampledPosts 0. */
    const tiktokProfile = () => profile({ avgViews: 0, sampledPosts: 0 });
    const embed = { avgViews: 48_200, sampledPosts: 10, topPosts: [] };

    it("measures an untracked creator's average from its embed page and writes it to the account and the creator", async () => {
      mockDb.creatorProfileLink.findMany.mockResolvedValue([link()]);
      mockRead.mockResolvedValue(tiktokProfile());
      mockEmbed.mockResolvedValue(embed);
      const counts = await refreshRosterProfiles({ nowMs: NOW });
      expect(mockEmbed).toHaveBeenCalledWith("synthpage", expect.any(Function));
      expect(mockDb.creatorProfileLink.update.mock.calls[0][0].data).toMatchObject({ averageViews: 48_200, followersCount: 51000 });
      expect(mockDb.creator.update).toHaveBeenCalledWith({ where: { id: "c1", orgId: "org-1" }, data: { followersCount: 51000, averageViews: 48_200 } });
      expect(counts.embedViews).toBe(1);
    });

    it("fetches the page direct first and through the run's sandbox reader after", async () => {
      mockDb.creatorProfileLink.findMany.mockResolvedValue([link()]);
      mockRead.mockResolvedValue(tiktokProfile());
      const injected = jest.fn();
      await refreshRosterProfiles({ nowMs: NOW, readTikTokEmbedHtml: injected });
      await mockEmbed.mock.calls[0][1]("synthpage");
      expect(embedHtmlVia).toHaveBeenCalledWith("synthpage", injected);
    });

    it("leaves a tracked creator to the tracker, which already reads its videos", async () => {
      mockDb.creatorProfileLink.findMany.mockResolvedValue([link({ creator: { trackedSince: new Date(NOW) } })]);
      mockRead.mockResolvedValue(tiktokProfile());
      await refreshRosterProfiles({ nowMs: NOW });
      expect(mockEmbed).not.toHaveBeenCalled();
    });

    it("does not ask when the profile read already measured views, or for another platform", async () => {
      mockDb.creatorProfileLink.findMany.mockResolvedValue([link(), link({ id: "l2", platform: "INSTAGRAM" })]);
      mockRead.mockImplementation(async (platform: string) => (platform === "TIKTOK" ? profile() : tiktokProfile()));
      await refreshRosterProfiles({ nowMs: NOW });
      expect(mockEmbed).not.toHaveBeenCalled();
    });

    it("keeps the held average when the embed page lists nothing", async () => {
      mockDb.creatorProfileLink.findMany.mockResolvedValue([link()]);
      mockRead.mockResolvedValue(tiktokProfile());
      const counts = await refreshRosterProfiles({ nowMs: NOW });
      expect(mockDb.creatorProfileLink.update.mock.calls[0][0].data).not.toHaveProperty("averageViews");
      expect(mockDb.creator.update.mock.calls[0][0].data).not.toHaveProperty("averageViews");
      expect(counts.embedViews).toBe(0);
    });

    it(`stops asking for the rest of the run after ${EMBED_GIVE_UP_STREAK} empty answers in a row, still reading followers`, async () => {
      const links = Array.from({ length: EMBED_GIVE_UP_STREAK + 3 }, (_, i) => link({ id: `l${i}`, creatorId: `c${i}`, handle: `h${i}` }));
      mockDb.creatorProfileLink.findMany.mockResolvedValue(links);
      mockRead.mockResolvedValue(tiktokProfile());
      const counts = await refreshRosterProfiles({ nowMs: NOW });
      expect(mockEmbed).toHaveBeenCalledTimes(EMBED_GIVE_UP_STREAK);
      expect(counts.refreshed).toBe(links.length);
    });

    it("forgives a miss once an answer arrives", async () => {
      const links = Array.from({ length: EMBED_GIVE_UP_STREAK + 4 }, (_, i) => link({ id: `l${i}`, creatorId: `c${i}`, handle: `h${i}` }));
      mockDb.creatorProfileLink.findMany.mockResolvedValue(links);
      mockRead.mockResolvedValue(tiktokProfile());
      // Misses, then one answer, then misses: the streak restarts at the answer.
      mockEmbed.mockImplementation(async (handle: string) => (handle === `h${EMBED_GIVE_UP_STREAK - 1}` ? embed : null));
      const counts = await refreshRosterProfiles({ nowMs: NOW });
      expect(mockEmbed).toHaveBeenCalledTimes(links.length);
      expect(counts.embedViews).toBe(1);
    });
  });
});

/**
 * The shared validation gate (plan A3). Rules are tested in
 * __tests__/unit/lib/acquisition/validate.test.ts; these pin what the roster
 * refresh does when one fires.
 */
describe("refreshRosterProfiles — the validation gate", () => {
  beforeEach(() => {
    mockDb.creatorPlatformAccountId.findMany.mockResolvedValue([]);
    mockDb.creatorPlatformAccountId.upsert.mockResolvedValue({});
  });

  it("refuses a 0 over the account's real figure, stamps why, and writes nothing else", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link({ followersCount: 51_000, averageViews: 9_000 })]);
    mockRead.mockResolvedValue(profile({ followersCount: 0, postsCount: 0, sampledPosts: 0, avgViews: 0 }));
    const counts = await refreshRosterProfiles({ nowMs: NOW });
    expect(mockDb.creatorProfileLink.update).toHaveBeenCalledTimes(1);
    expect(mockDb.creatorProfileLink.update).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: { refreshedAt: new Date(NOW), refreshError: "reading-rejected: fell-to-zero: followers fell to 0 from 51000" },
    });
    expect(mockDb.creator.update).not.toHaveBeenCalled();
    expect(mockDb.creator.updateMany).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(counts).toMatchObject({ rejected: 1, refreshed: 0, failed: 0 });
  });

  it("judges a primary account never read against the creator's own figure", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([
      link({ followersCount: null, creator: { trackedSince: null, followersCount: 51_000, averageViews: 9_000 } }),
    ]);
    mockRead.mockResolvedValue(profile({ followersCount: 0 }));
    expect(await refreshRosterProfiles({ nowMs: NOW })).toMatchObject({ rejected: 1 });
  });

  it("takes a first reading of an account nothing was ever held for", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([
      link({ isPrimary: false, platform: "INSTAGRAM", followersCount: null, creator: { trackedSince: null, followersCount: 51_000 } }),
    ]);
    mockRead.mockResolvedValue(profile({ followersCount: 0, sampledPosts: 0, avgViews: 0 }));
    expect(await refreshRosterProfiles({ nowMs: NOW })).toMatchObject({ rejected: 0, refreshed: 1 });
  });

  it("refuses a different account answering to a handle bound to another", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link({ followersCount: 51_000 })]);
    mockDb.creatorPlatformAccountId.findMany.mockResolvedValue([{ platformAccountId: "6800000000000000001", handle: "synthpage" }]);
    mockRead.mockResolvedValue(profile({ followersCount: 120, accountId: "7300000000000000002" }));
    const counts = await refreshRosterProfiles({ nowMs: NOW });
    expect(mockDb.creatorProfileLink.update.mock.calls[0][0].data.refreshError).toMatch(/^reading-rejected: account-mismatch: /);
    expect(mockDb.creator.update).not.toHaveBeenCalled();
    // And the stranger's id is not kept as this creator's.
    expect(mockDb.creatorPlatformAccountId.upsert).not.toHaveBeenCalled();
    expect(counts.rejected).toBe(1);
  });

  it("keeps the held average when a read's average over real samples fell to 0, and still writes followers", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link({ followersCount: 51_000, averageViews: 9_000 })]);
    mockRead.mockResolvedValue(profile({ followersCount: 51_200, avgViews: 0, sampledPosts: 12 }));
    await refreshRosterProfiles({ nowMs: NOW });
    expect(mockDb.creatorProfileLink.update.mock.calls[0][0].data).toEqual({
      followersCount: 51_200,
      refreshedAt: new Date(NOW),
      refreshError: null,
    });
    expect(mockDb.creator.update).toHaveBeenCalledWith({ where: { id: "c1", orgId: "org-1" }, data: { followersCount: 51_200 } });
  });

  it("writes a real drop that is not to 0", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link({ followersCount: 51_000, averageViews: 9_000 })]);
    mockRead.mockResolvedValue(profile({ followersCount: 30_100, avgViews: 2_200, sampledPosts: 12 }));
    expect(await refreshRosterProfiles({ nowMs: NOW })).toMatchObject({ rejected: 0, refreshed: 1 });
    expect(mockDb.creator.update).toHaveBeenCalledWith({
      where: { id: "c1", orgId: "org-1" },
      data: { followersCount: 30_100, averageViews: 2_200 },
    });
  });
});
