import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { permissionDenial } from "@/lib/authz";
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
import { platformLabel } from "@/lib/format";
import {
  ensureCreatorForHandle,
  findCreatorByHandle,
  findExistingPosts,
  handleMatchesCreator,
} from "@/lib/posts/addPostChecks";
import { resolveAuthorFromPlatform } from "@/lib/platforms/postAuthor";
import { hasPermission } from "@/lib/rbac";
import {
  toPostDto,
  encodePostList,
  wantsProtobuf,
  POST_LIST_CONTENT_TYPE,
} from "@/lib/serialization/postList";

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
  /* "I know, file it under them anyway" -- the operator's answer to the
     author check below. A collab reel is published by one account and the
     platform names only that one, so the check has to be refusable; it is a
     deliberate second click, never a default. */
  allowHandleMismatch: z.boolean().optional(),
});

// GET /api/campaigns/[id]/posts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const denied = permissionDenial(session.user, "campaigns:read");
    if (denied) return denied;
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

    /* Name the columns instead of taking the row.
       `include` with no `select` hands back every Post column, which meant this
       route read and shipped platformMetrics whole -- and 93% of that bag is
       `__cc`, the importer's verbatim copy of a CreatorCore record that already
       lives in CcPost.raw (18,638 of 18,638 posts join to one, byte-identical)
       and that nothing on the page reads. On the largest campaign that was
       1,233.9 KB of JSON where 493.2 KB was the answer. platformMetrics is
       still read because two of its keys ARE rendered, but toPostDto keeps only
       those; syncFailCount and syncDisabledAt are here for the compliance
       check, which is the only other consumer of this row. */
    const posts = await db.post.findMany({
      where,
      select: {
        id: true,
        platform: true,
        platformPostId: true,
        postUrl: true,
        thumbnailUrl: true,
        caption: true,
        mediaType: true,
        postedAt: true,
        viewsCount: true,
        likesCount: true,
        commentsCount: true,
        sharesCount: true,
        savesCount: true,
        downloadsCount: true,
        engagementRate: true,
        status: true,
        fetchState: true,
        rejectionReason: true,
        lastSyncedAt: true,
        authorProfilePic: true,
        createdAt: true,
        platformMetrics: true,
        syncFailCount: true,
        syncDisabledAt: true,
        trackingEnabled: true,
        trackingExpiresAt: true,
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
    const dtos = posts.map((p) =>
      toPostDto(p, flaggedPostIds.has(p.id), checkPostCompliance(p, campaign)),
    );

    /* Protobuf only when asked for by name, so every existing caller -- and any
       tab still running the previous bundle -- keeps getting JSON. Both come
       from the same DTO, so the two encodings cannot describe different posts.
       Measured on the 492-post campaign, brotli: 44.1 KB JSON against 43.2 KB
       protobuf, which is why JSON stays the default -- the 2% is not worth
       12.3 KB of decoder in the bundle, and protobufjs decodes 2.1x slower than
       V8's native JSON.parse. The win in this route was never the encoding; it
       was not sending `__cc`. See docs/SERIALIZATION.md for the full numbers. */
    if (wantsProtobuf(request.headers.get("accept"))) {
      const body = encodePostList(dtos);
      return new NextResponse(body as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": POST_LIST_CONTENT_TYPE,
          "Content-Length": String(body.byteLength),
        },
      });
    }

    return NextResponse.json({ posts: dtos });
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
    const denied = permissionDenial(session.user, "campaigns:edit_own");
    if (denied) return denied;
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
       created quietly.
       Matched on the platform's post id rather than the URL string, because
       TikTok's share sheet appends is_from_webapp, sender_device and a
       per-browser web_id -- the same video copied from two browsers produced
       two strings, and the equality check let the second one straight through
       into the campaign's totals. */
    const existing = await findExistingPosts(orgId, postUrl);
    const sameCampaign = existing.find((e) => e.campaignId === campaignId);
    if (sameCampaign) {
      /* The one duplicate that is still refused. Two rows for one post inside
         one campaign double-count that campaign's own views; the same post in
         a second campaign does not, and is allowed straight through below. */
      return NextResponse.json(
        { error: "duplicate_post", message: "Already in this campaign." },
        { status: 409 }
      );
    }
    /* A post in a second campaign is allowed outright. The same creator video
       is routinely delivered against two briefs, and each campaign counts its
       own views -- nothing is double-counted within a campaign, which is the
       only total the refusal above protects. It used to 409 here and ask for a
       tick-box override; that was friction in front of the normal case. The
       campaigns it already belongs to are still recorded on the audit line
       below, so "where else does this post count" stays answerable.

       Only the same campaign twice is refused. */

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
    /* The link's own handle first, then the platform's answer for a link that
       carries none -- a YouTube watch URL names no channel, and oEmbed hands
       the channel over for free. Only when neither says is anybody asked.
       Both YouTube and Instagram answer; see resolveAuthorFromPlatform for
       what each was measured to give. */
    const urlHandle = detected?.handle?.replace(/^@/, "") ?? null;
    /* Asked whenever the link itself names nobody -- INCLUDING when a creator
       was chosen. It used to be skipped in that case (`creatorId ? null : ...`)
       on the reasoning that a chosen creator needs no lookup, and that is what
       let ten Instagram reels by @ispeedsworld be filed against @ispeedsword on
       production: a reel URL carries no handle, so nothing ever asked who
       posted it and the misspelt roster row was accepted unverified. Every
       metric read afterwards went out under a username Instagram has never
       heard of, which is why those posts show no views. The answer is now
       checked against the chosen creator below. */
    const platformAuthor = urlHandle ? null : await resolveAuthorFromPlatform(postUrl, detected?.platform);
    const resolvedHandle = urlHandle ?? platformAuthor?.handle?.replace(/^@/, "") ?? null;
    if (!creatorId && resolvedHandle && detected?.platform) {
      const bare = resolvedHandle;
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
    /* The org's own copy of this exact post, when nothing else named anybody.
       Same rule as the precheck, and it has to be here too or the dialog would
       promise a creator this handler then refuses. */
    if (!creatorId && existing.length > 0) creatorId = existing[0].creatorId;
    if (!creatorId) {
      return NextResponse.json(
        { error: "Neither this link nor the platform names its creator, so please choose one." },
        { status: 400 }
      );
    }

    const creator = await db.creator.findFirst({
      where: { id: creatorId, orgId, deletedAt: null },
      include: { socialAccounts: { select: { platform: true, handle: true } } },
    });
    if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

    /* Whoever the platform says posted it has to be somebody this creator is
       known as. Nothing here invents an attribution -- it only refuses one the
       platform contradicts, and only when the platform actually answered:
       resolvedHandle is null for a reader that was rate limited, a deleted
       post or a platform with no author lookup, and a silent reader must never
       cost an operator a post.

       Narrowed to the link's platform when it named one, because a handle is
       only unique within a platform -- the same spelling is two different
       people on Instagram and TikTok in 22 handles of this database.

       A creator we just created FROM this handle cannot disagree with it, and
       skipping the comparison there keeps the batch path honest about what it
       checked. */
    if (resolvedHandle && !addedCreator && !parsed.data.allowHandleMismatch) {
      const known = [
        creator.handle,
        ...creator.socialAccounts
          .filter((a) => !detected?.platform || a.platform === detected.platform)
          .map((a) => a.handle),
      ];
      if (!handleMatchesCreator(resolvedHandle, known)) {
        return NextResponse.json(
          {
            error: "author_mismatch",
            message: `${platformLabel(detected?.platform) || "The platform"} says @${resolvedHandle} posted this, not ${creator.name} (${creator.handle}). Attribute it to @${resolvedHandle}, or add it anyway if they posted it together.`,
            detectedHandle: resolvedHandle,
            creator: { id: creator.id, name: creator.name, handle: creator.handle },
          },
          { status: 409 }
        );
      }
    }

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
         is worth keeping is which campaigns already held it at the moment this
         one was added. */
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
