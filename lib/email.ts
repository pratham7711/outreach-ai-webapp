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
 */

const ENDPOINT = "https://api.resend.com/emails";

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: "not-configured" | "failed" };

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

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<SendResult> {
  const log = createLogger({ context: { lib: "email" } });
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    log.warn("email.not_configured", {
      message: "RESEND_API_KEY is unset; email was not sent.",
      subject: opts.subject,
    });
    return { sent: false, reason: "not-configured" };
  }

  const to = Array.isArray(opts.to) ? opts.to : [opts.to];

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
      return { sent: false, reason: "failed" };
    }

    const json = (await res.json().catch(() => ({}))) as { id?: string };
    log.info("email.sent", { subject: opts.subject, recipients: to.length });
    return { sent: true, id: json.id ?? "unknown" };
  } catch (err) {
    log.error("email.send_threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { sent: false, reason: "failed" };
  }
}
