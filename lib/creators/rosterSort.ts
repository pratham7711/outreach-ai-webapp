import type { Prisma } from "@/lib/generated/prisma/client";
import type { CreatorSort } from "@/lib/listParams";

/**
 * Sorting the roster by followers, with the unknowns kept at the end.
 *
 * Creator.followersCount is Float @default(0), so a creator nobody has read
 * stores the same 0 as one with no audience (lib/creators/metricValue), and the
 * roster prints "—" for both. A plain ORDER BY followersCount would rank every
 * unread creator as the least-followed one -- 1,823 of them on the imported
 * roster -- and put them first in ascending order. Prisma cannot order by an
 * expression, and the schema is not changing, so the list is read as two
 * segments instead: the known counts in the order asked for, then the unknowns
 * in the roster's default order, whichever way the column points.
 */
export const KNOWN_FOLLOWERS: Prisma.CreatorWhereInput = { followersCount: { gt: 0 } };

/** How the unknowns sit among themselves: the roster's default, newest added first. */
export const UNKNOWN_FOLLOWERS_ORDER: Prisma.CreatorOrderByWithRelationInput[] = [{ addedAt: "desc" }, { id: "asc" }];

export function pinsUnknownLast(sort: CreatorSort): boolean {
  return sort.key === "followers";
}

/** The filter, narrowed to each segment. AND keeps every clause of `where`, orgId included. */
export function splitByKnownFollowers(where: Prisma.CreatorWhereInput) {
  return {
    known: { AND: [where, KNOWN_FOLLOWERS] } satisfies Prisma.CreatorWhereInput,
    unknown: { AND: [where, { NOT: KNOWN_FOLLOWERS }] } satisfies Prisma.CreatorWhereInput,
  };
}

/**
 * Which rows of each segment one page needs, when the list is every known row
 * followed by every unknown one: a page can fall entirely in the first, span
 * the boundary, or fall entirely in the second.
 */
export function unknownLastWindow(knownCount: number, skip: number, take: number) {
  const knownTake = Math.max(0, Math.min(take, knownCount - skip));
  return {
    known: { skip: Math.min(skip, knownCount), take: knownTake },
    unknown: { skip: Math.max(0, skip - knownCount), take: take - knownTake },
  };
}
