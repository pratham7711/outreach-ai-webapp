import type { Prisma } from "@/lib/generated/prisma/client";
import { platformLabel } from "@/lib/format";

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

/** The same test as handleProblem, for a query. */
export const HANDLE_PROBLEM_WHERE: Prisma.CreatorProfileLinkWhereInput = {
  OR: [
    { refreshError: { startsWith: "no-such-account" } },
    { platform: "INSTAGRAM", refreshError: { startsWith: "not-a-professional-account" } },
  ],
};

export function handleProblemText(platform: string, handle: string, problem: HandleProblem): string {
  const at = `@${handle.replace(/^@/, "")}`;
  return problem === "not-found"
    ? `${platformLabel(platform)} has no account called ${at}. The handle may be misspelt, or the account was renamed or deleted.`
    : `Instagram can't find a Business or Creator account called ${at}. The handle may be misspelt, or the account is personal or private.`;
}
