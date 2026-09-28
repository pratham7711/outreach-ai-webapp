import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { DEFAULT_SHARE_FIELDS, listSharePath, parseShareFields, type ListShareFields } from "@/lib/lists/listShare";

const fieldsSchema = z
  .object({ stats: z.boolean(), tags: z.boolean(), audienceCountry: z.boolean(), price: z.boolean() })
  .partial()
  .strict();
const bodySchema = z.object({ fields: fieldsSchema.optional() }).strict();

type Share = { token: string; fields: unknown; revokedAt: Date | null; createdAt: Date };

function serialize(share: Share | null) {
  if (!share || share.revokedAt) return { share: null };
  return {
    share: {
      token: share.token,
      path: listSharePath(share.token),
      fields: parseShareFields(share.fields),
      createdAt: share.createdAt.toISOString(),
    },
  };
}

async function gateList(request: NextRequest, id: string, permission: "creators:read" | "creators:create") {
  const gate = await requirePermission(request, permission);
  if (!gate.ok) return { ok: false as const, response: gate.response };
  if (!(await rosterTablesReady())) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Sharing isn't set up yet. An admin needs to run the roster migration first." }, { status: 503 }),
    };
  }
  const list = await db.creatorList.findFirst({ where: { id, orgId: gate.auth.orgId }, select: { id: true, name: true } });
  if (!list) return { ok: false as const, response: NextResponse.json({ error: "List not found" }, { status: 404 }) };
  return { ok: true as const, auth: gate.auth, list };
}

async function readBody(request: NextRequest) {
  const raw = await request.text();
  let json: unknown = {};
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = bodySchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// GET /api/lists/[id]/share -- the list's live link, or { share: null }.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateList(request, id, "creators:read");
  if (!g.ok) return g.response;
  return NextResponse.json(serialize(await db.creatorListShare.findUnique({ where: { listId: id } })));
}

// POST -- turn sharing on. A revoked link stays dead: turning sharing back on mints a new one.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateList(request, id, "creators:create");
  if (!g.ok) return g.response;
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const existing = await db.creatorListShare.findUnique({ where: { listId: id } });
  if (existing && !existing.revokedAt) return NextResponse.json(serialize(existing));

  const fields: ListShareFields = { ...DEFAULT_SHARE_FIELDS, ...body.fields };
  const token = randomBytes(24).toString("base64url");
  const data = { token, fields, revokedAt: null, createdById: g.auth.userId ?? null };
  const share = existing
    ? await db.creatorListShare.update({ where: { listId: id }, data })
    : await db.creatorListShare.create({ data: { listId: id, orgId: g.auth.orgId, ...data } });

  await logAudit({
    orgId: g.auth.orgId,
    ...getAuditActor(g.auth),
    action: "list.share",
    entityType: "creator_list",
    entityId: id,
    entityLabel: g.list.name,
    ipAddress: getRequestIp(request),
    after: { fields },
  });
  return NextResponse.json(serialize(share), { status: 201 });
}

// PATCH -- change what the link shows. The link itself stays the same.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateList(request, id, "creators:create");
  if (!g.ok) return g.response;
  const body = await readBody(request);
  if (!body?.fields) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const existing = await db.creatorListShare.findUnique({ where: { listId: id } });
  if (!existing || existing.revokedAt) return NextResponse.json({ error: "This list isn't shared" }, { status: 404 });
  const before = parseShareFields(existing.fields);
  const fields: ListShareFields = { ...before, ...body.fields };
  const share = await db.creatorListShare.update({ where: { listId: id }, data: { fields } });

  await logAudit({
    orgId: g.auth.orgId,
    ...getAuditActor(g.auth),
    action: "list.share_update",
    entityType: "creator_list",
    entityId: id,
    entityLabel: g.list.name,
    ipAddress: getRequestIp(request),
    before: { fields: before },
    after: { fields },
  });
  return NextResponse.json(serialize(share));
}

// DELETE -- revoke. The row is kept so the audit trail and createdBy survive.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateList(request, id, "creators:create");
  if (!g.ok) return g.response;
  const existing = await db.creatorListShare.findUnique({ where: { listId: id } });
  if (existing && !existing.revokedAt) {
    await db.creatorListShare.update({ where: { listId: id }, data: { revokedAt: new Date() } });
    await logAudit({
      orgId: g.auth.orgId,
      ...getAuditActor(g.auth),
      action: "list.share_revoke",
      entityType: "creator_list",
      entityId: id,
      entityLabel: g.list.name,
      ipAddress: getRequestIp(request),
    });
  }
  return NextResponse.json({ share: null });
}
