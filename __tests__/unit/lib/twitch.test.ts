// earnings.ts reaches @/lib/db for computeCreatorEarnings; without this the
// Prisma client loads and the suite fails before a single test runs.
jest.mock("@/lib/db", () => ({ db: {} }));

import {
  fetchTwitchMetrics,
  twitchAssetKind,
  __resetTwitchTokenCacheForTests,
} from "@/lib/platforms/twitch";
import { detectPlatform } from "@/lib/platforms/fetchPostMetrics";
import { PAYABLE_PLATFORMS } from "@/lib/marketplace/earnings";
import { AUTO_TRACK_PLATFORMS } from "@/lib/platforms/registry";

/**
 * Twitch is the only platform on the registry that is free and ungated -- Helix
 * on an app access token, 800 req/min, no review and no partner programme. That
 * makes it the cheapest way to widen automatic coverage, and these assertions
 * are what stop it from being "declared auto, fetches nothing", which is the
 * state FACEBOOK/THREADS/PINTEREST were found in on 2026-09-06.
 */

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const TOKEN_BODY = { access_token: "app-token-1", expires_in: 5000 };

const VOD = {
  id: "123456789",
  title: "A very long stream",
  view_count: 4321,
  created_at: "2026-08-01T10:00:00Z",
  thumbnail_url: "https://static.twitch/preview-%{width}x%{height}.jpg",
};

/**
 * jsdom provides no native fetch, so `global.fetch` is assigned rather than
 * spied on -- the pattern the rest of the suite uses (see apiClient.test.ts).
 */
function mockFetch(...responses: Response[]): jest.Mock {
  const fn = jest.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  // Anything past the scripted sequence repeats the last response rather than
  // resolving undefined, which would fail as an opaque TypeError.
  if (responses.length) fn.mockResolvedValue(responses[responses.length - 1]);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  __resetTwitchTokenCacheForTests();
  process.env = { ...ORIGINAL_ENV, TWITCH_CLIENT_ID: "cid", TWITCH_CLIENT_SECRET: "secret" };
  jest.restoreAllMocks();
  global.fetch = jest.fn(async () => {
    throw new Error("unexpected fetch: the test did not script this call");
  }) as unknown as typeof fetch;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("twitchAssetKind", () => {
  it.each([
    ["https://www.twitch.tv/videos/123456789", "video"],
    ["https://clips.twitch.tv/SomeFunnyClipSlug", "clip"],
    ["https://www.twitch.tv/somechannel/clip/SomeFunnyClipSlug", "clip"],
  ])("%s -> %s", (url, kind) => {
    expect(twitchAssetKind(url)).toBe(kind);
  });

  it("returns null for a bare channel page, which is not a post", () => {
    expect(twitchAssetKind("https://www.twitch.tv/somechannel")).toBeNull();
  });
});

describe("detectPlatform recognises Twitch post URLs", () => {
  it("reads a VOD as a VIDEO", () => {
    expect(detectPlatform("https://www.twitch.tv/videos/123456789")).toEqual({
      platform: "TWITCH",
      id: "123456789",
      mediaType: "VIDEO",
    });
  });

  it("reads a channel-hosted clip as a SHORT and keeps the channel handle", () => {
    expect(detectPlatform("https://www.twitch.tv/somechannel/clip/AbcDef-123")).toEqual({
      platform: "TWITCH",
      id: "AbcDef-123",
      mediaType: "SHORT",
      handle: "somechannel",
    });
  });
});

describe("fetchTwitchMetrics", () => {
  it("is inert without credentials, and settles rather than retrying forever", async () => {
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;
    const spy = mockFetch();

    const out = await fetchTwitchMetrics("https://www.twitch.tv/videos/1", "1");

    expect(out.fetchReason).toBe("not-configured");
    expect(spy).not.toHaveBeenCalled();
  });

  it("mints an app token and maps a VOD's counters", async () => {
    const spy = mockFetch(jsonResponse(TOKEN_BODY), jsonResponse({ data: [VOD] }));

    const out = await fetchTwitchMetrics("https://www.twitch.tv/videos/123456789", "123456789");

    expect(out.viewsCount).toBe(4321);
    expect(out.caption).toBe("A very long stream");
    expect(out.postedAt).toEqual(new Date("2026-08-01T10:00:00Z"));
    // A VOD thumbnail is a template; stored verbatim it renders broken.
    expect(out.thumbnailUrl).toBe("https://static.twitch/preview-640x360.jpg");

    expect(String(spy.mock.calls[1][0])).toContain("/helix/videos?id=123456789");
  });

  it("uses the clips endpoint for a clip", async () => {
    const spy = mockFetch(jsonResponse(TOKEN_BODY), jsonResponse({ data: [{ ...VOD, id: "SlugAbc" }] }));

    await fetchTwitchMetrics("https://clips.twitch.tv/SlugAbc", "SlugAbc");

    expect(String(spy.mock.calls[1][0])).toContain("/helix/clips?id=SlugAbc");
  });

  it("leaves a clip thumbnail alone -- clips come back ready-sized", async () => {
    /* Only VOD thumbnails carry %{width}/%{height}. Verified against the Helix
       reference: the substitution must be a no-op on a real clip URL rather
       than mangling it. */
    const CLIP = {
      ...VOD,
      id: "SlugAbc",
      thumbnail_url: "https://clips-media.twitch/AwkwardSlug-preview-480x272.jpg",
    };
    mockFetch(jsonResponse(TOKEN_BODY), jsonResponse({ data: [CLIP] }));

    const out = await fetchTwitchMetrics("https://clips.twitch.tv/SlugAbc", "SlugAbc");

    expect(out.thumbnailUrl).toBe(
      "https://clips-media.twitch/AwkwardSlug-preview-480x272.jpg",
    );
  });

  it("caches the app token across posts instead of minting one per fetch", async () => {
    const spy = mockFetch(jsonResponse(TOKEN_BODY), jsonResponse({ data: [VOD] }));

    await fetchTwitchMetrics("https://www.twitch.tv/videos/1", "1");
    await fetchTwitchMetrics("https://www.twitch.tv/videos/2", "2");

    const tokenCalls = spy.mock.calls.filter(([u]) => String(u).includes("id.twitch.tv"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("treats an empty data[] as the platform saying the asset is gone", async () => {
    mockFetch(jsonResponse(TOKEN_BODY), jsonResponse({ data: [] }));

    const out = await fetchTwitchMetrics("https://www.twitch.tv/videos/9", "9");
    expect(out.fetchReason).toBe("post-deleted");
  });

  it("drops a rejected token so the next post re-mints instead of reusing it", async () => {
    const spy = mockFetch(jsonResponse(TOKEN_BODY), jsonResponse({ message: "invalid oauth token" }, 401), jsonResponse(TOKEN_BODY), jsonResponse({ data: [VOD] }));

    const first = await fetchTwitchMetrics("https://www.twitch.tv/videos/1", "1");
    expect(first.fetchReason).toBe("platform-refused");

    const second = await fetchTwitchMetrics("https://www.twitch.tv/videos/2", "2");
    expect(second.viewsCount).toBe(4321);

    const tokenCalls = spy.mock.calls.filter(([u]) => String(u).includes("id.twitch.tv"));
    expect(tokenCalls).toHaveLength(2);
  });

  it("leaves an absent view_count absent rather than writing zero", async () => {
    mockFetch(jsonResponse(TOKEN_BODY), jsonResponse({ data: [{ ...VOD, view_count: undefined }] }));

    const out = await fetchTwitchMetrics("https://www.twitch.tv/videos/1", "1");
    expect(out).not.toHaveProperty("viewsCount");
  });

  it("does not invent likes or comments, which Twitch has no concept of", async () => {
    mockFetch(jsonResponse(TOKEN_BODY), jsonResponse({ data: [VOD] }));

    const out = await fetchTwitchMetrics("https://www.twitch.tv/videos/1", "1");
    expect(out).not.toHaveProperty("likesCount");
    expect(out).not.toHaveProperty("commentsCount");
  });
});

/**
 * A campaign can only price a platform whose views we can verify ourselves.
 * Pricing one we cannot measure would accrue payouts against a number nobody
 * ever read.
 */
describe("marketplace rates only price platforms we can measure", () => {
  it.each(PAYABLE_PLATFORMS)("%s is auto-tracked", (key) => {
    expect(AUTO_TRACK_PLATFORMS).toContain(key);
  });
});
