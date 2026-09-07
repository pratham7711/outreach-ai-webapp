import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto/encrypt";
import { refreshYouTubeAccessToken } from "./youtube";
import { createLogger } from "@/lib/observability/logger";

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
 */
export async function ensureFreshYouTubeToken(
  account: YouTubeAccountTokens | null | undefined,
  orgId: string,
): Promise<string | undefined> {
  if (!account) return undefined;

  const current = decryptYouTubeToken(account.accessToken, orgId, account.tokenExpiry);
  if (current) return current;

  if (!account.refreshToken) return undefined;

  let refreshToken: string;
  try {
    refreshToken = decrypt(account.refreshToken, orgId);
  } catch {
    return undefined;
  }

  const refreshed = await refreshYouTubeAccessToken(refreshToken);
  if (!refreshed) {
    createLogger({ context: { platform: "YOUTUBE", call: "token.ensureFresh" } }).warn(
      "YouTube token refresh produced nothing; connection needs re-authorisation",
      { accountId: account.id },
    );
    return undefined;
  }

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

export async function getYouTubeTokenForCreator(
  creatorId: string,
  orgId: string,
): Promise<string | undefined> {
  const creator = await db.creator.findUnique({
    where: { id: creatorId },
    select: {
      socialAccounts: {
        where: { platform: "YOUTUBE" },
        select: { id: true, accessToken: true, refreshToken: true, tokenExpiry: true },
      },
    },
  });
  return ensureFreshYouTubeToken(creator?.socialAccounts[0], orgId);
}
