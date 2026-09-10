import {
  READ_FAILURE_COPY,
  readCreatorProfile,
  type CreatorReadFailure,
} from "@/lib/platforms/creatorProfile";

describe("readCreatorProfile dispatch", () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env };
  });
  afterAll(() => {
    process.env = env;
  });

  it("does not claim to read platforms it has no reader for", async () => {
    // TikTok used to be listed here, back when it needed a browser the caller
    // had to inject. Profile pages turned out to be server-rendered, so it is
    // now dispatched from here like the rest and no longer belongs in this set.
    for (const platform of ["TWITTER", "TWITCH", "THREADS"]) {
      await expect(readCreatorProfile(platform, "someone")).resolves.toEqual({
        ok: false,
        reason: "unsupported-platform",
      });
    }
  });

  it("reports a missing token as missing credentials, not as an unreadable creator", async () => {
    // These are entirely different problems: one is our configuration, the other
    // is the creator's account. Collapsing them would send someone to check a
    // creator's privacy settings over an env var we never set.
    delete process.env.INSTAGRAM_BUSINESS_TOKEN;
    await expect(readCreatorProfile("INSTAGRAM", "someone")).resolves.toEqual({
      ok: false,
      reason: "no-credentials",
    });

    delete process.env.YOUTUBE_API_KEY;
    await expect(readCreatorProfile("YOUTUBE", "someone")).resolves.toEqual({
      ok: false,
      reason: "no-credentials",
    });
  });

  it("rejects an empty YouTube handle before spending a quota unit on it", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const result = await readCreatorProfile("YOUTUBE", "  @  ");
    expect(result.ok).toBe(false);
  });

  it("is case-insensitive about the platform, which arrives from a Prisma enum", async () => {
    delete process.env.YOUTUBE_API_KEY;
    await expect(readCreatorProfile("youtube", "x")).resolves.toEqual({
      ok: false,
      reason: "no-credentials",
    });
  });
});

/*
 * A withheld subscriber count must never become a measured zero.
 *
 * Measured on prod 2026-09-10: a tracked YouTube creator had 100 consecutive
 * snapshots of followersCount 0 going back to 2026-09-01, trackerLastError
 * NULL throughout, while postsCount and avgViews were non-zero. Nothing had
 * failed, so nothing was retried and nothing was flagged -- the chart simply
 * drew a flat line that looked like a creator who had stopped growing.
 *
 * The cause is that the Data API reports a hidden count as the STRING "0"
 * alongside hiddenSubscriberCount: true, rather than omitting the field, so a
 * finite-number check passes it straight through.
 */
describe("readYouTube subscriber counts", () => {
  const env = process.env;
  const realFetch = global.fetch;

  /** channels -> playlistItems -> videos, in the order readYouTube calls them. */
  function mockYouTube(statistics: Record<string, unknown>) {
    global.fetch = jest.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes("/channels")
        ? { items: [{ statistics, contentDetails: { relatedPlaylists: {} } }] }
        : { items: [] };
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    process.env = { ...env, YOUTUBE_API_KEY: "test-key" };
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env = env;
  });

  it("treats a hidden subscriber count as unreadable rather than as zero followers", async () => {
    mockYouTube({ hiddenSubscriberCount: true, subscriberCount: "0", videoCount: "1" });

    const result = await readCreatorProfile("YOUTUBE", "phonknow");

    expect(result).toEqual({
      ok: false,
      reason: "unreadable",
      detail: "subscriberCount hidden",
    });
  });

  it("still reads a channel that genuinely has zero subscribers", async () => {
    // The guard above must key on the flag, not on the number -- a new channel
    // with a real, public count of 0 is a successful read, and rejecting it
    // would trade one silent wrong answer for another.
    mockYouTube({ hiddenSubscriberCount: false, subscriberCount: "0", videoCount: "1" });

    const result = await readCreatorProfile("YOUTUBE", "brandnew");

    expect(result.ok).toBe(true);
    expect(result.ok && result.profile.followersCount).toBe(0);
  });

  it("reads a normal public count unchanged", async () => {
    mockYouTube({ subscriberCount: "2654363", videoCount: "42" });

    const result = await readCreatorProfile("YOUTUBE", "sonheii");

    expect(result.ok).toBe(true);
    expect(result.ok && result.profile.followersCount).toBe(2654363);
  });
});

describe("READ_FAILURE_COPY", () => {
  it("has reader-facing copy for every failure the reader can produce", () => {
    // A missing entry renders as undefined in the UI, which is worse than the
    // blank cell this whole change set out to remove.
    const all: CreatorReadFailure[] = [
      "no-credentials",
      "unsupported-platform",
      "not-a-professional-account",
      "unreadable",
      "rate-limited",
    ];
    for (const reason of all) {
      expect(typeof READ_FAILURE_COPY[reason]).toBe("string");
      expect(READ_FAILURE_COPY[reason].length).toBeGreaterThan(10);
    }
  });

  it("explains the Instagram case specifically, since it is permanent", () => {
    expect(READ_FAILURE_COPY["not-a-professional-account"]).toMatch(/Business and Creator/i);
  });
});

describe("rankTopPosts", () => {
  const { rankTopPosts, TOP_POSTS_LIMIT } = jest.requireActual("@/lib/platforms/creatorProfile");
  const post = (postId: string, views: number | null, likes: number | null = null) => ({
    postId, url: null, caption: null, coverUrl: null,
    views, likes, comments: null, postedAt: null,
  });

  it("ranks by views and caps at the limit", () => {
    const posts = Array.from({ length: TOP_POSTS_LIMIT + 4 }, (_, i) => post(`p${i}`, i * 100));
    const ranked = rankTopPosts(posts);
    expect(ranked).toHaveLength(TOP_POSTS_LIMIT);
    expect(ranked[0].postId).toBe(`p${TOP_POSTS_LIMIT + 3}`);
  });

  it("lets a still with only likes compete instead of excluding it", () => {
    // Instagram omits view_count on stills rather than sending zero. A still
    // with real engagement should rank above a reel nobody watched.
    const ranked = rankTopPosts([post("reel", 5), post("still", null, 900)]);
    expect(ranked[0].postId).toBe("still");
  });

  it("does not mutate the caller's array", () => {
    const posts = [post("a", 1), post("b", 2)];
    rankTopPosts(posts);
    expect(posts[0].postId).toBe("a");
  });
});
