/**
 * What a post URL says about itself, and nothing else.
 *
 * Split out of fetchPostMetrics because this is the one piece of that module a
 * *browser* needs: the posts screen reads a pasted link to show which platform
 * it belongs to before anything is sent to the server. Importing it from
 * fetchPostMetrics pulled the whole fetch stack -- Instagram, TikTok, Twitch,
 * the sandbox reader, and through the credential accessor a PrismaClient --
 * into the client bundle, where it fails outright ("Can't resolve 'dns'").
 *
 * So the rule this file exists to keep: anything reachable from here must stay
 * pure. No network, no database, no environment.
 */
import type { PostMetrics } from "./fetchPostMetrics";

export const MEDIA_TYPES = ["REEL", "STORY", "POST", "SHORT", "VIDEO"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/**
 * What a post URL says about itself.
 *
 * The URL already carries the two things an operator was being asked to retype:
 * which kind of post it is, and often whose it is. A TikTok link cannot be
 * anything but /@handle/video/id, and an Instagram reel says "reel" in the path.
 * `mediaType` and `handle` are optional because not every form carries them --
 * a youtu.be link names no channel, and instagram.com/p/CODE names no author --
 * and an absent field means "the URL does not say", never "there is none".
 */
export function detectPlatform(
  url: string
): { platform: PostMetrics["platform"]; id: string; mediaType?: MediaType; handle?: string } | null {
  // YouTube: watch?v=ID, youtu.be/ID, shorts/ID, live/ID, embed/ID (IDs are 11 chars).
  // Host-guarded so a stray ?v= on another domain can't be misread as YouTube.
  if (/(?:youtube\.com|youtu\.be)/.test(url)) {
    const ytMatch =
      url.match(/(?:youtube\.com\/(?:shorts|live|embed)\/|youtu\.be\/)([\w-]{11})/) ||
      url.match(/[?&]v=([\w-]{11})/);
    if (ytMatch) {
      // A channel handle only appears on some YouTube forms, and never on the
      // watch?v= one that most people paste.
      const yHandle = url.match(/youtube\.com\/@([\w.-]+)/)?.[1];
      return {
        platform: "YOUTUBE",
        id: ytMatch[1],
        mediaType: /youtube\.com\/shorts\//.test(url) ? "SHORT" : "VIDEO",
        ...(yHandle ? { handle: yHandle } : {}),
      };
    }
  }

  // TikTok: tiktok.com/@user/video/ID, and /photo/ID for image carousels.
  const ttMatch = url.match(/tiktok\.com\/@([\w.]+)\/(video|photo)\/(\d+)/);
  if (ttMatch) {
    return {
      platform: "TIKTOK",
      id: ttMatch[3],
      mediaType: ttMatch[2] === "photo" ? "POST" : "VIDEO",
      handle: ttMatch[1],
    };
  }

  // Instagram: /reel/CODE and /p/CODE, either bare or prefixed with the author
  // -- instagram.com/someone/reel/CODE is what the app's own share sheet gives
  // you, and it used to match nothing here at all.
  const igStory = url.match(/instagram\.com\/stories\/([\w.]+)\/(\d+)/);
  if (igStory) {
    return { platform: "INSTAGRAM", id: igStory[2], mediaType: "STORY", handle: igStory[1] };
  }
  const igMatch = url.match(/instagram\.com\/(?:([\w.]+)\/)?(reels?|p|tv)\/([\w-]+)/);
  if (igMatch) {
    return {
      platform: "INSTAGRAM",
      id: igMatch[3],
      mediaType: igMatch[2].startsWith("reel") ? "REEL" : "POST",
      ...(igMatch[1] ? { handle: igMatch[1] } : {}),
    };
  }


  /* Twitch: a VOD is /videos/<numeric id>, a clip is either clips.twitch.tv/<slug>
     or /<channel>/clip/<slug>. The two are served by different Helix endpoints,
     which is why fetchTwitchMetrics re-reads the kind off the url. Clips are
     short-form, so they map to SHORT rather than VIDEO. */
  const twVod = url.match(/twitch\.tv\/videos\/(\d+)/i);
  if (twVod) {
    return { platform: "TWITCH", id: twVod[1], mediaType: "VIDEO" };
  }
  const twClipHosted = url.match(/clips\.twitch\.tv\/([\w-]+)/i);
  if (twClipHosted) {
    return { platform: "TWITCH", id: twClipHosted[1], mediaType: "SHORT" };
  }
  const twClipChannel = url.match(/twitch\.tv\/(\w+)\/clip\/([\w-]+)/i);
  if (twClipChannel) {
    return {
      platform: "TWITCH",
      id: twClipChannel[2],
      mediaType: "SHORT",
      handle: twClipChannel[1],
    };
  }

  return null;
}
