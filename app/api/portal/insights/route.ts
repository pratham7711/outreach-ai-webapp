import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { buildPlatformInsights, type PlatformInsights } from "@/lib/portal/creatorInsights";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/insights — the creator's own numbers, from every platform
 * they have connected.
 *
 * This was TikTok-only: it selected `platform: "TIKTOK"`, took the first row,
 * and returned one flat object. A creator who connected Instagram or YouTube
 * got `{ connected: false }` even though their token was sitting in the
 * database. The per-platform work now lives in lib/portal/creatorInsights.ts
 * and this route only fans out over the accounts.
 */
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/* findLinkedCreatorsForHandle, not findCreatorsForHandle: a handle match alone
   is not ownership. Registration checks uniqueness only against CreatorUser, so
   signing up as an existing roster creator's handle used to hand the new
   account this data. See lib/portal/creatorLink.ts. */
    const creators = await findLinkedCreatorsForHandle(session);
    if (creators.length === 0)
      return NextResponse.json({ connected: false, platforms: [] });

    const orgByCreator = new Map(creators.map((c) => [c.id, c.orgId]));

    const accounts = await db.creatorSocialAccount.findMany({
      where: { creatorId: { in: creators.map((c) => c.id) } },
      select: {
        id: true,
        creatorId: true,
        platform: true,
        handle: true,
        accessToken: true,
        refreshToken: true,
        tokenExpiry: true,
        platformUserId: true,
        avatarUrl: true,
        bio: true,
        profileUrl: true,
        isVerified: true,
        followersCount: true,
        followingCount: true,
        mediaCount: true,
        totalLikes: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (accounts.length === 0)
      return NextResponse.json({ connected: false, platforms: [] });

    /* One creator can have several platforms and each block makes its own
       outbound calls, so they run together rather than one after another —
       three sequential round trips is a visibly slower dashboard. */
    const settled = await Promise.all(
      accounts.map(async (account) => {
        const orgId = orgByCreator.get(account.creatorId);
        if (!orgId) return null;
        return await buildPlatformInsights(account, orgId);
      }),
    );

    const platforms = settled.filter(
      (block): block is PlatformInsights => block !== null,
    );

    return NextResponse.json({
      connected: platforms.length > 0,
      platforms,
    });
  } catch (error) {
    console.error("Failed to build creator insights:", error);
    return NextResponse.json({ error: "Failed to load insights" }, { status: 500 });
  }
}
