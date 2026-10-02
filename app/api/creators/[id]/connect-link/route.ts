import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor, type AuthResult } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { hasPermission } from "@/lib/rbac";
import { connectTablesReady } from "@/lib/creators/connectTables";
import {
  connectLinkPath,
  connectTokenStatus,
  issueConnectToken,
  revokeConnectTokens,
} from "@/lib/creators/connectToken";

export const dynamic = "force-dynamic";

/**
 * The connect link for one roster creator: /connect/<token>.
 *
 *   GET    whether a live link exists, when it was made and last used — never
 *          the link itself, which is stored only as a hash
 *   POST   make one (any live link is revoked first, so this is also
 *          "rotate"). `{ "action": "request" }` is the roster's "Request
 *          connection" button: the same link, recorded as a request. Nothing
 *          is sent to the creator — the agency shares the link from its own
 *          channels.
 *   DELETE revoke the live link
 *
 * People only: an owner, admin, manager or member of the org, by session. An
 * API key is an org credential, not a person, and minting a link that lets
 * someone attach accounts to a roster row is a person's decision.
 */

const PostSchema = z
  .object({ action: z.enum(["create", "rotate", "request"]).optional() })
  .optional();

function linkBase(req: NextRequest): string {
  return (process.env.APP_URL || process.env.NEXTAUTH_URL || req.nextUrl.origin).replace(/\/+$/, "");
}

type Gate =
  | { ok: true; auth: AuthResult; creator: { id: string; name: string } }
  | { ok: false; response: NextResponse };

async function gate(req: NextRequest, creatorId: string): Promise<Gate> {
  const auth = await authenticateRequest(req);
  if (!auth) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (auth.actorType !== "user" || !auth.role || !hasPermission(auth.role, "creators:create"))
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  const creator = await db.creator.findFirst({
    where: { id: creatorId, orgId: auth.orgId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!creator) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  if (!(await connectTablesReady()))
    return {
      ok: false,
      response: NextResponse.json({ error: "Connect links are not available yet" }, { status: 503 }),
    };
  return { ok: true, auth, creator };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(req, id);
  if (!g.ok) return g.response;
  const live = await connectTokenStatus({ orgId: g.auth.orgId, creatorId: g.creator.id });
  return NextResponse.json({
    active: Boolean(live),
    createdAt: live?.createdAt ?? null,
    usedAt: live?.usedAt ?? null,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(req, id);
  if (!g.ok) return g.response;

  let action: "create" | "rotate" | "request" = "create";
  const text = await req.text();
  if (text.trim()) {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = PostSchema.safeParse(parsedBody);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    action = parsed.data?.action ?? "create";
  }

  const issued = await issueConnectToken({
    orgId: g.auth.orgId,
    creatorId: g.creator.id,
    createdById: g.auth.userId,
  });
  if (!issued)
    return NextResponse.json({ error: "Connect links are not available yet" }, { status: 503 });

  await logAudit({
    orgId: g.auth.orgId,
    ...getAuditActor(g.auth),
    action: action === "request" ? "creator.connection_requested" : "creator.connect_link_created",
    entityType: "creator",
    entityId: g.creator.id,
    entityLabel: g.creator.name,
    ipAddress: getRequestIp(req),
  });

  const path = connectLinkPath(issued.token);
  return NextResponse.json(
    {
      action,
      /* Shown once. Only its hash is stored, so a lost link is replaced by
         making a new one, which also revokes this one. */
      url: `${linkBase(req)}${path}`,
      path,
      createdAt: issued.createdAt,
    },
    { status: 201 },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(req, id);
  if (!g.ok) return g.response;
  const revoked = await revokeConnectTokens({ orgId: g.auth.orgId, creatorId: g.creator.id });
  if (revoked > 0) {
    await logAudit({
      orgId: g.auth.orgId,
      ...getAuditActor(g.auth),
      action: "creator.connect_link_revoked",
      entityType: "creator",
      entityId: g.creator.id,
      entityLabel: g.creator.name,
      ipAddress: getRequestIp(req),
    });
  }
  return NextResponse.json({ revoked });
}
