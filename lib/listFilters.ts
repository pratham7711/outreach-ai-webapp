import { z } from "zod";
import { csvParam, firstParam, UNFILED, type CampaignSort, type CreatorSort } from "@/lib/listParams";
import { Prisma, type CampaignStatus, type CampaignType, type Platform } from "@/lib/generated/prisma/client";
import { HANDLE_PROBLEM_WHERE } from "@/lib/creators/handleCheck";
import { UNATTRIBUTED_CREATOR_WHERE } from "@/lib/posts/unattributedName";

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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Inclusive range on a DateTime column, dropped entirely when both ends are absent.
 *
 * The drawer's date inputs send a bare day, which parses as that day's UTC
 * midnight, so `lte` on it kept only rows stamped at exactly 00:00 and dropped
 * the rest of the end day: "Added 29 Sep to 29 Sep" listed none of the 634
 * creators LKM imported on 29 Sep. A bare day as the end now runs to the end of
 * that day (UTC, the zone every date on these screens is shown in); an end
 * with a time of its own is kept as given.
 */
export function dateRange(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  const bareDay = to !== undefined && to.getTime() % DAY_MS === 0;
  return {
    ...(from && { gte: from }),
    ...(to && (bareDay ? { lt: new Date(to.getTime() + DAY_MS) } : { lte: to })),
  };
}

function countRange(min?: number, max?: number) {
  if (min === undefined && max === undefined) return undefined;
  return { ...(min !== undefined && { gte: min }), ...(max !== undefined && { lte: max }) };
}

// ─── Campaigns ──────────────────────────────────────────────────────────────

export const CAMPAIGN_STATUSES = ["DRAFT", "PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"] as const;

/**
 * The status the campaigns page opens on when the URL names none.
 *
 * The page is opened to answer "what am I running right now", and All led with
 * 522 campaigns for this org, nearly all of them finished, so the handful in
 * flight were below the fold on the screen the sidebar lands you on.
 */
export const CAMPAIGNS_DEFAULT_STATUS = "IN_PROGRESS" as const;

/**
 * The All tab's value in the URL: an explicit "do not narrow by status".
 *
 * Once a bare /campaigns means Active, an absent parameter can no longer mean
 * "every status" -- All needs a value of its own or it is unreachable from the
 * sidebar. It is not a Campaign.status and never reaches a query: it is
 * stripped below, leaving exactly the empty filter an absent parameter already
 * produced. So /api/campaigns is unchanged for every existing caller, and
 * ?status=ALL now parses there instead of failing the enum -- which took the
 * whole safeParse down and silently dropped the client, tag and team filters
 * alongside it.
 */
export const CAMPAIGN_STATUS_ALL = "ALL";
export const CAMPAIGN_TYPES = ["BUDGET_BASED", "VIEW_BASED", "OPEN_COMMUNITY", "PRIVATE_INVITE"] as const;

export type CampaignFilters = {
  search?: string;
  status: CampaignStatus[];
  clientIds: string[];
  /**
   * A single folder, unlike the multi-selects around it. A folder is where a
   * campaign is filed, so the list shows one folder's contents the way a folder
   * works everywhere else — and the literal "none" narrows to the unfiled ones,
   * which is the only way to find them again.
   */
  folderId?: string;
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
  folderId: z.string().optional(),
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
  const statusParam = firstParam(sp.status);
  const parsed = campaignFilterSchema.safeParse({
    search: firstParam(sp.q ?? sp.search),
    status: statusParam === CAMPAIGN_STATUS_ALL ? undefined : statusParam,
    folderId: firstParam(sp.folderId),
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
    // An unknown folder id is left to narrow to nothing rather than 400 — the
    // folder may have been deleted since the URL was shared.
    ...(f.folderId && (f.folderId === UNFILED ? { folderId: null } : { folderId: f.folderId })),
    ...(f.clientIds.length && { clientId: { in: f.clientIds } }),
    ...(f.campaignType.length && { campaignType: { in: f.campaignType } }),
    // Both are many-to-many, so several selected values widen the result set
    // (campaigns carrying ANY of these tags), matching how the other
    // multi-selects here read.
    // Filtered by tag name rather than id so a shared URL keeps working after a
    // tag is renamed... and so the URL stays readable. The tags themselves are
    // now the org's definitions from Settings → General; the older free-string
    // CampaignTag table it used to read is empty and no longer written.
    ...(f.tags.length && { tagLinks: { some: { tag: { name: { in: f.tags } } } } }),
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
    (f.folderId ? 1 : 0) +
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
  tags: string[];
  excludeTags: string[];
  minAvgViews?: number;
  maxAvgViews?: number;
  minRate?: number;
  maxRate?: number;
  /** Where a creator's audience is; matches any one listed. Roster tables only. */
  audienceCountry: string[];
  /** Where the creator is. Roster tables only. */
  country: string[];
  /** Has an account on any of these, primary or not. */
  accounts: Platform[];
  /** Has an account the platform could not find (lib/creators/handleCheck). Roster tables only. */
  handleIssues?: boolean;
};

const optionalAmountParam = z.coerce.number().nonnegative().optional();
const csvTextParam = z
  .string()
  .optional()
  .transform((raw) => csvParam(raw));

export const creatorFilterSchema = z.object({
  search: z.string().optional(),
  platform: csvEnumParam(PLATFORMS),
  minFollowers: optionalCountParam,
  maxFollowers: optionalCountParam,
  addedFrom: optionalDateParam,
  addedTo: optionalDateParam,
  hasPosts: z.enum(["1"]).optional().transform((v) => (v ? true : undefined)),
  // The org's own creator tags, matched by name for the same reasons the
  // campaign tags are: a shared URL stays readable and survives a rename, and
  // an unrecognised name narrows to nothing rather than being a 400.
  tags: z
    .string()
    .optional()
    .transform((raw) => csvParam(raw)),
  excludeTags: z
    .string()
    .optional()
    .transform((raw) => csvParam(raw)),
  minAvgViews: optionalCountParam,
  maxAvgViews: optionalCountParam,
  minRate: optionalAmountParam,
  maxRate: optionalAmountParam,
  audienceCountry: csvTextParam,
  country: csvTextParam,
  accounts: csvEnumParam(PLATFORMS),
  handleIssues: z.enum(["1"]).optional().transform((v) => (v ? true : undefined)),
});

/** Every URL key the creator filters read, for callers that forward them. */
export const CREATOR_FILTER_KEYS = [
  "q",
  "platform",
  "minFollowers",
  "maxFollowers",
  "addedFrom",
  "addedTo",
  "hasPosts",
  "tags",
  "excludeTags",
  "minAvgViews",
  "maxAvgViews",
  "minRate",
  "maxRate",
  "audienceCountry",
  "country",
  "accounts",
  "handleIssues",
] as const;

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
    tags: firstParam(sp.tags),
    excludeTags: firstParam(sp.excludeTags),
    minAvgViews: firstParam(sp.minAvgViews),
    maxAvgViews: firstParam(sp.maxAvgViews),
    minRate: firstParam(sp.minRate),
    maxRate: firstParam(sp.maxRate),
    audienceCountry: firstParam(sp.audienceCountry),
    country: firstParam(sp.country),
    accounts: firstParam(sp.accounts),
    handleIssues: firstParam(sp.handleIssues),
  });
  if (parsed.success) return parsed.data;
  return { platform: [], tags: [], excludeTags: [], audienceCountry: [], country: [], accounts: [] };
}

/**
 * `roster` says the roster tables exist on this database. Until they do, the
 * filters that live in them are left out rather than failing the page; see
 * lib/creators/rosterTables.ts.
 */
export function creatorWhere(orgId: string, f: CreatorFilters, { roster = false }: { roster?: boolean } = {}): Prisma.CreatorWhereInput {
  // The holding row for posts nobody could attribute is a filing label, not a
  // creator: it never appears on the roster, in its counts or in a bulk action.
  const and: Prisma.CreatorWhereInput[] = [{ NOT: UNATTRIBUTED_CREATOR_WHERE }];
  if (countRange(f.minAvgViews, f.maxAvgViews)) and.push({ averageViews: countRange(f.minAvgViews, f.maxAvgViews) });
  if (countRange(f.minRate, f.maxRate)) and.push({ rate: countRange(f.minRate, f.maxRate) });
  // The platform tab and the drawer's "Has an account on" are one rule. The tab
  // used to match the creator's FIRST account only, so on the LKM roster the
  // Instagram tab listed 428 of the 863 creators with an Instagram account --
  // while every row it left out showed an Instagram chip of its own.
  if (f.platform.length) and.push(hasAccountOn(f.platform, roster));
  if (f.accounts?.length) and.push(hasAccountOn(f.accounts, roster));
  if (roster && f.audienceCountry?.length) {
    and.push({
      OR: f.audienceCountry.map((c) => ({ detail: { audienceCountry: { contains: c, mode: Prisma.QueryMode.insensitive } } })),
    });
  }
  if (roster && f.country?.length) {
    and.push({ OR: f.country.map((c) => ({ detail: { country: { contains: c, mode: Prisma.QueryMode.insensitive } } })) });
  }
  if (roster && f.handleIssues) and.push({ profileLinks: { some: HANDLE_PROBLEM_WHERE } });
  return {
    ...(and.length && { AND: and }),
    orgId,
    deletedAt: null,
    ...(countRange(f.minFollowers, f.maxFollowers) && {
      followersCount: countRange(f.minFollowers, f.maxFollowers),
    }),
    ...(dateRange(f.addedFrom, f.addedTo) && { addedAt: dateRange(f.addedFrom, f.addedTo) }),
    ...(f.hasPosts && { posts: { some: {} } }),
    // Include widens (carrying ANY of these), exclude narrows (carrying NONE),
    // which is what makes the pair useful together: every Music creator who is
    // not also Unresponsive.
    ...(f.tags.length && { tagLinks: { some: { tag: { name: { in: f.tags } } } } }),
    ...(f.excludeTags.length && {
      NOT: { tagLinks: { some: { tag: { name: { in: f.excludeTags } } } } },
    }),
    ...(f.search
      ? {
          OR: [
            { name: { contains: f.search, mode: Prisma.QueryMode.insensitive } },
            { handle: { contains: f.search, mode: Prisma.QueryMode.insensitive } },
            // A niche is free text, so "naruto" finds the Anime pages that said so.
            ...(roster
              ? [
                  { detail: { niche: { contains: f.search, mode: Prisma.QueryMode.insensitive } } },
                  { profileLinks: { some: { handle: { contains: f.search.replace(/^@/, ""), mode: Prisma.QueryMode.insensitive } } } },
                ]
              : []),
          ],
        }
      : {}),
  };
}

/**
 * A creator with an account on any of these platforms: its own row's platform
 * or any linked profile. Before the roster tables exist a creator has one
 * account, its own row.
 */
function hasAccountOn(platforms: Platform[], roster: boolean): Prisma.CreatorWhereInput {
  return roster
    ? { OR: [{ platform: { in: platforms } }, { profileLinks: { some: { platform: { in: platforms } } } }] }
    : { platform: { in: platforms } };
}

export function countCreatorFilters(f: CreatorFilters): number {
  return (
    (f.platform.length ? 1 : 0) +
    (f.minFollowers !== undefined || f.maxFollowers !== undefined ? 1 : 0) +
    (f.addedFrom || f.addedTo ? 1 : 0) +
    (f.hasPosts ? 1 : 0) +
    (f.tags.length ? 1 : 0) +
    (f.excludeTags.length ? 1 : 0) +
    (f.minAvgViews !== undefined || f.maxAvgViews !== undefined ? 1 : 0) +
    (f.minRate !== undefined || f.maxRate !== undefined ? 1 : 0) +
    (f.audienceCountry?.length ? 1 : 0) +
    (f.country?.length ? 1 : 0) +
    (f.accounts?.length ? 1 : 0) +
    (f.handleIssues ? 1 : 0)
  );
}

export function campaignOrderBy(sort: CampaignSort): Prisma.CampaignOrderByWithRelationInput[] {
  const { dir } = sort;
  // Every branch ends with id, for the reason the creator list documents below:
  // 519 campaigns share only 516 distinct updatedAt values and 505 distinct
  // titles, and Postgres promises no order within a tie. With skip/take that
  // lets a tie straddling a page boundary show one campaign twice and another
  // never. The list was ordering by updatedAt alone before this.
  const tiebreak: Prisma.CampaignOrderByWithRelationInput = { id: "asc" };
  switch (sort.key) {
    case "created":
      return [{ createdAt: dir }, tiebreak];
    case "updated":
    default:
      return [{ updatedAt: dir }, tiebreak];
  }
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
    case "price":
      // Unpriced creators are unknown, not free, so they sit at the end either way.
      return [{ rate: { sort: dir, nulls: "last" } }, tiebreak];
    case "followers":
      // The order WITHIN the known counts. Their zeros are unknowns, not NULLs,
      // so `nulls: "last"` cannot reach them: callers read the known and unknown
      // rows as two segments (lib/creators/rosterSort).
      return [{ followersCount: dir }, tiebreak];
    case "added":
    default:
      return [{ addedAt: dir }, tiebreak];
  }
}
