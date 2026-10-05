jest.mock("@/lib/db", () => ({ db: {} }));
jest.mock("@/lib/platforms/facebookPage", () => ({
  fetchFacebookPage: jest.fn(),
  fetchFacebookPagePermalinks: jest.fn(),
  fetchFacebookPost: jest.fn(),
}));

import { detectPlatform, fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { parseFacebookLink } from "@/lib/platforms/postUrl";
import { resolveFacebookPost, type ConnectedFacebookPage } from "@/lib/platforms/facebookPost";
import {
  fetchFacebookPage,
  fetchFacebookPagePermalinks,
  fetchFacebookPost,
} from "@/lib/platforms/facebookPage";
import { InstagramAuthError } from "@/lib/platforms/instagram";

const pageRead = fetchFacebookPage as jest.Mock;
const permalinks = fetchFacebookPagePermalinks as jest.Mock;
const postRead = fetchFacebookPost as jest.Mock;

/**
 * An agency pastes whatever Facebook's share sheet gave them and expects the
 * post to land under the right creator without being asked whose it is. The
 * parser decides what the link says; the matcher decides which connected Page
 * it is on. A wrong match files one creator's numbers under another.
 */
describe("parseFacebookLink / detectPlatform", () => {
  const cases: [string, ReturnType<typeof parseFacebookLink>][] = [
    ["https://www.facebook.com/boringbrand/posts/1234567890", { kind: "post", id: "1234567890", pageRef: "boringbrand" }],
    ["https://www.facebook.com/boringbrand/posts/pfbid02abcXYZ123", { kind: "post", id: "pfbid02abcXYZ123", pageRef: "boringbrand" }],
    ["https://www.facebook.com/permalink.php?story_fbid=987654321&id=1122334455", { kind: "post", id: "987654321", pageRef: "1122334455" }],
    ["https://m.facebook.com/story.php?story_fbid=pfbid0xyz&id=1122334455", { kind: "post", id: "pfbid0xyz", pageRef: "1122334455" }],
    ["https://www.facebook.com/boringbrand/videos/launch-day/555666777/", { kind: "video", id: "555666777", pageRef: "boringbrand" }],
    ["https://www.facebook.com/boringbrand/photos/a.111/222333444/", { kind: "photo", id: "222333444", pageRef: "boringbrand" }],
    ["https://www.facebook.com/watch/?v=555666777", { kind: "video", id: "555666777" }],
    ["https://www.facebook.com/reel/888999000", { kind: "reel", id: "888999000" }],
    ["https://www.facebook.com/photo/?fbid=222333444", { kind: "photo", id: "222333444" }],
    ["https://www.facebook.com/share/p/1AbCdEfG/", { kind: "post", id: "1AbCdEfG", shared: true }],
    ["https://www.facebook.com/share/r/1AbCdEfG/", { kind: "reel", id: "1AbCdEfG", shared: true }],
    ["https://fb.watch/qWeRtY/", { kind: "video", id: "qWeRtY", shared: true }],
    ["https://www.facebook.com/groups/12345/posts/67890/", { kind: "group", id: "67890" }],
    ["facebook.com/boringbrand/posts/1234567890", { kind: "post", id: "1234567890", pageRef: "boringbrand" }],
  ];

  it.each(cases)("reads %s", (url, expected) => {
    expect(parseFacebookLink(url)).toEqual(expected);
  });

  it.each([
    "https://www.facebook.com/boringbrand",
    "https://www.facebook.com/boringbrand/about",
    "https://www.facebook.com/events/123456/",
    "https://www.facebook.com/profile.php?id=1122334455",
    "https://www.facebook.com/marketplace/item/123456/",
    "https://www.facebook.com/boringbrand/posts/not-an-id",
    "https://notfacebook.com/boringbrand/posts/1234567890",
    "https://www.facebook.com.evil.example/boringbrand/posts/1234567890",
  ])("refuses %s, which is not a post", (url) => {
    expect(parseFacebookLink(url)).toBeNull();
    expect(detectPlatform(url)).toBeNull();
  });

  it("carries a vanity Page name as the handle, but never a numeric Page id", () => {
    expect(detectPlatform("https://www.facebook.com/boringbrand/posts/1234567890")).toEqual({
      platform: "FACEBOOK",
      id: "1234567890",
      mediaType: "POST",
      handle: "boringbrand",
    });
    expect(detectPlatform("https://www.facebook.com/permalink.php?story_fbid=987654321&id=1122334455")).toEqual({
      platform: "FACEBOOK",
      id: "987654321",
      mediaType: "POST",
    });
  });

  it("calls a reel a REEL and a video a VIDEO", () => {
    expect(detectPlatform("https://www.facebook.com/reel/888999000")?.mediaType).toBe("REEL");
    expect(detectPlatform("https://www.facebook.com/watch/?v=555666777")?.mediaType).toBe("VIDEO");
  });
});

const BRAND: ConnectedFacebookPage = {
  creatorId: "creator-brand",
  connectionId: "conn-brand",
  pageId: "1122334455",
  handle: "boringbrand",
  userToken: "user-token-brand",
};
const OTHER: ConnectedFacebookPage = {
  creatorId: "creator-other",
  connectionId: "conn-other",
  pageId: "9988776655",
  handle: "Other Page",
  userToken: "user-token-other",
};

function pageFor(p: ConnectedFacebookPage) {
  return { pageId: p.pageId, pageAccessToken: `page-token-${p.pageId}` };
}

function postWith(id: string) {
  return { id, exact: { views: 10, likes: 2, comments: 1, shares: 0 }, coverImageUrl: null, description: "" };
}

describe("resolveFacebookPost", () => {
  beforeEach(() => {
    pageRead.mockReset();
    permalinks.mockReset();
    postRead.mockReset();
    pageRead.mockImplementation(async (token: string) =>
      token === BRAND.userToken ? pageFor(BRAND) : token === OTHER.userToken ? pageFor(OTHER) : null,
    );
  });

  it("asks Facebook nothing when the org has no connected Page", async () => {
    await expect(resolveFacebookPost("https://www.facebook.com/boringbrand/posts/1234567890", [])).resolves.toBeNull();
    expect(pageRead).not.toHaveBeenCalled();
  });

  it("reads a numeric post id directly on the Page the link names", async () => {
    postRead.mockImplementation(async (id: string) => (id === "1122334455_1234567890" ? postWith(id) : null));
    const match = await resolveFacebookPost("https://www.facebook.com/boringbrand/posts/1234567890", [OTHER, BRAND]);
    expect(match).toMatchObject({ creatorId: "creator-brand", pageId: "1122334455", graphPostId: "1122334455_1234567890" });
    // The link named boringbrand, so the other Page's token was never used.
    expect(pageRead).toHaveBeenCalledTimes(1);
    expect(pageRead).toHaveBeenCalledWith(BRAND.userToken, undefined);
    expect(permalinks).not.toHaveBeenCalled();
  });

  it("matches the vanity name without regard to case", async () => {
    postRead.mockImplementation(async (id: string) => postWith(id));
    const match = await resolveFacebookPost("https://www.facebook.com/BoringBrand/posts/1234567890", [BRAND]);
    expect(match?.creatorId).toBe("creator-brand");
  });

  it("matches a permalink.php link by the Page id it carries", async () => {
    postRead.mockImplementation(async (id: string) => postWith(id));
    const match = await resolveFacebookPost(
      "https://www.facebook.com/permalink.php?story_fbid=987654321&id=9988776655",
      [BRAND, OTHER],
    );
    expect(match).toMatchObject({ creatorId: "creator-other", graphPostId: "9988776655_987654321" });
    expect(pageRead).toHaveBeenCalledTimes(1);
  });

  it("finds a pfbid link among the Page's permalinks, then reads the Graph id", async () => {
    permalinks.mockResolvedValue([
      { id: "1122334455_111", permalink: "https://www.facebook.com/boringbrand/posts/pfbid0aaa" },
      { id: "1122334455_222", permalink: "https://www.facebook.com/boringbrand/posts/pfbid0bbb" },
    ]);
    postRead.mockImplementation(async (id: string) => postWith(id));
    const match = await resolveFacebookPost("https://www.facebook.com/boringbrand/posts/pfbid0bbb", [BRAND]);
    expect(match?.graphPostId).toBe("1122334455_222");
    expect(postRead).toHaveBeenCalledWith("1122334455_222", "page-token-1122334455", undefined);
  });

  it("files a post under nobody when the Page it names is not connected", async () => {
    const match = await resolveFacebookPost("https://www.facebook.com/strangers/posts/1234567890", [BRAND, OTHER]);
    expect(match).toBeNull();
    expect(pageRead).not.toHaveBeenCalled();
  });

  it("tries every Page when the link names none, and takes the one that has the post", async () => {
    permalinks.mockImplementation(async (pageId: string) =>
      pageId === OTHER.pageId ? [{ id: "9988776655_333", permalink: "https://www.facebook.com/reel/888999000/" }] : [],
    );
    postRead.mockImplementation(async (id: string) => postWith(id));
    const match = await resolveFacebookPost("https://www.facebook.com/reel/888999000", [BRAND, OTHER]);
    expect(match).toMatchObject({ creatorId: "creator-other", graphPostId: "9988776655_333" });
  });

  it("reads a stored Graph id directly, and only on its own Page", async () => {
    postRead.mockImplementation(async (id: string) => postWith(id));
    const match = await resolveFacebookPost("https://www.facebook.com/share/p/1AbCdEfG/", [BRAND, OTHER], {
      knownPostId: "9988776655_444",
    });
    expect(match?.graphPostId).toBe("9988776655_444");
    expect(pageRead).toHaveBeenCalledTimes(1);
    expect(pageRead).toHaveBeenCalledWith(OTHER.userToken, undefined);
    expect(permalinks).not.toHaveBeenCalled();
  });

  it("does not match a group post, which no Page token can read", async () => {
    await expect(
      resolveFacebookPost("https://www.facebook.com/groups/12345/posts/67890/", [BRAND]),
    ).resolves.toBeNull();
    expect(pageRead).not.toHaveBeenCalled();
  });

  it("lets one rejected Page token not hide a match on another Page", async () => {
    pageRead.mockImplementation(async (token: string) => {
      if (token === BRAND.userToken) throw new InstagramAuthError(401, 190, "expired");
      return pageFor(OTHER);
    });
    permalinks.mockResolvedValue([{ id: "9988776655_555", permalink: "https://www.facebook.com/watch/?v=555666777" }]);
    postRead.mockImplementation(async (id: string) => postWith(id));
    const match = await resolveFacebookPost("https://www.facebook.com/watch/?v=555666777", [BRAND, OTHER]);
    expect(match?.creatorId).toBe("creator-other");
  });

  it("reports a rejected token only when every candidate Page was rejected", async () => {
    pageRead.mockRejectedValue(new InstagramAuthError(401, 190, "expired"));
    await expect(
      resolveFacebookPost("https://www.facebook.com/watch/?v=555666777", [BRAND, OTHER]),
    ).rejects.toBeInstanceOf(InstagramAuthError);
  });

  it("follows a share link to the permalink it stands for", async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      headers: { get: (h: string) => (h.toLowerCase() === "location" ? "https://www.facebook.com/boringbrand/posts/pfbid0ccc" : null) },
    }) as unknown as typeof fetch;
    try {
      permalinks.mockResolvedValue([{ id: "1122334455_666", permalink: "https://www.facebook.com/boringbrand/posts/pfbid0ccc" }]);
      postRead.mockImplementation(async (id: string) => postWith(id));
      const match = await resolveFacebookPost("https://www.facebook.com/share/p/1AbCdEfG/", [BRAND, OTHER]);
      expect(match).toMatchObject({ creatorId: "creator-brand", graphPostId: "1122334455_666" });
    } finally {
      global.fetch = realFetch;
    }
  });

  it("gives up on a share link that does not redirect to a post", async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ headers: { get: () => null } }) as unknown as typeof fetch;
    try {
      await expect(resolveFacebookPost("https://fb.watch/qWeRtY/", [BRAND])).resolves.toBeNull();
      expect(pageRead).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
    }
  });
});

describe("fetchPostMetrics on a Facebook link", () => {
  it("adds the post unread, saying its Page is not connected, when there is nobody to read it for", async () => {
    const m = await fetchPostMetrics("https://www.facebook.com/boringbrand/posts/1234567890");
    expect(m).toMatchObject({ platform: "FACEBOOK", platformPostId: "1234567890", fetchReason: "page-not-connected" });
    expect(m?.viewsCount ?? null).toBeNull();
    expect(pageRead).not.toHaveBeenCalled();
  });

  it("carries the matched post's counts and its Graph id", async () => {
    const m = await fetchPostMetrics("https://www.facebook.com/boringbrand/posts/1234567890", {
      facebook: {
        orgId: "org-1",
        match: {
          creatorId: "creator-brand",
          pageId: "1122334455",
          graphPostId: "1122334455_1234567890",
          post: {
            ...postWith("1122334455_1234567890"),
            exact: { views: 1500, likes: 40, comments: 6, shares: 3 },
          } as never,
        },
      },
    });
    expect(m).toMatchObject({
      platform: "FACEBOOK",
      platformPostId: "1122334455_1234567890",
      viewsCount: 1500,
      likesCount: 40,
      commentsCount: 6,
      sharesCount: 3,
    });
    expect(m?.fetchReason).toBeUndefined();
  });
});
