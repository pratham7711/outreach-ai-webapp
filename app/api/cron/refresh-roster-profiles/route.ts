import { NextRequest, NextResponse } from "next/server";
import { refreshRosterProfiles } from "@/lib/creators/profileRefresh";
import { openSandboxProfileFetcher } from "@/lib/platforms/tiktokProfileSandbox";
import { createLogger } from "@/lib/observability/logger";
import { cronRoute } from "@/lib/ops/cronRoute";
import { bearerMatches } from "@/lib/http/bearer";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hourly: read the roster accounts that are due (never read, or read more than
 * a day ago), up to one run's worth, and store their follower counts and
 * pictures. Hourly with a due-row selection rather than a bigger daily run,
 * because one run fits about 150 reads before its clock ends; a 1,000-creator
 * import is read within the day and then refreshed daily.
 *
 * The sandbox is opened lazily by the fetcher, so an hour with nothing due, or
 * with only Instagram and YouTube due, starts none.
 */
async function cronHandler(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/refresh-roster-profiles" } });
  const cronSecret = process.env.CRON_SECRET;
  if (!bearerMatches(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const remote = openSandboxProfileFetcher();
  try {
    const counts = await refreshRosterProfiles({
      deadlineMs: 4 * 60 * 1000,
      readTikTokProfileRemote: (handle) => remote.read(handle),
      readTikTokEmbedHtml: (handle) => remote.readEmbedHtml(handle),
    });
    return NextResponse.json({ ok: true, ...counts });
  } catch (error) {
    log.error("roster profile refresh failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  } finally {
    await remote.close();
  }
}

/* Kill switch and heartbeat around the handler above (lib/ops/cronRoute). */
export const GET = cronRoute("refresh-roster-profiles", cronHandler);
