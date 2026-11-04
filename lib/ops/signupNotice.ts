import { opsRecipients } from "@/lib/alerts";
import { sendEmail } from "@/lib/email";
import { createLogger } from "@/lib/observability/logger";

/**
 * Tells the operator that a new workspace signed up through /signup.
 *
 * Goes to ALERT_EMAIL_TO, the same people who get ops alerts, and to nobody
 * else: the person who signed up gets their own confirmation mail from
 * issueEmailVerification, not this one.
 *
 * Not routed through alertOps. That path stamps "[WARN]" on the subject and
 * suppresses a repeat within a day by subject with the digits masked, so two
 * workspaces called "Studio 1" and "Studio 2" would be one email. Every signup
 * is its own event and gets its own mail.
 *
 * Never throws: a notification about a signup must not be able to fail it.
 */

export type SignupNoticeInput = {
  orgId: string;
  userId: string;
  orgName: string;
  orgType: "AGENCY" | "BRAND";
  plan: string;
  ownerName: string;
  ownerEmail: string;
  verificationSent: boolean;
  origin: string;
  at?: Date;
};

/** Org and person names are typed by a stranger; keep them to one short line. */
function oneLine(value: string, max = 120): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function istTime(at: Date): string {
  return `${new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at)} IST`;
}

export function signupNoticeMessage(input: SignupNoticeInput): { subject: string; text: string } {
  const type = input.orgType === "BRAND" ? "Brand" : "Agency";
  const org = oneLine(input.orgName) || "(no name)";
  const owner = oneLine(input.ownerName) || "(no name)";
  const base = input.origin.replace(/\/+$/, "");
  const at = input.at ?? new Date();

  const text = [
    `A new ${type.toLowerCase()} just signed up.`,
    "",
    `Workspace:  ${org}`,
    `Type:       ${type}`,
    `Plan:       ${input.plan}`,
    `Owner:      ${owner} <${input.ownerEmail}>`,
    `Signed up:  ${istTime(at)}`,
    `Confirmation email to them: ${input.verificationSent ? "sent" : "NOT sent"}`,
    "",
    `All workspaces: ${base}/platform`,
    "",
    `org id:  ${input.orgId}`,
    `user id: ${input.userId}`,
  ].join("\n");

  return { subject: `New ${type.toLowerCase()} signup: ${org}`, text };
}

export async function notifyNewSignup(input: SignupNoticeInput): Promise<void> {
  const log = createLogger({ context: { lib: "signupNotice" } });
  try {
    const to = opsRecipients();
    if (to.length === 0) {
      log.warn("signup_notice.no_recipients", {
        message: "ALERT_EMAIL_TO is unset; the new signup was not emailed.",
        orgId: input.orgId,
      });
      return;
    }
    const { subject, text } = signupNoticeMessage(input);
    await sendEmail({
      /* Platform mail about one tenant: filed under that tenant so it shows
         in their email history, with the new owner as the entity. */
      kind: "ops_signup",
      orgId: input.orgId,
      entityId: input.userId,
      actorEmail: input.ownerEmail,
      to,
      subject,
      text,
      replyTo: input.ownerEmail,
    });
  } catch (err) {
    log.error("signup_notice.threw", {
      error: err instanceof Error ? err.message : String(err),
      orgId: input.orgId,
    });
  }
}
