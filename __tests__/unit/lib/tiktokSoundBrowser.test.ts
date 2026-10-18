/**
 * @jest-environment node
 *
 * How the TikTok sound reader drives its one page, and which /api/music/detail
 * answer it takes. The answer's shape is the one TikTok sent on 2026-10-18, cut
 * down to the fields read; the values are made up.
 */
import { detailAnswers, openSoundBrowserSession, parseMusicDetail } from "@/lib/platforms/tiktokSoundBrowser";
import type { LaunchedBrowser } from "@/lib/platforms/tiktokBrowser";

const SOUND = "7546394810303694849";
const OTHER = "7111111111111111111";

const detailUrl = (id: string) => `https://www.tiktok.com/api/music/detail/?WebIdLastTime=1&musicId=${id}&msToken=x`;
const detail = (id: string, videoCount: number) => ({
  extra: { now: 1 },
  musicInfo: {
    music: { id, title: "Neon Skyline", authorName: "Ava Reyes", coverLarge: "https://p16.example/cover.jpeg" },
    stats: { videoCount },
  },
  statusCode: 0,
});

describe("parseMusicDetail", () => {
  it("reads the count, title, artist and cover", () => {
    expect(parseMusicDetail(detail(SOUND, 268_700))).toEqual({
      usesCount: 268_700,
      title: "Neon Skyline",
      artist: "Ava Reyes",
      coverImageUrl: "https://p16.example/cover.jpeg",
    });
  });

  it("gives nothing for an answer without a count", () => {
    expect(parseMusicDetail({ statusCode: 10_203 })).toBeNull();
    expect(parseMusicDetail(null)).toBeNull();
  });
});

describe("detailAnswers", () => {
  it("takes an answer asked for this sound, or naming it", () => {
    expect(detailAnswers(SOUND, detailUrl(SOUND), {})).toBe(true);
    expect(detailAnswers(SOUND, "https://www.tiktok.com/api/music/detail/?x=1", detail(SOUND, 1))).toBe(true);
  });

  it("refuses an answer about another sound", () => {
    expect(detailAnswers(SOUND, detailUrl(OTHER), detail(OTHER, 1))).toBe(false);
  });
});

describe("openSoundBrowserSession", () => {
  type Answer = { url: string; body: unknown };

  /* A browser whose page answers each navigation with the responses `script`
     lists for that URL, after goto has returned -- as the real page does, its
     data call landing once the document has loaded. */
  function fakeBrowsers(script: (url: string) => Answer[], gotoError?: () => Error | null) {
    const browsers: { newPage: jest.Mock; close: jest.Mock; listeners: Set<(r: unknown) => void>; gotos: string[] }[] = [];
    const launchBrowser = jest.fn(async () => {
      const listeners = new Set<(r: unknown) => void>();
      const gotos: string[] = [];
      const page = {
        on: (_: string, fn: (r: unknown) => void) => listeners.add(fn),
        off: (_: string, fn: (r: unknown) => void) => listeners.delete(fn),
        goto: jest.fn(async (url: string) => {
          gotos.push(url);
          const err = gotoError?.();
          if (err) throw err;
          for (const a of script(url)) {
            const res = { url: () => a.url, text: async () => (typeof a.body === "string" ? a.body : JSON.stringify(a.body)) };
            setTimeout(() => [...listeners].forEach((fn) => fn(res)), 0);
          }
        }),
      };
      const b = { newPage: jest.fn(async () => page), close: jest.fn(async () => {}), listeners, gotos };
      browsers.push(b);
      return b as unknown as LaunchedBrowser;
    });
    return { browsers, launchBrowser };
  }

  const idOf = (url: string) => decodeURIComponent(url.split("/music/x-")[1]);

  it("opens one browser and one page for the run, and navigates that page from sound to sound", async () => {
    const { browsers, launchBrowser } = fakeBrowsers((url) => [{ url: detailUrl(idOf(url)), body: detail(idOf(url), 7_327) }]);
    const session = openSoundBrowserSession({ launchBrowser, payloadWaitMs: 1_000 });

    expect((await session.read(SOUND))?.usesCount).toBe(7_327);
    expect((await session.read(OTHER))?.usesCount).toBe(7_327);

    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(browsers[0].newPage).toHaveBeenCalledTimes(1);
    expect(browsers[0].gotos).toHaveLength(2);
    // Each read stops listening when it is done, so a page reused all run collects no listeners.
    expect(browsers[0].listeners.size).toBe(0);
    await session.close();
    expect(browsers[0].close).toHaveBeenCalledTimes(1);
  });

  it("does not take the previous sound's late answer for this one", async () => {
    const { launchBrowser } = fakeBrowsers(() => [
      { url: detailUrl(OTHER), body: detail(OTHER, 99) },
      { url: detailUrl(SOUND), body: detail(SOUND, 7_327) },
    ]);
    const session = openSoundBrowserSession({ launchBrowser, payloadWaitMs: 1_000 });
    expect((await session.read(SOUND))?.usesCount).toBe(7_327);
  });

  it("answers null when the page never sends the answer, and keeps the page for the next sound", async () => {
    let answer = false;
    const { browsers, launchBrowser } = fakeBrowsers((url) =>
      answer ? [{ url: detailUrl(idOf(url)), body: detail(idOf(url), 46) }] : [{ url: detailUrl(idOf(url)), body: "" }]
    );
    const session = openSoundBrowserSession({ launchBrowser, payloadWaitMs: 30 });
    expect(await session.read(SOUND)).toBeNull();

    answer = true;
    expect((await session.read(SOUND))?.usesCount).toBe(46);
    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(browsers[0].close).not.toHaveBeenCalled();
  });

  it("throws when the page fails, closes that browser, and opens a fresh one for the next sound", async () => {
    let fail = true;
    const { browsers, launchBrowser } = fakeBrowsers(
      (url) => [{ url: detailUrl(idOf(url)), body: detail(idOf(url), 46) }],
      () => (fail ? new Error("page.goto: Target page, context or browser has been closed") : null)
    );
    const session = openSoundBrowserSession({ launchBrowser, payloadWaitMs: 1_000 });
    await expect(session.read(SOUND)).rejects.toThrow("Target page, context or browser has been closed");
    await new Promise((r) => setTimeout(r, 0));
    expect(browsers[0].close).toHaveBeenCalled();

    fail = false;
    expect((await session.read(SOUND))?.usesCount).toBe(46);
    expect(launchBrowser).toHaveBeenCalledTimes(2);
  });

  it("opens nothing until a sound is read, and closing an unused session is a no-op", async () => {
    const { launchBrowser } = fakeBrowsers(() => []);
    const session = openSoundBrowserSession({ launchBrowser });
    await session.close();
    expect(launchBrowser).not.toHaveBeenCalled();
  });
});
