import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { permissionDenial } from "@/lib/authz";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

// DELETE /api/keys/[id] — Revoke (delete) an API key
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    /* The same gate as minting and listing keys (GET/POST /api/keys). Any
       session could revoke any of the org's keys -- a VIEWER could cut the
       org's integrations off. Session-only, so an API key cannot revoke keys
       either. */
    const denied = permissionDenial(session.user, "settings:manage");
    if (denied) return denied;
    const orgId = (session.user as any).orgId;

    const { id } = await params;

    // Verify key belongs to this org
    const existing = await db.apiKey.findUnique({ where: { id } });
    if (!existing || existing.orgId !== orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.apiKey.delete({ where: { id } });

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "api_key.delete",
      entityType: "api_key",
      entityId: existing.id,
      entityLabel: existing.name,
      ipAddress: getRequestIp(request),
      before: {
        id: existing.id,
        name: existing.name,
      },
      after: {
        id: existing.id,
        deleted: true,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/keys/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
