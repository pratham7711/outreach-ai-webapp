import { db } from "@/lib/db";
import {
  MEASURED_POSTS_FILTER,
  rollupEngagementFromTotals,
} from "@/lib/metricDisplay";
import { getRefreshCooldown, refreshCampaign } from "@/lib/sync/refreshCampaign";
import {
  iso,
  num,
  pageArgs,
  paged,
  POST_SHAPE_SELECT,
  shapePost,
  toolFailure,
  toolJson,
  type ToolResult,
} from "@/lib/mcp/serialize";

export type ToolAnnotations = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations: ToolAnnotations;
};

type Handler = (orgId: string, args: Record<string, any>) => Promise<ToolResult>;
type Tool = { def: ToolDef; run: Handler };

/** Reads. Nothing they do can be observed from outside this product. */
const READ: ToolAnnotations = {
  title: "",
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function read(title: string): ToolAnnotations {
  return { ...READ, title };
}

const PAGE_PROPS = {
  limit: { type: "number", description: "Max rows to return, 1-100 (default 20)" },
  offset: { type: "number", description: "Rows to skip, for paging through `total` (default 0)" },
};

/* One sentence every list tool repeats, because a model that reads it once per
   tool description does not have to infer the convention from the data -- and
   inferring it wrong is exactly the failure this product spent months removing
   from its own screens. */
const NULL_NOTE =
  "A counter the platform never returned is null, never 0; `measured` lists the counters that were actually read.";

const PLATFORM_ENUM = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"];

async function campaignInOrg(orgId: string, campaignId: string) {
  if (!campaignId) return null;
  return db.campaign.findFirst({
    where: { id: campaignId, orgId, deletedAt: null },
    select: { id: true, title: true, status: true, campaignType: true, budget: true, currency: true },
  });
}

const TOOLS: Tool[] = [
  {
    def: {
      name: "list_campaigns",
      description:
        "List campaigns in the organization, newest activity first. Filter by status or search by title. Returns a page: `campaigns`, plus `total`, `hasMore` and `nextOffset` for paging.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Campaign status (DRAFT, PENDING, IN_PROGRESS, COMPLETE, CANCELLED)",
          },
          search: { type: "string", description: "Case-insensitive substring of the title" },
          ...PAGE_PROPS,
        },
      },
      annotations: read("List campaigns"),
    },
    run: async (orgId, args) => {
      const page = pageArgs(args);
      const where = {
        orgId,
        deletedAt: null,
        ...(args.status && { status: args.status }),
        ...(args.search && { title: { contains: args.search, mode: "insensitive" as const } }),
      };
      const [campaigns, total] = await Promise.all([
        db.campaign.findMany({
          where,
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
          take: page.limit,
          skip: page.offset,
        }),
        db.campaign.count({ where }),
      ]);
      return toolJson(paged(campaigns, total, page, "campaigns"));
    },
  },

  {
    def: {
      name: "get_campaign",
      description: "Get one campaign's full record by id, including its tags and its post and activation counts.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Campaign ID" } },
        required: ["id"],
      },
      annotations: read("Get campaign"),
    },
    run: async (orgId, args) => {
      if (!args.id) return toolFailure("id is required");
      const campaign = await db.campaign.findFirst({
        where: { id: args.id, orgId, deletedAt: null },
        include: { tags: true, _count: { select: { activations: true, posts: true } } },
      });
      if (!campaign) {
        return toolFailure("Campaign not found", "Call list_campaigns to see the ids this key can read.");
      }
      return toolJson(campaign as unknown as Record<string, unknown>);
    },
  },

  {
    def: {
      name: "get_campaign_performance",
      description:
        `The campaign's measured performance: totals, a per-platform split, its best posts by views, and how much of it has been measured at all. Same definitions as the Performance tab and the client report, so the three cannot disagree. ${NULL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Campaign ID" },
          topPosts: { type: "number", description: "How many top posts to include, 0-25 (default 5)" },
        },
        required: ["id"],
      },
      annotations: read("Campaign performance"),
    },
    run: async (orgId, args) => {
      const campaign = await campaignInOrg(orgId, args.id);
      if (!campaign) {
        return toolFailure("Campaign not found", "Call list_campaigns to see the ids this key can read.");
      }

      const topCount = Math.min(Math.max(Number(args.topPosts ?? 5) || 0, 0), 25);
      const scope = { campaignId: campaign.id };

      const [allRow, measuredRow, byPlatform, topPosts, creators, range] = await Promise.all([
        db.post.aggregate({ where: scope, _sum: { viewsCount: true }, _count: { _all: true } }),
        db.post.aggregate({
          where: { ...scope, ...MEASURED_POSTS_FILTER },
          _sum: {
            viewsCount: true,
            likesCount: true,
            commentsCount: true,
            sharesCount: true,
            savesCount: true,
          },
          _count: { _all: true },
        }),
        db.post.groupBy({
          by: ["platform"],
          where: scope,
          _sum: { viewsCount: true },
          _count: { _all: true },
        }),
        topCount === 0
          ? Promise.resolve([])
          : db.post.findMany({
              where: scope,
              select: POST_SHAPE_SELECT,
              orderBy: { viewsCount: "desc" },
              take: topCount,
            }),
        db.post.groupBy({ by: ["creatorId"], where: scope, _count: { _all: true } }),
        db.post.aggregate({ where: scope, _min: { postedAt: true }, _max: { postedAt: true } }),
      ]);

      const measuredPosts = measuredRow._count._all;
      const engagement = rollupEngagementFromTotals({
        measuredPosts,
        viewsCount: measuredRow._sum.viewsCount,
        likesCount: measuredRow._sum.likesCount,
        commentsCount: measuredRow._sum.commentsCount,
        sharesCount: measuredRow._sum.sharesCount,
        savesCount: measuredRow._sum.savesCount,
      });

      return toolJson({
        campaign,
        posts: {
          total: allRow._count._all,
          /* Not a quality score: it is how much of this campaign the numbers
             below actually rest on. A campaign with 40 posts and 6 measured has
             an engagement rate, and the caller has to be able to see that it is
             a rate over six of them. */
          measured: measuredPosts,
          firstPostedAt: iso(range._min.postedAt),
          lastPostedAt: iso(range._max.postedAt),
        },
        totals: {
          views: num(allRow._sum.viewsCount) ?? 0,
          measuredViews: engagement.measuredViews,
          likes: measuredPosts > 0 ? num(measuredRow._sum.likesCount) : null,
          comments: measuredPosts > 0 ? num(measuredRow._sum.commentsCount) : null,
          shares: measuredPosts > 0 ? num(measuredRow._sum.sharesCount) : null,
          saves: measuredPosts > 0 ? num(measuredRow._sum.savesCount) : null,
          engagements: engagement.engagements,
          engagementRatePercent:
            engagement.rate === null ? null : Math.round(engagement.rate * 100 * 100) / 100,
        },
        creators: creators.length,
        byPlatform: byPlatform.map((row: any) => ({
          platform: row.platform,
          posts: row._count._all,
          views: num(row._sum.viewsCount) ?? 0,
        })),
        topPosts: (topPosts as any[]).map(shapePost),
      });
    },
  },

  {
    def: {
      name: "list_posts",
      description:
        `List posts with their measured metrics. Filter by campaign, creator, platform or status, and sort by views, engagement or date. This is the tool for "which posts did best", "what has this creator published" and "what has not been measured yet". ${NULL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          campaignId: { type: "string", description: "Only posts on this campaign" },
          creatorId: { type: "string", description: "Only posts by this creator" },
          platform: { type: "string", description: `One of ${PLATFORM_ENUM.join(", ")}` },
          status: { type: "string", description: "PENDING_REVIEW, APPROVED or REJECTED" },
          postedAfter: { type: "string", description: "ISO date; only posts published on or after it" },
          postedBefore: { type: "string", description: "ISO date; only posts published before it" },
          measuredOnly: {
            type: "boolean",
            description: "Only posts a platform read has actually returned counters for",
          },
          sort: {
            type: "string",
            description: "views (default), postedAt, engagementRate, lastSyncedAt",
          },
          order: { type: "string", description: "desc (default) or asc" },
          includeCaption: { type: "boolean", description: "Include each post's caption (default false)" },
          ...PAGE_PROPS,
        },
      },
      annotations: read("List posts"),
    },
    run: async (orgId, args) => {
      const page = pageArgs(args);

      if (args.campaignId) {
        const campaign = await campaignInOrg(orgId, args.campaignId);
        if (!campaign) {
          return toolFailure("Campaign not found", "Call list_campaigns to see the ids this key can read.");
        }
      }

      const postedAt: Record<string, Date> = {};
      if (args.postedAfter) {
        const d = new Date(args.postedAfter);
        if (Number.isNaN(d.getTime())) return toolFailure("postedAfter is not a date", "Use ISO 8601, e.g. 2026-09-01.");
        postedAt.gte = d;
      }
      if (args.postedBefore) {
        const d = new Date(args.postedBefore);
        if (Number.isNaN(d.getTime())) return toolFailure("postedBefore is not a date", "Use ISO 8601, e.g. 2026-09-30.");
        postedAt.lt = d;
      }

      /* Tenancy rides on the campaign relation, because Post has no orgId of
         its own. Every filter below narrows this; none replaces it. */
      const where: Record<string, any> = {
        campaign: { orgId, deletedAt: null },
        ...(args.campaignId && { campaignId: args.campaignId }),
        ...(args.creatorId && { creatorId: args.creatorId }),
        ...(args.platform && { platform: args.platform }),
        ...(args.status && { status: args.status }),
        ...(Object.keys(postedAt).length > 0 && { postedAt }),
        ...(args.measuredOnly === true ? MEASURED_POSTS_FILTER : {}),
      };

      const sortField =
        args.sort === "postedAt" ? "postedAt"
        : args.sort === "engagementRate" ? "engagementRate"
        : args.sort === "lastSyncedAt" ? "lastSyncedAt"
        : "viewsCount";
      const direction = args.order === "asc" ? "asc" : "desc";

      const [posts, total] = await Promise.all([
        db.post.findMany({
          where,
          select: {
            ...POST_SHAPE_SELECT,
            campaign: { select: { id: true, title: true } },
          },
          orderBy: { [sortField]: direction },
          take: page.limit,
          skip: page.offset,
        }),
        db.post.count({ where }),
      ]);

      const rows = (posts as any[]).map((post) => {
        const shaped = shapePost(post);
        if (args.includeCaption !== true) delete (shaped as any).caption;
        return shaped;
      });

      return toolJson(paged(rows, total, page, "posts"));
    },
  },

  {
    def: {
      name: "get_post",
      description:
        `One post, by id or by its URL, with every counter this product holds and the provenance of each. Use it when list_posts showed a post that needs explaining. ${NULL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Post ID" },
          postUrl: { type: "string", description: "The post's URL, as an alternative to id" },
        },
      },
      annotations: read("Get post"),
    },
    run: async (orgId, args) => {
      if (!args.id && !args.postUrl) return toolFailure("Pass either id or postUrl");
      const post = await db.post.findFirst({
        where: {
          campaign: { orgId, deletedAt: null },
          ...(args.id ? { id: args.id } : { postUrl: args.postUrl }),
        },
        select: {
          ...POST_SHAPE_SELECT,
          campaign: { select: { id: true, title: true } },
          platformPostId: true,
          thumbnailUrl: true,
          syncFailCount: true,
          syncDisabledAt: true,
          createdAt: true,
        },
      });
      if (!post) {
        return toolFailure("Post not found", "Call list_posts for the posts this key can read.");
      }
      const p = post as any;
      return toolJson({
        ...shapePost(p),
        caption: p.caption ?? null,
        platformPostId: p.platformPostId,
        thumbnailUrl: p.thumbnailUrl,
        addedAt: iso(p.createdAt),
        sync: {
          failures: p.syncFailCount,
          disabledAt: iso(p.syncDisabledAt),
        },
      });
    },
  },

  {
    def: {
      name: "get_post_timeseries",
      description:
        "A post's metric history, oldest first, from the snapshots taken each time it was read. Answers how a post grew and when it stopped. Returns nothing but an empty series for a post that has only ever been read once.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Post ID" },
          limit: { type: "number", description: "Max snapshots, 1-100 (default 50, newest kept)" },
        },
        required: ["id"],
      },
      annotations: read("Post history"),
    },
    run: async (orgId, args) => {
      if (!args.id) return toolFailure("id is required");
      const post = await db.post.findFirst({
        where: { id: args.id, campaign: { orgId, deletedAt: null } },
        select: { id: true, postUrl: true, platform: true, viewsCount: true, lastSyncedAt: true },
      });
      if (!post) {
        return toolFailure("Post not found", "Call list_posts for the posts this key can read.");
      }

      const page = pageArgs(args, 50);
      const rows = await db.postMetricSnapshot.findMany({
        where: { postId: post.id },
        select: {
          recordedAt: true,
          viewsCount: true,
          likesCount: true,
          commentsCount: true,
          sharesCount: true,
          savesCount: true,
          syncSource: true,
          isFinalSnapshot: true,
        },
        orderBy: { recordedAt: "desc" },
        take: page.limit,
      });

      const series = (rows as any[])
        .map((row) => ({
          at: iso(row.recordedAt),
          views: num(row.viewsCount),
          likes: num(row.likesCount),
          comments: num(row.commentsCount),
          shares: num(row.sharesCount),
          saves: num(row.savesCount),
          source: row.syncSource ?? null,
          final: row.isFinalSnapshot,
        }))
        .reverse();

      const first = series[0];
      const last = series[series.length - 1];
      return toolJson({
        postId: post.id,
        postUrl: post.postUrl,
        platform: post.platform,
        snapshots: series.length,
        /* Only over the window returned. A caller that asked for 10 of 300
           snapshots is told the growth across those 10, which is why the window
           is named rather than the whole life of the post implied. */
        growth:
          series.length < 2 || first?.views == null || last?.views == null
            ? null
            : {
                fromAt: first.at,
                toAt: last.at,
                viewsGained: last.views - first.views,
              },
        series,
      });
    },
  },

  {
    def: {
      name: "list_creators",
      description:
        "List creators on the organization's roster, by name. Filter by platform or search name and handle. Returns a page: `creators`, plus `total`, `hasMore` and `nextOffset`.",
      inputSchema: {
        type: "object",
        properties: {
          search: { type: "string", description: "Case-insensitive substring of name or handle" },
          platform: { type: "string", description: `One of ${PLATFORM_ENUM.join(", ")}` },
          ...PAGE_PROPS,
        },
      },
      annotations: read("List creators"),
    },
    run: async (orgId, args) => {
      const page = pageArgs(args);
      const where = {
        orgId,
        deletedAt: null,
        ...(args.platform && { platform: args.platform }),
        ...(args.search && {
          OR: [
            { name: { contains: args.search, mode: "insensitive" as const } },
            { handle: { contains: args.search, mode: "insensitive" as const } },
          ],
        }),
      };
      const [creators, total] = await Promise.all([
        db.creator.findMany({
          where,
          select: { id: true, name: true, handle: true, platform: true, followersCount: true },
          orderBy: { name: "asc" },
          take: page.limit,
          skip: page.offset,
        }),
        db.creator.count({ where }),
      ]);
      return toolJson(paged(creators, total, page, "creators"));
    },
  },

  {
    def: {
      name: "search_creators",
      description:
        "Search the roster by name or handle, narrowed by platform and follower range. Use list_creators to page through everyone; use this when looking for someone in particular.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name or handle fragment" },
          platform: { type: "string", description: `One of ${PLATFORM_ENUM.join(", ")}` },
          minFollowers: { type: "number", description: "Minimum follower count" },
          maxFollowers: { type: "number", description: "Maximum follower count" },
          ...PAGE_PROPS,
        },
        required: ["query"],
      },
      annotations: read("Search creators"),
    },
    run: async (orgId, args) => {
      if (!args.query) return toolFailure("query is required");
      const page = pageArgs(args);
      const followers: Record<string, number> = {};
      if (args.minFollowers !== undefined) followers.gte = args.minFollowers;
      if (args.maxFollowers !== undefined) followers.lte = args.maxFollowers;

      const where = {
        orgId,
        deletedAt: null,
        ...(args.platform && { platform: args.platform }),
        ...(Object.keys(followers).length > 0 && { followersCount: followers }),
        OR: [
          { name: { contains: args.query, mode: "insensitive" as const } },
          { handle: { contains: args.query, mode: "insensitive" as const } },
        ],
      };
      const [creators, total] = await Promise.all([
        db.creator.findMany({
          where,
          select: {
            id: true,
            name: true,
            handle: true,
            platform: true,
            followersCount: true,
            bio: true,
          },
          take: page.limit,
          skip: page.offset,
        }),
        db.creator.count({ where }),
      ]);
      return toolJson(paged(creators, total, page, "creators"));
    },
  },

  {
    def: {
      name: "get_creator_performance",
      description:
        `One creator's record and what their posts have done: followers, linked accounts, post and view totals, engagement rate over the posts that were measured, and their best posts. Optionally narrowed to a single campaign. ${NULL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Creator ID" },
          campaignId: { type: "string", description: "Only count posts on this campaign" },
          topPosts: { type: "number", description: "How many top posts to include, 0-25 (default 5)" },
        },
        required: ["id"],
      },
      annotations: read("Creator performance"),
    },
    run: async (orgId, args) => {
      if (!args.id) return toolFailure("id is required");
      const creator = await db.creator.findFirst({
        where: { id: args.id, orgId, deletedAt: null },
        select: {
          id: true,
          name: true,
          handle: true,
          platform: true,
          followersCount: true,
          averageViews: true,
          bio: true,
          contactEmail: true,
          rate: true,
          addedAt: true,
          socialAccounts: { select: { platform: true, handle: true, followersCount: true } },
        },
      });
      if (!creator) {
        return toolFailure("Creator not found", "Call list_creators or search_creators for ids this key can read.");
      }

      const topCount = Math.min(Math.max(Number(args.topPosts ?? 5) || 0, 0), 25);
      const scope: Record<string, any> = {
        creatorId: creator.id,
        campaign: { orgId, deletedAt: null },
        ...(args.campaignId && { campaignId: args.campaignId }),
      };

      const [allRow, measuredRow, campaigns, topPosts] = await Promise.all([
        db.post.aggregate({ where: scope, _sum: { viewsCount: true }, _count: { _all: true } }),
        db.post.aggregate({
          where: { ...scope, ...MEASURED_POSTS_FILTER },
          _sum: {
            viewsCount: true,
            likesCount: true,
            commentsCount: true,
            sharesCount: true,
            savesCount: true,
          },
          _count: { _all: true },
        }),
        db.post.groupBy({ by: ["campaignId"], where: scope, _count: { _all: true } }),
        topCount === 0
          ? Promise.resolve([])
          : db.post.findMany({
              where: scope,
              select: { ...POST_SHAPE_SELECT, campaign: { select: { id: true, title: true } } },
              orderBy: { viewsCount: "desc" },
              take: topCount,
            }),
      ]);

      const measuredPosts = measuredRow._count._all;
      const engagement = rollupEngagementFromTotals({
        measuredPosts,
        viewsCount: measuredRow._sum.viewsCount,
        likesCount: measuredRow._sum.likesCount,
        commentsCount: measuredRow._sum.commentsCount,
        sharesCount: measuredRow._sum.sharesCount,
        savesCount: measuredRow._sum.savesCount,
      });

      return toolJson({
        creator: { ...creator, addedAt: iso(creator.addedAt) },
        scopedToCampaign: args.campaignId ?? null,
        posts: { total: allRow._count._all, measured: measuredPosts, campaigns: campaigns.length },
        totals: {
          views: num(allRow._sum.viewsCount) ?? 0,
          measuredViews: engagement.measuredViews,
          engagements: engagement.engagements,
          engagementRatePercent:
            engagement.rate === null ? null : Math.round(engagement.rate * 100 * 100) / 100,
        },
        topPosts: (topPosts as any[]).map(shapePost),
      });
    },
  },

  {
    def: {
      name: "list_activations",
      description:
        "List activations: the creators booked onto a campaign and where each one has got to (awaiting draft, posted, and so on), with the deliverable due date and the posts filed against it. This is the delivery view, not the metrics view.",
      inputSchema: {
        type: "object",
        properties: {
          campaignId: { type: "string", description: "Only activations on this campaign" },
          creatorId: { type: "string", description: "Only activations for this creator" },
          status: {
            type: "string",
            description: "Activation status, e.g. AWAITING_DRAFT, POSTED",
          },
          overdue: {
            type: "boolean",
            description: "Only activations whose deliverable due date has passed and which have no post yet",
          },
          ...PAGE_PROPS,
        },
      },
      annotations: read("List activations"),
    },
    run: async (orgId, args) => {
      const page = pageArgs(args);
      const where: Record<string, any> = {
        deletedAt: null,
        campaign: { orgId, deletedAt: null },
        ...(args.campaignId && { campaignId: args.campaignId }),
        ...(args.creatorId && { creatorId: args.creatorId }),
        ...(args.status && { status: args.status }),
        ...(args.overdue === true && {
          deliverableDueDate: { lt: new Date() },
          posts: { none: {} },
        }),
      };

      const [rows, total] = await Promise.all([
        db.activation.findMany({
          where,
          select: {
            id: true,
            status: true,
            deliverableDueDate: true,
            postedUrl: true,
            draftUrl: true,
            draftSubmittedAt: true,
            createdAt: true,
            campaign: { select: { id: true, title: true } },
            creator: { select: { id: true, name: true, handle: true, platform: true } },
            _count: { select: { posts: true, deliverables: true } },
          },
          orderBy: [{ deliverableDueDate: "asc" }, { createdAt: "desc" }],
          take: page.limit,
          skip: page.offset,
        }),
        db.activation.count({ where }),
      ]);

      const activations = (rows as any[]).map((row) => ({
        id: row.id,
        status: row.status,
        campaign: row.campaign,
        creator: row.creator,
        deliverableDueDate: iso(row.deliverableDueDate),
        draft: { url: row.draftUrl ?? null, submittedAt: iso(row.draftSubmittedAt) },
        postedUrl: row.postedUrl ?? null,
        posts: row._count.posts,
        deliverables: row._count.deliverables,
        bookedAt: iso(row.createdAt),
      }));

      return toolJson(paged(activations, total, page, "activations"));
    },
  },

  {
    def: {
      name: "list_payouts",
      description:
        "List payouts recorded in this product, with totals for the selection. This is money this org has recorded here, which is not necessarily everything it has paid.",
      inputSchema: {
        type: "object",
        properties: {
          campaignId: { type: "string", description: "Only payouts against this campaign" },
          creatorId: { type: "string", description: "Only payouts to this creator" },
          status: { type: "string", description: "PENDING, PROCESSING, SUCCESS or FAILED" },
          ...PAGE_PROPS,
        },
      },
      annotations: read("List payouts"),
    },
    run: async (orgId, args) => {
      const page = pageArgs(args);
      const where: Record<string, any> = {
        orgId,
        ...(args.campaignId && { campaignId: args.campaignId }),
        ...(args.creatorId && { creatorId: args.creatorId }),
        ...(args.status && { status: args.status }),
      };

      const [rows, total, sums] = await Promise.all([
        db.payout.findMany({
          where,
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            paymentMethod: true,
            initiatedAt: true,
            completedAt: true,
            failureReason: true,
            campaign: { select: { id: true, title: true } },
            creator: { select: { id: true, name: true, handle: true } },
          },
          orderBy: { initiatedAt: "desc" },
          take: page.limit,
          skip: page.offset,
        }),
        db.payout.count({ where }),
        db.payout.groupBy({ by: ["status", "currency"], where, _sum: { amount: true }, _count: { _all: true } }),
      ]);

      const payouts = (rows as any[]).map((row) => ({
        id: row.id,
        amount: num(row.amount),
        currency: row.currency,
        status: row.status,
        paymentMethod: row.paymentMethod,
        campaign: row.campaign,
        creator: row.creator,
        initiatedAt: iso(row.initiatedAt),
        completedAt: iso(row.completedAt),
        failureReason: row.failureReason ?? null,
      }));

      return toolJson({
        ...paged(payouts, total, page, "payouts"),
        /* Per status AND per currency: adding 500 USD to 500 INR would be a
           number no one could act on, and this product has multi-currency orgs. */
        totalsByStatus: (sums as any[]).map((row) => ({
          status: row.status,
          currency: row.currency,
          count: row._count._all,
          amount: num(row._sum.amount),
        })),
      });
    },
  },

  {
    def: {
      name: "get_org_kpis",
      description:
        "Organization-level KPIs: total views, total posts, average engagement rate over the posts it could be measured on, and what completed payouts add up to. Returns null rather than 0 for a figure nothing was measured for.",
      inputSchema: { type: "object", properties: {} },
      annotations: read("Organization KPIs"),
    },
    run: async (orgId) => {
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
       * however many are missing. It is now rollupEngagement -- the product's one
       * definition, (likes + comments + shares + saves) over the views of the
       * posts we actually measured -- and says how many that was. An agent
       * reading this over MCP and a brand reading the client report have to be
       * told the same number.
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
          where: { campaign: { orgId }, ...MEASURED_POSTS_FILTER },
          _sum: {
            viewsCount: true,
            likesCount: true,
            commentsCount: true,
            sharesCount: true,
            savesCount: true,
          },
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
      const engagement = rollupEngagementFromTotals({
        measuredPosts,
        viewsCount: ratedRow._sum.viewsCount,
        likesCount: ratedRow._sum.likesCount,
        commentsCount: ratedRow._sum.commentsCount,
        sharesCount: ratedRow._sum.sharesCount,
        savesCount: ratedRow._sum.savesCount,
      });

      return toolJson({
        totalViews: viewRow._sum.viewsCount ?? 0,
        totalPosts: viewRow._count._all,
        // null, not 0: no rate was measured, which is not the same as an
        // engagement rate of zero.
        // A percentage, matching the dashboard tile: rollupEngagement
        // returns a fraction and the x100 lives at the display boundary.
        avgEngagementRate:
          engagement.rate === null ? null : Math.round(engagement.rate * 100 * 100) / 100,
        engagementSample: measuredPosts,
        // Named for its provenance. This is what completed payouts add up
        // to, which is only the campaign spend an org has actually recorded
        // here -- not a budget, and not every campaign.
        spendFromRecordedPayouts: recordedPayouts > 0 ? payoutRow._sum.amount ?? 0 : null,
        recordedPayouts,
      });
    },
  },

  {
    def: {
      name: "get_refresh_status",
      description:
        "Check when a campaign's posts were last refreshed from their platforms, whether a refresh is running right now, and how long until it may be refreshed again. Call this before refresh_campaign to avoid a wasted attempt.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Campaign ID" } },
        required: ["id"],
      },
      annotations: read("Refresh status"),
    },
    run: async (orgId, args) => {
      const state = await getRefreshCooldown(orgId, args.id);
      if (!state) {
        return toolFailure("Campaign not found", "Call list_campaigns to see the ids this key can read.");
      }
      return toolJson(state as unknown as Record<string, unknown>);
    },
  },

  {
    def: {
      name: "refresh_campaign",
      description:
        "Re-fetch view, like, comment and share counts for every post on a campaign from TikTok, Instagram and YouTube. Rate limited to once every 30 minutes per campaign; a call inside that window is refused and tells you how long is left. Takes minutes on a large campaign. Platforms challenge a large share of requests, so the result reports why posts did not update as well as how many did.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Campaign ID" } },
        required: ["id"],
      },
      annotations: {
        title: "Refresh campaign metrics",
        /* Not read-only: it spends the campaign's platform allowance, and the
           person clicking Refresh Data shares that allowance. Nothing this
           product holds is destroyed by it, and calling it twice inside the
           window changes nothing, hence the other three hints. */
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    run: async (orgId, args) => {
      /* The same call the Refresh Data button makes, under the same gate. The
         limit is enforced inside refreshCampaign rather than here, so an agent
         cannot spend a campaign's allowance out from under the person clicking
         the button -- the platform being rationed does not distinguish them. */
      const outcome = await refreshCampaign({ orgId, campaignId: args.id });

      if (!outcome.ok && outcome.reason === "not-found") {
        return toolFailure("Campaign not found", "Call list_campaigns to see the ids this key can read.");
      }
      if (!outcome.ok && outcome.reason === "cooldown") {
        return toolJson({
          refreshed: false,
          error: outcome.message,
          retryAfterSeconds: outcome.state.retryAfterSeconds,
          nextRefreshAt: outcome.state.nextRefreshAt,
          lastRefreshAt: outcome.state.lastRefreshAt,
        });
      }
      if (!outcome.ok) return toolFailure("Refresh failed");
      return toolJson({ refreshed: true, ...outcome.result });
    },
  },
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.def.name, tool]));

export function getMcpToolDefinitions(): ToolDef[] {
  return TOOLS.map((tool) => tool.def);
}

export async function executeMcpTool(
  orgId: string,
  toolName: string,
  args: Record<string, any>
): Promise<ToolResult> {
  const tool = BY_NAME.get(toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  return tool.run(orgId, args ?? {});
}
