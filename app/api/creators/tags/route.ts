import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { MAX_BULK_CREATORS, resolveRosterSelection, rosterSelectionSchema } from "@/lib/creators/rosterSelection";

const bodySchema = z.intersection(
  z.object({ tag: z.string().trim().min(1).max(120), action: z.enum(["add", "remove"]) }),
  rosterSelectionSchema,
);

// GET /api/creators/tags?<roster filters>  or  ?ids=a,b,c -- the tags the
// selected creators carry, named the way the export route takes a selection.
// The bulk tag dialog offers "Remove a tag" only when there is one to remove.
export async function GET(request: NextRequest) {
  const gate = await requirePermission(request, "creators:read");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;

  const sp = new URLSearchParams(request.nextUrl.searchParams);
  const ids = sp.get("ids");
  sp.delete("ids");
  const picked = ids?.split(",").filter(Boolean) ?? null;
  if (picked && picked.length > MAX_BULK_CREATORS) {
    return NextResponse.json({ error: `At most ${MAX_BULK_CREATORS} creators at a time` }, { status: 413 });
  }
  const target = await resolveRosterSelection(orgId, picked ? { creatorIds: picked } : { query: sp.toString() });
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  const tags = target.ids.length
    ? await db.creatorTagDef.findMany({
        where: { orgId, creators: { some: { creatorId: { in: target.ids } } } },
        select: { name: true },
        orderBy: { name: "asc" },
      })
    : [];
  return NextResponse.json({ tags: tags.map((t) => t.name) });
}

// POST /api/creators/tags -- add or remove one tag across many creators.
export async function POST(request: NextRequest) {
  // Tags organise creators, as lists do, so they ride the key lists use.
  const gate = await requirePermission(request, "creators:create");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  const { tag, action } = parsed.data;

  const target = await resolveRosterSelection(orgId, parsed.data);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  // Matched case-insensitively, so "priority" lands on the existing "Priority".
  let def = await db.creatorTagDef.findFirst({ where: { orgId, name: { equals: tag, mode: "insensitive" } }, select: { id: true, name: true } });
  if (!def && action === "remove") return NextResponse.json({ changed: 0, tag });
  if (!def) {
    await db.creatorTagDef.createMany({ data: [{ orgId, name: tag }], skipDuplicates: true });
    def = await db.creatorTagDef.findFirst({ where: { orgId, name: tag }, select: { id: true, name: true } });
    if (!def) return NextResponse.json({ error: "Could not create that tag" }, { status: 500 });
  }

  const { count: changed } =
    action === "add"
      ? await db.creatorTagLink.createMany({
          data: target.ids.map((creatorId) => ({ creatorId, tagId: def!.id })),
          skipDuplicates: true,
        })
      : await db.creatorTagLink.deleteMany({ where: { tagId: def.id, creatorId: { in: target.ids } } });

  if (changed) {
    await logAudit({
      orgId,
      ...getAuditActor(gate.auth),
      action: action === "add" ? "creators.tag_add" : "creators.tag_remove",
      entityType: "creator",
      entityLabel: def.name,
      ipAddress: getRequestIp(request),
      metadata: { tag: def.name, requested: target.ids.length, changed },
    });
  }

  return NextResponse.json({ tag: def.name, changed, requested: target.ids.length });
}
