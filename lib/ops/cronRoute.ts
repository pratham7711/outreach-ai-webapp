import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/observability/logger";
import type { CronJobName } from "./cronJobs";
import { recordCronFinish, recordCronStart } from "./heartbeat";
import { cronKillKey, isKilled } from "./killSwitch";

/**
 * The one wrapper every cron route goes through:
 *
 *   export const GET = cronRoute("sync-posts", run);
 *
 * It does three things around the route's own handler, and nothing to its
 * response:
 *   1. a killed job ("cron:<job>" off on /platform/ops) answers
 *      200 {ok:true, skipped:"killed"} without running;
 *   2. a start heartbeat before the handler and a finish heartbeat after it --
 *      ok when the handler answered below 400, failed (with the body, cut
 *      short) otherwise or when it threw;
 *   3. a request without the cron secret goes straight to the handler, which
 *      answers 401 as it always has. So an anonymous caller can neither read a
 *      switch nor write a heartbeat.
 *
 * A dry run (?dryRun=1) is an operator asking a question, not the schedule
 * running, so it writes no heartbeat: it must not make a job that stopped
 * firing look alive.
 */

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

async function failureText(res: Response): Promise<string> {
  try {
    const text = await res.clone().text();
    return `HTTP ${res.status}${text ? `: ${text}` : ""}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function cronRoute(
  job: CronJobName,
  handler: (request: NextRequest) => Promise<Response>
): (request: NextRequest) => Promise<Response> {
  return async function cronGuarded(request: NextRequest): Promise<Response> {
    if (!authorized(request)) return handler(request);

    if (await isKilled(cronKillKey(job))) {
      createLogger({ context: { route: `cron/${job}` } }).warn("cron skipped: kill switch is on", { job });
      return NextResponse.json({ ok: true, skipped: "killed", job });
    }

    const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
    const beat = dryRun ? null : await recordCronStart(job);
    let res: Response;
    try {
      res = await handler(request);
    } catch (e) {
      if (beat) await recordCronFinish(beat, { ok: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    if (beat) {
      const ok = res.status < 400;
      await recordCronFinish(beat, { ok, error: ok ? null : await failureText(res) });
    }
    return res;
  };
}
