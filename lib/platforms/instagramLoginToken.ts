import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto/encrypt";
import { createLogger } from "@/lib/observability/logger";
import { decryptInstagramToken } from "./instagramToken";
import { refreshInstagramLoginToken } from "./instagramLogin";

/**
 * Instagram Login rows refresh IN PLACE at graph.instagram.com
 * (`ig_refresh_token`), which is a different call on a different host from the
 * Facebook Login exchange in instagramToken.ts. Routing these rows through that
 * helper sent their token to graph.facebook.com, which does not govern it, so
 * the refresh always failed and the connection died at day 60.
 *
 * Instagram accepts a refresh only while the token is still valid and at least
 * a day old, so the refresh has to happen inside the window, not after. Fourteen
 * days of window and a daily cron (refresh-platform-tokens) give a connection
 * about fourteen attempts before anything breaks.
 */
export const IG_LOGIN_REFRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type InstagramLoginAccountTokens = {
  id: string;
  accessToken: string;
  tokenExpiry: Date | null;
};

function insideWindow(tokenExpiry: Date | null | undefined): boolean {
  if (!tokenExpiry) return false;
  return tokenExpiry.getTime() - IG_LOGIN_REFRESH_WINDOW_MS <= Date.now();
}

/**
 * A usable Instagram Login token, extended and persisted first when it is
 * inside the refresh window.
 *
 * A refresh that fails is not fatal while the stored token still works: it is
 * returned and the next call tries again. Only an already-expired token means
 * the creator must reconnect.
 */
export async function ensureFreshInstagramLoginToken(
  account: InstagramLoginAccountTokens | null | undefined,
  orgId: string,
): Promise<string | undefined> {
  if (!account) return undefined;
  const log = createLogger({ context: { platform: "INSTAGRAM", call: "iglogin.ensureFresh" } });

  const current = decryptInstagramToken(account.accessToken, orgId, account.tokenExpiry);
  if (!current) {
    log.warn("Instagram Login token has lapsed; connection needs re-authorisation", {
      accountId: account.id,
    });
    return undefined;
  }

  if (!insideWindow(account.tokenExpiry)) return current;

  const refreshed = await refreshInstagramLoginToken(current);
  if (!refreshed) {
    log.warn("Instagram Login token refresh produced nothing; serving the stored token", {
      accountId: account.id,
    });
    return current;
  }

  await db.creatorSocialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encrypt(refreshed.accessToken, orgId),
      tokenExpiry: refreshed.expiresAt,
    },
  });
  return refreshed.accessToken;
}
