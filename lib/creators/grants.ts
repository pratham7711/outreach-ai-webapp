import { db } from "@/lib/db";
import type { Platform } from "@/lib/generated/prisma/client";
import { grantTablesReady } from "@/lib/creators/grantTables";
import { requestedScopes, type OAuthPlatform } from "@/lib/oauth/providers";
import { createLogger } from "@/lib/observability/logger";

/**
 * Writes and reads of CreatorGrant: which agency may read which connection
 * (plan K4).
 *
 * Every function here asks grantTablesReady() first and never throws. Absent
 * table, failed query: nothing is recorded, and the connection itself is never
 * refused because its consent record could not be written. The gate that reads
 * these rows is lib/creators/connectionGate.ts.
 */

export const GRANT_SOURCES = {
  /** /connect/<token>: the agency bound the link to one roster row. */
  CONNECT_LINK: "connect-link",
  /** A signed-in creator pressed Connect in the creator app. */
  PORTAL: "portal",
  /** The non-production connect shortcut in the start route. */
  DEV: "dev",
  /** Recorded after the fact for a connection made before grants were kept. */
  BACKFILL: "backfill",
} as const;
export type GrantSource = (typeof GRANT_SOURCES)[keyof typeof GRANT_SOURCES];

export const REVOKE_REASONS = {
  /** The creator pressed Disconnect, or deleted their login (which disconnects). */
  DISCONNECT: "disconnect",
  /** The agency removed the account from the creator's page. */
  AGENCY_REMOVED: "agency_removed",
  /** Meta's deauthorize callback: the app was removed in Meta's settings. */
  META_DEAUTHORIZE: "meta_deauthorize",
  /** Meta's data-deletion callback. */
  META_DATA_DELETION: "meta_data_deletion",
  /** TikTok's authorization.removed webhook. */
  TIKTOK_AUTHORIZATION_REMOVED: "tiktok_authorization_removed",
  /** Google refused the refresh for good. The row is kept and shows
   *  "Reconnect needed"; nothing is deleted on this signal. */
  INVALID_GRANT: "invalid_grant",
  /** The connection was stamped with a login that was deleted. */
  ACCOUNT_DELETED: "account_deleted",
  /** A later consent for the same connection replaced this one. */
  SUPERSEDED: "superseded",
} as const;
export type RevokeReason = (typeof REVOKE_REASONS)[keyof typeof REVOKE_REASONS];

const log = () => createLogger({ context: { call: "creator.grants" } });

/**
 * The scopes a consent granted, as well as can be known.
 *
 * TikTok and Google say what they granted in the token response (`scope`);
 * Meta's code exchange does not, and its dialog lets a person untick
 * permissions, so for Meta the list is what was ASKED for and is labelled as
 * such rather than passed off as the grant.
 */
export function grantedScopes(
  platform: OAuthPlatform,
  reported: unknown,
): { scopes: string[]; scopesSource: "provider" | "requested" } {
  const fromProvider =
    typeof reported === "string"
      ? reported.split(/[\s,]+/)
      : Array.isArray(reported)
        ? reported.filter((s): s is string => typeof s === "string")
        : [];
  const scopes = [...new Set(fromProvider.map((s) => s.trim()).filter(Boolean))];
  if (scopes.length > 0) return { scopes, scopesSource: "provider" };
  return { scopes: requestedScopes(platform), scopesSource: "requested" };
}

export type GrantInput = {
  orgId: string;
  creatorId: string;
  platform: Platform;
  connectionId: string;
  platformAccountId: string | null;
  scopes: string[];
  scopesSource: "provider" | "requested" | null;
  source: GrantSource;
};

/**
 * Records a completed consent for the org the connection was made under.
 *
 * A consent for a connection that already has a live grant in this org
 * supersedes it rather than editing it in place, so the record keeps every
 * consent and when it ended. Returns whether a grant was written.
 */
export async function recordGrant(input: GrantInput): Promise<boolean> {
  if (!(await grantTablesReady({ fresh: true }))) return false;
  try {
    const now = new Date();
    await db.$transaction([
      db.creatorGrant.updateMany({
        where: { orgId: input.orgId, connectionId: input.connectionId, revokedAt: null },
        data: { revokedAt: now, revokeReason: REVOKE_REASONS.SUPERSEDED },
      }),
      db.creatorGrant.create({
        data: {
          orgId: input.orgId,
          creatorId: input.creatorId,
          platform: input.platform,
          connectionId: input.connectionId,
          platformAccountId: input.platformAccountId,
          scopes: input.scopes,
          scopesSource: input.scopesSource,
          grantedAt: now,
          source: input.source,
        },
        select: { id: true },
      }),
    ]);
    return true;
  } catch (err) {
    log().warn("Could not record a grant", {
      connectionId: input.connectionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Ends every live grant on these connections, whichever org holds it. Returns
 * how many were revoked.
 *
 * By connection, not by org: every path that calls this (Disconnect, the
 * platform webhooks, Google's invalid_grant) is the connection itself ending,
 * and a connection hangs off one roster row in one org anyway.
 */
export async function revokeGrantsForConnections(
  connectionIds: string[],
  reason: RevokeReason,
): Promise<number> {
  const ids = [...new Set(connectionIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  if (!(await grantTablesReady({ fresh: true }))) return 0;
  try {
    const { count } = await db.creatorGrant.updateMany({
      where: { connectionId: { in: ids }, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    return count;
  } catch (err) {
    log().warn("Could not revoke grants", {
      connections: ids.length,
      reason,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

export type GrantRecord = {
  id: string;
  platform: Platform;
  connectionId: string | null;
  scopes: string[];
  scopesSource: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  source: string;
};

/**
 * Every grant this org holds for one roster creator, newest first, or null
 * while the table does not exist.
 *
 * Matched on the creator OR on its current connections, because a merge moves
 * connections between roster rows and the grant keeps naming the row it was
 * given on.
 */
export async function grantsForCreator(
  orgId: string,
  creatorId: string,
  connectionIds: string[],
): Promise<GrantRecord[] | null> {
  if (!(await grantTablesReady())) return null;
  try {
    return await db.creatorGrant.findMany({
      where: {
        orgId,
        OR: [{ creatorId }, ...(connectionIds.length > 0 ? [{ connectionId: { in: connectionIds } }] : [])],
      },
      orderBy: { grantedAt: "desc" },
      select: {
        id: true,
        platform: true,
        connectionId: true,
        scopes: true,
        scopesSource: true,
        grantedAt: true,
        revokedAt: true,
        revokeReason: true,
        source: true,
      },
    });
  } catch (err) {
    log().warn("Grant listing failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
