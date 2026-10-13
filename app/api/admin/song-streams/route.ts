import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { snapshotSongStreams } from "@/lib/songs/streamSnapshot";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * A dry run of the daily Spotify read, for checking from production that
 * Spotify answers there before the cron's readings are trusted. Reads up to
 * `limit` due songs (default 1) and writes nothing; the answer is counts only,
 * no song titles. GET only: the cron is the one thing that stores readings.
 * Same ADMIN_MIGRATE_TOKEN gate as the other admin routes.
 */
export async function GET(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 1) || 1, 1), 3);
  try {
    return NextResponse.json(await snapshotSongStreams({ dryRun: true, limit, deadlineMs: 120_000 }));
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
