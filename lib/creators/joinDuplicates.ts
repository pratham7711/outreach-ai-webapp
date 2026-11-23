import { db } from "@/lib/db";
import type { Platform } from "@/lib/generated/prisma";
import { logAudit } from "@/lib/audit";
import { stripAt } from "@/lib/format";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { countOwnedRows, executeMerge, loadMergeSide, planMerge } from "@/lib/creators/mergeCreators";
import { isMissingJoinLinkTable } from "./joinLinkDdl";

/**
 * A creator who joins through the agency's link gets a roster row of their own
 * (lib/portal/joinAgency.ts). When the agency already had them -- a row from a
 * sign-up sheet, say -- that is the same person twice. The two are not merged
 * on sign-up, because what the creator typed proves nothing. They are merged
 * once the creator connects an account and the platform itself confirms the
 * handle the agency's row names; until then the roster marks the joined row as
 * a possible duplicate (joinMarks).
 */

const norm = (h: string | null | undefined) => stripAt(h ?? "").trim().toLowerCase();
const handleVariants = (h: string) => [h, `@${h}`];

export type JoinMark = { joinedAt: string; duplicates: Array<{ id: string; name: string; handle: string }> };

/** For each joined row among `creatorIds`: when it joined, and rows that look like the same person. */
export async function joinMarks(orgId: string, creatorIds: string[]): Promise<Map<string, JoinMark>> {
  const out = new Map<string, JoinMark>();
  if (creatorIds.length === 0) return out;
  let records: Array<{ creatorId: string; joinedAt: Date; creator: { handle: string; contactEmail: string | null } }>;
  try {
    records = await db.creatorJoinRecord.findMany({
      where: { orgId, creatorId: { in: creatorIds } },
      select: { creatorId: true, joinedAt: true, creator: { select: { handle: true, contactEmail: true } } },
    });
  } catch (e) {
    if (isMissingJoinLinkTable(e)) return out;
    throw e;
  }
  if (records.length === 0) return out;

  const handles = [...new Set(records.map((r) => norm(r.creator.handle)).filter(Boolean))];
  const emails = [...new Set(records.map((r) => r.creator.contactEmail?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))];
  const joinedIds = records.map((r) => r.creatorId);

  const [byHandle, byLink, byEmail] = await Promise.all([
    handles.length
      ? db.creator.findMany({
          where: {
            orgId,
            deletedAt: null,
            id: { notIn: joinedIds },
            OR: handles.flatMap(handleVariants).map((h) => ({ handle: { equals: h, mode: "insensitive" as const } })),
          },
          select: { id: true, name: true, handle: true },
        })
      : [],
    handles.length
      ? db.creatorProfileLink.findMany({
          where: {
            orgId,
            creatorId: { notIn: joinedIds },
            creator: { deletedAt: null },
            OR: handles.flatMap(handleVariants).map((h) => ({ handle: { equals: h, mode: "insensitive" as const } })),
          },
          select: { handle: true, creator: { select: { id: true, name: true, handle: true } } },
        })
      : [],
    emails.length
      ? db.creator.findMany({
          where: {
            orgId,
            deletedAt: null,
            id: { notIn: joinedIds },
            OR: emails.map((e) => ({ contactEmail: { equals: e, mode: "insensitive" as const } })),
          },
          select: { id: true, name: true, handle: true, contactEmail: true },
        })
      : [],
  ]);

  for (const r of records) {
    const h = norm(r.creator.handle);
    const e = r.creator.contactEmail?.trim().toLowerCase() ?? "";
    const found = new Map<string, { id: string; name: string; handle: string }>();
    for (const c of byHandle) if (h && norm(c.handle) === h) found.set(c.id, c);
    for (const l of byLink) if (h && norm(l.handle) === h) found.set(l.creator.id, l.creator);
    for (const c of byEmail) if (e && c.contactEmail?.trim().toLowerCase() === e) found.set(c.id, { id: c.id, name: c.name, handle: c.handle });
    out.set(r.creatorId, { joinedAt: r.joinedAt.toISOString(), duplicates: [...found.values()] });
  }
  return out;
}

/**
 * After a joined creator connects an account: if exactly one other row in the
 * org names that platform-confirmed handle on that platform, and it is not
 * signed in as someone else, fold the joined row into it. The agency's row is
 * the one kept, with its campaigns, posts and payouts; the joined row hands
 * over the login, the connection and anything else it gathered.
 *
 * Returns the kept row's id, or null when nothing was merged. Never throws: the
 * connection is already saved, and a merge that fails leaves the possible-
 * duplicate mark for the agency to resolve by hand.
 */
export async function mergeJoinedIntoMatch(input: {
  orgId: string;
  joinedCreatorId: string;
  platform: Platform;
  verifiedHandle: string;
  actorEmail?: string | null;
}): Promise<string | null> {
  const { orgId, joinedCreatorId, platform } = input;
  const handle = norm(input.verifiedHandle);
  if (!handle) return null;
  try {
    const record = await db.creatorJoinRecord.findUnique({ where: { creatorId: joinedCreatorId }, select: { orgId: true, creatorUserId: true } });
    if (!record || record.orgId !== orgId) return null;

    const variants = handleVariants(handle).map((h) => ({ equals: h, mode: "insensitive" as const }));
    const candidates = await db.creator.findMany({
      where: {
        orgId,
        deletedAt: null,
        id: { not: joinedCreatorId },
        OR: [{ creatorUserId: null }, { creatorUserId: record.creatorUserId }],
        AND: [
          {
            OR: [
              ...variants.map((v) => ({ platform, handle: v })),
              { profileLinks: { some: { platform, OR: variants.map((v) => ({ handle: v })) } } },
              { socialAccounts: { some: { platform, OR: variants.map((v) => ({ handle: v })) } } },
            ],
          },
        ],
      },
      select: { id: true },
      take: 2,
    });
    if (candidates.length === 0) {
      /* A new creator, not a duplicate. Sign-up never asks for a platform, so
         the row says whatever the portal defaulted to; its first connection
         says which it really is. */
      const elsewhere = await db.creatorSocialAccount.count({ where: { creatorId: joinedCreatorId, platform: { not: platform } } });
      if (elsewhere === 0) {
        await db.creator.updateMany({ where: { id: joinedCreatorId, orgId, platform: { not: platform } }, data: { platform } });
      }
      return null;
    }
    if (candidates.length !== 1) return null;
    const keepId = candidates[0].id;

    const roster = await rosterTablesReady();
    const [keep, drop] = await Promise.all([loadMergeSide(orgId, keepId, roster), loadMergeSide(orgId, joinedCreatorId, roster)]);
    if (!keep || !drop) return null;
    const planned = planMerge(keep, drop);
    if (!planned.ok) return null;
    const owned = await countOwnedRows(drop.id);
    await executeMerge(orgId, keep, drop, planned.plan, owned);

    await logAudit({
      orgId,
      actorType: "creator",
      actorEmail: input.actorEmail ?? undefined,
      action: "creator.join_merged",
      entityType: "creator",
      entityId: keep.id,
      entityLabel: keep.name,
      before: { kept: { id: keep.id, handle: keep.handle }, merged: { id: drop.id, handle: drop.handle } },
      after: { id: keep.id, ...planned.plan.creator, confirmedBy: { platform, handle } },
    });
    return keep.id;
  } catch (e) {
    console.error("Join duplicate merge failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
