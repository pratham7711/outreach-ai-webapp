import { NextRequest, NextResponse } from "next/server";
import {
  REFRESH_WHEN_DAYS_LEFT,
  refreshInstagramBusinessToken,
  type RefreshOutcome,
} from "@/lib/platforms/instagramBusinessToken";
import { createLogger } from "@/lib/observability/logger";
import { alertOps } from "@/lib/alerts";
import {
  forgetRevokedYouTubeConnections,
  refreshConnectedAccounts,
  type ConnectionRefreshSummary,
} from "@/lib/platforms/connectionRefresh";
import { cronRoute } from "@/lib/ops/cronRoute";
import {
  refreshAgencyCredentials,
  type AgencyRefreshSummary,
} from "@/lib/platforms/instagramAgencyCredential";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* One row, one Graph round trip. The ceiling is generous only so a slow answer
   from Meta is not cut off mid-exchange, which would be the one way to lose a
   token: a new one minted at Meta and never written here. */
export const maxDuration = 60;

/* The creators' own connections get what is left of the minute after the
   platform credential, minus a margin for the rows already in flight to finish
   their writes — a refreshed token that is minted but never stored is the one
   way this job could cost a connection. Rows not reached roll to tomorrow. */
const CONNECTION_BUDGET_MS = 35_000;

/* Agencies' own Instagram accounts go between the two, each its own exchange. */
const AGENCY_BUDGET_MS = 20_000;

/**
 * Keeps the platform's own credentials alive.
 *
 * Daily, at 05:00 UTC (see vercel.json) — between snapshot-sounds at 04:00 and
 * the 06:00 sync-posts run, so a refreshed token is in place before the next
 * sweep reads Instagram with it.
 *
 * Daily for a credential with a 60-day life and a 14-day window is deliberate.
 * The cost is one query and, on most days, nothing else: a token outside its
 * window returns "not-due" without talking to Meta at all. What it buys is
 * roughly twenty-five attempts before anything breaks, so a bad afternoon at
 * Meta, a deploy, or a missed run costs a retry rather than an outage.
 *
 * Alerting is the point as much as the refresh is. The failure this replaces
 * was silent — Instagram views stopped moving, likes and comments carried on,
 * and nothing anywhere said so. Every outcome that threatens the credential
 * raises an alert here, and "we got a token back but it expires no later than
 * the one we had" is treated as a failure rather than a success, because that
 * is exactly the shape a refresher goes dark in.
 */
async function cronHandler(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/refresh-platform-tokens" } });

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    log.warn("auth failed", { reason: "bad-or-missing-cron-secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* An operator asking "does renewal actually work?" rather than waiting six
     weeks to find out. It exchanges regardless of the window; the answer is the
     same either way and a successful early exchange simply resets the clock. */
  const force = request.nextUrl.searchParams.get("force") === "1";
  const startedAt = Date.now();

  try {
    const instagram = await refreshInstagramBusinessToken({ force });
    log.info("instagram business credential", { ...instagram });
    await alertFor(instagram);
    const agencies = await refreshAgencyAccounts(force, startedAt + AGENCY_BUDGET_MS);
    const connections = await refreshCreatorConnections(startedAt + CONNECTION_BUDGET_MS);
    const youtubeRevoked = await forgetRevokedYouTube();
    return NextResponse.json({
      instagram,
      refreshWindowDays: REFRESH_WHEN_DAYS_LEFT,
      force,
      agencies,
      connections,
      youtubeRevoked,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("refresh-platform-tokens cron failed", { error: message });
    await alertOps({
      source: "cron/refresh-platform-tokens",
      title: "Platform credential refresh crashed",
      severity: "critical",
      facts: { error: message },
    });
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}

/**
 * The daily pass over creators' own connections (lib/platforms/connectionRefresh).
 *
 * Runs only after the platform credential above has been refreshed and
 * reported, and can never fail this request: a crash here is logged and
 * alerted on its own, and the credential result above is returned regardless.
 * No per-row alert — a creator's lapsed token is shown to that creator as
 * "Reconnect needed", and paging an operator for each one is noise.
 */
async function refreshCreatorConnections(
  deadlineAt: number,
): Promise<ConnectionRefreshSummary | { error: string }> {
  const log = createLogger({ context: { route: "cron/refresh-platform-tokens", call: "connections" } });
  try {
    return await refreshConnectedAccounts({ deadlineAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("creator connection refresh crashed", { error: message });
    await alertOps({
      source: "cron/refresh-platform-tokens",
      title: "Creator connection refresh crashed",
      severity: "warn",
      facts: { error: message },
    }).catch(() => undefined);
    return { error: "connection refresh failed" };
  }
}

/**
 * YouTube connections Google has refused for three weeks are disconnected
 * (lib/platforms/connectionRefresh, forgetRevokedYouTubeConnections). Isolated
 * like the pass above: a failure here is logged and never fails the run.
 */
async function forgetRevokedYouTube(): Promise<number | { error: string }> {
  try {
    return await forgetRevokedYouTubeConnections();
  } catch (error) {
    createLogger({ context: { route: "cron/refresh-platform-tokens", call: "youtubeRevoked" } }).error(
      "revoked YouTube connections could not be removed",
      { error: error instanceof Error ? error.message : String(error) },
    );
    return { error: "youtube revoked cleanup failed" };
  }
}

/**
 * Agencies' own Instagram accounts (lib/platforms/instagramAgencyCredential),
 * extended with the same exchange as the platform credential above.
 *
 * Each org's row is its own attempt, so one dead token is that org's outcome
 * and the rest still run. Never fails this request, and no per-org alert: an
 * org whose account lapses is told on its own Integrations card, and its
 * reads go back to the platform token meanwhile.
 */
async function refreshAgencyAccounts(
  force: boolean,
  deadlineAt: number,
): Promise<Omit<AgencyRefreshSummary, "outcomes"> | { error: string }> {
  const log = createLogger({ context: { route: "cron/refresh-platform-tokens", call: "agencies" } });
  try {
    const { outcomes, ...summary } = await refreshAgencyCredentials({ force, deadlineAt });
    for (const o of outcomes) {
      if (o.status !== "refreshed" && o.status !== "not-due") {
        log.warn("agency Instagram account not extended", { orgId: o.orgId, status: o.status, daysLeft: o.daysLeft, reason: o.reason });
      }
    }
    log.info("agency Instagram accounts", { ...summary.byStatus, considered: summary.considered, skipped: summary.skipped });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("agency Instagram refresh crashed", { error: message });
    await alertOps({
      source: "cron/refresh-platform-tokens",
      title: "Agency Instagram account refresh crashed",
      severity: "warn",
      facts: { error: message },
    }).catch(() => undefined);
    return { error: "agency refresh failed" };
  }
}

/** Only the outcomes that put the credential at risk. A refresh that worked,
 *  and a token nowhere near its window, are log lines and nothing more. */
async function alertFor(outcome: RefreshOutcome): Promise<void> {
  if (outcome.status === "refreshed" || outcome.status === "not-due") return;

  if (outcome.status === "no-credential") {
    // Not an alert: a deployment with no Instagram credential is a deliberate
    // state, and the banner on the trackers page already says so to the people
    // who would act on it.
    return;
  }

  if (outcome.status === "not-extended") {
    await alertOps({
      source: "cron/refresh-platform-tokens",
      title: "Instagram token cannot be renewed automatically — a person must reconnect",
      severity: "critical",
      facts: {
        expiresAt: outcome.expiresAt,
        daysLeft: outcome.daysLeft,
        meaning:
          "the exchange returned a token expiring no later than the one held, so daily attempts will not extend it",
      },
    });
    return;
  }

  /* Critical only once there is not much runway left. A single failed exchange
     with twelve days to go is a retry, and paging for it every day for a
     fortnight is how an alert stops being read. */
  await alertOps({
    source: "cron/refresh-platform-tokens",
    title:
      outcome.daysLeft !== null && outcome.daysLeft <= 7
        ? `Instagram token refresh failed with ${outcome.daysLeft} day(s) left`
        : "Instagram token refresh failed",
    severity: outcome.daysLeft !== null && outcome.daysLeft <= 7 ? "critical" : "warn",
    facts: { reason: outcome.reason, expiresAt: outcome.expiresAt, daysLeft: outcome.daysLeft },
  });
}

/* Kill switch and heartbeat around the handler above (lib/ops/cronRoute). */
export const GET = cronRoute("refresh-platform-tokens", cronHandler);
