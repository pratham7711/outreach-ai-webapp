import {
  fetchTikTokMetrics,
  readTikTokPostHtml,
  type TikTokPostLookup,
} from "@/lib/platforms/fetchPostMetrics";
import type { SandboxPostFetcher } from "@/lib/platforms/tiktokPostSandbox";

/**
 * The sandbox is the egress TikTok actually answers, so a refresh must ask it
 * first and must not spend a direct fetch when it gets a real answer. These
 * tests pin that ordering: the bug they exist to catch is a refactor that turns
 * the sandbox back into a fallback, which would silently restore the ~25%
 * success rate while every test still passed.
 */

const URL = "https://www.tiktok.com/@someone/video/7675846963421646098";

function page(scope: unknown): string {
  return `<html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(
    { __DEFAULT_SCOPE__: scope }
  )}</script></body></html>`;
}

function videoDetail(statusCode = 0, stats?: Record<string, number>) {
  return {
    "webapp.video-detail": {
      statusCode,
      itemInfo: {
        itemStruct: {
          desc: "a clip",
          createTime: "1750000000",
          video: { cover: "https://cdn.example/cover.jpg" },
          stats: stats ?? { playCount: 4165, diggCount: 535, commentCount: 2, shareCount: 10 },
        },
      },
    },
  };
}

/** The 1.4KB Slardar login shell: HTTP 200, no rehydration payload. */
const WAF_SHELL = "<html><body><div id=\"slardar-login\"></div></body></html>";

function stubSandbox(result: TikTokPostLookup | null) {
  const readPost = jest.fn(async () => result);
  return { readPost, close: jest.fn(async () => {}) } as unknown as SandboxPostFetcher & {
    readPost: jest.Mock;
  };
}

describe("readTikTokPostHtml", () => {
  it("reads a live post's counts", () => {
    const lookup = readTikTokPostHtml(page(videoDetail()));
    expect(lookup.state).toBe("live");
    expect(lookup.metrics?.viewsCount).toBe(4165);
    expect(lookup.metrics?.likesCount).toBe(535);
  });

  it("calls a non-zero statusCode a deleted post, not a challenge", () => {
    const lookup = readTikTokPostHtml(page(videoDetail(10204)));
    expect(lookup.state).toBe("deleted");
    expect(lookup.statusCode).toBe(10204);
  });

  it("calls the WAF shell unavailable rather than deleted", () => {
    const lookup = readTikTokPostHtml(WAF_SHELL);
    expect(lookup.state).toBe("unavailable");
    expect(lookup.reason).toBe("no-parsable-payload");
    expect(lookup.metrics).toBeNull();
  });

  it("has no opinion about which egress produced the html", () => {
    // Same bytes, same verdict, whether curled in a sandbox or fetched directly.
    const html = page(videoDetail());
    expect(readTikTokPostHtml(html)).toEqual(readTikTokPostHtml(html));
  });
});

describe("fetchTikTokMetrics with a sandbox", () => {
  const realFetch = global.fetch;
  let directFetch: jest.Mock;

  beforeEach(() => {
    directFetch = jest.fn(async () => {
      throw new Error("direct fetch should not have been reached");
    });
    global.fetch = directFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("returns the sandbox's counts without touching the direct fetch", async () => {
    const sandbox = stubSandbox(readTikTokPostHtml(page(videoDetail())));

    const metrics = await fetchTikTokMetrics(URL, undefined, undefined, true, sandbox);

    expect(sandbox.readPost).toHaveBeenCalledWith(URL);
    expect(directFetch).not.toHaveBeenCalled();
    expect(metrics.viewsCount).toBe(4165);
    expect(metrics.likesCount).toBe(535);
  });

  it("stops at a deleted verdict instead of re-asking directly", async () => {
    const sandbox = stubSandbox(readTikTokPostHtml(page(videoDetail(10204))));

    const metrics = await fetchTikTokMetrics(URL, undefined, undefined, true, sandbox);

    expect(directFetch).not.toHaveBeenCalled();
    expect(metrics.fetchReason).toBe("post-deleted");
    expect(metrics.viewsCount).toBeUndefined();
  });

  it("falls back to the direct fetch when the sandbox itself failed", async () => {
    // Null is "the sandbox broke", which is not a verdict about the post, so
    // the direct egress still deserves its turn.
    const sandbox = stubSandbox(null);
    directFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () => page(videoDetail(0, { playCount: 99, diggCount: 1, commentCount: 0, shareCount: 0 })),
    }));

    const metrics = await fetchTikTokMetrics(URL, undefined, undefined, true, sandbox);

    expect(sandbox.readPost).toHaveBeenCalled();
    expect(directFetch).toHaveBeenCalled();
    expect(metrics.viewsCount).toBe(99);
  });

  it("falls back when the sandbox got walled too", async () => {
    const sandbox = stubSandbox(readTikTokPostHtml(WAF_SHELL));
    directFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () => page(videoDetail(0, { playCount: 7, diggCount: 0, commentCount: 0, shareCount: 0 })),
    }));

    const metrics = await fetchTikTokMetrics(URL, undefined, undefined, true, sandbox);

    expect(directFetch).toHaveBeenCalled();
    expect(metrics.viewsCount).toBe(7);
  });

  it("uses the direct fetch when no sandbox was supplied", async () => {
    directFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () => page(videoDetail(0, { playCount: 42, diggCount: 3, commentCount: 1, shareCount: 0 })),
    }));

    const metrics = await fetchTikTokMetrics(URL, undefined, undefined, true);

    expect(directFetch).toHaveBeenCalled();
    expect(metrics.viewsCount).toBe(42);
  });
});
