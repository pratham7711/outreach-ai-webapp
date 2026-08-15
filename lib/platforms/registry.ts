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
}

export const PLATFORMS: readonly PlatformDef[] = [
  {
    key: "TIKTOK",
    label: "TikTok",
    brandColor: "#010101",
    chartVar: "var(--chart-1)",
    tone: "neutral",
    tracking: "auto",
    urlPatterns: [/tiktok\.com\/@[\w.]+\/video\/(\d+)/i],
  },
  {
    key: "INSTAGRAM",
    label: "Instagram",
    brandColor: "#E4405F",
    chartVar: "var(--chart-2)",
    tone: "danger",
    tracking: "auto",
    urlPatterns: [/instagram\.com\/(?:reels?|p|tv)\/([\w-]+)/i],
  },
  {
    key: "YOUTUBE",
    label: "YouTube",
    brandColor: "#FF0000",
    chartVar: "var(--chart-3)",
    tone: "warning",
    tracking: "auto",
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
    tracking: "manual", // X API v2 read access is paid (~$200/mo) — manual until approved
    urlPatterns: [/(?:twitter\.com|x\.com)\/[\w]+\/status\/(\d+)/i],
  },
  {
    key: "FACEBOOK",
    label: "Facebook",
    brandColor: "#1877F2",
    chartVar: "var(--chart-1)",
    tone: "accent",
    tracking: "auto", // Meta Graph API (same app as Instagram)
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
    tracking: "auto", // Helix API (free app access token)
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
    tracking: "auto", // Meta Threads API
    urlPatterns: [/threads\.net\/(?:@[\w.]+\/post|t)\/([\w-]+)/i],
  },
  {
    key: "PINTEREST",
    label: "Pinterest",
    brandColor: "#BD081C",
    chartVar: "var(--chart-4)",
    tone: "danger",
    tracking: "auto", // Pinterest API v5 (OAuth)
    urlPatterns: [/pinterest\.[\w.]+\/pin\/(\d+)/i],
  },
  {
    key: "SNAPCHAT",
    label: "Snapchat",
    brandColor: "#FFFC00",
    chartVar: "var(--chart-1)",
    tone: "warning",
    tracking: "manual", // no third-party creator-metrics API
    urlPatterns: [/snapchat\.com\/(?:spotlight|@[\w.]+|t|p)\/([\w.-]+)/i],
  },
  {
    key: "LINKEDIN",
    label: "LinkedIn",
    brandColor: "#0A66C2",
    chartVar: "var(--chart-2)",
    tone: "accent",
    tracking: "manual", // Community Management API is partner-gated
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
