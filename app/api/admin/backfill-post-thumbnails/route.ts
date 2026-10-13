import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { backfillPostThumbnails } from "@/lib/posts/thumbnailBackfill";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Copies the post covers the sync never saw (lib/posts/thumbnailBackfill).
 *
 * GET is the dry run: counts only, nothing fetched or written. POST runs one
 * batch and reports what is left; call it again until `remaining` is 0. Gated
 * by ADMIN_MIGRATE_TOKEN like the migration it follows, and run by hand -- there
 * is deliberately no cron behind it.
 *
 * Query string, all optional:
 *   campaignId=<id>  one campaign only
 *   limit=<n>        posts this batch (default 50, at most 500)
 *   refetch=0        only links that still answer; no platform calls at all
 *   retryFailed=1    include posts that failed in the last six hours
 *   dryRun=1         on POST, the same as GET
 */
function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function options(request: NextRequest, dryRun: boolean) {
  const q = request.nextUrl.searchParams;
  const limit = Number(q.get("limit"));
  return {
    dryRun: dryRun || q.get("dryRun") === "1",
    campaignId: q.get("campaignId") || null,
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    refetch: q.get("refetch") !== "0",
    retryFailed: q.get("retryFailed") === "1",
  };
}

async function run(request: NextRequest, dryRun: boolean) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await backfillPostThumbnails(options(request, dryRun)));
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
