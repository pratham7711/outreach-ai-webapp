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

const count = z.number().finite().min(0).max(5e9).nullable().optional();

const fixSchema = z
  .object({ handle: z.string().trim().min(1).max(300).optional(), followersCount: count, averageViews: count })
  .refine((b) => b.handle !== undefined || b.followersCount !== undefined || b.averageViews !== undefined);

/**
 * PATCH /api/creators/[id]/profile-links/[linkId] — correct an account's handle,
 * typed bare, with an @, or as the profile link; or its follower and average
 * view counts.
 *
 * A new handle queues the account for the next hourly read (refreshedAt
 * cleared) and drops its "not found". Its counts are kept unless new ones are
 * sent: they are what the creator wrote on the sign-up form about their real
 * account, and the read replaces them. Counts set here are for an account the
 * read cannot see (a personal Instagram, say); on the primary account they are
 * mirrored onto the creator, as the read does.
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
    select: { id: true, platform: true, handle: true, url: true, isPrimary: true, followersCount: true, averageViews: true, creator: { select: { name: true } } },
  });
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!LINKABLE.has(link.platform)) {
    return NextResponse.json({ error: `${platformLabel(link.platform)} handles can't be changed here.` }, { status: 400 });
  }

  const counts: { followersCount?: number | null; averageViews?: number | null } = {};
  if (parsed.data.followersCount !== undefined) counts.followersCount = parsed.data.followersCount;
  if (parsed.data.averageViews !== undefined) counts.averageViews = parsed.data.averageViews;

  let handle = link.handle;
  let url = link.url;
  if (parsed.data.handle !== undefined) {
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
    if (read.link.handle === link.handle && !Object.keys(counts).length) {
      return NextResponse.json({ error: `@${read.link.handle} is the handle it already has.` }, { status: 400 });
    }
    handle = read.link.handle;
    url = read.link.url;
  }
  const handleChanged = handle !== link.handle;

  if (handleChanged) {
    const taken = await db.creatorProfileLink.findFirst({
      where: { orgId, platform: link.platform, handle, NOT: { id: link.id } },
      select: { creator: { select: { name: true } } },
    });
    if (taken) {
      return NextResponse.json({ error: `@${handle} is already on ${taken.creator.name}'s profile.` }, { status: 409 });
    }
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.creatorProfileLink.update({
        where: { id: link.id, orgId },
        data: { ...(handleChanged ? { handle, url, refreshedAt: null, refreshError: null } : {}), ...counts },
      });
      // Creator.handle and its counts mirror the primary account; every list and the tracker read them.
      if (link.isPrimary) {
        await tx.creator.update({
          where: { id, orgId },
          data: {
            ...(handleChanged ? { handle: `@${handle}` } : {}),
            ...(counts.followersCount !== undefined ? { followersCount: counts.followersCount ?? 0 } : {}),
            ...(counts.averageViews !== undefined ? { averageViews: counts.averageViews ?? 0 } : {}),
          },
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
    before: {
      platform: link.platform,
      handle: link.handle,
      ...(counts.followersCount !== undefined ? { followersCount: link.followersCount } : {}),
      ...(counts.averageViews !== undefined ? { averageViews: link.averageViews } : {}),
    },
    after: { platform: link.platform, handle, ...counts },
  });

  return NextResponse.json({
    link: { id: link.id, platform: link.platform, handle, url, ...counts, ...(handleChanged ? { problem: null, refreshedAt: null } : {}) },
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
