import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { encrypt } from "@/lib/crypto/encrypt";
import {
  buildAuthorizeUrl,
  isOAuthPlatform,
  isProviderConfigured,
  toPlatformEnum,
} from "@/lib/oauth/providers";

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

  if (isProviderConfigured(platform)) {
    const state = randomBytes(16).toString("hex");
    const authorizeUrl = buildAuthorizeUrl(platform, state);
    if (!authorizeUrl)
      return NextResponse.json(
        { error: "Provider not configured" },
        { status: 503 },
      );
    const res = NextResponse.redirect(authorizeUrl);
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return res;
  }

  if (process.env.NODE_ENV === "production")
    return NextResponse.json(
      { error: "Provider not configured" },
      { status: 503 },
    );

  try {
    const creator = await findSessionCreator(session.handle);
    if (!creator)
      return NextResponse.redirect(
        new URL(`/portal/settings?error=${platform}`, req.url),
      );

    const platformEnum = toPlatformEnum(platform);
    const accessToken = encrypt(
      `dev-token-${platform}-${Date.now()}`,
      creator.orgId,
    );

    await db.creatorSocialAccount.upsert({
      where: {
        creatorId_platform: { creatorId: creator.id, platform: platformEnum },
      },
      create: {
        creatorId: creator.id,
        platform: platformEnum,
        handle: session.handle,
        accessToken,
      },
      update: {
        handle: session.handle,
        accessToken,
      },
    });

    return NextResponse.redirect(
      new URL(`/portal/settings?connected=${platform}`, req.url),
    );
  } catch (error) {
    console.error(`Dev connect failed for ${platform}:`, error);
    return NextResponse.redirect(
      new URL(`/portal/settings?error=${platform}`, req.url),
    );
  }
}
