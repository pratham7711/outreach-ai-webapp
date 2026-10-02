import { db } from "@/lib/db";
import { connectTablesReady } from "@/lib/creators/connectTables";
import { createLogger } from "@/lib/observability/logger";

/**
 * Reads and writes of CreatorAccountState — per-connection facts that
 * CreatorSocialAccount has no column for (see the model in schema.prisma).
 *
 * Every function here asks connectTablesReady() first and never throws. Absent
 * table, failed query: the answer is "nothing recorded", which is what every
 * connection meant before the table existed. A connection must never fail, and
 * a read must never stop, because this bookkeeping could not be written.
 */

export type AccountState = {
  grantorUserId: string | null;
  reconnectNeededAt: Date | null;
  reconnectReason: string | null;
  displayName: string | null;
};

const STATE_SELECT = {
  accountId: true,
  grantorUserId: true,
  reconnectNeededAt: true,
  reconnectReason: true,
  displayName: true,
} as const;

const log = () => createLogger({ context: { call: "account.state" } });

/** The recorded state of several connections, keyed by account id. */
export async function accountStatesFor(
  accountIds: string[],
): Promise<Map<string, AccountState>> {
  const out = new Map<string, AccountState>();
  if (accountIds.length === 0) return out;
  if (!(await connectTablesReady())) return out;
  try {
    const rows = await db.creatorAccountState.findMany({
      where: { accountId: { in: accountIds } },
      select: STATE_SELECT,
    });
    for (const { accountId, ...state } of rows) out.set(accountId, state);
  } catch (err) {
    log().warn("Account state read failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

/** Whether a connection is marked "Reconnect needed". */
export async function isReconnectNeeded(accountId: string): Promise<boolean> {
  const state = (await accountStatesFor([accountId])).get(accountId);
  return Boolean(state?.reconnectNeededAt);
}

/**
 * Marks a connection "Reconnect needed" and returns whether it was recorded.
 *
 * Deliberately a mark and never a delete: the signal that sets it (Google's
 * invalid_grant) fires for every YouTube connection every seven days while the
 * Google app is in Testing mode, so deleting on it would wipe them all weekly.
 * The row, its token and its history all stay; the reconnect clears the mark.
 */
export async function markReconnectNeeded(accountId: string, reason: string): Promise<boolean> {
  if (!(await connectTablesReady())) return false;
  try {
    const now = new Date();
    await db.creatorAccountState.upsert({
      where: { accountId },
      create: { accountId, reconnectNeededAt: now, reconnectReason: reason },
      update: { reconnectNeededAt: now, reconnectReason: reason },
    });
    return true;
  } catch (err) {
    log().warn("Could not mark a connection Reconnect needed", {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * What a completed consent records. `undefined` leaves a field as it is, so a
 * platform that has no grantor id (TikTok, YouTube, Threads) never wipes one.
 * The reconnect mark is always cleared: a fresh grant is exactly what it was
 * waiting for.
 */
export async function recordConnectionState(
  accountId: string,
  fields: { grantorUserId?: string | null; displayName?: string | null },
): Promise<void> {
  if (!(await connectTablesReady())) return;
  const data = {
    ...(fields.grantorUserId !== undefined ? { grantorUserId: fields.grantorUserId } : {}),
    ...(fields.displayName !== undefined ? { displayName: fields.displayName } : {}),
    reconnectNeededAt: null,
    reconnectReason: null,
  };
  try {
    await db.creatorAccountState.upsert({
      where: { accountId },
      create: { accountId, ...data },
      update: data,
    });
  } catch (err) {
    log().warn("Could not record connection state", {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Stores the display name from a stats refresh without touching the mark. */
export async function recordDisplayName(accountId: string, displayName: string | null): Promise<void> {
  if (!(await connectTablesReady())) return;
  try {
    await db.creatorAccountState.upsert({
      where: { accountId },
      create: { accountId, displayName },
      update: { displayName },
    });
  } catch (err) {
    log().warn("Could not record display name", {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Stores the grantor id found by the backfill without touching the mark. */
export async function recordGrantor(accountId: string, grantorUserId: string): Promise<boolean> {
  if (!(await connectTablesReady())) return false;
  try {
    await db.creatorAccountState.upsert({
      where: { accountId },
      create: { accountId, grantorUserId },
      update: { grantorUserId },
    });
    return true;
  } catch (err) {
    log().warn("Could not record grantor", {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Every connection a Meta user granted, by the id Meta's callbacks send. */
export async function accountIdsForGrantor(grantorUserId: string): Promise<string[]> {
  if (!grantorUserId) return [];
  if (!(await connectTablesReady())) return [];
  try {
    const rows = await db.creatorAccountState.findMany({
      where: { grantorUserId },
      select: { accountId: true },
    });
    return rows.map((r) => r.accountId);
  } catch (err) {
    log().warn("Grantor lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
