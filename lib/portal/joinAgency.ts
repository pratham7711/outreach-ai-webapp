import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { recordJoin, resolveJoinCode } from "@/lib/creators/joinLink";

type JoinSession = { creatorUserId: string; email: string };

export type AgencyJoin =
  | { ok: true; creatorId: string; agency: string; alreadyOnRoster: boolean }
  | { ok: false; status: 404; error: string };

const GONE = "This join link is no longer active. Ask the agency for a new one.";

/**
 * Puts the signed-in portal creator on the roster of the agency whose join
 * link (/join/<code>) brought them here: the step after sign-up or sign-in.
 *
 * The row names this login (creatorUserId), which is the proof
 * lib/portal/creatorLink.ts reads, so the accounts the creator connects next
 * land on it. A row this login is already on is reused. A row the agency added
 * by hand under the same handle is NOT taken over: the link is public, and a
 * handle is not a proof, so linking it would hand whoever signed up with that
 * handle the row's offers, earnings and connections. The agency merges the two
 * if they are the same person.
 */
export async function joinAgency(session: JoinSession, code: string): Promise<AgencyJoin> {
  const link = await resolveJoinCode(code);
  if (!link) return { ok: false, status: 404, error: GONE };

  const existing = await db.creator.findFirst({
    where: { orgId: link.orgId, creatorUserId: session.creatorUserId, deletedAt: null },
    orderBy: { addedAt: "asc" },
    select: { id: true },
  });
  if (existing) return { ok: true, creatorId: existing.id, agency: link.agency, alreadyOnRoster: true };

  const user = await db.creatorUser.findUnique({
    where: { id: session.creatorUserId },
    select: { name: true, handle: true, platform: true, avatarUrl: true, bio: true, followersCount: true },
  });
  if (!user) return { ok: false, status: 404, error: GONE };

  const created = await db.creator.create({
    data: {
      orgId: link.orgId,
      creatorUserId: session.creatorUserId,
      name: user.name,
      handle: user.handle,
      platform: user.platform,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      followersCount: user.followersCount,
      contactEmail: session.email,
    },
    select: { id: true },
  });

  await recordJoin(link.linkId);
  await logAudit({
    orgId: link.orgId,
    actorType: "creator",
    actorEmail: session.email,
    action: "creator.joined_via_link",
    entityType: "creator",
    entityId: created.id,
    entityLabel: `@${user.handle} joined through the join link`,
  });
  return { ok: true, creatorId: created.id, agency: link.agency, alreadyOnRoster: false };
}
