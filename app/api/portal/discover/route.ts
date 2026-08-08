import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { z } from "zod";
import { moneyParam, pageParam, pageSizeParam, parseQuery } from "@/lib/http/queryParams";

const portalDiscoverQuerySchema = z.object({
  search: z.string().optional(),
  page: pageParam,
  limit: pageSizeParam(),
  campaignType: z.enum(["ALL", "BUDGET_BASED", "VIEW_BASED", "OPEN_COMMUNITY", "PRIVATE_INVITE"]).optional(),
  minBudget: moneyParam.optional(),
  maxBudget: moneyParam.optional(),
  sort: z.string().default("newest"),
});

// GET /api/portal/discover — List open campaigns (marketplace gigs)
export async function GET(request: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsedQuery = parseQuery(portalDiscoverQuerySchema, request.nextUrl.searchParams);
    if (!parsedQuery.ok) return parsedQuery.response;
    const { search, page, limit, campaignType, minBudget, maxBudget, sort } = parsedQuery.data;
    const skip = (page - 1) * limit;

    const where: any = {
      enrollmentOpen: true,
      marketplaceVisibility: "GLOBAL" as const,
      status: "IN_PROGRESS" as const,
      deletedAt: null,
      ...(search && { title: { contains: search, mode: "insensitive" as const } }),
      ...(campaignType && campaignType !== "ALL" && { campaignType }),
      ...(minBudget !== undefined || maxBudget !== undefined
        ? {
            budget: {
              ...(minBudget !== undefined && { gte: minBudget }),
              ...(maxBudget !== undefined && { lte: maxBudget }),
            },
          }
        : {}),
    };

    const orderBy: any =
      sort === "budget_desc"    ? { budget: "desc" } :
      sort === "budget_asc"     ? { budget: "asc" }  :
      sort === "proposals_desc" ? { proposals: { _count: "desc" } } :
      { createdAt: "desc" };

    const [campaigns, total] = await Promise.all([
      db.campaign.findMany({
        where,
        select: {
          id: true,
          title: true,
          campaignType: true,
          typeConfig: true,
          budget: true,
          currency: true,
          thumbnailUrl: true,
          notes: true,
          enrollmentOpen: true,
          createdAt: true,
          org: { select: { id: true, name: true, logoUrl: true } },
          _count: { select: { activations: true, posts: true, proposals: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      db.campaign.count({ where }),
    ]);

    // Check which campaigns this creator already proposed to
    const proposedCampaignIds = new Set(
      (await db.campaignProposal.findMany({
        where: { creatorUserId: session.creatorUserId, campaignId: { in: campaigns.map(c => c.id) } },
        select: { campaignId: true },
      })).map(p => p.campaignId)
    );

    const enriched = campaigns.map(c => ({
      ...c,
      alreadyProposed: proposedCampaignIds.has(c.id),
    }));

    return NextResponse.json({
      campaigns: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Failed to fetch discover campaigns:", error);
    return NextResponse.json({ error: "Failed to fetch campaigns" }, { status: 500 });
  }
}
