import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { buildActivityFeed, FEED_ACTIONS } from "@/lib/campaignActivity";

/**
 * GET /api/campaigns/[id]/activity
 *
 * The campaign activity feed. Reads AuditLog rather than a second log of its
 * own: AuditLog already carries the actor, the timestamp and the before/after
 * that the event phrasing needs, and a parallel table would drift from it.
 *
 * Campaign scoping is the awkward part. AuditLog is org-scoped and keyed by
 * entityType/entityId, so only campaign.update is directly addressable -- its
 * entityId IS the campaign. Everything else carries the campaign inside its
 * payload, in `after.campaignId` for activations and `metadata.campaignId` for
 * posts, so this matches on all three.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: campaignId } = await params;

  try {
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const [logs, comments] = await Promise.all([
      db.auditLog.findMany({
        where: {
          orgId,
          action: { in: [...FEED_ACTIONS] },
          OR: [
            { entityType: "campaign", entityId: campaignId },
            { after: { path: ["campaignId"], equals: campaignId } },
            { metadata: { path: ["campaignId"], equals: campaignId } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.campaignComment.findMany({
        where: { campaignId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    const events = await buildActivityFeed(logs, comments);
    return NextResponse.json({ events });
  } catch (error) {
    console.error("Failed to load campaign activity:", error);
    return NextResponse.json({ error: "Failed to load activity" }, { status: 500 });
  }
}
