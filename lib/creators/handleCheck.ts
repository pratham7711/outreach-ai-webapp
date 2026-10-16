import type { Prisma } from "@/lib/generated/prisma/client";
import { formatFull, platformLabel } from "@/lib/format";

/**
 * Roster accounts the platform could not find, read from what the daily
 * profile refresh stored on the link (profileRefresh.ts), so an agency can fix
 * a handle that was misspelt on the sign-up form.
 *
 * TikTok and YouTube say outright that a handle does not exist. Instagram's
 * Business Discovery answers a misspelt handle and a personal or private
 * account with the same silence, so its flag has to name both. A rate limit is
 * never stored as either (the refresh skips the account and retries it), so a
 * busy hour cannot flag anyone.
 */
export type HandleProblem = "not-found" | "not-found-or-personal";

export function handleProblem(platform: string, refreshError: string | null | undefined): HandleProblem | null {
  const reason = refreshError?.split(/[:\n]/)[0].trim();
  if (reason === "no-such-account") return "not-found";
  if (reason === "not-a-professional-account" && platform === "INSTAGRAM") return "not-found-or-personal";
  return null;
}

/** An account the platform says does not exist: "not-found", for a query. */
export const HANDLE_GONE_WHERE: Prisma.CreatorProfileLinkWhereInput = { refreshError: { startsWith: "no-such-account" } };

/** An Instagram account Business Discovery cannot see: "not-found-or-personal", for a query. */
export const HANDLE_UNREADABLE_WHERE: Prisma.CreatorProfileLinkWhereInput = {
  platform: "INSTAGRAM",
  refreshError: { startsWith: "not-a-professional-account" },
};

/** The same test as handleProblem, for a query. */
export const HANDLE_PROBLEM_WHERE: Prisma.CreatorProfileLinkWhereInput = { OR: [HANDLE_GONE_WHERE, HANDLE_UNREADABLE_WHERE] };

/**
 * How long an account the platform says is gone waits before the automatic
 * jobs ask again.
 *
 * Both jobs used to retry it on their ordinary cadence, and the platform gave
 * the same answer every time. MEASURED on prod 2026-10-16: 220 tracked TikTok
 * creators read "no-such-account" on every creator sweep -- about one read in
 * eight -- and the roster refresh asked Business Discovery about 279 Instagram
 * accounts it cannot see once a day, ~280 Graph errors a day on the one shared
 * Meta account. A week still notices an account that comes back; editing the
 * handle puts it at the front of the queue, and the creator page's Refresh
 * reads it at once.
 */
export const DEAD_ACCOUNT_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

/** The same test as handleProblem, on the creator tracker's own stored error. */
export const TRACKER_HANDLE_PROBLEM_WHERE: Prisma.CreatorWhereInput = {
  OR: [
    { trackerLastError: { startsWith: "no-such-account" } },
    { platform: "INSTAGRAM", trackerLastError: { startsWith: "not-a-professional-account" } },
  ],
};

/**
 * Tracked creators an automatic sweep may read: everyone but an account the
 * platform said was gone at an attempt inside the last week.
 *
 * Written as an OR of what is allowed rather than a NOT of what is not, because
 * SQL's NOT over a NULL column is NULL, not true: `NOT (error LIKE ...)` alone
 * would drop every creator whose last read succeeded.
 */
export function trackerSweepableWhere(nowMs: number): Prisma.CreatorWhereInput {
  return {
    OR: [
      { trackerLastError: null },
      { trackerLastAttemptAt: null },
      { trackerLastAttemptAt: { lt: new Date(nowMs - DEAD_ACCOUNT_RECHECK_MS) } },
      { NOT: TRACKER_HANDLE_PROBLEM_WHERE },
    ],
  };
}

export function handleProblemText(platform: string, handle: string, problem: HandleProblem): string {
  const at = `@${handle.replace(/^@/, "")}`;
  return problem === "not-found"
    ? `${platformLabel(platform)} has no account called ${at}. It was deleted or renamed, or the handle is misspelt.`
    : `Instagram can't find a Business or Creator account called ${at}. It's personal, private or deleted, or the handle is misspelt.`;
}

/**
 * The roster banner. Each creator is counted once: `unreadable` holds only
 * creators with no account that is gone outright. Deleted and renamed accounts
 * lead because a roster audit found them to be nearly every flag, with a
 * misspelt handle the rare case.
 */
export function handleIssueSummary(gone: number, unreadable: number): string | null {
  const has = (n: number) => (n === 1 ? "has" : "have");
  const creators = (n: number) => `${formatFull(n)} ${n === 1 ? "creator" : "creators"}`;
  const ig = (n: number) => `${has(n)} an Instagram account that's personal, private or deleted, so its numbers can't be read.`;
  if (gone && unreadable) return `${creators(gone)} ${has(gone)} an account that was deleted or renamed. ${formatFull(unreadable)} more ${ig(unreadable)}`;
  if (gone) return `${creators(gone)} ${has(gone)} an account that was deleted or renamed.`;
  if (unreadable) return `${creators(unreadable)} ${ig(unreadable)}`;
  return null;
}
