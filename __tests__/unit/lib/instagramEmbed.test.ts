import http from "node:http";
import https from "node:https";
import { gzipSync } from "node:zlib";

import {
  classifyInstagramEmbedHtml,
  parseInstagramEmbed,
  fetchInstagramEmbedPost,
  probeInstagramEmbedSurface,
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

/**
 * These drive the REAL transport against a REAL local server and read the
 * headers off the wire.
 *
 * The previous version of this block mocked global.fetch and asserted the
 * header OBJECT, which is worthless here and worse than nothing, because it
 * passed while the code was completely broken. `Sec-Fetch-*` are forbidden
 * header names in the Fetch standard, so undici overwrites them: it rewrote
 * `sec-fetch-mode: navigate` to `cors`, which is exactly the value Instagram
 * answers with a login shell. The header object was right, the parser was
 * right, sixteen tests were green, and the feature returned nothing against
 * real Instagram every single time.
 *
 * So the assertion has to be what leaves the process, not what was passed in.
 * That is only observable through an actual socket.
 */
describe("fetchInstagramEmbedPost — the request on the wire", () => {
  let server: http.Server;
  let port: number;
  let seen: Record<string, string> = {};
  let respondWith: { status: number; body: string; gzip?: boolean } = {
    status: 200,
    body: "",
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen = {};
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        seen[req.rawHeaders[i].toLowerCase()] = req.rawHeaders[i + 1];
      }
      if (respondWith.gzip) {
        res.writeHead(respondWith.status, { "content-encoding": "gzip" });
        res.end(gzipSync(Buffer.from(respondWith.body, "utf8")));
      } else {
        res.writeHead(respondWith.status);
        res.end(respondWith.body);
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as any).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  /* The module targets www.instagram.com by hostname, so the test server is put
     in its place at the https layer rather than by changing the module to take
     an injectable base URL -- a seam added for a test is a seam that can differ
     from production, and that difference is the whole bug being guarded here. */
  function redirectToTestServer() {
    const real = https.request;
    jest.spyOn(https, "request").mockImplementation(((opts: any, cb: any) => {
      return http.request(
        { ...opts, hostname: "127.0.0.1", port, protocol: "http:", agent: undefined },
        cb,
      );
    }) as any);
    return () => {
      (https.request as any).mockRestore?.();
      https.request = real;
    };
  }

  afterEach(() => jest.restoreAllMocks());

  it("puts sec-fetch-mode: navigate on the wire, unrewritten", async () => {
    // THE regression guard. Anything that reintroduces fetch/undici here, or
    // any runtime that polices forbidden header names, fails on this line.
    respondWith = {
      status: 200,
      body: embedHtml(context({ ...BASE, edge_liked_by: { count: 12 } })),
    };
    const restore = redirectToTestServer();
    try {
      const out = await fetchInstagramEmbedPost("https://www.instagram.com/reel/DcQFHR5pdYw/");
      expect(out?.likesCount).toBe(12);
    } finally {
      restore();
    }
    expect(seen["sec-fetch-mode"]).toBe("navigate");
    expect(seen["sec-fetch-dest"]).toBe("iframe");
    expect(seen["sec-fetch-site"]).toBe("cross-site");
    expect(seen.referer).toContain("instagram.com");
    expect(seen["user-agent"]).toContain("Chrome");
  });

  it("decompresses a gzipped body", async () => {
    // Instagram serves this gzipped and ignores accept-encoding: identity, so
    // treating the bytes as text yields binary and a null parse.
    respondWith = {
      status: 200,
      gzip: true,
      body: embedHtml(context({ ...BASE, edge_liked_by: { count: 34 } })),
    };
    const restore = redirectToTestServer();
    try {
      const out = await fetchInstagramEmbedPost("https://www.instagram.com/p/DcQFHR5pdYw/");
      expect(out?.likesCount).toBe(34);
    } finally {
      restore();
    }
  });

  it("returns null on a non-OK response", async () => {
    respondWith = { status: 429, body: "" };
    const restore = redirectToTestServer();
    try {
      await expect(
        fetchInstagramEmbedPost("https://www.instagram.com/p/DcQFHR5pdYw/"),
      ).resolves.toBeNull();
    } finally {
      restore();
    }
  });

  it("returns null for the login shell instead of throwing", async () => {
    respondWith = { status: 200, body: "<html><title>Instagram</title></html>" };
    const restore = redirectToTestServer();
    try {
      await expect(
        fetchInstagramEmbedPost("https://www.instagram.com/p/DcQFHR5pdYw/"),
      ).resolves.toBeNull();
    } finally {
      restore();
    }
  });

  it("returns null when the connection fails", async () => {
    // A real refused connection rather than a hand-rolled emitter: the point is
    // that a dead socket cannot put an unhandled rejection into the middle of a
    // campaign refresh, and only the real path proves that.
    const dead = http.createServer();
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", () => r()));
    const deadPort = (dead.address() as any).port;
    await new Promise<void>((r) => dead.close(() => r()));

    jest.spyOn(https, "request").mockImplementation(((opts: any, cb: any) =>
      http.request(
        { ...opts, hostname: "127.0.0.1", port: deadPort, protocol: "http:", agent: undefined },
        cb,
      )) as any);

    await expect(
      fetchInstagramEmbedPost("https://www.instagram.com/p/DcQFHR5pdYw/"),
    ).resolves.toBeNull();
  });

  it("gives up when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const restore = redirectToTestServer();
    try {
      await expect(
        fetchInstagramEmbedPost("https://www.instagram.com/p/DcQFHR5pdYw/", controller.signal),
      ).resolves.toBeNull();
    } finally {
      restore();
    }
  });

  it("does not open a socket for a URL with no shortcode", async () => {
    const spy = jest.spyOn(https, "request");
    await expect(fetchInstagramEmbedPost("https://example.com/nope")).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

/**
 * The three shapes the surface has actually served, told apart.
 *
 * Every one of them reaches fetchInstagramEmbedPost as `null`, which is right
 * for a caller that only wants numbers and useless for telling a client why
 * their figures stopped. The product spent ten days asserting "likes and
 * comments still update" on the strength of that ambiguity.
 */
describe("classifyInstagramEmbedHtml", () => {
  it("calls a real payload serving", () => {
    const html = embedHtml(context({ ...BASE, edge_liked_by: { count: 12 } }));
    expect(classifyInstagramEmbedHtml(html).state).toBe("serving");
  });

  it("calls a null contextJSON closed, not a failure of ours", () => {
    /* Measured 2026-09-17 from iad1 with a warmed cookie jar: HTTP 200, the key
       still present, the value literally null. Instagram did not fail to serve
       this page -- it served an empty one. */
    const html = '<html><script type="application/json">{"contextJSON":null}</script></html>';
    const out = classifyInstagramEmbedHtml(html);
    expect(out.state).toBe("closed");
    expect(out.reason).toMatch(/no longer publishes/i);
  });

  it("keeps the login shell apart from an empty payload", () => {
    const out = classifyInstagramEmbedHtml(`<html><title>Instagram</title>${"x".repeat(500_000)}</html>`);
    expect(out.state).toBe("login-wall");
    expect(out.reason).toMatch(/login page/i);
  });
});

describe("probeInstagramEmbedSurface", () => {
  let server: http.Server;
  let port: number;
  let respondWith: { status: number; body: string } = { status: 200, body: "" };

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(respondWith.status);
      res.end(respondWith.body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as any).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  function redirect() {
    const real = https.request;
    jest.spyOn(https, "request").mockImplementation(((opts: any, cb: any) =>
      http.request(
        { ...opts, hostname: "127.0.0.1", port, protocol: "http:", agent: undefined },
        cb,
      )) as any);
    return () => {
      (https.request as any).mockRestore?.();
      https.request = real;
    };
  }

  afterEach(() => jest.restoreAllMocks());

  it("reports serving when the payload is there", async () => {
    respondWith = { status: 200, body: embedHtml(context({ ...BASE, edge_liked_by: { count: 4 } })) };
    const restore = redirect();
    try {
      const out = await probeInstagramEmbedSurface("https://www.instagram.com/p/DcQFHR5pdYw/");
      expect(out.serving).toBe(true);
      expect(out.state).toBe("serving");
    } finally {
      restore();
    }
  });

  it("separates Instagram closing the surface from Instagram refusing the post", async () => {
    /* The remedy differs: one is nobody's to fix, the other is about that one
       post. Reported as the same null, they were indistinguishable. */
    respondWith = { status: 200, body: '<html>{"contextJSON":null}</html>' };
    const restore = redirect();
    try {
      const closed = await probeInstagramEmbedSurface("https://www.instagram.com/p/DcQFHR5pdYw/");
      expect(closed).toMatchObject({ serving: false, state: "closed", status: 200 });

      respondWith = { status: 404, body: "" };
      const refused = await probeInstagramEmbedSurface("https://www.instagram.com/p/DcQFHR5pdYw/");
      expect(refused).toMatchObject({ serving: false, state: "refused", status: 404 });
      expect(refused.reason).toMatch(/404/);
    } finally {
      restore();
    }
  });

  it("does not blame Instagram for our own deadline", async () => {
    const controller = new AbortController();
    controller.abort();
    const restore = redirect();
    try {
      const out = await probeInstagramEmbedSurface(
        "https://www.instagram.com/p/DcQFHR5pdYw/",
        controller.signal,
      );
      expect(out.state).toBe("unreachable");
      expect(out.serving).toBe(false);
    } finally {
      restore();
    }
  });

  it("answers without a socket when the link carries no post id", async () => {
    const spy = jest.spyOn(https, "request");
    const out = await probeInstagramEmbedSurface("https://example.com/nope");
    expect(out.state).toBe("unreachable");
    expect(spy).not.toHaveBeenCalled();
  });
});
