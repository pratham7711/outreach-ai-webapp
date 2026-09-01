import type { CreatorReadResult } from "./creatorProfile";

/**
 * A TikTok creator's public figures, without a browser.
 *
 * The first version of this drove headless Chromium and waited for the page to
 * fetch /api/user/detail/, mirroring how the sound reader works. That was wrong:
 * unlike a music page, a profile page is server-rendered, and every figure we
 * need is already in the __UNIVERSAL_DATA_FOR_REHYDRATION__ blob of the HTML.
 * Verified against @sonheii -- followerCount, videoCount and heartCount all
 * present in a plain 369KB GET.
 *
 * That removes Chromium from this path entirely: no 1.7GB function, no ~12s per
 * read, no ETXTBSY race on the binary extracted to /tmp, and no dependence on
 * the sin1 region (this was confirmed from iad1, which the music endpoint
 * refuses).
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BLOB = /id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;

/** Same guard as fetchPostMetrics: AbortSignal.timeout is not everywhere. */
function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

/**
 * stats vs statsV2 is the whole game.
 *
 * `stats.followerCount` is rounded for display -- 2,600,000 for a creator who
 * actually has 2,631,012. A follower tracker built on the rounded figure reports
 * a change of exactly zero until the creator crosses a 100k boundary, which is
 * indistinguishable from a broken reader. statsV2 carries the exact value, as
 * strings, and is preferred wherever it is present.
 */
function exactCount(statsV2: any, stats: any, key: string): number {
  const v2 = Number(statsV2?.[key]);
  if (Number.isFinite(v2) && v2 > 0) return v2;
  const v1 = Number(stats?.[key]);
  return Number.isFinite(v1) ? v1 : NaN;
}

function findUserDetail(scope: any): any {
  // The scope key has carried a couple of names across TikTok's releases; take
  // whichever is present rather than pinning to one that may be renamed again.
  return (
    scope?.["webapp.user-detail"] ??
    scope?.["webapp.user_detail"] ??
    scope?.["webapp.userDetail"] ??
    null
  );
}

export async function fetchTikTokProfile(
  handle: string,
  { timeoutMs = 20_000 }: { timeoutMs?: number } = {}
): Promise<CreatorReadResult> {
  const clean = handle.replace(/^@/, "").trim();
  if (!clean) return { ok: false, reason: "unreadable", detail: "empty handle" };

  let html: string;
  try {
    const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(clean)}`, {
      headers: {
        "user-agent": UA,
        // Without a browser-shaped Accept, TikTok is more willing to serve a
        // stripped shell that carries no rehydration blob.
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: timeoutSignal(timeoutMs),
      cache: "no-store",
    });
    if (res.status === 404) return { ok: false, reason: "unreadable", detail: "no such account" };
    if (res.status === 429) return { ok: false, reason: "rate-limited", detail: "http 429" };
    if (!res.ok) return { ok: false, reason: "unreadable", detail: `http ${res.status}` };
    html = await res.text();
  } catch (e) {
    return {
      ok: false,
      reason: "unreadable",
      detail: `fetch: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return parseTikTokProfileHtml(html);
}

/**
 * Parsing is separate from fetching because the same HTML arrives two ways:
 * a plain fetch where TikTok's WAF permits it, and a sandbox-run curl from a
 * region/egress that TikTok answers when it does not (see
 * tiktokProfileSandbox.ts). One parser, so the two paths cannot drift.
 */
export function parseTikTokProfileHtml(html: string): CreatorReadResult {
  const match = BLOB.exec(html);
  if (!match) {
    /* A shell with no blob is what TikTok serves a client it does not trust, and
       is also what a region block looks like. Named distinctly from a parse
       failure so the two are not conflated in the error column. */
    return { ok: false, reason: "unreadable", detail: "no rehydration blob in page" };
  }

  let detail: any;
  try {
    detail = JSON.parse(match[1]);
  } catch (e) {
    return { ok: false, reason: "unreadable", detail: "rehydration blob is not JSON" };
  }

  const userDetail = findUserDetail(detail?.__DEFAULT_SCOPE__);
  const userInfo = userDetail?.userInfo;
  if (!userInfo) {
    const status = userDetail?.statusCode ?? detail?.__DEFAULT_SCOPE__?.["webapp.app-context"]?.statusCode;
    /* 10221 is TikTok's "this user does not exist" -- in practice a renamed or
       deleted account (.olise.ftbl had become oliseftbl_). Worth its own words
       because the fix is editing the tracked handle, not waiting. */
    if (status === 10221 || status === 10202) {
      return {
        ok: false,
        reason: "unreadable",
        detail: `no such account — the handle may have been renamed or deleted (statusCode ${status})`,
      };
    }
    return {
      ok: false,
      reason: "unreadable",
      detail: `no userInfo${status ? ` (statusCode ${status})` : ""}`,
    };
  }

  const followersCount = exactCount(userInfo.statsV2, userInfo.stats, "followerCount");
  const postsCount = exactCount(userInfo.statsV2, userInfo.stats, "videoCount");
  if (!Number.isFinite(followersCount)) {
    return { ok: false, reason: "unreadable", detail: "no followerCount in userInfo" };
  }

  /* Per-post view counts are not in this payload -- the profile page loads its
     video grid over XHR. sampledPosts stays 0, which the caller reads as "not
     measured" rather than "measured zero", so averageViews is left untouched
     rather than overwritten with a fabricated 0. */
  return {
    ok: true,
    profile: {
      followersCount,
      postsCount: Number.isFinite(postsCount) ? postsCount : 0,
      avgViews: 0,
      sampledPosts: 0,
    },
  };
}
