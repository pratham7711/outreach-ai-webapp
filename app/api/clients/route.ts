import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  // The searchable client picker needs to be able to ask for a subset. Both
  // params are optional and absent means what it always meant -- every client,
  // newest first -- so the callers that read the whole list are unaffected.
  const search = req.nextUrl.searchParams.get("search")?.trim();
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const take = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : undefined;

  const clients = await db.client.findMany({
    where: { orgId, ...(search ? { name: { contains: search, mode: "insensitive" } } : {}) },
    orderBy: search ? { name: "asc" } : { createdAt: "desc" },
    ...(take ? { take } : {}),
  });
  return NextResponse.json({ clients });
}

export async function POST(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { name, logoUrl, contactInfo } = await req.json();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const client = await db.client.create({ data: { orgId, name, logoUrl: logoUrl ?? null, contactInfo: contactInfo ?? undefined } });

  await logAudit({
    orgId,
    ...getAuditActor(result),
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
