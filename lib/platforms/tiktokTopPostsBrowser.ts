import { createBrowserSession, type BrowserSession, type LaunchedBrowser } from "./tiktokBrowser";
import { rankTopPosts, type TopPost } from "./creatorProfile";

/**
 * A TikTok creator's recent posts, with view counts.
 *
 * The stats reader (tiktokProfile.ts) is a plain fetch, because follower and
 * video counts are server-rendered into the profile HTML. The post grid is
 * not: it arrives from /api/post/item_list/, signed by TikTok's client script
 * the same way the music-detail call is, so posts need what sounds need -- a
 * real browser making the page's own request for us to read.
 *
 * Kept separate from the stats read on purpose: stats are cheap and hourly,
 * posts cost ~12s of browser and refresh daily. A creator whose grid read
 * fails still gets a follower snapshot.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PAYLOAD_WAIT_MS = 25_000;

export type TikTokPostsRead = {
  topPosts: TopPost[];
  /** Mean plays across every post the grid returned, not just the top ones. */
  avgViews: number;
  sampledPosts: number;
  /** The profile stats from the page's own rehydration blob, when present.
   * Carried so a sweep whose plain-fetch stats read got a stripped shell --
   * TikTok serves those to some datacenter egress -- can still produce a
   * follower snapshot from the same page visit that read the grid. */
  profile: { followersCount: number; postsCount: number } | null;
};

export type TopPostsSession = BrowserSession<string, TikTokPostsRead>;

/** One lazily-launched, self-healing browser per sweep -- see tiktokBrowser. */
export function openTopPostsSession(): TopPostsSession {
  return createBrowserSession(readWith);
}

async function readWith(
  browser: LaunchedBrowser,
  handle: string,
  timeoutMs: number
): Promise<TikTokPostsRead | null> {
  const clean = handle.replace(/^@/, "").trim();
  if (!clean) return null;

  let page: any = null;
  try {
    page = await browser.newPage({ userAgent: UA, viewport: { width: 1400, height: 1000 } });

    let items: any[] | null = null;
    page.on("response", async (res: any) => {
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

    /* The blob is in the served HTML, so it is readable immediately; grabbed
       before the grid wait so a page whose XHR never fires still yields stats. */
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
          // statsV2 is exact where stats is rounded -- same trap as elsewhere.
          const n = (key: string) => {
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

    const deadline = Date.now() + PAYLOAD_WAIT_MS;
    while (!items && Date.now() < deadline) await page.waitForTimeout(500);
    if (!items && !profile) {
      /* Thrown rather than returned so the session's catch logs it: the page
         title and size say whether this was the WAF shell (~1.4KB, "TikTok"),
         a challenge page, or something new. */
      const evidence = await page
        .evaluate(() => `title="${document.title.slice(0, 60)}" len=${document.documentElement.outerHTML.length}`)
        .catch(() => "page unreadable");
      throw new Error(`no grid or stats for @${clean}: ${evidence}`);
    }
    if (!items) {
      /* No grid, but a page that rendered stats is still a successful stats
         read; an empty topPosts list is "not measured", which the caller
         already refuses to write over stored posts. */
      return profile ? { topPosts: [], avgViews: 0, sampledPosts: 0, profile } : null;
    }

    const posts: TopPost[] = (items as any[])
      .filter((it) => it?.id)
      .map((it) => {
        /* statsV2 carries exact strings where stats is rounded for display --
           the same trap as follower counts, and the same preference. */
        const count = (key: string): number | null => {
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

    const views = posts.map((p) => p.views).filter((v): v is number => typeof v === "number");
    return {
      topPosts: rankTopPosts(posts),
      avgViews: views.length ? views.reduce((a, b) => a + b, 0) / views.length : 0,
      sampledPosts: views.length,
      profile,
    };
  } finally {
    /* Only the page; the browser belongs to the session. */
    await page?.close().catch(() => {});
  }
}
