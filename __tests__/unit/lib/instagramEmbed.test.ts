import {
  parseInstagramEmbed,
  fetchInstagramEmbedPost,
} from "@/lib/platforms/instagramEmbed";

/**
 * Instagram double-encodes the payload: contextJSON's VALUE is a JSON string
 * whose contents are themselves JSON. Verified against a real captured page --
 * the raw bytes read `"contextJSON":"{\"context\":{\"type\":\"GraphVideo\"...`
 * which is exactly what stringifying twice produces. The helper builds it the
 * same way so a fixture cannot drift from the real escaping.
 */
function embedHtml(context: Record<string, unknown>): string {
  return `<!DOCTYPE html><html><body><script type="application/json">{"contextJSON":${JSON.stringify(
    JSON.stringify(context),
  )},"other":1}</script></body></html>`;
}

function context(media: Record<string, unknown>, copyrightBlocked = false) {
  return {
    context: { type: "GraphVideo", shortcode: media.shortcode, copyright_blocked: copyrightBlocked },
    gql_data: { shortcode_media: media },
  };
}

const BASE = {
  __typename: "GraphVideo",
  shortcode: "DcQFHR5pdYw",
  thumbnail_src: "https://cdn.example/thumb.jpg",
  display_url: "https://cdn.example/display.jpg",
  edge_media_to_comment: { count: 9 },
  edge_media_to_caption: { edges: [{ node: { text: "a caption" } }] },
  owner: { username: "iamswarat", edge_followed_by: { count: 114574 } },
};

describe("parseInstagramEmbed", () => {
  it("reads a post whose likes are visible", () => {
    const out = parseInstagramEmbed(
      embedHtml(context({ ...BASE, edge_liked_by: { count: 1428 }, video_view_count: 3337 }, true)),
    );
    expect(out).toMatchObject({
      shortcode: "DcQFHR5pdYw",
      likesCount: 1428,
      likesHidden: false,
      commentsCount: 9,
      authorFollowers: 114574,
      authorHandle: "iamswarat",
      caption: "a caption",
      thumbnailUrl: "https://cdn.example/thumb.jpg",
      copyrightBlocked: true,
    });
  });

  /**
   * The regression this whole module exists to avoid re-introducing.
   *
   * Instagram reports a HIDDEN like count as 0, not as an absent field. Both
   * production posts whose likes Business Discovery withheld read exactly this
   * way, so a parser that trusted the number would have written "0 likes" to a
   * client report -- the same defect, arriving from a new source, that the
   * measured-fields work was done to eliminate.
   */
  it("treats a zero like count as hidden, and omits the field entirely", () => {
    const out = parseInstagramEmbed(
      embedHtml(context({ ...BASE, edge_liked_by: { count: 0 } })),
    );
    expect(out?.likesHidden).toBe(true);
    expect(out).not.toHaveProperty("likesCount");
    // The rest of the post still comes through -- hidden likes are one hole,
    // not a failed read.
    expect(out?.commentsCount).toBe(9);
  });

  /**
   * Views are read but deliberately kept off viewsCount. Measured on the real
   * post: the embed says 3337 where the official API says 24245.
   */
  it("carries the embed view count under its own name, never as a view count", () => {
    const out = parseInstagramEmbed(
      embedHtml(context({ ...BASE, edge_liked_by: { count: 5 }, video_view_count: 3337 })),
    );
    expect(out?.embedViewCount).toBe(3337);
    expect(out).not.toHaveProperty("viewsCount");
  });

  it("prefers whichever like edge actually carries a number", () => {
    // edge_media_preview_like was null on every measured post while
    // edge_liked_by held the real figure, but the shapes swap between surfaces.
    const viaPreview = parseInstagramEmbed(
      embedHtml(
        context({ ...BASE, edge_liked_by: { count: 0 }, edge_media_preview_like: { count: 77 } }),
      ),
    );
    expect(viaPreview?.likesCount).toBe(77);
    expect(viaPreview?.likesHidden).toBe(false);
  });

  it("falls back to the accessibility caption when there is no caption edge", () => {
    const out = parseInstagramEmbed(
      embedHtml(
        context({
          ...BASE,
          edge_media_to_caption: { edges: [] },
          accessibility_caption: "Photo by someone",
        }),
      ),
    );
    expect(out?.caption).toBe("Photo by someone");
  });

  it("keeps a caption's own quotes and unicode intact through both decodes", () => {
    const text = 'He said "hi" — 100% \\ done 🎬';
    const out = parseInstagramEmbed(
      embedHtml(context({ ...BASE, edge_media_to_caption: { edges: [{ node: { text } }] } })),
    );
    expect(out?.caption).toBe(text);
  });

  it("comments of zero are a real zero, unlike likes", () => {
    // Turning comments off leaves a post with genuinely no comments, and
    // Instagram reports that as 0. There is nothing hidden to distinguish.
    const out = parseInstagramEmbed(
      embedHtml(context({ ...BASE, edge_media_to_comment: { count: 0 } })),
    );
    expect(out?.commentsCount).toBe(0);
  });

  describe("pages that are not a post", () => {
    it("returns null for the login shell", () => {
      // What Instagram serves when the sec-fetch headers are missing: a real
      // page, 623KB of it, with no contextJSON anywhere.
      expect(parseInstagramEmbed("<html><title>Instagram</title><body>login</body></html>")).toBeNull();
    });

    it("returns null when contextJSON is truncated rather than hanging on it", () => {
      const good = embedHtml(context({ ...BASE, edge_liked_by: { count: 3 } }));
      const cut = good.slice(0, good.indexOf('"contextJSON":') + 200);
      expect(parseInstagramEmbed(cut)).toBeNull();
    });

    it("returns null when the payload carries no shortcode", () => {
      const { shortcode: _drop, ...noShortcode } = BASE;
      expect(parseInstagramEmbed(embedHtml(context(noShortcode)))).toBeNull();
    });

    it("returns null when contextJSON is not valid JSON", () => {
      expect(parseInstagramEmbed('<html>{"contextJSON":"{not json}"}</html>')).toBeNull();
    });

    it("returns null when there is no shortcode_media", () => {
      expect(
        parseInstagramEmbed(embedHtml({ context: { type: "x" }, gql_data: {} })),
      ).toBeNull();
    });
  });
});

describe("fetchInstagramEmbedPost", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  /**
   * The headers are the mechanism, not decoration: without the referer and the
   * three sec-fetch values the same URL returns the login shell. Asserting them
   * means a well-meaning cleanup that trims them fails here rather than in
   * production, where it would look like Instagram having closed the endpoint.
   */
  it("requests the captioned embed with the headers that make it answer", async () => {
    const calls: Array<[string, any]> = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push([String(url), init]);
      return {
        ok: true,
        status: 200,
        text: async () => embedHtml(context({ ...BASE, edge_liked_by: { count: 12 } })),
      } as any;
    }) as any;

    const out = await fetchInstagramEmbedPost("https://www.instagram.com/reel/DcQFHR5pdYw/");
    expect(out?.likesCount).toBe(12);

    const [url, init] = calls[0];
    expect(url).toBe("https://www.instagram.com/p/DcQFHR5pdYw/embed/captioned/");
    expect(init.headers["sec-fetch-dest"]).toBe("iframe");
    expect(init.headers["sec-fetch-mode"]).toBe("navigate");
    expect(init.headers["sec-fetch-site"]).toBe("cross-site");
    expect(init.headers.referer).toContain("instagram.com");
    expect(init.headers["user-agent"]).toContain("Chrome");
  });

  it("returns null on a non-OK response without throwing", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 429, text: async () => "" })) as any;
    await expect(
      fetchInstagramEmbedPost("https://www.instagram.com/p/DcQFHR5pdYw/"),
    ).resolves.toBeNull();
  });

  it("returns null when the fetch itself fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("socket hang up");
    }) as any;
    await expect(
      fetchInstagramEmbedPost("https://www.instagram.com/p/DcQFHR5pdYw/"),
    ).resolves.toBeNull();
  });

  it("does not call Instagram at all for a URL with no shortcode", async () => {
    const spy = jest.fn();
    global.fetch = spy as any;
    await expect(fetchInstagramEmbedPost("https://example.com/nope")).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
