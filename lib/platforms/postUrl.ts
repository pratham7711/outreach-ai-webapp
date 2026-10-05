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


  /* Facebook: a Page post in any of the shapes Facebook hands out. The handle is
     the Page's vanity name when the link spells one; a numeric Page id is not a
     handle anybody would recognise on the roster, so it stays off this field and
     only the Page matcher (lib/platforms/facebookPost) reads it. */
  const fb = parseFacebookLink(url);
  if (fb) {
    const handle = fb.pageRef && !/^\d+$/.test(fb.pageRef) ? fb.pageRef : undefined;
    return {
      platform: "FACEBOOK",
      id: fb.id,
      mediaType: FACEBOOK_MEDIA_TYPE[fb.kind],
      ...(handle ? { handle } : {}),
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

/**
 * What a Facebook link says about the post it points at.
 *
 * Facebook has no one post URL. A Page post is /{page}/posts/{id}, where the id
 * is either the numeric story id or an opaque pfbid; the classic form is
 * permalink.php?story_fbid={id}&id={page id}; a video is /{page}/videos/{id} or
 * /watch?v={id}; a reel is /reel/{id}; and the share sheet hands out
 * /share/p/{code} or fb.watch/{code}, which name neither the Page nor the post
 * until Facebook redirects them -- `shared` marks those.
 *
 * `pageRef` is the Page as the link spells it, a vanity name or a numeric id,
 * and is absent when the link does not say.
 */
export type FacebookLink = {
  kind: "post" | "photo" | "video" | "reel" | "group";
  id: string;
  pageRef?: string;
  shared?: boolean;
};

const FACEBOOK_MEDIA_TYPE: Record<FacebookLink["kind"], MediaType> = {
  post: "POST",
  photo: "POST",
  group: "POST",
  video: "VIDEO",
  reel: "REEL",
};

/** First path segments that are Facebook's own routes, never a Page's name. */
const FACEBOOK_ROUTES = new Set([
  "watch", "reel", "reels", "share", "photo", "photo.php", "photos", "permalink.php",
  "story.php", "groups", "events", "profile.php", "people", "pages", "hashtag",
  "marketplace", "gaming", "stories", "video.php", "login", "help", "sharer", "sharer.php",
]);

const FACEBOOK_SHARE_KIND: Record<string, FacebookLink["kind"]> = { p: "post", v: "video", r: "reel" };

const numericId = (s: string | null | undefined): s is string => Boolean(s && /^\d+$/.test(s));
const storyId = (s: string | null | undefined): s is string => Boolean(s && /^(?:\d+|pfbid\w+)$/i.test(s));

export function parseFacebookLink(url: string): FacebookLink | null {
  let u: URL;
  try {
    u = new URL(/^[a-z][\w+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "fb.watch" || host.endsWith(".fb.watch")) {
    return parts[0] ? { kind: "video", id: parts[0], shared: true } : null;
  }
  if (!/(?:^|\.)(?:facebook|fb)\.com$/.test(host)) return null;

  const q = u.searchParams;
  const first = parts[0]?.toLowerCase();
  if (!first) return null;

  if (first === "permalink.php" || first === "story.php") {
    const id = q.get("story_fbid");
    const page = q.get("id");
    if (!storyId(id)) return null;
    return { kind: "post", id, ...(numericId(page) ? { pageRef: page } : {}) };
  }
  if (first === "photo.php" || first === "photo") {
    const id = q.get("fbid");
    return numericId(id) ? { kind: "photo", id } : null;
  }
  if (first === "watch") {
    const id = q.get("v");
    return numericId(id) ? { kind: "video", id } : null;
  }
  if (first === "reel" || first === "reels") {
    return numericId(parts[1]) ? { kind: "reel", id: parts[1] } : null;
  }
  if (first === "share") {
    const typed = parts[1] ? FACEBOOK_SHARE_KIND[parts[1].toLowerCase()] : undefined;
    const code = typed ? parts[2] : parts[1];
    return code ? { kind: typed ?? "post", id: code, shared: true } : null;
  }
  if (first === "groups") {
    const section = parts[2]?.toLowerCase();
    return (section === "posts" || section === "permalink") && storyId(parts[3])
      ? { kind: "group", id: parts[3] }
      : null;
  }
  if (FACEBOOK_ROUTES.has(first)) return null;

  const pageRef = parts[0];
  const section = parts[1]?.toLowerCase();
  if (section === "posts") {
    return storyId(parts[2]) ? { kind: "post", id: parts[2], pageRef } : null;
  }
  if (section === "videos" || section === "photos") {
    /* /videos/{id}, /videos/{title-slug}/{id}, /photos/a.{album}/{id}: the
       object id is the last numeric segment. */
    const id = [...parts.slice(2)].reverse().find((p) => numericId(p));
    if (!id) return null;
    return { kind: section === "videos" ? "video" : "photo", id, pageRef };
  }
  return null;
}

/**
 * The address a TikTok post's page is read from.
 *
 * A carousel's own /photo/ID page renders in the browser: it answers 200 with
 * no webapp.video-detail in the rehydration payload, so every reader found
 * nothing to parse and took it for a WAF challenge -- the sandbox latched and
 * replaced its lane each time, and a run's replacement budget went on photo
 * posts alone. The same id under /video/ is rendered on the server with the
 * whole item, imagePost included. Measured 2026-09-30 from iad1 on one
 * carousel: /photo/ gave 371KB and no detail scope; /video/ gave statusCode 0
 * and 143,200 plays, 1,572 likes, 9 comments, 28 shares, 105 saves.
 */
export function tiktokPageUrl(url: string): string {
  return url.replace(/(tiktok\.com\/@[\w.]+)\/photo\/(\d+)/, "$1/video/$2");
}
