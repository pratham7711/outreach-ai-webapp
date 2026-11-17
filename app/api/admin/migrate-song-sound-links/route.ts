import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { db } from "@/lib/db";
import { SONG_SOUND_LINK_DDL, SONG_SOUND_LINK_TABLE } from "@/lib/songs/songSoundLinkDdl";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Creates SongSoundLink on production, where `migrate deploy` must never run.
 * Same ADMIN_MIGRATE_TOKEN gate as /api/admin/migrate-song-links: GET reports
 * and changes nothing, POST applies and reports before and after. Additive
 * only, and safe to run at any time after the deploy that reads the table.
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
  const rows = await db.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '${SONG_SOUND_LINK_TABLE}') AS "exists"`,
  );
  const ready = rows[0]?.exists === true;
  return { ready, links: ready ? await db.songSoundLink.count() : 0 };
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
    for (const stmt of SONG_SOUND_LINK_DDL) await db.$executeRawUnsafe(stmt);
    return NextResponse.json({ ok: true, before, after: await inspect() });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
