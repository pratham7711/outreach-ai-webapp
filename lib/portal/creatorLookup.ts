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

export function findCreatorForHandle(handle: string) {
  return db.creator.findFirst({
    where: matchesHandle(handle),
    orderBy: { addedAt: "asc" },
    select: { id: true, orgId: true },
  });
}
