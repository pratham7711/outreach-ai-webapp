import { NextRequest, NextResponse } from "next/server";
import { refreshCreatorAvatars } from "@/lib/creators/avatarStore";
import { openSandboxProfileFetcher } from "@/lib/platforms/tiktokProfileSandbox";
import { createLogger } from "@/lib/observability/logger";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hourly: store a profile picture for every creator who has none, or whose
 * picture is a fortnight old. Hourly with a due-row selection rather than a
 * bigger daily run, like refresh-roster-profiles: one run fits about 150 before
 * its clock ends, so a roster of a couple of thousand is covered within the
 * day, and once it is, most hours find nothing due.
 *
 * The sandbox is opened lazily by the fetcher, so a run where every picture
 * came from a link we already held, or from a plain profile fetch, boots none.
 */
export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/refresh-creator-avatars" } });
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const remote = openSandboxProfileFetcher();
  try {
    const counts = await refreshCreatorAvatars({
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
