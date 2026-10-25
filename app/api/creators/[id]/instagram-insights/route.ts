import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { connectionForRead } from "@/lib/creators/connectionGate";
import { readInsightsForConnection } from "@/lib/portal/instagramInsightsRead";
import { createLogger } from "@/lib/observability/logger";

/**
 * GET /api/creators/[id]/instagram-insights — the same account and story
 * insights the creator sees on My stats, for the agency running their
 * campaigns. Only through a connection the creator made and granted to THIS
 * org (the grant gate); read live, never cached or stored.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const log = createLogger({ context: { call: "creator.instagram.insights" } });

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = auth;
    const { id } = await params;

    const creator = await db.creator.findFirst({ where: { id, orgId, deletedAt: null }, select: { id: true } });
    if (!creator) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const read = await connectionForRead(orgId, creator.id, "INSTAGRAM", { order: "newest" });
    if (!read.ok)
      return NextResponse.json(
        { error: "not_connected", reason: "This creator has not connected an Instagram professional account to your campaigns." },
        { status: 409, headers: noStore },
      );

    const result = await readInsightsForConnection(read.connection, orgId);
    return result.ok
      ? NextResponse.json(result.body, { headers: noStore })
      : NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status, headers: noStore });
  } catch (error) {
    log.error("Failed to read a creator's Instagram insights", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to read insights" }, { status: 500 });
  }
}
