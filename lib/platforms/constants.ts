/**
 * The one list of platforms.
 *
 * Before this existed the same four names were retyped in a dozen routes and
 * components, so adding a platform to the Prisma enum left it silently rejected
 * by every zod schema and missing from every filter. Import from here instead of
 * writing the names again — a new platform should mean editing two places (the
 * Prisma enum and this file), not hunting for string literals.
 */
export const PLATFORM_VALUES = [
  "TIKTOK",
  "INSTAGRAM",
  "YOUTUBE",
  "TWITTER",
  "LINKEDIN",
  "SNAPCHAT",
  "FACEBOOK",
  "TWITCH",
  "THREADS",
  "PINTEREST",
] as const;

export type PlatformValue = (typeof PLATFORM_VALUES)[number];

/** Tuple form for `z.enum(...)`, which needs a non-empty readonly tuple. */
export const PLATFORM_ENUM = PLATFORM_VALUES as unknown as readonly [PlatformValue, ...PlatformValue[]];

export function isPlatform(value: unknown): value is PlatformValue {
  return typeof value === "string" && (PLATFORM_VALUES as readonly string[]).includes(value);
}

/** "All" plus every platform — the shape filter pill groups expect. */
export const PLATFORM_FILTER_OPTIONS: { key: string; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "TIKTOK", label: "TikTok" },
  { key: "INSTAGRAM", label: "Instagram" },
  { key: "YOUTUBE", label: "YouTube" },
  { key: "TWITTER", label: "X" },
  { key: "LINKEDIN", label: "LinkedIn" },
  { key: "SNAPCHAT", label: "Snapchat" },
  { key: "FACEBOOK", label: "Facebook" },
  { key: "TWITCH", label: "Twitch" },
  { key: "THREADS", label: "Threads" },
  { key: "PINTEREST", label: "Pinterest" },
];
