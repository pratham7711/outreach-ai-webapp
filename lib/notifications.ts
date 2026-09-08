import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import { NOTIFICATION_EVENTS, isNotifiableAction, notificationEvent } from "@/lib/notificationCatalog";
import type { NotificationEventDef } from "@/lib/notificationCatalog";

/**
 * Team notifications — the reference's Settings → Notifications, and its Slack
 * integration, in one module.
 *
 * Everything notifiable already flows through logAudit with a stable action
 * string, so the catalog — lib/notificationCatalog.ts, split out so a client
 * component can read it without importing Prisma — is keyed by those actions
 * rather than inventing a parallel event vocabulary. An action that is not in
 * the catalog can never notify anyone; adding a row there is the whole act of
 * making it notifiable.
 *
 * Two delivery channels, configured in two different places on purpose:
 *  - Email is a PER-USER choice, stored on User.notificationPrefs, because
 *    "email me when a creator accepts" is a personal tolerance, not a policy.
 *  - Slack is a PER-ORG choice, stored in Organization.uiConfig under
 *    integrations.slack, because a channel is shared by definition.
 *
 * Defaults matter more than the toggles: several actions (post.auto_approved
 * especially) fire from cron sweeps, once per post. Those default OFF on both
 * channels, and their descriptions say why, so someone turning them on is
 * doing it with open eyes.
 */

/* Re-exported so the modules that already import the catalog from here keep
   working. */
export type { NotificationGroup, NotificationEventDef } from "@/lib/notificationCatalog";
export { NOTIFICATION_EVENTS, isNotifiableAction } from "@/lib/notificationCatalog";

/**
 * Stored prefs are a sparse override map; the catalog's defaults fill the rest.
 * Junk in the JSON column (wrong types, retired keys) is ignored rather than
 * trusted — the column is written by our API but read forever.
 */
export function resolvePrefs(stored: unknown): Record<string, boolean> {
  const overrides =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const out: Record<string, boolean> = {};
  for (const def of NOTIFICATION_EVENTS) {
    const v = overrides[def.key];
    out[def.key] = typeof v === "boolean" ? v : def.defaultOn;
  }
  return out;
}

/** Slack config as stored in Organization.uiConfig.integrations.slack. */
export type SlackIntegration = {
  webhookUrl?: string;
  /** Display label only — an incoming webhook is bound to its channel at creation. */
  channel?: string;
  connectedAt?: string;
  /** Sparse per-event overrides, same keys and defaults as email. */
  events?: Record<string, boolean>;
};

export function readSlackIntegration(uiConfig: unknown): SlackIntegration | null {
  if (!uiConfig || typeof uiConfig !== "object") return null;
  const integrations = (uiConfig as Record<string, unknown>).integrations;
  if (!integrations || typeof integrations !== "object") return null;
  const slack = (integrations as Record<string, unknown>).slack;
  if (!slack || typeof slack !== "object") return null;
  return slack as SlackIntegration;
}

/** Only a real Slack incoming-webhook URL is accepted — this URL receives POSTs
    with org activity in them, so it must not be pointable at an arbitrary host. */
export function isSlackWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "hooks.slack.com" && u.pathname.startsWith("/services/");
  } catch {
    return false;
  }
}

/* AbortSignal.timeout is not present in every runtime this executes under
   (jsdom in tests, notably) — same guard idiom as fetchPostMetrics.ts. */
function timeoutSignal(ms: number): AbortSignal | undefined {
  const t = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  return typeof t === "function" ? t.call(AbortSignal, ms) : undefined;
}

export async function postToSlack(webhookUrl: string, text: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: timeoutSignal(5_000),
    });
    if (!res.ok) return { ok: false, detail: `Slack answered ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export function formatNotification(def: NotificationEventDef, params: {
  entityLabel?: string | null;
  actorName?: string | null;
}): string {
  const subject = params.entityLabel ? ` — ${params.entityLabel}` : "";
  const actor = params.actorName ? ` · by ${params.actorName}` : "";
  return `${def.glyph} ${def.label}${subject}${actor}`;
}

/**
 * The single dispatch point, called from logAudit (and directly for comments,
 * which do not write audit rows). Must never throw and never block the caller
 * for long: every network call is individually time-boxed, and a non-cataloged
 * action returns before touching the database.
 */
export async function notifyAuditEvent(params: {
  orgId: string;
  action: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  entityLabel?: string | null;
}): Promise<void> {
  const def = notificationEvent(params.action);
  if (!def) return;

  const log = createLogger({ context: { lib: "notifications", action: params.action } });

  try {
    const [org, users] = await Promise.all([
      db.organization.findUnique({
        where: { id: params.orgId },
        select: { uiConfig: true, name: true },
      }),
      db.user.findMany({
        where: { orgId: params.orgId, isActive: true },
        select: { id: true, email: true, name: true, notificationPrefs: true },
      }),
    ]);
    if (!org) return;

    const actor =
      (params.actorUserId && users.find((u) => u.id === params.actorUserId)?.name) ||
      (params.actorEmail ? params.actorEmail.split("@")[0] : null);
    const text = formatNotification(def, { entityLabel: params.entityLabel, actorName: actor });

    const jobs: Promise<unknown>[] = [];

    const slack = readSlackIntegration(org.uiConfig);
    if (slack?.webhookUrl) {
      const override = slack.events?.[def.key];
      const wanted = typeof override === "boolean" ? override : def.defaultOn;
      if (wanted) {
        jobs.push(
          postToSlack(slack.webhookUrl, text).then((r) => {
            if (!r.ok) log.warn("notifications.slack_failed", { detail: r.detail });
          })
        );
      }
    }

    /* No email here, deliberately. Product email is limited to the three
       transactional messages a user is expecting because they just acted:
       signup, password reset and invites. Activity notifications are not that
       -- they fired off the audit stream, so every campaign created, campaign
       edited, creator added or removed, comment and offer decision mailed the
       whole org, seven of them on by default. Creating one campaign mailed
       every teammate.

       Slack above is unaffected: it is an org-level webhook an admin opts into
       once, which is the right shape for activity chatter. */

    if (jobs.length) await Promise.all(jobs);
  } catch (e) {
    // A notification is never worth failing the action that caused it.
    log.warn("notifications.dispatch_failed", { detail: e instanceof Error ? e.message : String(e) });
  }
}
