import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { permissionDenial } from "@/lib/authz";
import { campaignScopeWhere, scopeSubjectFromSession } from "@/lib/campaignScope";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { isUnattributedCreator } from "@/lib/posts/unattributedName";
import { syncPost } from "@/lib/sync/syncPost";
import { openTikTokPostFetcherForOne } from "@/lib/platforms/tiktokEgress";

const assignSchema = z.object({ creatorId: z.string().min(1) });

/**
 * PUT /api/campaigns/[id]/posts/[postId]/creator -- name the creator of a post
 * that was added without one.
 *
 * A post nobody could attribute is filed under the org's Unattributed row
 * (lib/posts/unattributedCreator), and with no account name there is nothing
 * to read its views under: on 2026-10-09 all ten such posts on LKM's campaigns
 * sat at zero views, reading "author-unknown". The agency usually knows whose
 * post it is, so this lets them say, and reads the post straight away under
 * that creator's handle.
 *
 * Only from the Unattributed row. Moving a post between two real creators
 * rewrites both creators' totals and history, which is a different decision
 * from filling in a blank, and is refused here rather than allowed by accident.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const denied = permissionDenial(session.user, "campaigns:edit_own");
    if (denied) return denied;
    const orgId = (session.user as any).orgId;
    const { id: campaignId, postId } = await params;

    const parsed = assignSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a creator." }, { status: 400 });

    const scope = scopeSubjectFromSession(session.user);
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null, ...(scope ? campaignScopeWhere(scope) : {}) },
      select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const post = await db.post.findFirst({
      where: { id: postId, campaignId },
      include: { creator: { select: { id: true, name: true, handle: true } } },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    if (!isUnattributedCreator(post.creator)) {
      return NextResponse.json({ error: "This post already has a creator." }, { status: 409 });
    }

    const creator = await db.creator.findFirst({
      where: { id: parsed.data.creatorId, orgId, deletedAt: null },
      select: { id: true, name: true, handle: true, platform: true },
    });
    if (!creator || isUnattributedCreator(creator)) {
      return NextResponse.json({ error: "Creator not found" }, { status: 404 });
    }

    const updated = await db.post.update({ where: { id: post.id }, data: { creatorId: creator.id } });

    await logAudit({
      orgId,
      userId: session.user.id ?? undefined,
      actorEmail: session.user.email ?? undefined,
      action: "post.creator_assigned",
      entityType: "post",
      entityId: post.id,
      entityLabel: creator.handle,
      ipAddress: getRequestIp(request),
      metadata: { campaignId, platform: post.platform, postUrl: post.postUrl, creatorPlatform: creator.platform },
      before: { creatorId: post.creatorId },
      after: { creatorId: creator.id },
    });

    /* Read now, under the new creator's handle, so the card the person is
       looking at changes when the dialog closes. The assignment is saved
       whatever the read says; a failed read is reported, not rolled back. */
    const tiktokSandbox = updated.platform === "TIKTOK" ? openTikTokPostFetcherForOne() : undefined;
    let read: { metricsFound: boolean; reason?: string } = { metricsFound: false };
    let current: Record<string, unknown> = updated;
    try {
      const outcome = await syncPost(updated, orgId, { tiktokSandbox });
      if (outcome.status === "unfetchable") read = { metricsFound: false, reason: outcome.reason };
      else {
        current = outcome.post;
        read = outcome.status === "measured" ? { metricsFound: true } : { metricsFound: false, reason: outcome.reason };
      }
    } catch (error) {
      console.error("Assigned a creator but the read after it failed:", error);
    } finally {
      await tiktokSandbox?.close().catch(() => {});
    }

    return NextResponse.json({
      ...current,
      creator: { id: creator.id, name: creator.name, handle: creator.handle },
      ...read,
    });
  } catch (error) {
    console.error("Failed to assign a creator to a post:", error);
    return NextResponse.json({ error: "Failed to assign the creator" }, { status: 500 });
  }
}
