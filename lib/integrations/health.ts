import { unstable_cache } from "next/cache";
import { alertOps } from "@/lib/alerts";
import { createLogger } from "@/lib/observability/logger";

/**
 * Is the platform's own Instagram data source alive?
 *
 * INSTAGRAM_BUSINESS_TOKEN is the only credential that yields Instagram *views*
 * (Business Discovery; see lib/platforms/instagramBusinessDiscovery.ts). When it
 * dies, lib/platforms/fetchPostMetrics falls through to the public embed, which
 * carries likes and comments but no view count -- so nothing errors, no post is
 * marked failed, and the only symptom is that view numbers stop moving. That
 * happened for ~2 days in production with a single log line as the only signal.
 * This turns the silence into something a page can render and a cron can email
 * about.
 *
 * The probe is `me/accounts`, not a business_discovery read, because that is the
 * call whose 190 the production logs actually carry and because it needs no
 * creator handle to be meaningful. It is also the call the creator-token path
 * depends on, so one round trip answers for both.
 *
 * This is platform-level, not per-tenant: one env var serves every org, so there
 * is nothing here to filter by orgId.
 */

const GRAPH = "https://graph.facebook.com/v26.0";

/** One Graph round trip, bounded. The callers are page renders and a cron. */
const PROBE_TIMEOUT_MS = 8_000;

/**
 * How long one answer is reused. A page load must not cost a Graph call, and a
 * dead token does not come back to life between two dashboard visits -- but 5
 * minutes is short enough that an operator who has just replaced the token sees
 * the banner clear while they are still looking at it.
 */
export const HEALTH_TTL_SECONDS = 300;

export type InstagramSourceHealth =
  | {
      ok: true;
      /** Facebook Pages with a linked instagram_business_account. */
      igAccounts: number;
      checkedAt: string;
    }
  | {
      ok: false;
      /** Graph's own error code, when Graph answered. Null when it did not. */
      code: number | null;
      reason: string;
      checkedAt: string;
    };

/* Graph reports an unusable token as 190; 102 is the session variant. Both are
   the same remedy -- someone mints a new token -- and both are the ones prod is
   seeing, so they get the sentence a non-engineer can act on rather than a code. */
const EXPIRED_CODES = new Set([190, 102]);

/** The only two shapes this module reads: Graph's error envelope, and the page
 *  list. Everything else in the response is deliberately ignored. */
type GraphBody = { error?: { code?: unknown; message?: unknown }; data?: unknown };

function reasonFor(status: number, code: number | null, message: string | null): string {
  if (code !== null && EXPIRED_CODES.has(code)) return "token expired or revoked";
  if (status === 403) return "token is missing a required permission";
  /* The Graph message is echoed only when there is no better mapping, because an
     unmapped code with no text is a dead end for whoever reads the banner. It is
     Meta's prose about our request, never our token -- the token travels in the
     query string of the outbound call and is not reflected in an error body. */
  if (message) return message;
  return `Instagram returned HTTP ${status}`;
}

/**
 * The probe itself, with no caching. Exported for tests; call the cached wrapper
 * everywhere else.
 */
export async function checkInstagramBusinessSourceUncached(): Promise<InstagramSourceHealth> {
  const checkedAt = new Date().toISOString();
  const token = process.env.INSTAGRAM_BUSINESS_TOKEN;
  if (!token) {
    return { ok: false, code: null, reason: "not configured", checkedAt };
  }

  const log = createLogger({ context: { platform: "INSTAGRAM", call: "health.me/accounts" } });
  const url = new URL(`${GRAPH}/me/accounts`);
  url.searchParams.set("fields", "instagram_business_account{id,username}");
  url.searchParams.set("limit", "50");
  url.searchParams.set("access_token", token);

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  } catch (err) {
    /* Our own network or deadline, not a verdict on the token. Named separately
       so nobody is sent to replace a credential that was never asked. */
    return {
      ok: false,
      code: null,
      reason: `could not reach Instagram (${err instanceof Error ? err.message : String(err)})`,
      checkedAt,
    };
  }

  let body: GraphBody | null = null;
  try {
    body = (await res.json()) as GraphBody;
  } catch {
    // Non-JSON body; the status alone has to carry the diagnosis.
  }

  if (!res.ok) {
    const code = typeof body?.error?.code === "number" ? (body.error.code as number) : null;
    const message = typeof body?.error?.message === "string" ? (body.error.message as string) : null;
    /* Logged without the token, and without the URL that carries it. */
    log.error("Instagram source probe failed", { status: res.status, code });
    return { ok: false, code, reason: reasonFor(res.status, code, message), checkedAt };
  }

  const pages: unknown[] = Array.isArray(body?.data) ? body.data : [];
  const igAccounts = pages.filter(
    (p) => (p as { instagram_business_account?: unknown })?.instagram_business_account,
  ).length;

  /* A 200 with no linked account is still a down source: Business Discovery is
     queried *from* an IG user id, so with none to query from every lookup returns
     null exactly as it does with a dead token. Reporting that as healthy would
     leave the same silence this module exists to break. */
  if (igAccounts === 0) {
    return {
      ok: false,
      code: null,
      reason: "no Instagram Business account is linked to the connected Facebook Page",
      checkedAt,
    };
  }

  return { ok: true, igAccounts, checkedAt };
}

/**
 * Cached across the deployment, not per instance: `unstable_cache` shares the
 * entry through Next's incremental cache, so N concurrent page renders cost one
 * Graph call rather than one each. The bucket in the key is belt and braces --
 * `revalidate` alone has been enough elsewhere, but a stuck entry here would
 * show a stale "down" banner after the token was fixed.
 */
export async function checkInstagramBusinessSource(): Promise<InstagramSourceHealth> {
  const bucket = Math.floor(Date.now() / (HEALTH_TTL_SECONDS * 1000));
  const cached = unstable_cache(
    () => checkInstagramBusinessSourceUncached(),
    ["instagram-source-health", String(bucket)],
    { revalidate: HEALTH_TTL_SECONDS },
  );
  try {
    return await cached();
  } catch (err) {
    /* Same fallback as lib/reports/campaignPerformance: unstable_cache needs
       Next's incremental cache in the surrounding context, and scripts, jest and
       anything outside a server request have none. There, an absent cache is not
       an error -- just probe. */
    if (!(err instanceof Error) || !err.message.includes("incrementalCache missing")) throw err;
    return checkInstagramBusinessSourceUncached();
  }
}

/**
 * The one email a dead token earns, at most once a day.
 *
 * Wording matches the banner deliberately: whoever reads the mail and whoever
 * reads the dashboard should be looking at the same sentence.
 */
const ALERT_TITLE = "Instagram views are not refreshing — the Instagram data connection was rejected";
/* alertOps composes the subject as `[WARN] <title>`; the dedupe below matches on
   the composed string, so the two must be built the same way. */
const ALERT_SEVERITY = "warn" as const;
const ALERT_SUBJECT = `[WARN] ${ALERT_TITLE}`;
const ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Has this alert already gone out inside the window?
 *
 * The throttle store is EmailLog, which lib/email writes for every send attempt
 * -- so the rate limit needs no new table and no new column, and it survives
 * serverless the way an in-memory flag cannot: the cron runs in a fresh instance
 * every hour, so a module-level timestamp would let through 24 emails a day.
 *
 * A row is counted whatever its status. "failed" and "not_configured" still mean
 * this run already tried, and retrying an unconfigured provider hourly produces
 * nothing but EmailLog rows.
 */
async function alreadyAlertedToday(): Promise<boolean> {
  try {
    /* Imported here, not at the top: this module's type is imported by a client
       component, and lib/email documents the same reason -- nothing that can be
       reached from the browser bundle should pull in a database client. */
    const { db } = await import("@/lib/db");
    const recent = await db.emailLog?.findFirst?.({
      where: {
        kind: "ops_alert",
        subject: ALERT_SUBJECT,
        createdAt: { gte: new Date(Date.now() - ALERT_INTERVAL_MS) },
      },
      select: { id: true },
    });
    return Boolean(recent);
  } catch {
    /* A throttle that cannot read its own history must not silence the alert --
       a duplicate email is a smaller failure than no email. */
    return false;
  }
}

/**
 * Called once at the end of a cron run that saw Instagram credentials rejected.
 *
 * The rejection count is only the trigger; this probe is the diagnosis, because
 * "credentials-rejected" on an Instagram post can equally mean one creator's own
 * token lapsed, which is not an operator's job and must not page anyone. Only a
 * failing platform probe sends mail.
 *
 * Returns what it did, so the cron can report it. Never throws: alerting must
 * not be able to fail the run it is reporting on.
 */
export async function alertIfInstagramSourceDown(facts: {
  rejectedPosts: number;
  totalPosts: number;
}): Promise<{ alerted: boolean; reason: string }> {
  try {
    const health = await checkInstagramBusinessSource();
    if (health.ok) return { alerted: false, reason: "source-healthy" };
    if (await alreadyAlertedToday()) return { alerted: false, reason: "already-alerted-today" };

    await alertOps({
      source: "instagram-business-token",
      title: ALERT_TITLE,
      severity: ALERT_SEVERITY,
      facts: {
        /* No token, no prefix, no length -- the cause is the code and the
           sentence, and neither of those is a secret. */
        cause: health.reason,
        graphCode: health.code ?? "none",
        stillUpdating: "likes and comments (public embed fallback)",
        notUpdating: "views (Business Discovery only)",
        remedy: "replace the INSTAGRAM_BUSINESS_TOKEN environment variable",
        instagramPostsAffectedThisRun: facts.rejectedPosts,
        postsInRun: facts.totalPosts,
      },
    });
    return { alerted: true, reason: health.reason };
  } catch (err) {
    createLogger({ context: { lib: "integrations/health" } }).error("instagram source alert threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { alerted: false, reason: "alert-threw" };
  }
}
