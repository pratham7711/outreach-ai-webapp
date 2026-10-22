import { db } from "@/lib/db";
import { creatorHandleVariants } from "@/lib/creator-auth";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import type { Platform } from "@/lib/generated/prisma/client";

/**
 * Live creators in this org holding a roster profile link for this handle.
 *
 * CreatorProfileLink is where Roster -> Import, a merge and the Instagram
 * lookup on Add creator keep a creator's accounts beyond the one on the
 * Creator row. Lookups that read only Creator.handle and the creator's own
 * connected accounts missed it, so an Instagram post by someone filed under
 * TikTok -- with that Instagram on their profile -- came back "not on the
 * roster" and was given a second creator.
 *
 * Narrowed to the platform when one is known, for the reason
 * findCreatorByHandle gives: one handle is two people on two platforms.
 * Case-insensitive and "@"-tolerant. Primary links first, then oldest, so the
 * answer is stable from one call to the next.
 */
export async function creatorsByProfileLink(
  orgId: string,
  handle: string,
  platform?: Platform,
  take = 3,
): Promise<{ id: string; name: string; handle: string }[]> {
  if (!handle.replace(/^@/, "").trim()) return [];
  if (!(await rosterTablesReady())) return [];
  const rows = await db.creatorProfileLink.findMany({
    where: {
      orgId,
      ...(platform ? { platform } : {}),
      OR: creatorHandleVariants(handle.trim()).map((h) => ({ handle: { equals: h, mode: "insensitive" as const } })),
      creator: { orgId, deletedAt: null },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { creator: { select: { id: true, name: true, handle: true } } },
    take,
  });
  return rows.map((r) => r.creator);
}
