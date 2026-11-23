import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, getAuditActor, type AuthResult } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { hasPermission } from "@/lib/rbac";
import { issueJoinLink, joinLinkPath, liveJoinLink, turnOffJoinLink, type JoinLinkRow } from "@/lib/creators/joinLink";

export const dynamic = "force-dynamic";

/**
 * The org's join link, /join/<code> (lib/creators/joinLink.ts).
 *
 *   GET     the live link, or { active: false }
 *   POST    make one; any live link stops working ("Make a new link")
 *   DELETE  turn it off
 *
 * People only, with permission to add creators: a link that puts anyone who
 * proves an account on the roster is a person's decision, not an API key's.
 */

function linkBase(req: NextRequest): string {
  return (process.env.APP_URL || process.env.NEXTAUTH_URL || req.nextUrl.origin).replace(/\/+$/, "");
}

async function gate(req: NextRequest): Promise<{ ok: true; auth: AuthResult } | { ok: false; response: NextResponse }> {
  const auth = await authenticateRequest(req);
  if (!auth) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (auth.actorType !== "user" || !auth.role || !hasPermission(auth.role, "creators:create"))
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true, auth };
}

const body = (req: NextRequest, link: JoinLinkRow) => ({
  active: true,
  url: `${linkBase(req)}${joinLinkPath(link.code)}`,
  createdAt: link.createdAt,
  joinedCount: link.joinedCount,
  lastJoinedAt: link.lastJoinedAt,
});

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if (!g.ok) return g.response;
  const link = await liveJoinLink(g.auth.orgId);
  return NextResponse.json(link ? body(req, link) : { active: false }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const g = await gate(req);
  if (!g.ok) return g.response;
  const link = await issueJoinLink(g.auth.orgId, g.auth.userId ?? null);
  if (!link) return NextResponse.json({ error: "Join links are not available yet" }, { status: 503 });
  await logAudit({
    orgId: g.auth.orgId,
    ...getAuditActor(g.auth),
    action: "org.join_link_created",
    entityType: "organization",
    entityId: g.auth.orgId,
    ipAddress: getRequestIp(req),
  });
  return NextResponse.json(body(req, link), { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const g = await gate(req);
  if (!g.ok) return g.response;
  const turnedOff = await turnOffJoinLink(g.auth.orgId);
  if (turnedOff > 0)
    await logAudit({
      orgId: g.auth.orgId,
      ...getAuditActor(g.auth),
      action: "org.join_link_turned_off",
      entityType: "organization",
      entityId: g.auth.orgId,
      ipAddress: getRequestIp(req),
    });
  return NextResponse.json({ active: false });
}
