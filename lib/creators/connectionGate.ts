import { db } from "@/lib/db";
import type { Platform, Prisma } from "@/lib/generated/prisma/client";
import { grantTablesReady } from "@/lib/creators/grantTables";
import { createLogger } from "@/lib/observability/logger";
import { ACCOUNT_ORIGINS } from "@/lib/platforms/accountOrigin";

/**
 * The one way an agency-side reader gets a creator's connection (plan K4, A8).
 *
 * A connection is read for org X only while X holds an unrevoked CreatorGrant
 * for it. Anything else — another org's connection, a revoked grant, a
 * hand-entered row that never had a consent behind it — answers
 * Unknown("no_grant"), and the reader falls back to what it does for a creator
 * who never connected (a public read, or nothing). The reader always names the
 * org it is reading FOR; there is no way to ask for a connection by id alone.
 *
 * Until the CreatorGrant table exists the gate is open and answers exactly what
 * the readers' own queries answered before it: the first matching row for the
 * creator. It says so in the log, once per process. The org filter in that
 * fallback changes no answer: tokens are sealed with the owning org's id
 * (lib/crypto/encrypt, AAD), so another org's row never decrypted for the
 * caller anyway.
 */

export type Unknown<R extends string> = { ok: false; unknown: R };

/** Everything the readers routed through here use, and nothing more. */
export const READ_CONNECTION_SELECT = {
  id: true,
  creatorId: true,
  platform: true,
  handle: true,
  origin: true,
  accessToken: true,
  refreshToken: true,
  tokenExpiry: true,
  platformUserId: true,
  followersCount: true,
  statsSyncedAt: true,
} as const;

export type ReadableConnection = Prisma.CreatorSocialAccountGetPayload<{
  select: typeof READ_CONNECTION_SELECT;
}>;

export type ConnectionRead =
  /** grantId is null only while the gate is open (no grant table yet). */
  | { ok: true; connection: ReadableConnection; grantId: string | null }
  | Unknown<"no_grant" | "no_connection">;

export type ConnectionFilter = {
  /** Narrows the rows a reader may use, e.g. Facebook Login rows only. */
  where?: Prisma.CreatorSocialAccountWhereInput;
  /** Which of several matching rows is "the" connection. Unordered when absent,
   *  which is what the token helpers have always done. */
  order?: "oldest" | "newest";
};

let ungatedNoted = false;

function noteUngated(): void {
  if (ungatedNoted) return;
  ungatedNoted = true;
  createLogger({ context: { call: "connection.gate" } }).warn(
    "Connection reads are running ungated: the CreatorGrant table does not exist yet. Apply /api/admin/migrate-creator-grants.",
  );
}

/** For tests. */
export function resetConnectionGateLog(): void {
  ungatedNoted = false;
}

function orderFor(filter: ConnectionFilter): Prisma.CreatorSocialAccountOrderByWithRelationInput | undefined {
  if (filter.order === "oldest") return { createdAt: "asc" };
  if (filter.order === "newest") return { createdAt: "desc" };
  return undefined;
}

/**
 * A hand-entered row is the agency's note of who a creator is, never their
 * connection: its token is the literal "manual-entry" and no consent stands
 * behind it (plan A8). The grant check refuses one too, but only once the grant
 * table exists; before that this is the only lock, and an unordered first match
 * could hand a reader the typed-in row in place of the real connection beside
 * it on the same platform. NULL origin predates the column and stays readable.
 */
export const NOT_MANUAL_ORIGIN: Prisma.CreatorSocialAccountWhereInput = {
  OR: [{ origin: null }, { origin: { not: ACCOUNT_ORIGINS.MANUAL } }],
};

export async function connectionForRead(
  orgId: string,
  creatorId: string,
  platform: Platform,
  filter: ConnectionFilter = {},
): Promise<ConnectionRead> {
  /* The reader's filter goes under AND rather than being spread in, so its own
     OR or AND cannot displace the manual-row exclusion, and a creator, platform
     or org it names can only narrow the answer, never redirect it. */
  const where: Prisma.CreatorSocialAccountWhereInput = {
    AND: [filter.where ?? {}, NOT_MANUAL_ORIGIN],
    creatorId,
    platform,
    creator: { orgId },
  };
  const orderBy = orderFor(filter);

  if (!(await grantTablesReady())) {
    noteUngated();
    const row = await db.creatorSocialAccount.findFirst({
      where,
      select: READ_CONNECTION_SELECT,
      ...(orderBy ? { orderBy } : {}),
    });
    return row ? { ok: true, connection: row, grantId: null } : { ok: false, unknown: "no_connection" };
  }

  const rows = await db.creatorSocialAccount.findMany({
    where,
    select: READ_CONNECTION_SELECT,
    ...(orderBy ? { orderBy } : {}),
  });
  /* "no_grant" whether or not a row exists: from this org's side there is no
     difference, and the answer must not tell one agency that another holds a
     connection for the same person. */
  if (rows.length === 0) return { ok: false, unknown: "no_grant" };

  const grants = await db.creatorGrant.findMany({
    where: { orgId, revokedAt: null, connectionId: { in: rows.map((r) => r.id) } },
    select: { id: true, connectionId: true },
  });
  const grantByConnection = new Map(grants.map((g) => [g.connectionId, g.id]));
  const granted = rows.find((r) => grantByConnection.has(r.id));
  if (!granted) return { ok: false, unknown: "no_grant" };
  return { ok: true, connection: granted, grantId: grantByConnection.get(granted.id) ?? null };
}

/** The key grantedConnectionKeys answers in. */
export function grantKey(orgId: string, connectionId: string): string {
  return `${orgId}:${connectionId}`;
}

/**
 * The same rule for a reader that loads connections in bulk (the post sync
 * cron selects them inside its candidate query): which of these (org,
 * connection) pairs hold a live grant, as grantKey strings.
 *
 * null while the gate is open — use every row, as before. A failed lookup
 * answers the empty set: no connection is read without a grant on record, and
 * the posts are read the way an unconnected creator's are.
 */
export async function grantedConnectionKeys(
  pairs: { orgId: string; connectionId: string }[],
): Promise<Set<string> | null> {
  if (!(await grantTablesReady())) {
    noteUngated();
    return null;
  }
  const byOrg = new Map<string, Set<string>>();
  for (const { orgId, connectionId } of pairs) {
    if (!orgId || !connectionId) continue;
    const ids = byOrg.get(orgId) ?? new Set<string>();
    ids.add(connectionId);
    byOrg.set(orgId, ids);
  }
  if (byOrg.size === 0) return new Set();
  try {
    const grants = await db.creatorGrant.findMany({
      where: {
        revokedAt: null,
        OR: [...byOrg].map(([orgId, ids]) => ({ orgId, connectionId: { in: [...ids] } })),
      },
      select: { orgId: true, connectionId: true },
    });
    return new Set(
      grants.filter((g) => g.connectionId).map((g) => grantKey(g.orgId, g.connectionId as string)),
    );
  } catch (err) {
    createLogger({ context: { call: "connection.gate" } }).warn("Bulk grant lookup failed; reading without connections", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Set();
  }
}

/**
 * Whether a bulk reader may use `account` for `orgId`, given what
 * grantedConnectionKeys answered: the same two locks as connectionForRead. A
 * hand-entered row is refused outright, which matters while the gate is open
 * (`granted` null) and every row would otherwise pass.
 */
export function readableConnection(
  granted: Set<string> | null,
  orgId: string,
  account: { id: string; origin: string | null },
): boolean {
  if (account.origin === ACCOUNT_ORIGINS.MANUAL) return false;
  return granted === null || granted.has(grantKey(orgId, account.id));
}
