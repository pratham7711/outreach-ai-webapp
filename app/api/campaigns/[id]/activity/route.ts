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

/**
 * POST /api/campaigns/[id]/activity — leave a comment.
 *
 * The half that was missing. CampaignComment, the read above, and the merged
 * feed have all existed since the model landed; nothing could ever put a row in
 * the table, so the read was a permanent no-op and the feature looked built
 * while being unreachable. The reference has this on the campaign Overview tab,
 * which is the first screen anyone opens.
 *
 * Scoping repeats the GET's check rather than trusting the id in the path: a
 * campaign id from another org must 404 on the way in, not merely fail to
 * appear on the way out.
 */
const MAX_COMMENT = 4000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const userId = (session.user as any).id;
  if (!orgId || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: campaignId } = await params;

  try {
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const body = await request.json().catch(() => null);
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    const parentIdRaw = typeof body?.parentId === "string" ? body.parentId : null;
    if (!content) {
      return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 });
    }
    if (content.length > MAX_COMMENT) {
      return NextResponse.json(
        { error: `Comment is too long (${content.length}/${MAX_COMMENT})` },
        { status: 400 }
      );
    }

    /* Replies are flattened to one level: a reply to a reply re-parents to the
       root. The thread lives in a right-hand rail, and indentation that can
       nest indefinitely stops being readable about three levels in. Doing it
       here rather than in the UI means the depth holds no matter who posts. */
    let parentId: string | null = null;
    if (parentIdRaw) {
      const parent = await db.campaignComment.findFirst({
        where: { id: parentIdRaw, campaignId, deletedAt: null },
        select: { id: true, parentId: true },
      });
      if (!parent) {
        return NextResponse.json({ error: "Parent comment not found" }, { status: 404 });
      }
      parentId = parent.parentId ?? parent.id;
    }

    const comment = await db.campaignComment.create({
      data: { campaignId, userId, content, parentId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    console.error("Failed to post campaign comment:", error);
    return NextResponse.json({ error: "Failed to post comment" }, { status: 500 });
  }
}

/**
 * DELETE /api/campaigns/[id]/activity?commentId=... — soft-delete a comment.
 *
 * Soft, because deletedAt already exists on the model and a feed someone can
 * silently rewrite is worse than one with a gap in it. Authors delete their
 * own; OWNER and ADMIN can delete anyone's, which is the moderation floor a
 * shared workspace needs.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const userId = (session.user as any).id;
  const role = (session.user as any).role as string;
  if (!orgId || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: campaignId } = await params;
  const commentId = request.nextUrl.searchParams.get("commentId");
  if (!commentId) return NextResponse.json({ error: "commentId is required" }, { status: 400 });

  try {
    /* The campaign is joined into the lookup so a comment id alone cannot reach
       across tenants — the id is a cuid, but guessing is not the threat model
       worth relying on. */
    const comment = await db.campaignComment.findFirst({
      where: { id: commentId, campaignId, deletedAt: null, campaign: { orgId } },
      select: { id: true, userId: true },
    });
    if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

    const isAuthor = comment.userId === userId;
    const canModerate = role === "OWNER" || role === "ADMIN";
    if (!isAuthor && !canModerate) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.campaignComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete campaign comment:", error);
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
  }
}
