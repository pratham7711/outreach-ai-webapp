import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { db } from "@/lib/db";
import { SONG_LINK_COLUMNS, SONG_LINK_DDL } from "@/lib/songs/songLinkDdl";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Adds Song.spotifyTrackId and Song.instagramSoundId on production, where
 * `migrate deploy` must never run. Same shape and the same ADMIN_MIGRATE_TOKEN
 * gate as /api/admin/migrate-song-streams: GET reports and changes nothing,
 * POST applies and reports before and after.
 *
 * The code that reads the columns is deployed first and treats them as missing
 * until this has run (lib/songs/songLinks.ts), so this can run at any time
 * after that deploy.
 */
function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function inspect() {
  const columns = await db.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Song'
        AND column_name IN (${SONG_LINK_COLUMNS.map((c) => `'${c}'`).join(", ")})`,
  );
  const present = new Set(columns.map((c) => c.column_name));
  const missingColumns = SONG_LINK_COLUMNS.filter((c) => !present.has(c));
  const ready = missingColumns.length === 0;
  return {
    ready,
    missingColumns,
    // How many songs carry each link; only askable once the columns exist.
    linkedSongs: ready ? await db.song.count({ where: { spotifyTrackId: { not: null } } }) : 0,
    instagramSongs: ready ? await db.song.count({ where: { instagramSoundId: { not: null } } }) : 0,
  };
}

export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ ok: true, ...(await inspect()) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const before = await inspect();
    // One statement per call: executeRawUnsafe uses the extended protocol.
    for (const stmt of SONG_LINK_DDL) await db.$executeRawUnsafe(stmt);
    return NextResponse.json({ ok: true, before, after: await inspect() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
