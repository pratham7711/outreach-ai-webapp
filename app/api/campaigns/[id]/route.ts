import { NextRequest, NextResponse, after } from "next/server";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { findForeignRef } from "@/lib/tenantRefs";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { hasPermission } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { generatePublicSlug, generateInviteCode } from "@/lib/marketplace";
import { httpUrlMax } from "@/lib/validation/url";
import { z } from "zod";
import { Prisma } from "@/lib/generated/prisma/client";
import { STATUS_DEF_SELECT, defaultStatusDefFor } from "@/lib/campaigns/statusDefaults";
import { primeSongAudio } from "@/lib/sounds/snapshot";
import { captureCampaignThumbnail } from "@/lib/campaigns/thumbnailCopy";
import { isUploadedThumbnailUrl } from "@/lib/campaigns/uploadedPicture";
import { checkInstagramAudio, createSongForSpotifyLink, ensureSongForAudio, ensureSound, identifyAudioLink } from "@/lib/campaigns/audioLink";
import { clearSongSound, readSongSounds, setSongSound } from "@/lib/songs/songSounds";
import { resolveSpotifyLink } from "@/lib/songs/spotifyLinkResolve";
import { SPOTIFY_LINK_UNAVAILABLE, readSongSpotifyLink, songLinksReady, type SpotifyLinkSave } from "@/lib/songs/songLinks";
import { applySongSpotifyLink } from "@/lib/songs/spotifyLinkApply";
import { ROSTER_CREATOR_SELECT, buildRoster, summarizeCampaignPosts } from "@/lib/campaigns/detailSummary";
import { withoutImportCopy } from "@/lib/serialization/importCopy";
import { followersTimesFor } from "@/lib/creators/followersTimes";

const CAMPAIGN_TYPES = ["BUDGET_BASED", "VIEW_BASED", "OPEN_COMMUNITY", "PRIVATE_INVITE"] as const;

const PAYMENT_MODES = ["MANAGED", "SELF_MANAGED"] as const;
const PAYMENT_RELEASES = ["MANUAL", "ON_POST_APPROVAL", "ON_CREATOR_REQUEST"] as const;
const POST_APPROVAL_MODES = ["MANUAL", "AUTO_APPROVED"] as const;
const MARKETPLACE_VISIBILITIES = ["PRIVATE", "GLOBAL", "INVITE_ONLY"] as const;
const MARKETPLACE_PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"] as const;

// Per-platform rate per 1k views, stored as integer MINOR units (cents/paise) — P3.1 convention.
const ratePerThousandSchema = z
  .partialRecord(z.enum(MARKETPLACE_PLATFORMS), z.number().int().nonnegative())
  .nullable()
  .optional();

const updateCampaignSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(["DRAFT", "PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"]).optional(),
  campaignType: z.enum(CAMPAIGN_TYPES).optional(),
  typeConfig: z.any().nullable().optional(),
  budget: z.number().positive().nullable().optional(),
  currency: z.enum(["USD", "EUR", "GBP", "INR"]).optional(),
  notes: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  // null detaches the campaign from its song and is a supported state, not an
  // error — campaigns are allowed to stand alone.
  songId: z.string().nullable().optional(),
  /* A pasted TikTok/Instagram audio link, find-or-creating the tracker and the
     release behind it. The wizard takes one of these at create time and there
     was no way to give a campaign audio afterwards — an operator who added the
     sound a week later had to rebuild the campaign, so live campaigns simply
     went without, and their client reports showed no audio at all. */
  audioUrl: z.string().trim().min(1).max(2048).optional(),
  /* Takes one platform's sound off the campaign's song, leaving the other
     sound and the Spotify link where they are. */
  removeAudio: z.enum(["TIKTOK", "INSTAGRAM"]).optional(),
  /* The song's Spotify track link, from the campaign's audio settings. Empty
     or null clears it, and the song goes back to being matched by title and
     artist. It is stored on the campaign's song, so every campaign promoting
     that song reads the same track. */
  spotifyUrl: z.string().trim().max(2048).nullable().optional(),
  folderId: z.string().nullable().optional(),
  // The org's own named status. It travels with `status`, which stays the bucket
  // every list and report filters on.
  statusDefId: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  paymentRelease: z.enum(PAYMENT_RELEASES).optional(),
  postApprovalMode: z.enum(POST_APPROVAL_MODES).optional(),
  enrollmentOpen: z.boolean().optional(),
  // ─── Whop-style marketplace (Phase 2M) ───────────────────────────────────
  marketplaceVisibility: z.enum(MARKETPLACE_VISIBILITIES).optional(),
  guidelines: z.string().max(20000).nullable().optional(),
  requirements: z.string().max(20000).nullable().optional(),
  contentAssetsUrl: httpUrlMax(2000).nullable().optional().or(z.literal("")),
  ratePerThousand: ratePerThousandSchema,
  minPayoutMinor: z.number().int().nonnegative().nullable().optional(),
  marketplaceBudgetCapMinor: z.number().int().nonnegative().nullable().optional(),
  submissionDeadline: z.coerce.date().nullable().optional(),
  autoApproveHours: z.number().int().min(1).max(720).optional(),
  // publicSlug is NEVER client-supplied — generated server-side on first GLOBAL publish.
  // inviteCode is NEVER client-supplied — set/rotated server-side via this flag.
  regenerateInviteCode: z.boolean().optional(),
});

/**
 * Publishing to the public marketplace (GLOBAL) requires a title, guidelines,
 * and at least one platform rate. Returns an error string if requirements are
 * unmet, otherwise null. `next` merges the incoming patch over the existing row.
 */
function validateGlobalPublish(next: {
  title?: string | null;
  guidelines?: string | null;
  ratePerThousand?: unknown;
}): string | null {
  if (!next.title || next.title.trim().length === 0) {
    return "A campaign title is required to publish to the public marketplace.";
  }
  if (!next.guidelines || next.guidelines.trim().length === 0) {
    return "Guidelines are required to publish to the public marketplace.";
  }
  const rates = next.ratePerThousand as Record<string, number> | null | undefined;
  const hasRate =
    rates != null &&
    typeof rates === "object" &&
    Object.values(rates).some((v) => typeof v === "number" && v > 0);
  if (!hasRate) {
    return "At least one platform rate is required to publish to the public marketplace.";
  }
  return null;
}

// GET /api/campaigns/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const { id } = await params;

    /* The posts themselves are no longer sent. Every section that showed a
       figure derived from them gets that figure from here, built by the same
       code the page used to run on the whole array (lib/campaigns/
       detailSummary); the Posts tab reads /posts, and always did. Only the
       columns those figures read are loaded, in the same wave as the campaign:
       they are org-filtered through the relation, and dropped unread when the
       campaign is out of the caller's scope. */
    const postsRead = db.post.findMany({
      where: { campaignId: id, campaign: { orgId, deletedAt: null }, ...NOT_REMOVED },
      select: {
        platform: true,
        viewsCount: true,
        likesCount: true,
        commentsCount: true,
        sharesCount: true,
        savesCount: true,
        lastSyncedAt: true,
        lastFreshAt: true,
        platformMetrics: true,
        creator: { select: ROSTER_CREATOR_SELECT },
      },
    });

    const campaignRead = db.campaign.findFirst({
      /* Scope is applied on the way in: a campaign the user is not on must 404
         here, not merely be absent from their list. */
      where: { id, orgId, deletedAt: null, ...campaignScopeWhereFor(result) },
      include: {
        tagLinks: { select: { tag: { select: { id: true, name: true } } } },
        teamMembers: {
          include: {
            user: {
              select: { id: true, name: true, avatarUrl: true },
            },
          },
        },
        /* An explicit creator select, never `creator: true`. The whole row went
           to every seat that could open the campaign, contactEmail and
           paymentInfo included; the page renders the roster fields and nothing
           else. */
        activations: {
          select: {
            id: true,
            creatorId: true,
            status: true,
            statusDefId: true,
            deliverableDueDate: true,
            postedUrl: true,
            draftUrl: true,
            draftSubmittedAt: true,
            createdAt: true,
            updatedAt: true,
            creator: { select: ROSTER_CREATOR_SELECT },
          },
        },
        brief: true,
        financials: true,
        // Named, not just referenced by id: the client picker on the edit tab
        // has to show which client is attached before the client list has
        // finished loading.
        client: { select: { id: true, name: true } },
        /* The header's "N posts" -- removed posts are not in the campaign. */
        _count: {
          select: { activations: true, posts: { where: NOT_REMOVED } },
        },
      },
    });

    const [campaign, posts] = await Promise.all([campaignRead, postsRead]);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const roster = buildRoster(campaign.activations, posts);
    /* Each follower count goes out with when it was measured (plan A6), dated
       the way the Creators list dates it. Absent when it cannot be dated. */
    const followersAt = await followersTimesFor(orgId, roster.map((r) => r.creator));

    return NextResponse.json({
      ...campaign,
      // The importer's `__cc` copy stays server-side (lib/serialization/importCopy).
      typeConfig: withoutImportCopy(campaign.typeConfig),
      roster: roster.map((r) => {
        const at = followersAt.get(r.creator.id);
        return at ? { ...r, followersAt: at } : r;
      }),
      summary: summarizeCampaignPosts(posts),
    });
  } catch (error) {
    console.error("Failed to fetch campaign:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaign" },
      { status: 500 }
    );
  }
}

// PATCH /api/campaigns/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requirePermission(request, "campaigns:edit_own");
    if (!gate.ok) return gate.response;
    const result = gate.auth;
    const { orgId } = result;

    const { id } = await params;
    const body = await request.json();
    const parsed = updateCampaignSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await db.campaign.findFirst({ where: { id, orgId, deletedAt: null, ...campaignScopeWhereFor(result) } });
    if (!existing) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const canEditAny =
      result.actorType === "api_key" ||
      (result.role != null && hasPermission(result.role, "campaigns:edit"));
    if (!canEditAny && existing.createdById !== result.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { regenerateInviteCode, contentAssetsUrl, submissionDeadline, ratePerThousand, audioUrl, removeAudio, spotifyUrl, ...rest } =
      parsed.data;

    /* An uploaded picture changes only through its own route (./thumbnail).
       Attaching a sound sends the sound's cover here, and that must not
       replace the picture the team chose for the campaign. */
    if (rest.thumbnailUrl !== undefined && isUploadedThumbnailUrl(existing.thumbnailUrl, id)) {
      delete rest.thumbnailUrl;
    }

    // songId, clientId and folderId all arrive in the body, so each has to be
    // proven to belong to this org. Without it a caller could attach their
    // campaign to another org's song and have their numbers show up on that
    // org's song dashboard — or file it under another org's client or folder and
    // read that name straight back off their own campaigns list.
    const foreign = await findForeignRef(orgId, {
      songId: rest.songId,
      clientId: rest.clientId,
      folderId: rest.folderId,
      statusDefId: rest.statusDefId,
    });
    if (foreign) {
      const label =
        foreign === "song" ? "Song"
        : foreign === "client" ? "Client"
        : foreign === "status" ? "Status"
        : "Folder";
      return NextResponse.json({ error: `${label} not found` }, { status: 404 });
    }

    /* The Spotify link is settled before anything is written: a bad link is a
       400 that names it, and a database without the link column is a 503
       that says so -- either way the campaign is left exactly as it was,
       rather than half-saved without the link the operator just pressed Save
       for. `undefined` means the body did not mention it. */
    let spotifyTrackId: string | null | undefined;
    if (spotifyUrl !== undefined) {
      if (spotifyUrl) {
        const link = await resolveSpotifyLink(spotifyUrl);
        if (!link.ok) return NextResponse.json({ error: link.reason, message: link.message }, { status: 400 });
        spotifyTrackId = link.trackId;
      } else {
        spotifyTrackId = null;
      }
      if (!(await songLinksReady(orgId))) {
        return NextResponse.json({ error: "spotify_link_unavailable", message: SPOTIFY_LINK_UNAVAILABLE }, { status: 503 });
      }
    }

    if (audioUrl !== undefined && removeAudio) {
      return NextResponse.json({ error: "Invalid input", message: "Add or remove a sound, not both at once." }, { status: 400 });
    }

    /* Parsed before anything is written, so a bad link is a 400 that names the
       problem rather than a silent no-op on a campaign the operator thinks now
       carries audio. Only the parse happens here: a short link is resolved by
       following it over the network, which must not sit inside the transaction
       the find-or-create opens below. */
    let audioSongId: string | null = null;
    if (audioUrl !== undefined) {
      const parsedAudio = await identifyAudioLink(audioUrl);
      if (!parsedAudio.ok) {
        return NextResponse.json(
          { error: parsedAudio.reason, message: parsedAudio.message },
          { status: 400 }
        );
      }
      let audio = parsedAudio.audio;
      /* Instagram answers 200 for an id that is no audio, and publishes no
         count for original audio; either would be a card that never fills. */
      if (audio.platform === "INSTAGRAM") {
        const checked = await checkInstagramAudio(audio.tiktokSoundId);
        if (!checked.ok) return NextResponse.json({ error: checked.reason, message: checked.message }, { status: 400 });
        if (checked.reading?.title && !audio.provisionalTitle) audio = { ...audio, provisionalTitle: checked.reading.title };
      }
      const linksReady = await songLinksReady(orgId);
      const fallbackTitle = rest.title ?? existing.title;
      /* One transaction for the pair, for the reason the create route gives: a
         TikTokSound is a standing instruction to fetch a page on a schedule, so
         an orphaned one keeps costing something.

         A campaign that already has a song keeps it: the sound goes in its own
         platform's slot there, beside the other platform's sound and the
         Spotify link, which used to be left behind on the old song when the
         campaign was moved to the new sound's. Without the link columns, or
         without a song, it is found-or-made by the sound as it always was. */
      audioSongId = await db.$transaction(async (tx) => {
        if (linksReady && existing.songId) {
          const sound = await ensureSound(tx, orgId, audio, fallbackTitle);
          if ((await setSongSound(tx, orgId, existing.songId, sound)) !== "no-song") return existing.songId;
        }
        return ensureSongForAudio(tx, orgId, audio, fallbackTitle, { linksReady });
      });
    }

    /* Removing one platform's sound. When the song would be left with nothing
       -- no other sound, no Spotify link -- the campaign is detached from it
       instead, exactly as Remove always did, so a song other campaigns share
       keeps its sound. Without the link columns there is only one sound to
       remove, and detaching is still the answer. */
    let detachSong = false;
    if (removeAudio && existing.songId) {
      const [sounds, link] = await Promise.all([
        readSongSounds(orgId, existing.songId),
        readSongSpotifyLink(orgId, existing.songId),
      ]);
      const target = removeAudio === "TIKTOK" ? sounds.tiktok : sounds.instagram;
      const other = removeAudio === "TIKTOK" ? sounds.instagram : sounds.tiktok;
      if (target) {
        if (!sounds.ready || (other === null && link.trackId === null)) detachSong = true;
        else await clearSongSound(db, orgId, existing.songId, removeAudio);
      }
    }

    /* The song the link goes on: the one this request leaves the campaign
       pointing at. A campaign with no song gets one for the link, as a
       campaign created with only a Spotify link does. */
    let spotifySongId: string | null = null;
    if (spotifyTrackId !== undefined) {
      spotifySongId = audioSongId ?? (rest.songId !== undefined ? rest.songId : existing.songId);
      if (!spotifySongId && spotifyTrackId) {
        spotifySongId = await createSongForSpotifyLink(db, orgId, rest.title ?? existing.title);
      }
    }

    // Build the update payload; marketplace side-effects (slug, invite code) are
    // derived server-side only — never trusted from the request body.
    const data: Prisma.CampaignUncheckedUpdateInput = {
      ...rest,
      // Normalize empty-string asset URL to null.
      ...(contentAssetsUrl !== undefined
        ? { contentAssetsUrl: contentAssetsUrl === "" ? null : contentAssetsUrl }
        : {}),
      ...(submissionDeadline !== undefined ? { submissionDeadline } : {}),
      // JSON column: Prisma needs JsonNull sentinel (not JS null) to store SQL null.
      ...(ratePerThousand !== undefined
        ? { ratePerThousand: ratePerThousand === null ? Prisma.JsonNull : ratePerThousand }
        : {}),
      // After the spread: a link that resolved is the caller's newest intent and
      // wins over a songId sent in the same body.
      ...(audioSongId ? { songId: audioSongId } : {}),
      ...(spotifySongId && spotifySongId !== audioSongId ? { songId: spotifySongId } : {}),
      ...(detachSong ? { songId: null } : {}),
    };

    /* A campaign never sits without a named status. The caller keeps the one it
       names; otherwise the bucket's own default follows the bucket, and a row
       that arrived here carrying none is filled in. Without this, moving a
       campaign between buckets left the previous bucket's status on it, and
       clearing a status left the row rendering as "No status". */
    const nextBucket = rest.status ?? existing.status;
    const keepsNamedStatus =
      rest.statusDefId != null ||
      (rest.statusDefId === undefined &&
        existing.statusDefId != null &&
        nextBucket === existing.status);
    if (!keepsNamedStatus) {
      const statusDefs = await db.campaignStatusDef.findMany({
        where: { orgId },
        select: STATUS_DEF_SELECT,
      });
      data.statusDefId = defaultStatusDefFor(nextBucket, statusDefs)?.id ?? null;
    }

    const nextVisibility = rest.marketplaceVisibility ?? existing.marketplaceVisibility;

    // Gate: publishing to GLOBAL requires title + guidelines + ≥1 platform rate.
    if (nextVisibility === "GLOBAL") {
      const error = validateGlobalPublish({
        title: rest.title ?? existing.title,
        guidelines: "guidelines" in rest ? rest.guidelines : existing.guidelines,
        ratePerThousand:
          ratePerThousand !== undefined ? ratePerThousand : existing.ratePerThousand,
      });
      if (error) {
        return NextResponse.json({ error }, { status: 400 });
      }
      // Generate a public slug on first publish (idempotent — keep an existing one).
      if (!existing.publicSlug) {
        data.publicSlug = await generatePublicSlug(rest.title ?? existing.title);
      }
    }

    // Ensure an INVITE_ONLY campaign always has a code; rotate on explicit request.
    if (nextVisibility === "INVITE_ONLY" && (!existing.inviteCode || regenerateInviteCode)) {
      data.inviteCode = generateInviteCode();
    } else if (regenerateInviteCode && existing.inviteCode) {
      data.inviteCode = generateInviteCode();
    }

    const campaign = await db.campaign.update({
      where: { id },
      data,
      include: {
        tagLinks: { select: { tag: { select: { id: true, name: true } } } },
        teamMembers: {
          include: {
            user: {
              select: { id: true, name: true, avatarUrl: true },
            },
          },
        },
        _count: {
          select: { activations: true, posts: { where: NOT_REMOVED } },
        },
        // The page merges this response in place of re-reading the campaign,
        // so it carries the client's name the edit form shows.
        client: { select: { id: true, name: true } },
      },
    });

    /* Attaching a song to an existing campaign is the other way audio arrives --
       the song dashboard's Attach Campaigns control lands here -- so it gets the
       same first reading as creating a campaign with an audio link. No-ops when
       the sound already has history, which is the common case for a second
       campaign joining a tracker. */
    const primeTarget = audioSongId ?? rest.songId;
    if (primeTarget) {
      /* after() itself throws when there is no request scope to attach to, and
         scheduling a first audio reading must never cost the caller the write
         that just succeeded -- the sound is tracked either way, and the cron
         picks it up. Same reasoning as the refresh route's hand-off. */
      try {
        after(async () => {
          try {
            await primeSongAudio(orgId, primeTarget);
          } catch (error) {
            console.error("Failed to prime campaign audio:", error);
          }
        });
      } catch (error) {
        console.error("Could not schedule the campaign's first audio reading:", error);
      }
    }

    /* After the campaign write and outside any transaction, like the create
       route; the first reading, when the link changed on an open campaign, is
       scheduled in there. */
    let spotifySaved: SpotifyLinkSave | null = null;
    if (spotifyTrackId !== undefined && spotifySongId) {
      spotifySaved = await applySongSpotifyLink(orgId, spotifySongId, spotifyTrackId, campaign.status);
    }

    /* A new picture is copied while its link still draws (lib/campaigns/
       thumbnailCopy); the copy is what the list and the client report show. */
    if (campaign.thumbnailUrl && rest.thumbnailUrl !== undefined && campaign.thumbnailUrl !== existing.thumbnailUrl) {
      try {
        after(() => captureCampaignThumbnail(campaign.id));
      } catch (error) {
        console.error("Could not schedule the campaign picture copy:", error);
      }
    }

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "campaign.update",
      entityType: "campaign",
      entityId: campaign.id,
      entityLabel: campaign.title,
      ipAddress: getRequestIp(request),
      before: {
        id: existing.id,
        title: existing.title,
        status: existing.status,
        campaignType: existing.campaignType,
        budget: existing.budget,
      },
      after: {
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        campaignType: campaign.campaignType,
        budget: campaign.budget,
        ...(spotifyTrackId !== undefined ? { spotifyTrackId } : {}),
      },
    });

    if (spotifySaved === "unavailable") {
      return NextResponse.json({ error: "spotify_link_unavailable", message: SPOTIFY_LINK_UNAVAILABLE }, { status: 503 });
    }
    return NextResponse.json({
      ...campaign,
      typeConfig: withoutImportCopy(campaign.typeConfig),
      ...(spotifyTrackId !== undefined ? { spotifyTrackId: spotifySongId ? spotifyTrackId : null } : {}),
    });
  } catch (error) {
    console.error("Failed to update campaign:", error);
    return NextResponse.json(
      { error: "Failed to update campaign" },
      { status: 500 }
    );
  }
}

// DELETE /api/campaigns/[id] - Soft delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requirePermission(request, "campaigns:delete");
    if (!gate.ok) return gate.response;
    const result = gate.auth;
    const { orgId } = result;

    const { id } = await params;

    const existing = await db.campaign.findFirst({ where: { id, orgId, deletedAt: null, ...campaignScopeWhereFor(result) } });
    if (!existing) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    await db.campaign.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "campaign.delete",
      entityType: "campaign",
      entityId: existing.id,
      entityLabel: existing.title,
      ipAddress: getRequestIp(request),
      before: {
        id: existing.id,
        title: existing.title,
        status: existing.status,
        deletedAt: existing.deletedAt,
      },
      after: {
        id: existing.id,
        deletedAt: new Date().toISOString(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete campaign:", error);
    return NextResponse.json(
      { error: "Failed to delete campaign" },
      { status: 500 }
    );
  }
}
