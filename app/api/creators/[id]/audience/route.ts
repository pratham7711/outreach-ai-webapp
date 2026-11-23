import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { connectionForRead } from "@/lib/creators/connectionGate";
import { latestCreatorAudience } from "@/lib/creators/audienceSnapshots";
import { isInstagramLoginRow } from "@/lib/platforms/accountOrigin";
import { createLogger } from "@/lib/observability/logger";

/**
 * GET /api/creators/[id]/audience — the newest saved reading of a creator's
 * Instagram audience in this org: their followers, and the people who engaged
 * with them this week and this month (lib/creators/audienceSweep reads them
 * weekly). `connection` says why there may be none: not connected, connected
 * through Instagram Login (which cannot be asked), or not read yet.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const log = createLogger({ context: { call: "creator.audience" } });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = auth;
    const { id } = await params;

    const creator = await db.creator.findFirst({ where: { id, orgId, deletedAt: null }, select: { id: true } });
    if (!creator) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [read, stored] = await Promise.all([
      connectionForRead(orgId, creator.id, "INSTAGRAM", { order: "newest" }),
      latestCreatorAudience(orgId, creator.id, "INSTAGRAM"),
    ]);
    const connection = !read.ok ? "none" : isInstagramLoginRow(read.connection.origin) ? "instagram_login" : "facebook_login";

    return NextResponse.json(
      { ready: stored.ready, connection, audiences: stored.audiences },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    log.error("Failed to read a creator's saved audience", { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to read audience" }, { status: 500 });
  }
}
