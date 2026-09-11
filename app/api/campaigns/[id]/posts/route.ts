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
import { ensureCreatorForHandle, findCreatorByHandle, findExistingPosts } from "@/lib/posts/addPostChecks";
import { hasPermission } from "@/lib/rbac";

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
  /* The operator's answer to "this post is already in another campaign".
     Defaulting to false is the point: a client that has not been told about the
     duplicate cannot accidentally consent to it, so every override is a
     deliberate one and is recorded as such in the audit trail. */
  allowDuplicate: z.boolean().optional(),
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

    const { postUrl, mediaType, activationId, allowDuplicate } = parsed.data;

    /* The same link twice is a second Post row, and every metric it carries is
       then counted twice in the campaign's totals. Adding posts one at a time
       made that a rare slip; pasting batches makes overlapping two pastes the
       normal way to do it, so the second copy is refused by name rather than
       created quietly.
       Matched on the platform's post id rather than the URL string, because
       TikTok's share sheet appends is_from_webapp, sender_device and a
       per-browser web_id -- the same video copied from two browsers produced
       two strings, and the equality check let the second one straight through
       into the campaign's totals. */
    const existing = await findExistingPosts(orgId, postUrl);
    const sameCampaign = existing.find((e) => e.campaignId === campaignId);
    if (sameCampaign) {
      /* Not overridable, unlike the cross-campaign case below. Two rows for one
         post inside one campaign double-count that campaign's own views, which
         is never what anyone means by "add it anyway". */
      return NextResponse.json(
        { error: "duplicate_post", message: "Already in this campaign." },
        { status: 409 }
      );
    }
    /* A post legitimately appears in two campaigns -- the same creator video
       can be delivered against two briefs -- so this is a question, not a rule.
       It is refused once with the campaigns named, and goes through on the
       operator's explicit say-so. */
    if (existing.length > 0 && !allowDuplicate) {
      const names = existing.map((e) => e.campaignName);
      return NextResponse.json(
        {
          error: "duplicate_post_other_campaign",
          message:
            names.length === 1
              ? `Already tracked in ${names[0]}. Add anyway to count it here too.`
              : `Already tracked in ${names.length} other campaigns. Add anyway to count it here too.`,
          campaigns: existing.map((e) => ({ id: e.campaignId, name: e.campaignName })),
        },
        { status: 409 }
      );
    }

    const detected = detectPlatform(postUrl);

    /* An explicitly chosen creator always wins; the handle in the URL is only
       consulted when none was chosen. Matching is case-insensitive and tolerates
       a leading @, because handles are stored both ways, and it stays scoped to
       the org -- a pasted URL is untrusted input and must never reach across a
       tenant.

       A handle nobody has typed into the roster yet is added rather than
       refused. The roster is a record of who we track, not a permit list to be
       filled in before the work can start, and the link already names the
       account -- so an agency pasting a client's week of deliverables does not
       have to stop, add four creators by hand and paste the batch again. The
       seat still has to be one that could have added that creator directly. */
    let creatorId = parsed.data.creatorId;
    let addedCreator: { id: string; handle: string } | null = null;
    if (!creatorId && detected?.handle) {
      const bare = detected.handle.replace(/^@/, "");
      const mayCreate = hasPermission((session.user as any).role ?? "", "creators:create");
      const found = mayCreate
        ? await ensureCreatorForHandle(orgId, bare, detected.platform)
        : { creator: await findCreatorByHandle(orgId, bare, detected.platform), created: false };
      if (!found.creator) {
        return NextResponse.json(
          { error: `No creator matches @${bare}. Pick one, or add @${bare} first.`, detectedHandle: bare },
          { status: 404 }
        );
      }
      creatorId = found.creator.id;
      if (found.created) addedCreator = { id: found.creator.id, handle: found.creator.handle };
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
      /* The duplicate is recorded rather than stored on the row: the same post
         in two campaigns is derivable at any time from platformPostId, so what
         is worth keeping is that somebody was warned and said yes, and which
         campaigns they were warned about. */
      metadata: {
        campaignId,
        creatorId,
        platform: post.platform,
        postUrl,
        ...(existing.length > 0
          ? { duplicateOf: existing.map((e) => ({ postId: e.id, campaignId: e.campaignId, campaignName: e.campaignName })) }
          : {}),
        ...(addedCreator ? { creatorAutoAdded: addedCreator.handle } : {}),
      },
    });

    /* Its own audit line, not a footnote on the post's: a roster entry appearing
       without anyone visiting the Creators page is exactly the kind of thing
       somebody later asks where it came from. */
    if (addedCreator) {
      await logAudit({
        orgId,
        userId: session.user.id ?? undefined,
        actorEmail: session.user.email ?? undefined,
        action: "creator.create",
        entityType: "creator",
        entityId: addedCreator.id,
        entityLabel: addedCreator.handle,
        ipAddress: getRequestIp(request),
        metadata: { source: "post_add", campaignId, postUrl },
      });
    }

    return NextResponse.json({ ...post, creatorAutoAdded: addedCreator?.handle ?? null }, { status: 201 });
  } catch (error) {
    console.error("Failed to create post:", error);
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
}
