/**
 * The post page is asked when Meta's readers and the embed leave a hole, and
 * its answer files a post -- and pays a creator. So the failure that matters is
 * a wrong name or a made-up number, not a missing one: an og:url that is not
 * exactly owner/kind/this-shortcode names nobody, and a count that is rounded,
 * hidden or absent is never stored.
 */
jest.mock("@/lib/platforms/instagramPostPageElsewhere", () => ({ readInstagramPostPageElsewhere: jest.fn() }));

import {
  parseInstagramPostPage,
  readInstagramPostPage,
  readInstagramPostPageOwner,
} from "@/lib/platforms/instagramPostPage";
import { readInstagramPostPageElsewhere } from "@/lib/platforms/instagramPostPageElsewhere";

const elsewhere = readInstagramPostPageElsewhere as jest.MockedFunction<typeof readInstagramPostPageElsewhere>;

const CODE = "DeKIkbgzlYq";
const COVER = "https://scontent-bom1-1.cdninstagram.com/v/t51/cover.jpg?stp=dst-jpg&amp;oh=abc";

function page(
  ogUrl: string | null,
  { reversed = false, description = null as string | null, image = COVER as string | null } = {},
) {
  const meta = (property: string, content: string) =>
    reversed
      ? `<meta content="${content}" property="og:${property}" />`
      : `<meta property="og:${property}" content="${content}" />`;
  return [
    "<!DOCTYPE html><html><head><title>Instagram</title>",
    ogUrl === null ? "" : meta("url", ogUrl),
    image === null ? "" : meta("image", image),
    description === null ? "" : meta("description", description),
    '<meta property="og:type" content="article" /></head><body></body></html>',
  ].join("");
}

describe("parseInstagramPostPage -- the owner", () => {
  it("reads the owner out of og:url", () => {
    expect(parseInstagramPostPage(page(`https://www.instagram.com/jane.doe_1/reel/${CODE}/`), CODE)?.owner).toBe("jane.doe_1");
    expect(parseInstagramPostPage(page(`https://www.instagram.com/jane/p/${CODE}/`), CODE)?.owner).toBe("jane");
  });

  it("does not care which attribute comes first", () => {
    expect(parseInstagramPostPage(page(`https://www.instagram.com/jane/reel/${CODE}/`, { reversed: true }), CODE)?.owner).toBe("jane");
  });

  it("is null on the shell a deleted, private or made-up post gets", () => {
    expect(parseInstagramPostPage(page(null), CODE)).toBeNull();
  });

  it("refuses a page about some other post", () => {
    expect(parseInstagramPostPage(page("https://www.instagram.com/jane/reel/DzzzzzzzzzA/"), CODE)).toBeNull();
  });

  it("keeps the rest of an owner-less og:url, but never calls the owner 'reel'", () => {
    const reading = parseInstagramPostPage(page(`https://www.instagram.com/reel/${CODE}/`), CODE);
    expect(reading).not.toBeNull();
    expect(reading?.owner).toBeNull();
    expect(reading?.thumbnailUrl).toMatch(/^https:\/\/scontent-bom1-1\.cdninstagram\.com\//);
  });

  it("refuses another host, and names nobody when the name is one Instagram would not allow", () => {
    expect(parseInstagramPostPage(page(`https://evil.example/jane/reel/${CODE}/`), CODE)).toBeNull();
    expect(parseInstagramPostPage(page(`https://www.instagram.com/jane%20doe/reel/${CODE}/`), CODE)?.owner).toBeNull();
    expect(parseInstagramPostPage(page(`https://www.instagram.com/${"a".repeat(31)}/reel/${CODE}/`), CODE)?.owner).toBeNull();
  });
});

describe("parseInstagramPostPage -- cover, counts, caption", () => {
  const URL_ = `https://www.instagram.com/jane/reel/${CODE}/`;

  it("takes the cover from og:image, entities decoded", () => {
    expect(parseInstagramPostPage(page(URL_), CODE)?.thumbnailUrl).toBe(
      "https://scontent-bom1-1.cdninstagram.com/v/t51/cover.jpg?stp=dst-jpg&oh=abc",
    );
  });

  it("drops a cover that is not on Instagram's CDN, or not https", () => {
    expect(parseInstagramPostPage(page(URL_, { image: "https://evil.example/x.jpg" }), CODE)?.thumbnailUrl).toBeNull();
    expect(parseInstagramPostPage(page(URL_, { image: "http://scontent.cdninstagram.com/x.jpg" }), CODE)?.thumbnailUrl).toBeNull();
    expect(parseInstagramPostPage(page(URL_, { image: null }), CODE)?.thumbnailUrl).toBeNull();
  });

  it("reads exact likes and comments, and the caption after the date", () => {
    const reading = parseInstagramPostPage(
      page(URL_, { description: "1,116 likes, 12 comments - jane on October 3, 2026: &quot;Out now&quot; #lanterns" }),
      CODE,
    );
    expect(reading).toMatchObject({ likesCount: 1116, commentsCount: 12, caption: "Out now\" #lanterns" });
  });

  it("stores no number from an abbreviated count", () => {
    const reading = parseInstagramPostPage(page(URL_, { description: "12K likes, 340 comments - jane on October 3, 2026: hi" }), CODE);
    expect(reading?.likesCount).toBeUndefined();
    expect(reading?.commentsCount).toBeUndefined();
    expect(reading?.caption).toBe("hi");
  });

  it("reads zero likes as hidden, not as zero, and then trusts no comment count either", () => {
    const reading = parseInstagramPostPage(page(URL_, { description: "0 likes, 0 comments - jane on October 3, 2026: hi" }), CODE);
    expect(reading).not.toHaveProperty("likesCount");
    expect(reading).not.toHaveProperty("commentsCount");
  });

  it("keeps zero comments when the like count is real", () => {
    const reading = parseInstagramPostPage(page(URL_, { description: "116 likes, 0 comments - jane on October 3, 2026: hi" }), CODE);
    expect(reading).toMatchObject({ likesCount: 116, commentsCount: 0 });
  });

  it("stores no counts when the page prints none", () => {
    const reading = parseInstagramPostPage(page(URL_, { description: "jane on October 3, 2026: hi" }), CODE);
    expect(reading).not.toHaveProperty("likesCount");
    expect(reading?.caption).toBe("hi");
  });
});

describe("readInstagramPostPage", () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    elsewhere.mockReset();
    elsewhere.mockResolvedValue([]);
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  function html(body: string, ok = true) {
    return Promise.resolve({ ok, status: ok ? 200 : 500, text: () => Promise.resolve(body) } as Response);
  }
  function media(status: number, location?: string) {
    return Promise.resolve({
      ok: false,
      status,
      headers: new Headers(location ? { location } : {}),
    } as Response);
  }

  it("asks for the canonical post page as a bot, never as a browser", async () => {
    fetchMock.mockReturnValueOnce(html(page(`https://www.instagram.com/jane/reel/${CODE}/`))).mockReturnValueOnce(media(404));
    const out = await readInstagramPostPage(`https://www.instagram.com/reel/${CODE}/?igsh=abc`);
    expect(out).toMatchObject({ kind: "public", owner: "jane" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://www.instagram.com/p/${CODE}/`);
    for (const [, each] of fetchMock.mock.calls) {
      expect((each as RequestInit).headers).toMatchObject({ "user-agent": expect.stringMatching(/^MadeBoringBot\//) });
      expect((each as RequestInit).headers).not.toHaveProperty("cookie");
    }
  });

  /* og:image is the same frame with a play button drawn on it, at half the
     size; the thumbnail address redirects to the clean one. */
  it("keeps the clean cover from the thumbnail address over og:image", async () => {
    fetchMock
      .mockReturnValueOnce(html(page(`https://www.instagram.com/jane/reel/${CODE}/`)))
      .mockReturnValueOnce(media(302, "https://scontent.cdninstagram.com/clean.jpg"));
    await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toMatchObject({
      kind: "public",
      thumbnailUrl: "https://scontent.cdninstagram.com/clean.jpg",
    });
  });

  it("falls back to og:image when the thumbnail address gives nothing usable -- and a public page is never not-public", async () => {
    for (const answer of [media(404), media(302, "https://evil.example/t.jpg"), Promise.reject(new Error("ECONNRESET"))]) {
      fetchMock.mockReset();
      fetchMock.mockReturnValueOnce(html(page(`https://www.instagram.com/jane/reel/${CODE}/`))).mockReturnValueOnce(answer);
      const out = await readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`);
      expect(out.kind).toBe("public");
      expect(out).toMatchObject({ thumbnailUrl: expect.stringMatching(/^https:\/\/scontent-bom1-1\.cdninstagram\.com\//) });
    }
  });

  it("calls a post not-public only when the page is empty AND the thumbnail address says 404", async () => {
    fetchMock.mockReturnValueOnce(html(page(null))).mockReturnValueOnce(media(404));
    await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toEqual({ kind: "not-public" });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`https://www.instagram.com/p/${CODE}/media/?size=l`);
    expect((init as RequestInit).redirect).toBe("manual");
  });

  it("says nothing about the post when the page is empty but the thumbnail address still redirects -- and keeps that cover", async () => {
    fetchMock
      .mockReturnValueOnce(html(page(null)))
      .mockReturnValueOnce(media(302, "https://scontent.cdninstagram.com/t.jpg"));
    await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toEqual({
      kind: "unreadable",
      thumbnailUrl: "https://scontent.cdninstagram.com/t.jpg",
    });
  });

  it("will not follow a redirect off Instagram's CDN", async () => {
    fetchMock.mockReturnValueOnce(html(page(null))).mockReturnValueOnce(media(302, "https://evil.example/t.jpg"));
    await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toEqual({ kind: "unreadable", thumbnailUrl: null });
  });

  it("never reads a failed page load as not-public", async () => {
    fetchMock.mockReturnValueOnce(html("", false));
    await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toEqual({ kind: "unreadable", thumbnailUrl: null });
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toEqual({ kind: "unreadable", thumbnailUrl: null });
    fetchMock.mockReturnValueOnce(html(page(null))).mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toEqual({ kind: "unreadable", thumbnailUrl: null });
  });

  it("does not call out for a link with no shortcode", async () => {
    await expect(readInstagramPostPage("https://www.instagram.com/jane/")).resolves.toEqual({ kind: "unreadable", thumbnailUrl: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(elsewhere).not.toHaveBeenCalled();
  });

  /* Measured 2026-10-10: one LKM post was the shell plus a 404 from sin1, the
     region every function runs in, and the full page from bom1 and iad1. */
  describe("a post not public from here", () => {
    const shellHere = () => fetchMock.mockReturnValueOnce(html(page(null))).mockReturnValueOnce(media(404));

    it("is asked about from other regions -- and only then", async () => {
      fetchMock.mockReturnValueOnce(html(page(`https://www.instagram.com/jane/reel/${CODE}/`))).mockReturnValueOnce(media(404));
      await readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`);
      fetchMock.mockReturnValueOnce(html(page(null))).mockReturnValueOnce(media(302, "https://scontent.cdninstagram.com/t.jpg"));
      await readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`);
      fetchMock.mockReturnValueOnce(html("", false));
      await readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`);
      expect(elsewhere).not.toHaveBeenCalled();

      shellHere();
      await readInstagramPostPage(`https://www.instagram.com/reel/${CODE}/?igsh=abc`);
      expect(elsewhere).toHaveBeenCalledTimes(1);
      expect(elsewhere).toHaveBeenCalledWith(CODE);
    });

    it("is public, with its owner, counts and clean cover, when another region sees it", async () => {
      shellHere();
      elsewhere.mockResolvedValueOnce([
        { region: "bom1", html: page(null), mediaStatus: 404, mediaLocation: null },
        {
          region: "iad1",
          html: page(`https://www.instagram.com/jane/reel/${CODE}/`, { description: "116 likes, 0 comments - jane on October 6, 2026: hi" }),
          mediaStatus: 302,
          mediaLocation: "https://scontent-iad3-1.cdninstagram.com/clean.jpg",
        },
      ]);
      await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toEqual({
        kind: "public",
        owner: "jane",
        caption: "hi",
        likesCount: 116,
        commentsCount: 0,
        thumbnailUrl: "https://scontent-iad3-1.cdninstagram.com/clean.jpg",
      });
    });

    it("stays not public when every region that answered agrees, or when none could answer", async () => {
      shellHere();
      elsewhere.mockResolvedValueOnce([
        { region: "bom1", html: page(null), mediaStatus: 404, mediaLocation: null },
        { region: "iad1", html: page(null), mediaStatus: 404, mediaLocation: null },
      ]);
      await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toEqual({ kind: "not-public" });

      shellHere();
      elsewhere.mockResolvedValueOnce([]);
      await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toEqual({ kind: "not-public" });
    });

    it("is not overturned by a region that names no post, or names another one", async () => {
      shellHere();
      elsewhere.mockResolvedValueOnce([
        { region: "bom1", html: page(null), mediaStatus: 302, mediaLocation: "https://scontent.cdninstagram.com/t.jpg" },
        { region: "iad1", html: page("https://www.instagram.com/jane/reel/SomeOtherCode/"), mediaStatus: 302, mediaLocation: "https://scontent.cdninstagram.com/t.jpg" },
      ]);
      await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toEqual({ kind: "not-public" });
    });

    it("keeps og:image when the other region's thumbnail address points off the CDN", async () => {
      shellHere();
      elsewhere.mockResolvedValueOnce([
        { region: "bom1", html: page(`https://www.instagram.com/jane/reel/${CODE}/`), mediaStatus: 302, mediaLocation: "https://evil.example/t.jpg" },
      ]);
      await expect(readInstagramPostPage(`https://www.instagram.com/p/${CODE}/`)).resolves.toMatchObject({
        kind: "public",
        owner: "jane",
        thumbnailUrl: expect.stringMatching(/^https:\/\/scontent-bom1-1\.cdninstagram\.com\//),
      });
    });
  });
});

describe("readInstagramPostPageOwner", () => {

  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  function html(body: string, ok = true) {
    return Promise.resolve({ ok, text: () => Promise.resolve(body) } as Response);
  }

  it("names the owner from the page alone, without asking the thumbnail address", async () => {
    fetchMock.mockReturnValue(html(page(`https://www.instagram.com/jane/reel/${CODE}/`)));
    await expect(readInstagramPostPageOwner(`https://www.instagram.com/reel/${CODE}/`)).resolves.toBe("jane");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is null for an owner-less og:url and for the shell", async () => {
    fetchMock.mockReturnValueOnce(html(page(`https://www.instagram.com/reel/${CODE}/`)));
    await expect(readInstagramPostPageOwner(`https://www.instagram.com/p/${CODE}/`)).resolves.toBeNull();
    fetchMock.mockReturnValueOnce(html(page(null)));
    await expect(readInstagramPostPageOwner(`https://www.instagram.com/p/${CODE}/`)).resolves.toBeNull();
  });

  it("is null, not a throw, when the page will not load", async () => {
    fetchMock.mockReturnValueOnce(html("", false));
    await expect(readInstagramPostPageOwner(`https://www.instagram.com/p/${CODE}/`)).resolves.toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(readInstagramPostPageOwner(`https://www.instagram.com/p/${CODE}/`)).resolves.toBeNull();
  });
});
