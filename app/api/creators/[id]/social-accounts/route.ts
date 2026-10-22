import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { encrypt } from "@/lib/crypto/encrypt";
import { REVOKE_REASONS, revokeGrantsForConnections } from "@/lib/creators/grants";
import { requirePermission } from "@/lib/authz";
import { ACCOUNT_ORIGINS } from "@/lib/platforms/accountOrigin";
import { BACKFILL_SKIPS, classifyForBackfill } from "@/lib/creators/grantBackfill";
import { disconnectSocialAccount } from "@/lib/portal/disconnect";

// ─── GET — list social accounts (secrets excluded) ───────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await authenticateRequest(req);
  if (!result)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  const creator = await db.creator.findFirst({
    where: { id, orgId, deletedAt: null },
  });
  if (!creator)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const accounts = await db.creatorSocialAccount.findMany({
    where: { creatorId: id },
    select: {
      id: true,
      platform: true,
      handle: true,
      followersCount: true,
      avgViews: true,
      tokenExpiry: true,
      // When the account's own statistics were last read (plan A6).
      statsSyncedAt: true,
      createdAt: true,
      updatedAt: true,
      // Read only to tell a typed-in row from a connection; never returned.
      origin: true,
      platformUserId: true,
      accessToken: true,
    },
    orderBy: { createdAt: "asc" },
  });

  /* A row an agency typed in is "Added <date>", not "Connected": nobody
     consented to anything and nothing is read through it. Rows from before
     origin was recorded are told apart the way the grant backfill tells them
     apart (lib/creators/grantBackfill), so the label and the grant decision
     cannot disagree. The token is opened there, compared and dropped. */
  return NextResponse.json(
    accounts.map(({ accessToken, origin, platformUserId, ...a }) => {
      const kind = classifyForBackfill({ ...a, accessToken, origin, platformUserId, creatorId: id, orgId });
      return { ...a, addedByHand: kind === BACKFILL_SKIPS.MANUAL || kind === BACKFILL_SKIPS.NO_IDENTITY };
    }),
  );
}

// ─── POST — add a social account ─────────────────────────────────────────────

const PostSchema = z.object({
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]),
  handle: z.string().min(1).max(100),
  accessToken: z.string().min(1).default("manual-entry"),
  refreshToken: z.string().optional().nullable(),
  // No followersCount / avgViews: an account's figures come from the platform,
  // never from the person adding it. z.object strips them if they are sent.
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  /* A roster write, gated like the rest of the roster (creators:create). */
  const gate = await requirePermission(req, "creators:create");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id } = await params;

  const creator = await db.creator.findFirst({
    where: { id, orgId, deletedAt: null },
  });
  if (!creator)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json();
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );

    const account = await db.creatorSocialAccount.create({
      data: {
        creatorId: id,
        platform: parsed.data.platform,
        handle: parsed.data.handle,
        // The provenance the column was added for: without it a typed-in row
        // was only recognisable by decrypting its token.
        ...(parsed.data.accessToken === "manual-entry" && { origin: ACCOUNT_ORIGINS.MANUAL }),
        accessToken: encrypt(parsed.data.accessToken, orgId),
        refreshToken: parsed.data.refreshToken
          ? encrypt(parsed.data.refreshToken, orgId)
          : parsed.data.refreshToken,
      },
    });

    // Strip secrets before returning
    const { accessToken, refreshToken, ...safe } = account as any;
    return NextResponse.json(safe, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002")
      return NextResponse.json(
        { error: "This platform is already linked" },
        { status: 409 },
      );
    console.error("Failed to add social account:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ─── DELETE — remove a social account ────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requirePermission(req, "creators:create");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id } = await params;

  const creator = await db.creator.findFirst({
    where: { id, orgId, deletedAt: null },
  });
  if (!creator)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId)
    return NextResponse.json(
      { error: "accountId required" },
      { status: 400 },
    );

  const account = await db.creatorSocialAccount.findFirst({
    where: { id: accountId, creatorId: id },
  });
  if (!account)
    return NextResponse.json(
      { error: "Account not found" },
      { status: 404 },
    );

  /* A row the agency typed in holds no credential and fed no reading: ending
     its grant record and deleting it is all there is. */
  if (account.origin === ACCOUNT_ORIGINS.MANUAL) {
    await revokeGrantsForConnections([accountId], REVOKE_REASONS.AGENCY_REMOVED);
    await db.creatorSocialAccount.delete({ where: { id: accountId } });
    return NextResponse.json({ success: true });
  }
  /* A real connection ends the way the creator's own Disconnect ends it:
     revoked at the platform, grant closed (recorded as the agency's doing),
     connected readings deleted, row gone. Deleting only the row left our
     grant standing in the creator's TikTok or Google settings with nothing
     here able to withdraw it, and kept the figures read through it. */
  await disconnectSocialAccount(account, orgId, {
    revokeReason: REVOKE_REASONS.AGENCY_REMOVED,
  });
  return NextResponse.json({ success: true });
}
