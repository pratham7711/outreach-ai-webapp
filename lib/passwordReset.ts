import { createHash } from "crypto";

/**
 * Password reset tokens, as stored.
 *
 * The raw token goes into the emailed link and nowhere else; the
 * VerificationToken row holds its sha256. Before this the row held the raw
 * token, so anyone who could read that table -- a database copy, a support
 * query, a leaked backup -- held a working reset link for every account with
 * one outstanding, and with it the account. The column and its unique index
 * are unchanged: the hash is a 64-character hex string in the same `token`
 * column, and the lookup is by that hash.
 *
 * Tokens minted before this shipped were stored raw, so hashing what such a
 * link carries finds nothing and the link reads as invalid. They expire within
 * the hour anyway; the person requests a new one.
 *
 * Email verification tokens live in the same table under a different
 * identifier prefix and are not affected (lib/emailVerification.ts).
 */
export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** One answer for every way a link can be unusable: malformed, unknown,
 *  expired or for a removed account. Telling them apart helps nobody who holds
 *  a real link and tells a guesser which guesses came close. */
export const RESET_LINK_INVALID = "This reset link is invalid or has expired";
