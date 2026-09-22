import {
  engagementRateValue,
  fieldMetricValue,
  lastFetchNote,
  measuredFields,
  type MetricField,
} from "@/lib/metricDisplay";

export type ToolContent = { type: "text"; text: string };
export type ToolResult = {
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Every tool answers with the same envelope: the JSON as text, and the same
 * object again as structuredContent.
 *
 * The text is what an older client reads and what the model sees; structured
 * content is what a 2025-06-18 client can hand to code without re-parsing a
 * string. They are the same object, so the two can never disagree.
 */
export function toolJson(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

/**
 * A failure the caller can act on, reported inside the result rather than as a
 * JSON-RPC error: the protocol reserves protocol-level errors for calls that
 * never reached the tool, and a model that is told "campaign not found, list
 * them with list_campaigns" can recover where a transport error just ends the
 * turn. `hint` is the next step, not a restatement of the failure.
 */
export function toolFailure(message: string, hint?: string): ToolResult {
  const payload = hint ? { error: message, hint } : { error: message };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export type PageArgs = { limit: number; offset: number };

/**
 * limit/offset out of whatever the caller sent. A model that asks for 5,000
 * rows gets MAX_LIMIT and is told so in the envelope rather than silently
 * served a different number, and a negative offset is nothing rather than an
 * error the caller cannot see the cause of.
 */
export function pageArgs(args: Record<string, any>, defaultLimit = DEFAULT_LIMIT): PageArgs {
  const rawLimit = Number(args?.limit);
  const rawOffset = Number(args?.offset);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  return { limit, offset };
}

export function paged<T>(
  items: T[],
  total: number,
  page: PageArgs,
  key = "items"
): Record<string, unknown> {
  const hasMore = page.offset + items.length < total;
  return {
    [key]: items,
    total,
    count: items.length,
    offset: page.offset,
    limit: page.limit,
    hasMore,
    ...(hasMore ? { nextOffset: page.offset + items.length } : {}),
  };
}

export function round2(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Prisma Decimal, Float and null all reach JSON as a plain number or null. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export type ShapeablePost = {
  id: string;
  campaignId?: string;
  creatorId?: string;
  platform: string;
  postUrl: string;
  caption?: string | null;
  mediaType?: string | null;
  status?: string;
  postedAt: Date | string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  platformMetrics?: unknown;
  lastSyncedAt?: Date | string | null;
  trackingEnabled?: boolean;
  trackingExpiresAt?: Date | string | null;
  creator?: { id: string; name: string; handle: string; platform?: string } | null;
  campaign?: { id: string; title: string } | null;
};

const SHAPED_FIELDS: MetricField[] = ["views", "likes", "comments", "shares", "saves"];

/**
 * A post as an agent should read it: a counter the platform never gave us is
 * null, never 0.
 *
 * This is the whole reason the MCP surface cannot just return the Prisma row.
 * Post.likesCount defaults to 0 in the database, so an unfetched Instagram post
 * and a post with genuinely no likes are the same row -- and an agent asked
 * "which posts are underperforming" would answer with the ones nobody has
 * measured yet. fieldMetricValue is the same provenance test the dashboard
 * tiles use, so the two cannot disagree, and `measured` says which counters the
 * platform actually returned. When something is missing, `notMeasuredReason`
 * carries why the last read came back empty.
 */
export function shapePost(post: ShapeablePost): Record<string, unknown> {
  const metrics: Record<string, number | null> = {};
  for (const field of SHAPED_FIELDS) {
    const raw =
      field === "views" ? post.viewsCount
      : field === "likes" ? post.likesCount
      : field === "comments" ? post.commentsCount
      : field === "shares" ? post.sharesCount
      : post.savesCount;
    metrics[field] = fieldMetricValue(raw, post.lastSyncedAt ?? null, post.platformMetrics, field);
  }

  return {
    id: post.id,
    ...(post.campaignId ? { campaignId: post.campaignId } : {}),
    ...(post.campaign ? { campaign: { id: post.campaign.id, title: post.campaign.title } } : {}),
    ...(post.creatorId ? { creatorId: post.creatorId } : {}),
    ...(post.creator
      ? { creator: { id: post.creator.id, name: post.creator.name, handle: post.creator.handle } }
      : {}),
    platform: post.platform,
    postUrl: post.postUrl,
    mediaType: post.mediaType ?? null,
    status: post.status ?? null,
    postedAt: iso(post.postedAt),
    caption: post.caption ?? null,
    metrics: {
      ...metrics,
      /* Two decimals, the same as every rate this product prints. The raw
         quotient carries fifteen digits of precision the underlying counts do
         not have, and a model repeating it back reads as a claim about the
         seventh decimal of a like count. */
      engagementRatePercent: round2(
        engagementRateValue(
          post.likesCount,
          post.commentsCount,
          post.viewsCount,
          post.lastSyncedAt ?? null
        )
      ),
    },
    measured: measuredFields(post.platformMetrics),
    notMeasuredReason: lastFetchNote(post.platformMetrics),
    lastSyncedAt: iso(post.lastSyncedAt ?? null),
    tracking: {
      enabled: post.trackingEnabled ?? false,
      expiresAt: iso(post.trackingExpiresAt ?? null),
    },
  };
}

/** The select every shapePost caller needs, so no caller can forget provenance. */
export const POST_SHAPE_SELECT = {
  id: true,
  campaignId: true,
  creatorId: true,
  platform: true,
  postUrl: true,
  caption: true,
  mediaType: true,
  status: true,
  postedAt: true,
  viewsCount: true,
  likesCount: true,
  commentsCount: true,
  sharesCount: true,
  savesCount: true,
  platformMetrics: true,
  lastSyncedAt: true,
  trackingEnabled: true,
  trackingExpiresAt: true,
  creator: { select: { id: true, name: true, handle: true } },
} as const;
