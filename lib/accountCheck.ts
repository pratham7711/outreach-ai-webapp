import { db } from "@/lib/db";

/**
 * How stale a session's copy of role/isActive may get. The jwt callback in
 * lib/auth.ts re-reads the user's row once this has passed.
 */
export const ACCOUNT_CHECK_TTL_MS = 60_000;

/** The columns a live session is re-checked against, and the email banner reads. */
export type AccountRow = {
  role: string;
  isActive: boolean;
  campaignScope: string;
  orgId: string;
  email: string;
  emailVerified: Date | null;
};

/**
 * The last answer per user, on this server instance.
 *
 * The jwt callback stamps `checkedAt` into the token so the re-read happens at
 * most once a minute -- but `auth()` called from a server component or a route
 * handler cannot write a cookie, so that stamp was never persisted. Every call
 * more than a minute after sign-in re-read the row: measured 2026-10-13, an
 * authenticated route that runs no queries of its own took 237 ms against 2 ms
 * unauthenticated, and a dashboard page paid it three times (generateMetadata,
 * the layout, the page) plus a fourth read for the email banner.
 *
 * Keeping the answer here, in memory, gives the stamp somewhere to live. The
 * security bound is unchanged: a demotion, a removal or a deactivation is still
 * seen within ACCOUNT_CHECK_TTL_MS, on every instance, because no entry is ever
 * served past that age. A row that has gone is remembered as null, so a deleted
 * user is refused from memory too rather than re-queried on every request.
 */
const checks = new Map<string, { row: AccountRow | null; at: number }>();

/** Bound on remembered users per instance, so a long-lived instance cannot grow without limit. */
const MAX_ENTRIES = 5_000;

export type AccountCheck = { row: AccountRow | null; at: number };

/**
 * The user's row as of at most ACCOUNT_CHECK_TTL_MS ago, with the time it was
 * read. A database error propagates -- the caller decides what a blip means,
 * and the jwt callback keeps the session rather than signing everyone out.
 */
export async function readAccount(userId: string, now: number = Date.now()): Promise<AccountCheck> {
  const hit = checks.get(userId);
  if (hit && now - hit.at < ACCOUNT_CHECK_TTL_MS) return hit;

  const row = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, campaignScope: true, orgId: true, email: true, emailVerified: true },
  });
  const entry = { row: row as AccountRow | null, at: Date.now() };
  if (checks.size >= MAX_ENTRIES) {
    for (const [key, value] of checks) {
      if (entry.at - value.at >= ACCOUNT_CHECK_TTL_MS) checks.delete(key);
    }
    if (checks.size >= MAX_ENTRIES) checks.clear();
  }
  checks.set(userId, entry);
  return entry;
}

/**
 * Drops what this instance remembers about a user (or everyone), so the next
 * read goes to the database. For the writes that must show at once on the
 * instance that made them -- confirming an email address -- and for tests.
 */
export function forgetAccount(userId?: string): void {
  if (userId === undefined) checks.clear();
  else checks.delete(userId);
}
