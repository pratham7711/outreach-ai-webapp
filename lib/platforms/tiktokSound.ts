import { createLogger } from "../observability/logger";

const API_BASE = "https://api.scrapecreators.com/v1/tiktok";

export type SoundStats = {
  usesCount: number;
  title: string | null;
  artist: string | null;
  coverImageUrl: string | null;
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function timeoutSignal(ms = 12000): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

// ScrapeCreators nests the music object differently across responses, and TikTok
// itself names the use-count field inconsistently (video_count vs user_count vs
// stats.*). Pull the first plausible one rather than assume a single shape.
function extractUseCount(music: Record<string, unknown>): number {
  const stats = (music.stats ?? {}) as Record<string, unknown>;
  const candidates = [
    music.video_count,
    music.user_count,
    music.videoCount,
    music.userCount,
    stats.videoCount,
    stats.video_count,
    stats.userCount,
    stats.user_count,
  ];
  for (const c of candidates) {
    const n = num(c);
    if (n > 0) return n;
  }
  return 0;
}

// Returns the aggregate "videos using this sound" count for a TikTok music/clip id,
// or null when the provider is unconfigured or the call fails. Off by default:
// with SCRAPECREATORS_API_KEY unset the Sound Tracker simply records no snapshot,
// exactly like the SocialKit path in fetchPostMetrics.
export async function fetchSoundStats(clipId: string): Promise<SoundStats | null> {
  const log = createLogger({ context: { platform: "TIKTOK", call: "sound.details" } });
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) return null;
  if (!/^\d+$/.test(clipId)) {
    log.warn("Sound id is not numeric; skipping", { clipId });
    return null;
  }

  try {
    const res = await fetch(`${API_BASE}/song?id=${encodeURIComponent(clipId)}`, {
      headers: { "x-api-key": key },
      cache: "no-store",
      signal: timeoutSignal(),
    });
    if (!res.ok) {
      log.error("ScrapeCreators song request failed", { status: res.status });
      return null;
    }
    const json = (await res.json()) as Record<string, unknown>;
    // Response envelope varies; the music object may be at the root or nested.
    const music = (json.music ??
      json.musicInfo ??
      json.music_info ??
      json.data ??
      json) as Record<string, unknown>;

    return {
      usesCount: extractUseCount(music),
      title: str(music.title) ?? str(music.music_name),
      artist: str(music.author) ?? str(music.authorName) ?? str(music.artist),
      coverImageUrl:
        str(music.cover_large) ??
        str(music.coverLarge) ??
        str(music.cover_medium) ??
        str(music.coverThumb),
    };
  } catch (err) {
    log.error("ScrapeCreators song fetch threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
