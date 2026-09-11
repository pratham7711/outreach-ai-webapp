// Single source of truth for every platform influencer campaigns run on.
// The Prisma `Platform` enum must stay in sync with PLATFORM_KEYS (schema.prisma).
// UI pickers, z.enum validators, icon/label/colour maps and URL detection all derive
// from here — add a platform once, here, not in 30 scattered arrays.

export const PLATFORM_KEYS = [
  "TIKTOK",
  "INSTAGRAM",
  "YOUTUBE",
  "TWITTER",
  "FACEBOOK",
  "TWITCH",
  "THREADS",
  "PINTEREST",
  "SNAPCHAT",
  "LINKEDIN",
] as const;

export type PlatformKey = (typeof PLATFORM_KEYS)[number];

// "auto"  = a free official API fetcher exists (metrics sync automatically)
// "manual"= campaigns run here but metrics are entered by hand (no free API, or paid/partner-gated)
export type PlatformTracking = "auto" | "manual";

// Badge tones limited to the set already used across the app (@pratham7711/ui Badge).
export type PlatformTone = "neutral" | "danger" | "warning" | "accent";

export interface PlatformDef {
  key: PlatformKey;
  label: string;
  brandColor: string; // hex — icons / colour dots
  chartVar: string; // CSS var — charts (cycles the existing --chart-N palette)
  tone: PlatformTone; // Badge tone
  tracking: PlatformTracking;
  // Each pattern's first capture group is the platform post id. First match wins.
  urlPatterns: RegExp[];
  /**
   * Every domain this platform serves posts from, without a leading dot.
   *
   * Separate from urlPatterns because the two answer different questions.
   * urlPatterns answers "which post is this"; hosts answers "whose site is
   * this at all" -- and only the second can tell a mistyped YouTube link apart
   * from a platform we do not support. Matched on the host's suffix, so
   * www. and m. and regional subdomains are covered without listing them.
   */
  hosts: string[];
}

export const PLATFORMS: readonly PlatformDef[] = [
  {
    key: "TIKTOK",
    label: "TikTok",
    brandColor: "#010101",
    chartVar: "var(--chart-1)",
    tone: "neutral",
    tracking: "auto",
    hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
    urlPatterns: [/tiktok\.com\/@[\w.]+\/video\/(\d+)/i],
  },
  {
    key: "INSTAGRAM",
    label: "Instagram",
    brandColor: "#E4405F",
    chartVar: "var(--chart-2)",
    tone: "danger",
    tracking: "auto",
    hosts: ["instagram.com", "instagr.am"],
    urlPatterns: [/instagram\.com\/(?:reels?|p|tv)\/([\w-]+)/i],
  },
  {
    key: "YOUTUBE",
    label: "YouTube",
    brandColor: "#FF0000",
    chartVar: "var(--chart-3)",
    tone: "warning",
    tracking: "auto",
    hosts: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
    urlPatterns: [
      /(?:youtube\.com\/(?:shorts|live|embed)\/|youtu\.be\/)([\w-]{11})/i,
      /youtube\.com\/watch\?[^ ]*[?&]?v=([\w-]{11})/i,
    ],
  },
  {
    key: "TWITTER",
    label: "X (Twitter)",
    brandColor: "#000000",
    chartVar: "var(--chart-4)",
    tone: "accent",
    // Manual until a fetcher exists. The "~$200/mo" this comment used to claim
    // is out of date: X closed the free tier to new developers on 2026-02-06
    // and moved them to pay-per-use -- $0.005 per post read, $0.010 per user
    // read, NO monthly minimum. At our volume that is cents, so the blocker is
    // the fetcher, not the price. (Legacy $200 Basic survives only for existing
    // subscribers.)
    tracking: "manual",
    hosts: ["twitter.com", "x.com", "t.co"],
    urlPatterns: [/(?:twitter\.com|x\.com)\/[\w]+\/status\/(\d+)/i],
  },
  {
    key: "FACEBOOK",
    label: "Facebook",
    brandColor: "#1877F2",
    chartVar: "var(--chart-1)",
    tone: "accent",
    // Manual until Meta Advanced Access lands. The Graph app holds these
    // scopes at Standard Access, which is granted only to users with a ROLE on
    // the app, so a real creator's connect is declined -- see the note in
    // lib/oauth/providers.ts. Unblocked by the same App Review as Instagram.
    tracking: "manual",
    hosts: ["facebook.com", "fb.watch", "fb.com"],
    urlPatterns: [
      /facebook\.com\/[\w.]+\/(?:posts|videos)\/(\d+)/i,
      /facebook\.com\/reel\/(\d+)/i,
      /fb\.watch\/([\w-]+)/i,
    ],
  },
  {
    key: "TWITCH",
    label: "Twitch",
    brandColor: "#9146FF",
    chartVar: "var(--chart-2)",
    tone: "accent",
    // Auto: lib/platforms/twitch.ts reads Helix with an app access token, which
    // is free at 800 req/min and needs no review or partner programme -- the
    // only platform on this list that is genuinely open. Inert until
    // TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are set, and a post fetched
    // without them settles as "not-configured" rather than retrying forever.
    tracking: "auto",
    hosts: ["twitch.tv", "clips.twitch.tv"],
    urlPatterns: [
      /twitch\.tv\/videos\/(\d+)/i,
      /clips\.twitch\.tv\/([\w-]+)/i,
      /twitch\.tv\/\w+\/clip\/([\w-]+)/i,
    ],
  },
  {
    key: "THREADS",
    label: "Threads",
    brandColor: "#000000",
    chartVar: "var(--chart-3)",
    tone: "neutral",
    // Manual until Meta App Review. The Threads API is free with no paid tier,
    // but threads_manage_insights -- the scope that reads post metrics -- is
    // review-gated at 2-4 weeks per permission. Same submission as Instagram.
    tracking: "manual",
    hosts: ["threads.net", "threads.com"],
    urlPatterns: [/threads\.net\/(?:@[\w.]+\/post|t)\/([\w-]+)/i],
  },
  {
    key: "PINTEREST",
    label: "Pinterest",
    brandColor: "#BD081C",
    chartVar: "var(--chart-4)",
    tone: "danger",
    // Manual until Pinterest Standard tier. API v5 is free, but Trial ->
    // Standard needs a video-demo review, and Pinterest's data-storage rule
    // bars caching most API data -- which is what CreatorTrackerSnapshot does.
    // Resolve the caching question before writing a fetcher, not after.
    tracking: "manual",
    hosts: ["pinterest.com", "pin.it"],
    urlPatterns: [/pinterest\.[\w.]+\/pin\/(\d+)/i],
  },
  {
    key: "SNAPCHAT",
    label: "Snapchat",
    brandColor: "#FFFC00",
    chartVar: "var(--chart-1)",
    tone: "warning",
    // Manual until Snap allowlists us. The old claim here -- that no
    // creator-metrics API exists -- is wrong. The Snapchat Public Profile API
    // returns Public Profile metadata and stats, and its stats endpoints are
    // reachable publicly via a /public prefix. The gate is that the OAuth app
    // must be allowlisted by a Snap contact. A relationship, not a missing API.
    tracking: "manual",
    hosts: ["snapchat.com"],
    urlPatterns: [/snapchat\.com\/(?:spotlight|@[\w.]+|t|p)\/([\w.-]+)/i],
  },
  {
    key: "LINKEDIN",
    label: "LinkedIn",
    brandColor: "#0A66C2",
    chartVar: "var(--chart-2)",
    tone: "accent",
    // Manual, and the hardest of the set. The Community Management API needs a
    // legally registered entity -- LinkedIn's access docs exclude solo
    // developers and unregistered side projects outright -- and even once
    // approved it covers only company Pages you administer, not creator
    // profiles. It is not a creator-metrics source at all.
    tracking: "manual",
    hosts: ["linkedin.com", "lnkd.in"],
    urlPatterns: [/linkedin\.com\/(?:posts|feed\/update)\/[\w:%-]*?(\d{10,})/i],
  },
];

const BY_KEY: Record<PlatformKey, PlatformDef> = Object.fromEntries(
  PLATFORMS.map((p) => [p.key, p])
) as Record<PlatformKey, PlatformDef>;

export function platformDef(key: string | null | undefined): PlatformDef | undefined {
  if (!key) return undefined;
  return BY_KEY[key.toUpperCase() as PlatformKey];
}

export function platformLabel(key: string | null | undefined): string {
  return platformDef(key)?.label ?? (key ?? "");
}

export function platformBrandColor(key: string | null | undefined): string {
  return platformDef(key)?.brandColor ?? "#6B7280";
}

export function platformTone(key: string | null | undefined): PlatformTone {
  return platformDef(key)?.tone ?? "neutral";
}

export function isAutoTracked(key: string | null | undefined): boolean {
  return platformDef(key)?.tracking === "auto";
}

export const AUTO_TRACK_PLATFORMS: PlatformKey[] = PLATFORMS.filter(
  (p) => p.tracking === "auto"
).map((p) => p.key);

// Classify a post URL to its platform + post id. First matching pattern wins.
export function detectPlatformFromUrl(
  url: string
): { platform: PlatformKey; id: string } | null {
  if (!url) return null;
  for (const p of PLATFORMS) {
    for (const re of p.urlPatterns) {
      const m = url.match(re);
      if (m?.[1]) return { platform: p.key, id: m[1] };
    }
  }
  return null;
}

/**
 * The platform whose site a URL lives on, whether or not it named a post.
 *
 * The Add Post dialog needs this because a link that no pattern claims has two
 * very different causes. `youtube.com/watch?v=short` is a YouTube link with a
 * broken id, and `example.com/thing` is not a platform at all -- and both used
 * to surface as the same message, which sent an operator off to pick a creator
 * for a URL nothing could ever track.
 *
 * Host-suffix matching, so www., m. and regional subdomains need no entries.
 */
export function platformFromHost(url: string): PlatformDef | undefined {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase().replace(/:\d+$/, "");
  } catch {
    return undefined;
  }
  return PLATFORMS.find((p) =>
    p.hosts.some((h) => host === h || host.endsWith(`.${h}`))
  );
}
