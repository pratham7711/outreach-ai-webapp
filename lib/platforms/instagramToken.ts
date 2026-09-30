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

  /* graphGet now THROWS InstagramAuthError rather than returning null when
     Graph rejects a token, and the exchange runs through graphGet -- so the
     very case this function exists to handle (a token close enough to expiry
     that Meta has already disowned it) would throw out of here, past the
     per-post try/catch, and be filed as a generic sync failure. Caught here so
     it lands on the same branch as an exchange that simply returned nothing:
     keep serving what we hold, and say why. */
  let refreshed: Awaited<ReturnType<typeof exchangeForLongLivedToken>> = null;
  try {
    refreshed = await exchangeForLongLivedToken(current);
  } catch (err) {
    createLogger({ context: { platform: "INSTAGRAM", call: "token.ensureFresh" } }).warn(
      "Instagram token exchange was rejected; the creator must reconnect",
      { accountId: account.id, error: err instanceof Error ? err.message : String(err) },
    );
    return current;
  }
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

/**
 * The Instagram name to ask Business Discovery about for one post.
 *
 * The post's own link names its author when it takes the /{user}/reel/ form,
 * and that outranks everything. After it, the creator's connected account, then
 * the Instagram account on their profile. `creator.handle` is an Instagram name
 * only when Instagram is the creator's primary platform: for a TikTok-first
 * creator it is their TikTok handle, which Instagram answers with error 110 --
 * and that used to be the fallback for every post whose creator had not
 * connected Instagram.
 */
export function instagramLookupHandle(source: {
  postUrl: string;
  connected?: string | null;
  profileLink?: string | null;
  creatorHandle?: string | null;
  creatorPlatform?: string | null;
}): string | undefined {
  const fromUrl = source.postUrl.match(/instagram\.com\/([\w.]+)\/(?:reels?|p|tv)\//)?.[1];
  return (
    fromUrl ??
    source.connected ??
    source.profileLink ??
    (source.creatorPlatform === "INSTAGRAM" ? source.creatorHandle : null) ??
    undefined
  );
}

/** Enough of a creator to choose their Instagram name. */
export const INSTAGRAM_HANDLE_SELECT = {
  handle: true,
  platform: true,
  profileLinks: {
    where: { platform: "INSTAGRAM" as const },
    orderBy: { isPrimary: "desc" as const },
    take: 1,
    select: { handle: true },
  },
};

export async function getInstagramAccountForCreator(
  creatorId: string,
  orgId: string,
  postUrl: string,
): Promise<{ token?: string; handle?: string }> {
  const creator = await db.creator.findUnique({
    where: { id: creatorId },
    select: {
      ...INSTAGRAM_HANDLE_SELECT,
      socialAccounts: {
        where: { platform: "INSTAGRAM" },
        select: { id: true, accessToken: true, tokenExpiry: true, handle: true },
      },
    },
  });
  const social = creator?.socialAccounts[0];
  return {
    token: await ensureFreshInstagramToken(social, orgId),
    handle: instagramLookupHandle({
      postUrl,
      connected: social?.handle,
      profileLink: creator?.profileLinks[0]?.handle,
      creatorHandle: creator?.handle,
      creatorPlatform: creator?.platform,
    }),
  };
}
