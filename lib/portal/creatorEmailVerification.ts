import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { sendEmail, emailConfigured } from "@/lib/email";
import { createLogger } from "@/lib/observability/logger";
import { isMissingJoinLinkTable } from "@/lib/creators/joinLinkDdl";
export { appOrigin } from "@/lib/emailVerification";

/**
 * A creator portal account is usable only once its email is confirmed: sign-up
 * makes the account and mails a link, and no session is handed out (sign-up,
 * sign-in, or an old cookie) until that link has been opened.
 *
 * Tokens share the VerificationToken table with the agency's own email
 * confirmation and password reset, kept apart by the identifier prefix. The
 * agency flow accepts only "verify:" and reset only "reset:", so a creator's
 * link can never be spent by either, and theirs never by this one.
 */

const PREFIX = "creator-verify:";
export const CREATOR_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** A second link inside this window is not minted: a double-clicked button or a
    retried sign-in must not bury the first mail under a second one. */
const RESEND_GAP_MS = 60 * 1000;
/** Accounts made before confirmation began are never treated as abandoned
    sign-ups, whatever they hold. */
export const CREATOR_VERIFY_FROM = new Date("2026-11-23T00:00:00.000Z");

export function creatorVerifyIdentifier(email: string): string {
  return `${PREFIX}${email.toLowerCase()}`;
}

export type CreatorEmailState = "verified" | "unverified" | "unavailable";

/** "unavailable" only while the table does not exist yet (between a deploy and its DDL). */
export async function creatorEmailState(creatorUserId: string): Promise<CreatorEmailState> {
  try {
    const row = await db.creatorEmailVerification.findUnique({ where: { creatorUserId }, select: { creatorUserId: true } });
    return row ? "verified" : "unverified";
  } catch (e) {
    if (isMissingJoinLinkTable(e)) return "unavailable";
    throw e;
  }
}

export function creatorVerifyUrl(origin: string, token: string, errandQuery: string): string {
  const extra = errandQuery.startsWith("?") ? `&${errandQuery.slice(1)}` : "";
  return `${origin.replace(/\/+$/, "")}/portal/verify-email?token=${encodeURIComponent(token)}${extra}`;
}

export type CreatorIssueResult = { url: string | null; sent: boolean; reused: boolean };

/**
 * Mints a link for the address and mails it. Never throws: the account already
 * exists, and a mail provider failing must leave a resend to recover with, not
 * a 500 that sends the creator back to "email already registered".
 */
export async function issueCreatorVerification(opts: {
  email: string;
  name?: string | null;
  origin: string;
  /** The errand (join link, invite...) to carry on with once confirmed. */
  errandQuery?: string;
}): Promise<CreatorIssueResult> {
  const log = createLogger({ context: { lib: "creatorEmailVerification" } });
  const email = opts.email.toLowerCase();
  const identifier = creatorVerifyIdentifier(email);
  const token = randomBytes(32).toString("hex");
  const url = creatorVerifyUrl(opts.origin, token, opts.errandQuery ?? "");

  try {
    const live = await db.verificationToken.findFirst({ where: { identifier }, orderBy: { expires: "desc" }, select: { expires: true } });
    if (live && live.expires.getTime() - CREATOR_VERIFY_TTL_MS > Date.now() - RESEND_GAP_MS) {
      return { url: null, sent: true, reused: true };
    }
    await db.verificationToken.deleteMany({ where: { identifier } });
    await db.verificationToken.create({ data: { identifier, token, expires: new Date(Date.now() + CREATOR_VERIFY_TTL_MS) } });
  } catch (e) {
    log.error("creator_verification.token_failed", { error: e instanceof Error ? e.message : String(e) });
    return { url, sent: false, reused: false };
  }

  if (!emailConfigured()) {
    log.warn("creator_verification.provider_missing", { verifyUrl: url });
    return { url, sent: false, reused: false };
  }

  const greeting = opts.name?.trim() ? `${opts.name.trim()}, ` : "";
  const sent = await sendEmail({
    kind: "email_verification",
    orgId: null,
    actorEmail: email,
    to: email,
    subject: `Confirm your email for ${BRAND.name}`,
    text: [
      `${greeting}open this link to confirm your email and finish creating your creator account.`,
      "",
      "It works for 24 hours:",
      url,
      "",
      "If you did not sign up, ignore this email. The link expires on its own and nothing else happens.",
    ].join("\n"),
  });
  if (!sent.sent) log.error("creator_verification.send_failed", { reason: sent.reason, verifyUrl: url });
  return { url, sent: sent.sent, reused: false };
}

export type CreatorVerifyOutcome =
  | { ok: true; creatorUserId: string; email: string; alreadyVerified: boolean }
  | { ok: false; reason: "invalid" | "expired" };

/** Spends a link: confirms the address and clears every link for it. */
export async function verifyCreatorEmailToken(token: string): Promise<CreatorVerifyOutcome> {
  const record = await db.verificationToken.findUnique({ where: { token } });
  if (!record || !record.identifier.startsWith(PREFIX)) return { ok: false, reason: "invalid" };
  const email = record.identifier.slice(PREFIX.length);

  if (record.expires.getTime() < Date.now()) {
    await db.verificationToken.deleteMany({ where: { token } });
    return { ok: false, reason: "expired" };
  }

  const user = await db.creatorUser.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) {
    await db.verificationToken.deleteMany({ where: { token } });
    return { ok: false, reason: "invalid" };
  }

  const existing = await db.creatorEmailVerification.findUnique({ where: { creatorUserId: user.id }, select: { creatorUserId: true } });
  if (!existing) await db.creatorEmailVerification.create({ data: { creatorUserId: user.id } });
  await db.verificationToken.deleteMany({ where: { identifier: record.identifier } });
  return { ok: true, creatorUserId: user.id, email: user.email, alreadyVerified: Boolean(existing) };
}

/**
 * Frees an email or handle held by a sign-up nobody confirmed within the
 * link's lifetime, so typing someone else's address cannot lock them out of
 * signing up. Only a confirmation-era account that never got further than the
 * form: no session, roster row, connection, proposal or message.
 */
export async function clearAbandonedSignup(where: { email: string } | { handle: string }): Promise<number> {
  const { count } = await db.creatorUser.deleteMany({
    where: {
      ...where,
      emailVerification: { is: null },
      createdAt: { gte: CREATOR_VERIFY_FROM, lt: new Date(Date.now() - CREATOR_VERIFY_TTL_MS) },
      sessions: { none: {} },
      rosterRows: { none: {} },
      socialAccounts: { none: {} },
      proposals: { none: {} },
      testimonials: { none: {} },
      payoutRequests: { none: {} },
      conversations: { none: {} },
    },
  });
  return count;
}
