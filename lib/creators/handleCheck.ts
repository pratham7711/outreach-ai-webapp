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
