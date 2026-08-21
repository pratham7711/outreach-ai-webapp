import { sendEmail } from "@/lib/email";
import { createLogger } from "@/lib/observability/logger";

/**
 * Operational alerts for the people running the platform (not for tenants).
 *
 * Call this ONLY at aggregation points -- the end of a cron run, a catch that
 * ends a whole job. Never inside a per-item fetch loop: when TikTok returns 429
 * for 500 posts we want one email saying "497/500 failed", not 500 emails.
 * That is why there is no throttle store here; the call sites are already
 * once-per-run, which is the only rate limit that survives serverless.
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

/**
 * Emits an operational alert. Always logs; emails when a provider and at least
 * one recipient are configured. Never throws -- alerting must not be able to
 * fail the work it is reporting on.
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

  try {
    await sendEmail({
      to,
      subject: `[${severity === "critical" ? "CRITICAL" : "WARN"}] ${input.title}`,
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
