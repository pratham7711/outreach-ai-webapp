/** Where a tracked sound lives on its own platform, and what to call it. */

export type AudioPlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE";

export function audioPlatformOf(platform: string | null | undefined): AudioPlatform {
  return platform === "INSTAGRAM" || platform === "YOUTUBE" ? platform : "TIKTOK";
}

export function soundPageUrl(platform: string | null | undefined, soundId: string): string {
  const id = encodeURIComponent(soundId);
  switch (audioPlatformOf(platform)) {
    case "INSTAGRAM":
      return `https://www.instagram.com/reels/audio/${id}/`;
    case "YOUTUBE":
      return `https://www.youtube.com/source/${id}/shorts`;
    default:
      return `https://www.tiktok.com/music/x-${id}`;
  }
}

/** "TikTok", "Instagram", "YouTube". */
export function audioPlatformName(platform: string | null | undefined): string {
  const p = audioPlatformOf(platform);
  return p === "INSTAGRAM" ? "Instagram" : p === "YOUTUBE" ? "YouTube" : "TikTok";
}

/** What one use is called on that platform: videos, reels, Shorts. */
export function audioUsesNoun(platform: string | null | undefined): string {
  const p = audioPlatformOf(platform);
  return p === "INSTAGRAM" ? "reels" : p === "YOUTUBE" ? "Shorts" : "videos";
}
