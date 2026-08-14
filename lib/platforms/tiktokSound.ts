import { createLogger } from "@/lib/observability/logger";
import {
  TIKTOK_DIRECT_UA,
  TIKTOK_REHYDRATION_RE,
  pickCount,
} from "@/lib/platforms/fetchPostMetrics";

export type TikTokSoundStats = {
  usesCount: number;
  title: string | null;
  artist: string | null;
  coverImageUrl: string | null;
};

export function soundUrl(tiktokSoundId: string): string {
  return `https://www.tiktok.com/music/x-${encodeURIComponent(tiktokSoundId)}`;
}

export function parseTikTokSoundRehydration(html: string): TikTokSoundStats | null {
  const match = html.match(TIKTOK_REHYDRATION_RE);
  if (!match) return null;

  let payload: any;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const scope = payload?.__DEFAULT_SCOPE__;
  const detail = scope?.["webapp.music-detail"] ?? scope?.["webapp.music-page"];
  if (!detail) return null;
  if (typeof detail.statusCode === "number" && detail.statusCode !== 0) return null;

  const info = detail.musicInfo ?? detail.musicDetail;
  const music = info?.music ?? info;
  if (!music) return null;

  const rawUses = info?.stats?.videoCount ?? music?.videoCount ?? music?.userCount;
  if (rawUses === undefined || rawUses === null) return null;

  const usesCount = pickCount(rawUses);
  if (!Number.isFinite(usesCount)) return null;

  return {
    usesCount,
    title: typeof music.title === "string" && music.title.length > 0 ? music.title : null,
    artist:
      typeof music.authorName === "string" && music.authorName.length > 0
        ? music.authorName
        : null,
    coverImageUrl: music.coverLarge ?? music.coverMedium ?? music.coverThumb ?? null,
  };
}

export async function fetchTikTokSoundStats(
  tiktokSoundId: string,
  timeoutMs = 15000
): Promise<TikTokSoundStats | null> {
  const log = createLogger({ context: { platform: "TIKTOK", soundId: tiktokSoundId } });
  const url = soundUrl(tiktokSoundId);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": TIKTOK_DIRECT_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      log.warn("TikTok sound page request failed", { status: res.status });
      return null;
    }

    const html = await res.text();
    const parsed = parseTikTokSoundRehydration(html);
    if (!parsed) {
      log.warn("TikTok sound page carried no parsable music payload");
      return null;
    }
    return parsed;
  } catch (err) {
    log.error("TikTok sound fetch threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
