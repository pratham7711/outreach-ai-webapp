import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { decrypt, isEncrypted } from "@/lib/crypto/encrypt";
import { isProviderConfigured } from "@/lib/oauth/providers";
import { revokeTikTokToken } from "@/lib/platforms/tiktokDisplay";

async function findSessionCreators(handle: string) {
  const bare = handle.replace(/^@/, "");
  return db.creator.findMany({
    where: {
      deletedAt: null,
      OR: [{ handle: bare }, { handle: `@${bare}` }],
    },
    select: { id: true, orgId: true },
  });
}

export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const creators = await findSessionCreators(session.handle);
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
            },
            orderBy: { createdAt: "asc" },
          });

    return NextResponse.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        handle: a.handle,
        tokenExpiry: a.tokenExpiry,
        connected: true,
        encrypted: isEncrypted(a.accessToken),
      })),
      providers: {
        instagram: isProviderConfigured("instagram"),
        tiktok: isProviderConfigured("tiktok"),
        youtube: isProviderConfigured("youtube"),
      },
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
      select: { id: true, creatorId: true, platform: true, accessToken: true },
    });
    if (!account)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const creator = (await findSessionCreators(session.handle)).find(
      (c) => c.id === account.creatorId,
    );
    if (!creator)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (account.platform === "TIKTOK") {
      try {
        await revokeTikTokToken(decrypt(account.accessToken, creator.orgId));
      } catch {
        // A revoke that fails must not block the creator from disconnecting.
      }
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
