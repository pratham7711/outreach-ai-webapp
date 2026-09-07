import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto/encrypt";
import { refreshThreadsToken } from "./threads";
import { createLogger } from "@/lib/observability/logger";

/**
 * Threads refreshes IN PLACE: there is no refresh token, the long-lived access
 * token is itself the credential you present to extend it. That makes the
 * failure mode different from Google's and worth stating — once a Threads token
 * has actually expired there is nothing left to refresh with, and the creator
 * must authorise again. So the refresh has to happen while the token is still
 * valid, not after it stops working.
 *
 * Hence the wide skew below. A long-lived Threads token lasts 60 days, and
 * refreshing at any point in the last week costs one call and saves a
 * reconnect; waiting until the hour before expiry means a creator who does not
 * open the portal that week is disconnected for good.
 */
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

function isUsable(tokenExpiry: Date | null | undefined): boolean {
  if (!tokenExpiry) return true;
  return tokenExpiry.getTime() - EXPIRY_SKEW_MS > Date.now();
}

function nearingExpiry(tokenExpiry: Date | null | undefined): boolean {
  if (!tokenExpiry) return false;
  return tokenExpiry.getTime() - REFRESH_WINDOW_MS < Date.now();
}

export function decryptThreadsToken(
  encrypted: string | null | undefined,
  orgId: string,
  tokenExpiry?: Date | null,
): string | undefined {
  if (!encrypted) return undefined;
  if (!isUsable(tokenExpiry)) return undefined;
  try {
    return decrypt(encrypted, orgId);
  } catch {
    return undefined;
  }
}

export type ThreadsAccountTokens = {
  id: string;
  accessToken: string;
  tokenExpiry: Date | null;
};

/**
 * Returns a usable Threads token, extending and persisting it first if it is
 * inside the refresh window.
 *
 * A refresh that fails is not fatal while the current token still works: the
 * stored one is returned and the next call tries again. It only becomes a
 * reconnect once the token has actually expired.
 */
export async function ensureFreshThreadsToken(
  account: ThreadsAccountTokens | null | undefined,
  orgId: string,
): Promise<string | undefined> {
  if (!account) return undefined;

  const current = decryptThreadsToken(account.accessToken, orgId, account.tokenExpiry);
  if (!current) {
    createLogger({ context: { platform: "THREADS", call: "token.ensureFresh" } }).warn(
      "Threads token has lapsed; connection needs re-authorisation",
      { accountId: account.id },
    );
    return undefined;
  }

  if (!nearingExpiry(account.tokenExpiry)) return current;

  const refreshed = await refreshThreadsToken(current);
  if (!refreshed) {
    createLogger({ context: { platform: "THREADS", call: "token.ensureFresh" } }).warn(
      "Threads token refresh produced nothing; serving the stored token",
      { accountId: account.id },
    );
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
