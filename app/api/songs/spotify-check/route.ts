import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { checkSpotifyTrack, resolveSpotifyLink } from "@/lib/songs/spotifyLinkResolve";

export const dynamic = "force-dynamic";

/**
 * GET /api/songs/spotify-check?url=<a pasted Spotify link>
 *
 * What the New Campaign form and the campaign's audio settings show under the
 * Spotify field before anything is saved: the track the link names, its title
 * and its cover, or why the link is no good.
 *
 * Stores nothing and touches no row, so there is no orgId to scope by; the
 * session check keeps it from being a free link-follower for the internet.
 * The save itself re-parses the link (the client's answer is never trusted),
 * but does not ask Spotify again: this is the step that does.
 *
 *   200 { trackId, url, title, thumbnailUrl }
 *   400 { error, message }  not a track link, or a short link leading nowhere
 *   404 { error, message }  Spotify has no track at that link
 *   502 { error, message }  Spotify did not answer
 */
const NO_STORE = { "Cache-Control": "no-store" };

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) return reply({ error: "Unauthorized" }, 401);

  const raw = (req.nextUrl.searchParams.get("url") ?? "").trim().slice(0, 2048);
  if (!raw) return reply({ error: "not_track", message: "Paste the song's Spotify link." }, 400);

  const link = await resolveSpotifyLink(raw);
  if (!link.ok) return reply({ error: link.reason, message: link.message }, 400);

  const found = await checkSpotifyTrack(link.url);
  if (!found.ok) {
    return found.status === 404
      ? reply({ error: "not_found", message: "Spotify has no track at that link." }, 404)
      : reply({ error: "spotify_unavailable", message: "Spotify didn't answer. Try again in a moment." }, 502);
  }
  return reply({ trackId: link.trackId, url: link.url, title: found.title, thumbnailUrl: found.thumbnailUrl });
}
