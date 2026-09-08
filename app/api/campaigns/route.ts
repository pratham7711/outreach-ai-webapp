import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findForeignRef } from "@/lib/tenantRefs";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import { pageParam, pageSizeParam, parseQuery } from "@/lib/http/queryParams";
import { ensureSongForAudio, identifyAudioLink, type ResolvedAudio } from "@/lib/campaigns/audioLink";
import { CAMPAIGN_STATUSES, CAMPAIGN_TYPES, campaignFilterSchema, campaignWhere } from "@/lib/listFilters";
import type { PaymentMode, PaymentRelease, PostApprovalMode } from "@/lib/generated/prisma/client";

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
  budget: z.number().positive().nullable().optional(),
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
     Song -> TikTokSound pair a campaign points at; the client never sends ids. */
  audioUrl: z.string().trim().min(1).nullable().optional(),
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

    const where = campaignWhere(orgId, filters);

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
            select: { activations: true, posts: true },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit,
      }),
      db.campaign.count({ where }),
    ]);

    return NextResponse.json({
      campaigns,
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

    const { title, status, campaignType, typeConfig, budget, currency, notes, clientId, folderId, thumbnailUrl, paymentMode, paymentRelease, postApprovalMode, enrollmentOpen, audioUrl } = parsed.data;

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

    /* One transaction, because the Song and TikTokSound rows exist only to be
       pointed at by this campaign. They used to be created first, on the global
       client; a campaign insert that then failed left both behind with nothing
       referencing them -- and a TikTokSound is a standing instruction to fetch
       a page on a schedule, so the orphan keeps costing something. */
    const campaign = await db.$transaction(async (tx) => {
      const songId = audio ? await ensureSongForAudio(tx, orgId, audio, title) : null;
      return tx.campaign.create({
      data: {
        title,
        songId,
        status: status ?? "DRAFT",
        campaignType: campaignType ?? "BUDGET_BASED",
        typeConfig: typeConfig ?? null,
        budget: budget ?? null,
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
          select: { activations: true, posts: true },
        },
      },
      });
    });

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
      },
    });

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    console.error("Failed to create campaign:", error);
    return NextResponse.json(
      { error: "Failed to create campaign" },
      { status: 500 }
    );
  }
}
