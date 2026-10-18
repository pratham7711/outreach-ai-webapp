import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { SOUND_COVER_UPLOAD_MAX_BYTES, storeSoundCoverFromBytes } from "@/lib/sounds/coverStore";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Stores a picture handed in by an admin as one sound's cover
 * (lib/sounds/coverStore#storeSoundCoverFromBytes), for a cover TikTok will
 * not serve to the region the app runs in. Same ADMIN_MIGRATE_TOKEN gate as
 * the migrations.
 *
 *   POST ?soundId=<TikTokSound id>&source=<link the picture came from>
 *   body: the image bytes
 *
 * `source` is kept as the copy's sourceUrl, so a later reading that offers the
 * same picture recognises it and does not try to replace it.
 */
function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  const soundId = request.nextUrl.searchParams.get("soundId")?.trim();
  const source = request.nextUrl.searchParams.get("source")?.trim();
  if (!soundId || !source) return NextResponse.json({ error: "soundId and source are required" }, { status: 400 });
  try {
    if (new URL(source).protocol !== "https:") throw new Error("https only");
  } catch {
    return NextResponse.json({ error: "source must be an https link" }, { status: 400 });
  }
  if (Number(request.headers.get("content-length")) > SOUND_COVER_UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: "too large" }, { status: 413 });
  }
  try {
    const result = await storeSoundCoverFromBytes(soundId, Buffer.from(await request.arrayBuffer()), source);
    if (!result.stored) return NextResponse.json({ error: result.failure }, { status: result.status });
    return NextResponse.json({ ok: true, soundId, bytes: result.bytes });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
