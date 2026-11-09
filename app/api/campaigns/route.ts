import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { withoutImportCopy } from "@/lib/serialization/importCopy";
import { findForeignRef } from "@/lib/tenantRefs";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import { pageParam, pageSizeParam, parseQuery } from "@/lib/http/queryParams";
import { checkInstagramAudio, createSongForSpotifyLink, ensureSongForAudio, ensureSound, identifyAudioLink, type ResolvedAudio } from "@/lib/campaigns/audioLink";
import { setSongSound } from "@/lib/songs/songSounds";
import { resolveSpotifyLink } from "@/lib/songs/spotifyLinkResolve";
import { songLinksReady } from "@/lib/songs/songLinks";
import { applySongSpotifyLink } from "@/lib/songs/spotifyLinkApply";
import { primeSongAudio } from "@/lib/sounds/snapshot";
import { captureCampaignThumbnail } from "@/lib/campaigns/thumbnailCopy";
import { CAMPAIGN_STATUSES, CAMPAIGN_TYPES, campaignFilterSchema, campaignWhere } from "@/lib/listFilters";
import { CAMPAIGN_START_STATUS, STATUS_DEF_SELECT, defaultStatusDefFor } from "@/lib/campaigns/statusDefaults";
import type { PaymentMode, PaymentRelease, PostApprovalMode, Prisma } from "@/lib/generated/prisma/client";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { setupFromSchema, type CampaignSetup } from "@/lib/campaigns/templates/payload";
import { readSetupSource, rulesTableReady, writeSetupExtras, type SetupWritten } from "@/lib/campaigns/templates/setup";

// The list query is the page's filter set plus pagination, so a filter added to
// the drawer reaches this route without a second schema to keep in step.
const listCampaignsQuerySchema = campaignFilterSchema.extend({
  page: pageParam,
  limit: pageSizeParam(),
});

const PAYMENT_MODES = ["MANAGED", "SELF_MANAGED"] as const;
const PAYMENT_RELEASES = ["MANUAL", "ON_POST_APPROVAL", "ON_CREATOR_REQUEST"] as const;
const POST_APPROVAL_MODES = ["MANUAL", "AUTO_APPROVED"] as const;

const createCampaignSchema = z.object({
  title: z.string().min(1).max(200),
  status: z.enum(["DRAFT", "PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"]).optional(),
  campaignType: z.enum(CAMPAIGN_TYPES).optional(),
  typeConfig: z.any().nullable().optional(),
  /* Zero or more. Negative was already refused (positive()), but so was 0,
     which a person types to mean "no budget"; 0 is accepted now and stored as
     null below, the same as leaving the field empty. */
  budget: z.number().finite().nonnegative({ message: "Budget can't be negative" }).nullable().optional(),
  currency: z.enum(["USD", "EUR", "GBP", "INR"]).optional(),
  notes: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  paymentRelease: z.enum(PAYMENT_RELEASES).optional(),
  postApprovalMode: z.enum(POST_APPROVAL_MODES).optional(),
  enrollmentOpen: z.boolean().optional(),
  /* A pasted TikTok or Instagram sound link. Resolved server-side into the
     Song -> TikTokSound pair a campaign points at; the client never sends ids.
     The New Campaign form sends its TikTok sound here; an Instagram link sent
     here alone is the song's Instagram audio, as it always was. */
  audioUrl: z.string().trim().min(1).nullable().optional(),
  /* The same release's Instagram audio, beside the TikTok sound rather than
     instead of it. Must be an Instagram audio link. */
  instagramAudioUrl: z.string().trim().min(1).max(2048).nullable().optional(),
  /* The song's Spotify track link, optional. Re-parsed here whatever the form
     said about it, and stored on the campaign's song as its track id. */
  spotifyUrl: z.string().trim().min(1).max(2048).nullable().optional(),
  /* Start from a saved template or from a past campaign's setup. Only the
     source is named: its brief, rules and phases are read here from the
     server's own copy, in this org, never taken from the body. The fields
     above that the body does send -- client, budget, currency, approval,
     notes -- win over the source's. */
  setupFrom: setupFromSchema.optional(),
});

// GET /api/campaigns - List campaigns with filters and pagination
export async function GET(request: NextRequest) {
  try {
    const result = await authenticateRequest(request);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const parsedQuery = parseQuery(listCampaignsQuerySchema, request.nextUrl.searchParams);
    if (!parsedQuery.ok) return parsedQuery.response;
    const { page, limit, ...filters } = parsedQuery.data;
    const skip = (page - 1) * limit;

    /* Row scope, ANDed rather than spread: campaignWhere puts the search box in
       an OR, and so does the scope, so spreading one over the other silently
       dropped whichever came first. The list used to skip the scope entirely,
       so an "assigned only" member saw every campaign in the org through the
       API while the page hid them. Unscoped callers keep the query they had. */
    const filterWhere = campaignWhere(orgId, filters);
    const scope = campaignScopeWhereFor(result);
    const where: Prisma.CampaignWhereInput =
      Object.keys(scope).length === 0 ? filterWhere : { AND: [filterWhere, scope] };

    const [campaigns, total] = await Promise.all([
      db.campaign.findMany({
        where,
        include: {
          tags: true,
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
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit,
      }),
      db.campaign.count({ where }),
    ]);

    return NextResponse.json({
      /* typeConfig passes through for its real keys (a view-based campaign's
         rates); the importer's `__cc` copy was 78% of this response. */
      campaigns: campaigns.map((c) => ({ ...c, typeConfig: withoutImportCopy(c.typeConfig) })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to fetch campaigns:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaigns" },
      { status: 500 }
    );
  }
}

// POST /api/campaigns - Create a new campaign
export async function POST(request: NextRequest) {
  try {
    const gate = await requirePermission(request, "campaigns:create");
    if (!gate.ok) return gate.response;
    const result = gate.auth;
    const { orgId } = result;

    const body = await request.json();
    const parsed = createCampaignSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { title, status, campaignType, typeConfig, folderId, thumbnailUrl, paymentMode, paymentRelease, enrollmentOpen, audioUrl, instagramAudioUrl, spotifyUrl, setupFrom } = parsed.data;

    /* The starting point, read before anything is written so a template or
       campaign that is not this org's (or not in this member's scope) is a 404
       and nothing more. */
    let setup: CampaignSetup | null = null;
    if (setupFrom) {
      const read = await readSetupSource(result, setupFrom);
      if (read.status === "missing") return NextResponse.json({ error: read.message }, { status: 404 });
      if (read.status === "unreadable") return NextResponse.json({ error: read.message }, { status: 422 });
      setup = read.source.setup;
    }
    /* A field the body names -- null included, which clears it -- is the
       person's choice and wins; one it leaves out comes from the source. */
    const given = <T,>(value: T | undefined, fromSetup: T | null | undefined): T | null | undefined =>
      value !== undefined ? value : fromSetup ?? undefined;
    const budget = given(parsed.data.budget, setup?.budget);
    const currency = given(parsed.data.currency, setup?.currency) ?? undefined;
    const notes = given(parsed.data.notes, setup?.notes);
    const postApprovalMode = given(parsed.data.postApprovalMode, setup?.postApprovalMode) ?? undefined;
    let clientId = parsed.data.clientId;
    if (clientId === undefined && setup?.clientId) {
      /* The source's client, only while it is still this org's: a client
         deleted since the template was saved leaves the campaign unfiled
         rather than failing the create. */
      clientId = (await findForeignRef(orgId, { clientId: setup.clientId })) ? null : setup.clientId;
    }

    // clientId and folderId arrive in the body, so they have to be proven to
    // belong to this org before they are written. Without this a caller could
    // file their campaign under another tenant's client or folder, and the next
    // render of this list would print that tenant's name back to them.
    const foreign = await findForeignRef(orgId, { clientId, folderId });
    if (foreign) {
      return NextResponse.json({ error: `${foreign === "client" ? "Client" : "Folder"} not found` }, { status: 404 });
    }

    /* Parsed before the campaign is written, so a bad link is a 400 that names
       the problem rather than a campaign created without the audio the operator
       asked for. Only parsing happens here: a short link is resolved by
       following it over the network, which must not sit inside the transaction
       opened below. */
    let audio: ResolvedAudio | null = null;
    if (audioUrl) {
      const parsedAudio = await identifyAudioLink(audioUrl);
      if (!parsedAudio.ok) {
        return NextResponse.json(
          { error: parsedAudio.reason, message: parsedAudio.message },
          { status: 400 }
        );
      }
      audio = parsedAudio.audio;
    }

    /* The Instagram audio, parsed the same way and then checked with
       Instagram, which answers 200 for an id that is no audio and publishes no
       count for original audio: either would be a card that never fills in. */
    let instagramAudio: ResolvedAudio | null = null;
    if (instagramAudioUrl) {
      const parsedInstagram = await identifyAudioLink(instagramAudioUrl);
      if (!parsedInstagram.ok) {
        return NextResponse.json({ error: parsedInstagram.reason, message: parsedInstagram.message }, { status: 400 });
      }
      if (parsedInstagram.audio.platform !== "INSTAGRAM") {
        return NextResponse.json(
          { error: "not_instagram_audio", message: "That isn't an Instagram audio link. Paste one that starts with instagram.com/reels/audio/." },
          { status: 400 }
        );
      }
      instagramAudio = parsedInstagram.audio;
    }
    /* An Instagram link in the sound field, with nothing in the Instagram one,
       is the song's Instagram audio; with something there too, the two
       Instagram links are one too many. */
    if (audio?.platform === "INSTAGRAM") {
      if (instagramAudio) {
        return NextResponse.json(
          { error: "two_instagram_audios", message: "Both links are Instagram audio. Put the TikTok sound in the first field." },
          { status: 400 }
        );
      }
      instagramAudio = audio;
      audio = null;
    }
    if (instagramAudio) {
      const checked = await checkInstagramAudio(instagramAudio.tiktokSoundId);
      if (!checked.ok) return NextResponse.json({ error: checked.reason, message: checked.message }, { status: 400 });
      if (checked.reading?.title && !instagramAudio.provisionalTitle) {
        instagramAudio = { ...instagramAudio, provisionalTitle: checked.reading.title };
      }
    }

    /* The Spotify link the same way: a bad one is a 400 that names it, before
       anything is written. */
    let spotifyTrackId: string | null = null;
    if (spotifyUrl) {
      const link = await resolveSpotifyLink(spotifyUrl);
      if (!link.ok) {
        return NextResponse.json({ error: link.reason, message: link.message }, { status: 400 });
      }
      spotifyTrackId = link.trackId;
    }

    /* Whether the song's link columns exist yet -- asked before the
       transaction, because a failed statement inside it would take the
       campaign down too. Without them the campaign is still created: an
       Instagram audio on its own goes where it always went, and only a second
       link that has nowhere to go is reported unsaved. */
    const linksReady = spotifyTrackId || instagramAudio ? await songLinksReady(orgId) : false;
    /* The same question for the rules table, for the same reason. */
    const rulesReady = setup?.rules ? await rulesTableReady() : false;

    /* One transaction, because the Song and TikTokSound rows exist only to be
       pointed at by this campaign. They used to be created first, on the global
       client; a campaign insert that then failed left both behind with nothing
       referencing them -- and a TikTokSound is a standing instruction to fetch
       a page on a schedule, so the orphan keeps costing something. */
    let instagramLinked: boolean | undefined;
    let setupWritten: SetupWritten | undefined;
    const campaign = await db.$transaction(async (tx) => {
      const songId = audio
        ? await ensureSongForAudio(tx, orgId, audio, title, { linksReady })
        : instagramAudio
          ? await ensureSongForAudio(tx, orgId, instagramAudio, title, { linksReady })
          : spotifyTrackId && linksReady
            ? await createSongForSpotifyLink(tx, orgId, title)
            : null;

      /* Both sounds: the song was found or made by its TikTok sound, and the
         Instagram audio goes in its own slot beside it. */
      if (audio && instagramAudio) {
        if (linksReady && songId) {
          await setSongSound(tx, orgId, songId, await ensureSound(tx, orgId, instagramAudio, title));
          instagramLinked = true;
        } else {
          instagramLinked = false;
        }
      }

      /* A campaign is created and started in one action, so it opens Active
         rather than in DRAFT -- which has no tab and no named status, and is
         how a new campaign used to show up as "No status". The org's own name
         for that bucket travels with it, because the named status is what the
         list renders while the bucket is only what the tabs count. */
      const bucket = status ?? CAMPAIGN_START_STATUS;
      const statusDefs = await tx.campaignStatusDef.findMany({
        where: { orgId },
        select: STATUS_DEF_SELECT,
      });

      const created = await tx.campaign.create({
      data: {
        title,
        songId,
        status: bucket,
        statusDefId: defaultStatusDefFor(bucket, statusDefs)?.id ?? null,
        campaignType: campaignType ?? "BUDGET_BASED",
        typeConfig: typeConfig ?? null,
        budget: budget || null,
        currency: currency ?? "USD",
        notes: notes ?? null,
        clientId: clientId ?? null,
        folderId: folderId ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
        paymentMode: (paymentMode ?? "SELF_MANAGED") as PaymentMode,
        paymentRelease: (paymentRelease ?? "MANUAL") as PaymentRelease,
        postApprovalMode: (postApprovalMode ?? "MANUAL") as PostApprovalMode,
        enrollmentOpen: enrollmentOpen ?? false,
        orgId,
        createdById: result.userId ?? "api",
      },
      include: {
        tags: true,
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
      },
      });

      /* The brief, rules and phases in the same transaction as the campaign:
         a campaign that came out without the setup it was started from is
         worse than no campaign. */
      if (setup) {
        setupWritten = await writeSetupExtras(tx, {
          campaignId: created.id,
          orgId,
          userId: result.userId,
          setup,
          rulesReady,
        });
      }
      return created;
    });

    /* Take the audio's first reading now rather than at the next cron. Without
       it a campaign created with a sound shows an em dash for uses -- on its own
       Performance tab and on any client link shared before 04:00 UTC -- which
       reads as a broken tracker rather than an unread one.

       In after(), because the campaign is written and the operator is owed a
       response: TikTok being slow or blocked must not hold the create open. */
    if (campaign.songId) {
      /* after() itself throws when there is no request scope to attach to, and
         scheduling a first audio reading must never cost the caller the write
         that just succeeded -- the sound is tracked either way, and the cron
         picks it up. Same reasoning as the refresh route's hand-off. */
      try {
        after(async () => {
          try {
            await primeSongAudio(orgId, campaign.songId);
          } catch (error) {
            console.error("Failed to prime campaign audio:", error);
          }
        });
      } catch (error) {
        console.error("Could not schedule the campaign's first audio reading:", error);
      }
    }

    /* Stored after the transaction, never inside it: a failed statement aborts
       a Postgres transaction, so a missing column there would have taken the
       campaign with it. "unavailable" is that column missing; the form says
       the link did not save and points at Settings. */
    let spotifyLinked: boolean | undefined;
    if (spotifyTrackId) {
      spotifyLinked =
        linksReady && campaign.songId
          ? (await applySongSpotifyLink(orgId, campaign.songId, spotifyTrackId, campaign.status)) !== "unavailable"
          : false;
    }

    // Copied while its link still draws; see lib/campaigns/thumbnailCopy.
    if (campaign.thumbnailUrl) {
      try {
        after(() => captureCampaignThumbnail(campaign.id));
      } catch (error) {
        console.error("Could not schedule the campaign picture copy:", error);
      }
    }

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "campaign.create",
      entityType: "campaign",
      entityId: campaign.id,
      entityLabel: campaign.title,
      ipAddress: getRequestIp(request),
      after: {
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        campaignType: campaign.campaignType,
        ...(setupFrom ? { setupFrom } : {}),
      },
    });

    return NextResponse.json(
      {
        ...campaign,
        ...(spotifyLinked === undefined ? {} : { spotifyLinked }),
        ...(instagramLinked === undefined ? {} : { instagramLinked }),
        /* What came along from the starting point. rules is false with rules
           in the source only when the rules table is not on this database. */
        ...(setupFrom && setupWritten ? { setupFrom: { ...setupFrom, copied: setupWritten } } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create campaign:", error);
    return NextResponse.json(
      { error: "Failed to create campaign" },
      { status: 500 }
    );
  }
}
