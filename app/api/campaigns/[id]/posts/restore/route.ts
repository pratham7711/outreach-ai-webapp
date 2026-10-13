import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { permissionDenial } from "@/lib/authz";
import { campaignScopeWhere, scopeSubjectFromSession } from "@/lib/campaignScope";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { removablePostIds } from "@/lib/posts/bulkActions";
import { ONLY_REMOVED } from "@/lib/posts/removed";
import { duplicateLiveCopies } from "@/lib/posts/restoreChecks";

/**
 * POST /api/campaigns/[id]/posts/restore — put removed posts back.
 * Body: { postIds: string[] } (1..MAX_BULK_ACTION_POSTS).
 *
 * The other half of the soft remove in DELETE .../posts: the toast's Undo
 * right after a remove, and the Restore action in the Posts tab's Removed
 * view. Clearing removedAt is the whole restore -- the row never went
 * anywhere, so its readings, flags and tracker come back with it and every
 * total that reads NOT_REMOVED counts it again on the next read.
 *
 * Gated exactly like the remove: campaigns:edit_own, the campaign looked up
 * by the session's org and the seat's campaign scope, and the ids only ever
 * matched inside that campaign -- a body naming another tenant's post finds
 * no row.
 *
 * All or nothing, like the remove: an id that is not a post of this campaign
 * refuses the call. Idempotent: a post that is not removed is left alone and
 * not counted, so an Undo pressed twice restores once.
 *
 * Refused (409 duplicate_post) when the campaign already holds a live copy of
 * the same post -- added again while this one sat under Removed. Restoring it
 * would count the post's views twice in this campaign, which is the one thing
 * the add route refuses too.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // The same gate as removing a post: a VIEWER can do neither.
    const denied = permissionDenial(session.user, "campaigns:edit_own");
    if (denied) return denied;
    const orgId = (session.user as { orgId: string }).orgId;
    const { id: campaignId } = await params;

    const scope = scopeSubjectFromSession(session.user);
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null, ...(scope ? campaignScopeWhere(scope) : {}) },
      select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const body = await request.json().catch(() => null);
    const ids = removablePostIds(body?.postIds);
    if (!ids) {
      return NextResponse.json({ error: "Pick between 1 and 50 posts to restore." }, { status: 400 });
    }

    const posts = await db.post.findMany({
      where: { id: { in: ids }, campaignId },
      select: {
        id: true,
        postUrl: true,
        platform: true,
        platformPostId: true,
        creatorId: true,
        removedAt: true,
        removedById: true,
        creator: { select: { handle: true } },
      },
    });
    if (posts.length !== ids.length) {
      return NextResponse.json(
        { error: "Some of those posts are no longer in this campaign. Reload and try again." },
        { status: 404 },
      );
    }

    const removed = posts.filter((p) => p.removedAt !== null);
    const clashes = await duplicateLiveCopies(campaignId, removed);
    if (clashes.length > 0) {
      return NextResponse.json(
        {
          error: "duplicate_post",
          message:
            clashes.length === 1
              ? "1 of these posts was added to this campaign again, so restoring it would count it twice."
              : `${clashes.length} of these posts were added to this campaign again, so restoring them would count them twice.`,
          postIds: clashes,
        },
        { status: 409 },
      );
    }

    const removedIds = removed.map((p) => p.id);
    /* ONLY_REMOVED in the write, so a post restored by another tab in the
       meantime is not counted twice. */
    const restored =
      removedIds.length > 0
        ? await db.post.updateMany({
            where: { id: { in: removedIds }, campaignId, ...ONLY_REMOVED },
            data: { removedAt: null, removedById: null },
          })
        : { count: 0 };

    for (const post of removed) {
      await logAudit({
        orgId,
        userId: session.user.id ?? undefined,
        actorEmail: session.user.email ?? undefined,
        action: "post.restore",
        entityType: "post",
        entityId: post.id,
        entityLabel: post.creator?.handle ?? post.postUrl,
        ipAddress: getRequestIp(request),
        metadata: { campaignId, batch: removedIds.length },
        before: { removedAt: post.removedAt?.toISOString() ?? null, removedById: post.removedById },
        after: { removedAt: null },
      });
    }

    return NextResponse.json({ restored: restored.count, postIds: removedIds });
  } catch (error) {
    console.error("Failed to restore posts:", error);
    return NextResponse.json({ error: "Failed to restore posts" }, { status: 500 });
  }
}
