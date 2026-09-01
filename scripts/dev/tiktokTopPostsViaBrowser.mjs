/**
 * Read a TikTok creator's post grid by rendering their profile in REAL Chrome.
 *
 * Why real Chrome, when the sound reader gets away with Playwright's Chromium:
 * the grid's /api/post/item_list/ is signed like the music-detail call, but
 * TikTok's client script refuses to produce the tokens under headless
 * SwiftShader Chromium — measured from a Vercel Sandbox with clean US egress
 * (page renders, blob present, grid never fires). Chrome's own binary in new
 * headless mode carries the real GPU/canvas surface the fingerprint checks.
 * So this launches `channel: "chrome"` and expects google-chrome-stable on the
 * box (see scripts/creator-worker/README.md).
 *
 * The browser is launched once and shared across creators in a run — pass the
 * launcher's result in, close it when the run ends.
 */
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PAYLOAD_WAIT_MS = 25_000;

/** @returns {Promise<import("playwright").Browser>} */
export async function launchRealChrome({ headless = true } = {}) {
  return chromium.launch({ channel: "chrome", headless });
}

/**
 * @param {import("playwright").Browser} browser
 * @param {string} handle
 * @returns {Promise<{posts: Array<object>, profile: {followersCount:number, postsCount:number}|null}|null>}
 *   null when the page yielded neither grid nor stats; throws with page
 *   evidence when the page itself looked wrong (WAF shell, challenge).
 */
export async function fetchTopPostsViaBrowser(browser, handle, { timeoutMs = 60_000 } = {}) {
  const clean = String(handle ?? "").replace(/^@/, "").trim();
  if (!clean) return null;

  const page = await browser.newPage({ userAgent: UA, viewport: { width: 1400, height: 1000 } });
  try {
    let items = null;
    page.on("response", async (res) => {
      if (items || !res.url().includes("/api/post/item_list/")) return;
      try {
        const body = await res.text();
        if (!body) return;
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed?.itemList)) items = parsed.itemList;
      } catch {
        /* not the payload; keep waiting */
      }
    });

    await page.goto(`https://www.tiktok.com/@${encodeURIComponent(clean)}`, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    /* Stats come from the served HTML's rehydration blob — readable at once,
       and worth carrying even when the grid never fires. statsV2 is exact
       where stats is rounded; same preference as everywhere else. */
    const profile = await page
      .evaluate(() => {
        const el = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
        if (!el?.textContent) return null;
        try {
          const scope = JSON.parse(el.textContent)?.__DEFAULT_SCOPE__;
          const userInfo =
            scope?.["webapp.user-detail"]?.userInfo ??
            scope?.["webapp.user_detail"]?.userInfo ??
            null;
          if (!userInfo) return null;
          const n = (key) => {
            const v2 = Number(userInfo.statsV2?.[key]);
            if (Number.isFinite(v2) && v2 > 0) return v2;
            const v1 = Number(userInfo.stats?.[key]);
            return Number.isFinite(v1) ? v1 : NaN;
          };
          const followersCount = n("followerCount");
          if (!Number.isFinite(followersCount)) return null;
          const videos = n("videoCount");
          return { followersCount, postsCount: Number.isFinite(videos) ? videos : 0 };
        } catch {
          return null;
        }
      })
      .catch(() => null);

    /* A scroll nudges a grid whose first page rendered server-side without
       firing the XHR. Cheap, and harmless when items already arrived. */
    const deadline = Date.now() + PAYLOAD_WAIT_MS;
    let scrolled = false;
    while (!items && Date.now() < deadline) {
      await page.waitForTimeout(500);
      if (!scrolled && Date.now() > deadline - 15_000) {
        scrolled = true;
        await page.mouse.wheel(0, 1500).catch(() => {});
      }
    }

    if (!items && !profile) {
      const evidence = await page
        .evaluate(() => `title="${document.title.slice(0, 60)}" len=${document.documentElement.outerHTML.length}`)
        .catch(() => "page unreadable");
      throw new Error(`no grid or stats for @${clean}: ${evidence}`);
    }
    if (!items) return { posts: [], profile };

    const posts = items
      .filter((it) => it?.id)
      .map((it) => {
        const count = (key) => {
          const v2 = Number(it.statsV2?.[key]);
          if (Number.isFinite(v2)) return v2;
          const v1 = Number(it.stats?.[key]);
          return Number.isFinite(v1) ? v1 : null;
        };
        return {
          postId: String(it.id),
          url: `https://www.tiktok.com/@${clean}/video/${it.id}`,
          caption: typeof it.desc === "string" && it.desc ? it.desc : null,
          coverUrl: it.video?.cover ?? it.video?.dynamicCover ?? null,
          views: count("playCount"),
          likes: count("diggCount"),
          comments: count("commentCount"),
          postedAt:
            typeof it.createTime === "number" && it.createTime > 0
              ? new Date(it.createTime * 1000).toISOString()
              : null,
        };
      });

    return { posts, profile };
  } finally {
    await page.close().catch(() => {});
  }
}
