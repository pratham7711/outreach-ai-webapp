import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { backfillArtwork } from "@/lib/media/artworkBackfill";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Copies the sound covers and campaign pictures that predate their stores
 * (lib/media/artworkBackfill).
 *
 * GET is the dry run: counts only, nothing fetched or written. POST runs one
 * batch and reports what is left; call it again until `remaining` is 0. Gated
 * by ADMIN_MIGRATE_TOKEN like the migrations it follows, and run by hand --
 * there is deliberately no cron behind it.
 *
 * Query string, all optional:
 *   limit=<n>        items this batch (default 200, at most 1000)
 *   retryFailed=1    include links that failed in the last six hours
 */
function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function run(request: NextRequest, dryRun: boolean) {
  const denied = authorize(request);
  if (denied) return denied;
  const q = request.nextUrl.searchParams;
  const limit = Number(q.get("limit"));
  try {
    return NextResponse.json(
      await backfillArtwork({
        dryRun,
        ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
        retryFailed: q.get("retryFailed") === "1",
      })
    );
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return run(request, true);
}

export async function POST(request: NextRequest) {
  return run(request, false);
}
