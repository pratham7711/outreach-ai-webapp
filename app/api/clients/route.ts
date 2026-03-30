import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const clients = await db.client.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ clients });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { name, logoUrl, contactInfo } = await req.json();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const client = await db.client.create({ data: { orgId, name, logoUrl: logoUrl ?? null, contactInfo: contactInfo ?? undefined } });

  await logAudit({
    orgId,
    ...createAuditActor(session),
    action: "client.create",
    entityType: "client",
    entityId: client.id,
    entityLabel: client.name,
    ipAddress: getRequestIp(req),
    after: {
      id: client.id,
      name: client.name,
    },
  });

  return NextResponse.json(client, { status: 201 });
}
