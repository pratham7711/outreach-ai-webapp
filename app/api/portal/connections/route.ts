import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { decrypt, isEncrypted } from "@/lib/crypto/encrypt";
import { OAUTH_PLATFORMS, isProviderConfigured } from "@/lib/oauth/providers";
import { resolveCapabilities } from "@/lib/capabilities";
import { revokeTikTokToken } from "@/lib/platforms/tiktokDisplay";
import { revokeInstagramToken } from "@/lib/platforms/instagramAccount";
import { revokeYouTubeToken } from "@/lib/platforms/youtube";
import { revokeFacebookToken } from "@/lib/platforms/facebookPage";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { isInstagramLoginRow } from "@/lib/platforms/accountOrigin";

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
      })),
      /* Built from OAUTH_PLATFORMS rather than listed by hand: the three names
         used to be hardcoded here, so adding a provider to the code left it
         permanently absent from this payload and invisible in the portal. */
      providers: Object.fromEntries(
        OAUTH_PLATFORMS.map((platform) => [platform, isProviderConfigured(platform)]),
      ),
      capabilities: resolveCapabilities().platforms,
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

    /* Disconnect has to mean disconnected at the platform too, not just a
       forgotten row — otherwise our grant on the creator's account outlives
       the connection they revoked. This ran for TikTok alone; Instagram and
       YouTube both have a revoke endpoint and neither was being called.

       A failure here still lets the creator disconnect: their intent is
       unambiguous, and a row we keep because the platform's revoke endpoint
       was down is the worse outcome. */
    /* Instagram and Facebook are ONE grant at Meta: both rows hold a user token
       from the same app, and their revoke is DELETE /me/permissions, which
       drops every permission the app holds for that user. Revoking for the
       Facebook row therefore invalidated the Instagram token on the spot
       (measured on prod 2026-09-07: Graph code 190 "session has been
       invalidated" on the very next Instagram read). So the Graph revoke runs
       only when this is the creator's LAST Meta row; until then the row and its
       token are simply deleted here, and the grant is withdrawn at Meta when
       the last one goes. */
    const META_PLATFORMS = ["INSTAGRAM", "FACEBOOK"] as const;
    /* An Instagram-Login row is NOT part of the Facebook grant. It was minted
       by a different app id on a different host and has no me/permissions
       endpoint, so it must neither be revoked through Facebook nor counted as a
       sibling that keeps the Facebook grant alive — counting it would suppress
       the real revoke and leave the Facebook grant standing after the creator
       disconnected their last Page. */
    const isIgLogin = isInstagramLoginRow(account.origin);
    const isMeta =
      !isIgLogin && (META_PLATFORMS as readonly string[]).includes(account.platform);
    const siblingMetaRows = isMeta
      ? await db.creatorSocialAccount.count({
          where: {
            creatorId: account.creatorId,
            platform: { in: [...META_PLATFORMS] },
            id: { not: account.id },
            OR: [{ origin: null }, { origin: { not: "oauth_instagram_login" } }],
          },
        })
      : 0;

    try {
      const token = decrypt(account.accessToken, creator.orgId);
      if (account.platform === "TIKTOK") await revokeTikTokToken(token);
      /* Instagram Login publishes no revoke endpoint, so there is nothing to
         call — see revokeInstagramLoginToken. Deliberately not routed to
         revokeInstagramToken: that DELETEs me/permissions on graph.facebook.com
         and would 400 against a token that host does not govern, which this
         catch swallows. The row is still deleted below and the creator
         withdraws the app from Instagram's own settings, exactly as with
         Threads. */
      else if (isIgLogin) {
        // no-op by design
      } else if (account.platform === "INSTAGRAM" && siblingMetaRows === 0)
        await revokeInstagramToken(token);
      else if (account.platform === "YOUTUBE") await revokeYouTubeToken(token);
      else if (account.platform === "FACEBOOK" && siblingMetaRows === 0)
        await revokeFacebookToken(token);
      /* THREADS is deliberately absent: the Threads API publishes no revoke
         endpoint, so there is nothing to call. Deleting the row is the whole of
         what we can do, and the creator withdraws the grant from their own
         Threads settings. Do not add a DELETE /me/permissions here — that is
         the Facebook host and it does not govern a Threads token. */
    } catch {
      // A revoke that fails must not block the creator from disconnecting.
    }

    await db.creatorSocialAccount.delete({ where: { id: account.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete portal connection:", error);
    return NextResponse.json(
      { error: "Failed to delete connection" },
      { status: 500 },
    );
  }
}
