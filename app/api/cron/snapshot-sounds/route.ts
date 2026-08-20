import { NextRequest, NextResponse } from "next/server";
import { snapshotSounds } from "@/lib/sounds/snapshot";
import { createLogger } from "@/lib/observability/logger";

export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/snapshot-sounds" } });

  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    log.warn("auth failed", { reason: "bad-or-missing-cron-secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const result = await snapshotSounds({ dryRun });
    return NextResponse.json({ ...result, dryRun });
  } catch (error) {
    log.error("snapshot-sounds cron failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "cron failed", snapshots: 0, failed: 0 }, { status: 500 });
  }
}
