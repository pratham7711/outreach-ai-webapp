import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto/encrypt";
import { exchangeForLongLivedToken } from "./instagram";
import { createLogger } from "@/lib/observability/logger";

const EXPIRY_SKEW_MS = 5 * 60 * 1000;
const REFRESH_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

function isUsable(tokenExpiry: Date | null | undefined): boolean {
  if (!tokenExpiry) return true;
  return tokenExpiry.getTime() - EXPIRY_SKEW_MS > Date.now();
}

function nearingExpiry(tokenExpiry: Date | null | undefined): boolean {
  if (!tokenExpiry) return false;
  return tokenExpiry.getTime() - REFRESH_AHEAD_MS <= Date.now();
}

export function decryptInstagramToken(
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

export type InstagramAccountTokens = {
  id: string;
  accessToken: string;
  tokenExpiry: Date | null;
};

// Facebook issues no refresh_token, so a connection stays alive only by trading
// a still-valid token for a fresh long-lived one before it lapses. Once a token
// has actually expired nothing can recover it and the creator must reconnect.
export async function ensureFreshInstagramToken(
  account: InstagramAccountTokens | null | undefined,
  orgId: string,
): Promise<string | undefined> {
  if (!account) return undefined;

  const current = decryptInstagramToken(account.accessToken, orgId, account.tokenExpiry);
  if (!current) {
    createLogger({ context: { platform: "INSTAGRAM", call: "token.ensureFresh" } }).warn(
      "Instagram token has lapsed; connection needs re-authorisation",
      { accountId: account.id },
    );
    return undefined;
  }

  if (!nearingExpiry(account.tokenExpiry)) return current;

  const refreshed = await exchangeForLongLivedToken(current);
  if (!refreshed) {
    createLogger({ context: { platform: "INSTAGRAM", call: "token.ensureFresh" } }).warn(
      "Instagram token exchange produced nothing; using the existing token while it lasts",
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

export async function getInstagramAccountForCreator(
  creatorId: string,
  orgId: string,
): Promise<{ token?: string; handle?: string }> {
  const creator = await db.creator.findUnique({
    where: { id: creatorId },
    select: {
      handle: true,
      socialAccounts: {
        where: { platform: "INSTAGRAM" },
        select: { id: true, accessToken: true, tokenExpiry: true, handle: true },
      },
    },
  });
  const social = creator?.socialAccounts[0];
  return {
    token: await ensureFreshInstagramToken(social, orgId),
    handle: social?.handle ?? creator?.handle ?? undefined,
  };
}
