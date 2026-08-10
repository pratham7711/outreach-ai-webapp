import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto/encrypt";
import { refreshTikTokAccessToken } from "./tiktokDisplay";
import { createLogger } from "@/lib/observability/logger";

const EXPIRY_SKEW_MS = 5 * 60 * 1000;

function isUsable(tokenExpiry: Date | null | undefined): boolean {
  if (!tokenExpiry) return true;
  return tokenExpiry.getTime() - EXPIRY_SKEW_MS > Date.now();
}

export function decryptTikTokToken(
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

export type TikTokAccountTokens = {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: Date | null;
};

// Returns a token that is valid now, refreshing and persisting it first if the
// stored one has expired. Refresh tokens last 365 days, access tokens 24 hours.
export async function ensureFreshTikTokToken(
  account: TikTokAccountTokens | null | undefined,
  orgId: string,
): Promise<string | undefined> {
  if (!account) return undefined;

  const current = decryptTikTokToken(account.accessToken, orgId, account.tokenExpiry);
  if (current) return current;

  if (!account.refreshToken) return undefined;

  let refreshToken: string;
  try {
    refreshToken = decrypt(account.refreshToken, orgId);
  } catch {
    return undefined;
  }

  const refreshed = await refreshTikTokAccessToken(refreshToken);
  if (!refreshed) {
    createLogger({ context: { platform: "TIKTOK", call: "token.ensureFresh" } }).warn(
      "TikTok token refresh produced nothing; connection needs re-authorisation",
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

export async function getTikTokTokenForCreator(
  creatorId: string,
  orgId: string,
): Promise<string | undefined> {
  const creator = await db.creator.findUnique({
    where: { id: creatorId },
    select: {
      socialAccounts: {
        where: { platform: "TIKTOK" },
        select: { id: true, accessToken: true, refreshToken: true, tokenExpiry: true },
      },
    },
  });
  return ensureFreshTikTokToken(creator?.socialAccounts[0], orgId);
}
