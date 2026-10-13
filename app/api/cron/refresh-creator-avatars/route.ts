import { NextRequest, NextResponse } from "next/server";
import { refreshCreatorAvatars } from "@/lib/creators/avatarStore";
import { openSandboxProfileFetcher } from "@/lib/platforms/tiktokProfileSandbox";
import { createLogger } from "@/lib/observability/logger";
import { cronRoute } from "@/lib/ops/cronRoute";
import { bearerMatches } from "@/lib/http/bearer";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hourly: store a profile picture for every creator who has none, or whose
 * picture is a fortnight old. Hourly with a due-row selection rather than a
 * bigger daily run, like refresh-roster-profiles. One creator takes about 1.5s,
 * nearly all of it waiting on a profile page or a CDN, so four at a time fit
 * about 600 into a run -- a 2,500-creator import is covered in five hours
 * rather than seventeen, and once it is, most hours find nothing due.
 *
 * The sandbox is opened lazily by the fetcher, so a run where every picture
 * came from a link we already held, or from a plain profile fetch, boots none.
 */
async function cronHandler(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/refresh-creator-avatars" } });
  const cronSecret = process.env.CRON_SECRET;
  if (!bearerMatches(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const remote = openSandboxProfileFetcher();
  try {
    const counts = await refreshCreatorAvatars({
      limit: 600,
      concurrency: 4,
      deadlineMs: 4 * 60 * 1000,
      readTikTokProfileRemote: (handle) => remote.read(handle),
    });
    return NextResponse.json({ ok: true, ...counts });
  } catch (error) {
    log.error("avatar refresh failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  } finally {
    await remote.close();
  }
}

/* Kill switch and heartbeat around the handler above (lib/ops/cronRoute). */
export const GET = cronRoute("refresh-creator-avatars", cronHandler);
