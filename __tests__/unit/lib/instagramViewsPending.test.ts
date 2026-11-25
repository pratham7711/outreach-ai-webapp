/**
 * An Instagram video that comes back without views is never a clean success.
 *
 * Production, 2026-11-25: three reels added that day showed "views known for 0
 * of 3". Business Discovery was rate-limited (46 refusals in ten hours), the
 * embed filled likes and comments, and the read was filed as "resolved" with no
 * reason -- stored as a success, so nothing knew to ask again. The embed's own
 * view figure stays unused (a different quantity).
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
jest.mock("@/lib/platforms/instagramPostPage", () => ({
  readInstagramPostPage: jest.fn(),
}));

import { fetchInstagramMetrics, fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { fetchInstagramMetricsGraph } from "@/lib/platforms/instagram";
import {
  businessDiscoveryToken,
  fetchInstagramPublicPostMetrics,
} from "@/lib/platforms/instagramBusinessDiscovery";
import { fetchInstagramEmbedPost } from "@/lib/platforms/instagramEmbed";
import { readInstagramPostPage } from "@/lib/platforms/instagramPostPage";
import { InstagramAuthError, InstagramNoSuchAccountError } from "@/lib/platforms/instagram";

const graph = fetchInstagramMetricsGraph as jest.Mock;
const bizToken = businessDiscoveryToken as jest.Mock;
const bizPost = fetchInstagramPublicPostMetrics as jest.Mock;
const embed = fetchInstagramEmbedPost as jest.Mock;
const postPage = readInstagramPostPage as jest.Mock;

const URL = "https://www.instagram.com/reel/DcQFHR5pdYw/";
const PHOTO = "https://www.instagram.com/p/Cabc123/";
const { InstagramRateLimitError, InstagramTimeoutError } = jest.requireActual("@/lib/platforms/instagram");

const EMBED = { likesCount: 120, commentsCount: 4, likesHidden: false, thumbnailUrl: "t.jpg", caption: "c", embedViewCount: 999 };

describe("fetchInstagramMetrics — views that did not arrive", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    graph.mockResolvedValue(null);
    bizToken.mockReturnValue("biz-token");
    bizPost.mockResolvedValue(null);
    embed.mockResolvedValue(EMBED);
    postPage.mockResolvedValue({ kind: "unreadable", thumbnailUrl: null });
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("files a rate-limited Business Discovery read as views-pending and keeps likes and comments", async () => {
    bizPost.mockRejectedValue(new InstagramRateLimitError(4));
    const out = await fetchInstagramMetrics(URL, undefined, "creator.name");
    expect(out.fetchReason).toBe("views-pending");
    expect(out).toMatchObject({ likesCount: 120, commentsCount: 4 });
    expect(out.viewsCount).toBeUndefined();
  });

  it("files a deferred read the same way (a deferral is a rate limit to every caller)", async () => {
    const { InstagramDeferredError } = jest.requireActual("@/lib/platforms/instagramDiscoveryTokens");
    bizPost.mockRejectedValue(new InstagramDeferredError(4, 82, 80));
    const out = await fetchInstagramMetrics(URL, undefined, "creator.name", 80);
    expect(out.fetchReason).toBe("views-pending");
  });

  it("files a Business Discovery timeout as views-pending", async () => {
    bizPost.mockRejectedValue(new InstagramTimeoutError("walk"));
    const out = await fetchInstagramMetrics(URL, undefined, "creator.name");
    expect(out.fetchReason).toBe("views-pending");
    expect(out.likesCount).toBe(120);
  });

  it("files a read made with no Business Discovery token as views-pending", async () => {
    bizToken.mockReturnValue(undefined);
    const out = await fetchInstagramMetrics(URL, undefined, "creator.name");
    expect(out.fetchReason).toBe("views-pending");
  });

  it("files a handle with no Business or Creator account as personal-account", async () => {
    bizPost.mockRejectedValue(new InstagramNoSuchAccountError(33));
    const out = await fetchInstagramMetrics(URL, undefined, "creator.name");
    expect(out.fetchReason).toBe("personal-account");
    expect(out.likesCount).toBe(120);
  });

  it("never uses the embed's own view number as views", async () => {
    bizPost.mockRejectedValue(new InstagramRateLimitError(4));
    const out = await fetchInstagramMetrics(URL, undefined, "creator.name");
    expect(out.viewsCount).toBeUndefined();
  });

  it("carries no reason when Business Discovery brought the views", async () => {
    bizPost.mockResolvedValue({ thumbnailUrl: "t", caption: "c", viewsCount: 5000, likesCount: 10, commentsCount: 1 });
    const out = await fetchInstagramMetrics(URL, undefined, "creator.name");
    expect(out.viewsCount).toBe(5000);
    expect(out.fetchReason).toBeUndefined();
  });

  it("expects no views from a photo or carousel", async () => {
    bizPost.mockRejectedValue(new InstagramRateLimitError(4));
    const out = await fetchInstagramMetrics(PHOTO, undefined, "creator.name", undefined, undefined, "POST");
    expect(out.fetchReason).toBeUndefined();
  });

  it("expects views from a /p/ link the row says is a reel", async () => {
    bizPost.mockRejectedValue(new InstagramRateLimitError(4));
    const out = await fetchInstagramMetrics(PHOTO, undefined, "creator.name", undefined, undefined, "REEL");
    expect(out.fetchReason).toBe("views-pending");
  });
});
