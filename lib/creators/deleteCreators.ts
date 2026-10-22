import { db } from "@/lib/db";
import { rosterTablesReady } from "@/lib/creators/rosterTables";

/**
 * Take creators off an org's roster.
 *
 * A soft delete, the same state a merge leaves the duplicate in: the creator
 * stops being listed, tracked and matched, while the posts and activations
 * they already have stay in their campaigns' reports. Their profile links go,
 * because a link still held by a deleted creator makes re-adding the same
 * account drop it silently (each create is skipDuplicates on org + platform +
 * handle); and so do their list entries, which the list view does not filter.
 *
 * Ids from another org, or already deleted, are skipped rather than refused,
 * so a double click or a stale tab is not an error; `deleted` says which went.
 */
export async function deleteCreators(orgId: string, ids: string[], now = new Date()) {
  const rows = await db.creator.findMany({
    where: { id: { in: [...new Set(ids)] }, orgId, deletedAt: null },
    select: { id: true, name: true, handle: true, platform: true, creatorUserId: true },
  });
  if (!rows.length) return { deleted: rows, profileLinksRemoved: 0, listEntriesRemoved: 0 };
  const found = rows.map((r) => r.id);
  const roster = await rosterTablesReady();
  const { links, lists } = await db.$transaction(async (tx) => {
    await tx.creator.updateMany({
      where: { id: { in: found }, orgId, deletedAt: null },
      data: { deletedAt: now, creatorUserId: null },
    });
    const links = roster
      ? await tx.creatorProfileLink.deleteMany({ where: { orgId, creatorId: { in: found } } })
      : { count: 0 };
    const lists = await tx.creatorListItem.deleteMany({ where: { creatorId: { in: found }, list: { orgId } } });
    return { links, lists };
  });
  return { deleted: rows, profileLinksRemoved: links.count, listEntriesRemoved: lists.count };
}
