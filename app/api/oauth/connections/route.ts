import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { OAuthUnavailable, disconnect, listConnections } from "@/lib/oauth/mcpOAuthStore";

export const dynamic = "force-dynamic";

/**
 * The apps the signed-in person has connected through OAuth, and Disconnect.
 * Session only, and only ever the caller's own connections: a token is a
 * person's grant, so it is theirs to see and end.
 */
async function signedIn() {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string | null; orgId?: string } | undefined;
  return user?.id && user.orgId ? { id: user.id, email: user.email ?? undefined, orgId: user.orgId } : null;
}

export async function GET() {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const connections = await listConnections(user.id);
  return NextResponse.json({ ready: connections !== null, connections: connections ?? [] });
}

export async function DELETE(req: NextRequest) {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  try {
    const revoked = await disconnect(user.id, clientId);
    await logAudit({
      orgId: user.orgId,
      userId: user.id,
      actorEmail: user.email,
      actorType: "user",
      action: "mcp_app.disconnect",
      entityType: "mcp_app",
      entityId: clientId.slice(0, 190),
      ipAddress: getRequestIp(req),
    }).catch(() => {});
    return NextResponse.json({ revoked });
  } catch (e) {
    if (e instanceof OAuthUnavailable) return NextResponse.json({ revoked: 0 });
    throw e;
  }
}
