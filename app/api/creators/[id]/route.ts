import { NextRequest, NextResponse } from "next/server";
import { httpUrl } from "@/lib/validation/url";
import { z } from "zod";
import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { deriveCampaignCounts, deriveCreatorCampaigns } from "@/lib/creatorMetrics";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { handleProblem } from "@/lib/creators/handleCheck";
import { creatorFollowersTime, figureTimeDto, linkFollowersTime } from "@/lib/creators/figureTime";
import { readThroughOwnAccount } from "@/lib/creators/agencyLookup";
import { latestTrackerReadings } from "@/lib/creators/latestReadings";
import { requirePermission } from "@/lib/authz";
import { PAYOUTS_ENABLED } from "@/lib/payouts/switch";

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
  // followersCount / averageViews are not editable: figures come from the
  // platforms, never from a person. z.object strips them, so a client that
  // still sends one gets a 200 and the stored figure is left as it was.
});

const DETAIL_FIELDS = ["country", "audienceCountry", "niche"] as const;

/* paymentInfo is where a payout would be sent. While payouts are switched off
   (lib/payouts/switch.ts) it is not read back and not accepted; what is stored
   stays. */
const paymentInfoOmit = () => ({ paymentInfo: !PAYOUTS_ENABLED });

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
      omit: paymentInfoOmit(),
      include: {
        activations: {
          where: { deletedAt: null },
          include: {
            campaign: { select: { id: true, title: true, status: true, budget: true, currency: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        posts: {
          where: NOT_REMOVED,
          include: { campaign: { select: { id: true, title: true } } },
          orderBy: { postedAt: "desc" },
          take: 50,
        },
        // The org's tags and flags on this creator. The definitions are shared,
        // so only the name and emoji the profile actually renders come back.
        tagLinks: { select: { tag: { select: { id: true, name: true } } } },
        flagLinks: { select: { flag: { select: { id: true, name: true, emoji: true } } } },
        _count: { select: { activations: true, posts: { where: NOT_REMOVED } } },
      },
    });
    if (!creator) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Campaigns counted from posts as well as activations: activations did not
    // import from CreatorCore, so the relation count alone reads 0.
    const roster = await rosterTablesReady();
    const [campaignCounts, campaigns, profileLinks, detail, lists, readings] = await Promise.all([
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
      latestTrackerReadings(orgId, [creator.id]),
    ]);
    const primaryLink = profileLinks.find((l) => l.isPrimary) ?? null;
    const followersTime = creatorFollowersTime({
      followersCount: creator.followersCount,
      primaryLink,
      latestSnapshot: readings.get(creator.id) ?? null,
    });
    const instagramReadVia = await readThroughOwnAccount(
      orgId,
      primaryLink?.platform ?? creator.platform,
      followersTime,
    );
    return NextResponse.json({
      ...creator,
      campaignCount: campaignCounts.get(creator.id) ?? 0,
      campaigns,
      /* When the headline figure was measured and by what (plan A6), decided
         here because the read that failed is a server-side fact the page is
         otherwise only given as a problem badge. */
      figureTimes: {
        followers: figureTimeDto(followersTime),
      },
      instagramReadVia,
      profileLinks: profileLinks.map(({ refreshError, ...l }) => ({
        ...l,
        problem: handleProblem(l.platform, refreshError),
        age: figureTimeDto(linkFollowersTime({ ...l, refreshError })),
      })),
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
    /* creators:create, the permission every other roster write uses (creators,
       profile-links, lists, tracking). */
    const gate = await requirePermission(req, "creators:create");
    if (!gate.ok) return gate.response;
    const result = gate.auth;
    const { id } = await params;
    const { orgId } = result;
    const body = await req.json();
    const parsed = updateCreatorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    if (!PAYOUTS_ENABLED && parsed.data.paymentInfo !== undefined) {
      return NextResponse.json(
        { error: "Payment details can't be saved while payouts are switched off." },
        { status: 400 },
      );
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
      const updated = await tx.creator.update({ where: { id }, data: fields, omit: paymentInfoOmit() });
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
