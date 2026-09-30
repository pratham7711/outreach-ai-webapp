import { sendEmail } from "@/lib/email";
import { createLogger } from "@/lib/observability/logger";

/**
 * Operational alerts for the people running the platform (not for tenants).
 *
 * Call this ONLY at aggregation points -- the end of a cron run, a catch that
 * ends a whole job. Never inside a per-item fetch loop: when TikTok returns 429
 * for 500 posts we want one email saying "497/500 failed", not 500 emails.
 *
 * Once per run is not enough on its own, though: the post sync runs every six
 * hours, so a problem that outlives one run mailed four times a day. Each alert
 * is now sent at most once a day (alertSentWithin); the log line is still
 * written every time.
 */

export type Severity = "warn" | "critical";

export type AlertInput = {
  /** Stable short identifier, e.g. "sync-posts" or "tiktok-token". */
  source: string;
  title: string;
  /** Metric lines rendered into the body, e.g. { failed: 47, total: 50 }. */
  facts?: Record<string, unknown>;
  severity?: Severity;
};

/** Where ops mail goes. Falls back to the invoice address we already know. */
function recipients(): string[] {
  const raw = process.env.ALERT_EMAIL_TO || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderBody(input: AlertInput): string {
  const lines: string[] = [];
  lines.push(input.title, "");
  lines.push(`source:   ${input.source}`);
  lines.push(`severity: ${input.severity ?? "warn"}`);
  lines.push(`time:     ${new Date().toISOString()}`);
  const app = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (app) lines.push(`app:      ${app}`);
  if (input.facts && Object.keys(input.facts).length > 0) {
    lines.push("", "details:");
    for (const [k, v] of Object.entries(input.facts)) {
      lines.push(`  ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    }
  }
  return lines.join("\n");
}

/** How long an alert stays quiet after it has gone out. */
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * An alert's identity from one run to the next: its subject with every number
 * masked. Titles carry the run's counts ("90/170 attempts", "6 post(s)"), so the
 * same problem never has the same subject twice.
 */
export function alertKey(subject: string): string {
  return subject.replace(/\d+/g, "#");
}

/**
 * Has this alert already gone out inside the window?
 *
 * The store is EmailLog, which lib/email writes for every send attempt, so this
 * needs no table of its own and survives serverless the way a module-level
 * timestamp cannot: every cron run is a fresh instance.
 *
 * A "failed" send does not count, so a provider hiccup is retried next run
 * rather than silencing a real outage for a day. "not_configured" does count:
 * retrying an unconfigured provider only writes more rows. And a throttle that
 * cannot read its own history says no -- a duplicate email is a smaller
 * failure than none.
 */
export async function alertSentWithin(subject: string, windowMs = REPEAT_WINDOW_MS): Promise<boolean> {
  try {
    /* Imported here, not at the top, for the reason lib/email gives: a client
       component imports this module's types, and nothing reachable from the
       browser bundle may pull in a database client. */
    const { db } = await import("@/lib/db");
    const recent = await db.emailLog?.findMany?.({
      where: {
        kind: "ops_alert",
        status: { not: "failed" },
        createdAt: { gte: new Date(Date.now() - windowMs) },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { subject: true },
    });
    const key = alertKey(subject);
    return Boolean(recent?.some((row) => alertKey(row.subject) === key));
  } catch {
    return false;
  }
}

/**
 * Emits an operational alert. Always logs; emails when a provider and at least
 * one recipient are configured and the same alert has not gone out in the last
 * day. Never throws -- alerting must not be able to fail the work it is
 * reporting on.
 */
export async function alertOps(input: AlertInput): Promise<void> {
  const log = createLogger({ context: { lib: "alerts", source: input.source } });
  const severity = input.severity ?? "warn";

  // The log line is the durable record; email is the notification on top.
  log[severity === "critical" ? "error" : "warn"]("alert", {
    title: input.title,
    ...(input.facts ?? {}),
  });

  const to = recipients();
  if (to.length === 0) {
    log.warn("alert.no_recipients", {
      message: "ALERT_EMAIL_TO is unset; alert was logged but not emailed.",
    });
    return;
  }

  const subject = `[${severity === "critical" ? "CRITICAL" : "WARN"}] ${input.title}`;
  if (await alertSentWithin(subject)) {
    log.info("alert.repeat_suppressed", { title: input.title, windowHours: REPEAT_WINDOW_MS / 3_600_000 });
    return;
  }

  try {
    await sendEmail({
      /* No orgId on purpose: an ops alert is about the platform, usually a
         cron spanning every tenant, so filing it under one of them would be a
         lie. EmailLog.orgId is nullable for exactly this. */
      kind: "ops_alert",
      to,
      subject,
      text: renderBody(input),
    });
  } catch (err) {
    log.error("alert.dispatch_threw", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Decides whether a batch job's failure count is worth waking someone for.
 * A couple of failures in a large batch is normal platform noise (a deleted
 * post, a private account); most of a batch failing is an outage.
 */
export function shouldAlertOnBatch(opts: {
  failed: number;
  total: number;
  /** Never alert below this many failures, however bad the ratio looks. */
  minFailures?: number;
  /** Fraction of the batch that must fail. */
  ratio?: number;
}): boolean {
  const { failed, total } = opts;
  const minFailures = opts.minFailures ?? 5;
  const ratio = opts.ratio ?? 0.5;
  if (failed < minFailures) return false;
  if (total <= 0) return false;
  return failed / total >= ratio;
}
