import { NextRequest, NextResponse } from "next/server";
import {
  REFRESH_WHEN_DAYS_LEFT,
  refreshInstagramBusinessToken,
  type RefreshOutcome,
} from "@/lib/platforms/instagramBusinessToken";
import { createLogger } from "@/lib/observability/logger";
import { alertOps } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* One row, one Graph round trip. The ceiling is generous only so a slow answer
   from Meta is not cut off mid-exchange, which would be the one way to lose a
   token: a new one minted at Meta and never written here. */
export const maxDuration = 60;

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
export async function GET(request: NextRequest) {
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

  try {
    const instagram = await refreshInstagramBusinessToken({ force });
    log.info("instagram business credential", { ...instagram });
    await alertFor(instagram);
    return NextResponse.json({ instagram, refreshWindowDays: REFRESH_WHEN_DAYS_LEFT, force });
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
