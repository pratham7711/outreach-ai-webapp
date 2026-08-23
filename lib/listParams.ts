/**
 * The query-string vocabulary the list pages share: how one param is read, the
 * sentinel for an unfiled campaign, and which columns each list can order by.
 *
 * Split out of listFilters, which imports zod and the Prisma namespace. The
 * client components need only this half -- UNFILED, a sort type, the default
 * sort -- and importing it from there shipped 294KB of a server-side validation
 * library to the browser, measured in the built /campaigns chunk. So this file
 * imports nothing at all, and it is the one the client components use.
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

export const UNFILED = "none";

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
/**
 * Campaign columns the list can order by.
 *
 * The reference offers Title and Last Updated, each newest/oldest — its control
 * is labelled "Creation Date" but the options it opens are these two
 * (scripts/creatorcore/out/modals/campaigns-filter-date.json). Created is here
 * as well because createdAt is the one campaign date that is genuinely unique
 * across all 519 rows, which makes it the only stable thing to fall back on.
 *
 * Title is deliberately absent, which the reference does offer. 177 of the 519
 * imported titles carry leading or trailing whitespace — " Kany Garcia",
 * "27th Birthday " — and HTML collapses it, so the list renders them looking
 * ordinary while Postgres sorts them by a space. Ascending order put two of them
 * above "2003 - 347aiden" on screen with nothing to explain why. Ordering by
 * btrim(title) is what this needs and Prisma's orderBy cannot express it, so the
 * choice is raw SQL for the whole filtered query or trimming 177 rows of
 * imported data. Both are decisions above a sort control's pay grade; until one
 * is taken the control offers only what it can order truthfully.
 *
 * Not budget: it is nullable and unset on most campaigns, so ascending order
 * would rank every campaign without one as the cheapest. Not creators or posts:
 * both are counted after the page is fetched, so ordering by them would sort
 * only the rows already on screen.
 */
export const CAMPAIGN_SORT_KEYS = ["updated", "created"] as const;
export type CampaignSortKey = (typeof CAMPAIGN_SORT_KEYS)[number];
export type CampaignSort = { key: CampaignSortKey; dir: "asc" | "desc" };

/** Most recently touched first, which is what the list did before it could sort. */
export const DEFAULT_CAMPAIGN_SORT: CampaignSort = { key: "updated", dir: "desc" };

export function isDefaultCampaignSort(sort: CampaignSort): boolean {
  return sort.key === DEFAULT_CAMPAIGN_SORT.key && sort.dir === DEFAULT_CAMPAIGN_SORT.dir;
}

export function readCampaignSort(
  sp: Record<string, string | string[] | undefined>
): CampaignSort {
  const key = firstParam(sp.sort);
  const dir = firstParam(sp.dir);
  if (!key || !(CAMPAIGN_SORT_KEYS as readonly string[]).includes(key)) {
    return DEFAULT_CAMPAIGN_SORT;
  }
  return { key: key as CampaignSortKey, dir: dir === "asc" ? "asc" : "desc" };
}

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
