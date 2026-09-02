/**
 * The Instagram chain merges its sources instead of returning the first that
 * answers.
 *
 * Written against the exact production state that exposed the bug: Business
 * Discovery answered for three posts, withheld like_count on two of them
 * (their creators hide likes), and because the old code returned inside that
 * branch, nothing else was ever asked. Both posts stored
 * `__measured: ["views","comments"]` and reported no likes for weeks, while the
 * captioned embed had the real figure available the whole time.
 */
jest.mock("@/lib/platforms/instagram", () => {
  /* The real classes, taken from the real module rather than re-declared here:
     fetchPostMetrics narrows on `instanceof`, so a mock that omits one of them
     makes that branch compare against undefined and throw
     "Right-hand side of 'instanceof' is not an object" instead of doing what it
     was written to do.

     This used to hand-roll InstagramAuthError, which worked until a second
     error class was added upstream and five tests here failed for a reason that
     had nothing to do with what they assert. Spreading the actual module means
     only the network call is a stub, so that cannot happen again. */
  const actual = jest.requireActual("@/lib/platforms/instagram");
  return {
    ...actual,
    fetchInstagramMetricsGraph: jest.fn(),
    shortcodeFromUrl: (u: string) => u.match(/\/(?:p|reel)\/([\w-]+)/)?.[1] ?? null,
  };
});
jest.mock("@/lib/platforms/instagramBusinessDiscovery", () => ({
  businessDiscoveryToken: jest.fn(),
  fetchInstagramPublicPostMetrics: jest.fn(),
}));
jest.mock("@/lib/platforms/instagramEmbed", () => ({
  fetchInstagramEmbedPost: jest.fn(),
}));

import { fetchInstagramMetrics } from "@/lib/platforms/fetchPostMetrics";
import { fetchInstagramMetricsGraph } from "@/lib/platforms/instagram";
import {
  businessDiscoveryToken,
  fetchInstagramPublicPostMetrics,
} from "@/lib/platforms/instagramBusinessDiscovery";
import { fetchInstagramEmbedPost } from "@/lib/platforms/instagramEmbed";
import { InstagramAuthError } from "@/lib/platforms/instagram";

const graph = fetchInstagramMetricsGraph as jest.Mock;
const bizToken = businessDiscoveryToken as jest.Mock;
const bizPost = fetchInstagramPublicPostMetrics as jest.Mock;
const embed = fetchInstagramEmbedPost as jest.Mock;

const URL = "https://www.instagram.com/reel/DcQFHR5pdYw/";

describe("fetchInstagramMetrics — sources are merged, not raced", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    graph.mockResolvedValue(null);
    bizToken.mockReturnValue(undefined);
    bizPost.mockResolvedValue(null);
    embed.mockResolvedValue(null);
    // The metadata-only endpoint at the end of the chain must never be the
    // reason a test passes.
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 })) as any;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("fills a hidden like count from the embed while keeping the official views", async () => {
    bizToken.mockReturnValue("biz-token");
    bizPost.mockResolvedValue({
      thumbnailUrl: "https://cdn/official.jpg",
      caption: "official caption",
      viewsCount: 24245,
      // like_count absent -- the creator hides likes. This is the whole case.
      commentsCount: 12,
      postedAt: new Date("2026-08-20T00:00:00Z"),
    });
    embed.mockResolvedValue({
      shortcode: "DcQFHR5pdYw",
      caption: "embed caption",
      thumbnailUrl: "https://cdn/embed.jpg",
      likesCount: 1428,
      likesHidden: false,
      commentsCount: 9,
      authorFollowers: 114574,
      embedViewCount: 3337,
      copyrightBlocked: true,
    });

    const out = await fetchInstagramMetrics(URL, undefined, "iamswarat");

    // The hole is filled...
    expect(out.likesCount).toBe(1428);
    // ...and nothing official is disturbed. The embed's own view figure (3337)
    // and comment figure (9) both lose to Business Discovery's.
    expect(out.viewsCount).toBe(24245);
    expect(out.commentsCount).toBe(12);
    expect(out.caption).toBe("official caption");
    expect(out.thumbnailUrl).toBe("https://cdn/official.jpg");
    // A measured result carries no failure reason.
    expect(out.fetchReason).toBeUndefined();
  });

  it("never lets the embed's view count become a view count", async () => {
    // Measured: the embed said 3337 for a post the official API put at 24245.
    // With no official view figure at all, the honest answer is still "unknown"
    // -- a number wrong by an unpredictable factor is worse than an absence,
    // because it looks like a measurement.
    embed.mockResolvedValue({
      shortcode: "DcQFHR5pdYw",
      caption: null,
      thumbnailUrl: null,
      likesCount: 1428,
      likesHidden: false,
      commentsCount: 9,
      embedViewCount: 3337,
      copyrightBlocked: false,
    });

    const out = await fetchInstagramMetrics(URL, undefined, "iamswarat");
    expect(out.likesCount).toBe(1428);
    expect(out.viewsCount).toBeUndefined();
    expect(out).not.toHaveProperty("embedViewCount");
  });

  it("an official zero survives the fallback", async () => {
    // A real measured 0 from Graph is data. The merge must not treat it as a
    // hole and overwrite it with the embed's number.
    graph.mockResolvedValue({
      thumbnailUrl: null,
      caption: null,
      viewsCount: 10,
      likesCount: 0,
      commentsCount: 0,
      postedAt: null,
    });
    embed.mockResolvedValue({
      shortcode: "DcQFHR5pdYw",
      caption: null,
      thumbnailUrl: null,
      likesCount: 999,
      likesHidden: false,
      commentsCount: 888,
      copyrightBlocked: false,
    });

    const out = await fetchInstagramMetrics(URL, "creator-token", "iamswarat");
    expect(out.likesCount).toBe(0);
    expect(out.commentsCount).toBe(0);
  });

  it("reaches the embed for a post Business Discovery cannot see at all", async () => {
    // Business Discovery only walks a creator's media list; a post that is not
    // on that account, or is past the pages we walk, returns null. That used to
    // be the end of the road and a permanent "platform-refused".
    bizToken.mockReturnValue("biz-token");
    bizPost.mockResolvedValue(null);
    embed.mockResolvedValue({
      shortcode: "DcQFHR5pdYw",
      caption: "from the embed",
      thumbnailUrl: "https://cdn/embed.jpg",
      likesCount: 1428,
      likesHidden: false,
      commentsCount: 9,
      authorFollowers: 114574,
      copyrightBlocked: false,
    });

    const out = await fetchInstagramMetrics(URL, undefined, "iamswarat");
    expect(out.likesCount).toBe(1428);
    expect(out.commentsCount).toBe(9);
    expect(out.authorFollowers).toBe(114574);
    expect(out.fetchReason).toBeUndefined();
  });

  it("skips the fallback request once the official sources left no hole", async () => {
    graph.mockResolvedValue({
      thumbnailUrl: "https://cdn/official.jpg",
      caption: "c",
      viewsCount: 1,
      likesCount: 2,
      commentsCount: 3,
      postedAt: null,
    });
    await fetchInstagramMetrics(URL, "creator-token", "iamswarat");
    expect(embed).not.toHaveBeenCalled();
  });

  it("still reports a retryable reason when every source is silent", async () => {
    bizToken.mockReturnValue("biz-token");
    const out = await fetchInstagramMetrics(URL, undefined, "iamswarat");
    // platform-refused, not no-counts-published: the latter is a settled claim
    // about the post and is excluded from retries entirely.
    expect(out.fetchReason).toBe("platform-refused");
  });

  it("distinguishes a deployment with no credential from a platform refusal", async () => {
    bizToken.mockReturnValue(undefined);
    const out = await fetchInstagramMetrics(URL, undefined, undefined);
    expect(out.fetchReason).toBe("not-configured");
  });

  it("keeps a partial answer's thumbnail even when no counter was found", async () => {
    // A post whose embed answered but carried only metadata should not lose
    // that metadata just because the result is filed as a failure.
    bizToken.mockReturnValue("biz-token");
    embed.mockResolvedValue({
      shortcode: "DcQFHR5pdYw",
      caption: "metadata only",
      thumbnailUrl: "https://cdn/embed.jpg",
      likesHidden: true,
      copyrightBlocked: false,
    });
    const out = await fetchInstagramMetrics(URL, undefined, "iamswarat");
    expect(out.fetchReason).toBe("platform-refused");
    expect(out.thumbnailUrl).toBe("https://cdn/embed.jpg");
    expect(out.caption).toBe("metadata only");
  });

  it("asks the live oEmbed on graph.facebook.com, not the host that now 500s", async () => {
    // api.instagram.com/oembed answers 500 flat as of 2026-09-02. It was the
    // last link in this chain, so the chain's tail was dead code.
    const urls: string[] = [];
    global.fetch = jest.fn(async (u: any) => {
      urls.push(String(u));
      return { ok: true, json: async () => ({ thumbnail_url: "https://cdn/oembed.jpg", title: "t" }) } as any;
    }) as any;
    bizToken.mockReturnValue("biz-token");

    const out = await fetchInstagramMetrics(URL, undefined, "iamswarat");
    expect(urls[0]).toContain("graph.facebook.com");
    expect(urls[0]).toContain("instagram_oembed");
    expect(urls[0]).not.toContain("api.instagram.com");
    expect(out.thumbnailUrl).toBe("https://cdn/oembed.jpg");
    expect(out.fetchReason).toBe("platform-refused");
  });
});

/**
 * A rejected credential is not the same answer as "this post has no numbers".
 *
 * Both arrive as an absence of counts, and for months they were reported
 * identically -- which is how an expired token came to read as a campaign of
 * posts with no engagement. graphGet now throws InstagramAuthError for it, and
 * these assertions are what say the throw is caught, does not abort the
 * remaining sources, and comes out named.
 */
describe("fetchInstagramMetrics — a rejected credential is named, not silently empty", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    graph.mockResolvedValue(null);
    bizToken.mockReturnValue(undefined);
    bizPost.mockResolvedValue(null);
    embed.mockResolvedValue(null);
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 })) as any;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("reports a dead creator token as credentials-rejected, not platform-refused", async () => {
    graph.mockRejectedValue(new InstagramAuthError(400, 190, "token expired"));

    const m = await fetchInstagramMetrics(URL, "dead-token", undefined);

    expect(m.fetchReason).toBe("credentials-rejected");
  });

  it("reports a rejected INSTAGRAM_BUSINESS_TOKEN as credentials-rejected too", async () => {
    bizToken.mockReturnValue("dead-biz-token");
    bizPost.mockRejectedValue(new InstagramAuthError(401, 190, "bad token"));

    const m = await fetchInstagramMetrics(URL, undefined, "somehandle");

    expect(m.fetchReason).toBe("credentials-rejected");
  });

  it("keeps asking the remaining sources after the token is rejected", async () => {
    graph.mockRejectedValue(new InstagramAuthError(400, 190, "token expired"));
    bizToken.mockReturnValue("biz-token");

    await fetchInstagramMetrics(URL, "dead-token", "somehandle");

    // The creator's token dying says nothing about our own token or the embed.
    expect(bizPost).toHaveBeenCalled();
    expect(embed).toHaveBeenCalled();
  });

  it("does not call it a credential problem when a later source answers", async () => {
    graph.mockRejectedValue(new InstagramAuthError(400, 190, "token expired"));
    embed.mockResolvedValue({
      likesCount: 1428,
      commentsCount: 12,
      likesHidden: false,
      thumbnailUrl: "t.jpg",
      caption: "c",
    });

    const m = await fetchInstagramMetrics(URL, "dead-token", undefined);

    expect(m.likesCount).toBe(1428);
    expect(m.fetchReason).toBeUndefined();
  });

  it("lets a non-auth failure out rather than mislabelling it", async () => {
    graph.mockRejectedValue(new Error("socket hang up"));

    await expect(fetchInstagramMetrics(URL, "some-token", undefined)).rejects.toThrow(
      "socket hang up",
    );
  });
});
