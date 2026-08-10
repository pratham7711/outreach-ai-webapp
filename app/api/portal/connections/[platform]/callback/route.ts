import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { encrypt } from "@/lib/crypto/encrypt";
import {
  buildTokenRequest,
  isOAuthPlatform,
  isProviderConfigured,
  toPlatformEnum,
  type OAuthPlatform,
} from "@/lib/oauth/providers";
import { fetchTikTokUserInfo } from "@/lib/platforms/tiktokDisplay";
import { returnToWithQuery } from "@/lib/oauth/returnTo";

const STATE_COOKIE = "portal_oauth_state";

async function findSessionCreator(handle: string) {
  const bare = handle.replace(/^@/, "");
  return db.creator.findFirst({
    where: {
      deletedAt: null,
      OR: [{ handle: bare }, { handle: `@${bare}` }],
    },
    orderBy: { addedAt: "asc" },
    select: { id: true, orgId: true },
  });
}

const RETURN_COOKIE = "portal_oauth_return";

function finishRedirect(req: NextRequest, query: string) {
  const target = returnToWithQuery(req.cookies.get(RETURN_COOKIE)?.value, query);
  const res = NextResponse.redirect(new URL(target, req.url));
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(RETURN_COOKIE);
  return res;
}

function failureRedirect(req: NextRequest, platform: OAuthPlatform) {
  return finishRedirect(req, `error=${platform}`);
}

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
  if (!state || !code || !cookieState || state !== cookieState)
    return failureRedirect(req, platform);

  if (!isProviderConfigured(platform)) return failureRedirect(req, platform);

  try {
    const tokenRequest = buildTokenRequest(platform, code);
    if (!tokenRequest) return failureRedirect(req, platform);

    const tokenRes = await fetch(tokenRequest.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenRequest.body,
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) return failureRedirect(req, platform);

    const tokens = (await tokenRes.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    const accessToken = tokens.access_token;
    if (typeof accessToken !== "string" || !accessToken)
      return failureRedirect(req, platform);

    const creator = await findSessionCreator(session.handle);
    if (!creator) return failureRedirect(req, platform);

    const platformEnum = toPlatformEnum(platform);
    const encryptedAccess = encrypt(accessToken, creator.orgId);
    const encryptedRefresh =
      typeof tokens.refresh_token === "string" && tokens.refresh_token
        ? encrypt(tokens.refresh_token, creator.orgId)
        : null;
    const tokenExpiry =
      typeof tokens.expires_in === "number" && tokens.expires_in > 0
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;

    await db.creatorSocialAccount.upsert({
      where: {
        creatorId_platform: { creatorId: creator.id, platform: platformEnum },
      },
      create: {
        creatorId: creator.id,
        platform: platformEnum,
        handle: session.handle,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiry,
      },
      update: {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiry,
      },
    });

    if (platform === "tiktok") {
      const info = await fetchTikTokUserInfo(accessToken);
      if (info) {
        const handle = info.username || session.handle;
        await db.creatorSocialAccount.update({
          where: {
            creatorId_platform: {
              creatorId: creator.id,
              platform: platformEnum,
            },
          },
          data: { handle, followersCount: info.followerCount },
        });
        await db.creator.update({
          where: { id: creator.id },
          data: {
            platformUserId: info.openId,
            followersCount: info.followerCount,
            ...(info.avatarUrl ? { avatarUrl: info.avatarUrl } : {}),
            ...(info.bio ? { bio: info.bio } : {}),
          },
        });
      }
    }

    return finishRedirect(req, `connected=${platform}`);
  } catch {
    console.error(`OAuth callback failed for ${platform}`);
    return failureRedirect(req, platform);
  }
}
