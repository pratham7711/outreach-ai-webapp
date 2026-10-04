import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { isEncrypted } from "@/lib/crypto/encrypt";
import { OAUTH_PLATFORMS, isProviderConfigured } from "@/lib/oauth/providers";
import { resolveCapabilities } from "@/lib/capabilities";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { findCreatorForPortalUser } from "@/lib/portal/creatorLookup";
import { accountStatesFor } from "@/lib/platforms/accountState";
import { disconnectSocialAccount } from "@/lib/portal/disconnect";

export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/* findLinkedCreatorsForHandle, not findCreatorsForHandle: a handle match alone
   is not ownership. Registration checks uniqueness only against CreatorUser, so
   signing up as an existing roster creator's handle used to hand the new
   account this data. See lib/portal/creatorLink.ts. */
    const creators = await findLinkedCreatorsForHandle(session);
    const creatorIds = creators.map((c) => c.id);
    /* The start route refuses (reason=creator) when this lookup finds no roster
       row, so the screens ask it first and offer "join a campaign" instead of
       a Connect button that can only bounce. Same function, same answer. */
    const canConnect = Boolean(await findCreatorForPortalUser(session));

    const accounts =
      creatorIds.length === 0
        ? []
        : await db.creatorSocialAccount.findMany({
            where: { creatorId: { in: creatorIds } },
            select: {
              id: true,
              platform: true,
              handle: true,
              tokenExpiry: true,
              accessToken: true,
              avatarUrl: true,
              profileUrl: true,
              isVerified: true,
              followersCount: true,
              mediaCount: true,
              statsSyncedAt: true,
              origin: true,
            },
            orderBy: { createdAt: "asc" },
          });

    /* Empty when CreatorAccountState is not there yet, which reads as "no
       mark, no display name" — every account exactly as it was listed before. */
    const states = await accountStatesFor(accounts.map((a) => a.id));

    return NextResponse.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        /* The real platform handle, resolved at connect time. Before
           lib/platforms/accountSync.ts existed only TikTok resolved one, so
           Instagram and YouTube rows carried the creator's *portal* username
           and the settings screen showed the wrong identity. */
        handle: a.handle,
        tokenExpiry: a.tokenExpiry,
        connected: true,
        encrypted: isEncrypted(a.accessToken),
        avatarUrl: a.avatarUrl,
        profileUrl: a.profileUrl,
        isVerified: a.isVerified,
        followersCount: a.followersCount,
        mediaCount: a.mediaCount,
        statsSyncedAt: a.statsSyncedAt,
        /* Which flow minted the row. The settings screen needs it because both
           Instagram paths store platform = INSTAGRAM, so without it an account
           connected without a Facebook Page would be listed under both
           Instagram cards. */
        origin: a.origin,
        /* Google refused this connection's refresh for good (invalid_grant).
           The row is kept; the creator reconnects to clear it. */
        reconnectNeeded: Boolean(states.get(a.id)?.reconnectNeededAt),
        /* TikTok's display_name, where one was recorded; `handle` stays the
           username. */
        displayName: states.get(a.id)?.displayName ?? null,
      })),
      /* Built from OAUTH_PLATFORMS rather than listed by hand: the three names
         used to be hardcoded here, so adding a provider to the code left it
         permanently absent from this payload and invisible in the portal. */
      providers: Object.fromEntries(
        OAUTH_PLATFORMS.map((platform) => [platform, isProviderConfigured(platform)]),
      ),
      capabilities: resolveCapabilities().platforms,
      canConnect,
    });
  } catch (error) {
    console.error("Failed to list portal connections:", error);
    return NextResponse.json(
      { error: "Failed to list connections" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id)
      return NextResponse.json({ error: "id required" }, { status: 400 });

    const account = await db.creatorSocialAccount.findFirst({
      where: { id },
      select: {
        id: true,
        creatorId: true,
        platform: true,
        accessToken: true,
        origin: true,
      },
    });
    if (!account)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    /* Linked rows only. Unproven, this endpoint let anyone who registered a
       roster creator's handle REVOKE that creator's OAuth grants at TikTok,
       Meta and Google — the one action here that reaches outside our database
       and cannot be undone from our side. */
    const creator = (await findLinkedCreatorsForHandle(session)).find(
      (c) => c.id === account.creatorId,
    );
    if (!creator)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    /* The revoke rules (Meta's shared grant, Instagram Login and Threads having
       no revoke endpoint) live in lib/portal/disconnect.ts, because TikTok's
       authorization.removed webhook disconnects through the same path. */
    await disconnectSocialAccount(account, creator.orgId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete portal connection:", error);
    return NextResponse.json(
      { error: "Failed to delete connection" },
      { status: 500 },
    );
  }
}
