import { db } from "@/lib/db";

type ToolContent = { type: "text"; text: string };
type ToolResult = { content: ToolContent[] };
type ToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export function getMcpToolDefinitions(): ToolDef[] {
  return [
    {
      name: "list_campaigns",
      description: "List campaigns for the organization. Filter by status or search by title.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Campaign status filter (DRAFT, PENDING, IN_PROGRESS, COMPLETE, CANCELLED)" },
          search: { type: "string", description: "Search campaigns by title" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
    },
    {
      name: "list_creators",
      description: "List creators in the organization roster. Filter by platform or search by name.",
      inputSchema: {
        type: "object",
        properties: {
          search: { type: "string", description: "Search by name or handle" },
          platform: { type: "string", description: "Filter by platform (TIKTOK, INSTAGRAM, YOUTUBE, TWITTER)" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
    },
    {
      name: "get_org_kpis",
      description:
        "Get organization-level KPIs: total views, total posts, average engagement rate over the posts it could be measured on, and what completed payouts add up to. Returns null rather than 0 for a figure nothing was measured for.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "search_creators",
      description: "Search creators by name, handle, or bio. Optionally filter by platform and follower range.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query for name/handle" },
          platform: { type: "string", description: "Platform filter" },
          minFollowers: { type: "number", description: "Minimum follower count" },
          maxFollowers: { type: "number", description: "Maximum follower count" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_campaign",
      description: "Get full details for a specific campaign by ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Campaign ID" },
        },
        required: ["id"],
      },
    },
  ];
}

export async function executeMcpTool(
  orgId: string,
  toolName: string,
  args: Record<string, any>
): Promise<ToolResult> {
  switch (toolName) {
    case "list_campaigns": {
      const campaigns = await db.campaign.findMany({
        where: {
          orgId,
          deletedAt: null,
          ...(args.status && { status: args.status }),
          ...(args.search && { title: { contains: args.search, mode: "insensitive" as const } }),
        },
        select: {
          id: true,
          title: true,
          status: true,
          campaignType: true,
          budget: true,
          currency: true,
          _count: { select: { activations: true, posts: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: args.limit ?? 20,
      });
      return { content: [{ type: "text", text: JSON.stringify(campaigns) }] };
    }

    case "list_creators": {
      const creators = await db.creator.findMany({
        where: {
          orgId,
          ...(args.platform && { platform: args.platform }),
          ...(args.search && {
            OR: [
              { name: { contains: args.search, mode: "insensitive" as const } },
              { handle: { contains: args.search, mode: "insensitive" as const } },
            ],
          }),
        },
        select: {
          id: true,
          name: true,
          handle: true,
          platform: true,
          followersCount: true,
        },
        orderBy: { name: "asc" },
        take: args.limit ?? 20,
      });
      return { content: [{ type: "text", text: JSON.stringify(creators) }] };
    }

    case "get_org_kpis": {
      /*
       * The same KPIs the dashboard shows, and they have to agree with it.
       *
       * Two things were wrong here while the dashboard was being made honest,
       * because this is a second door onto the same numbers and only the first
       * one got fixed:
       *
       * avgCPM is gone. It divided every payout in the org by every view in the
       * org, so one recorded payout against a roster of 18,708 posts produced a
       * confident cost-per-mille for campaigns that had no payout at all. Both
       * of its inputs are still here, named for what they are, so a caller that
       * genuinely wants the ratio can form it and see what it rests on.
       *
       * avgEngagementRate averaged `engagementRate ?? 0` across every post,
       * including the ones never measured, which drags the figure toward zero by
       * however many are missing. It now covers only posts carrying a rate and
       * says how many that was — the same rule /api/analytics follows.
       *
       * Counting also moved into the database. This read every post row in the
       * org to add up two columns.
       */
      const [viewRow, ratedRow, payoutRow] = await Promise.all([
        db.post.aggregate({
          where: { campaign: { orgId } },
          _sum: { viewsCount: true },
          _count: { _all: true },
        }),
        db.post.aggregate({
          where: { campaign: { orgId }, engagementRate: { gt: 0 } },
          _avg: { engagementRate: true },
          _count: { _all: true },
        }),
        db.payout.aggregate({
          where: { orgId, status: "SUCCESS" },
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ]);

      const measuredPosts = ratedRow._count._all;
      const recordedPayouts = payoutRow._count._all;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            totalViews: viewRow._sum.viewsCount ?? 0,
            totalPosts: viewRow._count._all,
            // null, not 0: no rate was measured, which is not the same as an
            // engagement rate of zero.
            avgEngagementRate:
              measuredPosts > 0
                ? Math.round((ratedRow._avg.engagementRate ?? 0) * 100) / 100
                : null,
            engagementSample: measuredPosts,
            // Named for its provenance. This is what completed payouts add up
            // to, which is only the campaign spend an org has actually recorded
            // here — not a budget, and not every campaign.
            spendFromRecordedPayouts: recordedPayouts > 0 ? payoutRow._sum.amount ?? 0 : null,
            recordedPayouts,
          }),
        }],
      };
    }

    case "search_creators": {
      if (!args.query) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "query is required" }) }] };
      }
      const followersFilter: Record<string, number> = {};
      if (args.minFollowers !== undefined) followersFilter.gte = args.minFollowers;
      if (args.maxFollowers !== undefined) followersFilter.lte = args.maxFollowers;

      const creators = await db.creator.findMany({
        where: {
          orgId,
          ...(args.platform && { platform: args.platform }),
          ...(Object.keys(followersFilter).length > 0 && { followersCount: followersFilter }),
          OR: [
            { name: { contains: args.query, mode: "insensitive" as const } },
            { handle: { contains: args.query, mode: "insensitive" as const } },
          ],
        },
        select: {
          id: true,
          name: true,
          handle: true,
          platform: true,
          followersCount: true,
          bio: true,
        },
        take: 20,
      });
      return { content: [{ type: "text", text: JSON.stringify(creators) }] };
    }

    case "get_campaign": {
      if (!args.id) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "id is required" }) }] };
      }
      const campaign = await db.campaign.findFirst({
        where: { id: args.id, orgId, deletedAt: null },
        include: {
          tags: true,
          _count: { select: { activations: true, posts: true } },
        },
      });
      if (!campaign) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Campaign not found" }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(campaign) }] };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
