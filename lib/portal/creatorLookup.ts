import { db } from "@/lib/db";
import { stripAt } from "@/lib/format";

// A creator signs into the portal once but may exist as a Creator row inside
// several orgs, stored with or without the leading @. Every portal route that
// needs those rows resolves them the same way, so it lives here.
function matchesHandle(handle: string) {
  const bare = stripAt(handle);
  return { deletedAt: null, OR: [{ handle: bare }, { handle: `@${bare}` }] };
}

export function findCreatorsForHandle(handle: string) {
  return db.creator.findMany({
    where: matchesHandle(handle),
    select: { id: true, orgId: true },
  });
}

/**
 * The same match, narrowed to one org. Callers that resolve a portal session
 * against a single org's roster must use this rather than an exact
 * `handle: session.handle` equality: a roster stores handles with or without
 * the leading @, so exact equality silently misses the existing row and the
 * caller creates a duplicate creator instead of finding the real one.
 */
export function findCreatorInOrgForHandle(orgId: string, handle: string) {
  return db.creator.findFirst({
    where: { orgId, ...matchesHandle(handle) },
    orderBy: { addedAt: "asc" },
    select: { id: true },
  });
}

export function findCreatorForHandle(handle: string) {
  return db.creator.findFirst({
    where: matchesHandle(handle),
    orderBy: { addedAt: "asc" },
    select: { id: true, orgId: true },
  });
}
