import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { findCreatorForHandle } from "@/lib/portal/creatorLookup";
import { encrypt } from "@/lib/crypto/encrypt";
import {
  buildAuthorizeUrl,
  isOAuthPlatform,
  isProviderConfigured,
  toPlatformEnum,
} from "@/lib/oauth/providers";
import { safeReturnTo, returnToWithQuery } from "@/lib/oauth/returnTo";
import { resolvePlatformCapability } from "@/lib/capabilities";
import { ACCOUNT_ORIGINS } from "@/lib/platforms/accountOrigin";
import {
  connectLinkPath,
  connectState,
  isWellFormedConnectToken,
  markConnectTokenUsed,
  resolveConnectToken,
} from "@/lib/creators/connectToken";

const STATE_COOKIE = "portal_oauth_state";
const RETURN_COOKIE = "portal_oauth_return";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600,
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  /* A connect link (/connect/<token>) starts here with ?connect=<token> and no
     login at all. It is a separate branch rather than a variation of the one
     below so the signed-in flow is exactly what it was. */
  const connectToken = req.nextUrl.searchParams.get("connect");
  if (connectToken !== null) return startFromConnectLink(req, (await params).platform, connectToken);

  const session = await getCreatorSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { platform } = await params;
  if (!isOAuthPlatform(platform))
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });

  const capability = resolvePlatformCapability(platform);
  if (capability.connect === "coming_soon")
    return NextResponse.json(
      { error: capability.connectNote, status: "coming_soon" },
      { status: 503 },
    );

  /* A connection is stored on the org-side Creator row that mirrors this
     portal account, so a creator no brand has rostered yet has nowhere to put
     one. Checked here, before the provider dialog, because the callback used
     to discover this only after the creator had completed consent at Google or
     Meta and then bounce them back with a bare "Failed to connect". */
  const rosterCreator = await findCreatorForHandle(session.handle);
  if (!rosterCreator)
    return NextResponse.redirect(
      new URL(
        returnToWithQuery(
          req.nextUrl.searchParams.get("returnTo"),
          `error=${platform}&reason=creator`,
        ),
        req.url,
      ),
    );

  if (isProviderConfigured(platform)) {
    const state = randomBytes(16).toString("hex");
    const authorizeUrl = buildAuthorizeUrl(platform, state);
    if (!authorizeUrl)
      /* This endpoint is reached by a full-page navigation from a Connect
         button, so a JSON body renders as raw text in the address bar with no
         way back. Every other failure in this flow already redirects with a
         reason; this one did not. */
      return NextResponse.redirect(
        new URL(
          returnToWithQuery(
            req.nextUrl.searchParams.get("returnTo"),
            `error=${platform}&reason=provider`,
          ),
          req.url,
        ),
      );
    const res = NextResponse.redirect(authorizeUrl);
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: 600,
    };
    res.cookies.set(STATE_COOKIE, state, cookieOptions);
    const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
    if (returnTo) res.cookies.set(RETURN_COOKIE, returnTo, cookieOptions);
    return res;
  }

  if (process.env.NODE_ENV === "production")
    /* Same reasoning as above: a creator who clicks Connect on a platform
       whose credentials are not set in this environment gets sent back to the
       screen they came from with a reason, not a JSON blob. */
    return NextResponse.redirect(
      new URL(
        returnToWithQuery(
          req.nextUrl.searchParams.get("returnTo"),
          `error=${platform}&reason=provider`,
        ),
        req.url,
      ),
    );

  const devReturnTo = req.nextUrl.searchParams.get("returnTo");

  try {
    const creator = rosterCreator;

    const platformEnum = toPlatformEnum(platform);
    const accessToken = encrypt(
      `dev-token-${platform}-${Date.now()}`,
      creator.orgId,
    );

    /* A stable synthetic account id, so repeating the dev connect updates the
       same row instead of piling up duplicates. Accounts are keyed on
       [creatorId, platform, platformUserId] now that a creator can link
       several per platform, and a dev connection has no real one. */
    const devPlatformUserId = `dev-${platform}-${creator.id}`;

    await db.creatorSocialAccount.upsert({
      where: {
        creatorId_platform_platformUserId: {
          creatorId: creator.id,
          platform: platformEnum,
          platformUserId: devPlatformUserId,
        },
      },
      create: {
        creatorId: creator.id,
        platform: platformEnum,
        platformUserId: devPlatformUserId,
        handle: session.handle,
        accessToken,
      },
      update: {
        handle: session.handle,
        accessToken,
      },
    });

    return NextResponse.redirect(
      new URL(returnToWithQuery(devReturnTo, `connected=${platform}`), req.url),
    );
  } catch (error) {
    console.error(`Dev connect failed for ${platform}:`, error);
    return NextResponse.redirect(
      new URL(returnToWithQuery(devReturnTo, `error=${platform}`), req.url),
    );
  }
}

/**
 * The connect-link start: the roster row comes from the token, never from a
 * handle, and the token's row id rides through OAuth inside a signed state.
 * Every outcome lands back on /connect/<token>, the page the creator came from.
 */
async function startFromConnectLink(req: NextRequest, platform: string, token: string) {
  if (!isWellFormedConnectToken(token))
    return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const back = connectLinkPath(token);
  const backWith = (query: string) =>
    NextResponse.redirect(new URL(returnToWithQuery(back, query), req.url));

  if (!isOAuthPlatform(platform)) return backWith("error=platform");

  const capability = resolvePlatformCapability(platform);
  if (capability.connect === "coming_soon") return backWith(`error=${platform}&reason=provider`);

  const binding = await resolveConnectToken(token);
  if (!binding) return backWith("error=link");

  if (isProviderConfigured(platform)) {
    const state = connectState(binding.tokenId);
    const authorizeUrl = state ? buildAuthorizeUrl(platform, state) : null;
    if (!state || !authorizeUrl) return backWith(`error=${platform}&reason=provider`);
    const res = NextResponse.redirect(authorizeUrl);
    res.cookies.set(STATE_COOKIE, state, COOKIE_OPTIONS);
    res.cookies.set(RETURN_COOKIE, back, COOKIE_OPTIONS);
    return res;
  }

  if (process.env.NODE_ENV === "production") return backWith(`error=${platform}&reason=provider`);

  /* The same non-production shortcut as the signed-in flow, onto the bound
     row, so the whole connect-link journey can be walked locally without a
     real consent screen. */
  try {
    const platformEnum = toPlatformEnum(platform);
    const devPlatformUserId = `dev-${platform}-${binding.creatorId}`;
    const accessToken = encrypt(`dev-token-${platform}-${Date.now()}`, binding.orgId);
    await db.creatorSocialAccount.upsert({
      where: {
        creatorId_platform_platformUserId: {
          creatorId: binding.creatorId,
          platform: platformEnum,
          platformUserId: devPlatformUserId,
        },
      },
      create: {
        creatorId: binding.creatorId,
        platform: platformEnum,
        platformUserId: devPlatformUserId,
        handle: binding.creatorHandle,
        accessToken,
        origin: ACCOUNT_ORIGINS.DEV,
      },
      update: { accessToken },
    });
    await markConnectTokenUsed(binding.tokenId);
    return backWith(`connected=${platform}`);
  } catch (error) {
    console.error(`Dev connect (link) failed for ${platform}:`, error);
    return backWith(`error=${platform}`);
  }
}
