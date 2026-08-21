import { z } from "zod";
import { Prisma, type CampaignStatus, type CampaignType, type Platform } from "@/lib/generated/prisma/client";

/**
 * Filters for the server-paginated list pages, defined once and read from the
 * same query string by both the page (a Server Component) and the matching
 * /api route. Two parsers drifting apart is how a filter ends up narrowing the
 * table but not the export.
 *
 * Wire format, borrowed from deal-collab: a multi-select travels comma-joined
 * in one param (`status=PENDING,IN_PROGRESS`), so a single value is just a
 * one-element list and the existing single-status links keep working. Ranges
 * travel as two params (`minFollowers`/`maxFollowers`). Everything lives in the
 * URL rather than component state, so a filtered view survives a refresh and
 * can be pasted to a colleague.
 */

export function csvParam(value: string | string[] | undefined | null): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

export function firstParam(value: string | string[] | undefined | null): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/** A comma-joined multi-select of enum members. An unknown member is a 400. */
export function csvEnumParam<T extends string>(values: readonly [T, ...T[]]) {
  return z
    .string()
    .optional()
    .transform((raw) => csvParam(raw))
    .pipe(z.array(z.enum(values)));
}

/** A date that may be absent, rejected when present and unparseable. */
export const optionalDateParam = z.coerce.date().optional();

export const optionalCountParam = z.coerce.number().int().nonnegative().optional();

/** Inclusive range on a DateTime column, dropped entirely when both ends are absent. */
function dateRange(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  return { ...(from && { gte: from }), ...(to && { lte: to }) };
}

function countRange(min?: number, max?: number) {
  if (min === undefined && max === undefined) return undefined;
  return { ...(min !== undefined && { gte: min }), ...(max !== undefined && { lte: max }) };
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

export const CAMPAIGN_STATUSES = ["DRAFT", "PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"] as const;
export const CAMPAIGN_TYPES = ["BUDGET_BASED", "VIEW_BASED", "OPEN_COMMUNITY", "PRIVATE_INVITE"] as const;

export type CampaignFilters = {
  search?: string;
  status: CampaignStatus[];
  clientIds: string[];
  campaignType: CampaignType[];
  tags: string[];
  teamMemberIds: string[];
  createdFrom?: Date;
  createdTo?: Date;
  hasCreators?: boolean;
  hasPosts?: boolean;
};

export const campaignFilterSchema = z.object({
  search: z.string().optional(),
  status: csvEnumParam(CAMPAIGN_STATUSES),
  clientIds: z
    .string()
    .optional()
    .transform((raw) => csvParam(raw)),
  campaignType: csvEnumParam(CAMPAIGN_TYPES),
  // Free-text, unlike the enum multi-selects: a tag is whatever someone typed,
  // so an unrecognised one narrows to nothing rather than being a 400.
  tags: z
    .string()
    .optional()
    .transform((raw) => csvParam(raw)),
  teamMemberIds: z
    .string()
    .optional()
    .transform((raw) => csvParam(raw)),
  createdFrom: optionalDateParam,
  createdTo: optionalDateParam,
  hasCreators: z.enum(["1"]).optional().transform((v) => (v ? true : undefined)),
  hasPosts: z.enum(["1"]).optional().transform((v) => (v ? true : undefined)),
});

/** Reads the filters off a page's resolved searchParams, tolerating anything odd. */
export function readCampaignFilters(sp: Record<string, string | string[] | undefined>): CampaignFilters {
  const parsed = campaignFilterSchema.safeParse({
    search: firstParam(sp.q ?? sp.search),
    status: firstParam(sp.status),
    clientIds: firstParam(sp.clientIds),
    campaignType: firstParam(sp.campaignType),
    tags: firstParam(sp.tags),
    teamMemberIds: firstParam(sp.teamMemberIds),
    createdFrom: firstParam(sp.createdFrom),
    createdTo: firstParam(sp.createdTo),
    hasCreators: firstParam(sp.hasCreators),
    hasPosts: firstParam(sp.hasPosts),
  });
  if (parsed.success) return parsed.data;
  // A hand-edited URL should show an unfiltered table, not a crash.
  return { status: [], clientIds: [], campaignType: [], tags: [], teamMemberIds: [] };
}

export function campaignWhere(orgId: string, f: CampaignFilters): Prisma.CampaignWhereInput {
  return {
    orgId,
    deletedAt: null,
    ...(f.status.length && { status: { in: f.status } }),
    ...(f.clientIds.length && { clientId: { in: f.clientIds } }),
    ...(f.campaignType.length && { campaignType: { in: f.campaignType } }),
    // Both are many-to-many, so several selected values widen the result set
    // (campaigns carrying ANY of these tags), matching how the other
    // multi-selects here read.
    ...(f.tags.length && { tags: { some: { tag: { in: f.tags } } } }),
    ...(f.teamMemberIds.length && { teamMembers: { some: { userId: { in: f.teamMemberIds } } } }),
    ...(dateRange(f.createdFrom, f.createdTo) && { createdAt: dateRange(f.createdFrom, f.createdTo) }),
    ...(f.hasCreators && { activations: { some: {} } }),
    ...(f.hasPosts && { posts: { some: {} } }),
    ...(f.search
      ? {
          OR: [
            { title: { contains: f.search, mode: Prisma.QueryMode.insensitive } },
            { client: { name: { contains: f.search, mode: Prisma.QueryMode.insensitive } } },
          ],
        }
      : {}),
  };
}

/** How many filters the drawer badge should show — the search box is not one. */
export function countCampaignFilters(f: CampaignFilters): number {
  return (
    (f.status.length ? 1 : 0) +
    (f.clientIds.length ? 1 : 0) +
    (f.campaignType.length ? 1 : 0) +
    (f.tags.length ? 1 : 0) +
    (f.teamMemberIds.length ? 1 : 0) +
    (f.createdFrom || f.createdTo ? 1 : 0) +
    (f.hasCreators ? 1 : 0) +
    (f.hasPosts ? 1 : 0)
  );
}

// ─── Creators ───────────────────────────────────────────────────────────────

export const PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"] as const;

export type CreatorFilters = {
  search?: string;
  platform: Platform[];
  minFollowers?: number;
  maxFollowers?: number;
  addedFrom?: Date;
  addedTo?: Date;
  hasPosts?: boolean;
};

export const creatorFilterSchema = z.object({
  search: z.string().optional(),
  platform: csvEnumParam(PLATFORMS),
  minFollowers: optionalCountParam,
  maxFollowers: optionalCountParam,
  addedFrom: optionalDateParam,
  addedTo: optionalDateParam,
  hasPosts: z.enum(["1"]).optional().transform((v) => (v ? true : undefined)),
});

export function readCreatorFilters(sp: Record<string, string | string[] | undefined>): CreatorFilters {
  const parsed = creatorFilterSchema.safeParse({
    search: firstParam(sp.q ?? sp.search),
    // "All" is what the platform tabs send for the unfiltered view.
    platform: firstParam(sp.platform) === "All" ? undefined : firstParam(sp.platform),
    minFollowers: firstParam(sp.minFollowers),
    maxFollowers: firstParam(sp.maxFollowers),
    addedFrom: firstParam(sp.addedFrom),
    addedTo: firstParam(sp.addedTo),
    hasPosts: firstParam(sp.hasPosts),
  });
  if (parsed.success) return parsed.data;
  return { platform: [] };
}

export function creatorWhere(orgId: string, f: CreatorFilters): Prisma.CreatorWhereInput {
  return {
    orgId,
    deletedAt: null,
    ...(f.platform.length && { platform: { in: f.platform } }),
    ...(countRange(f.minFollowers, f.maxFollowers) && {
      followersCount: countRange(f.minFollowers, f.maxFollowers),
    }),
    ...(dateRange(f.addedFrom, f.addedTo) && { addedAt: dateRange(f.addedFrom, f.addedTo) }),
    ...(f.hasPosts && { posts: { some: {} } }),
    ...(f.search
      ? {
          OR: [
            { name: { contains: f.search, mode: Prisma.QueryMode.insensitive } },
            { handle: { contains: f.search, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
  };
}

export function countCreatorFilters(f: CreatorFilters): number {
  return (
    (f.platform.length ? 1 : 0) +
    (f.minFollowers !== undefined || f.maxFollowers !== undefined ? 1 : 0) +
    (f.addedFrom || f.addedTo ? 1 : 0) +
    (f.hasPosts ? 1 : 0)
  );
}

/**
 * Creator columns the database can order by.
 *
 * Deliberately does NOT include avgViews or campaigns. Both are derived after
 * pagination — averageViews is 0 in the column for the whole imported roster and
 * gets measured from posts instead, and campaign counts come from posts as well
 * as activations. Ordering by them would sort the rows already on screen, which
 * looks like sorting and is not: page 2 would still hold the largest value.
 *
 * Nor followers, for a subtler reason. followersCount is `Float @default(0)`, so
 * the 1,823 creators whose count never came across the import hold 0 rather than
 * NULL — the list already renders those as blank, because an unfetched 0 is
 * unknown and not a measurement. Ascending order would therefore rank every one
 * of them as the least-followed creator in the roster, and ordering unknowns
 * last needs `NULLIF("followersCount", 0) NULLS LAST`, which Prisma's orderBy
 * cannot express. Raw SQL for one column would mean restating every filter in
 * this file by hand, so the column keeps no sort control.
 *
 * A column that cannot be ordered truthfully gets no control rather than a
 * misleading one.
 */
export const CREATOR_SORT_KEYS = ["name", "posts", "added"] as const;
export type CreatorSortKey = (typeof CREATOR_SORT_KEYS)[number];
export type CreatorSort = { key: CreatorSortKey; dir: "asc" | "desc" };

/** Newest first, which is what the list did before it was sortable. */
export const DEFAULT_CREATOR_SORT: CreatorSort = { key: "added", dir: "desc" };

export function readCreatorSort(
  sp: Record<string, string | string[] | undefined>
): CreatorSort {
  const key = firstParam(sp.sort);
  const dir = firstParam(sp.dir);
  if (!key || !(CREATOR_SORT_KEYS as readonly string[]).includes(key)) {
    return DEFAULT_CREATOR_SORT;
  }
  return { key: key as CreatorSortKey, dir: dir === "asc" ? "asc" : "desc" };
}

export function creatorOrderBy(sort: CreatorSort): Prisma.CreatorOrderByWithRelationInput[] {
  const { dir } = sort;
  // Every branch ends with id. None of these keys is unique — 1,823 of the
  // imported roster share a null follower count and plenty share a post count —
  // and Postgres gives no stable order within a tie, so with skip/take the same
  // creator can appear on two pages while another appears on none. The unique
  // tiebreaker is what makes paging through a sorted list actually complete.
  const tiebreak: Prisma.CreatorOrderByWithRelationInput = { id: "asc" };
  switch (sort.key) {
    case "name":
      return [{ name: dir }, tiebreak];
    case "posts":
      return [{ posts: { _count: dir } }, tiebreak];
    case "added":
    default:
      return [{ addedAt: dir }, tiebreak];
  }
}
