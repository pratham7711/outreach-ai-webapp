import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto/encrypt";

export function decryptInstagramToken(
  encrypted: string | null | undefined,
  orgId: string,
): string | undefined {
  if (!encrypted) return undefined;
  try {
    return decrypt(encrypted, orgId);
  } catch {
    return undefined;
  }
}

/**
 * Trade the code-exchange token for one that outlives the afternoon.
 *
 * Meta's OAuth code exchange returns a SHORT-LIVED user token, good for one to
 * two hours. Nothing here ever exchanged it, so a creator who connected
 * Instagram had a working connection until roughly lunchtime and a dead one
 * after -- and because graphGet swallows the resulting code-190 error and
 * returns null, the failure surfaced as "no metrics" rather than as "reconnect
 * Instagram". TikTok has had ensureFreshTikTokToken for exactly this from the
 * start; this is the missing other half.
 *
 * The exchange yields ~60 days. There is no refresh grant for a Facebook user
 * token -- you re-exchange a still-valid long-lived token, or the creator
 * reconnects -- so tokenExpiry is what tells us which of those is due.
 *
 * Returns null when the exchange is not possible or fails, and the caller then
 * stores the short-lived token: two hours of working connection beats none, and
 * the expiry recorded alongside it is honest about what was obtained.
 */
export async function exchangeForLongLivedInstagramToken(
  shortLivedToken: string,
  signal?: AbortSignal,
): Promise<{ token: string; expiresInSeconds?: number } | null> {
  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const url = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  try {
    const res = await fetch(url.toString(), { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== "string" || !data.access_token) return null;
    return {
      token: data.access_token,
      ...(typeof data.expires_in === "number" && data.expires_in > 0
        ? { expiresInSeconds: data.expires_in }
        : {}),
    };
  } catch {
    return null;
  }
}

export async function getInstagramAccountForCreator(
  creatorId: string,
  orgId: string,
): Promise<{ token?: string; handle?: string; expired?: boolean }> {
  const creator = await db.creator.findUnique({
    where: { id: creatorId },
    select: {
      handle: true,
      socialAccounts: {
        where: { platform: "INSTAGRAM" },
        select: { accessToken: true, handle: true, tokenExpiry: true },
      },
    },
  });
  const social = creator?.socialAccounts[0];

  /* tokenExpiry was written at connect time and then never read by anything.
     An expired Meta token does not fail loudly -- graphGet swallows the code
     190 and returns null -- so spending a Graph call on one costs a request and
     yields a result indistinguishable from "this creator has no professional
     account". Checking the date we already hold turns that into a fact the
     caller can act on: `expired` is what a UI needs to say "reconnect
     Instagram" instead of showing a post with no engagement. */
  const expiry = social?.tokenExpiry ?? null;
  const expired = expiry !== null && expiry.getTime() <= Date.now();

  return {
    token: expired ? undefined : decryptInstagramToken(social?.accessToken, orgId),
    handle: social?.handle ?? creator?.handle ?? undefined,
    expired,
  };
}
