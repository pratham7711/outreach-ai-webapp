import { REVOKE_REASONS, type GrantRecord } from "@/lib/creators/grants";

/* The Access panel's view of an org's grants for one creator
   (app/api/creators/[id]/grants, components/creators/CreatorAccess). */

export type AccessStatus = "active" | "reconnect_needed" | "revoked";

export type AccessEntry = {
  id: string;
  platform: string;
  status: AccessStatus;
  grantedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  scopes: string[];
  /** "provider": what the platform said it granted. "requested": what the
   *  app asked for, because the platform does not say. null: not recorded. */
  scopesSource: string | null;
  source: string;
};

/**
 * Which of a platform's grants the Access panel shows: every live one (a
 * creator may connect two accounts on one platform), or, when none is live, the
 * most recent that ended, so "Revoked" and "Reconnect needed" stay visible
 * instead of the platform silently dropping off the list. Grants arrive newest
 * first.
 */
export function entriesToShow(
  grants: GrantRecord[],
  liveConnectionIds: Set<string>,
  reconnectNeeded: Set<string>,
): AccessEntry[] {
  const byPlatform = new Map<string, GrantRecord[]>();
  for (const g of grants) byPlatform.set(g.platform, [...(byPlatform.get(g.platform) ?? []), g]);

  const out: AccessEntry[] = [];
  for (const [platform, list] of byPlatform) {
    const live = list.filter((g) => !g.revokedAt);
    const shown = live.length > 0 ? live : [list[0]];
    for (const g of shown) {
      let status: AccessStatus;
      let revokeReason = g.revokeReason;
      if (g.revokedAt) {
        /* Google's invalid_grant ends the grant but keeps the connection: the
           creator has to reconnect, nothing was taken away. */
        status = g.revokeReason === REVOKE_REASONS.INVALID_GRANT ? "reconnect_needed" : "revoked";
      } else if (!g.connectionId || !liveConnectionIds.has(g.connectionId)) {
        /* A live grant whose connection is gone (removed by a path that kept
           no record) reads nothing; say so rather than show it as active. */
        status = "revoked";
        revokeReason = "connection_removed";
      } else {
        status = reconnectNeeded.has(g.connectionId) ? "reconnect_needed" : "active";
      }
      out.push({
        id: g.id,
        platform,
        status,
        grantedAt: g.grantedAt.toISOString(),
        revokedAt: g.revokedAt ? g.revokedAt.toISOString() : null,
        revokeReason,
        scopes: g.scopes,
        scopesSource: g.scopesSource,
        source: g.source,
      });
    }
  }
  return out.sort((a, b) => a.platform.localeCompare(b.platform) || b.grantedAt.localeCompare(a.grantedAt));
}
