import type { OAuthPlatform } from "@/lib/oauth/providers";
import { WHAT_WE_READ, type PermissionRead } from "@/lib/portal/whatWeRead";
import { instagramCardLabel } from "@/lib/oauth/instagramUnified";

/**
 * The connect-link page's list of what each platform's permissions read.
 *
 * The lines are lib/portal/whatWeRead.ts, the list My accounts shows, and are
 * not written twice. This page used to carry its own shorter copy, and the two
 * drifted: it placed the TikTok username under user.info.basic, which TikTok
 * moved to user.info.profile, and a reviewer reading both pages saw two
 * accounts of the same consent. whatWeRead's test ties every line to a scope
 * the code requests; this file's test checks the page covers the same scopes.
 */

export type PermissionLine = PermissionRead;

export type PlatformReads = {
  /** The button and heading name. */
  label: string;
  lines: PermissionLine[];
};

const LABELS: Record<OAuthPlatform, string> = {
  instagram: instagramCardLabel(),
  "instagram-login": "Instagram (Instagram login)",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook Page",
  threads: "Threads",
};

export const CONNECT_READS = Object.fromEntries(
  (Object.keys(LABELS) as OAuthPlatform[]).map((platform) => [
    platform,
    { label: LABELS[platform], lines: WHAT_WE_READ[platform] },
  ]),
) as Record<OAuthPlatform, PlatformReads>;

/** What is never done, whatever was connected. Shown under every list. */
export const NEVER_DONE =
  "We never post for you, never read your messages, and never see your password. Disconnect at any time and the stored access is deleted.";
