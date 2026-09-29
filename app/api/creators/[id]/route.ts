import { NextRequest, NextResponse } from "next/server";
import { httpUrl } from "@/lib/validation/url";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { deriveCampaignCounts, deriveCreatorCampaigns } from "@/lib/creatorMetrics";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { handleProblem } from "@/lib/creators/handleCheck";

const updateCreatorSchema = z.object({
  name: z.string().optional(),
  handle: z.string().optional(),
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]).optional(),
  bio: z.string().nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  rate: z.number().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  avatarUrl: httpUrl().nullable().optional(),
  paymentInfo: z.string().nullable().optional(),
  country: z.string().trim().max(200).nullable().optional(),
  audienceCountry: z.string().trim().max(200).nullable().optional(),
  niche: z.string().trim().max(500).nullable().optional(),
});

const DETAIL_FIELDS = ["country", "audienceCountry", "niche"] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const { orgId } = result;
    const creator = await db.creator.findFirst({
      where: { id, orgId, deletedAt: null },
      include: {
        activations: {
          where: { deletedAt: null },
          include: {
            campaign: { select: { id: true, title: true, status: true, budget: true, currency: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        posts: {
          include: { campaign: { select: { id: true, title: true } } },
          orderBy: { postedAt: "desc" },
          take: 50,
        },
        // The org's tags and flags on this creator. The definitions are shared,
        // so only the name and emoji the profile actually renders come back.
        tagLinks: { select: { tag: { select: { id: true, name: true } } } },
        flagLinks: { select: { flag: { select: { id: true, name: true, emoji: true } } } },
        _count: { select: { activations: true, posts: true } },
      },
    });
    if (!creator) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Campaigns counted from posts as well as activations: activations did not
    // import from CreatorCore, so the relation count alone reads 0.
    const roster = await rosterTablesReady();
    const [campaignCounts, campaigns, profileLinks, detail, lists] = await Promise.all([
      deriveCampaignCounts([creator.id]),
      deriveCreatorCampaigns(creator.id, orgId),
      roster
        ? db.creatorProfileLink.findMany({
            where: { orgId, creatorId: creator.id },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            select: {
              id: true,
              platform: true,
              handle: true,
              url: true,
              followersCount: true,
              averageViews: true,
              isPrimary: true,
              refreshedAt: true,
              refreshError: true,
            },
          })
        : [],
      roster
        ? db.creatorDetail.findFirst({
            where: { orgId, creatorId: creator.id },
            select: { country: true, audienceCountry: true, niche: true, source: true, signedUpAt: true },
          })
        : null,
      db.creatorListItem.findMany({
        where: { creatorId: creator.id, list: { orgId } },
        orderBy: { addedAt: "desc" },
        select: { list: { select: { id: true, name: true } } },
      }),
    ]);
    return NextResponse.json({
      ...creator,
      campaignCount: campaignCounts.get(creator.id) ?? 0,
      campaigns,
      profileLinks: profileLinks.map(({ refreshError, ...l }) => ({ ...l, problem: handleProblem(l.platform, refreshError) })),
      detail,
      lists: lists.map((l) => l.list),
    });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const { orgId } = result;
    const body = await req.json();
    const parsed = updateCreatorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const existing = await db.creator.findFirst({ where: { id, orgId, deletedAt: null } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { country, audienceCountry, niche, ...fields } = parsed.data;
    const detail = Object.fromEntries(
      Object.entries({ country, audienceCountry, niche })
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, v || null]),
    ) as Partial<Record<(typeof DETAIL_FIELDS)[number], string | null>>;
    if (Object.keys(detail).length && !(await rosterTablesReady())) {
      return NextResponse.json({ error: "Country and niche can't be saved yet." }, { status: 503 });
    }
    const detailBefore = Object.keys(detail).length
      ? await db.creatorDetail.findUnique({ where: { creatorId: id }, select: { country: true, audienceCountry: true, niche: true } })
      : null;
    const creator = await db.$transaction(async (tx) => {
      const updated = await tx.creator.update({ where: { id }, data: fields });
      if (Object.keys(detail).length) {
        await tx.creatorDetail.upsert({
          where: { creatorId: id },
          create: { creatorId: id, orgId, ...detail },
          update: detail,
        });
      }
      return updated;
    });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "creator.update",
      entityType: "creator",
      entityId: creator.id,
      entityLabel: creator.name,
      ipAddress: getRequestIp(req),
      before: {
        id: existing.id,
        name: existing.name,
        handle: existing.handle,
        platform: existing.platform,
        ...(Object.keys(detail).length && { detail: detailBefore }),
      },
      after: {
        id: creator.id,
        name: creator.name,
        handle: creator.handle,
        platform: creator.platform,
        ...(Object.keys(detail).length && { detail }),
      },
    });

    return NextResponse.json(creator);
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
