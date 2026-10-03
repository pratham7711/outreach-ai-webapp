import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { resolveConnectToken } from "@/lib/creators/connectToken";

type ClaimSession = { creatorUserId: string; email: string };

export type ConnectLinkClaim =
  | { ok: true; creatorId: string; alreadyLinked: boolean }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Links the roster row behind an agency's connect link to the portal login the
 * creator just made or signed into: the "Create a login to see your campaigns"
 * step on /connect/<token>.
 *
 * The link is the agency's own grant to that creator, handed over through the
 * agency's channel, which is the same standard as accepting a per-creator
 * invite (lib/portal/campaignInvite.ts): whoever holds it may attach accounts to
 * the row, so they may also name themselves on it. Only an unlinked row is
 * claimed, and conditionally, so two logins racing on a forwarded link cannot
 * both win. A row already linked to another login is refused, never moved.
 */
export async function claimConnectLink(session: ClaimSession, rawToken: string): Promise<ConnectLinkClaim> {
  const binding = await resolveConnectToken(rawToken);
  if (!binding) return { ok: false, status: 404, error: "This link is no longer active. Ask the agency for a new one." };

  const row = await db.creator.findFirst({
    where: { id: binding.creatorId, orgId: binding.orgId, deletedAt: null },
    select: { id: true, creatorUserId: true },
  });
  if (!row) return { ok: false, status: 404, error: "This link is no longer active. Ask the agency for a new one." };
  if (row.creatorUserId === session.creatorUserId) return { ok: true, creatorId: row.id, alreadyLinked: true };
  if (row.creatorUserId)
    return { ok: false, status: 409, error: "These accounts are already linked to another login. Sign in with that login instead." };

  const linked = await db.creator.updateMany({
    where: { id: row.id, orgId: binding.orgId, creatorUserId: null },
    data: { creatorUserId: session.creatorUserId },
  });
  if (linked.count === 0)
    return { ok: false, status: 409, error: "These accounts are already linked to another login. Sign in with that login instead." };

  await logAudit({
    orgId: binding.orgId,
    actorType: "creator",
    actorEmail: session.email,
    action: "creator.connect_link_claimed",
    entityType: "creator",
    entityId: row.id,
    entityLabel: "Creator linked a login through a connect link",
  });
  return { ok: true, creatorId: row.id, alreadyLinked: false };
}
