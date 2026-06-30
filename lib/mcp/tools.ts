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
      description: "Get organization-level KPIs: total views, spend, avg CPM, avg engagement rate, and payout summary.",
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
      const [posts, payouts] = await Promise.all([
        db.post.findMany({
          where: { campaign: { orgId } },
          select: { viewsCount: true, engagementRate: true },
        }),
        db.payout.findMany({
          where: { orgId, status: "SUCCESS" },
          select: { amount: true },
        }),
      ]);

      const totalViews = posts.reduce((s, p) => s + (p.viewsCount ?? 0), 0);
      const totalSpend = payouts.reduce((s, p) => s + p.amount, 0);
      const avgCPM = totalViews > 0 ? Math.round((totalSpend / totalViews) * 1000 * 100) / 100 : 0;
      const avgEngagementRate =
        posts.length > 0
          ? Math.round((posts.reduce((s, p) => s + (p.engagementRate ?? 0), 0) / posts.length) * 100) / 100
          : 0;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            totalViews,
            totalSpend,
            avgCPM,
            avgEngagementRate,
            totalPosts: posts.length,
            totalPayouts: payouts.length,
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
