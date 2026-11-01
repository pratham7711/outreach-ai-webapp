import { isInstagramUsername, normalizeHandle } from "@/lib/platforms/instagramDiscoveryProfile";

/* The Creator Finder board: Found -> Contacted -> Replied -> Joined, plus
   Dismissed off to the side. A plain list rather than a Postgres enum, so a new
   column is a code change and never DDL. */
export const PROSPECT_STATUSES = ["FOUND", "CONTACTED", "REPLIED", "JOINED", "DISMISSED"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

/** Shown on Instagram cards, and returned by the AI route, until SCOUT_AI_INSTAGRAM=on. */
export const INSTAGRAM_AI_WAITING =
  "AI on Instagram profiles waits for Meta's review and the privacy policy update. YouTube profiles work now.";

export const PROSPECT_STATUS_LABEL: Record<ProspectStatus, string> = {
  FOUND: "Found",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  JOINED: "Joined",
  DISMISSED: "Dismissed",
};

export const PROSPECT_SOURCES = ["PASTE", "YOUTUBE_SEARCH", "SONG_SCOUT"] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

/* Why a creator was set aside. Asked on every dismissal so the list says
   something about who LKM does not want, not just who it does. */
export const DISMISS_REASONS = {
  not_a_fit: "Not a fit for our songs",
  too_small: "Too small",
  too_big: "Too big to approach",
  no_contact: "No way to reach them",
  other: "Other",
} as const;
export type DismissReason = keyof typeof DISMISS_REASONS;

export function isProspectStatus(value: unknown): value is ProspectStatus {
  return typeof value === "string" && (PROSPECT_STATUSES as readonly string[]).includes(value);
}

export function isDismissReason(value: unknown): value is DismissReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DISMISS_REASONS, value);
}

export type ProspectPlatform = "INSTAGRAM" | "YOUTUBE";

export type ParsedProspect = { platform: ProspectPlatform; handle: string; channelId: string | null };
export type SkippedInput = { input: string; reason: string };

/** At most this many handles per paste: each one is a live Instagram read
 *  when its card is opened, and Instagram's allowance is hourly. */
export const MAX_PASTE = 100;

const YT_CHANNEL_ID = /^UC[\w-]{22}$/;
const YT_HANDLE = /^[a-z0-9._-]{3,30}$/;

function asUrl(token: string): URL | null {
  const withScheme = /^https?:\/\//i.test(token) ? token : /^(www\.|m\.)?(instagram|youtube|tiktok)\.com\//i.test(token) ? `https://${token}` : null;
  if (!withScheme) return null;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function parseOne(token: string, defaultPlatform: ProspectPlatform): ParsedProspect | SkippedInput {
  const url = asUrl(token);
  if (url) {
    const host = url.hostname.replace(/^(www|m)\./, "").toLowerCase();
    const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (host === "instagram.com") {
      const handle = normalizeHandle(first);
      if (["p", "reel", "reels", "stories", "explore", "tv"].includes(handle) || !isInstagramUsername(handle))
        return { input: token, reason: "Not an Instagram profile link" };
      return { platform: "INSTAGRAM", handle, channelId: null };
    }
    if (host === "youtube.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0]?.startsWith("@")) {
        const handle = parts[0].slice(1).toLowerCase();
        if (YT_HANDLE.test(handle)) return { platform: "YOUTUBE", handle, channelId: null };
      }
      if (parts[0] === "channel" && parts[1] && YT_CHANNEL_ID.test(parts[1]))
        return { platform: "YOUTUBE", handle: parts[1], channelId: parts[1] };
      return { input: token, reason: "Not a YouTube channel link" };
    }
    if (host === "tiktok.com")
      return { input: token, reason: "TikTok profiles can't be looked up through an official API yet" };
    return { input: token, reason: "Not an Instagram or YouTube link" };
  }

  if (YT_CHANNEL_ID.test(token)) return { platform: "YOUTUBE", handle: token, channelId: token };
  const handle = normalizeHandle(token);
  if (defaultPlatform === "YOUTUBE") {
    if (YT_HANDLE.test(handle)) return { platform: "YOUTUBE", handle, channelId: null };
    return { input: token, reason: "Not a YouTube handle" };
  }
  if (isInstagramUsername(handle)) return { platform: "INSTAGRAM", handle, channelId: null };
  return { input: token, reason: "Not an Instagram handle" };
}

/**
 * Turns whatever was pasted -- one per line, commas, a column copied out of a
 * sheet, profile links -- into distinct handles. A bare handle belongs to the
 * platform picked beside the box; a link says its own platform.
 */
export function parseProspectInput(
  raw: string,
  defaultPlatform: ProspectPlatform = "INSTAGRAM",
): { items: ParsedProspect[]; skipped: SkippedInput[]; overLimit: number } {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim().replace(/^["'(<]+|[>)"'.]+$/g, ""))
    .filter(Boolean);
  const items: ParsedProspect[] = [];
  const skipped: SkippedInput[] = [];
  const seen = new Set<string>();
  let overLimit = 0;
  for (const token of tokens) {
    const parsed = parseOne(token, defaultPlatform);
    if ("reason" in parsed) {
      skipped.push(parsed);
      continue;
    }
    const key = `${parsed.platform}:${parsed.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (items.length >= MAX_PASTE) {
      overLimit++;
      continue;
    }
    items.push(parsed);
  }
  return { items, skipped, overLimit };
}

export function profileUrl(p: { platform: string; handle: string; channelId?: string | null }): string {
  if (p.platform === "YOUTUBE")
    return p.channelId && p.channelId === p.handle
      ? `https://www.youtube.com/channel/${p.channelId}`
      : `https://www.youtube.com/@${p.handle}`;
  return `https://www.instagram.com/${p.handle}/`;
}

/** Instagram's own link into a DM thread with the account. Opens the app on a
 *  phone and instagram.com on a laptop; nothing is sent from here. */
export function instagramDmUrl(handle: string): string {
  return `https://ig.me/m/${encodeURIComponent(handle)}`;
}
