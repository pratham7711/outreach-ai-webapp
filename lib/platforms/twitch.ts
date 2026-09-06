import { createLogger } from "@/lib/observability/logger";

// Type-only. A runtime import from fetchPostMetrics would be a cycle, since
// fetchPostMetrics is what calls this module -- the same reason instagramEmbed
// reaches for ./instagram rather than back up to the dispatcher.
import type { FetchReason, PostMetrics } from "@/lib/platforms/fetchPostMetrics";

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const HELIX = "https://api.twitch.tv/helix";

/**
 * Twitch is the one platform on the registry that is free with no review gate:
 * an app access token (client_credentials) gets 800 requests/minute against
 * Helix. The only thing standing between us and automatic Twitch metrics is
 * TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET, which are minted at
 * dev.twitch.tv/console/apps in about two minutes.
 *
 * Until those exist this module is inert and says so -- "not-configured" is a
 * settled reason, so a Twitch post dead-letters cleanly instead of being
 * re-asked every hour forever, exactly as an unkeyed YouTube post does.
 */

/** Mirrors the private stubMetrics() in fetchPostMetrics: a stub knows nothing, not even postedAt. */
function stub(reason: FetchReason): Partial<PostMetrics> {
  return { thumbnailUrl: null, caption: null, fetchReason: reason };
}

function toCount(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * A Twitch URL is either a VOD (numeric id) or a clip (slug), and they are
 * served by two different Helix endpoints. The kind is recoverable from the URL
 * and nowhere else, which is why this takes the url and not just the id.
 */
export function twitchAssetKind(url: string): "video" | "clip" | null {
  if (/twitch\.tv\/videos\/\d+/i.test(url)) return "video";
  if (/clips\.twitch\.tv\/[\w-]+/i.test(url)) return "clip";
  if (/twitch\.tv\/\w+\/clip\/[\w-]+/i.test(url)) return "clip";
  return null;
}

/**
 * App access tokens last ~60 days, so minting one per request would waste a
 * round trip on every post in a sweep. Cached in module scope and re-minted a
 * minute early; a sweep is a single process, so this is per-invocation anyway.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

export function __resetTwitchTokenCacheForTests(): void {
  cachedToken = null;
}

async function appAccessToken(
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const log = createLogger({ context: { platform: "TWITCH", call: "oauth.token" } });
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  try {
    const res = await fetch(TOKEN_URL, { method: "POST", body, signal });
    if (!res.ok) {
      log.error("Twitch token request failed", { status: res.status });
      return null;
    }
    const data = await res.json();
    const token = typeof data?.access_token === "string" ? data.access_token : null;
    if (!token) {
      log.error("Twitch token response carried no access_token");
      return null;
    }
    const ttlSec = typeof data?.expires_in === "number" ? data.expires_in : 3600;
    // 60s of slack so a token cannot expire mid-sweep.
    cachedToken = { value: token, expiresAt: Date.now() + Math.max(0, ttlSec - 60) * 1000 };
    return token;
  } catch (err) {
    log.error("Twitch token fetch threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Twitch publishes view_count and nothing else that maps onto our counters.
 * There are no likes and no comments on a VOD or a clip, so those stay ABSENT
 * rather than being written as zero -- the same absent-is-not-zero rule the
 * YouTube mapper follows for a channel that hides its like count. Writing 0
 * here would be a reading nobody ever took.
 */
export async function fetchTwitchMetrics(
  url: string,
  id: string,
  signal?: AbortSignal,
): Promise<Partial<PostMetrics>> {
  const log = createLogger({ context: { platform: "TWITCH", id } });

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    log.warn("TWITCH_CLIENT_ID/SECRET not set; storing no metric counts for this post");
    return stub("not-configured");
  }

  const kind = twitchAssetKind(url);
  if (!kind) {
    log.warn("URL is not a recognisable Twitch VOD or clip");
    return stub("platform-refused");
  }

  const token = await appAccessToken(clientId, clientSecret, signal);
  if (!token) return stub("platform-refused");

  const endpoint = kind === "video" ? `${HELIX}/videos?id=${encodeURIComponent(id)}`
                                    : `${HELIX}/clips?id=${encodeURIComponent(id)}`;

  try {
    const res = await fetch(endpoint, {
      headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` },
      signal,
    });

    if (res.status === 401) {
      // The cached token was rejected -- drop it so the next post re-mints
      // rather than repeating a known-bad credential for the whole sweep.
      cachedToken = null;
      log.error("Twitch rejected the app access token");
      return stub("platform-refused");
    }
    if (!res.ok) {
      log.error("Twitch Helix request failed", { status: res.status, kind });
      return stub("platform-refused");
    }

    const data = await res.json();
    const item = Array.isArray(data?.data) ? data.data[0] : undefined;
    if (!item) {
      /* Helix answering 200 with an empty data[] for a well-formed id is the
         platform stating the asset is not there -- a deleted VOD, or a clip
         whose channel is gone. Settled, same as YouTube's empty items[]. */
      log.warn("Twitch returned no asset (deleted, subscriber-only, or invalid id)", { kind });
      return stub("post-deleted");
    }

    const views = toCount(item.view_count);
    const created = item.created_at ? new Date(item.created_at) : undefined;

    /* Clip thumbnails are served ready-sized; VOD thumbnails come back as a
       template carrying %{width} / %{height} placeholders, which render as a
       broken image if stored verbatim. */
    const rawThumb = typeof item.thumbnail_url === "string" ? item.thumbnail_url : null;
    const thumbnailUrl = rawThumb
      ? rawThumb.replace(/%?\{width\}/g, "640").replace(/%?\{height\}/g, "360")
      : null;

    return {
      thumbnailUrl,
      caption: typeof item.title === "string" ? item.title : null,
      ...(views !== undefined ? { viewsCount: views } : {}),
      ...(created && !Number.isNaN(created.getTime()) ? { postedAt: created } : {}),
    };
  } catch (err) {
    log.error("Twitch Helix fetch threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return stub("platform-refused");
  }
}
