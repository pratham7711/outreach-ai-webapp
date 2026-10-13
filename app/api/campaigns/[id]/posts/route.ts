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
  MEDIA_TYPES as DETECTABLE_MEDIA_TYPES,
} from "@/lib/platforms/fetchPostMetrics";
import { countsFrom, measuredForNewPost, syncPost, SYNC_POST_INCLUDE } from "@/lib/sync/syncPost";
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
import { matchFacebookPost } from "@/lib/platforms/facebookPost";
import { hasPermission } from "@/lib/rbac";
import { getUnattributedCreator, isUnattributedCreator } from "@/lib/posts/unattributedCreator";
import { detectPostCreator, type CreatorDetection } from "@/lib/posts/detectCreator";
import { isLiveCampaign, trackingView } from "@/lib/sync/postTracking";
import { parsePostTracking } from "@/lib/trackers/granularity";
import {
  toPostDto,
  encodePostList,
  wantsProtobuf,
  POST_LIST_CONTENT_TYPE,
} from "@/lib/serialization/postList";
import { removablePostIds } from "@/lib/posts/bulkActions";

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
        lastFreshAt: true,
        authorProfilePic: true,
        createdAt: true,
        platformMetrics: true,
        syncFailCount: true,
        syncDisabledAt: true,
        trackingEnabled: true,
        trackingExpiresAt: true,
        trackingStartedAt: true,
        trackingTtlDays: true,
        /* A sealed post is never read again, whatever its columns say. */
        _count: { select: { snapshots: { where: { isFinalSnapshot: true } } } },
        creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
        /* The views delta needs the two newest readings that measured views;
           a few spare rows let toPostDto skip a partial read without leaving
           the post with no delta. */
        snapshots: {
          orderBy: { recordedAt: "desc" },
          take: 6,
          select: { id: true, viewsCount: true, recordedAt: true, platformMetrics: true },
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

    /* The tracking badge and the Tracked filter say whether the cron will read
       the post, which is more than the tracker column: a post in its first
       month or in a running campaign is read without one, and a tracker whose
       window has closed is not read though its column is still on until the
       seal lands. Same rule as the cron (postCoverage), same org cadence. */
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { uiConfig: true } });
    const granularity = parsePostTracking(org?.uiConfig ?? null);
    const campaignLive = isLiveCampaign(campaign);
    const now = new Date();
    const dtos = posts.map((p) => {
      const view = trackingView({
        trackingEnabled: p.trackingEnabled,
        trackingStartedAt: p.trackingStartedAt,
        trackingExpiresAt: p.trackingExpiresAt,
        trackingTtlDays: p.trackingTtlDays,
        lastSyncedAt: p.lastSyncedAt,
        syncDisabledAt: p.syncDisabledAt,
        hasFinalSnapshot: p._count.snapshots > 0,
        granularity,
        now,
        postedAt: p.postedAt,
        campaignLive,
      });
      return toPostDto({ ...p, ...view }, flaggedPostIds.has(p.id), checkPostCompliance(p, campaign));
    });

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
    let unattributed = false;
    /* A Facebook post is readable only through the connected Page it sits on, so
       the Page decides whose post it is: matched against the org's connected
       Pages (a chosen creator's own Pages, when one was chosen), and filed under
       that Page's creator. Nobody is asked. A link on no connected Page falls
       through to the same handle and holding-row rules as every other link. */
    const facebookMatch =
      detected?.platform === "FACEBOOK"
        ? await matchFacebookPost(orgId, postUrl, creatorId ? { creatorId } : {})
        : null;
    if (!creatorId && facebookMatch) creatorId = facebookMatch.creatorId;
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
      /* A seat that may not add creators still gets its post tracked. It lands
         under the holding row below rather than under a roster entry this seat
         was never allowed to create. */
      if (found.creator) {
        creatorId = found.creator.id;
        if (found.created) addedCreator = { id: found.creator.id, handle: found.creator.handle };
      }
    }
    /* The org's own copy of this exact post, when nothing else named anybody.
       Same rule as the precheck, and it has to be here too or the dialog would
       promise a creator this handler then refuses. */
    const attributedCopy = existing.find(
      (e) => !isUnattributedCreator({ name: e.creatorName, handle: e.creatorHandle }),
    );
    if (!creatorId && attributedCopy) creatorId = attributedCopy.creatorId;
    /* Nobody named anybody, and the post is still added. Adding a post is a
       request to track it, and asking the operator who posted it got nothing the
       platform would confirm -- see lib/posts/unattributedCreator. A link no
       detector recognises is the one refusal left: with no platform there is
       nothing to track and no holding row to file it under. */
    if (!creatorId) {
      if (!detected?.platform) {
        return NextResponse.json(
          { error: "That is not a post link we can track. Check the URL." },
          { status: 400 }
        );
      }
      creatorId = (await getUnattributedCreator(orgId, detected.platform)).id;
      unattributed = true;
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
       checked. Nor can a Facebook post found on the creator's own connected
       Page: the Page answering for it is the strongest attribution there is. */
    if (resolvedHandle && !addedCreator && !unattributed && !facebookMatch && !parsed.data.allowHandleMismatch) {
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
        ? await getInstagramAccountForCreator(creatorId, orgId, postUrl)
        : undefined;
    const tiktokToken =
      detectedPlatform === "TIKTOK"
        ? await getTikTokTokenForCreator(creatorId, orgId)
        : undefined;
    const metrics = await fetchPostMetrics(postUrl, {
      instagramToken: instagram?.token,
      instagramHandle: instagram?.handle,
      instagramOrgId: orgId,
      tiktokToken,
      ...(detectedPlatform === "FACEBOOK" ? { facebook: { orgId, creatorId, match: facebookMatch } } : {}),
    });

    const initialStatus: PostStatus = campaign.postApprovalMode === "AUTO_APPROVED" ? "APPROVED" : "PENDING_REVIEW";
    /* hasMetricCounts (inside measuredForNewPost, with the shared validation
       gate) also refuses a reading with more likes than views, and the counts
       below used to be written whether or not it passed -- so a new post could
       start life with the contradiction applyPostMetrics refuses on every
       later read. See lib/metrics/coherence. */
    const measuredMetrics = measuredForNewPost(metrics, detectedPlatform, { writer: "add-post", orgId });

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
        ...(measuredMetrics ? countsFrom(measuredMetrics).counts : {}),
        engagementRate: measuredMetrics?.engagementRate ?? 0,
        postedAt: metrics?.postedAt ?? new Date(),
        ...(measuredMetrics ? { platformMetrics: countsFrom(measuredMetrics).measuredPatch } : {}),
        // Without this a post created with real counts reads as never synced,
        // which makes lib/metricDisplay treat its measured zeroes as unknown and
        // makes the card say "Never" under numbers we just fetched. Only set
        // when counts actually arrived -- see lib/sync/syncPost for why.
        lastSyncedAt: measuredMetrics ? new Date() : null,
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

    /* Nobody named the creator before the save, but the read that just ran may
       have, and the campaign's own creators' media may hold the post. Tried
       once here so the row usually comes back with its creator and views; a
       miss is not a failure -- every later read of the post tries again. See
       lib/posts/detectCreator. */
    let saved: Record<string, unknown> = post;
    let detection: CreatorDetection | null = null;
    if (unattributed) {
      try {
        detection = await detectPostCreator(
          { id: post.id, postUrl, authorHandle: metrics?.authorHandle, timeoutMs: 6_000 },
          orgId,
        );
        if (detection) {
          unattributed = false;
          await syncPost({ ...post, creatorId: detection.creatorId }, orgId, { afterDetection: true }).catch(
            (err) => console.error("Found the creator of a new post but the read under them failed:", err),
          );
          saved = (await db.post.findUnique({ where: { id: post.id }, include: { creator: SYNC_POST_INCLUDE.creator } })) ?? post;
        }
      } catch (err) {
        console.error("Creator detection for a new post failed; the next read tries again:", err);
      }
    }

    return NextResponse.json(
      {
        ...saved,
        creatorAutoAdded: addedCreator?.handle ?? (detection?.created ? detection.handle : null),
        unattributed,
        creatorDetected: detection ? { handle: detection.handle, source: detection.source } : null,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create post:", error);
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
}

/**
 * DELETE /api/campaigns/[id]/posts — remove posts from this campaign.
 * Body: { postIds: string[] } (1..MAX_BULK_ACTION_POSTS).
 *
 * A hard delete, because a post in a campaign is a claim that it belongs to
 * the campaign: a mis-pasted link otherwise stays in the post count and the
 * totals forever, and there is no deletedAt on Post to hide it with (adding
 * one is a schema change every Post query would then have to honour).
 *
 * What hangs off a Post, and what happens to it:
 *   - PostMetricSnapshot: FK, ON DELETE CASCADE -- the readings go with it.
 *   - SyncSlot.postId: FK, ON DELETE SET NULL -- the slot survives, unbound.
 *   - ViewFraudFlag.postId: no FK. Deleted here in the same transaction, so a
 *     flag never points at a post that is gone.
 *   - ViewLedger.postId: no FK, and it is money -- CPM earnings already
 *     recorded against the post. Removal is REFUSED when any exist: deleting
 *     the post would leave earnings for a post nobody can see, and deleting
 *     the ledger would rewrite what a creator was paid for.
 *   - Creator.topPosts JSON holds platform ids, not ours; nothing to do.
 * Campaign totals and reports are derived from Post rows at read time, and the
 * cached performance report is keyed on a stamp that moves when the post
 * count does (lib/reports/campaignPerformance).
 *
 * All or nothing: if any id is not a post of this campaign the call is
 * refused rather than removing the rest, so the count the operator confirmed
 * is the count that goes.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // The same gate as adding a post: a VIEWER can do neither.
    const denied = permissionDenial(session.user, "campaigns:edit_own");
    if (denied) return denied;
    const orgId = (session.user as { orgId: string }).orgId;
    const { id: campaignId } = await params;

    const scope = scopeSubjectFromSession(session.user);
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null, ...(scope ? campaignScopeWhere(scope) : {}) },
      select: { id: true, title: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const body = await request.json().catch(() => null);
    const ids = removablePostIds(body?.postIds);
    if (!ids) {
      return NextResponse.json({ error: "Pick between 1 and 50 posts to remove." }, { status: 400 });
    }

    const posts = await db.post.findMany({
      where: { id: { in: ids }, campaignId },
      select: {
        id: true,
        postUrl: true,
        platform: true,
        platformPostId: true,
        creatorId: true,
        status: true,
        viewsCount: true,
        creator: { select: { handle: true } },
      },
    });
    if (posts.length !== ids.length) {
      return NextResponse.json(
        { error: "Some of those posts are no longer in this campaign. Reload and try again." },
        { status: 404 },
      );
    }

    const billed = await db.viewLedger.findMany({
      where: { orgId, campaignId, postId: { in: ids } },
      select: { postId: true },
      distinct: ["postId"],
    });
    if (billed.length > 0) {
      return NextResponse.json(
        {
          error:
            billed.length === 1
              ? "1 of these posts has earnings recorded against it, so it can't be removed."
              : `${billed.length} of these posts have earnings recorded against them, so they can't be removed.`,
          code: "has_earnings",
          postIds: billed.map((b) => b.postId),
        },
        { status: 409 },
      );
    }

    const [, removed] = await db.$transaction([
      db.viewFraudFlag.deleteMany({ where: { orgId, campaignId, postId: { in: ids } } }),
      db.post.deleteMany({ where: { id: { in: ids }, campaignId } }),
    ]);

    /* One line per post, like post.create, so each post's history ends with
       who removed it -- and the URL is kept, since the row that held it is gone. */
    for (const post of posts) {
      await logAudit({
        orgId,
        userId: session.user.id ?? undefined,
        actorEmail: session.user.email ?? undefined,
        action: "post.delete",
        entityType: "post",
        entityId: post.id,
        entityLabel: post.creator?.handle ?? post.postUrl,
        ipAddress: getRequestIp(request),
        metadata: { campaignId, batch: ids.length },
        before: {
          postUrl: post.postUrl,
          platform: post.platform,
          platformPostId: post.platformPostId,
          creatorId: post.creatorId,
          status: post.status,
          viewsCount: post.viewsCount,
        },
      });
    }

    return NextResponse.json({ removed: removed.count });
  } catch (error) {
    console.error("Failed to remove posts:", error);
    return NextResponse.json({ error: "Failed to remove posts" }, { status: 500 });
  }
}
