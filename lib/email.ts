import { BRAND } from "@/lib/brand";
import { createLogger } from "@/lib/observability/logger";

/**
 * Transactional email via Resend's REST API.
 *
 * Deliberately no SDK: one fetch call is smaller than a dependency, and this
 * runs on Vercel where fetch is global.
 *
 * Unconfigured behaviour is a no-op that logs loudly rather than a throw. A
 * missing provider must never take down a cron run or a password-reset request
 * -- the caller's own flow is more important than the notification.
 *
 * Every attempt is recorded to EmailLog before this function returns, including
 * the ones that never reach the provider. That record lives here rather than at
 * the call sites because a call site that forgets is invisible: the mail simply
 * has no history and nobody finds out until someone asks why a customer never
 * got their invite. There is exactly one way out of this module, so there is
 * exactly one place that has to remember.
 */

const ENDPOINT = "https://api.resend.com/emails";

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: "not-configured" | "failed" };

/** What the message was for. Stored as-is, so keep these slugs stable. */
export type EmailKind =
  | "invite"
  | "invite_resend"
  | "password_reset"
  | "notification"
  | "ops_alert"
  | "unknown";

type EmailContext = {
  kind?: EmailKind;
  /** Null for platform mail that belongs to no tenant. */
  orgId?: string | null;
  actorEmail?: string | null;
  entityId?: string | null;
};

/**
 * Writes the EmailLog row. Never throws and never delays the caller's own
 * outcome: the send has already happened by the time this runs, so a database
 * hiccup here must not turn a delivered email into a reported failure.
 */
async function recordEmail(
  ctx: EmailContext,
  fields: {
    recipients: string[];
    subject: string;
    status: "sent" | "failed" | "not_configured";
    providerId?: string | null;
    error?: string | null;
  }
): Promise<void> {
  try {
    /* Imported here rather than at the top of the file. A static import would
       put Prisma behind every module that can send mail -- lib/alerts is
       imported by cron code and by a jsdom-environment test that has no
       TextEncoder, and neither of them should be loading a database client to
       decide whether to send an email. */
    const { db } = await import("@/lib/db");

    /* Same defensive shape as logAudit: unit tests hand this module a partial
       db mock, and a missing model must degrade to "not recorded", not to a
       TypeError thrown out of a password reset. */
    const emailLog = (db as any)?.emailLog;
    if (!emailLog?.create) return;

    await db.emailLog.create({
      data: {
        orgId: ctx.orgId ?? null,
        kind: ctx.kind ?? "unknown",
        recipients: fields.recipients,
        subject: fields.subject,
        status: fields.status,
        providerId: fields.providerId ?? null,
        error: fields.error ? fields.error.slice(0, 500) : null,
        actorEmail: ctx.actorEmail ?? null,
        entityId: ctx.entityId ?? null,
      },
    });
  } catch (e) {
    createLogger({ context: { lib: "email" } }).error("email.log_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

function senderAddress(): string {
  // Must be on a Resend-verified domain. madeboring.com is ours.
  //
  // The display name comes from BRAND rather than a literal: this was still
  // "Outreach AI" long after the rebrand, so every alert and password reset
  // arrived from a product that no longer exists, on the new domain.
  return process.env.EMAIL_FROM || `${BRAND.name} <alerts@madeboring.com>`;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(
  opts: {
    to: string | string[];
    subject: string;
    text: string;
    replyTo?: string;
  } & EmailContext
): Promise<SendResult> {
  const log = createLogger({ context: { lib: "email" } });
  const key = process.env.RESEND_API_KEY;
  const to = Array.isArray(opts.to) ? opts.to : [opts.to];

  if (!key) {
    log.warn("email.not_configured", {
      message: "RESEND_API_KEY is unset; email was not sent.",
      subject: opts.subject,
    });
    await recordEmail(opts, {
      recipients: to,
      subject: opts.subject,
      status: "not_configured",
      error: "RESEND_API_KEY is unset",
    });
    return { sent: false, reason: "not-configured" };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: senderAddress(),
        to,
        subject: opts.subject,
        text: opts.text,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
      // A hung provider must not hold a cron function open for 300s.
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error("email.send_failed", { status: res.status, body: body.slice(0, 300) });
      await recordEmail(opts, {
        recipients: to,
        subject: opts.subject,
        status: "failed",
        error: `HTTP ${res.status}: ${body.slice(0, 300)}`,
      });
      return { sent: false, reason: "failed" };
    }

    const json = (await res.json().catch(() => ({}))) as { id?: string };
    log.info("email.sent", { subject: opts.subject, recipients: to.length });
    await recordEmail(opts, {
      recipients: to,
      subject: opts.subject,
      status: "sent",
      providerId: json.id ?? null,
    });
    return { sent: true, id: json.id ?? "unknown" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("email.send_threw", { error: message });
    await recordEmail(opts, {
      recipients: to,
      subject: opts.subject,
      status: "failed",
      error: message,
    });
    return { sent: false, reason: "failed" };
  }
}
