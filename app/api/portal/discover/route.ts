import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

// GET /api/portal/discover — List open campaigns (marketplace gigs)
export async function GET(request: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);
    const skip = (page - 1) * limit;

    const campaignType = searchParams.get("campaignType");
    const minBudget = parseFloat(searchParams.get("minBudget") ?? "");
    const maxBudget = parseFloat(searchParams.get("maxBudget") ?? "");
    const sort = searchParams.get("sort") ?? "newest";

    const where: any = {
      enrollmentOpen: true,
      marketplaceVisibility: "PUBLIC" as const,
      status: "IN_PROGRESS" as const,
      deletedAt: null,
      ...(search && { title: { contains: search, mode: "insensitive" as const } }),
      ...(campaignType && campaignType !== "ALL" && { campaignType }),
      ...(!isNaN(minBudget) || !isNaN(maxBudget)
        ? {
            budget: {
              ...(!isNaN(minBudget) && { gte: minBudget }),
              ...(!isNaN(maxBudget) && { lte: maxBudget }),
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
