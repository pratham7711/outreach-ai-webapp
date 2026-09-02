import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { sendEmail, emailConfigured } from "@/lib/email";
import { createLogger } from "@/lib/observability/logger";

/**
 * Proof that a signup address belongs to whoever typed it.
 *
 * This shares the VerificationToken table with the password-reset flow and
 * stays out of its way through the identifier prefix. That separation is load
 * bearing, not tidiness: reset-password refuses any row whose identifier does
 * not start with "reset:", and verifyEmailToken refuses any row that does not
 * start with "verify:". Without both checks a verification link -- which we
 * mail to an address we have NOT yet proven belongs to the account -- would
 * also work as a password-reset token for that account.
 */

const VERIFY_PREFIX = "verify:";

/** A day. Long enough to survive a night's sleep and a spam folder, short
    enough that a link resurfacing in an old mailbox is already dead. */
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export function verifyIdentifier(email: string): string {
  return `${VERIFY_PREFIX}${email.toLowerCase()}`;
}

/** The address a verify identifier belongs to, or null if this row belongs to
    some other flow. Callers must treat null as "not a verification token". */
export function emailFromVerifyIdentifier(identifier: string): string | null {
  if (!identifier.startsWith(VERIFY_PREFIX)) return null;
  const email = identifier.slice(VERIFY_PREFIX.length);
  return email.length > 0 ? email : null;
}

export function verifyUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
}

export function appOrigin(fallback: string): string {
  return process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || fallback;
}

export type IssueResult = {
  /** The link, always. Returned so a failed send is still recoverable by hand
      from the logs, the same escape hatch forgot-password keeps. */
  url: string;
  sent: boolean;
};

/**
 * Mint a fresh verification link for an address and mail it.
 *
 * Never throws. Signup calls this after the account already exists, and a mail
 * provider having a bad afternoon must not turn a created account into a 500 --
 * the user would retry, hit "email already exists", and be stuck with an
 * account they cannot verify and cannot recreate. A failed send leaves the
 * token in place, so the resend endpoint is enough to recover.
 */
export async function issueEmailVerification(opts: {
  email: string;
  name?: string | null;
  orgId?: string | null;
  userId?: string | null;
  origin: string;
}): Promise<IssueResult> {
  const log = createLogger({ context: { lib: "emailVerification" } });
  const email = opts.email.toLowerCase();
  const identifier = verifyIdentifier(email);
  const token = randomBytes(32).toString("hex");
  const url = verifyUrl(opts.origin, token);

  try {
    /* One live link per address. Minting a second without clearing the first
       would leave the older mail working, so a link the user has already been
       told to ignore stays valid for its full day. */
    await db.verificationToken.deleteMany({ where: { identifier } });
    await db.verificationToken.create({
      data: { identifier, token, expires: new Date(Date.now() + VERIFY_TTL_MS) },
    });
  } catch (e) {
    log.error("email_verification.token_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { url, sent: false };
  }

  if (!emailConfigured()) {
    log.warn("email_verification.provider_missing", {
      message: "No transactional email provider is configured; verification link was not emailed.",
      verifyUrl: url,
    });
    return { url, sent: false };
  }

  const greeting = opts.name?.trim() ? `${opts.name.trim()}, ` : "";
  const sent = await sendEmail({
    kind: "email_verification",
    orgId: opts.orgId ?? null,
    actorEmail: email,
    entityId: opts.userId ?? null,
    to: email,
    subject: `Confirm your email for ${BRAND.name}`,
    text: [
      `${greeting}confirm this is your email address so we know the account`,
      `reaches you.`,
      "",
      "Open this link within 24 hours:",
      url,
      "",
      "If you did not create this account, ignore this email. The link expires",
      "on its own and nothing else happens.",
    ].join("\n"),
  });

  if (!sent.sent) {
    log.error("email_verification.send_failed", { reason: sent.reason, verifyUrl: url });
  }
  return { url, sent: sent.sent };
}

export type VerifyOutcome =
  | { ok: true; userId: string; orgId: string; email: string; alreadyVerified: boolean }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Spend a verification token.
 *
 * Consumes every token for the address on success, so the link is single use
 * even though the effect is idempotent -- clicking twice reports success the
 * second time rather than "this link is not valid", because a mail client that
 * prefetches the link must not make the real click look broken.
 */
export async function verifyEmailToken(token: string): Promise<VerifyOutcome> {
  const record = await db.verificationToken.findUnique({ where: { token } });
  const email = record ? emailFromVerifyIdentifier(record.identifier) : null;
  /* A "reset:" row reaching here is not merely the wrong shape, it is a
     password-reset credential being offered to a flow that would spend it. */
  if (!record || !email) return { ok: false, reason: "invalid" };

  if (record.expires.getTime() < Date.now()) {
    await db.verificationToken.deleteMany({ where: { token } });
    return { ok: false, reason: "expired" };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, orgId: true, emailVerified: true },
  });
  if (!user) {
    await db.verificationToken.deleteMany({ where: { token } });
    return { ok: false, reason: "invalid" };
  }

  const alreadyVerified = user.emailVerified !== null;
  if (!alreadyVerified) {
    await db.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
  }
  await db.verificationToken.deleteMany({ where: { identifier: record.identifier } });

  return { ok: true, userId: user.id, orgId: user.orgId, email, alreadyVerified };
}

/**
 * The moment signup began sending a confirmation link.
 *
 * Enforcement keys off this rather than off `emailVerified` alone, because
 * every account that predates the feature has `emailVerified: null` and was
 * never given a link to click. Gating on the null by itself would have locked
 * out every existing user of the product -- including the owner -- the instant
 * enforcement was switched on, with no way back in, since the recovery flow is
 * behind the same login. This makes the switch safe to flip.
 */
export const VERIFY_ENFORCED_FROM = new Date("2026-09-02T00:00:00.000Z");

/**
 * Whether an otherwise-valid sign-in should be refused pending confirmation.
 *
 * Off unless REQUIRE_EMAIL_VERIFICATION=1. The banner and the mail do the work
 * by default; hard enforcement is a product decision with a lockout tail, so it
 * is a deliberate switch rather than something that arrives with a deploy.
 */
export function loginBlockedForUnverified(user: {
  emailVerified: Date | null;
  createdAt: Date;
}): boolean {
  if (process.env.REQUIRE_EMAIL_VERIFICATION !== "1") return false;
  if (user.emailVerified) return false;
  return user.createdAt.getTime() >= VERIFY_ENFORCED_FROM.getTime();
}
