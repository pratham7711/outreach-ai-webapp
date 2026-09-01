import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { MEDIA_KITS_FEATURE } from "@/lib/featureKeys";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!hasOrgFeature(entitlements, MEDIA_KITS_FEATURE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const kit = await db.mediaKit.findFirst({ where: { id, orgId } });
  if (!kit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.mediaKit.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

/**
 * GET /api/media-kits/[id] — one kit, with its creators resolved.
 *
 * The list endpoint returns kits but nothing ever fetched one, so there was no
 * way to see what a kit contained — which is consistent, because until now
 * nothing could put anything in one.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string;

  const { id } = await params;
  const kit = await db.mediaKit.findFirst({ where: { id, orgId } });
  if (!kit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ids = Array.isArray(kit.creatorIds) ? (kit.creatorIds as string[]) : [];
  const creators = ids.length
    ? await db.creator.findMany({
        // orgId again: a kit's stored ids are data, and data can be wrong or
        // stale. Resolving them without re-scoping would let a kit name a
        // creator from another tenant and have it rendered.
        where: { id: { in: ids }, orgId },
        select: { id: true, name: true, handle: true, platform: true, avatarUrl: true },
      })
    : [];

  return NextResponse.json({ kit: { ...kit, creators } });
}

/**
 * PATCH /api/media-kits/[id] — the half that was missing.
 *
 * MediaKit has carried creatorIds, isPublic and a shareToken since it was
 * added, and no endpoint could set any of them. Kits were created with an empty
 * creator list and stayed that way: a feature that lists, creates and deletes
 * perfectly, and cannot contain anything.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!hasOrgFeature(entitlements, MEDIA_KITS_FEATURE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const kit = await db.mediaKit.findFirst({ where: { id, orgId } });
  if (!kit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    data.title = title;
  }

  if (body.creatorIds !== undefined) {
    if (!Array.isArray(body.creatorIds)) {
      return NextResponse.json({ error: "creatorIds must be an array" }, { status: 400 });
    }
    const requested = [...new Set(body.creatorIds.filter((x: unknown) => typeof x === "string"))] as string[];
    /* Every id is checked against this org before it is stored, rather than
       trusted and re-checked at render time. A kit is shared by token to people
       outside the org, so a foreign id stored here would be a cross-tenant leak
       waiting for someone to open the public link. */
    const owned = requested.length
      ? await db.creator.findMany({
          where: { id: { in: requested }, orgId },
          select: { id: true },
        })
      : [];
    if (owned.length !== requested.length) {
      return NextResponse.json(
        { error: "One or more creators do not belong to this organisation" },
        { status: 400 }
      );
    }
    data.creatorIds = requested;
  }

  if (body.isPublic !== undefined) {
    if (typeof body.isPublic !== "boolean") {
      return NextResponse.json({ error: "isPublic must be a boolean" }, { status: 400 });
    }
    data.isPublic = body.isPublic;
  }

  if (body.config !== undefined && typeof body.config === "object" && body.config !== null) {
    data.config = body.config;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await db.mediaKit.update({ where: { id }, data });
  return NextResponse.json({ kit: updated });
}
