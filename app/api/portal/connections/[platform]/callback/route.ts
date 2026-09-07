import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { findCreatorForHandle } from "@/lib/portal/creatorLookup";
import { encrypt } from "@/lib/crypto/encrypt";
import { exchangeForLongLivedToken } from "@/lib/platforms/instagram";
import { exchangeThreadsToken } from "@/lib/platforms/threads";
import {
  buildTokenRequest,
  isOAuthPlatform,
  isProviderConfigured,
  toPlatformEnum,
  type OAuthPlatform,
} from "@/lib/oauth/providers";
import {
  fetchAccountIdentity,
  identityWriteData,
} from "@/lib/platforms/accountSync";
import { createLogger } from "@/lib/observability/logger";
import { returnToWithQuery } from "@/lib/oauth/returnTo";

const STATE_COOKIE = "portal_oauth_state";

const RETURN_COOKIE = "portal_oauth_return";

function finishRedirect(req: NextRequest, query: string) {
  const target = returnToWithQuery(req.cookies.get(RETURN_COOKIE)?.value, query);
  const res = NextResponse.redirect(new URL(target, req.url));
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(RETURN_COOKIE);
  return res;
}

/* Every failure used to collapse to the same `error=<platform>` redirect, so a
   consent that completed at Meta and then bounced back as "Failed to connect"
   gave no hint which of seven branches had fired. The reason rides along in the
   URL (no secrets, a fixed vocabulary) so it can be read off the address bar
   when the runtime log is not at hand. */
export type CallbackFailure =
  | "state"
  | "provider"
  | "token_exchange"
  | "token_missing"
  | "creator"
  | "identity"
  | "exception";

function failureRedirect(
  req: NextRequest,
  platform: OAuthPlatform,
  reason: CallbackFailure,
) {
  return finishRedirect(req, `error=${platform}&reason=${reason}`);
}

const log = createLogger({ context: { call: "oauth.callback" } });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const session = await getCreatorSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { platform } = await params;
  if (!isOAuthPlatform(platform))
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });

  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;
  if (!state || !code || !cookieState || state !== cookieState) {
    log.warn("OAuth state check failed", {
      platform,
      hasState: Boolean(state),
      hasCode: Boolean(code),
      hasCookie: Boolean(cookieState),
    });
    return failureRedirect(req, platform, "state");
  }

  if (!isProviderConfigured(platform))
    return failureRedirect(req, platform, "provider");

  try {
    const tokenRequest = buildTokenRequest(platform, code);
    if (!tokenRequest) return failureRedirect(req, platform, "provider");

    const tokenRes = await fetch(tokenRequest.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenRequest.body,
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) {
      /* The provider's error body names the cause (bad secret, redirect_uri
         mismatch, reused code); the request body is never logged because it
         carries the client secret. */
      let detail: unknown = null;
      try {
        detail = await tokenRes.json();
      } catch {
        // non-JSON error body; the status alone has to do
      }
      log.warn("OAuth code exchange rejected", {
        platform,
        status: tokenRes.status,
        detail,
      });
      return failureRedirect(req, platform, "token_exchange");
    }

    const tokens = (await tokenRes.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    const accessToken = tokens.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      log.warn("OAuth code exchange returned no access_token", {
        platform,
        keys: Object.keys(tokens ?? {}),
      });
      return failureRedirect(req, platform, "token_missing");
    }

    const creator = await findCreatorForHandle(session.handle);
    if (!creator) {
      log.warn("No creator row matches the portal handle", { platform });
      return failureRedirect(req, platform, "creator");
    }

    const platformEnum = toPlatformEnum(platform);
    /* Meta's code exchange hands back a token good for an hour or two. Trading
       it for the long-lived one here is the difference between a connection
       that works until lunchtime and one that works for two months; nothing
       downstream can recover a token that has already expired, because there is
       no refresh grant for a Facebook user token.

       Falls back to the short-lived token when the exchange is unavailable,
       fails, or is rejected outright (graphGet throws InstagramAuthError for
       that) -- a working connection with an honest two-hour expiry beats
       refusing the connection at the last step of the flow. */
    let storedToken = accessToken;
    let storedExpiry =
      typeof tokens.expires_in === "number" && tokens.expires_in > 0
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;
    /* Facebook takes the same exchange as Instagram: both are Meta user tokens
       from the same dialog, and the short-lived one lasts about two hours. */
    if (platform === "instagram" || platform === "facebook") {
      try {
        const longLived = await exchangeForLongLivedToken(accessToken);
        if (longLived) {
          storedToken = longLived.accessToken;
          storedExpiry = longLived.expiresAt ?? storedExpiry;
        }
      } catch {
        // Keep the short-lived token; its recorded expiry stays honest.
      }
    }

    /* Threads has its own exchange on its own host, and it matters more here
       than elsewhere: Threads refreshes IN PLACE with no refresh token, so a
       short-lived token stored now cannot be extended later — it simply dies in
       an hour and the creator has to reconnect. */
    if (platform === "threads") {
      try {
        const longLived = await exchangeThreadsToken(accessToken);
        if (longLived) {
          storedToken = longLived.accessToken;
          storedExpiry = longLived.expiresAt ?? storedExpiry;
        }
      } catch {
        // Keep the short-lived token; its recorded expiry stays honest.
      }
    }

    const encryptedAccess = encrypt(storedToken, creator.orgId);
    const encryptedRefresh =
      typeof tokens.refresh_token === "string" && tokens.refresh_token
        ? encrypt(tokens.refresh_token, creator.orgId)
        : null;
    const tokenExpiry = storedExpiry;

    /* The identity call comes BEFORE the write, because `platformUserId` is
       part of the account's unique key. That is what lets one creator link
       several accounts on the same platform: keyed on the platform account,
       authorising a second TikTok handle creates a second row, while
       re-authorising the first one updates it in place. Keyed on
       [creatorId, platform] — as it was — the second connection would silently
       overwrite the first.

       No identity means no key, so the connection fails rather than storing a
       row that cannot be told apart from the creator's other accounts. */
    /* storedToken, not accessToken: for Threads especially these differ, and the
       identity must be read with the credential the row will actually hold — a
       token that reads an identity but is not the one we keep proves nothing
       about whether the stored connection works. */
    const identity = await fetchAccountIdentity(platform, storedToken);
    if (!identity?.platformUserId) {
      createLogger({
        context: { platform: platformEnum, call: "oauth.callback" },
      }).warn("Authorised but no account identity could be read; not storing", {
        creatorId: creator.id,
      });
      return failureRedirect(req, platform, "identity");
    }

    const identityData = identityWriteData(identity);

    await db.creatorSocialAccount.upsert({
      where: {
        creatorId_platform_platformUserId: {
          creatorId: creator.id,
          platform: platformEnum,
          platformUserId: identity.platformUserId,
        },
      },
      create: {
        creatorId: creator.id,
        platform: platformEnum,
        /* Falls back to the portal username only when the platform returned a
           blank handle, so the row never renders as an empty account. */
        handle: identity.handle || session.handle,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiry,
        ...identityData,
      },
      update: {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiry,
        ...identityData,
      },
      select: { id: true },
    });

    return finishRedirect(req, `connected=${platform}`);
  } catch (error) {
    log.error("OAuth callback threw", {
      platform,
      message: error instanceof Error ? error.message : String(error),
    });
    return failureRedirect(req, platform, "exception");
  }
}
