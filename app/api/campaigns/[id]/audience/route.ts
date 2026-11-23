import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { audienceHistory, audienceReady, latestFollowerAudiences, type StoredAudience } from "@/lib/creators/audienceSnapshots";
import { campaignAudience } from "@/lib/creators/campaignAudience";
import { createLogger } from "@/lib/observability/logger";

/**
 * GET /api/campaigns/[id]/audience — who the campaign's Instagram posts
 * reached, estimated: each post's reach shared out by its creator's audience
 * when it went out (lib/creators/campaignAudience). Instagram gives no
 * demographics per post, so this is an estimate and says how much it covers.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const log = createLogger({ context: { call: "campaign.audience" } });
const DAY_MS = 86_400_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = auth;
    const { id } = await params;

    /* Same scope as GET /api/campaigns/[id]. */
    const campaign = await db.campaign.findFirst({
      where: { id, orgId, deletedAt: null, ...campaignScopeWhereFor(auth) },
      select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const noStore = { "Cache-Control": "no-store" };
    if (!(await audienceReady())) return NextResponse.json({ ready: false }, { headers: noStore });

    const posts = await db.post.findMany({
      where: { campaignId: campaign.id, platform: "INSTAGRAM", status: { not: "REJECTED" }, ...NOT_REMOVED },
      select: { creatorId: true, postedAt: true, reachCount: true, viewsCount: true },
    });
    if (posts.length === 0) return NextResponse.json({ ready: true, posts: 0 }, { headers: noStore });

    const creatorIds = [...new Set(posts.map((p) => p.creatorId))];
    const times = posts.map((p) => p.postedAt.getTime());
    const [history, latest] = await Promise.all([
      audienceHistory(orgId, creatorIds, new Date(Math.min(...times) - 35 * DAY_MS), new Date(Math.max(...times) + 31 * DAY_MS)),
      latestFollowerAudiences(orgId, creatorIds),
    ]);

    const byCreator = new Map<string, StoredAudience[]>();
    for (const { creatorId, ...reading } of history) {
      const list = byCreator.get(creatorId) ?? [];
      list.push(reading);
      byCreator.set(creatorId, list);
    }
    /* A creator first read after the campaign still has their followers today. */
    for (const [creatorId, reading] of latest) {
      const list = byCreator.get(creatorId) ?? [];
      if (!list.some((r) => r.audience === "followers" && r.day === reading.day)) list.push(reading);
      byCreator.set(creatorId, list);
    }

    const estimate = campaignAudience(
      posts.map((p) => ({ creatorId: p.creatorId, postedAt: p.postedAt, weight: p.reachCount > 0 ? p.reachCount : p.viewsCount })),
      byCreator,
    );
    const weightIsReach = posts.some((p) => p.reachCount > 0);

    const uncovered = estimate.uncoveredCreatorIds.length
      ? await db.creator.findMany({
          where: { id: { in: estimate.uncoveredCreatorIds }, orgId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

    return NextResponse.json(
      { ready: true, posts: posts.length, weightIsReach, ...estimate, uncoveredCreators: uncovered },
      { headers: noStore },
    );
  } catch (error) {
    log.error("Failed to estimate a campaign's audience", { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to estimate audience" }, { status: 500 });
  }
}
