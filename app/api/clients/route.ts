import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { httpUrl } from "@/lib/validation/url";

/**
 * The route had no validation at all: `if (!name)` and straight into create().
 * So " " was a client whose name renders as nothing, a 50KB paste was a client,
 * and logoUrl went to an <img src> unchecked — the same sink lib/validation/url
 * exists for, and the same rule /api/org and PATCH /api/clients/[id] already
 * apply to their own logoUrl.
 *
 * contactInfo is a String? column holding JSON, which is what the client modal
 * sends; an object is accepted too and stored the same way, so this route and
 * the PATCH beside it agree about the shape.
 */
const createClientSchema = z.object({
  name: z.string().trim().min(1, "Name required").max(120),
  logoUrl: httpUrl().nullish(),
  contactInfo: z
    .union([z.string().max(2000), z.record(z.string(), z.string())])
    .nullish(),
});

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
  /* A VIEWER is a read-only seat everywhere the product says so, and could
     nonetheless create clients. Held to campaigns:create -- a client exists to
     hold campaigns, and rbac.ts has no clients:* key -- so MEMBER and above
     keep the ability and VIEWER loses it. The GET above stays open to every
     member: reading the roster of clients is not the problem. */
  const gate = await requirePermission(req, "campaigns:create");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const parsed = createClientSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { name, logoUrl, contactInfo } = parsed.data;
  const client = await db.client.create({
    data: {
      orgId,
      name,
      logoUrl: logoUrl ?? null,
      contactInfo:
        contactInfo == null
          ? null
          : typeof contactInfo === "string"
            ? contactInfo
            : JSON.stringify(contactInfo),
    },
  });

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
