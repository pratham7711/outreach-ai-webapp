import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { campaignScopeWhere, scopeSubjectFromSession } from "@/lib/campaignScope";
import { httpUrl } from "@/lib/validation/url";
import { z } from "zod";
import {
  detectPlatform,
  fetchPostMetrics,
  hasMetricCounts,
  MEDIA_TYPES as DETECTABLE_MEDIA_TYPES,
} from "@/lib/platforms/fetchPostMetrics";
import { countsFrom } from "@/lib/sync/syncPost";
import { getInstagramAccountForCreator } from "@/lib/platforms/instagramToken";
import { getTikTokTokenForCreator } from "@/lib/platforms/tiktokToken";
import { checkPostCompliance } from "@/lib/compliance/postCompliance";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import type { PostStatus, Platform } from "@/lib/generated/prisma/client";
import { PLATFORM_VALUES } from "@/lib/platforms/constants";

const PLATFORMS = PLATFORM_VALUES;
// One list, shared with the detector -- two copies would be free to disagree
// about what a media type is, and the detector's answers have to validate here.
const MEDIA_TYPES = DETECTABLE_MEDIA_TYPES;
const POST_STATUSES = ["PENDING_REVIEW", "APPROVED", "REJECTED"] as const;

/* creatorId is optional because the URL usually names the creator: a TikTok
   link cannot exist without /@handle/ in it. It stays required when the URL does
   not say -- a youtu.be link names no channel -- and the caller is told which of
   those two cases it hit rather than getting a bare validation error. */
const createPostSchema = z.object({
  postUrl: httpUrl(),
  creatorId: z.string().min(1).optional(),
  mediaType: z.enum(MEDIA_TYPES).optional(),
  activationId: z.string().nullable().optional(),
});

// GET /api/campaigns/[id]/posts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    /* Org first, then row scope. This route authenticates through auth() rather
       than authenticateRequest, so it composes campaignScopeWhere off the
       session the same way the campaigns list page does; the rule itself lives
       in one file either way. An ASSIGNED seat that 404s on the campaign detail
       must 404 on its post list too — otherwise every post, creator handle and
       view count of a campaign it cannot open is one URL away. */
    const scope = scopeSubjectFromSession(session.user);
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null, ...(scope ? campaignScopeWhere(scope) : {}) },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") as (typeof POST_STATUSES)[number] | null;
    const platform = searchParams.get("platform") as (typeof PLATFORMS)[number] | null;
    const mediaType = searchParams.get("mediaType") as (typeof MEDIA_TYPES)[number] | null;

    const where: Record<string, unknown> = { campaignId };
    if (status) where.status = status;
    if (platform) where.platform = platform;
    if (mediaType) where.mediaType = mediaType;

    const posts = await db.post.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
        snapshots: {
          orderBy: { recordedAt: "desc" },
          take: 2,
          select: { id: true, viewsCount: true, recordedAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Merge unresolved fraud-flag presence (ViewFraudFlag has no Post relation).
    const openFlags = await db.viewFraudFlag.findMany({
      where: { campaignId, isResolved: false },
      select: { postId: true },
    });
    const flaggedPostIds = new Set(openFlags.map((f) => f.postId));
    const postsWithFlags = posts.map((p) => ({
      ...p,
      hasOpenFraudFlag: flaggedPostIds.has(p.id),
      complianceFlags: checkPostCompliance(p, campaign),
    }));

    return NextResponse.json({ posts: postsWithFlags });
  } catch (error) {
    console.error("Failed to fetch posts:", error);
    return NextResponse.json({ error: "Failed to fetch posts" }, { status: 500 });
  }
}

// POST /api/campaigns/[id]/posts — Submit a post URL
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    // Adding a post is a write against the campaign, so it is scoped at least
    // as tightly as reading one.
    const scope = scopeSubjectFromSession(session.user);
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null, ...(scope ? campaignScopeWhere(scope) : {}) },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const body = await request.json();
    const parsed = createPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { postUrl, mediaType, activationId } = parsed.data;

    /* The same link twice is a second Post row, and every metric it carries is
       then counted twice in the campaign's totals. Adding posts one at a time
       made that a rare slip; pasting batches makes overlapping two pastes the
       normal way to do it, so the second copy is refused by name rather than
       created quietly. Scoped to the campaign -- the same post legitimately
       appears in two campaigns. */
    const already = await db.post.findFirst({
      where: { campaignId, postUrl },
      select: { id: true },
    });
    if (already) {
      return NextResponse.json(
        { error: "duplicate_post", message: "Already in this campaign." },
        { status: 409 }
      );
    }

    const detected = detectPlatform(postUrl);

    /* An explicitly chosen creator always wins; the handle in the URL is only
       consulted when none was chosen. Matching is case-insensitive and tolerates
       a leading @, because handles are stored both ways, and it stays scoped to
       the org -- a pasted URL is untrusted input and must never reach across a
       tenant. Nothing is created here: inventing a roster entry from a pasted
       link is not a thing an import should do behind the operator's back. */
    let creatorId = parsed.data.creatorId;
    if (!creatorId && detected?.handle) {
      const bare = detected.handle.replace(/^@/, "");
      const match = await db.creator.findFirst({
        where: {
          orgId,
          deletedAt: null,
          OR: [
            { handle: { equals: bare, mode: "insensitive" } },
            { handle: { equals: `@${bare}`, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      if (!match) {
        return NextResponse.json(
          { error: `No creator matches @${bare}. Pick one, or add @${bare} first.`, detectedHandle: bare },
          { status: 404 }
        );
      }
      creatorId = match.id;
    }
    if (!creatorId) {
      return NextResponse.json(
        { error: "This link does not name its creator, so please choose one." },
        { status: 400 }
      );
    }

    const creator = await db.creator.findFirst({ where: { id: creatorId, orgId, deletedAt: null } });
    if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

    if (activationId) {
      const activation = await db.activation.findFirst({ where: { id: activationId, campaignId } });
      if (!activation) return NextResponse.json({ error: "Activation not found" }, { status: 404 });
    }

    // Fetch metrics from platform
    const detectedPlatform = detected?.platform;
    const instagram =
      detectedPlatform === "INSTAGRAM"
        ? await getInstagramAccountForCreator(creatorId, orgId)
        : undefined;
    const tiktokToken =
      detectedPlatform === "TIKTOK"
        ? await getTikTokTokenForCreator(creatorId, orgId)
        : undefined;
    const metrics = await fetchPostMetrics(postUrl, {
      instagramToken: instagram?.token,
      instagramHandle: instagram?.handle,
      tiktokToken,
    });

    const initialStatus: PostStatus = campaign.postApprovalMode === "AUTO_APPROVED" ? "APPROVED" : "PENDING_REVIEW";

    const post = await db.post.create({
      data: {
        campaignId,
        creatorId,
        platform: (metrics?.platform ?? "TIKTOK") as Platform,
        platformPostId: metrics?.platformPostId ?? postUrl,
        postUrl,
        thumbnailUrl: metrics?.thumbnailUrl ?? null,
        caption: metrics?.caption ?? null,
        // "Auto-detect" in the form meant "store nothing at all". The URL says
        // which kind it is, so an explicit choice still wins and silence now
        // actually detects.
        mediaType: mediaType ?? detected?.mediaType ?? null,
        // Only the counters the platform actually reported, and a record of which
        // those were. Writing `?? 0` for the rest and then stamping lastSyncedAt
        // is what made an Instagram post claim "0 shares" -- Instagram reports
        // none. sharesCount was not even written here before. See countsFrom.
        ...(metrics ? countsFrom(metrics).counts : {}),
        engagementRate: metrics?.engagementRate ?? 0,
        postedAt: metrics?.postedAt ?? new Date(),
        ...(metrics ? { platformMetrics: countsFrom(metrics).measuredPatch } : {}),
        // Without this a post created with real counts reads as never synced,
        // which makes lib/metricDisplay treat its measured zeroes as unknown and
        // makes the card say "Never" under numbers we just fetched. Only set
        // when counts actually arrived -- see lib/sync/syncPost for why.
        lastSyncedAt: metrics && hasMetricCounts(metrics) ? new Date() : null,
        status: initialStatus,
        activationId: activationId ?? null,
      },
      include: {
        creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
      },
    });

    await logAudit({
      orgId,
      userId: session.user.id ?? undefined,
      actorEmail: session.user.email ?? undefined,
      action: "post.create",
      entityType: "post",
      entityId: post.id,
      entityLabel: post.creator.handle,
      ipAddress: getRequestIp(request),
      // campaignId is what the campaign activity feed filters on; entityId is
      // the post, so without this the event is only reachable org-wide.
      metadata: { campaignId, creatorId, platform: post.platform, postUrl },
    });

    return NextResponse.json(post, { status: 201 });
  } catch (error) {
    console.error("Failed to create post:", error);
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
}
