import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto/encrypt";
import { refreshYouTubeAccessTokenResult } from "./youtube";
import { createLogger } from "@/lib/observability/logger";
import { isReconnectNeeded, markReconnectNeeded } from "./accountState";
import { connectionForRead } from "@/lib/creators/connectionGate";
import { REVOKE_REASONS, revokeGrantsForConnections } from "@/lib/creators/grants";

const EXPIRY_SKEW_MS = 5 * 60 * 1000;

function isUsable(tokenExpiry: Date | null | undefined): boolean {
  if (!tokenExpiry) return true;
  return tokenExpiry.getTime() - EXPIRY_SKEW_MS > Date.now();
}

export function decryptYouTubeToken(
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

export type YouTubeAccountTokens = {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: Date | null;
};

/**
 * Returns a token that is valid now, refreshing and persisting first if the
 * stored one has expired.
 *
 * Google access tokens last an hour, so unlike TikTok's 24 hours this path is
 * the normal case rather than the exception — a creator who connects and comes
 * back tomorrow will always arrive here.
 *
 * The refresh token is only replaced when Google actually sends a new one.
 * Google normally does not, so overwriting it with the null it returns would
 * discard a working credential and turn every connection into a reconnect.
 *
 * Google's `invalid_grant` marks the connection "Reconnect needed" and NOTHING
 * ELSE: no delete, no token wipe. While Google's app is in Testing mode every
 * refresh token dies after seven days, so treating invalid_grant as a
 * disconnect would delete every YouTube connection weekly. A marked connection
 * is not refreshed again — the answer will not change until the creator
 * reconnects, and the reconnect clears the mark (the OAuth callback).
 */
export async function ensureFreshYouTubeToken(
  account: YouTubeAccountTokens | null | undefined,
  orgId: string,
): Promise<string | undefined> {
  if (!account) return undefined;

  const current = decryptYouTubeToken(account.accessToken, orgId, account.tokenExpiry);
  if (current) return current;

  if (!account.refreshToken) return undefined;
  if (await isReconnectNeeded(account.id)) return undefined;

  let refreshToken: string;
  try {
    refreshToken = decrypt(account.refreshToken, orgId);
  } catch {
    return undefined;
  }

  const result = await refreshYouTubeAccessTokenResult(refreshToken);
  if (!result.ok) {
    const marked =
      result.reason === "invalid_grant"
        ? await markReconnectNeeded(account.id, "invalid_grant")
        : false;
    /* The consent is over at Google, so every org's grant on it ends here too,
       with the reason on the record. Still a mark and not a delete: the row,
       its token and the grant history all stay, and the reconnect records a
       new grant. */
    if (result.reason === "invalid_grant") {
      await revokeGrantsForConnections([account.id], REVOKE_REASONS.INVALID_GRANT);
    }
    createLogger({ context: { platform: "YOUTUBE", call: "token.ensureFresh" } }).warn(
      "YouTube token refresh produced nothing; connection needs re-authorisation",
      { accountId: account.id, reason: result.reason, marked },
    );
    return undefined;
  }
  const refreshed = result.token;

  await db.creatorSocialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encrypt(refreshed.accessToken, orgId),
      refreshToken: refreshed.refreshToken
        ? encrypt(refreshed.refreshToken, orgId)
        : account.refreshToken,
      tokenExpiry: refreshed.expiresAt,
    },
  });

  return refreshed.accessToken;
}

/** The YouTube counterpart of getTikTokTokenForCreator: gated on `orgId`'s grant. */
export async function getYouTubeTokenForCreator(
  creatorId: string,
  orgId: string,
): Promise<string | undefined> {
  const read = await connectionForRead(orgId, creatorId, "YOUTUBE");
  return read.ok ? ensureFreshYouTubeToken(read.connection, orgId) : undefined;
}
