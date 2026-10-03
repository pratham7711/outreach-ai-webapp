/**
 * How the roster's Instagram read files a failure decides whether the account
 * is retried next hour or shown to the agency as a handle nobody can find, so
 * a throttle must never come out as "personal account".
 */
jest.mock("@/lib/platforms/instagramBusinessDiscovery", () => ({
  ...jest.requireActual("@/lib/platforms/instagramBusinessDiscovery"),
  businessDiscoveryToken: jest.fn(async () => "tok"),
  fetchInstagramProfile: jest.fn(),
}));
jest.mock("@/lib/platforms/instagram", () => ({
  ...jest.requireActual("@/lib/platforms/instagram"),
  resolveIgUserId: jest.fn(),
}));

import { PROFILE_MEDIA_FIRST_PAGE, readCreatorProfile, resetInstagramReaderState } from "@/lib/platforms/creatorProfile";
import { fetchInstagramProfile, MEDIA_PAGE_SIZE } from "@/lib/platforms/instagramBusinessDiscovery";
import { InstagramNoSuchAccountError, InstagramRateLimitError, resolveIgUserId } from "@/lib/platforms/instagram";

const fetchProfile = fetchInstagramProfile as jest.Mock;
const resolveReader = resolveIgUserId as jest.Mock;

const reel = (n: number, views: number | undefined) => ({
  id: `m${n}`,
  viewsCount: views,
  postedAt: new Date(Date.UTC(2026, 8, 30) - n * 86_400_000),
  permalink: null,
  caption: null,
  thumbnailUrl: null,
});

describe("readCreatorProfile on Instagram", () => {
  beforeEach(() => {
    fetchProfile.mockReset();
    resolveReader.mockReset();
    resolveReader.mockResolvedValue("17841400000000999");
    resetInstagramReaderState();
  });

  it("asks Business Discovery to throw on a rate limit and on a name it has no account for", async () => {
    fetchProfile.mockResolvedValue(null);
    await readCreatorProfile("INSTAGRAM", "someone");
    /* toMatchObject: the token chooser also hands over its usage listener
       (lib/platforms/instagramDiscoveryTokens). */
    expect(fetchProfile.mock.calls[0][4]).toMatchObject({
      rateLimitThrows: true,
      noSuchAccountThrows: true,
      igUserId: "17841400000000999",
      mediaLimit: PROFILE_MEDIA_FIRST_PAGE,
    });
  });

  it("files a Graph throttle as rate-limited, to be retried", async () => {
    fetchProfile.mockRejectedValue(new InstagramRateLimitError(4));
    await expect(readCreatorProfile("INSTAGRAM", "someone")).resolves.toMatchObject({ ok: false, reason: "rate-limited" });
  });

  it("files Graph's 110 as a personal account, which may also be a misspelt handle", async () => {
    fetchProfile.mockRejectedValue(new InstagramNoSuchAccountError(2207013));
    await expect(readCreatorProfile("INSTAGRAM", "someone")).resolves.toEqual({ ok: false, reason: "not-a-professional-account" });
  });

  /* graphGet answers null for a Graph 500 and a dropped connection alike. Those
     are worth another try; a personal account is a handle for someone to fix. */
  it("files any other empty answer as unreadable, not as a personal account", async () => {
    fetchProfile.mockResolvedValue(null);
    await expect(readCreatorProfile("INSTAGRAM", "someone")).resolves.toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("files a token whose own account cannot be looked up as unreadable, and reads nothing", async () => {
    resolveReader.mockResolvedValue(null);
    await expect(readCreatorProfile("INSTAGRAM", "someone")).resolves.toMatchObject({ ok: false, reason: "unreadable" });
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it("files a throttled reader-account lookup as rate-limited", async () => {
    resolveReader.mockRejectedValue(new InstagramRateLimitError(4));
    await expect(readCreatorProfile("INSTAGRAM", "someone")).resolves.toMatchObject({ ok: false, reason: "rate-limited" });
  });

  it("looks the token's own account up once, not once per creator", async () => {
    fetchProfile.mockResolvedValue({ username: "a", followersCount: 1, recentPosts: [] });
    await readCreatorProfile("INSTAGRAM", "first");
    await readCreatorProfile("INSTAGRAM", "second");
    expect(resolveReader).toHaveBeenCalledTimes(1);
    expect(fetchProfile.mock.calls[1][4]).toMatchObject({ igUserId: "17841400000000999" });
  });

  /* Plan A4: the account's own id rides in the same response, so it costs nothing. */
  it("hands on the account's Instagram user id with the figures", async () => {
    fetchProfile.mockResolvedValue({ username: "someone", igUserId: "17841400000000001", followersCount: 900, recentPosts: [] });
    const res = await readCreatorProfile("INSTAGRAM", "someone");
    expect(res).toMatchObject({ ok: true, profile: { followersCount: 900, accountId: "17841400000000001" } });
  });

  describe("how many media it asks for", () => {
    it("stops at the first page when it already holds ten reels", async () => {
      fetchProfile.mockResolvedValue({
        username: "someone",
        followersCount: 900,
        recentPosts: Array.from({ length: 12 }, (_, i) => reel(i, 1000)),
        nextMediaCursor: "c1",
      });
      const res = await readCreatorProfile("INSTAGRAM", "someone");
      expect(fetchProfile).toHaveBeenCalledTimes(1);
      expect(res).toMatchObject({ ok: true, profile: { sampledPosts: 10, avgViews: 1000 } });
    });

    it("reads the rest of the hundred when the first page holds fewer than ten reels", async () => {
      fetchProfile
        .mockResolvedValueOnce({
          username: "someone",
          followersCount: 900,
          recentPosts: [reel(0, 300), reel(1, undefined) /* a still: no view_count */, reel(2, 300)],
          nextMediaCursor: "c1",
        })
        .mockResolvedValueOnce({
          username: "someone",
          followersCount: 900,
          recentPosts: Array.from({ length: 8 }, (_, i) => reel(10 + i, 600)),
        });
      const res = await readCreatorProfile("INSTAGRAM", "someone");
      expect(fetchProfile).toHaveBeenCalledTimes(2);
      expect(fetchProfile.mock.calls[1][3]).toBe("c1");
      expect(fetchProfile.mock.calls[1][4]).toMatchObject({ mediaLimit: MEDIA_PAGE_SIZE - PROFILE_MEDIA_FIRST_PAGE });
      // 2 reels at 300 from page one, the newest 8 at 600 from page two.
      expect(res).toMatchObject({ ok: true, profile: { sampledPosts: 10, avgViews: 540, followersCount: 900 } });
    });

    it("keeps the first page when the second one fails", async () => {
      fetchProfile
        .mockResolvedValueOnce({ username: "someone", followersCount: 900, recentPosts: [reel(0, 300)], nextMediaCursor: "c1" })
        .mockRejectedValueOnce(new InstagramRateLimitError(4));
      const res = await readCreatorProfile("INSTAGRAM", "someone");
      expect(res).toMatchObject({ ok: true, profile: { followersCount: 900, sampledPosts: 1, avgViews: 300 } });
    });

    it("does not ask for a second page that does not exist", async () => {
      fetchProfile.mockResolvedValue({ username: "someone", followersCount: 900, recentPosts: [reel(0, 300)] });
      await readCreatorProfile("INSTAGRAM", "someone");
      expect(fetchProfile).toHaveBeenCalledTimes(1);
    });
  });
});
