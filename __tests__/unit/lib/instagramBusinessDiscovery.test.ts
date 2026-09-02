/**
 * Business Discovery reads a creator's media 100 at a time. Without following
 * the cursor, a campaign post older than a prolific creator's newest 100 media
 * was not merely unmeasured -- it was unreachable, and every refresh retried
 * the same blind lookup forever.
 */
jest.mock("@/lib/platforms/instagram", () => ({
  graphGet: jest.fn(),
  resolveIgUserId: jest.fn(async () => "ig-user-1"),
  shortcodeFromUrl: (u: string) => u.match(/\/(?:p|reel)\/([\w-]+)/)?.[1] ?? null,
}));

import {
  parseBusinessDiscovery,
  fetchInstagramPublicPostMetrics,
  MAX_MEDIA_PAGES,
  MEDIA_PAGE_SIZE,
} from "@/lib/platforms/instagramBusinessDiscovery";
import { graphGet } from "@/lib/platforms/instagram";

const get = graphGet as jest.Mock;

function media(shortcode: string, extra: Record<string, unknown> = {}) {
  return {
    id: `id-${shortcode}`,
    permalink: `https://www.instagram.com/p/${shortcode}/`,
    comments_count: 3,
    timestamp: "2026-08-01T00:00:00+0000",
    thumbnail_url: `https://cdn/${shortcode}.jpg`,
    ...extra,
  };
}

function page(nodes: unknown[], after?: string) {
  return {
    business_discovery: {
      followers_count: 114574,
      media_count: 420,
      media: { data: nodes, ...(after ? { paging: { cursors: { after } } } : {}) },
    },
  };
}

describe("parseBusinessDiscovery", () => {
  it("surfaces the media cursor when Instagram sends one", () => {
    expect(parseBusinessDiscovery(page([media("AAA")], "CURSOR_1"), "creator")?.nextMediaCursor)
      .toBe("CURSOR_1");
  });

  it("leaves the cursor absent on the last page", () => {
    expect(parseBusinessDiscovery(page([media("AAA")]), "creator")).not.toHaveProperty(
      "nextMediaCursor",
    );
  });

  it("keeps an absent counter absent rather than reading it as zero", () => {
    // like_count is dropped by Instagram whenever a creator hides their likes.
    const parsed = parseBusinessDiscovery(page([media("AAA", { view_count: 500 })]), "creator");
    expect(parsed?.recentPosts[0]).not.toHaveProperty("likesCount");
    expect(parsed?.recentPosts[0].viewsCount).toBe(500);
  });
});

describe("fetchInstagramPublicPostMetrics — paging", () => {
  beforeEach(() => jest.clearAllMocks());

  it("finds the post on the first page without asking for a second", async () => {
    get.mockResolvedValueOnce(page([media("WANTED", { like_count: 10 })], "CURSOR_1"));
    const out = await fetchInstagramPublicPostMetrics(
      "creator",
      "https://www.instagram.com/p/WANTED/",
      "tok",
    );
    expect(out?.likesCount).toBe(10);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("follows the cursor to a post that is past the first hundred", async () => {
    get
      .mockResolvedValueOnce(page([media("OTHER1")], "CURSOR_1"))
      .mockResolvedValueOnce(page([media("OTHER2")], "CURSOR_2"))
      .mockResolvedValueOnce(page([media("WANTED", { like_count: 77, view_count: 900 })]));

    const out = await fetchInstagramPublicPostMetrics(
      "creator",
      "https://www.instagram.com/p/WANTED/",
      "tok",
    );
    expect(out?.likesCount).toBe(77);
    expect(out?.viewsCount).toBe(900);
    // The follower figure is repeated on every page; it must survive the walk.
    expect(out?.authorFollowers).toBe(114574);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("passes the cursor through to Graph as an edge modifier", async () => {
    get
      .mockResolvedValueOnce(page([media("OTHER1")], "CURSOR_1"))
      .mockResolvedValueOnce(page([media("WANTED", { like_count: 1 })]));
    await fetchInstagramPublicPostMetrics("creator", "https://www.instagram.com/p/WANTED/", "tok");

    expect(get.mock.calls[0][1].fields).toContain(`media.limit(${MEDIA_PAGE_SIZE})`);
    const second = get.mock.calls[1][1].fields;
    expect(second).toContain("media.after(CURSOR_1)");
    expect(second).toContain(`.limit(${MEDIA_PAGE_SIZE})`);
  });

  it("stops at the end of the library rather than looping", async () => {
    // No cursor on the last page means the post is genuinely not on this
    // account -- a different answer from running out of pages.
    get.mockResolvedValueOnce(page([media("OTHER1")]));
    const out = await fetchInstagramPublicPostMetrics(
      "creator",
      "https://www.instagram.com/p/WANTED/",
      "tok",
    );
    expect(out).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("bounds the walk even when Instagram keeps offering cursors", async () => {
    // A refresh has a 260s budget for a whole campaign, so an unbounded walk on
    // one post is a way to starve every post behind it.
    get.mockResolvedValue(page([media("OTHER")], "ALWAYS_MORE"));
    const out = await fetchInstagramPublicPostMetrics(
      "creator",
      "https://www.instagram.com/p/WANTED/",
      "tok",
    );
    expect(out).toBeNull();
    expect(get).toHaveBeenCalledTimes(MAX_MEDIA_PAGES);
  });

  it("gives up immediately on a URL with no shortcode", async () => {
    const out = await fetchInstagramPublicPostMetrics("creator", "https://example.com/x", "tok");
    expect(out).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("stops when Graph itself returns nothing", async () => {
    get.mockResolvedValueOnce(null);
    const out = await fetchInstagramPublicPostMetrics(
      "creator",
      "https://www.instagram.com/p/WANTED/",
      "tok",
    );
    expect(out).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
