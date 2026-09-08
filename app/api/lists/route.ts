import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const lists = await db.creatorList.findMany({ where: { orgId }, include: { _count: { select: { items: true } } }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ lists });
}

export async function POST(req: NextRequest) {
  /* A creator list is a way of organising creators, so it rides the same key
     they do. MEMBER and above keep it; VIEWER, which is read-only everywhere
     else, loses a write it should never have had. */
  const gate = await requirePermission(req, "creators:create");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { name, description } = await req.json();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const list = await db.creatorList.create({ data: { orgId, name, description: description ?? null } });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "list.create",
    entityType: "creator_list",
    entityId: list.id,
    entityLabel: list.name,
    ipAddress: getRequestIp(req),
    after: {
      id: list.id,
      name: list.name,
      description: list.description,
    },
  });

  return NextResponse.json(list, { status: 201 });
}
