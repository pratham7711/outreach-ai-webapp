/**
 * @jest-environment node
 *
 * Plan B for YouTube post statistics: the public watch page. The pages here
 * are synthetic, cut down to the fields the parser reads, in the shapes
 * measured on a live page on 2026-10-03.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
const killed = new Set<string>();
jest.mock("@/lib/ops/killSwitch", () => ({
  fallbackKillKey: (r: string) => `source:${r}`,
  isKilled: async (key: string) => killed.has(key),
}));

import {
  WATCH_PAGE_CHALLENGE_STREAK,
  exactCount,
  isChallengePage,
  parseWatchPage,
  readYouTubeWatchPage,
  readYouTubeWatchPages,
  resetWatchPageState,
} from "@/lib/platforms/youtubeWatchPage";
import { fetchYouTubeMetrics, fetchYouTubeMetricsBatch } from "@/lib/platforms/fetchPostMetrics";
import { resetYouTubeQuotaState } from "@/lib/platforms/youtubeBatchStats";

const ID_A = "AAAAAAAAAA1";
const ID_B = "BBBBBBBBBB2";

function page({
  views = "12345",
  rendered = "12,345 views",
  likes = "678",
  comments = "90",
  publish = "2026-09-20T05:00:06-07:00",
  player = "OK",
}: { views?: string | null; rendered?: string | null; likes?: string | null; comments?: string | null; publish?: string | null; player?: string } = {}) {
  return [
    `"playabilityStatus":{"status":"${player}"}`,
    views !== null ? `"videoDetails":{"videoId":"x","title":"t","lengthSeconds":"19","viewCount":"${views}","author":"a"}` : "",
    rendered !== null ? `"videoViewCountRenderer":{"viewCount":{"simpleText":"${rendered}"},"shortViewCount":{"simpleText":"12K views"}}` : "",
    likes !== null ? `"accessibilityText":"like this video along with ${likes} other people"` : "",
    `"factoidRenderer":{"value":{"simpleText":"19M"},"label":{"simpleText":"Likes"}}`,
    comments !== null
      ? `"panelIdentifier":"engagement-panel-comments-section","header":{"engagementPanelTitleHeaderRenderer":{"title":{"runs":[{"text":"Comments"}]},"contextualInfo":{"runs":[{"text":"${comments}"}]}}}`
      : "",
    publish !== null ? `"publishDate":"${publish}","uploadDate":"${publish}"` : "",
  ].join(",");
}

function res(status: number, body: string, url = "https://www.youtube.com/watch?v=x") {
  return { status, url, text: async () => body } as unknown as Response;
}

const realFetch = global.fetch;
beforeEach(() => {
  resetWatchPageState();
  resetYouTubeQuotaState();
  killed.clear();
  delete process.env.YOUTUBE_WATCH_PAGE_FALLBACK;
  delete process.env.YOUTUBE_WATCH_PAGE_MAX_PER_CALL;
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.DATABASE_URL;
});
afterAll(() => {
  global.fetch = realFetch;
});

describe("exactCount", () => {
  it("reads a grouped or plain integer and refuses anything abbreviated", () => {
    expect(exactCount("19,982,100")).toBe(19982100);
    expect(exactCount("90")).toBe(90);
    expect(exactCount("10M")).toBeUndefined();
    expect(exactCount("1.2K")).toBeUndefined();
    expect(exactCount("1,23")).toBeUndefined();
    expect(exactCount("")).toBeUndefined();
    expect(exactCount(undefined)).toBeUndefined();
  });
});

describe("parseWatchPage", () => {
  it("reads views, likes, comments and the publish time", () => {
    const c = parseWatchPage(page());
    expect(c).toEqual({
      viewsCount: 12345,
      likesCount: 678,
      commentsCount: 90,
      postedAt: new Date("2026-09-20T12:00:06Z"),
    });
  });

  it("takes the larger of the two exact view counts, since views only go up", () => {
    expect(parseWatchPage(page({ views: "12345", rendered: "12,400 views" }))?.viewsCount).toBe(12400);
  });

  it("still reads the renderer when the player is a login wall with no videoDetails", () => {
    const c = parseWatchPage(page({ views: null, player: "LOGIN_REQUIRED" }));
    expect(c?.viewsCount).toBe(12345);
  });

  it("leaves an abbreviated comment count unread instead of storing a rounded number", () => {
    const c = parseWatchPage(page({ comments: "10M" }));
    expect(c?.commentsCount).toBeUndefined();
    expect(c?.likesCount).toBe(678);
  });

  it("never reads the rounded likes factoid", () => {
    expect(parseWatchPage(page({ likes: null }))?.likesCount).toBeUndefined();
  });

  it("answers null for a page with no counts at all", () => {
    expect(parseWatchPage(page({ views: null, rendered: null, likes: null, comments: null }))).toBeNull();
    expect(parseWatchPage("<html>Video unavailable</html>")).toBeNull();
  });
});

describe("isChallengePage", () => {
  it("is a 429, a consent or sorry redirect, or a bot check with no counts", () => {
    expect(isChallengePage(429, "", "")).toBe(true);
    expect(isChallengePage(200, "https://consent.youtube.com/m?continue=x", "")).toBe(true);
    expect(isChallengePage(200, "https://www.google.com/sorry/index", "")).toBe(true);
    expect(isChallengePage(200, "", `"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you're not a bot"`)).toBe(true);
  });

  it("is not a login-wall player that still prints the view counter", () => {
    expect(isChallengePage(200, "", `"status":"LOGIN_REQUIRED","reason":"Sign in to confirm",` + page({ views: null }))).toBe(false);
    expect(isChallengePage(200, "", page())).toBe(false);
  });
});

describe("readYouTubeWatchPage", () => {
  it("reads a page", async () => {
    const fetchImpl = jest.fn(async () => res(200, page())) as unknown as typeof fetch;
    const r = await readYouTubeWatchPage(ID_A, { fetchImpl });
    expect(r).toEqual({ ok: true, counts: expect.objectContaining({ viewsCount: 12345, likesCount: 678 }) });
    expect((fetchImpl as jest.Mock).mock.calls[0][0]).toBe(`https://www.youtube.com/watch?v=${ID_A}&hl=en&gl=US`);
  });

  it("refuses an id that is not a video id without fetching", async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    expect(await readYouTubeWatchPage("../../x", { fetchImpl })).toEqual({ ok: false, reason: "platform-refused" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is off with the env switch or the ops switch, and fetches nothing", async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    expect(await readYouTubeWatchPage(ID_A, { fetchImpl, env: { YOUTUBE_WATCH_PAGE_FALLBACK: "off" } })).toEqual({
      ok: false,
      reason: "not-configured",
    });
    killed.add("source:youtube-watch-page");
    expect(await readYouTubeWatchPage(ID_A, { fetchImpl })).toEqual({ ok: false, reason: "not-configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls a 200 with nothing parsable no-counts-published, never deleted", async () => {
    const fetchImpl = jest.fn(async () => res(200, "<html>Video unavailable</html>")) as unknown as typeof fetch;
    expect(await readYouTubeWatchPage(ID_A, { fetchImpl })).toEqual({ ok: false, reason: "no-counts-published" });
  });

  it("backs off for the rest of the window after a streak of challenges", async () => {
    const fetchImpl = jest.fn(async () => res(429, "")) as unknown as typeof fetch;
    for (let i = 0; i < WATCH_PAGE_CHALLENGE_STREAK; i++) {
      expect(await readYouTubeWatchPage(ID_A, { fetchImpl })).toEqual({ ok: false, reason: "platform-challenged" });
    }
    expect(await readYouTubeWatchPage(ID_A, { fetchImpl })).toEqual({ ok: false, reason: "backing-off" });
    expect(fetchImpl).toHaveBeenCalledTimes(WATCH_PAGE_CHALLENGE_STREAK);
  });

  it("treats a thrown fetch as a refusal", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    expect(await readYouTubeWatchPage(ID_A, { fetchImpl })).toEqual({ ok: false, reason: "platform-refused" });
  });
});

describe("readYouTubeWatchPages", () => {
  it("reads no more than the per-call ceiling", async () => {
    const fetchImpl = jest.fn(async () => res(200, page())) as unknown as typeof fetch;
    const ids = Array.from({ length: 5 }, (_, i) => `CCCCCCCCCC${i}`);
    const out = await readYouTubeWatchPages(ids, { fetchImpl, env: { YOUTUBE_WATCH_PAGE_MAX_PER_CALL: "3" } });
    expect(out.size).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("stops asking once the challenge backoff starts", async () => {
    const fetchImpl = jest.fn(async () => res(429, "")) as unknown as typeof fetch;
    const ids = Array.from({ length: 20 }, (_, i) => `DDDDDDDDD${String(i).padStart(2, "0")}`);
    await readYouTubeWatchPages(ids, { fetchImpl });
    /* Four workers can each be mid-request when the streak trips. */
    expect((fetchImpl as jest.Mock).mock.calls.length).toBeLessThanOrEqual(WATCH_PAGE_CHALLENGE_STREAK + 3);
  });
});

describe("fetchYouTubeMetrics with plan B", () => {
  it("reads the watch page when there is no API key", async () => {
    global.fetch = jest.fn(async () => res(200, page())) as unknown as typeof fetch;
    const m = await fetchYouTubeMetrics(ID_A);
    expect(m).toMatchObject({ viewsCount: 12345, likesCount: 678, commentsCount: 90 });
    expect(m.fetchReason).toBeUndefined();
  });

  it("keeps plan A's reason when plan B reads nothing", async () => {
    global.fetch = jest.fn(async () => res(429, "")) as unknown as typeof fetch;
    expect((await fetchYouTubeMetrics(ID_A)).fetchReason).toBe("not-configured");
  });

  it("reads the watch page when the Data API refuses for something other than quota", async () => {
    process.env.YOUTUBE_API_KEY = "fake-key";
    global.fetch = jest.fn(async (input: string) =>
      String(input).includes("googleapis.com")
        ? ({ ok: false, status: 500, text: async () => "backend error" } as unknown as Response)
        : res(200, page()),
    ) as unknown as typeof fetch;
    const m = await fetchYouTubeMetrics(ID_A);
    expect(m).toMatchObject({ viewsCount: 12345 });
    expect(m.fetchReason).toBeUndefined();
  });

  it("never second-guesses plan A's deletion verdict", async () => {
    process.env.YOUTUBE_API_KEY = "fake-key";
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) }) as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    expect((await fetchYouTubeMetrics(ID_A)).fetchReason).toBe("post-deleted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchYouTubeMetricsBatch with plan B", () => {
  it("reads a keyless batch through watch pages and enters the unread as not-configured", async () => {
    global.fetch = jest.fn(async (input: string) =>
      String(input).includes(ID_A) ? res(200, page()) : res(200, "<html>nothing</html>"),
    ) as unknown as typeof fetch;
    const out = await fetchYouTubeMetricsBatch([ID_A, ID_B]);
    expect(out.get(ID_A)).toMatchObject({ viewsCount: 12345, platform: "YOUTUBE", platformPostId: ID_A });
    expect(out.get(ID_A)?.fetchReason).toBeUndefined();
    expect(out.get(ID_B)?.fetchReason).toBe("not-configured");
  });

  it("covers a chunk the Data API failed, and leaves the answered ones alone", async () => {
    process.env.YOUTUBE_API_KEY = "fake-key";
    const asked: string[] = [];
    global.fetch = jest.fn(async (input: string) => {
      const u = String(input);
      if (u.includes("googleapis.com")) {
        asked.push("api");
        return { ok: false, status: 503, text: async () => "unavailable" } as unknown as Response;
      }
      asked.push("page");
      return res(200, page());
    }) as unknown as typeof fetch;
    const out = await fetchYouTubeMetricsBatch([ID_A, ID_B]);
    expect(out.get(ID_A)?.viewsCount).toBe(12345);
    expect(out.get(ID_B)?.viewsCount).toBe(12345);
    expect(asked.filter((a) => a === "api")).toHaveLength(1);
    expect(asked.filter((a) => a === "page")).toHaveLength(2);
  });
});
