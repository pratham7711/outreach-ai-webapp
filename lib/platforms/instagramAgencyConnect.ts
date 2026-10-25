import { db } from "@/lib/db";
import { appBaseUrl, clientCredentialsFor, requestedScopes } from "@/lib/oauth/providers";
import { exchangeForLongLivedToken, graphGet } from "@/lib/platforms/instagram";
import { fetchMetaGrantorId } from "@/lib/platforms/metaGrantor";
import { hasSharedFacebookPage } from "@/lib/platforms/facebookPage";
import { revokeInstagramToken } from "@/lib/platforms/instagramAccount";
import { ASSUMED_LIFETIME_DAYS, getInstagramBusinessToken } from "@/lib/platforms/instagramBusinessToken";
import { TOKEN_B_ENV } from "@/lib/platforms/instagramDiscoveryTokens";
import {
  otherAgencyGrantors,
  storeAgencyCredential,
  type AgencyIgAccount,
} from "@/lib/platforms/instagramAgencyCredential";
import { createLogger } from "@/lib/observability/logger";

/**
 * Settings → Integrations → "Instagram Business account (for creator lookups)".
 *
 * The same Meta app and the same four scopes as the creator-side Facebook Login
 * ("instagram" in lib/oauth/providers), on a callback of its own, because the
 * account is the agency's and the session is an agency user's.
 */

export const AGENCY_IG_STATE_COOKIE = "agency_ig_oauth_state";
const AUTHORIZE_URL = "https://www.facebook.com/v26.0/dialog/oauth";
const TOKEN_URL = "https://graph.facebook.com/v26.0/oauth/access_token";
const DAY_MS = 24 * 60 * 60 * 1000;

const log = createLogger({ context: { platform: "INSTAGRAM", call: "agencyConnect" } });

export function agencyRedirectUri(): string {
  return `${appBaseUrl()}/api/settings/integrations/instagram/callback`;
}

export function agencyScopes(): string[] {
  return requestedScopes("instagram");
}

/** The cookie that binds a consent to this browser AND this org. */
export function agencyStateCookieValue(state: string, orgId: string): string {
  return `${state}.${orgId}`;
}

export function agencyStateMatches(
  cookie: string | undefined,
  state: string | null,
  orgId: string,
): boolean {
  return Boolean(cookie && state && cookie === agencyStateCookieValue(state, orgId));
}

export function buildAgencyAuthorizeUrl(state: string): string | null {
  const creds = clientCredentialsFor("instagram");
  if (!creds) return null;
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", agencyRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", agencyScopes().join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

export type AgencyConnectFailure =
  | "provider"
  | "token_exchange"
  | "token_missing"
  | "no_page"
  | "no_instagram_account"
  | "store";

export type AgencyConnectResult =
  | { ok: true; account: AgencyIgAccount & { pageName: string | null } }
  | { ok: false; reason: AgencyConnectFailure };

type PageWithIg = {
  id?: unknown;
  name?: unknown;
  instagram_business_account?: { id?: unknown; username?: unknown } | null;
};

/** The first Page the grant reaches that has an Instagram professional account linked. */
export async function pickInstagramAccount(
  token: string,
): Promise<(Omit<AgencyIgAccount, "fbUserId"> & { pageName: string | null }) | null> {
  const data = await graphGet("me/accounts", {
    fields: "id,name,instagram_business_account{id,username}",
    access_token: token,
    limit: "50",
  });
  const pages: PageWithIg[] = Array.isArray(data?.data) ? data.data : [];
  for (const page of pages) {
    const ig = page.instagram_business_account;
    if (ig && typeof ig.id === "string" && ig.id && typeof ig.username === "string" && ig.username) {
      return {
        igUserId: ig.id,
        username: ig.username,
        pageId: typeof page.id === "string" ? page.id : null,
        pageName: typeof page.name === "string" ? page.name : null,
      };
    }
  }
  return null;
}

/**
 * Code → token → long-lived token → the Page's Instagram account → stored for
 * the org. The short-lived token is kept, with its own expiry, only when Meta
 * will not exchange it: a connection that works for two hours is still better
 * than none, and the settings card shows the date.
 */
export async function connectAgencyInstagram(orgId: string, code: string): Promise<AgencyConnectResult> {
  const creds = clientCredentialsFor("instagram");
  if (!creds) return { ok: false, reason: "provider" };

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: agencyRedirectUri(),
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) {
    let detail: unknown = null;
    try {
      detail = await res?.json();
    } catch {
      detail = null;
    }
    log.warn("agency Instagram code exchange rejected", { orgId, status: res?.status ?? null, detail });
    return { ok: false, reason: "token_exchange" };
  }
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  const shortLived = body?.access_token;
  if (typeof shortLived !== "string" || !shortLived) return { ok: false, reason: "token_missing" };

  const longLived = await exchangeForLongLivedToken(shortLived).catch(() => null);
  const accessToken = longLived?.accessToken ?? shortLived;
  const expiresAt =
    longLived?.expiresAt ??
    (longLived
      ? new Date(Date.now() + ASSUMED_LIFETIME_DAYS * DAY_MS)
      : typeof body?.expires_in === "number" && body.expires_in > 0
        ? new Date(Date.now() + body.expires_in * 1000)
        : new Date(Date.now() + 2 * 60 * 60 * 1000));

  const picked = await pickInstagramAccount(accessToken).catch(() => null);
  if (!picked) {
    /* Facebook sharing no Page and sharing Pages with no Instagram on them are
       fixed differently, so they are told apart (see hasSharedFacebookPage). */
    const shared = await hasSharedFacebookPage(accessToken);
    return { ok: false, reason: shared === false ? "no_page" : "no_instagram_account" };
  }
  const fbUserId = await fetchMetaGrantorId("instagram", accessToken);

  const account: AgencyIgAccount = {
    igUserId: picked.igUserId,
    username: picked.username,
    pageId: picked.pageId,
    fbUserId,
  };
  try {
    await storeAgencyCredential(orgId, { accessToken, expiresAt, account });
  } catch (err) {
    log.error("agency Instagram credential could not be stored", {
      orgId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "store" };
  }
  return { ok: true, account: { ...account, pageName: picked.pageName } };
}

export type RevokeDecision = "revoked" | "revoke-failed" | "shared-grant" | "unknown-grantor";

/**
 * DELETE /me/permissions drops every permission the Facebook user gave this
 * app, not just this token's, so it would also cut off the platform's own
 * Business Discovery token or a creator connection granted by the same person.
 * It is called only when nothing else held here was granted by that user, and
 * when that cannot be established the grant is left in place.
 */
export async function revokeAgencyGrantIfUnshared(
  orgId: string,
  token: string | null,
  account: AgencyIgAccount | null,
  env: Record<string, string | undefined> = process.env,
): Promise<RevokeDecision> {
  const fbUserId = account?.fbUserId ?? null;
  if (!token || !fbUserId || !account) return "unknown-grantor";
  try {
    if ((await otherAgencyGrantors(orgId)).has(fbUserId)) return "shared-grant";
    const sameCreatorGrant = await db.creatorAccountState.count({ where: { grantorUserId: fbUserId } });
    if (sameCreatorGrant > 0) return "shared-grant";
    const sameCreatorAccount = await db.creatorSocialAccount.count({
      where: { platform: "INSTAGRAM", platformUserId: account.igUserId },
    });
    if (sameCreatorAccount > 0) return "shared-grant";
  } catch {
    return "unknown-grantor";
  }
  const operator = await operatorTokenGrantedBy(fbUserId, env);
  if (operator === null) return "unknown-grantor";
  if (operator) return "shared-grant";
  return (await revokeInstagramToken(token)) ? "revoked" : "revoke-failed";
}

/**
 * Whether a token the platform itself reads Business Discovery with (the
 * operator token, the standby token B) was granted by this Facebook user.
 * null when a token's grantor could not be read.
 */
export async function operatorTokenGrantedBy(
  fbUserId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean | null> {
  for (const platformToken of [await getInstagramBusinessToken(), env[TOKEN_B_ENV]?.trim()]) {
    if (!platformToken) continue;
    const grantor = await fetchMetaGrantorId("instagram", platformToken);
    if (!grantor) return null;
    if (grantor === fbUserId) return true;
  }
  return false;
}
