import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { parseProfileLink, type ImportPlatform } from "@/lib/creators/importParse";
import { platformLabel } from "@/lib/format";

const LINKABLE = new Set<string>(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]);

/* Handle only. This route used to take followersCount / averageViews too, for
   an account the read cannot see; figures now come from the platforms and
   never from a person (Pratham, 2026-10-13), so z.object strips them and a
   body carrying nothing but counts is refused like an empty one. */
const fixSchema = z.object({ handle: z.string().trim().min(1).max(300) });

/**
 * PATCH /api/creators/[id]/profile-links/[linkId] — correct an account's handle,
 * typed bare, with an @, or as the profile link.
 *
 * A new handle queues the account for the next hourly read (refreshedAt
 * cleared) and drops its "not found". Its stored counts are kept until that
 * read replaces them; nothing here writes a count.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const gate = await requirePermission(request, "creators:create");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;
  const { id, linkId } = await params;

  if (!(await rosterTablesReady())) {
    return NextResponse.json({ error: "Profile links aren't set up yet." }, { status: 503 });
  }
  const parsed = fixSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Type the handle or paste the profile link." }, { status: 400 });

  const link = await db.creatorProfileLink.findFirst({
    where: { id: linkId, orgId, creatorId: id, creator: { deletedAt: null } },
    select: { id: true, platform: true, handle: true, url: true, isPrimary: true, creator: { select: { name: true } } },
  });
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!LINKABLE.has(link.platform)) {
    return NextResponse.json({ error: `${platformLabel(link.platform)} handles can't be changed here.` }, { status: 400 });
  }

  const read = parseProfileLink(parsed.data.handle, link.platform as ImportPlatform);
  if (!read.ok) {
    return NextResponse.json({ error: "empty" in read ? "Type the handle or paste the profile link." : read.reason }, { status: 400 });
  }
  if (read.link.platform !== link.platform) {
    return NextResponse.json(
      { error: `That link is for ${platformLabel(read.link.platform)}; this account is on ${platformLabel(link.platform)}.` },
      { status: 400 },
    );
  }
  if (read.link.handle === link.handle) {
    return NextResponse.json({ error: `@${read.link.handle} is the handle it already has.` }, { status: 400 });
  }
  const handle = read.link.handle;
  const url = read.link.url;

  const taken = await db.creatorProfileLink.findFirst({
    where: { orgId, platform: link.platform, handle, NOT: { id: link.id } },
    select: { creator: { select: { name: true } } },
  });
  if (taken) {
    return NextResponse.json({ error: `@${handle} is already on ${taken.creator.name}'s profile.` }, { status: 409 });
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.creatorProfileLink.update({
        where: { id: link.id, orgId },
        data: { handle, url, refreshedAt: null, refreshError: null },
      });
      // Creator.handle mirrors the primary account; every list and the tracker read it.
      if (link.isPrimary) {
        await tx.creator.update({
          where: { id, orgId },
          data: { handle: `@${handle}` },
        });
      }
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: `@${handle} is already on another creator's profile.` }, { status: 409 });
    }
    throw err;
  }

  await logAudit({
    orgId,
    ...getAuditActor(gate.auth),
    action: "creator.profile_link.update",
    entityType: "creator",
    entityId: id,
    entityLabel: link.creator.name,
    ipAddress: getRequestIp(request),
    before: { platform: link.platform, handle: link.handle },
    after: { platform: link.platform, handle },
  });

  return NextResponse.json({
    link: { id: link.id, platform: link.platform, handle, url, problem: null, refreshedAt: null },
  });
}

/** Which account takes over as primary when the primary is removed: TikTok first, as on import. */
const PRIMARY_ORDER = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"];

/**
 * DELETE /api/creators/[id]/profile-links/[linkId] — take an account off the
 * profile: a sign-up answer that was never a handle ("any", "none"), or an
 * account that isn't this creator's.
 *
 * The creator's only account stays; its handle is corrected instead. When the
 * primary account goes, the next one becomes primary and the creator mirrors
 * it, as the import would have.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const gate = await requirePermission(request, "creators:create");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;
  const { id, linkId } = await params;

  if (!(await rosterTablesReady())) {
    return NextResponse.json({ error: "Profile links aren't set up yet." }, { status: 503 });
  }

  const link = await db.creatorProfileLink.findFirst({
    where: { id: linkId, orgId, creatorId: id, creator: { deletedAt: null } },
    select: { id: true, platform: true, handle: true, isPrimary: true, creator: { select: { name: true } } },
  });
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const others = await db.creatorProfileLink.findMany({
    where: { orgId, creatorId: id, NOT: { id: link.id } },
    orderBy: { createdAt: "asc" },
    select: { id: true, platform: true, handle: true, followersCount: true, averageViews: true },
  });
  if (!others.length) {
    return NextResponse.json({ error: "This is the creator's only account. Correct its handle instead." }, { status: 409 });
  }
  const next = link.isPrimary
    ? [...others].sort((a, b) => PRIMARY_ORDER.indexOf(a.platform) - PRIMARY_ORDER.indexOf(b.platform))[0]
    : null;

  await db.$transaction(async (tx) => {
    await tx.creatorProfileLink.delete({ where: { id: link.id, orgId } });
    if (next) {
      await tx.creatorProfileLink.update({ where: { id: next.id, orgId }, data: { isPrimary: true } });
      await tx.creator.update({
        where: { id, orgId },
        data: { platform: next.platform, handle: `@${next.handle}`, followersCount: next.followersCount ?? 0, averageViews: next.averageViews ?? 0 },
      });
    }
  });

  await logAudit({
    orgId,
    ...getAuditActor(gate.auth),
    action: "creator.profile_link.delete",
    entityType: "creator",
    entityId: id,
    entityLabel: link.creator.name,
    ipAddress: getRequestIp(request),
    before: { platform: link.platform, handle: link.handle, isPrimary: link.isPrimary },
    after: next ? { primary: { platform: next.platform, handle: next.handle } } : null,
  });

  return NextResponse.json({ removed: link.id, primary: next ? { id: next.id, platform: next.platform, handle: next.handle } : null });
}
